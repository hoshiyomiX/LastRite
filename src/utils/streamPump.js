import { 
  WS_READY_STATE_OPEN, 
  WS_READY_STATE_CLOSING,
  BUFFER_HIGH_WATERMARK,
  BUFFER_LOW_WATERMARK,
  MAX_QUEUE_SIZE,
  THRESHOLD_MEDIUM,
  THRESHOLD_BULK,
  WATERMARK_INTERACTIVE,
  WATERMARK_BALANCED,
  WATERMARK_BULK,
  COALESCE_THRESHOLD,
  COALESCE_MAX_SIZE,
  COALESCE_TIMEOUT
} from '../config/constants.js';
import { bufferStats, batchStats } from '../core/state.js';
import { returnToPool } from './network.js';

export function safeCloseWebSocket(socket) {
  try {
    if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
      socket.close();
    }
  } catch (error) {
    console.error("safeCloseWebSocket error", error);
  }
}

// OPTIMIZATION 15 Phase 2: Intelligent chunk batching with adaptive watermark
// OPTIMIZATION 13: Enhanced remoteSocketToWS with adaptive buffer management
export async function remoteSocketToWS(remoteSocket, webSocket, responseHeader, retry, log, targetAddress, targetPort) {
  let header = responseHeader;
  let hasIncomingData = false;
  let shouldReturnToPool = true;
  let bytesTransferred = 0;
  const bufferQueue = [];
  let isPaused = false;
  let batchBuffer = [];
  let batchSize = 0;
  let batchTimeout = null;
  
  // FIX: Removed incorrect timeout race condition that was killing long-lived streams
  // The connection timeout is already handled in tcp.js during handshake.
  // We do not want to hard-limit the duration of an active stream.

  // OPTIMIZATION 15 Phase 2: Smart batch flush
  const flushBatch = async () => {
    if (batchBuffer.length === 0) return;
    
    // Clear pending timeout
    if (batchTimeout) {
      clearTimeout(batchTimeout);
      batchTimeout = null;
    }
    
    let combined;
    if (batchBuffer.length === 1) {
      // Single chunk, no need to combine
      combined = batchBuffer[0];
      batchStats.unbatched++;
    } else {
      // Combine multiple chunks
      const totalSize = batchBuffer.reduce((sum, chunk) => sum + (chunk.byteLength || chunk.length), 0);
      combined = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of batchBuffer) {
        const arr = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk;
        combined.set(arr, offset);
        offset += arr.length;
      }
      batchStats.batched++;
      batchStats.totalBatchSavings += batchBuffer.length - 1;
    }
    
    bufferQueue.push(combined);
    bufferStats.totalQueued++;
    bufferStats.maxQueueDepth = Math.max(bufferStats.maxQueueDepth, bufferQueue.length);
    
    batchBuffer = [];
    batchSize = 0;
  };

  // OPTIMIZATION 13: Flush buffer queue with backpressure handling
  const flushBuffer = async () => {
    // First flush any pending batch
    await flushBatch();
    
    while (bufferQueue.length > 0 && !isPaused) {
      if (webSocket.readyState !== WS_READY_STATE_OPEN) {
        bufferQueue.length = 0;
        return;
      }
      
      // Check for backpressure
      if (webSocket.bufferedAmount > BUFFER_HIGH_WATERMARK) {
        bufferStats.backpressureEvents++;
        isPaused = true;
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
          if(log) log('Send error', e);
          bufferQueue.length = 0;
          return;
        }
      }
    }
  };

  try {
    // FIX: Directly await the pipe operation without racing against a timeout
    await remoteSocket.readable.pipeTo(
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
            bufferStats.queueOverflows++;
            if(log) log(`Queue overflow, dropping old chunks`);
            bufferQueue.shift();
          }
          
          // OPTIMIZATION 15 Phase 2: Decide whether to batch or send immediately
          const chunkSize = dataToSend.byteLength || dataToSend.length;
          const isInteractive = bytesTransferred < THRESHOLD_MEDIUM;
          const shouldBatch = !isInteractive && chunkSize < COALESCE_THRESHOLD;
          
          if (shouldBatch) {
            // Add to batch
            batchBuffer.push(dataToSend);
            batchSize += chunkSize;
            
            // Flush batch if:
            // 1. Batch size exceeds max
            // 2. Set timeout for time-based flush (if not already set)
            if (batchSize >= COALESCE_MAX_SIZE) {
              await flushBatch();
            } else if (!batchTimeout) {
              batchTimeout = setTimeout(async () => {
                await flushBatch();
                await flushBuffer();
              }, COALESCE_TIMEOUT);
            }
          } else {
            // Large chunk or interactive mode: flush batch first, then send immediately
            await flushBatch();
            bufferQueue.push(dataToSend);
            bufferStats.totalQueued++;
            bufferStats.maxQueueDepth = Math.max(bufferStats.maxQueueDepth, bufferQueue.length);
          }
          
          await flushBuffer();
        },
        close() {
          if(log) log(`remoteConnection closed. Transferred: ${(bytesTransferred/1024/1024).toFixed(2)}MB`);
          
          // Flush any remaining data
          flushBatch().then(() => flushBuffer()).then(() => {
            // Return connection to pool if it's still healthy
            if (hasIncomingData && targetAddress && targetPort && !remoteSocket.closed) {
              returnToPool(remoteSocket, targetAddress, targetPort, log);
              shouldReturnToPool = false;
            }
          }).catch(() => {});
        },
        abort(reason) {
          console.error(`remoteConnection abort`, reason);
          if (batchTimeout) clearTimeout(batchTimeout);
          batchBuffer = [];
          bufferQueue.length = 0;
          shouldReturnToPool = false;
        },
      }),
      {
        // OPTIMIZATION 15 Phase 1: Adaptive watermark based on transfer size
        highWaterMark: bytesTransferred > THRESHOLD_BULK ? WATERMARK_BULK :
                       bytesTransferred > THRESHOLD_MEDIUM ? WATERMARK_BALANCED :
                       WATERMARK_INTERACTIVE,
        size: chunk => chunk.byteLength || chunk.length
      }
    );
    
    // Final flush
    await flushBatch();
    await flushBuffer();
    
  } catch (error) {
    console.error(`remoteSocketToWS exception`, error.stack || error);
    if (batchTimeout) clearTimeout(batchTimeout);
    shouldReturnToPool = false;
    batchBuffer = [];
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
    if(log) log(`retry`);
    retry();
  }
}
