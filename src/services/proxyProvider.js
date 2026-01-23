import { fetchWithDNS } from './dns.js';
import { getCachedData } from './cache.js';
import { paginateArray, shuffleArray } from '../utils/helpers.js';
import { CACHE_TTL, MAX_CONFIGS_PER_REQUEST, PRX_BANK_URL, KV_PRX_URL } from '../config/constants.js';

export async function getKVPrxList(kvPrxUrl = KV_PRX_URL, env) {
  if (!kvPrxUrl) {
    throw new Error("No URL Provided!");
  }

  return getCachedData(
    "kvPrxList",
    async () => {
      const kvPrx = await fetchWithDNS(kvPrxUrl); // Use DNS-optimized fetch
      if (kvPrx.status === 200) {
        return await kvPrx.json();
      }
      return {};
    },
    CACHE_TTL,
    env
  );
}

export async function getPrxListPaginated(prxBankUrl = PRX_BANK_URL, options = {}, env) {
  const targetUrl = prxBankUrl || env.PRX_BANK_URL || PRX_BANK_URL;
  
  if (!targetUrl) {
    throw new Error("No URL Provided!");
  }

  const {
    offset = 0,
    limit = MAX_CONFIGS_PER_REQUEST,
    filterCC = [],
  } = options;

  const prxList = await getCachedData(
    "prxList",
    async () => {
      const prxBank = await fetchWithDNS(targetUrl); // Use DNS-optimized fetch
      if (prxBank.status === 200) {
        const text = (await prxBank.text()) || "";
        const prxString = text.split("\n").filter(Boolean);
        
        return prxString
          .map((entry) => {
            const [prxIP, prxPort, country, org] = entry.split(",");
            return {
              prxIP: prxIP || "Unknown",
              prxPort: prxPort || "Unknown",
              country: country || "Unknown",
              org: org || "Unknown Org",
            };
          })
          .filter(Boolean);
      }
      return [];
    },
    CACHE_TTL,
    env
  );

  return paginateArray(prxList, offset, limit, filterCC);
}
