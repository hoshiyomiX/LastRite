import { inMemoryCache } from '../core/state.js';

export async function getCachedData(cacheKey, fetchFn, ttl, env) {
  const now = Date.now();
  
  // 1. Check in-memory cache first
  if (inMemoryCache[cacheKey]?.data && (now - inMemoryCache[cacheKey].timestamp) < ttl) {
    return inMemoryCache[cacheKey].data;
  }
  
  // 2. Check KV cache
  if (env?.KV_CACHE) {
    try {
      const cached = await env.KV_CACHE.get(cacheKey, "json");
      if (cached) {
        inMemoryCache[cacheKey] = { data: cached, timestamp: now };
        return cached;
      }
    } catch (err) {
      console.error(`KV cache read error for ${cacheKey}:`, err);
    }
  }
  
  // 3. Fetch fresh data
  const data = await fetchFn();
  inMemoryCache[cacheKey] = { data, timestamp: now };
  
  // 4. Store in KV for future requests
  if (env?.KV_CACHE) {
    try {
      await env.KV_CACHE.put(cacheKey, JSON.stringify(data), {
        expirationTtl: Math.floor(ttl / 1000),
      });
    } catch (err) {
      console.error(`KV cache write error for ${cacheKey}:`, err);
    }
  }
  
  return data;
}
