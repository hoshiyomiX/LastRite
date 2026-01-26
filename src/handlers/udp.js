import { connect } from "cloudflare:sockets";
import { bufferStats } from '../core/state.js';
import { 
  BUFFER_HIGH_WATERMARK, 
  UDP_RELAY_TIMEOUT,
  WS_READY_STATE_OPEN
} from '../config/constants.js';
import { safeCloseWebSocket } from '../utils/streamPump.js';

const TEXT_ENCODER = new TextEncoder();

export async function handleUDPOutbound(targetAddress, targetPort, dataChunk, webSocket, responseHeader, log, relay) {
  try {
    const startTime = Date.now();
    let protocolHeader = responseHeader;
    
    // Log intent
    if(log) log(`UDP-Relay: Initiating connection to ${relay.host}:${relay.port} for target ${targetAddress}:${targetPort}`);

    const connectPromise = new Promise(async (resolve, reject) => {
      try {
        const tcpSocket = connect({
          hostname: relay.host,
          port: relay.port,
        });

        // Construct Relay Header: udp:IP:PORT|PAYLOAD
        const header = `udp:${targetAddress}:${targetPort}`;
        const headerBuffer = TEXT_ENCODER.encode(header);
        const separator = new Uint8Array([0x7c]); // "|" character
        
        // Combine buffers efficiently
        const relayMessage = new Uint8Array(headerBuffer.length + separator.length + dataChunk.byteLength);
        relayMessage.set(headerBuffer, 0);
        relayMessage.set(separator, headerBuffer.length);
        relayMessage.set(new Uint8Array(dataChunk), headerBuffer.length + separator.length);

        const writer = tcpSocket.writable.getWriter();
        await writer.write(relayMessage);
        writer.releaseLock();
        
        if(log) log(`UDP-Relay: Sent ${relayMessage.length} bytes to relay (Header: ${header})`);
        
        resolve(tcpSocket);
      } catch (err) {
        reject(err);
      }
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => {
        reject(new Error(`UDP relay timeout after ${UDP_RELAY_TIMEOUT}ms`));
      }, UDP_RELAY_TIMEOUT)
    );

    // Race connection vs timeout
    const tcpSocket = await Promise.race([connectPromise, timeoutPromise]);
    
    const connectTime = Date.now() - startTime;
    if(log) log(`UDP-Relay: Connected in ${connectTime}ms. Piping response...`);

    // Pipe response back to WebSocket
    await tcpSocket.readable.pipeTo(
      new WritableStream({
        async write(chunk) {
          const chunkTime = Date.now() - startTime;
          if(log) log(`UDP-Relay: Received ${chunk.byteLength} bytes response at +${chunkTime}ms`);
          
          if (webSocket.readyState === WS_READY_STATE_OPEN) {
            // Buffer pressure handling
            if (webSocket.bufferedAmount > BUFFER_HIGH_WATERMARK) {
               if(log) log(`UDP-Relay: WebSocket backpressure detected (${webSocket.bufferedAmount} bytes)`);
            }
            while (webSocket.bufferedAmount > BUFFER_HIGH_WATERMARK) {
              bufferStats.backpressureEvents++;
              await new Promise(resolve => setTimeout(resolve, 10));
              if (webSocket.readyState !== WS_READY_STATE_OPEN) {
                return;
              }
            }
            
            // Re-wrap in VLESS/Trojan header if needed
            if (protocolHeader) {
              webSocket.send(await new Blob([protocolHeader, chunk]).arrayBuffer());
              protocolHeader = null;
            } else {
              webSocket.send(chunk);
            }
          }
        },
        close() {
          if(log) log(`UDP-Relay: Connection closed by relay server.`);
        },
        abort(reason) {
          if(log) log(`UDP-Relay: Connection aborted by relay: ${reason}`);
        },
      })
    );
  } catch (e) {
    if(log) log(`UDP-Relay Error:`, {
      target: `${targetAddress}:${targetPort}`,
      error: e.message || e.toString(),
      timestamp: new Date().toISOString()
    });
    // Do NOT close the main websocket on UDP error, just this stream fails
    // safeCloseWebSocket(webSocket); 
  }
}
