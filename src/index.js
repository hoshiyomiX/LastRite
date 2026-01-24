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
<title>Aegir Config Generator</title>
<style>
:root { --accent: #00f2ea; --accent-hover: #00c2bb; --bg: #050505; --panel: #111; --text: #eee; --border: #333; }
body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 10px; }
.card { background: var(--panel); padding: 2rem; border-radius: 16px; border: 1px solid var(--border); width: 100%; max-width: 450px; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
h2 { text-align: center; color: var(--accent); margin: 0 0 20px 0; font-weight: 800; letter-spacing: 1px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.full { grid-column: span 2; }
label { display: block; margin: 8px 0 4px; font-size: 0.85em; color: #888; text-transform: uppercase; font-weight: 600; }
input, select, button { width: 100%; padding: 12px; background: #1a1a1a; border: 1px solid var(--border); color: white; border-radius: 8px; font-size: 14px; box-sizing: border-box; transition: 0.2s; }
input:focus, select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(0, 242, 234, 0.1); background: #222; }
button { background: linear-gradient(135deg, var(--accent), var(--accent-hover)); color: #000; font-weight: 800; border: none; margin-top: 20px; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; }
button:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 242, 234, 0.2); }
.result-area { margin-top: 20px; display: none; }
textarea { width: 100%; height: 120px; background: #000; border: 1px solid var(--border); color: #0f0; padding: 10px; border-radius: 8px; font-family: monospace; font-size: 11px; resize: vertical; }
.tools { margin-top: 10px; display: flex; gap: 10px; }
.tools button { margin-top: 0; background: #333; color: white; font-size: 12px; padding: 8px; }
.tools button:hover { background: #444; }
.badge { display: inline-block; padding: 2px 6px; background: #222; border-radius: 4px; font-size: 10px; color: #aaa; margin-left: 5px; border: 1px solid #333; }
</style>
</head>
<body>
<div class="card">
  <h2>Aegir 🌊 <span style="font-size:0.5em; color:#666">v2.1</span></h2>
  
  <div class="grid">
    <div class="full">
      <label>Bug Address / IP <span class="badge">Server</span></label>
      <input id="bug" type="text" placeholder="e.g. 104.16.x.x or bug.com">
    </div>

    <div class="full">
      <label>SNI / WS Host <span class="badge">Header</span></label>
      <input id="sni" type="text" placeholder="Defaults to current worker">
    </div>

    <div>
      <label>Country (CC)</label>
      <input id="cc" type="text" placeholder="SG,ID,JP (Empty=All)">
    </div>
    
    <div>
      <label>Limit</label>
      <select id="limit">
        <option value="1">Single (1)</option>
        <option value="10">List (10)</option>
        <option value="50" selected>Bulk (50)</option>
      </select>
    </div>

    <div class="full">
      <label>Format</label>
      <select id="fmt">
        <option value="raw">Raw (Clash/Meta/Surfboard)</option>
        <option value="v2ray">V2Ray / Xray (Base64)</option>
        <option value="clash">Clash Provider (YAML)</option>
      </select>
    </div>
  </div>

  <button onclick="gen()">Generate Config</button>

  <div id="res" class="result-area">
    <label>Generated Subscription URL</label>
    <input id="url-out" type="text" readonly onclick="this.select()">
    
    <div style="margin-top:10px; text-align:right">
        <a id="test-link" href="#" target="_blank" style="color:var(--accent); font-size:12px; text-decoration:none">Test/Open Link &rarr;</a>
    </div>
  </div>
</div>

<script>
  document.getElementById('sni').placeholder = window.location.hostname;
  document.getElementById('bug').placeholder = window.location.hostname;

  function gen() {
    const bug = document.getElementById('bug').value.trim();
    const sni = document.getElementById('sni').value.trim();
    const cc = document.getElementById('cc').value.trim();
    const limit = document.getElementById('limit').value;
    const fmt = document.getElementById('fmt').value;
    const origin = window.location.origin;

    const params = new URLSearchParams();
    if (bug) params.append('domain', bug); // domain param maps to fillerDomain (Address)
    if (sni) params.append('sni', sni);    // sni param maps to appDomain (Host/SNI)
    if (cc) params.append('cc', cc.toUpperCase());
    params.append('limit', limit);
    
    // Format handling
    let endpoint = '/api/v1/sub';
    if (fmt === 'clash') {
        endpoint = '/sub';
        params.append('format', 'clash');
    } else {
        params.append('format', fmt);
    }
    
    // Special handling for old /sub endpoint expecting 'host' instead of 'sni'
    if (fmt === 'clash') {
        if (sni) params.append('host', sni);
    }

    const finalUrl = origin + endpoint + '?' + params.toString();
    
    document.getElementById('res').style.display = 'block';
    document.getElementById('url-out').value = finalUrl;
    document.getElementById('test-link').href = finalUrl;
  }
</script>
</body>
</html>`;
}

// Helper functions
function getRequestKey(request) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  const paramKeys = ['offset', 'limit', 'cc', 'port', 'vpn', 'format', 'domain', 'prx-list', 'sni', 'host'];
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
  const paramKeys = ['offset', 'limit', 'cc', 'port', 'vpn', 'format', 'domain', 'prx-list', 'sni', 'host'];
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
              
              // NEW LOGIC: Bug Address maps to 'domain' param (fillerDomain)
              const fillerDomain = url.searchParams.get("domain") || appDomain;
              
              // NEW LOGIC: SNI Override
              const customSNI = url.searchParams.get("sni") || url.searchParams.get("host") || appDomain;

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
                // Pass customSNI as the appDomain argument
                const configStream = generateConfigsStream(prxList, filterPort, filterVPN, filterLimit, fillerDomain, uuid, ssUsername, customSNI, serviceName);
                return createStreamingResponse(configStream, responseHeaders, filterFormat);
              } else if (filterFormat === PROTOCOL_V2) {
                const result = [];
                // Pass customSNI as the appDomain argument
                const configStream = generateConfigsStream(prxList, filterPort, filterVPN, filterLimit, fillerDomain, uuid, ssUsername, customSNI, serviceName);
                for await (const config of configStream) result.push(config);
                const finalResult = btoa(result.join("\n"));
                responseHeaders["Content-Type"] = "text/plain; charset=utf-8";
                responseHeaders["X-Streaming-Mode"] = "BUFFERED";
                addCacheHeaders(responseHeaders, 3600, 1800);
                return new Response(finalResult, { status: 200, headers: responseHeaders });
              } else {
                 const result = [];
                 // Pass customSNI as the appDomain argument
                 const configStream = generateConfigsStream(prxList, filterPort, filterVPN, filterLimit, fillerDomain, uuid, ssUsername, customSNI, serviceName);
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
