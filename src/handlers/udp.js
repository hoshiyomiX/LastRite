import { connect } from "cloudflare:sockets";
import { bufferStats } from '../core/state.js';
import { 
  BUFFER_HIGH_WATERMARK, 
  UDP_RELAY_TIMEOUT,
  WS_READY_STATE_OPEN
} from '../config/constants.js';
import { safeCloseWebSocket } from '../utils/streamPump.js';

const TEXT_ENCODER = new TextEncoder();

// OPTIMIZATION 13: Enhanced handleUDPOutbound with buffer management
export async function handleUDPOutbound(targetAddress, targetPort, dataChunk, webSocket, responseHeader, log, relay) {
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

    // Use fixed timeout for UDP relay (not adaptive)
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => {
        if(log) log(`UDP relay timeout after ${UDP_RELAY_TIMEOUT}ms`);
        reject(new Error(`UDP relay timeout`));
      }, UDP_RELAY_TIMEOUT)
    );

    const tcpSocket = await Promise.race([connectPromise, timeoutPromise]);

    await tcpSocket.readable.pipeTo(
      new WritableStream({
        async write(chunk) {
          if (webSocket.readyState === WS_READY_STATE_OPEN) {
            // OPTIMIZATION 13: Check buffer before sending
            while (webSocket.bufferedAmount > BUFFER_HIGH_WATERMARK) {
              bufferStats.backpressureEvents++;
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
          if(log) log(`UDP connection to ${targetAddress}:${targetPort} closed normally`);
        },
        abort(reason) {
          if(log) log(`UDP connection aborted:`, {
            target: `${targetAddress}:${targetPort}`,
            reason: reason?.message || reason?.toString() || 'Unknown',
            timestamp: new Date().toISOString()
          });
        },
      })
    );
  } catch (e) {
    if(log) log(`UDP outbound error:`, {
      target: `${targetAddress}:${targetPort}`,
      error: e.message || e.toString(),
      stack: e.stack,
      timestamp: new Date().toISOString()
    });
    safeCloseWebSocket(webSocket);
  }
}
