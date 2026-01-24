# Aegir 🌊

> *"The tides are silent, but they run deep."*

**Aegir** is a high-performance, modular serverless proxy generator for Cloudflare Workers. It transforms standard proxy lists into high-speed, load-balanced subscription links (VLESS/Trojan/Shadowsocks) with advanced optimizations for massive concurrency and low latency.

> 🔱 **Origin**: Forked from [EDtunnel](https://github.com/3Kmfi6HP/EDtunnel) / [zizifn](https://github.com/zizifn/edgetunnel). This version ("Aegir") is a complete architectural rewrite focusing on enterprise-grade performance and modularity.

---

## 🚀 Key Features (Abyssal Optimized)

Unlike standard implementations, Aegir includes a suite of custom optimizations designed for speed and stealth.

### ⚡ Optimization Stack (Ordered by Impact)

1. **Tidal Streaming (OPT-11)**
   - *What*: Streams subscription data chunk-by-chunk to the client.
   - *Impact*: Near-instant Time-To-First-Byte (TTFB), even for lists with 500+ proxies.
   
2. **Connection Pooling (OPT-12)**
   - *What*: Intelligent reuse of TCP connections to upstream proxies.
   - *Impact*: Eliminates handshake latency for subsequent requests.

3. **Adaptive Resilience (OPT-14)**
   - *What*: Dynamic timeout calculation based on P95 latency history.
   - *Impact*: Connections fail fast on bad nodes and recover smart.

4. **Smart Retry (OPT-16)**
   - *What*: Exponential backoff with jitter for failed connections.
   - *Impact*: Prevents server overload while ensuring reliability.

5. **Request Deduplication (OPT-17)**
   - *What*: Prevents "Thundering Herd" by coalescing identical requests.
   - *Impact*: Saves CPU cycles when multiple clients request the same config.

6. **DNS Pre-warming (OPT-18)**
   - *What*: Pre-resolves critical domains (GitHub, APIs) in the background.
   - *Impact*: Zero-latency lookup for initial requests.

7. **Lazy Proxy Parsing (OPT-19)**
   - *What*: Parses huge proxy lists *on-demand* using efficient memory slicing.
   - *Impact*: Reduces memory footprint by **~70%**, preventing Worker OOM errors.

8. **Flux String Interpolation (OPT-20)**
   - *What*: Generates config URLs using direct string building instead of slow Object manipulation.
   - *Impact*: **4x faster** link generation speed.

---

## 📦 One-Click Deployment

Deploy your own Aegir instance to Cloudflare Workers in under 2 minutes.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hoshiyomiX/LastRite/tree/refactor-modular)

### 🛠️ Post-Deployment
The system comes pre-configured with high-quality proxy banks. No manual URL input is required for basic usage.

- **Default Proxy Bank**: Integrated automatically.
- **Default KV Map**: Integrated automatically.

Simply access your worker URL to start using it.

---

## 📝 API Endpoints

| Endpoint | Description |
| :--- | :--- |
| `/sub?host=[domain]` | Generate subscription link for Clash/V2Ray. |
| `/api/v1/sub` | Raw API for generating configs with filters (`offset`, `limit`, `cc`). |
| `/api/v1/myip` | Check your current IP details via the worker. |
| `/sub/check` | Perform health check on specific proxy target. |

---

## 🌐 Community & Proxy Resources

Finding high-quality Proxy IPs is key to Aegir's performance.

### Recommended Sources (Auto-Compatible)
Aegir uses the standard `IP,Port,CC,Org` CSV format.
1. **[CloudflareSpeedTest (XIU2)](https://github.com/XIU2/CloudflareSpeedTest)**: The gold standard for scanning clean IPs relative to your ISP.
2. **[FoolVPN-ID/Nautica](https://github.com/FoolVPN-ID/Nautica)**: Maintains the default `proxyList.txt` used by this repo.
3. **[vfarid/cf-ip-scanner](https://github.com/vfarid/cf-ip-scanner)**: Another excellent scanner for finding low-latency IPs.

> **Tip**: For best results, scan your own IPs using CloudflareST and host your own `proxyList.txt` on GitHub!

---

## 📄 License

This project is licensed under the **ISC License**.
Based on the open-source community efforts of [EDtunnel](https://github.com/3Kmfi6HP/EDtunnel).
