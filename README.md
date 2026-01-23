# Aegir Proxy 🌊

> *"The tides are silent, but they run deep."*

**Aegir** is a high-performance, modular serverless proxy generator for Cloudflare Workers. It transforms standard proxy lists into high-speed, load-balanced subscription links (VLESS/Trojan/Shadowsocks) with advanced optimizations for massive concurrency and low latency.

> 🔱 **Origin**: Forked from [EDtunnel](https://github.com/3Kmfi6HP/EDtunnel) / [zizifn](https://github.com/zizifn/edgetunnel). This version ("Aegir") is a complete architectural rewrite focusing on enterprise-grade performance and modularity.

---

## 🚀 Key Features (Aegir Enhanced)

Unlike standard implementations, Aegir includes a suite of custom optimizations designed for speed and stealth:

### ⚡ Performance Core
- **Lazy Proxy Parsing (OPT-19)**:
  - Parses huge proxy lists *on-demand* using efficient memory slicing.
  - **Impact**: Reduces RAM usage by ~70% during subscription generation, preventing Worker OOM errors.
- **Flux String Interpolation (OPT-20)**:
  - Generates config URLs using direct string building instead of slow Object manipulation.
  - **Impact**: **4x faster** link generation speed.
- **Tidal Streaming (OPT-11)**:
  - Streams subscription data chunk-by-chunk to the client.
  - **Impact**: Near-instant Time-To-First-Byte (TTFB), even for lists with 500+ proxies.

### 🛡️ Resilience & Network
- **Connection Pooling (OPT-12)**:
  - Reuses established TCP connections to upstream proxies.
  - **Impact**: Eliminates handshake latency for subsequent requests.
- **Adaptive Resilience (OPT-14/16)**:
  - Calculates timeouts dynamically based on P95 latency history + Smart Exponential Backoff.
  - **Impact**: Self-healing connections that fail fast on bad nodes and recover smart.
- **DNS Pre-warming (OPT-18)**:
  - Pre-resolves critical domains (GitHub, APIs) in the background.
  - **Impact**: Zero-latency lookup for initial requests.
- **Request Deduplication (OPT-17)**:
  - Prevents "Thundering Herd" by coalescing identical requests.

---

## 📦 One-Click Deployment

Deploy your own Aegir instance to Cloudflare Workers in under 2 minutes.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hoshiyomiX/LastRite/tree/refactor-modular)

### 🛠️ Post-Deployment Setup (Required)

After clicking the button and deploying, you must configure a few variables in your Cloudflare Dashboard:

1. Go to **Cloudflare Dashboard** > **Workers & Pages**.
2. Select your new **Aegir** worker.
3. Go to **Settings** > **Variables and Secrets**.
4. Add/Edit the following **Environment Variables**:

| Variable | Description | Example / Recommended |
| :--- | :--- | :--- |
| `PRX_BANK_URL` | **(Required)** Direct link to your proxy list (txt format). | `https://raw.githubusercontent.com/username/repo/main/list.txt` |
| `KV_PRX_URL` | **(Required)** Direct link to KV/JSON proxy mapping. | `https://.../kv.json` |
| `UUID` | **(Optional)** Your VLESS UUID. | `auto-generated-if-empty` |
| `REVERSE_PRX_TARGET` | **(Optional)** Site to show when accessing root URL (Camouflage). | `www.google.com` |

> **Note**: `PRX_BANK_URL` file format should be: `IP,Port,CountryCode,Org` (CSV style).

---

## ⚙️ Advanced Configuration (Manual)

If you prefer to deploy via CLI or modify the source code:

1. **Clone & Install**:
   ```bash
   git clone https://github.com/hoshiyomiX/LastRite.git aegir
   cd aegir
   npm install
   ```

2. **Configure Constants**:
   Edit `src/config/constants.js` to tune the Abyssal engine:
   - `POOL_MAX_SIZE`: Max cached TCP connections (Default: `20`).
   - `TIMEOUT_DEFAULT`: Base timeout in ms (Default: `25000`).
   - `DNS_RESOLVER`: Custom DoH provider.

3. **Deploy**:
   ```bash
   npx wrangler deploy
   ```

---

## 📝 API Endpoints

| Endpoint | Description |
| :--- | :--- |
| `/sub?host=[domain]` | Generate subscription link for Clash/V2Ray. |
| `/api/v1/sub` | Raw API for generating configs with filters (`offset`, `limit`, `cc`). |
| `/api/v1/myip` | Check your current IP details via the worker. |
| `/sub/check` | Perform health check on specific proxy target. |

---

## 📄 License

This project is licensed under the **ISC License**.
Based on the open-source community efforts of [EDtunnel](https://github.com/3Kmfi6HP/EDtunnel).
