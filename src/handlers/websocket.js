import { 
  DNS_SERVER_ADDRESS, 
  DNS_SERVER_PORT, 
  RELAY_SERVER_UDP,
  PROTOCOL_HORSE,
  PROTOCOL_FLASH
} from '../config/constants.js';
import { protocolSniffer } from '../protocols/sniffer.js';
import { 
  readHorseHeader, 
  readFlashHeader, 
  readSsHeader 
} from '../protocols/parsers.js';
import { handleTCPOutBound } from './tcp.js';
import { handleUDPOutbound } from './udp.js';
import { safeCloseWebSocket } from '../utils/streamPump.js';
import { base64ToArrayBuffer, arrayBufferToHex } from '../utils/helpers.js';

export async function websocketHandler(request, prxIP) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);

  webSocket.accept();

  // DEBUG MODE ENABLED
  const log = (info, event) => {
    console.log(`[Aegir-Debug] ${info}`, event ? JSON.stringify(event) : "");
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
            console.error(`Unknown Protocol detected, closing connection`);
            safeCloseWebSocket(webSocket);
            return;
          }

          if (protocolHeader.hasError) {
             console.error(`Protocol Error: ${protocolHeader.message}`);
             safeCloseWebSocket(webSocket);
             return;
          }

          if (protocolHeader.isUDP) {
            if (protocolHeader.portRemote === 53) {
              isDNS = true;
              log(`UDP DNS Query detected -> ${DNS_SERVER_ADDRESS}:53`);
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

            log(`UDP Game/Traffic detected -> ${protocolHeader.addressRemote}:${protocolHeader.portRemote}`);
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
            log,
            prxIP 
          );
        },
        close() {
          log(`readableWebSocketStream is close`);
        },
        abort(reason) {
          log(`readableWebSocketStream is abort`, reason);
        },
      })
    )
    .catch((err) => {
      log("readableWebSocketStream pipeTo error", err.message);
    });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
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
        log("WebSocket error:", err.message);
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
