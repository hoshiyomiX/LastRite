import fs from 'fs/promises';
import path from 'path';

const MONOSANS_URL = 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies_pretty.json';
const PROXY_LIST_FILE = 'proxyList.txt';
const KV_PROXY_LIST_FILE = 'kvProxyList.json';

// Configuration
const MAX_PROXIES_TOTAL = 2000; // Limit total proxies to keep file size manageable
const MAX_PROXIES_PER_COUNTRY = 50; // Limit for KV list to ensure variety

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
  // Filter and map
  // We prefer HTTPS/SOCKS5 if available, but monosans mixes them. 
  // For Aegir "ProxyIP" usage, we usually look for robust IPs.
  // Since we can't easily validte "Cloudflare-ness" here without a complex check,
  // we will trust the list but prioritize by latency if available (monosans json usually has no latency field in raw, wait, proxies_pretty might not have latency, checking docs...)
  // Checking monosans structure: usually ip, port, protocol, country, org, isp.
  // We will assume the list is somewhat usable.
  
  // Format: IP,Port,CC,Org
  const processed = proxies.map(p => {
    const org = (p.org || p.isp || 'Unknown').replace(/,/g, ' ').trim(); // Remove commas for CSV safety
    return {
      ip: p.ip,
      port: p.port,
      cc: p.country || 'XX',
      org: org,
      line: `${p.ip},${p.port},${p.country || 'XX'},${org}`
    };
  });

  return processed;
}

async function run() {
  const rawProxies = await fetchProxies();
  const processed = processProxies(rawProxies);

  // 1. Generate proxyList.txt (CSV)
  // Limit total size
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
    
    // Limit per country for KV to save space and ensure distribution
    if (kvMap[cc].length < MAX_PROXIES_PER_COUNTRY) {
      kvMap[cc].push(`${p.ip}:${p.port}`);
    }
  }

  await fs.writeFile(KV_PROXY_LIST_FILE, JSON.stringify(kvMap, null, 2));
  console.log(`[Scan] Wrote KV map with ${Object.keys(kvMap).length} countries to ${KV_PROXY_LIST_FILE}`);
}

run();
