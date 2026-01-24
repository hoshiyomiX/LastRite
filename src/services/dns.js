import { dnsCache, dnsStats } from '../core/state.js';
import { DNS_RESOLVER, DNS_CACHE_TTL, KNOWN_DOMAINS } from '../config/constants.js';

// OPTIMIZATION 18: DNS-over-HTTPS helpers
export async function resolveDNS(hostname) {
  const now = Date.now();
  
  // Check cache first
  if (dnsCache.has(hostname)) {
    const cached = dnsCache.get(hostname);
    if (now - cached.timestamp < DNS_CACHE_TTL) {
      dnsStats.hits++;
      return cached.ip;
    } else {
      // Expired, remove from cache
      dnsCache.delete(hostname);
    }
  }
  
  dnsStats.misses++;
  
  // Resolve via DNS-over-HTTPS
  try {
    const dohUrl = `${DNS_RESOLVER}?name=${hostname}&type=A`;
    
    // WARNING: 'fetch' inside a request context without 'await' might be terminated early
    // if not using ctx.waitUntil. However, resolveDNS is usually awaited.
    
    const response = await fetch(dohUrl, {
      headers: {
        'Accept': 'application/dns-json'
      },
      cf: {
        cacheTtl: 600, // Cache DoH response for 10 minutes
        cacheEverything: true
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      
      // Extract first A record
      if (data.Answer && data.Answer.length > 0) {
        const ip = data.Answer.find(r => r.type === 1)?.data; // Type 1 = A record
        
        if (ip) {
          dnsStats.dohSuccess++;
          
          // Cache the result
          dnsCache.set(hostname, { ip, timestamp: now });
          return ip;
        }
      }
    }
    
    dnsStats.dohFail++;
  } catch (err) {
    dnsStats.dohFail++;
    // Silent fail
  }
  
  // Fallback: return hostname (browser/runtime will resolve)
  dnsStats.fallback++;
  return hostname;
}

// Pre-warm DNS cache for known domains
export async function prewarmDNS() {
  // Use Promise.allSettled but do NOT log excessively
  const promises = KNOWN_DOMAINS.map(domain => 
    resolveDNS(domain).catch(() => {})
  );
  await Promise.allSettled(promises);
}

// Cleanup old DNS cache entries
export function cleanupDNSCache() {
  const now = Date.now();
  for (const [hostname, entry] of dnsCache.entries()) {
    if (now - entry.timestamp >= DNS_CACHE_TTL) {
      dnsCache.delete(hostname);
    }
  }
}

// Enhanced fetch with DNS pre-resolution
export async function fetchWithDNS(url, options = {}, appDomain = '') {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    
    // Only resolve external domains (not worker's own domain)
    if (!hostname.includes('.workers.dev') && (!appDomain || !hostname.includes(appDomain))) {
      // Don't wait for DNS resolution to fail, just try to resolve
      // If it fails, standard fetch handles it.
      // We await it here to actually use the cache side-effect if needed, 
      // OR we could just let standard fetch work if DNS is flaky.
      // But for Optimization 18 to work, we must await.
      await resolveDNS(hostname);
    }
    
    return await fetch(url, options);
  } catch (err) {
    // Fallback to standard fetch
    return await fetch(url, options);
  }
}
