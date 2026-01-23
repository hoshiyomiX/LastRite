import { connect } from "cloudflare:sockets";
import { retryStats, timeoutStats } from '../core/state.js';
import { RETRY_MAX_ATTEMPTS } from '../config/constants.js';
import { 
  getPooledConnection, 
  calculateAdaptiveTimeout, 
  recordLatency, 
  cleanupLatencyTracker, 
  calculateBackoff 
} from '../utils/network.js';
import { sleep } from '../utils/helpers.js';
import { remoteSocketToWS, safeCloseWebSocket } from '../utils/streamPump.js';

// OPTIMIZATION 14 & 16: Enhanced handleTCPOutBound with adaptive timeout and smart retry
export async function handleTCPOutBound(
  remoteSocket,
  addressRemote,
  portRemote,
  rawClientData,
  webSocket,
  responseHeader,
  log,
  prxIP // passed from context
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
          if(log) log(`Slow but successful connect: ${address}:${port} (${connectTime}ms)`);
        }
        
        if(log) log(`connected to ${address}:${port} in ${connectTime}ms`);
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

  // OPTIMIZATION 16: Smart retry with exponential backoff
  async function retryWithBackoff(attempt = 0) {
    if (attempt >= RETRY_MAX_ATTEMPTS) {
      retryStats.failures++;
      if(log) log(`Max retry attempts (${RETRY_MAX_ATTEMPTS}) exceeded`);
      safeCloseWebSocket(webSocket);
      return;
    }
    
    // Calculate backoff delay
    const delay = calculateBackoff(attempt);
    retryStats.attempts++;
    retryStats.totalDelay += delay;
    
    if(log) log(`Retry attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS} after ${delay}ms backoff`);
    
    // Wait with exponential backoff + jitter
    await sleep(delay);
    
    try {
      const tcpSocket = await connectAndWrite(
        (prxIP && prxIP.split(/[:=-]/)[0]) || addressRemote,
        (prxIP && prxIP.split(/[:=-]/)[1]) || portRemote,
        false // Don't use pool on retry
      );
      
      retryStats.successes++;
      if(log) log(`Retry succeeded on attempt ${attempt + 1}`);
      
      tcpSocket.closed
        .catch((error) => {
          console.log("retry tcpSocket closed error", error);
        })
        .finally(() => {
          safeCloseWebSocket(webSocket);
        });
      remoteSocketToWS(tcpSocket, webSocket, responseHeader, null, log, addressRemote, portRemote);
    } catch (err) {
      if(log) log(`Retry attempt ${attempt + 1} failed:`, err.message);
      // Recursive retry with incremented attempt
      await retryWithBackoff(attempt + 1);
    }
  }

  try {
    const tcpSocket = await connectAndWrite(addressRemote, portRemote);
    remoteSocketToWS(tcpSocket, webSocket, responseHeader, retryWithBackoff, log, addressRemote, portRemote);
  } catch (err) {
    if(log) log("TCP connection failed", err.message);
    // Start retry sequence
    await retryWithBackoff(0);
  }
  
  // OPTIMIZATION 14: Periodic cleanup
  cleanupLatencyTracker();
}
