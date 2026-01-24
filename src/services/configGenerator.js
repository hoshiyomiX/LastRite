import { streamingStats } from '../core/state.js';
import { getFlagEmojiCached } from '../utils/helpers.js';
import { PROTOCOL_HORSE, PROTOCOL_FLASH, PROTOCOL_V2 } from '../config/constants.js';

// OPTIMIZATION 11: Streaming response generator
// OPTIMIZATION 19: Use String Interpolation instead of URL objects for massive perf gain
export async function* generateConfigsStream(prxList, filterPort, filterVPN, filterLimit, fillerDomain, uuid, ssUsername, appDomain, serviceName) {
  let configCount = 0;
  
  // REMOVED LOGGING to prevent CPU time limit issues
  streamingStats.activeStreams++;
  streamingStats.totalStreamed++;
  
  // Pre-calculate common parts
  const isFlashEmptySNI = (port) => port === 80;

  // IMPORTANT: Ensure prxList is an array and has items
  if (!Array.isArray(prxList)) {
    return; // Exit stream if invalid data
  }

  for (const prx of prxList) {
    if (configCount >= filterLimit) break;
    
    // SAFE ACCESS: Check if properties exist
    const country = prx.country || "XX";
    const cleanOrg = prx.org || "Unknown";
    const proxyIP = prx.prxIP; // Ensure this field exists in your proxy provider object!
    const proxyPort = prx.prxPort;

    if (!proxyIP || !proxyPort) continue; // Skip invalid proxy objects

    // Cache emoji lookup
    const flagEmoji = getFlagEmojiCached(country);
    
    // Path MUST be constructed carefully
    const proxyPath = `/${proxyIP}-${proxyPort}`;
    const encodedProxyPath = encodeURIComponent(proxyPath);

    for (const port of filterPort) {
      if (configCount >= filterLimit) break;
      
      const isTLS = port === 443;
      const security = isTLS ? "tls" : "none";
      const tlsLabel = isTLS ? "TLS" : "NTLS";
      
      for (const protocol of filterVPN) {
        if (configCount >= filterLimit) break;
        
        // Base config name
        const hashName = encodeURIComponent(`${configCount + 1} ${flagEmoji} ${cleanOrg} WS ${tlsLabel} [${serviceName}]`);
        let configStr = "";

        if (protocol === "ss") {
          // Shadowsocks URL format: ss://base64(method:password)@server:port?plugin=...#name
          const pluginParam = encodeURIComponent(
            `${PROTOCOL_V2}-plugin${isTLS ? ";tls" : ""};mux=0;mode=websocket;path=${proxyPath};host=${appDomain}`
          );
          configStr = `${protocol}://${ssUsername}@${fillerDomain}:${port}?plugin=${pluginParam}#${hashName}`;
        } else {
          // Standard V2Ray/Trojan/Vmess URL format
          // protocol://uuid@host:port?params#name
          
          let params = `security=${security}&type=ws&host=${appDomain}&path=${encodedProxyPath}&encryption=none`;
          
          // SNI handling
          const sni = (port === 80 && protocol === PROTOCOL_FLASH) ? "" : appDomain;
          if (sni) {
            params += `&sni=${sni}`;
          }

          configStr = `${protocol}://${uuid}@${fillerDomain}:${port}?${params}#${hashName}`;
        }

        streamingStats.streamingBytes += configStr.length;
        
        // Yield each config as it's generated
        yield configStr;
        configCount++;
      }
    }
  }
  
  streamingStats.activeStreams--;
}

export function createStreamingResponse(asyncGenerator, responseHeaders) {
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
        // Safe stream closure on error
        try { controller.close(); } catch(e) {}
      }
    },
  });
  
  return new Response(stream, {
    status: 200,
    headers: responseHeaders,
  });
}
