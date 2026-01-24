import { 
  PORTS, 
  PROTOCOLS, 
  PRX_BANK_URL, 
  KV_PRX_URL,
  MAX_CONFIGS_PER_REQUEST,
  CORS_HEADER_OPTIONS,
  SUB_PAGE_URL,
  PROTOCOL_V2,
  PROTOCOL_NEKO,
  CONVERTER_URL,
  PRX_HEALTH_CHECK_API
} from './config/constants.js';

import { 
  dnsCache, 
  pendingRequests, 
  coalesceStats 
} from './core/state.js';

import { formatStats } from './core/diagnostics.js';
import { websocketHandler } from './handlers/websocket.js';
import { getKVPrxList, getPrxListPaginated } from './services/proxyProvider.js';
import { generateConfigsStream, createStreamingResponse } from './services/configGenerator.js';
import { reverseWeb } from './services/httpReverse.js';
import { prewarmDNS, cleanupDNSCache, fetchWithDNS } from './services/dns.js';

function getWebUI() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aegir WebUI</title>
<style>
:root { --accent: #00f2ea; --bg: #050505; --panel: #111; --text: #eee; }
body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
.card { background: var(--panel); padding: 2rem; border-radius: 12px; border: 1px solid #222; width: 100%; max-width: 420px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
h2 { text-align: center; color: var(--accent); margin-top: 0; }
label { display: block; margin: 10px 0 5px; font-size: 0.9em; color: #aaa; }
input, select, button { width: 100%; padding: 12px; background: #222; border: 1px solid #333; color: white; border-radius: 6px; margin-bottom: 5px; font-size: 14px; box-sizing: border-box; }
input:focus, select:focus { outline: none; border-color: var(--accent); }
button { background: var(--accent); color: black; font-weight: bold; cursor: pointer; border: none; margin-top: 15px; }
button:hover { opacity: 0.9; }
.result { margin-top: 20px; padding: 10px; background: #000; border-radius: 6px; font-family: monospace; font-size: 12px; word-break: break-all; display: none; color: #0f0; }
</style>
</head>
<body>
<div class="card">
  <h2>Aegir WebUI</h2>
  <label>Target Domain (SNI)</label>
  <input id="sni" type="text" placeholder="example.com">
  
  <label>Config Format</label>
  <select id="fmt">
    <option value="raw">Raw (Clash/Meta)</option>
    <option value="v2ray">V2Ray / Xray</option>
    <option value="clash">Clash Provider</option>
  </select>

  <button onclick="gen()">Generate Link</button>
  <div id="out" class="result"></div>
</div>
<script>
  // Initialize
  document.getElementById('sni').value = window.location.hostname;

  function gen() {
    var sni = document.getElementById('sni').value || window.location.hostname;
    var fmt = document.getElementById('fmt').value;
    var origin = window.location.origin;
    var url = "";

    if (fmt === 'clash') {
      url = origin + '/sub?host=' + sni + '&format=clash';
    } else if (fmt === 'v2ray') {
      url = origin + '/api/v1/sub?host=' + sni + '&format=v2ray';
    } else {
      url = origin + '/api/v1/sub?host=' + sni + '&format=raw';
    }

    var out = document.getElementById('out');
    out.innerText = url;
    out.style.display = 'block';
  }
</script>
</body>
</html>`;
}

// Helper functions
function getRequestKey(request) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  const paramKeys = ['offset', 'limit', 'cc', 'port', 'vpn', 'format', 'domain', 'prx-list'];
  for (const key of paramKeys) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }
  return url.pathname + '?' + params.toString();
}

async function deduplicateRequest(request, handler) {
  if (request.method !== 'GET') return handler();
  const requestKey = getRequestKey(request);
  if (pendingRequests.has(requestKey)) {
    coalesceStats.hits++;
    coalesceStats.saved++;
    const result = await pendingRequests.get(requestKey);
    return result.clone();
  }
  if (pendingRequests.size >= 100) {
    const firstKey = pendingRequests.keys().next().value;
    pendingRequests.delete(firstKey);
  }
  coalesceStats.misses++;
  const promise = handler().then(response => {
    setTimeout(() => { if (pendingRequests.has(requestKey)) pendingRequests.delete(requestKey); }, 2000);
    return response;
  }).catch(err => { pendingRequests.delete(requestKey); throw err; });
  pendingRequests.set(requestKey, promise);
  return promise;
}

function getCacheKey(request) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  const paramKeys = ['offset', 'limit', 'cc', 'port', 'vpn', 'format', 'domain', 'prx-list'];
  for (const key of paramKeys) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }
  const cacheUrl = new URL(url.origin + url.pathname);
  cacheUrl.search = params.toString();
  return new Request(cacheUrl.toString(), { method: 'GET', headers: request.headers });
}

async function handleCachedRequest(request, handler) {
  if (request.method !== 'GET') return handler();
  const cache = caches.default;
  const cacheKey = getCacheKey(request);
  let response = await cache.match(cacheKey);
  if (response) {
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('X-Cache-Status', 'HIT');
    return newResponse;
  }
  response = await handler();
  if (response.status === 200 && response.headers.has('Cache-Control')) {
    const responseToCache = response.clone();
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('X-Cache-Status', 'MISS');
    await cache.put(cacheKey, responseToCache); 
    return newResponse;
  }
  return response;
}

async function checkPrxHealth(prxIP, prxPort) {
  const req = await fetchWithDNS(`${PRX_HEALTH_CHECK_API}?ip=${prxIP}:${prxPort}`);
  return await req.json();
}

function addCacheHeaders(headers, ttl = 3600, browserTTL = 1800) {
  headers["Cache-Control"] = `public, max-age=${browserTTL}, s-maxage=${ttl}, stale-while-revalidate=86400`;
  headers["CDN-Cache-Control"] = `public, max-age=${ttl}`;
  headers["Cloudflare-CDN-Cache-Control"] = `max-age=${ttl}`;
  headers["Vary"] = "Accept-Encoding";
  headers["ETag"] = `"${Date.now().toString(36)}"`;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const appDomain = url.hostname;
      const serviceName = appDomain.split(".")[0];

      if (dnsCache && dnsCache.size === 0) ctx.waitUntil(prewarmDNS());
      if (Math.random() < 0.1) ctx.waitUntil(Promise.resolve().then(cleanupDNSCache));

      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader === "websocket") {
        const prxMatch = url.pathname.match(/^\/(.+[:=-]\d+)$/);
        let prxIP = "";
        if (url.pathname.length == 3 || url.pathname.match(",")) {
          const prxKeys = url.pathname.replace("/", "").toUpperCase().split(",");
          const prxKey = prxKeys[Math.floor(Math.random() * prxKeys.length)];
          const kvPrx = await getKVPrxList(KV_PRX_URL, env);
          if(kvPrx && kvPrx[prxKey]) {
            prxIP = kvPrx[prxKey][Math.floor(Math.random() * kvPrx[prxKey].length)];
          }
          return await websocketHandler(request, prxIP);
        } else if (prxMatch) {
          prxIP = prxMatch[1];
          return await websocketHandler(request, prxIP);
        }
      }

      // ROUTING LOGIC
      if (url.pathname === "/" || url.pathname === "/sub") {
        return new Response(getWebUI(), { 
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=3600"
          }
        });
      } 
      
      else if (url.pathname.startsWith("/check")) {
         const target = url.searchParams.get("target")?.split(":") || [];
         if (target.length < 1) {
             return new Response(JSON.stringify({ error: "Invalid target" }), { status: 400 });
         }
        const resultPromise = checkPrxHealth(target[0], target[1] || "443");
        const result = await Promise.race([
          resultPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("Health check timeout")), 5000)),
        ]).catch(err => ({ error: err.message }));
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { ...CORS_HEADER_OPTIONS, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
        });
      } 
      
      else if (url.pathname.startsWith("/api/v1")) {
         const apiPath = url.pathname.replace("/api/v1", "");
         if (apiPath.startsWith("/sub")) {
          return deduplicateRequest(request, () => {
            return handleCachedRequest(request, async () => {
              const offset = +url.searchParams.get("offset") || 0;
              const filterCC = url.searchParams.get("cc")?.split(",") || [];
              const filterPort = url.searchParams.get("port")?.split(",").map(p => +p).filter(Boolean) || PORTS;
              const filterVPN = url.searchParams.get("vpn")?.split(",") || PROTOCOLS;
              const filterLimit = Math.min(+url.searchParams.get("limit") || MAX_CONFIGS_PER_REQUEST, MAX_CONFIGS_PER_REQUEST);
              const filterFormat = url.searchParams.get("format") || "raw";
              const fillerDomain = url.searchParams.get("domain") || appDomain;
              const prxBankUrl = url.searchParams.get("prx-list") || env.PRX_BANK_URL || PRX_BANK_URL;
              
              const { data: prxList, pagination } = await getPrxListPaginated(prxBankUrl, { offset, limit: filterLimit, filterCC }, env);
              const uuid = crypto.randomUUID();
              const ssUsername = btoa(`none:${uuid}`);
              const stats = formatStats();
              
              const responseHeaders = {
                ...CORS_HEADER_OPTIONS,
                "X-Pagination-Offset": offset.toString(),
                "X-Pagination-Limit": filterLimit.toString(),
                "X-Pagination-Total": pagination.total.toString(),
                "X-Pagination-Has-More": pagination.hasMore.toString(),
                "X-Pool-Stats": stats.pool,
                "X-Buffer-Stats": stats.buffer,
                "X-Timeout-Stats": stats.timeout,
                "X-Retry-Stats": stats.retry,
                "X-Batch-Stats": stats.batch,
                "X-Dedup-Stats": stats.dedup,
                "X-Streaming-Stats": stats.streaming,
                "X-DNS-Stats": stats.dns,
                "X-Worker-Optimizations": "OPT11-18-ACTIVE",
              };

              if (pagination.nextOffset !== null) responseHeaders["X-Pagination-Next-Offset"] = pagination.nextOffset.toString();

              if (filterFormat === "raw") {
                responseHeaders["Content-Type"] = "text/plain; charset=utf-8";
                responseHeaders["X-Streaming-Mode"] = "ACTIVE";
                addCacheHeaders(responseHeaders, 3600, 1800);
                const configStream = generateConfigsStream(prxList, filterPort, filterVPN, filterLimit, fillerDomain, uuid, ssUsername, appDomain, serviceName);
                return createStreamingResponse(configStream, responseHeaders, filterFormat);
              } else if (filterFormat === PROTOCOL_V2) {
                const result = [];
                const configStream = generateConfigsStream(prxList, filterPort, filterVPN, filterLimit, fillerDomain, uuid, ssUsername, appDomain, serviceName);
                for await (const config of configStream) result.push(config);
                const finalResult = btoa(result.join("\n"));
                responseHeaders["Content-Type"] = "text/plain; charset=utf-8";
                responseHeaders["X-Streaming-Mode"] = "BUFFERED";
                addCacheHeaders(responseHeaders, 3600, 1800);
                return new Response(finalResult, { status: 200, headers: responseHeaders });
              } else {
                 const result = [];
                 const configStream = generateConfigsStream(prxList, filterPort, filterVPN, filterLimit, fillerDomain, uuid, ssUsername, appDomain, serviceName);
                 for await (const config of configStream) result.push(config);
                 
                 const converterPromise = fetchWithDNS(CONVERTER_URL, {
                  method: "POST",
                  body: JSON.stringify({ url: result.join(","), format: filterFormat, template: "cf" }),
                 });
                 const res = await Promise.race([
                  converterPromise,
                  new Promise((_, reject) => setTimeout(() => reject(new Error("Converter timeout")), 8000)),
                 ]).catch(err => new Response(JSON.stringify({ error: "Converter service timeout" }), { status: 504, headers: { ...CORS_HEADER_OPTIONS, "Content-Type": "application/json" } }));
                 
                 if (res instanceof Response && res.status == 200) {
                  const finalResult = await res.text();
                  responseHeaders["Content-Type"] = res.headers.get("Content-Type") || "text/plain; charset=utf-8";
                  responseHeaders["X-Streaming-Mode"] = "CONVERTER";
                  addCacheHeaders(responseHeaders, 3600, 1800);
                  return new Response(finalResult, { status: 200, headers: responseHeaders });
                 } else {
                   return res instanceof Response ? res : new Response("Converter Error", { status: 502 });
                 }
              }
            });
          });
         } else if (apiPath.startsWith("/myip")) {
             return new Response(JSON.stringify({
              ip: request.headers.get("cf-connecting-ipv6") || request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip"),
              colo: request.headers.get("cf-ray")?.split("-")[1],
              ...request.cf,
            }), { headers: { ...CORS_HEADER_OPTIONS, "Content-Type": "application/json", "Cache-Control": "private, max-age=60" } });
         }
      }

      // Default to Reverse Proxy for unknown paths
      const targetReversePrx = env.REVERSE_PRX_TARGET || "example.com";
      return await reverseWeb(request, targetReversePrx);
    } catch (err) {
      console.error("Worker error:", err);
      return new Response(`An error occurred: ${err.toString()}`, { status: 500, headers: { ...CORS_HEADER_OPTIONS, "Content-Type": "text/plain; charset=utf-8" } });
    }
  },
};
