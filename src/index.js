import { 
  PORTS, 
  PROTOCOLS, 
  PRX_BANK_URL, 
  KV_PRX_URL,
  MAX_CONFIGS_PER_REQUEST,
  CORS_HEADER_OPTIONS,
  SUB_PAGE_URL,
  PROTOCOL_V2,
  PROTOCOL_NEKO,
  CONVERTER_URL,
  PRX_HEALTH_CHECK_API
} from './config/constants.js';

import { 
  dnsCache, 
  pendingRequests, 
  coalesceStats 
} from './core/state.js';

import { formatStats } from './core/diagnostics.js';
import { websocketHandler } from './handlers/websocket.js';
import { getKVPrxList, getPrxListPaginated } from './services/proxyProvider.js';
import { generateConfigsStream, createStreamingResponse } from './services/configGenerator.js';
import { reverseWeb } from './services/httpReverse.js';
import { prewarmDNS, cleanupDNSCache, fetchWithDNS } from './services/dns.js';

// Base64 Encoded WebUI v2.3 (With Fetch Logic & Proper UTF-8)
const BASE64_HTML = "PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9ImVuIj4KPGhlYWQ+CjxtZXRhIGNoYXJzZXQ9IlVURi04Ij4KPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xLjAiPgo8dGl0bGU+QWVnaXIgQ29uZmlnIHYyLjM8L3RpdGxlPgo8c3R5bGU+Cjpyb290IHsgLS1wcmltYXJ5OiAjMDBmMmVhOyAtLWJnOiAjMDUwNTA1OyAtLXBhbmVsOiAjMTExOyAtLXRleHQ6ICNlZWU7IC0tYm9yZGVyOiAjMzMzOyB9CiogeyBib3gtc2l6aW5nOiBib3JkZXItYm94OyB9CmJvZHkgeyBiYWNrZ3JvdW5kOiB2YXIoLS1iZyk7IGNvbG9yOiB2YXIoLS10ZXh0KTsgZm9udC1mYW1pbHk6IC1hcHBsZS1zeXN0ZW0sIEJsaW5rTWFjU3lzdGVtRm9udCwgJ1NlZ29lIFVJJywgUm9ib3RvLCBIZWx2ZXRpY2EsIEFyaWFsLCBzYW5zLXNlcmlmOyBkaXNwbGF5OiBmbGV4OyBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjsgYWxpZ24taXRlbXM6IGNlbnRlcjsgbWluLWhlaWdodDogMTAwdmg7IG1hcmdpbjogMDsgcGFkZGluZzogMTVweDsgfQouY2FyZCB7IGJhY2tncm91bmQ6IHZhcigtLXBhbmVsKTsgd2lkdGg6IDEwMCU7IG1heC13aWR0aDogNDIwcHg7IHBhZGRpbmc6IDI1cHg7IGJvcmRlci1yYWRpdXM6IDEycHg7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJvcmRlcik7IGJveC1zaGFkb3c6IDAgMTBweCA0MHB4IHJnYmEoMCwwLDAsMC42KTsgfQpoMiB7IHRleHQtYWxpZ246IGNlbnRlcjsgbWFyZ2luOiAwIDAgMjBweDsgY29sb3I6IHZhcigtLXByaW1hcnkpOyBmb250LXdlaWdodDogODAwOyBsZXR0ZXItc3BhY2luZzogMXB4OyB9CmgyIHNwYW4geyBmb250LXNpemU6IDAuNGVtOyBjb2xvcjogIzY2NjsgdmVydGljYWwtYWxpZ246IG1pZGRsZTsgYmFja2dyb3VuZDogIzIyMjsgcGFkZGluZzogMnB4IDZweDsgYm9yZGVyLXJhZGl1czogNHB4OyB9Ci5ncm91cCB7IG1hcmdpbi1ib3R0b206IDE1cHg7IH0KbGFiZWwgeyBkaXNwbGF5OiBibG9jazsgbWFyZ2luLWJvdHRvbTogNXB4OyBmb250LXNpemU6IDAuNzVyZW07IGNvbG9yOiAjODg4OyB0ZXh0LXRyYW5zZm9ybTogdXBwZXJjYXNlOyBmb250LXdlaWdodDogNzAwOyBsZXR0ZXItc3BhY2luZzogMC41cHg7IH0KaW5wdXQsIHNlbGVjdCwgdGV4dGFyZWEgeyB3aWR0aDogMTAwJTsgYmFja2dyb3VuZDogIzAwMDsgYm9yZGVyOiAxcHggc29saWQgIzJhMmEyYTsgY29sb3I6ICNmZmY7IHBhZGRpbmc6IDEwcHg7IGJvcmRlci1yYWRpdXM6IDZweDsgZm9udC1zaXplOiAxNHB4OyB0cmFuc2l0aW9uOiBib3JkZXIgMC4yczsgfQppbnB1dDpmb2N1cywgc2VsZWN0OmZvY3VzIHsgYm9yZGVyLWNvbG9yOiB2YXIoLS1wcmltYXJ5KTsgb3V0bGluZTogbm9uZTsgfQpidXR0b24geyB3aWR0aDogMTAwJTsgYmFja2dyb3VuZDogdmFyKC0tcHJpbWFyeSk7IGNvbG9yOiAjMDAwOyBmb250LXdlaWdodDogODAwOyBib3JkZXI6IG5vbmU7IHBhZGRpbmc6IDEycHg7IGJvcmRlci1yYWRpdXM6IDZweDsgY3Vyc29yOiBwb2ludGVyOyB0ZXh0LXRyYW5zZm9ybTogdXBwZXJjYXNlOyBsZXR0ZXItc3BhY2luZzogMXB4OyBtYXJnaW4tdG9wOiAxMHB4OyB0cmFuc2l0aW9uOiBvcGFjaXR5IDAuMnM7IH0KYnV0dG9uOmhvdmVyIHsgb3BhY2l0eTogMC45OyB9CmJ1dHRvbjpkaXNhYmxlZCB7IG9wYWNpdHk6IDAuNTsgY3Vyc29yOiBub3QtYWxsb3dlZDsgfQojcmVzdWx0LWFyZWEgeyBtYXJnaW4tdG9wOiAyMHB4OyBkaXNwbGF5OiBub25lOyBhbmltYXRpb246IGZhZGVJbiAwLjNzIGVhc2U7IH0KdGV4dGFyZWEgeyBoZWlnaHQ6IDEyMHB4OyBmb250LWZhbWlseTogbW9ub3NwYWNlOyBmb250LXNpemU6IDEycHg7IGxpbmUtaGVpZ2h0OiAxLjQ7IGNvbG9yOiAjYTVmM2ZjOyByZXNpemU6IHZlcnRpY2FsOyBib3JkZXItY29sb3I6ICMzMzM7IH0KLmFjdGlvbnMgeyBkaXNwbGF5OiBncmlkOyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IDFmciAxZnI7IGdhcDogMTBweDsgbWFyZ2luLXRvcDogNXB4OyB9Ci5zZWMtYnRuIHsgYmFja2dyb3VuZDogIzIyMjsgY29sb3I6ICNmZmY7IGZvbnQtd2VpZ2h0OiA2MDA7IGZvbnQtc2l6ZTogMTJweDsgfQouc2VjLWJ0bjpob3ZlciB7IGJhY2tncm91bmQ6ICMzMzM7IH0KQGtleWZyYW1lcyBmYWRlSW4geyBmcm9tIHsgb3BhY2l0eTogMDsgdHJhbnNmb3JtOiB0cmFuc2xhdGVZKDVweCk7IH0gdG8geyBvcGFjaXR5OiAxOyB0cmFuc2Zvcm06IHRyYW5zbGF0ZVkoMCk7IH0gfQouZXJyb3ItbXNnIHsgY29sb3I6ICNmZjQ0NDQ7IGZvbnQtc2l6ZTogMTJweDsgbWFyZ2luLXRvcDogMTBweDsgdGV4dC1hbGlnbjogY2VudGVyOyBkaXNwbGF5OiBub25lOyB9Cjwvc3R5bGU+CjwvaGVhZD4KPGJvZHk+CjxkaXYgY2xhc3M9ImNhcmQiPgogICAgPGgyPkFlZ2lyIPCfjIogPHNwYW4+djIuMzwvc3Bhbj48L2gyPgoKICAgIDxkaXYgY2xhc3M9Imdyb3VwIj4KICAgICAgICA8bGFiZWw+QnVnIElQIC8gU2VydmVyIEFkZHJlc3M8L2xhYmVsPgogICAgICAgIDxpbnB1dCBpZD0iYnVnIiB0eXBlPSJ0ZXh0IiBwbGFjZWhvbGRlcj0iZS5nLiAxMDQuMTYueC54IG9yIGNkbi5kb21haW4uY29tIj4KICAgIDwvZGl2PgoKICAgIDxkaXYgY2xhc3M9Imdyb3VwIj4KICAgICAgICA8bGFiZWw+U05JIC8gV2ViU29ja2V0IEhvc3Q8L2xhYmVsPgogICAgICAgIDxpbnB1dCBpZD0ic25pIiB0eXBlPSJ0ZXh0IiBwbGFjZWhvbGRlcj0iQXV0by1kZXRlY3QgKFdvcmtlciBIb3N0KSI+CiAgICA8L2Rpdj4KCiAgICA8ZGl2IHN0eWxlPSJkaXNwbGF5OiBncmlkOyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IDFmciAxZnI7IGdhcDogMTBweDsiPgogICAgICAgIDxkaXYgY2xhc3M9Imdyb3VwIj4KICAgICAgICAgICAgPGxhYmVsPkNvdW50cnkgKENDKTwvbGFiZWw+CiAgICAgICAgICAgIDxpbnB1dCBpZD0iY2MiIHR5cGU9InRleHQiIHBsYWNlaG9sZGVyPSJTRyxJRCI+CiAgICAgICAgPC9kaXY+CiAgICAgICAgPGRpdiBjbGFzcz0iZ3JvdXAiPgogICAgICAgICAgICA8bGFiZWw+TGltaXQ8L2xhYmVsPgogICAgICAgICAgICA8c2VsZWN0IGlkPSJsaW1pdCI+CiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPSIxIj5TaW5nbGU8L29wdGlvbj4KICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9IjEwIj5MaXN0ICgxMCk8L29wdGlvbj4KICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9IjUwIiBzZWxlY3RlZD5CdWxrICg1MCk8L29wdGlvbj4KICAgICAgICAgICAgPC9zZWxlY3Q+CiAgICAgICAgPC9kaXY+CiAgICA8L2Rpdj4KCiAgICA8ZGl2IGNsYXNzPSJncm91cCI+CiAgICAgICAgPGxhYmVsPk91dHB1dCBGb3JtYXQ8L2xhYmVsPgogICAgICAgIDxzZWxlY3QgaWQ9ImZtdCI+CiAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9InJhdyI+UmF3IFVSSSAoVkxFU1MvVHJvamFuKTwvb3B0aW9uPgogICAgICAgICAgICA8b3B0aW9uIHZhbHVlPSJ2MnJheSI+VjJSYXkgLyBYcmF5IChCYXNlNjQpPC9vcHRpb24+CiAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9ImNsYXNoIj5DbGFzaCBQcm92aWRlciAoWUFNTCk8L29wdGlvbj4KICAgICAgICA8L3NlbGVjdD4KICAgIDwvZGl2PgoKICAgIDxidXR0b24gaWQ9Im1haW4tYnRuIiBvbmNsaWNrPSJydW4oKSI+R2VuZXJhdGUgJiBGZXRjaCBDb25maWc8L2J1dHRvbj4KICAgIDxkaXYgaWQ9ImVycm9yIiBjbGFzcz0iZXJyb3ItbXNnIj48L2Rpdj4KCiAgICA8ZGl2IGlkPSJyZXN1bHQtYXJlYSI+CiAgICAgICAgPGxhYmVsPlJlc3VsdCBDb250ZW50PC9sYWJlbD4KICAgICAgICA8dGV4dGFyZWEgaWQ9Im91dHB1dCIgcmVhZG9ubHkgb25jbGljaz0idGhpcy5zZWxlY3QoKSI+PC90ZXh0YXJlYT4KICAgICAgICA8ZGl2IGNsYXNzPSJhY3Rpb25zIj4KICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz0ic2VjLWJ0biIgb25jbGljaz0iY29weSgpIj5Db3B5IEFsbDwvYnV0dG9uPgogICAgICAgICAgICA8YnV0dG9uIGNsYXNzPSJzZWMtYnRuIiBvbmNsaWNrPSJvcGVuVXJsKCkiPk9wZW4gTGluazwvYnV0dG9uPgogICAgICAgIDwvZGl2PgogICAgPC9kaXY+CjwvZGl2PgoKPHNjcmlwdD4KICAgIC8vIFBsYWNlaG9sZGVyIGxvZ2ljCiAgICBjb25zdCBob3N0ID0gbG9jYXRpb24uaG9zdG5hbWU7CiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYnVnJykucGxhY2Vob2xkZXIgPSBob3N0OwogICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NuaScpLnBsYWNlaG9sZGVyID0gaG9zdDsKCiAgICBhc3luYyBmdW5jdGlvbiBydW4oKSB7CiAgICAgICAgY29uc3QgYnRuID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ21haW4tYnRuJyk7CiAgICAgICAgY29uc3QgZXJyRGl2ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Vycm9yJyk7CiAgICAgICAgY29uc3QgcmVzRGl2ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Jlc3VsdC1hcmVhJyk7CiAgICAgICAgY29uc3Qgb3V0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ291dHB1dCcpOwoKICAgICAgICAvLyBSZXNldCBzdGF0ZQogICAgICAgIGJ0bi5kaXNhYmxlZCA9IHRydWU7CiAgICAgICAgYnRuLmlubmVyVGV4dCA9ICJQcm9jZXNzaW5nLi4uIjsKICAgICAgICBlcnJEaXYuc3R5bGUuZGlzcGxheSA9ICdub25lJzsKICAgICAgICByZXNEaXYuc3R5bGUuZGlzcGxheSA9ICdub25lJzsKICAgICAgICBvdXQudmFsdWUgPSAnJzsKCiAgICAgICAgdHJ5IHsKICAgICAgICAgICAgLy8gQnVpbGQgVVJMCiAgICAgICAgICAgIGNvbnN0IGJ1ZyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdidWcnKS52YWx1ZS50cmltKCk7CiAgICAgICAgICAgIGNvbnN0IHNuaSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzbmknKS52YWx1ZS50cmltKCk7CiAgICAgICAgICAgIGNvbnN0IGNjID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NjJykudmFsdWUudHJpbSgpOwogICAgICAgICAgICBjb25zdCBsaW1pdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsaW1pdCcpLnZhbHVlOwogICAgICAgICAgICBjb25zdCBmbXQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm10JykudmFsdWU7CgogICAgICAgICAgICBjb25zdCBwID0gbmV3IFVSTFNlYXJjaFBhcmFtcygpOwogICAgICAgICAgICBpZihidWcpIHAuYXBwZW5kKCdkb21haW4nLCBidWcpOwogICAgICAgICAgICBpZihzbmkpIHAuYXBwZW5kKCdzbmknLCBzbmkpOwogICAgICAgICAgICBpZihjYykgcC5hcHBlbmQoJ2NjJywgY2MudG9VcHBlckNhc2UoKSk7CiAgICAgICAgICAgIHAuYXBwZW5kKCdsaW1pdCcsIGxpbWl0KTsKCiAgICAgICAgICAgIGxldCBwYXRoID0gJy9hcGkvdjEvc3ViJzsKICAgICAgICAgICAgaWYoZm10ID09PSAnY2xhc2gnKSB7CiAgICAgICAgICAgICAgICBwYXRoID0gJy9zdWInOwogICAgICAgICAgICAgICAgcC5hcHBlbmQoJ2Zvcm1hdCcsICdjbGFzaCcpOwogICAgICAgICAgICAgICAgaWYoc25pKSBwLmFwcGVuZCgnaG9zdCcsIHNuaSk7CiAgICAgICAgICAgIH0gZWxzZSB7CiAgICAgICAgICAgICAgICBwLmFwcGVuZCgnZm9ybWF0JywgZm10KTsKICAgICAgICAgICAgfQoKICAgICAgICAgICAgY29uc3QgdGFyZ2V0VXJsID0gbG9jYXRpb24ub3JpZ2luICsgcGF0aCArICc/JyArIHAudG9TdHJpbmcoKTsKCiAgICAgICAgICAgIC8vIEZldGNoIGNvbnRlbnQKICAgICAgICAgICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTsKICAgICAgICAgICAgY29uc3QgdGltZW91dElkID0gc2V0VGltZW91dCgoKSA9PiBjb250cm9sbGVyLmFib3J0KCksIDE1MDAwKTsgLy8gMTVzIHRpbWVvdXQKCiAgICAgICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHRhcmdldFVybCwgeyBzaWduYWw6IGNvbnRyb2xsZXIuc2lnbmFsIH0pOwogICAgICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dElkKTsKCiAgICAgICAgICAgIGlmKCFyZXMub2spIHRocm93IG5ldyBFcnJvcihgSFRUUCAke3Jlcy5zdGF0dXN9YCk7CgogICAgICAgICAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzLnRleHQoKTsKCiAgICAgICAgICAgIC8vIFNob3cgcmVzdWx0CiAgICAgICAgICAgIG91dC52YWx1ZSA9IHRleHQ7CiAgICAgICAgICAgIHJlc0Rpdi5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJzsKICAgICAgICAgICAgd2luZG93LmdlbmVyYXRlZFVybCA9IHRhcmdldFVybDsgLy8gU3RvcmUgZm9yICJPcGVuIExpbmsiIGJ1dHRvbgoKICAgICAgICB9IGNhdGNoIChlKSB7CiAgICAgICAgICAgIGVyckRpdi5pbm5lclRleHQgPSBlLm5hbWUgPT09ICdBYm9ydEVycm9yJyA/ICdUaW1lb3V0OiBTZXJ2ZXIgdG9vayB0b28gbG9uZycgOiAnRXJyb3I6ICcgKyBlLm1lc3NhZ2U7CiAgICAgICAgICAgIGVyckRpdi5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJzsKICAgICAgICB9IGZpbmFsbHkgewogICAgICAgICAgICBidG4uZGlzYWJsZWQgPSBmYWxzZTsKICAgICAgICAgICAgYnRuLmlubmVyVGV4dCA9ICJHZW5lcmF0ZSAmIEZldGNoIENvbmZpZyI7CiAgICAgICAgfQogICAgfQoKICAgIGZ1bmN0aW9uIGNvcHkoKSB7CiAgICAgICAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnb3V0cHV0Jyk7CiAgICAgICAgZWwuc2VsZWN0KCk7CiAgICAgICAgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQoZWwudmFsdWUpOwogICAgICAgIGNvbnN0IGJ0biA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJy5hY3Rpb25zIGJ1dHRvbicpOwogICAgICAgIGNvbnN0IG9sZCA9IGJ0bi5pbm5lclRleHQ7CiAgICAgICAgYnRuLmlubmVyVGV4dCA9ICJDb3BpZWQhIjsKICAgICAgICBzZXRUaW1lb3V0KCgpID0+IGJ0bi5pbm5lclRleHQgPSBvbGQsIDE1MDApOwogICAgfQoKICAgIGZ1bmN0aW9uIG9wZW5VcmwoKSB7CiAgICAgICAgaWYod2luZG93LmdlbmVyYXRlZFVybCkgd2luZG93Lm9wZW4od2luZG93LmdlbmVyYXRlZFVybCwgJ19ibGFuaycpOwogICAgfQo8L3NjcmlwdD4KPC9ib2R5Pgo8L2h0bWw+";

// Helper functions
function getRequestKey(request) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  const paramKeys = ['offset', 'limit', 'cc', 'port', 'vpn', 'format', 'domain', 'prx-list', 'sni', 'host'];
  for (const key of paramKeys) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }
  return url.pathname + '?' + params.toString();
}

async function deduplicateRequest(request, handler) {
  if (request.method !== 'GET') return handler();
  const requestKey = getRequestKey(request);
  if (pendingRequests.has(requestKey)) {
    coalesceStats.hits++;
    coalesceStats.saved++;
    const result = await pendingRequests.get(requestKey);
    return result.clone();
  }
  if (pendingRequests.size >= 100) {
    const firstKey = pendingRequests.keys().next().value;
    pendingRequests.delete(firstKey);
  }
  coalesceStats.misses++;
  const promise = handler().then(response => {
    setTimeout(() => { if (pendingRequests.has(requestKey)) pendingRequests.delete(requestKey); }, 2000);
    return response;
  }).catch(err => { pendingRequests.delete(requestKey); throw err; });
  pendingRequests.set(requestKey, promise);
  return promise;
}

function getCacheKey(request) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  const paramKeys = ['offset', 'limit', 'cc', 'port', 'vpn', 'format', 'domain', 'prx-list', 'sni', 'host'];
  for (const key of paramKeys) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }
  const cacheUrl = new URL(url.origin + url.pathname);
  cacheUrl.search = params.toString();
  return new Request(cacheUrl.toString(), { method: 'GET', headers: request.headers });
}

async function handleCachedRequest(request, handler) {
  if (request.method !== 'GET') return handler();
  const cache = caches.default;
  const cacheKey = getCacheKey(request);
  let response = await cache.match(cacheKey);
  if (response) {
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('X-Cache-Status', 'HIT');
    return newResponse;
  }
  response = await handler();
  if (response.status === 200 && response.headers.has('Cache-Control')) {
    const responseToCache = response.clone();
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('X-Cache-Status', 'MISS');
    await cache.put(cacheKey, responseToCache); 
    return newResponse;
  }
  return response;
}

async function checkPrxHealth(prxIP, prxPort) {
  const req = await fetchWithDNS(`${PRX_HEALTH_CHECK_API}?ip=${prxIP}:${prxPort}`);
  return await req.json();
}

function addCacheHeaders(headers, ttl = 3600, browserTTL = 1800) {
  headers["Cache-Control"] = `public, max-age=${browserTTL}, s-maxage=${ttl}, stale-while-revalidate=86400`;
  headers["CDN-Cache-Control"] = `public, max-age=${ttl}`;
  headers["Cloudflare-CDN-Cache-Control"] = `max-age=${ttl}`;
  headers["Vary"] = "Accept-Encoding";
  headers["ETag"] = `"${Date.now().toString(36)}"`;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const appDomain = url.hostname;
      const serviceName = appDomain.split(".")[0];

      if (dnsCache && dnsCache.size === 0) ctx.waitUntil(prewarmDNS());
      if (Math.random() < 0.1) ctx.waitUntil(Promise.resolve().then(cleanupDNSCache));

      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader === "websocket") {
        const prxMatch = url.pathname.match(/^\/(.+[:=-]\d+)$/);
        let prxIP = "";
        if (url.pathname.length == 3 || url.pathname.match(",")) {
          const prxKeys = url.pathname.replace("/", "").toUpperCase().split(",");
          const prxKey = prxKeys[Math.floor(Math.random() * prxKeys.length)];
          const kvPrx = await getKVPrxList(KV_PRX_URL, env);
          if(kvPrx && kvPrx[prxKey]) {
            prxIP = kvPrx[prxKey][Math.floor(Math.random() * kvPrx[prxKey].length)];
          }
          return await websocketHandler(request, prxIP);
        } else if (prxMatch) {
          prxIP = prxMatch[1];
          return await websocketHandler(request, prxIP);
        }
      }

      // ROUTING LOGIC
      if (url.pathname === "/" || url.pathname === "/sub") {
        // Decode Base64 HTML with UTF-8 support
        const binary = atob(BASE64_HTML);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const html = new TextDecoder('utf-8').decode(bytes);

        return new Response(html, { 
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            // CRITICAL: Disable caching for WebUI to ensure updates propagate immediately
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
          }
        });
      } 
      
      else if (url.pathname.startsWith("/check")) {
         const target = url.searchParams.get("target")?.split(":") || [];
         if (target.length < 1) {
             return new Response(JSON.stringify({ error: "Invalid target" }), { status: 400 });
         }
        const resultPromise = checkPrxHealth(target[0], target[1] || "443");
        const result = await Promise.race([
          resultPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("Health check timeout")), 5000)),
        ]).catch(err => ({ error: err.message }));
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { ...CORS_HEADER_OPTIONS, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
        });
      } 
      
      else if (url.pathname.startsWith("/api/v1")) {
         const apiPath = url.pathname.replace("/api/v1", "");
         if (apiPath.startsWith("/sub")) {
          return deduplicateRequest(request, () => {
            return handleCachedRequest(request, async () => {
              const offset = +url.searchParams.get("offset") || 0;
              const filterCC = url.searchParams.get("cc")?.split(",") || [];
              const filterPort = url.searchParams.get("port")?.split(",").map(p => +p).filter(Boolean) || PORTS;
              const filterVPN = url.searchParams.get("vpn")?.split(",") || PROTOCOLS;
              const filterLimit = Math.min(+url.searchParams.get("limit") || MAX_CONFIGS_PER_REQUEST, MAX_CONFIGS_PER_REQUEST);
              const filterFormat = url.searchParams.get("format") || "raw";
              
              const fillerDomain = url.searchParams.get("domain") || appDomain;
              const customSNI = url.searchParams.get("sni") || url.searchParams.get("host") || appDomain;

              const prxBankUrl = url.searchParams.get("prx-list") || env.PRX_BANK_URL || PRX_BANK_URL;
              
              const { data: prxList, pagination } = await getPrxListPaginated(prxBankUrl, { offset, limit: filterLimit, filterCC }, env);
              const uuid = crypto.randomUUID();
              const ssUsername = btoa(`none:${uuid}`);
              const stats = formatStats();
              
              const responseHeaders = {
                ...CORS_HEADER_OPTIONS,
                "X-Pagination-Offset": offset.toString(),
                "X-Pagination-Limit": filterLimit.toString(),
                "X-Pagination-Total": pagination.total.toString(),
                "X-Pagination-Has-More": pagination.hasMore.toString(),
                "X-Pool-Stats": stats.pool,
                "X-Buffer-Stats": stats.buffer,
                "X-Timeout-Stats": stats.timeout,
                "X-Retry-Stats": stats.retry,
                "X-Batch-Stats": stats.batch,
                "X-Dedup-Stats": stats.dedup,
                "X-Streaming-Stats": stats.streaming,
                "X-DNS-Stats": stats.dns,
                "X-Worker-Optimizations": "OPT11-18-ACTIVE",
              };

              if (pagination.nextOffset !== null) responseHeaders["X-Pagination-Next-Offset"] = pagination.nextOffset.toString();

              if (filterFormat === "raw") {
                responseHeaders["Content-Type"] = "text/plain; charset=utf-8";
                responseHeaders["X-Streaming-Mode"] = "ACTIVE";
                addCacheHeaders(responseHeaders, 3600, 1800);
                const configStream = generateConfigsStream(prxList, filterPort, filterVPN, filterLimit, fillerDomain, uuid, ssUsername, customSNI, serviceName);
                return createStreamingResponse(configStream, responseHeaders, filterFormat);
              } else if (filterFormat === PROTOCOL_V2) {
                const result = [];
                const configStream = generateConfigsStream(prxList, filterPort, filterVPN, filterLimit, fillerDomain, uuid, ssUsername, customSNI, serviceName);
                for await (const config of configStream) result.push(config);
                const finalResult = btoa(result.join("\n"));
                responseHeaders["Content-Type"] = "text/plain; charset=utf-8";
                responseHeaders["X-Streaming-Mode"] = "BUFFERED";
                addCacheHeaders(responseHeaders, 3600, 1800);
                return new Response(finalResult, { status: 200, headers: responseHeaders });
              } else {
                 const result = [];
                 const configStream = generateConfigsStream(prxList, filterPort, filterVPN, filterLimit, fillerDomain, uuid, ssUsername, customSNI, serviceName);
                 for await (const config of configStream) result.push(config);
                 
                 const converterPromise = fetchWithDNS(CONVERTER_URL, {
                  method: "POST",
                  body: JSON.stringify({ url: result.join(","), format: filterFormat, template: "cf" }),
                 });
                 const res = await Promise.race([
                  converterPromise,
                  new Promise((_, reject) => setTimeout(() => reject(new Error("Converter timeout")), 8000)),
                 ]).catch(err => new Response(JSON.stringify({ error: "Converter service timeout" }), { status: 504, headers: { ...CORS_HEADER_OPTIONS, "Content-Type": "application/json" } }));
                 
                 if (res instanceof Response && res.status == 200) {
                  const finalResult = await res.text();
                  responseHeaders["Content-Type"] = res.headers.get("Content-Type") || "text/plain; charset=utf-8";
                  responseHeaders["X-Streaming-Mode"] = "CONVERTER";
                  addCacheHeaders(responseHeaders, 3600, 1800);
                  return new Response(finalResult, { status: 200, headers: responseHeaders });
                 } else {
                   return res instanceof Response ? res : new Response("Converter Error", { status: 502 });
                 }
              }
            });
          });
         } else if (apiPath.startsWith("/myip")) {
             return new Response(JSON.stringify({
              ip: request.headers.get("cf-connecting-ipv6") || request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip"),
              colo: request.headers.get("cf-ray")?.split("-")[1],
              ...request.cf,
            }), { headers: { ...CORS_HEADER_OPTIONS, "Content-Type": "application/json", "Cache-Control": "private, max-age=60" } });
         }
      }

      // Default to Reverse Proxy for unknown paths
      const targetReversePrx = env.REVERSE_PRX_TARGET || "example.com";
      return await reverseWeb(request, targetReversePrx);
    } catch (err) {
      console.error("Worker error:", err);
      return new Response(`An error occurred: ${err.toString()}`, { status: 500, headers: { ...CORS_HEADER_OPTIONS, "Content-Type": "text/plain; charset=utf-8" } });
    }
  },
};
