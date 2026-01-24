import fs from 'fs/promises';
import path from 'path';

const MONOSANS_URL = 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies_pretty.json';
const PROXY_LIST_FILE = 'proxyList.txt';
const KV_PROXY_LIST_FILE = 'kvProxyList.json';

// Configuration
const MAX_PROXIES_TOTAL = 2000;
const MAX_PROXIES_PER_COUNTRY = 50;

async function fetchProxies() {
  console.log(`[Scan] Fetching proxies from ${MONOSANS_URL}...`);
  try {
    const response = await fetch(MONOSANS_URL);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    console.log(`[Scan] Fetched ${data.length} proxies.`);
    return data;
  } catch (error) {
    console.error('[Scan] Failed to fetch proxies:', error);
    process.exit(1);
  }
}

function processProxies(proxies) {
  if (proxies.length > 0) {
    console.log('[Scan] Sample proxy item (Raw):', JSON.stringify(proxies[0]));
  }
  
  const processed = proxies.map(p => {
    // 1. IP Parsing
    const ip = p.ip || p.host || p.address;
    
    // 2. Port Parsing
    const port = p.port;
    
    // 3. Country Parsing (Aggressive Flattening)
    let cc = 'XX';
    try {
      if (!p.country) {
        cc = 'XX';
      } else if (typeof p.country === 'string') {
        cc = p.country;
      } else if (typeof p.country === 'object') {
        // Try common keys
        cc = p.country.code || p.country.iso || p.country.id || p.country.name || 'XX';
        
        // Final sanity check: if it's STILL an object (e.g. nested deeper), force XX
        if (typeof cc === 'object') {
          console.warn('[Scan] Nested country object found, defaulting to XX:', JSON.stringify(p.country));
          cc = 'XX';
        }
      }
    } catch (e) {
      cc = 'XX';
    }

    // 4. Org/AS Parsing
    let orgRaw = 'Unknown';
    try {
      if (p.org) orgRaw = p.org;
      else if (p.isp) orgRaw = p.isp;
      else if (p.as) {
        if (typeof p.as === 'string') orgRaw = p.as;
        else if (typeof p.as === 'object') {
          orgRaw = p.as.organization || p.as.name || p.as.number || 'Unknown';
        }
      }
    } catch (e) {
      orgRaw = 'Unknown';
    }

    // 5. Sanitization (Crucial step)
    const safeIP = String(ip || '').trim();
    const safePort = String(port || '').trim();
    const safeCC = String(cc || 'XX').trim().toUpperCase().substring(0, 2); // Force 2 chars
    const safeOrg = String(orgRaw || 'Unknown').replace(/,/g, ' ').replace(/[\r\n]/g, '').trim();
    
    // Validation
    if (!safeIP || safeIP === 'undefined' || safeIP === '[object Object]') return null;
    if (!safePort || isNaN(safePort)) return null;

    return {
      ip: safeIP,
      port: safePort,
      cc: safeCC,
      org: safeOrg,
      line: `${safeIP},${safePort},${safeCC},${safeOrg}`
    };
  }).filter(Boolean);

  if (processed.length > 0) {
    console.log('[Scan] Sample processed item:', processed[0]);
  }

  return processed;
}

async function run() {
  const rawProxies = await fetchProxies();
  const processed = processProxies(rawProxies);

  // 1. Generate proxyList.txt (CSV)
  const listContent = processed
    .slice(0, MAX_PROXIES_TOTAL)
    .map(p => p.line)
    .join('\n');

  await fs.writeFile(PROXY_LIST_FILE, listContent);
  console.log(`[Scan] Wrote ${Math.min(processed.length, MAX_PROXIES_TOTAL)} proxies to ${PROXY_LIST_FILE}`);

  // 2. Generate kvProxyList.json (Grouped by CC)
  const kvMap = {};
  
  for (const p of processed) {
    const cc = p.cc;
    if (!kvMap[cc]) kvMap[cc] = [];
    
    if (kvMap[cc].length < MAX_PROXIES_PER_COUNTRY) {
      kvMap[cc].push(`${p.ip}:${p.port}`);
    }
  }

  await fs.writeFile(KV_PROXY_LIST_FILE, JSON.stringify(kvMap, null, 2));
  console.log(`[Scan] Wrote KV map with ${Object.keys(kvMap).length} countries to ${KV_PROXY_LIST_FILE}`);
}

run();
