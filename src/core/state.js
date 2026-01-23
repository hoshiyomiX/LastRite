// Global mutable state
// In a Cloudflare Worker, this state persists across requests in the same isolate.

// Cache
export const inMemoryCache = {
  prxList: { data: null, timestamp: 0 },
  kvPrxList: { data: null, timestamp: 0 }
};

// DNS Cache
export const dnsCache = new Map(); // hostname -> { ip, timestamp }

// Metrics / Stats
export const dnsStats = {
  hits: 0,
  misses: 0,
  dohSuccess: 0,
  dohFail: 0,
  fallback: 0
};

export const poolStats = { 
  hits: 0, 
  misses: 0, 
  evictions: 0 
};

export const bufferStats = {
  backpressureEvents: 0,
  queueOverflows: 0,
  totalQueued: 0,
  maxQueueDepth: 0
};

export const timeoutStats = { 
  adaptive: 0, 
  default: 0, 
  fastFail: 0,
  slowSuccess: 0 
};

export const batchStats = {
  batched: 0,
  unbatched: 0,
  totalBatchSavings: 0
};

export const retryStats = {
  attempts: 0,
  successes: 0,
  failures: 0,
  totalDelay: 0
};

export const coalesceStats = {
  hits: 0,        // Requests served from pending
  misses: 0,      // Unique requests
  saved: 0        // Total duplicate requests avoided
};

export const streamingStats = {
  activeStreams: 0,
  totalStreamed: 0,
  streamingBytes: 0
};

// Logic State
export const connectionPool = new Map();
export const latencyTracker = new Map(); // Track RTT per destination
export const pendingRequests = new Map(); // Track in-flight requests
export const FLAG_EMOJI_CACHE = new Map();

// Runtime configuration (set per request)
// These should ideally be passed in context, but for compatibility with existing logic
// we might expose getters/setters or keep them in the handler scope.
// However, since Workers are single-threaded per request handling (async), 
// global variables for request-context are dangerous if requests are interleaved in the same isolate.
// The original code used global `APP_DOMAIN`, `serviceName`, `prxIP`.
// In this refactor, we will aim to pass these as arguments to functions, 
// rather than storing them in global state.

export default {
  inMemoryCache,
  dnsCache,
  dnsStats,
  poolStats,
  bufferStats,
  timeoutStats,
  batchStats,
  retryStats,
  coalesceStats,
  streamingStats,
  connectionPool,
  latencyTracker,
  pendingRequests,
  FLAG_EMOJI_CACHE
};
