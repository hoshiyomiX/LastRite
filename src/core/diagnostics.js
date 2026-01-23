import { 
  poolStats, 
  bufferStats, 
  timeoutStats, 
  retryStats, 
  batchStats, 
  coalesceStats, 
  streamingStats, 
  dnsStats, 
  dnsCache 
} from './state.js';

// PATCH 3: Helper to format stats as compact string
export function formatStats() {
  return {
    pool: `h=${poolStats.hits} m=${poolStats.misses} e=${poolStats.evictions}`,
    buffer: `bp=${bufferStats.backpressureEvents} qo=${bufferStats.queueOverflows} qd=${bufferStats.maxQueueDepth}`,
    timeout: `adp=${timeoutStats.adaptive} def=${timeoutStats.default} ff=${timeoutStats.fastFail} ss=${timeoutStats.slowSuccess}`,
    retry: `att=${retryStats.attempts} suc=${retryStats.successes} fail=${retryStats.failures}`,
    batch: `b=${batchStats.batched} ub=${batchStats.unbatched} sav=${batchStats.totalBatchSavings}`,
    dedup: `h=${coalesceStats.hits} m=${coalesceStats.misses} s=${coalesceStats.saved}`,
    streaming: `act=${streamingStats.activeStreams} tot=${streamingStats.totalStreamed} bytes=${(streamingStats.streamingBytes/1024).toFixed(0)}KB`,
    dns: `h=${dnsStats.hits} m=${dnsStats.misses} doh=${dnsStats.dohSuccess} cs=${dnsCache.size}`
  };
}
