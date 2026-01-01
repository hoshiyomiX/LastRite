import { connect } from "cloudflare:sockets";

// Variables
let serviceName = "";
let APP_DOMAIN = "";

let prxIP = "";

// In-memory cache with unified structure
const inMemoryCache = {
  prxList: { data: null, timestamp: 0 },
  kvPrxList: { data: null, timestamp: 0 }
};
const CACHE_TTL = 3600000; // 1 hour in milliseconds

// OPTIMIZATION 12: Connection pooling
const connectionPool = new Map();
const POOL_MAX_SIZE = 20;
const POOL_IDLE_TIMEOUT = 60000; // 60 seconds
const poolStats = { hits: 0, misses: 0, evictions: 0 };

// OPTIMIZATION 13: Buffer management constants
const BUFFER_HIGH_WATERMARK = 262144; // 256KB - pause if exceeded
const BUFFER_LOW_WATERMARK = 65536;   // 64KB - resume when below
const CHUNK_SIZE_OPTIMAL = 65536;     // 64KB per chunk
const MAX_QUEUE_SIZE = 512;           // Max queued chunks

// OPTIMIZATION 14: Adaptive timeout system
const latencyTracker = new Map(); // Track RTT per destination
const LATENCY_HISTORY_SIZE = 10;  // Keep last 10 measurements
const TIMEOUT_MIN = 8000;          // Minimum timeout: 8s
const TIMEOUT_MAX = 45000;         // Maximum timeout: 45s
const TIMEOUT_MULTIPLIER = 3.5;    // Timeout = RTT * multiplier
const TIMEOUT_DEFAULT = 25000;     // Default when no history
const timeoutStats = { 
  adaptive: 0, 
  default: 0, 
  fastFail: 0,
  slowSuccess: 0 
};

// Constant
const horse = "dHJvamFu";
const flash = "dm1lc3M=";
const v2 = "djJyYXk=";
const neko = "Y2xhc2g=";

// Pre-computed constants (optimization)
const PROTOCOL_HORSE = atob(horse);
const PROTOCOL_FLASH = atob(flash);
const PROTOCOL_V2 = atob(v2);
const PROTOCOL_NEKO = atob(neko);
const UUID_V4_REGEX = /^[0-9a-f]{8}[0-9a-f]{4}4[0-9a-f]{3}[89ab][0-9a-f]{3}[0-9a-f]{12}$/i;

// Pre-compute TextEncoder for UDP relay
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

// Cache flag emojis
const FLAG_EMOJI_CACHE = new Map();

const PORTS = [443, 80];
const PROTOCOLS = [PROTOCOL_HORSE, PROTOCOL_FLASH, "ss"];
const SUB_PAGE_URL = "https://foolvpn.web.id/nautica";
const KV_PRX_URL = "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/kvProxyList.json";
const PRX_BANK_URL = "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/proxyList.txt";
const DNS_SERVER_ADDRESS = "8.8.8.8";
const DNS_SERVER_PORT = 53;
const RELAY_SERVER_UDP = {
  host: "udp-relay.hobihaus.space",
  port: 7300,
};
const PRX_HEALTH_CHECK_API = "https://id1.foolvpn.web.id/api/v1/check";
const CONVERTER_URL = "https://api.foolvpn.web.id/convert";
const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;
const CORS_HEADER_OPTIONS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

// Connection timeout constants (now dynamic via adaptive system)
const MAX_CONFIGS_PER_REQUEST = 20; // Pagination limit

// OPTIMIZATION 14: Adaptive timeout helpers
function getLatencyKey(address, port) {
  return `${address}:${port}`;
}

function recordLatency(address, port, latencyMs) {
  const key = getLatencyKey(address, port);
  
  if (!latencyTracker.has(key)) {
    latencyTracker.set(key, []);
  }
  
  const history = latencyTracker.get(key);
  history.push(latencyMs);
  
  // Keep only recent history
  if (history.length > LATENCY_HISTORY_SIZE) {
    history.shift();
  }
}

function calculateAdaptiveTimeout(address, port, log) {
  const key = getLatencyKey(address, port);
  const history = latencyTracker.get(key);
  
  if (!history || history.length === 0) {
    timeoutStats.default++;
    return TIMEOUT_DEFAULT;
  }
  
  // Calculate percentile (P95) for adaptive timeout
  const sorted = [...history].sort((a, b) => a - b);
  const p95Index = Math.floor(sorted.length * 0.95);
  const p95Latency = sorted[p95Index] || sorted[sorted.length - 1];
  
  // Calculate adaptive timeout: P95 * multiplier
  let adaptiveTimeout = Math.floor(p95Latency * TIMEOUT_MULTIPLIER);
  
  // Clamp to min/max bounds
  adaptiveTimeout = Math.max(TIMEOUT_MIN, Math.min(TIMEOUT_MAX, adaptiveTimeout));
  
  timeoutStats.adaptive++;
  
  log(`Adaptive timeout for ${key}: ${adaptiveTimeout}ms (P95 RTT: ${p95Latency}ms, samples: ${history.length})`);
  
  return adaptiveTimeout;
}

function cleanupLatencyTracker() {
  // Cleanup old entries periodically (keep tracker bounded)
  if (latencyTracker.size > 100) {
    const keysToDelete = [];
    let count = 0;
    
    for (const key of latencyTracker.keys()) {
      if (count++ > 20) break; // Remove oldest 20 entries
      keysToDelete.push(key);
    }
    
    keysToDelete.forEach(key => latencyTracker.delete(key));
  }
}

// OPTIMIZATION 12: Connection pool helpers
function getPoolKey(address, port) {
  return `${address}:${port}`;
}

async function getPooledConnection(address, port, log) {
  const key = getPoolKey(address, port);
  const poolEntry = connectionPool.get(key);
  
  if (poolEntry && !poolEntry.socket.closed) {
    poolStats.hits++;
    connectionPool.delete(key); // Remove from pool when taken
    clearTimeout(poolEntry.timeoutId);
    log(`Pool HIT: ${key} (${poolStats.hits} hits, ${poolStats.misses} misses)`);
    return poolEntry.socket;
  }
  
  if (poolEntry) {
    // Expired or closed connection, cleanup
    connectionPool.delete(key);
  }
  
  poolStats.misses++;
  return null;
}

function returnToPool(tcpSocket, address, port, log) {
  // Don't pool if socket is already closed or closing
  if (tcpSocket.closed) {
    return;
  }
  
  // Evict oldest entry if pool is full
  if (connectionPool.size >= POOL_MAX_SIZE) {
    const firstKey = connectionPool.keys().next().value;
    const oldest = connectionPool.get(firstKey);
    
    if (oldest) {
      clearTimeout(oldest.timeoutId);
      try {
        oldest.socket.close();
      } catch (e) {
        // Silent fail
      }
      connectionPool.delete(firstKey);
      poolStats.evictions++;
    }
  }
  
  const key = getPoolKey(address, port);
  
  // Set idle timeout
  const timeoutId = setTimeout(() => {
    if (connectionPool.has(key)) {
      const entry = connectionPool.get(key);
      try {
        entry.socket.close();
      } catch (e) {
        // Silent fail
      }
      connectionPool.delete(key);
      log(`Pool cleanup: ${key} (idle timeout)`);
    }
  }, POOL_IDLE_TIMEOUT);
  
  connectionPool.set(key, {
    socket: tcpSocket,
    timeoutId: timeoutId,
    timestamp: Date.now(),
  });
  
  log(`Returned to pool: ${key} (pool size: ${connectionPool.size}/${POOL_MAX_SIZE})`);
}

async function getCachedData(cacheKey, fetchFn, ttl, env) {
  const now = Date.now();
  
  // 1. Check in-memory cache first
  if (inMemoryCache[cacheKey]?.data && (now - inMemoryCache[cacheKey].timestamp) < ttl) {
    return inMemoryCache[cacheKey].data;
  }
  
  // 2. Check KV cache
  if (env?.KV_CACHE) {
    try {
      const cached = await env.KV_CACHE.get(cacheKey, "json");
      if (cached) {
        inMemoryCache[cacheKey] = { data: cached, timestamp: now };
        return cached;
      }
    } catch (err) {
      console.error(`KV cache read error for ${cacheKey}:`, err);
    }
  }
  
  // 3. Fetch fresh data
  const data = await fetchFn();
  inMemoryCache[cacheKey] = { data, timestamp: now };
  
  // 4. Store in KV for future requests
  if (env?.KV_CACHE) {
    try {
      await env.KV_CACHE.put(cacheKey, JSON.stringify(data), {
        expirationTtl: Math.floor(ttl / 1000),
      });
    } catch (err) {
      console.error(`KV cache write error for ${cacheKey}:`, err);
    }
  }
  
  return data;
}

async function getKVPrxList(kvPrxUrl = KV_PRX_URL, env) {
  if (!kvPrxUrl) {
    throw new Error("No URL Provided!");
  }

  return getCachedData(
    "kvPrxList",
    async () => {
      const kvPrx = await fetch(kvPrxUrl);
      if (kvPrx.status === 200) {
        return await kvPrx.json();
      }
      return {};
    },
    CACHE_TTL,
    env
  );
}

async function getPrxListPaginated(prxBankUrl = PRX_BANK_URL, options = {}, env) {
  if (!prxBankUrl) {
    throw new Error("No URL Provided!");
  }

  const {
    offset = 0,
    limit = MAX_CONFIGS_PER_REQUEST,
    filterCC = [],
  } = options;

  const prxList = await getCachedData(
    "prxList",
    async () => {
      const prxBank = await fetch(prxBankUrl);
      if (prxBank.status === 200) {
        const text = (await prxBank.text()) || "";
        const prxString = text.split("\n").filter(Boolean);
        
        return prxString
          .map((entry) => {
            const [prxIP, prxPort, country, org] = entry.split(",");
            return {
              prxIP: prxIP || "Unknown",
              prxPort: prxPort || "Unknown",
              country: country || "Unknown",
              org: org || "Unknown Org",
            };
          })
          .filter(Boolean);
      }
      return [];
    },
    CACHE_TTL,
    env
  );

  return paginateArray(prxList, offset, limit, filterCC);
}

function paginateArray(array, offset, limit, filterCC) {
  let filtered = array;
  
  // Apply country filter
  if (filterCC.length > 0) {
    filtered = array.filter((prx) => filterCC.includes(prx.country));
  }
  
  // Shuffle for randomization
  shuffleArray(filtered);
  
  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);
  
  return {
    data: paginated,
    pagination: {
      offset,
      limit,
      total,
      hasMore: (offset + limit) < total,
      nextOffset: (offset + limit) < total ? offset + limit : null,
    },
  };
}

async function reverseWeb(request, target, targetPath) {
  const targetUrl = new URL(request.url);
  const targetChunk = target.split(":");

  targetUrl.hostname = targetChunk[0];
  targetUrl.port = targetChunk[1]?.toString() || "443";
  targetUrl.pathname = targetPath || targetUrl.pathname;

  const modifiedRequest = new Request(targetUrl, request);
  modifiedRequest.headers.set("X-Forwarded-Host", request.headers.get("Host"));

  const response = await fetch(modifiedRequest);
  const newResponse = new Response(response.body, response);
  
  for (const [key, value] of Object.entries(CORS_HEADER_OPTIONS)) {
    newResponse.headers.set(key, value);
  }
  newResponse.headers.set("X-Proxied-By", "Cloudflare Worker");

  return newResponse;
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

// OPTIMIZATION 11: Streaming response generator
async function* generateConfigsStream(prxList, filterPort, filterVPN, filterLimit, fillerDomain, uuid, ssUsername) {
  let configCount = 0;
  
  // Create base URL once
  const baseUri = new URL(`${PROTOCOL_HORSE}://${fillerDomain}`);
  baseUri.searchParams.set("encryption", "none");
  baseUri.searchParams.set("type", "ws");
  baseUri.searchParams.set("host", APP_DOMAIN);
  
  for (const prx of prxList) {
    if (configCount >= filterLimit) break;
    
    const proxyPath = `/${prx.prxIP}-${prx.prxPort}`;

    for (const port of filterPort) {
      if (configCount >= filterLimit) break;
      
      const isTLS = port === 443;
      const security = isTLS ? "tls" : "none";
      const tlsLabel = isTLS ? "TLS" : "NTLS";
      
      for (const protocol of filterVPN) {
        if (configCount >= filterLimit) break;

        baseUri.protocol = protocol;
        baseUri.port = port.toString();
        baseUri.searchParams.set("security", security);
        baseUri.searchParams.set("path", proxyPath);
        
        if (protocol === "ss") {
          baseUri.username = ssUsername;
          baseUri.searchParams.set(
            "plugin",
            `${PROTOCOL_V2}-plugin${isTLS ? ";tls" : ""};mux=0;mode=websocket;path=${proxyPath};host=${APP_DOMAIN}`
          );
        } else {
          baseUri.username = uuid;
          baseUri.searchParams.delete("plugin");
        }

        baseUri.searchParams.set("sni", (port === 80 && protocol === PROTOCOL_FLASH) ? "" : APP_DOMAIN);
        baseUri.hash = `${configCount + 1} ${getFlagEmojiCached(prx.country)} ${prx.org} WS ${tlsLabel} [${serviceName}]`;
        
        // Yield each config as it's generated
        yield baseUri.toString();
        configCount++;
      }
    }
  }
}

function createStreamingResponse(asyncGenerator, responseHeaders, filterFormat) {
  const encoder = new TextEncoder();
  let isFirst = true;
  
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const config of asyncGenerator) {
          // Add newline separator (except for first item)
          const line = isFirst ? config : `\n${config}`;
          isFirst = false;
          
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  
  return new Response(stream, {
    status: 200,
    headers: responseHeaders,
  });
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      APP_DOMAIN = url.hostname;
      serviceName = APP_DOMAIN.split(".")[0];

      const upgradeHeader = request.headers.get("Upgrade");

      // Handle prx client
      if (upgradeHeader === "websocket") {
        const prxMatch = url.pathname.match(/^\/(.+[:=-]\d+)$/);

        if (url.pathname.length == 3 || url.pathname.match(",")) {
          const prxKeys = url.pathname.replace("/", "").toUpperCase().split(",");
          const prxKey = prxKeys[Math.floor(Math.random() * prxKeys.length)];
          const kvPrx = await getKVPrxList(KV_PRX_URL, env);

          prxIP = kvPrx[prxKey][Math.floor(Math.random() * kvPrx[prxKey].length)];
          return await websocketHandler(request);
        } else if (prxMatch) {
          prxIP = prxMatch[1];
          return await websocketHandler(request);
        }
      }

      if (url.pathname.startsWith("/sub")) {
        return Response.redirect(SUB_PAGE_URL + `?host=${APP_DOMAIN}`, 301);
      } else if (url.pathname.startsWith("/check")) {
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
      } else if (url.pathname.startsWith("/api/v1")) {
        const apiPath = url.pathname.replace("/api/v1", "");

        if (apiPath.startsWith("/sub")) {
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
            const fillerDomain = url.searchParams.get("domain") || APP_DOMAIN;

            const prxBankUrl = url.searchParams.get("prx-list") || env.PRX_BANK_URL || PRX_BANK_URL;
            
            const { data: prxList, pagination } = await getPrxListPaginated(
              prxBankUrl,
              { offset, limit: filterLimit, filterCC },
              env
            );

            const uuid = crypto.randomUUID();
            const ssUsername = btoa(`none:${uuid}`);
            
            const responseHeaders = {
              ...CORS_HEADER_OPTIONS,
              "X-Pagination-Offset": offset.toString(),
              "X-Pagination-Limit": filterLimit.toString(),
              "X-Pagination-Total": pagination.total.toString(),
              "X-Pagination-Has-More": pagination.hasMore.toString(),
            };

            if (pagination.nextOffset !== null) {
              responseHeaders["X-Pagination-Next-Offset"] = pagination.nextOffset.toString();
            }

            // OPTIMIZATION 11: Use streaming for raw and v2ray formats
            if (filterFormat === "raw") {
              responseHeaders["Content-Type"] = "text/plain; charset=utf-8";
              responseHeaders["Cache-Control"] = "public, max-age=1800, s-maxage=3600";
              
              const configStream = generateConfigsStream(
                prxList, filterPort, filterVPN, filterLimit, 
                fillerDomain, uuid, ssUsername
              );
              
              return createStreamingResponse(configStream, responseHeaders, filterFormat);
              
            } else if (filterFormat === PROTOCOL_V2) {
              // For v2ray, we need to collect all configs first (base64 encoding requirement)
              const result = [];
              const configStream = generateConfigsStream(
                prxList, filterPort, filterVPN, filterLimit,
                fillerDomain, uuid, ssUsername
              );
              
              for await (const config of configStream) {
                result.push(config);
              }
              
              const finalResult = btoa(result.join("\n"));
              responseHeaders["Content-Type"] = "text/plain; charset=utf-8";
              responseHeaders["Cache-Control"] = "public, max-age=1800, s-maxage=3600";
              
              return new Response(finalResult, {
                status: 200,
                headers: responseHeaders,
              });
              
            } else if ([PROTOCOL_NEKO, "sfa", "bfr"].includes(filterFormat)) {
              // For converter formats, collect configs first
              const result = [];
              const configStream = generateConfigsStream(
                prxList, filterPort, filterVPN, filterLimit,
                fillerDomain, uuid, ssUsername
              );
              
              for await (const config of configStream) {
                result.push(config);
              }
              
              const converterPromise = fetch(CONVERTER_URL, {
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
                responseHeaders["Cache-Control"] = "public, max-age=1800, s-maxage=3600";
                
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

async function websocketHandler(request) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);

  webSocket.accept();

  let addressLog = "";
  let portLog = "";
  const log = (info, event) => {
    console.log(`[${addressLog}:${portLog}] ${info}`, event || "");
  };
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";

  const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

  let remoteSocketWrapper = {
    value: null,
  };
  let isDNS = false;

  readableWebSocketStream
    .pipeTo(
      new WritableStream({
        async write(chunk, controller) {
          if (isDNS) {
            return handleUDPOutbound(
              DNS_SERVER_ADDRESS,
              DNS_SERVER_PORT,
              chunk,
              webSocket,
              null,
              log,
              RELAY_SERVER_UDP
            );
          }
          if (remoteSocketWrapper.value) {
            const writer = remoteSocketWrapper.value.writable.getWriter();
            await writer.write(chunk);
            writer.releaseLock();
            return;
          }

          const protocol = protocolSniffer(chunk);
          let protocolHeader;

          if (protocol === PROTOCOL_HORSE) {
            protocolHeader = readHorseHeader(chunk);
          } else if (protocol === PROTOCOL_FLASH) {
            protocolHeader = readFlashHeader(chunk);
          } else if (protocol === "ss") {
            protocolHeader = readSsHeader(chunk);
          } else {
            throw new Error("Unknown Protocol!");
          }

          addressLog = protocolHeader.addressRemote;
          portLog = `${protocolHeader.portRemote} -> ${protocolHeader.isUDP ? "UDP" : "TCP"}`;

          if (protocolHeader.hasError) {
            throw new Error(protocolHeader.message);
          }

          if (protocolHeader.isUDP) {
            if (protocolHeader.portRemote === 53) {
              isDNS = true;
              return handleUDPOutbound(
                DNS_SERVER_ADDRESS,
                DNS_SERVER_PORT,
                chunk,
                webSocket,
                protocolHeader.version,
                log,
                RELAY_SERVER_UDP
              );
            }

            return handleUDPOutbound(
              protocolHeader.addressRemote,
              protocolHeader.portRemote,
              chunk,
              webSocket,
              protocolHeader.version,
              log,
              RELAY_SERVER_UDP
            );
          }

          handleTCPOutBound(
            remoteSocketWrapper,
            protocolHeader.addressRemote,
            protocolHeader.portRemote,
            protocolHeader.rawClientData,
            webSocket,
            protocolHeader.version,
            log
          );
        },
        close() {
          log(`readableWebSocketStream is close`);
        },
        abort(reason) {
          log(`readableWebSocketStream is abort`, JSON.stringify(reason));
        },
      })
    )
    .catch((err) => {
      log("readableWebSocketStream pipeTo error", err);
    });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

function protocolSniffer(buffer) {
  if (buffer.byteLength >= 62) {
    const horseDelimiter = new Uint8Array(buffer.slice(56, 60));
    if (horseDelimiter[0] === 0x0d && horseDelimiter[1] === 0x0a) {
      if (horseDelimiter[2] === 0x01 || horseDelimiter[2] === 0x03 || horseDelimiter[2] === 0x7f) {
        if (horseDelimiter[3] === 0x01 || horseDelimiter[3] === 0x03 || horseDelimiter[3] === 0x04) {
          return PROTOCOL_HORSE;
        }
      }
    }
  }

  const flashDelimiter = new Uint8Array(buffer.slice(1, 17));
  if (UUID_V4_REGEX.test(arrayBufferToHex(flashDelimiter))) {
    return PROTOCOL_FLASH;
  }

  return "ss";
}

// OPTIMIZATION 14: Enhanced handleTCPOutBound with adaptive timeout
async function handleTCPOutBound(
  remoteSocket,
  addressRemote,
  portRemote,
  rawClientData,
  webSocket,
  responseHeader,
  log
) {
  async function connectAndWrite(address, port, usePool = true) {
    // Try to get pooled connection first
    if (usePool) {
      const pooled = await getPooledConnection(address, port, log);
      if (pooled) {
        remoteSocket.value = pooled;
        const writer = pooled.writable.getWriter();
        await writer.write(rawClientData);
        writer.releaseLock();
        return pooled;
      }
    }
    
    // OPTIMIZATION 14: Calculate adaptive timeout
    const adaptiveTimeout = calculateAdaptiveTimeout(address, port, log);
    const connectStart = Date.now();
    
    // Create new connection
    const connectPromise = new Promise(async (resolve, reject) => {
      try {
        const tcpSocket = connect({
          hostname: address,
          port: port,
        });
        remoteSocket.value = tcpSocket;
        
        const connectTime = Date.now() - connectStart;
        
        // OPTIMIZATION 14: Record latency for future adaptive calculations
        recordLatency(address, port, connectTime);
        
        if (connectTime > adaptiveTimeout * 0.8) {
          timeoutStats.slowSuccess++;
          log(`Slow but successful connect: ${address}:${port} (${connectTime}ms)`);
        }
        
        log(`connected to ${address}:${port} in ${connectTime}ms`);
        const writer = tcpSocket.writable.getWriter();
        await writer.write(rawClientData);
        writer.releaseLock();
        resolve(tcpSocket);
      } catch (err) {
        reject(err);
      }
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => {
        timeoutStats.fastFail++;
        reject(new Error(`Connection timeout (${adaptiveTimeout}ms)`));
      }, adaptiveTimeout)
    );

    return Promise.race([connectPromise, timeoutPromise]);
  }

  async function retry() {
    try {
      const tcpSocket = await connectAndWrite(
        prxIP.split(/[:=-]/)[0] || addressRemote,
        prxIP.split(/[:=-]/)[1] || portRemote,
        false // Don't use pool on retry
      );
      tcpSocket.closed
        .catch((error) => {
          console.log("retry tcpSocket closed error", error);
        })
        .finally(() => {
          safeCloseWebSocket(webSocket);
        });
      remoteSocketToWS(tcpSocket, webSocket, responseHeader, null, log);
    } catch (err) {
      log("Retry failed", err.message);
      safeCloseWebSocket(webSocket);
    }
  }

  try {
    const tcpSocket = await connectAndWrite(addressRemote, portRemote);
    remoteSocketToWS(tcpSocket, webSocket, responseHeader, retry, log, addressRemote, portRemote);
  } catch (err) {
    log("TCP connection failed", err.message);
    safeCloseWebSocket(webSocket);
  }
  
  // OPTIMIZATION 14: Periodic cleanup
  cleanupLatencyTracker();
}

// OPTIMIZATION 13: Enhanced handleUDPOutbound with buffer management
async function handleUDPOutbound(targetAddress, targetPort, dataChunk, webSocket, responseHeader, log, relay) {
  try {
    let protocolHeader = responseHeader;

    const connectPromise = new Promise(async (resolve, reject) => {
      try {
        const tcpSocket = connect({
          hostname: relay.host,
          port: relay.port,
        });

        const header = `udp:${targetAddress}:${targetPort}`;
        const headerBuffer = TEXT_ENCODER.encode(header);
        const separator = new Uint8Array([0x7c]);
        const relayMessage = new Uint8Array(headerBuffer.length + separator.length + dataChunk.byteLength);
        relayMessage.set(headerBuffer, 0);
        relayMessage.set(separator, headerBuffer.length);
        relayMessage.set(new Uint8Array(dataChunk), headerBuffer.length + separator.length);

        const writer = tcpSocket.writable.getWriter();
        await writer.write(relayMessage);
        writer.releaseLock();

        resolve(tcpSocket);
      } catch (err) {
        reject(err);
      }
    });

    // OPTIMIZATION 14: Use adaptive timeout for UDP relay
    const adaptiveTimeout = calculateAdaptiveTimeout(relay.host, relay.port, log);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`UDP relay timeout (${adaptiveTimeout}ms)`)), adaptiveTimeout)
    );

    const tcpSocket = await Promise.race([connectPromise, timeoutPromise]);

    await tcpSocket.readable.pipeTo(
      new WritableStream({
        async write(chunk) {
          if (webSocket.readyState === WS_READY_STATE_OPEN) {
            // OPTIMIZATION 13: Check buffer before sending
            while (webSocket.bufferedAmount > BUFFER_HIGH_WATERMARK) {
              await new Promise(resolve => setTimeout(resolve, 10));
              if (webSocket.readyState !== WS_READY_STATE_OPEN) {
                return;
              }
            }
            
            if (protocolHeader) {
              webSocket.send(await new Blob([protocolHeader, chunk]).arrayBuffer());
              protocolHeader = null;
            } else {
              webSocket.send(chunk);
            }
          }
        },
        close() {
          log(`UDP connection to ${targetAddress} closed`);
        },
        abort(reason) {
          console.error(`UDP connection aborted due to ${reason}`);
        },
      })
    );
  } catch (e) {
    console.error(`Error while handling UDP outbound: ${e.message}`);
    safeCloseWebSocket(webSocket);
  }
}

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
  let readableStreamCancel = false;
  const stream = new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener("message", (event) => {
        if (readableStreamCancel) {
          return;
        }
        const message = event.data;
        controller.enqueue(message);
      });
      webSocketServer.addEventListener("close", () => {
        safeCloseWebSocket(webSocketServer);
        if (readableStreamCancel) {
          return;
        }
        controller.close();
      });
      webSocketServer.addEventListener("error", (err) => {
        log("webSocketServer has error");
        controller.error(err);
      });
      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) {
        controller.error(error);
      } else if (earlyData) {
        controller.enqueue(earlyData);
      }
    },

    pull(controller) {},
    cancel(reason) {
      if (readableStreamCancel) {
        return;
      }
      log(`ReadableStream was canceled, due to ${reason}`);
      readableStreamCancel = true;
      safeCloseWebSocket(webSocketServer);
    },
  });

  return stream;
}

function readSsHeader(ssBuffer) {
  const view = new DataView(ssBuffer);

  const addressType = view.getUint8(0);
  let addressLength = 0;
  let addressValueIndex = 1;
  let addressValue = "";

  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 3:
      addressLength = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = TEXT_DECODER.decode(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 4:
      addressLength = 16;
      const dataView = new DataView(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `Invalid addressType for SS: ${addressType}`,
      };
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `Destination address empty, address type is: ${addressType}`,
    };
  }

  const portIndex = addressValueIndex + addressLength;
  const portBuffer = ssBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: portIndex + 2,
    rawClientData: ssBuffer.slice(portIndex + 2),
    version: null,
    isUDP: portRemote == 53,
  };
}

function readFlashHeader(buffer) {
  const version = new Uint8Array(buffer.slice(0, 1));
  let isUDP = false;

  const optLength = new Uint8Array(buffer.slice(17, 18))[0];

  const cmd = new Uint8Array(buffer.slice(18 + optLength, 18 + optLength + 1))[0];
  if (cmd === 1) {
  } else if (cmd === 2) {
    isUDP = true;
  } else {
    return {
      hasError: true,
      message: `command ${cmd} is not supported`,
    };
  }
  const portIndex = 18 + optLength + 1;
  const portBuffer = buffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);

  let addressIndex = portIndex + 2;
  const addressBuffer = new Uint8Array(buffer.slice(addressIndex, addressIndex + 1));

  const addressType = addressBuffer[0];
  let addressLength = 0;
  let addressValueIndex = addressIndex + 1;
  let addressValue = "";
  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 2:
      addressLength = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = TEXT_DECODER.decode(buffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 3:
      addressLength = 16;
      const dataView = new DataView(buffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `invild  addressType is ${addressType}`,
      };
  }
  if (!addressValue) {
    return {
      hasError: true,
      message: `addressValue is empty, addressType is ${addressType}`,
    };
  }

  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: addressValueIndex + addressLength,
    rawClientData: buffer.slice(addressValueIndex + addressLength),
    version: new Uint8Array([version[0], 0]),
    isUDP: isUDP,
  };
}

function readHorseHeader(buffer) {
  const dataBuffer = buffer.slice(58);
  if (dataBuffer.byteLength < 6) {
    return {
      hasError: true,
      message: "invalid request data",
    };
  }

  let isUDP = false;
  const view = new DataView(dataBuffer);
  const cmd = view.getUint8(0);
  if (cmd == 3) {
    isUDP = true;
  } else if (cmd != 1) {
    throw new Error("Unsupported command type!");
  }

  let addressType = view.getUint8(1);
  let addressLength = 0;
  let addressValueIndex = 2;
  let addressValue = "";
  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 3:
      addressLength = new Uint8Array(dataBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = TEXT_DECODER.decode(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 4:
      addressLength = 16;
      const dataView = new DataView(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `invalid addressType is ${addressType}`,
      };
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `address is empty, addressType is ${addressType}`,
    };
  }

  const portIndex = addressValueIndex + addressLength;
  const portBuffer = dataBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: portIndex + 4,
    rawClientData: dataBuffer.slice(portIndex + 4),
    version: null,
    isUDP: isUDP,
  };
}

// OPTIMIZATION 13: Enhanced remoteSocketToWS with adaptive buffer management
async function remoteSocketToWS(remoteSocket, webSocket, responseHeader, retry, log, targetAddress, targetPort) {
  let header = responseHeader;
  let hasIncomingData = false;
  let shouldReturnToPool = true;
  let bytesTransferred = 0;
  const bufferQueue = [];
  let isPaused = false;
  
  // OPTIMIZATION 14: Use adaptive timeout for socket reads
  const adaptiveTimeout = targetAddress ? calculateAdaptiveTimeout(targetAddress, targetPort, log) : TIMEOUT_DEFAULT;
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Socket read timeout (${adaptiveTimeout}ms)`)), adaptiveTimeout)
  );

  // OPTIMIZATION 13: Flush buffer queue with backpressure handling
  const flushBuffer = async () => {
    while (bufferQueue.length > 0 && !isPaused) {
      if (webSocket.readyState !== WS_READY_STATE_OPEN) {
        bufferQueue.length = 0; // Clear queue
        return;
      }
      
      // Check for backpressure
      if (webSocket.bufferedAmount > BUFFER_HIGH_WATERMARK) {
        isPaused = true;
        // Wait for buffer to drain
        while (webSocket.bufferedAmount > BUFFER_LOW_WATERMARK) {
          await new Promise(resolve => setTimeout(resolve, 10));
          if (webSocket.readyState !== WS_READY_STATE_OPEN) {
            return;
          }
        }
        isPaused = false;
      }
      
      const chunk = bufferQueue.shift();
      if (chunk) {
        try {
          webSocket.send(chunk);
          bytesTransferred += chunk.byteLength || chunk.length;
        } catch (e) {
          log('Send error', e);
          bufferQueue.length = 0;
          return;
        }
      }
    }
  };

  try {
    await Promise.race([
      remoteSocket.readable.pipeTo(
        new WritableStream({
          start() {},
          async write(chunk, controller) {
            hasIncomingData = true;
            if (webSocket.readyState !== WS_READY_STATE_OPEN) {
              controller.error("webSocket.readyState is not open, maybe close");
            }
            
            let dataToSend = chunk;
            if (header) {
              dataToSend = await new Blob([header, chunk]).arrayBuffer();
              header = null;
            }
            
            // OPTIMIZATION 13: Queue with limit check
            if (bufferQueue.length >= MAX_QUEUE_SIZE) {
              log(`Queue overflow, dropping old chunks`);
              bufferQueue.shift(); // Drop oldest
            }
            
            bufferQueue.push(dataToSend);
            await flushBuffer();
          },
          close() {
            log(`remoteConnection closed. Transferred: ${(bytesTransferred/1024/1024).toFixed(2)}MB`);
            
            // Flush remaining buffer
            flushBuffer().then(() => {
              // Return connection to pool if it's still healthy
              if (hasIncomingData && targetAddress && targetPort && !remoteSocket.closed) {
                returnToPool(remoteSocket, targetAddress, targetPort, log);
                shouldReturnToPool = false;
              }
            }).catch(() => {});
          },
          abort(reason) {
            console.error(`remoteConnection abort`, reason);
            bufferQueue.length = 0;
            shouldReturnToPool = false;
          },
        }),
        {
          highWaterMark: 4,
          size: chunk => chunk.byteLength || chunk.length
        }
      ),
      timeoutPromise,
    ]);
    
    // Final flush
    await flushBuffer();
    
  } catch (error) {
    console.error(`remoteSocketToWS exception`, error.stack || error);
    shouldReturnToPool = false;
    bufferQueue.length = 0;
    safeCloseWebSocket(webSocket);
  }

  // Cleanup if not pooled
  if (shouldReturnToPool === false && remoteSocket && !remoteSocket.closed) {
    try {
      remoteSocket.close();
    } catch (e) {
      // Silent fail
    }
  }

  if (hasIncomingData === false && retry) {
    log(`retry`);
    retry();
  }
}

function safeCloseWebSocket(socket) {
  try {
    if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
      socket.close();
    }
  } catch (error) {
    console.error("safeCloseWebSocket error", error);
  }
}

async function checkPrxHealth(prxIP, prxPort) {
  const req = await fetch(`${PRX_HEALTH_CHECK_API}?ip=${prxIP}:${prxPort}`);
  return await req.json();
}

// Helpers
function base64ToArrayBuffer(base64Str) {
  if (!base64Str) {
    return { error: null };
  }
  try {
    base64Str = base64Str.replace(/-/g, "+").replace(/_/g, "/");
    const decode = atob(base64Str);
    const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
    return { earlyData: arryBuffer.buffer, error: null };
  } catch (error) {
    return { error };
  }
}

function arrayBufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function shuffleArray(array) {
  let currentIndex = array.length;
  while (currentIndex != 0) {
    let randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
}

function getFlagEmoji(isoCode) {
  const codePoints = isoCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

function getFlagEmojiCached(isoCode) {
  if (!FLAG_EMOJI_CACHE.has(isoCode)) {
    FLAG_EMOJI_CACHE.set(isoCode, getFlagEmoji(isoCode));
  }
  return FLAG_EMOJI_CACHE.get(isoCode);
}