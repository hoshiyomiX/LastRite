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
  // Debug one item to check structure
  if (proxies.length > 0) {
    console.log('[Scan] Sample proxy item:', JSON.stringify(proxies[0]));
  }
  
  // Format: IP,Port,CC,Org
  const processed = proxies.map(p => {
    // Monosans structure: {"ip": "...", "port": ..., "protocol": "http", "country": {"code": "US", "name": "United States"}, "as": {"number": 123, "name": "Google", "organization": "Google LLC"}}
    // OR sometimes flat structure depending on the exact file. 
    // Let's handle nested objects carefully.
    
    const ip = p.ip || p.host || p.address;
    const port = p.port;
    
    // Handle Country (nested object or string)
    let cc = 'XX';
    if (typeof p.country === 'object' && p.country !== null) {
      cc = p.country.code || 'XX';
    } else if (typeof p.country === 'string') {
      cc = p.country;
    } else if (p.geolocation && p.geolocation.country) {
      cc = p.geolocation.country;
    }

    // Handle Org/AS (nested object or string)
    let orgRaw = 'Unknown';
    if (typeof p.as === 'object' && p.as !== null) {
      orgRaw = p.as.organization || p.as.name || 'Unknown';
    } else if (p.org) {
      orgRaw = p.org;
    } else if (p.isp) {
      orgRaw = p.isp;
    }

    // Sanitize
    const org = String(orgRaw).replace(/,/g, ' ').trim();
    const safeIP = String(ip).trim();
    const safePort = String(port).trim();
    const safeCC = String(cc).trim();
    
    if (!safeIP || safeIP === 'undefined' || safeIP === '[object Object]') {
      return null; // Invalid item
    }

    return {
      ip: safeIP,
      port: safePort,
      cc: safeCC,
      org: org,
      line: `${safeIP},${safePort},${safeCC},${org}`
    };
  }).filter(Boolean); // Remove nulls

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
    const cc = p.cc.toUpperCase();
    if (!kvMap[cc]) kvMap[cc] = [];
    
    if (kvMap[cc].length < MAX_PROXIES_PER_COUNTRY) {
      kvMap[cc].push(`${p.ip}:${p.port}`);
    }
  }

  await fs.writeFile(KV_PROXY_LIST_FILE, JSON.stringify(kvMap, null, 2));
  console.log(`[Scan] Wrote KV map with ${Object.keys(kvMap).length} countries to ${KV_PROXY_LIST_FILE}`);
}

run();
