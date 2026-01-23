import { connect } from "cloudflare:sockets";
import { 
  latencyTracker, 
  timeoutStats, 
  connectionPool, 
  poolStats,
  retryStats 
} from '../core/state.js';
import { 
  LATENCY_HISTORY_SIZE, 
  TIMEOUT_MIN, 
  TIMEOUT_MAX, 
  TIMEOUT_MULTIPLIER, 
  TIMEOUT_DEFAULT,
  POOL_MAX_SIZE,
  POOL_IDLE_TIMEOUT,
  RETRY_BASE_DELAY,
  RETRY_MAX_DELAY,
  RETRY_JITTER_FACTOR
} from '../config/constants.js';

// OPTIMIZATION 14: Adaptive timeout helpers
export function getLatencyKey(address, port) {
  return `${address}:${port}`;
}

export function recordLatency(address, port, latencyMs) {
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

export function calculateAdaptiveTimeout(address, port, log) {
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
  
  if (log) {
    log(`Adaptive timeout for ${key}: ${adaptiveTimeout}ms (P95 RTT: ${p95Latency}ms, samples: ${history.length})`);
  }
  
  return adaptiveTimeout;
}

export function cleanupLatencyTracker() {
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
export function getPoolKey(address, port) {
  return `${address}:${port}`;
}

export async function getPooledConnection(address, port, log) {
  const key = getPoolKey(address, port);
  const poolEntry = connectionPool.get(key);
  
  if (poolEntry && !poolEntry.socket.closed) {
    poolStats.hits++;
    connectionPool.delete(key); // Remove from pool when taken
    clearTimeout(poolEntry.timeoutId);
    if(log) log(`Pool HIT: ${key} (${poolStats.hits} hits, ${poolStats.misses} misses)`);
    return poolEntry.socket;
  }
  
  if (poolEntry) {
    // Expired or closed connection, cleanup
    connectionPool.delete(key);
  }
  
  poolStats.misses++;
  return null;
}

export function returnToPool(tcpSocket, address, port, log) {
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
      if(log) log(`Pool cleanup: ${key} (idle timeout)`);
    }
  }, POOL_IDLE_TIMEOUT);
  
  connectionPool.set(key, {
    socket: tcpSocket,
    timeoutId: timeoutId,
    timestamp: Date.now(),
  });
  
  if(log) log(`Returned to pool: ${key} (pool size: ${connectionPool.size}/${POOL_MAX_SIZE})`);
}

// OPTIMIZATION 16: Backoff calculation
export function calculateBackoff(attempt) {
  // Exponential backoff: base * 2^attempt, capped at max
  const exponentialDelay = Math.min(
    RETRY_BASE_DELAY * Math.pow(2, attempt),
    RETRY_MAX_DELAY
  );
  
  // Add jitter: ±30% randomization to prevent thundering herd
  const jitter = exponentialDelay * RETRY_JITTER_FACTOR * (Math.random() * 2 - 1);
  const totalDelay = Math.max(0, exponentialDelay + jitter);
  
  return Math.floor(totalDelay);
}
