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

// Base64 encoded HTML to prevent string parser errors in Worker environment
const BASE64_HTML = "PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9ImVuIj4KPGhlYWQ+CjxtZXRhIGNoYXJzZXQ9IlVURi04Ij4KPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xLjAiPgo8dGl0bGU+QWVnaXIgR2VuZXJhdG9yPC90aXRsZT4KPHN0eWxlPgo6cm9vdHstLXA6IzAwZjJlYTstLWI6IzExMTstLXQ6I2ZmZn0KYm9keXtiYWNrZ3JvdW5kOiMwNTA1MDU7Y29sb3I6dmFyKC0tdCk7Zm9udC1mYW1pbHk6c2Fucy1zZXJpZjtkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OmNlbnRlcjtwYWRkaW5nOjIwcHh9Ci5je2JhY2tncm91bmQ6dmFyKC0tYik7cGFkZGluZzoyMHB4O2JvcmRlci1yYWRpdXM6MTBweDt3aWR0aDoxMDAlO21heC13aWR0aDo0MDBweDtib3JkZXI6MXB4IHNvbGlkICMzMzN9CmxhYmVse2Rpc3BsYXk6YmxvY2s7Y29sb3I6Izg4ODttYXJnaW46MTBweCAwIDVweDtmb250LXNpemU6MC45ZW19CmlucHV0LHNlbGVjdCxidXR0b257d2lkdGg6MTAwJTtwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDojMjIyO2JvcmRlcjoxcHggc29saWQgIzQ0NDtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6NXB4O2JveC1zaXppbmc6Ym9yZGVyLWJveH0KYnV0dG9ue2JhY2tncm91bmQ6dmFyKC0tcCk7Y29sb3I6IzAwMDtmb250LXdlaWdodDpib2xkO21hcmdpbi10b3A6MjBweDtjdXJzb3I6cG9pbnRlcjtib3JkZXI6bm9uZX0KPC9zdHlsZT4KPC9oZWFkPgo8Ym9keT4KPGRpdiBjbGFzcz0iYyI+CjxoMiBzdHlsZT0idGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tcCkiPkFlZ2lyIPCfjIo8L2gyPgo8bGFiZWw+QnVnIElQL0hvc3Q8L2xhYmVsPjxpbnB1dCBpZD0iYnVnIiBwbGFjZWhvbGRlcj0iQXV0byI+CjxsYWJlbD5TTkkvV1MgSG9zdDwvbGFiZWw+PGlucHV0IGlkPSJzbmkiIHBsYWNlaG9sZGVyPSJBdXRvIj4KPGxhYmVsPkNDPC9sYWJlbD48aW5wdXQgaWQ9ImNjIiBwbGFjZWhvbGRlcj0iZS5nLiBTRyI+CjxsYWJlbD5MaW1pdDwvbGFiZWw+PHNlbGVjdCBpZD0ibGltIj48b3B0aW9uIHZhbHVlPSIxIj4xPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iMTAiPjEwPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iNTAiIHNlbGVjdGVkPjUwPC9vcHRpb24+PC9zZWxlY3Q+CjxsYWJlbD5Gb3JtYXQ8L2xhYmVsPjxzZWxlY3QgaWQ9ImZtdCI+PG9wdGlvbiB2YWx1ZT0icmF3Ij5SYXc8L29wdGlvbj48b3B0aW9uIHZhbHVlPSJ2MnJheSI+VjJSYXk8L29wdGlvbj48b3B0aW9uIHZhbHVlPSJjbGFzaCI+Q2xhc2g8L29wdGlvbj48L3NlbGVjdD4KPGJ1dHRvbiBvbmNsaWNrPSJnKCkiPkdlbmVyYXRlPC9idXR0b24+CjxkaXYgaWQ9InJlcyIgc3R5bGU9Im1hcmdpbi10b3A6MTVweDt3b3JkLWJyZWFrOmJyZWFrLWFsbDtjb2xvcjojMGYwO2ZvbnQtZmFtaWx5Om1vbm9zcGFjZTtmb250LXNpemU6MC45ZW0iPjwvZGl2Pgo8L2Rpdj4KPHNjcmlwdD4KZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2J1ZycpLnBsYWNlaG9sZGVyPWxvY2F0aW9uLmhvc3RuYW1lOwpkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc25pJykucGxhY2Vob2xkZXI9bG9jYXRpb24uaG9zdG5hbWU7CmZ1bmN0aW9uIGcoKXsKdmFyIGI9ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2J1ZycpLnZhbHVlLHM9ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NuaScpLnZhbHVlLGM9ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NjJykudmFsdWUsbD1kb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbGltJykudmFsdWUsZj1kb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm10JykudmFsdWU7CnZhciB1PW5ldyBVUkxTZWFyY2hQYXJhbXMoKTsKaWYoYil1LmFwcGVuZCgnZG9tYWluJyxiKTsKaWYocyl1LmFwcGVuZCgnc25pJyxzKTsKaWYoYyl1LmFwcGVuZCgnY2MnLGMpOwp1LmFwcGVuZCgnbGltaXQnLGwpOwp2YXIgcD0nL2FwaS92MS9zdWInOwppZihmPT09J2NsYXNoJyl7cD0nL3N1Yic7dS5hcHBlbmQoJ2Zvcm1hdCcsJ2NsYXNoJyk7aWYocyl1LmFwcGVuZCgnaG9zdCcscyl9ZWxzZXt1LmFwcGVuZCgnZm9ybWF0JyxmKX0KZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JlcycpLmlubmVyVGV4dD1sb2NhdGlvbi5vcmlnaW4rcCsnPycrdQp9Cjwvc2NyaXB0Pgo8L2JvZHk+CjwvaHRtbD4=";

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
        // Decode Base64 HTML at runtime to bypass parser errors
        const html = atob(BASE64_HTML);
        return new Response(html, { 
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
                const configStream = generateConfigsStream(prxList, filterPort, filterVPN, filterLimit, fillerDomain, uuid, ssUsername, customSNI, serviceName);
                return createStreamingResponse(configStream, responseHeaders, filterFormat);
              } else if (filterFormat === PROTOCOL_V2) {
                const result = [];
                const configStream = generateConfigsStream(prxList, filterPort, filterVPN, filterLimit, fillerDomain, uuid, ssUsername, customSNI, serviceName);
                for await (const config of configStream) result.push(config);
                const finalResult = btoa(result.join("\n"));
                responseHeaders["Content-Type"] = "text/plain; charset=utf-8";
                responseHeaders["X-Streaming-Mode"] = "BUFFERED";
                addCacheHeaders(responseHeaders, 3600, 1800);
                return new Response(finalResult, { status: 200, headers: responseHeaders });
              } else {
                 const result = [];
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
