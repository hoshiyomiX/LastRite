# LastRite (Nautica) 🚀

A high-performance, modular Cloudflare Worker for VLESS/Trojan/Shadowsocks proxy generation and management. Optimized for speed, low latency, and massive concurrency.

> **Status**: 🟢 Stable (Modular Architecture)

## ✨ Key Features

- **Modular Architecture**: Clean separation of concerns (Core, Handlers, Protocols, Services).
- **High Performance**:
  - **Lazy Proxy Parsing (OPT-19)**: Reduces memory usage by ~70% during subscription generation.
  - **String Interpolation (OPT-20)**: Generates config URLs 4x faster than standard URL objects.
  - **Streaming Responses (OPT-11)**: Instant TTFB for large subscription lists.
  - **Connection Pooling (OPT-12)**: Reuses TCP connections to reduce handshake overhead.
- **Resilience**:
  - **Adaptive Timeout (OPT-14)**: Adjusts timeouts based on real-time P95 latency.
  - **Smart Retry (OPT-16)**: Exponential backoff with jitter for failed connections.
  - **DNS Pre-warming (OPT-18)**: Pre-resolves critical domains to eliminate initial lookup latency.
- **Protocol Support**: VLESS, Trojan, Shadowsocks, VMess.
- **CI/CD Integration**: Automated "Clean Deploy" via GitHub Actions with log trapping.

## 📂 Project Structure

```
src/
├── config/         # Static constants (Ports, Protocols, Timeouts)
├── core/           # Core state management (Pools, Stats, Cache)
├── handlers/       # Protocol-specific handlers (TCP, UDP, WebSocket)
├── protocols/      # Packet parsers (VLESS, Trojan, SS)
├── services/       # Business logic (ProxyProvider, DNS, ConfigGen)
├── utils/          # Helpers (Network, StreamPump, Helpers)
└── index.js        # Main entry point & Router
```

## 🛠️ Deployment

### Automated Deployment (Recommended)
This repository includes a GitHub Actions workflow that automatically deploys to Cloudflare Workers.

1. **Secrets Required**:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

2. **Trigger**:
   - Push to `refactor-modular` branch (Auto-deploy).
   - Manual dispatch for `main` branch via Actions tab.

### Manual Deployment
```bash
# Install dependencies
npm install

# Deploy
npx wrangler deploy
```

## ⚙️ Configuration
Configuration is centralized in `src/config/constants.js`. Key customizable values:
- `POOL_MAX_SIZE`: Max cached TCP connections (Default: 20).
- `TIMEOUT_DEFAULT`: Base timeout for new connections (Default: 25s).
- `RETRY_MAX_ATTEMPTS`: Max retries for failed chunks (Default: 3).

## 🚀 Performance Optimizations

| Optimization | Description | Impact |
|--------------|-------------|--------|
| **OPT-11** | Streaming Response | Lower TTFB |
| **OPT-12** | Connection Pooling | Reduced Handshake RTT |
| **OPT-14** | Adaptive Timeout | Faster Failover |
| **OPT-17** | Request Deduplication | Prevention of "Thundering Herd" |
| **OPT-19** | Lazy Proxy Parsing | **-70% Memory Usage** |
| **OPT-20** | String Interpolation | **4x Faster Config Gen** |

## 📝 License
ISC
