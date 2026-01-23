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

// OPTIMIZATION 17: Request deduplication helpers
function getRequestKey(request) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  
  // Normalized params (same as cache key)
  const paramKeys = ['offset', 'limit', 'cc', 'port', 'vpn', 'format', 'domain', 'prx-list'];
  for (const key of paramKeys) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }
  
  return url.pathname + '?' + params.toString();
}

async function deduplicateRequest(request, handler) {
  // Only deduplicate GET requests
  if (request.method !== 'GET') {
    return handler();
  }
  
  const requestKey = getRequestKey(request);
  
  // Check if identical request is already pending
  if (pendingRequests.has(requestKey)) {
    coalesceStats.hits++;
    coalesceStats.saved++;
    
    // Wait for the in-flight request to complete
    const result = await pendingRequests.get(requestKey);
    
    // Clone response to allow multiple reads
    return result.clone();
  }
  
  // Evict oldest entry if map is full
  if (pendingRequests.size >= 100) { // Using constant value
    const firstKey = pendingRequests.keys().next().value;
    pendingRequests.delete(firstKey);
  }
  
  // No pending request, execute handler
  coalesceStats.misses++;
  
  // Create promise for this request
  const promise = handler()
    .then(response => {
      // Store briefly for sharing (auto-cleanup after TTL)
      setTimeout(() => {
        if (pendingRequests.has(requestKey)) {
          pendingRequests.delete(requestKey);
        }
      }, 2000); // 2s TTL
      
      return response;
    })
    .catch(err => {
      // Remove on error immediately
      pendingRequests.delete(requestKey);
      throw err;
    });
  
  pendingRequests.set(requestKey, promise);
  return promise;
}

function getCacheKey(request) {
  const url = new URL(request.url);
  // Normalize URL for consistent cache keys
  const params = new URLSearchParams();
  
  // Sort params for consistent cache keys
  const paramKeys = ['offset', 'limit', 'cc', 'port', 'vpn', 'format', 'domain', 'prx-list'];
  for (const key of paramKeys) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }
  
  // Build cache key with sorted params
  const cacheUrl = new URL(url.origin + url.pathname);
  cacheUrl.search = params.toString();
  
  return new Request(cacheUrl.toString(), {
    method: 'GET',
    headers: request.headers,
  });
}

async function handleCachedRequest(request, handler) {
  // Skip cache for non-GET requests
  if (request.method !== 'GET') {
    return handler();
  }
  
  const cache = caches.default;
  const cacheKey = getCacheKey(request);
  
  // Try to get from cache
  let response = await cache.match(cacheKey);
  
  if (response) {
    // Cache hit - add header to indicate
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('X-Cache-Status', 'HIT');
    return newResponse;
  }
  
  // Cache miss - generate response
  response = await handler();
  
  // Only cache successful responses with Cache-Control header
  if (response.status === 200 && response.headers.has('Cache-Control')) {
    // Clone response for caching (body can only be read once)
    const responseToCache = response.clone();
    
    // Add cache status header
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('X-Cache-Status', 'MISS');
    
    // Store in cache (non-blocking)
    await cache.put(cacheKey, responseToCache);
    
    return newResponse;
  }
  
  return response;
}

// Check proxy health
async function checkPrxHealth(prxIP, prxPort) {
  const req = await fetchWithDNS(`${PRX_HEALTH_CHECK_API}?ip=${prxIP}:${prxPort}`); // Use DNS-optimized fetch
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

      // OPTIMIZATION 18: Pre-warm DNS cache on first request
      if (dnsCache.size === 0) {
        ctx.waitUntil(prewarmDNS());
      }
      
      // Periodic DNS cache cleanup
      if (Math.random() < 0.1) { // 10% of requests trigger cleanup
        ctx.waitUntil(Promise.resolve().then(cleanupDNSCache));
      }

      const upgradeHeader = request.headers.get("Upgrade");

      // Handle prx client (WebSocket)
      if (upgradeHeader === "websocket") {
        const prxMatch = url.pathname.match(/^\/(.+[:=-]\d+)$/);
        let prxIP = "";

        if (url.pathname.length == 3 || url.pathname.match(",")) {
          const prxKeys = url.pathname.replace("/", "").toUpperCase().split(",");
          const prxKey = prxKeys[Math.floor(Math.random() * prxKeys.length)];
          const kvPrx = await getKVPrxList(KV_PRX_URL, env);

          if(kvPrx[prxKey]) {
            prxIP = kvPrx[prxKey][Math.floor(Math.random() * kvPrx[prxKey].length)];
          }
          return await websocketHandler(request, prxIP);
        } else if (prxMatch) {
          prxIP = prxMatch[1];
          return await websocketHandler(request, prxIP);
        }
      }

      // Route handling
      if (url.pathname.startsWith("/sub")) {
        return Response.redirect(SUB_PAGE_URL + `?host=${appDomain}`, 301);
      } 
      
      else if (url.pathname.startsWith("/check")) {
        const target = url.searchParams.get("target").split(":");
        
        const resultPromise = checkPrxHealth(target[0], target[1] || "443");
        
        const result = await Promise.race([
          resultPromise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Health check timeout")), 5000)
          ),
        ]).catch(err => ({ error: err.message }));

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: {
            ...CORS_HEADER_OPTIONS,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300",
          },
        });
      } 
      
      else if (url.pathname.startsWith("/api/v1")) {
        const apiPath = url.pathname.replace("/api/v1", "");

        if (apiPath.startsWith("/sub")) {
          // OPTIMIZATION 17: Add request deduplication layer
          return deduplicateRequest(request, () => {
            return handleCachedRequest(request, async () => {
              const offset = +url.searchParams.get("offset") || 0;
              const filterCC = url.searchParams.get("cc")?.split(",") || [];
              const filterPort = url.searchParams.get("port")?.split(",").map(p => +p).filter(Boolean) || PORTS;
              const filterVPN = url.searchParams.get("vpn")?.split(",") || PROTOCOLS;
              const filterLimit = Math.min(
                +url.searchParams.get("limit") || MAX_CONFIGS_PER_REQUEST,
                MAX_CONFIGS_PER_REQUEST
              );
              const filterFormat = url.searchParams.get("format") || "raw";
              const fillerDomain = url.searchParams.get("domain") || appDomain;

              const prxBankUrl = url.searchParams.get("prx-list") || env.PRX_BANK_URL || PRX_BANK_URL;
              
              const { data: prxList, pagination } = await getPrxListPaginated(
                prxBankUrl,
                { offset, limit: filterLimit, filterCC },
                env
              );

              const uuid = crypto.randomUUID();
              const ssUsername = btoa(`none:${uuid}`);
              
              // PATCH 3: Comprehensive stats in response headers
              const stats = formatStats();
              const responseHeaders = {
                ...CORS_HEADER_OPTIONS,
                "X-Pagination-Offset": offset.toString(),
                "X-Pagination-Limit": filterLimit.toString(),
                "X-Pagination-Total": pagination.total.toString(),
                "X-Pagination-Has-More": pagination.hasMore.toString(),
                
                // PATCH 3: Full optimization metrics
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

              if (pagination.nextOffset !== null) {
                responseHeaders["X-Pagination-Next-Offset"] = pagination.nextOffset.toString();
              }

              // OPTIMIZATION 11: Use streaming for raw and v2ray formats
              if (filterFormat === "raw") {
                responseHeaders["Content-Type"] = "text/plain; charset=utf-8";
                responseHeaders["X-Streaming-Mode"] = "ACTIVE";
                // PATCH 2 & 3: Enhanced cache headers with ETag
                addCacheHeaders(responseHeaders, 3600, 1800);
                
                const configStream = generateConfigsStream(
                  prxList, filterPort, filterVPN, filterLimit, 
                  fillerDomain, uuid, ssUsername, appDomain, serviceName
                );
                
                return createStreamingResponse(configStream, responseHeaders, filterFormat);
                
              } else if (filterFormat === PROTOCOL_V2) {
                // For v2ray, we need to collect all configs first (base64 encoding requirement)
                const result = [];
                const configStream = generateConfigsStream(
                  prxList, filterPort, filterVPN, filterLimit,
                  fillerDomain, uuid, ssUsername, appDomain, serviceName
                );
                
                for await (const config of configStream) {
                  result.push(config);
                }
                
                const finalResult = btoa(result.join("\n"));
                responseHeaders["Content-Type"] = "text/plain; charset=utf-8";
                responseHeaders["X-Streaming-Mode"] = "BUFFERED";
                // PATCH 2 & 3: Enhanced cache headers with ETag
                addCacheHeaders(responseHeaders, 3600, 1800);
                
                return new Response(finalResult, {
                  status: 200,
                  headers: responseHeaders,
                });
                
              } else if ([PROTOCOL_NEKO, "sfa", "bfr"].includes(filterFormat)) {
                // For converter formats, collect configs first
                const result = [];
                const configStream = generateConfigsStream(
                  prxList, filterPort, filterVPN, filterLimit,
                  fillerDomain, uuid, ssUsername, appDomain, serviceName
                );
                
                for await (const config of configStream) {
                  result.push(config);
                }
                
                const converterPromise = fetchWithDNS(CONVERTER_URL, { // Use DNS-optimized fetch
                  method: "POST",
                  body: JSON.stringify({
                    url: result.join(","),
                    format: filterFormat,
                    template: "cf",
                  }),
                });

                const res = await Promise.race([
                  converterPromise,
                  new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Converter timeout")), 8000)
                  ),
                ]).catch(err => {
                  return new Response(JSON.stringify({ error: "Converter service timeout" }), {
                    status: 504,
                    headers: { 
                      ...CORS_HEADER_OPTIONS,
                      "Content-Type": "application/json"
                    },
                  });
                });

                if (res.status == 200) {
                  const finalResult = await res.text();
                  const contentType = res.headers.get("Content-Type") || "text/plain; charset=utf-8";
                  responseHeaders["Content-Type"] = contentType;
                  responseHeaders["X-Streaming-Mode"] = "CONVERTER";
                  // PATCH 2 & 3: Enhanced cache headers with ETag
                  addCacheHeaders(responseHeaders, 3600, 1800);
                  
                  return new Response(finalResult, {
                    status: 200,
                    headers: responseHeaders,
                  });
                } else {
                  return new Response(res.statusText, {
                    status: res.status,
                    headers: { 
                      ...CORS_HEADER_OPTIONS,
                      "Content-Type": "text/plain; charset=utf-8"
                    },
                  });
                }
              }
            });
          });
        } else if (apiPath.startsWith("/myip")) {
          return new Response(
            JSON.stringify({
              ip:
                request.headers.get("cf-connecting-ipv6") ||
                request.headers.get("cf-connecting-ip") ||
                request.headers.get("x-real-ip"),
              colo: request.headers.get("cf-ray")?.split("-")[1],
              ...request.cf,
            }),
            {
              headers: {
                ...CORS_HEADER_OPTIONS,
                "Content-Type": "application/json",
                "Cache-Control": "private, max-age=60",
              },
            }
          );
        }
      }

      const targetReversePrx = env.REVERSE_PRX_TARGET || "example.com";
      return await reverseWeb(request, targetReversePrx);
    } catch (err) {
      console.error("Worker error:", err);
      return new Response(`An error occurred: ${err.toString()}`, {
        status: 500,
        headers: {
          ...CORS_HEADER_OPTIONS,
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }
  },
};
