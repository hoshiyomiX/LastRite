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
      console.log(`[DNS] Cache HIT: ${hostname} -> ${cached.ip} (age: ${Math.floor((now - cached.timestamp) / 1000)}s)`);
      return cached.ip;
    } else {
      // Expired, remove from cache
      dnsCache.delete(hostname);
    }
  }
  
  dnsStats.misses++;
  console.log(`[DNS] Cache MISS: ${hostname}, resolving via DoH...`);
  
  // Resolve via DNS-over-HTTPS
  try {
    const startTime = Date.now();
    const dohUrl = `${DNS_RESOLVER}?name=${hostname}&type=A`;
    
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
      const resolveTime = Date.now() - startTime;
      
      // Extract first A record
      if (data.Answer && data.Answer.length > 0) {
        const ip = data.Answer.find(r => r.type === 1)?.data; // Type 1 = A record
        
        if (ip) {
          dnsStats.dohSuccess++;
          
          // Cache the result
          dnsCache.set(hostname, { ip, timestamp: now });
          
          console.log(`[DNS] DoH SUCCESS: ${hostname} -> ${ip} (${resolveTime}ms)`);
          console.log(`[DNS] Stats: hits=${dnsStats.hits} misses=${dnsStats.misses} doh=${dnsStats.dohSuccess} fallback=${dnsStats.fallback}`);
          
          return ip;
        }
      }
    }
    
    dnsStats.dohFail++;
    console.error(`[DNS] DoH FAILED for ${hostname}, response status: ${response.status}`);
  } catch (err) {
    dnsStats.dohFail++;
    console.error(`[DNS] DoH ERROR for ${hostname}:`, err.message);
  }
  
  // Fallback: return hostname (browser/runtime will resolve)
  dnsStats.fallback++;
  console.log(`[DNS] FALLBACK to standard resolution for ${hostname}`);
  return hostname;
}

// Pre-warm DNS cache for known domains
export async function prewarmDNS() {
  console.log('[DNS] Pre-warming cache for known domains...');
  const promises = KNOWN_DOMAINS.map(domain => 
    resolveDNS(domain).catch(err => {
      console.error(`[DNS] Pre-warm failed for ${domain}:`, err);
    })
  );
  await Promise.allSettled(promises);
  console.log(`[DNS] Pre-warm complete. Cache size: ${dnsCache.size}`);
}

// Cleanup old DNS cache entries
export function cleanupDNSCache() {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [hostname, entry] of dnsCache.entries()) {
    if (now - entry.timestamp >= DNS_CACHE_TTL) {
      dnsCache.delete(hostname);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[DNS] Cleaned ${cleaned} expired entries. Cache size: ${dnsCache.size}`);
  }
}

// Enhanced fetch with DNS pre-resolution
export async function fetchWithDNS(url, options = {}, appDomain = '') {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    
    // Only resolve external domains (not worker's own domain)
    // Note: appDomain might be empty if not provided, check safely
    if (!hostname.includes('.workers.dev') && (!appDomain || !hostname.includes(appDomain))) {
      await resolveDNS(hostname);
    }
    
    return await fetch(url, options);
  } catch (err) {
    // Fallback to standard fetch
    return await fetch(url, options);
  }
}
