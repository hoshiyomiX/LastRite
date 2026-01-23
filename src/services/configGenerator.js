import { streamingStats } from '../core/state.js';
import { getFlagEmojiCached } from '../utils/helpers.js';
import { PROTOCOL_HORSE, PROTOCOL_FLASH, PROTOCOL_V2 } from '../config/constants.js';

// OPTIMIZATION 11: Streaming response generator
export async function* generateConfigsStream(prxList, filterPort, filterVPN, filterLimit, fillerDomain, uuid, ssUsername, appDomain, serviceName) {
  let configCount = 0;
  
  console.log(`[Streaming] Starting config generation (OPT-11 active): ${prxList.length} proxies`);
  streamingStats.activeStreams++;
  streamingStats.totalStreamed++;
  
  // Create base URL once
  const baseUri = new URL(`${PROTOCOL_HORSE}://${fillerDomain}`);
  baseUri.searchParams.set("encryption", "none");
  baseUri.searchParams.set("type", "ws");
  baseUri.searchParams.set("host", appDomain);
  
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
            `${PROTOCOL_V2}-plugin${isTLS ? ";tls" : ""};mux=0;mode=websocket;path=${proxyPath};host=${appDomain}`
          );
        } else {
          baseUri.username = uuid;
          baseUri.searchParams.delete("plugin");
        }

        baseUri.searchParams.set("sni", (port === 80 && protocol === PROTOCOL_FLASH) ? "" : appDomain);
        baseUri.hash = `${configCount + 1} ${getFlagEmojiCached(prx.country)} ${prx.org} WS ${tlsLabel} [${serviceName}]`;
        
        const configStr = baseUri.toString();
        streamingStats.streamingBytes += configStr.length;
        
        // Yield each config as it's generated
        yield configStr;
        configCount++;
      }
    }
  }
  
  streamingStats.activeStreams--;
  console.log(`[Streaming] Completed: ${configCount} configs, ${(streamingStats.streamingBytes/1024).toFixed(2)}KB total`);
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
        controller.error(err);
      }
    },
  });
  
  return new Response(stream, {
    status: 200,
    headers: responseHeaders,
  });
}
