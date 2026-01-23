// Constants
export const CACHE_TTL = 3600000; // 1 hour in milliseconds

// OPTIMIZATION 18: DNS-over-HTTPS constants
export const DNS_CACHE_TTL = 600000; // 10 minutes in milliseconds
export const DNS_RESOLVER = "https://cloudflare-dns.com/dns-query"; // Cloudflare DoH

// Known external domains for pre-warming
export const KNOWN_DOMAINS = [
  "raw.githubusercontent.com",
  "api.foolvpn.web.id",
  "id1.foolvpn.web.id",
  "foolvpn.web.id",
  "udp-relay.hobihaus.space"
];

// OPTIMIZATION 12: Connection pooling
export const POOL_MAX_SIZE = 20;
export const POOL_IDLE_TIMEOUT = 60000; // 60 seconds

// OPTIMIZATION 13: Buffer management constants
export const BUFFER_HIGH_WATERMARK = 262144; // 256KB - pause if exceeded
export const BUFFER_LOW_WATERMARK = 65536;   // 64KB - resume when below
export const CHUNK_SIZE_OPTIMAL = 65536;     // 64KB per chunk
export const MAX_QUEUE_SIZE = 512;           // Max queued chunks

// OPTIMIZATION 14: Adaptive timeout system
export const LATENCY_HISTORY_SIZE = 10;  // Keep last 10 measurements
export const TIMEOUT_MIN = 8000;          // Minimum timeout: 8s
export const TIMEOUT_MAX = 45000;         // Maximum timeout: 45s
export const TIMEOUT_MULTIPLIER = 3.5;    // Timeout = RTT * multiplier
export const TIMEOUT_DEFAULT = 25000;     // Default when no history
export const UDP_RELAY_TIMEOUT = 15000;   // Fixed 15s timeout for UDP relay

// OPTIMIZATION 15 Phase 1: Adaptive watermark constants
export const WATERMARK_INTERACTIVE = 2;   // <1MB: low latency
export const WATERMARK_BALANCED = 4;      // 1-5MB: balanced (default)
export const WATERMARK_BULK = 8;          // >5MB: high throughput
export const THRESHOLD_BULK = 5242880;    // 5MB
export const THRESHOLD_MEDIUM = 1048576;  // 1MB

// OPTIMIZATION 15 Phase 2: Intelligent chunk batching
export const COALESCE_THRESHOLD = 16384;  // 16KB - batch chunks smaller than this
export const COALESCE_MAX_SIZE = 131072;  // 128KB - max batched size
export const COALESCE_TIMEOUT = 5;        // 5ms - max wait for batching

// OPTIMIZATION 16: Smart retry with exponential backoff
export const RETRY_MAX_ATTEMPTS = 3;      // Max retry attempts
export const RETRY_BASE_DELAY = 1000;     // 1s base delay
export const RETRY_MAX_DELAY = 8000;      // 8s max delay
export const RETRY_JITTER_FACTOR = 0.3;   // 30% jitter

// OPTIMIZATION 17: Request deduplication
export const REQUEST_COALESCE_TTL = 2000; // 2s window for coalescing
export const REQUEST_COALESCE_MAX_SIZE = 100; // Max pending requests

// Protocols
const horse = "dHJvamFu";
const flash = "dm1lc3M=";
const v2 = "djJyYXk=";
const neko = "Y2xhc2g=";

export const PROTOCOL_HORSE = atob(horse);
export const PROTOCOL_FLASH = atob(flash);
export const PROTOCOL_V2 = atob(v2);
export const PROTOCOL_NEKO = atob(neko);
export const UUID_V4_REGEX = /^[0-9a-f]{8}[0-9a-f]{4}4[0-9a-f]{3}[89ab][0-9a-f]{3}[0-9a-f]{12}$/i;

export const PORTS = [443, 80];
export const PROTOCOLS = [PROTOCOL_HORSE, PROTOCOL_FLASH, "ss"];
export const SUB_PAGE_URL = "https://foolvpn.web.id/nautica";
export const KV_PRX_URL = "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/kvProxyList.json";
export const PRX_BANK_URL = "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/proxyList.txt";
export const DNS_SERVER_ADDRESS = "8.8.8.8";
export const DNS_SERVER_PORT = 53;
export const RELAY_SERVER_UDP = {
  host: "udp-relay.hobihaus.space",
  port: 7300,
};
export const PRX_HEALTH_CHECK_API = "https://id1.foolvpn.web.id/api/v1/check";
export const CONVERTER_URL = "https://api.foolvpn.web.id/convert";

export const WS_READY_STATE_OPEN = 1;
export const WS_READY_STATE_CLOSING = 2;

export const CORS_HEADER_OPTIONS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export const MAX_CONFIGS_PER_REQUEST = 20;
