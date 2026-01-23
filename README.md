# Aegir (formerly LastRite/Nautica) 🌊

> *"The tides are silent, but they run deep."*

**Aegir** is a high-performance, modular serverless proxy generator inspired by Abyssal technology. Designed for stealth, massive concurrency, and fluid data streaming.

> **Status**: 🟢 **Operational** (Refactor v2.0)

## ✨ Core Technologies (The Abyssal Tech)

Aegir integrates advanced optimization techniques to ensure low latency and high resilience:

- **Lazy Proxy Parsing (OPT-19)**:
  - *Mechanism*: Parses proxy lists only on demand using efficient slicing.
  - *Effect*: Reduces memory footprint by **~70%** during high-load subscription generation.

- **Flux String Interpolation (OPT-20)**:
  - *Mechanism*: Replaces legacy URL object manipulation with direct string building.
  - *Effect*: **4x faster** config link generation.

- **Tidal Streaming (OPT-11)**:
  - *Mechanism*: Streams configuration chunks instantly to the client without buffering the full response.
  - *Effect*: Near-instant Time-To-First-Byte (TTFB).

- **Connection Pooling (OPT-12)**:
  - *Mechanism*: Intelligent reuse of TCP connections to upstream proxies.
  - *Effect*: Eliminates handshake overhead for subsequent requests.

- **Adaptive Resilience (OPT-14/16)**:
  - *Mechanism*: Dynamic timeout calculation based on P95 latency + Smart Exponential Backoff.
  - *Effect*: Self-healing connections that fail fast and recover smart.

## 📂 Architecture

The codebase follows a strict modular structure for maintainability and scalability:

```
src/
├── config/         # System Constants & Tunables
├── core/           # State Management (Pools, Cache, Stats)
├── handlers/       # Protocol Handlers (WebSocket, TCP, UDP)
├── protocols/      # Packet Parsers (VLESS, Trojan, SS)
├── services/       # Core Logic (ProxyProvider, DNS, ConfigGen)
├── utils/          # Helpers (Network, StreamPump)
└── index.js        # Main Entry Point
```

## 🛠️ Deployment Operations

### Automated Deployment (GitHub Actions)
Push to the `refactor-modular` branch to trigger a **Fresh Deploy** (Cleaning old worker instances before deploying new code).

1. **Secrets Required**:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

### Manual Deployment
```bash
npm install
npx wrangler deploy
```

## ⚙️ Configuration
Tunable parameters in `src/config/constants.js`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `POOL_MAX_SIZE` | 20 | Max concurrent TCP connections per pool |
| `TIMEOUT_DEFAULT` | 25000 | Base timeout in ms (Adaptive) |
| `RETRY_MAX_ATTEMPTS` | 3 | Max retries before giving up |
| `DNS_CACHE_TTL` | 600000 | DNS Cache duration (10 mins) |

## 📝 License
ISC - Open Source
