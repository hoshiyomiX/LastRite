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

// Base64 Encoded WebUI v2.2 (Improved UI + Fetch Logic)
const BASE64_HTML = "PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9ImVuIj4KPGhlYWQ+CjxtZXRhIGNoYXJzZXQ9IlVURi04Ij4KPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xLjAiPgo8dGl0bGU+QWVnaXIgQ29uZmlnIEdlbmVyYXRvcjwvdGl0bGU+CjxzdHlsZT4KOnJvb3QgeyAtLXByaW1hcnk6ICMwMGYyZWE7IC0tYmc6ICMwYTBhMGE7IC0tcGFuZWw6ICMxNjE2MTY7IC0tdGV4dDogI2UwZTBlMDsgLS1ib3JkZXI6ICMzMzM7IH0KYm9keSB7IGJhY2tncm91bmQ6IHZhcigtLWJnKTsgY29sb3I6IHZhcigtLXRleHQpOyBmb250LWZhbWlseTogJ1NlZ29lIFVJJywgc3lzdGVtLXVpLCBzYW5zLXNlcmlmOyBkaXNwbGF5OiBmbGV4OyBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjsgYWxpZ24taXRlbXM6IGNlbnRlcjsgbWluLWhlaWdodDogMTAwdmg7IG1hcmdpbjogMDsgcGFkZGluZzogMTVweDsgfQouY2FyZCB7IGJhY2tncm91bmQ6IHZhcigtLXBhbmVsKTsgd2lkdGg6IDEwMCU7IG1heC13aWR0aDogNDgwcHg7IHBhZGRpbmc6IDJyZW07IGJvcmRlci1yYWRpdXM6IDE2cHg7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJvcmRlcik7IGJveC1zaGFkb3c6IDAgOHB4IDMycHggcmdiYSgwLDAsMCwwLjUpOyB9CmgyIHsgdGV4dC1hbGlnbjogY2VudGVyOyBtYXJnaW46IDAgMCAxLjVyZW07IGNvbG9yOiB2YXIoLS1wcmltYXJ5KTsgbGV0dGVyLXNwYWNpbmc6IDFweDsgZm9udC13ZWlnaHQ6IDcwMDsgdGV4dC10cmFuc2Zvcm06IHVwcGVyY2FzZTsgfQouZm9ybS1ncmlkIHsgZGlzcGxheTogZ3JpZDsgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOiAxZnIgMWZyOyBnYXA6IDEycHg7IH0KLmZ1bGwtd2lkdGggeyBncmlkLWNvbHVtbjogc3BhbiAyOyB9CmxhYmVsIHsgZGlzcGxheTogYmxvY2s7IG1hcmdpbi1ib3R0b206IDZweDsgZm9udC1zaXplOiAwLjc1cmVtOyBjb2xvcjogIzg4ODsgdGV4dC10cmFuc2Zvcm06IHVwcGVyY2FzZTsgZm9udC13ZWlnaHQ6IDYwMDsgbGV0dGVyLXNwYWNpbmc6IDAuNXB4OyB9CmlucHV0LCBzZWxlY3QsIGJ1dHRvbiwgdGV4dGFyZWEgeyB3aWR0aDogMTAwJTsgYmFja2dyb3VuZDogIzAwMDsgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tYm9yZGVyKTsgY29sb3I6ICNmZmY7IHBhZGRpbmc6IDEycHg7IGJvcmRlci1yYWRpdXM6IDhweDsgZm9udC1zaXplOiAwLjlyZW07IGJveC1zaXppbmc6IGJvcmRlci1ib3g7IHRyYW5zaXRpb246IDAuMnM7IH0KaW5wdXQ6Zm9jdXMsIHNlbGVjdDpmb2N1cywgdGV4dGFyZWE6Zm9jdXMgeyBvdXRsaW5lOiBub25lOyBib3JkZXItY29sb3I6IHZhcigtLXByaW1hcnkpOyBib3gtc2hhZG93OiAwIDAgMCAycHggcmdiYSgwLCAyNDIsIDIzNCwgMC4xKTsgfQpidXR0b24geyBiYWNrZ3JvdW5kOiB2YXIoLS1wcmltYXJ5KTsgY29sb3I6ICMwMDA7IGZvbnQtd2VpZ2h0OiA3MDA7IGJvcmRlcjogbm9uZTsgY3Vyc29yOiBwb2ludGVyOyBtYXJnaW4tdG9wOiAxcmVtOyB0ZXh0LXRyYW5zZm9ybTogdXBwZXJjYXNlOyBsZXR0ZXItc3BhY2luZzogMC41cHg7IH0KYnV0dG9uOmhvdmVyIHsgb3BhY2l0eTogMC45OyB0cmFuc2Zvcm06IHRyYW5zbGF0ZVkoLTFweCk7IH0KYnV0dG9uOmRpc2FibGVkIHsgb3BhY2l0eTogMC41OyBjdXJzb3I6IHdhaXQ7IH0KI3Jlc3VsdC1jb250YWluZXIgeyBtYXJnaW4tdG9wOiAxLjVyZW07IGRpc3BsYXk6IG5vbmU7IG9wYWNpdHk6IDA7IHRyYW5zaXRpb246IG9wYWNpdHkgMC4zczsgfQp0ZXh0YXJlYSB7IGZvbnQtZmFtaWx5OiAnQ29uc29sYXMnLCBtb25vc3BhY2U7IGZvbnQtc2l6ZTogMC44cmVtOyBsaW5lLWhlaWdodDogMS40OyBjb2xvcjogI2E1ZjNmYzsgaGVpZ2h0OiAxNTBweDsgcmVzaXplOiB2ZXJ0aWNhbDsgbWFyZ2luLWJvdHRvbTogMC41cmVtOyB9Ci5jb3B5LWJ0biB7IGJhY2tncm91bmQ6ICMzMzM7IGNvbG9yOiAjZmZmOyBtYXJnaW4tdG9wOiAwOyBmb250LXNpemU6IDAuOHJlbTsgcGFkZGluZzogOHB4OyB9Ci5jb3B5LWJ0bjpob3ZlciB7IGJhY2tncm91bmQ6ICM0NDQ7IH0KLnN0YXR1cy1iYXIgeyBmb250LXNpemU6IDAuOHJlbTsgdGV4dC1hbGlnbjogY2VudGVyOyBtYXJnaW4tdG9wOiAxMHB4OyBjb2xvcjogIzY2NjsgbWluLWhlaWdodDogMS4yZW07IH0KPC9zdHlsZT4KPC9oZWFkPgo8Ym9keT4KPGRpdiBjbGFzcz0iY2FyZCI+CiAgICA8aDI+QWVnaXIg8J+MiiA8c3BhbiBzdHlsZT0iZm9udC1zaXplOjAuNWVtOyBvcGFjaXR5OjAuNSI+djIuMjwvc3Bhbj48L2gyPgogICAgPGRpdiBjbGFzcz0iZm9ybS1ncmlkIj4KICAgICAgICA8ZGl2IGNsYXNzPSJmdWxsLXdpZHRoIj4KICAgICAgICAgICAgPGxhYmVsPkJ1ZyBJUCAvIEFkZHJlc3MgKFNlcnZlcik8L2xhYmVsPgogICAgICAgICAgICA8aW5wdXQgaWQ9ImJ1ZyIgdHlwZT0idGV4dCIgcGxhY2Vob2xkZXI9IkF1dG8tZGV0ZWN0IChGaWxsZXIgRG9tYWluKSI+CiAgICAgICAgPC9kaXY+CiAgICAgICAgPGRpdiBjbGFzcz0iZnVsbC13aWR0aCI+CiAgICAgICAgICAgIDxsYWJlbD5TTkkgLyBXUyBIb3N0IChIZWFkZXIpPC9sYWJlbD4KICAgICAgICAgICAgPGlucHV0IGlkPSJzbmkiIHR5cGU9InRleHQiIHBsYWNlaG9sZGVyPSJBdXRvLWRldGVjdCAoV29ya2VyIERvbWFpbikiPgogICAgICAgIDwvZGl2PgogICAgICAgIDxkaXY+CiAgICAgICAgICAgIDxsYWJlbD5Db3VudHJ5IEZpbHRlcjwvbGFiZWw+CiAgICAgICAgICAgIDxpbnB1dCBpZD0iY2MiIHR5cGU9InRleHQiIHBsYWNlaG9sZGVyPSJlLmcuIFNHLElELEpQIj4KICAgICAgICA8L2Rpdj4KICAgICAgICA8ZGl2PgogICAgICAgICAgICA8bGFiZWw+Q29uZmlnIExpbWl0PC9sYWJlbD4KICAgICAgICAgICAgPHNlbGVjdCBpZD0ibGltaXQiPgogICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT0iMSI+U2luZ2xlICgxKTwvb3B0aW9uPgogICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT0iNSI+U21hbGwgKDUpPC9vcHRpb24+CiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPSIxMCI+TGlzdCAoMTApPC9vcHRpb24+CiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPSI1MCIgc2VsZWN0ZWQ+QnVsayAoNTApPC9vcHRpb24+CiAgICAgICAgICAgIDwvc2VsZWN0PgogICAgICAgIDwvZGl2PgogICAgICAgIDxkaXYgY2xhc3M9ImZ1bGwtd2lkdGgiPgogICAgICAgICAgICA8bGFiZWw+T3V0cHV0IEZvcm1hdDwvbGFiZWw+CiAgICAgICAgICAgIDxzZWxlY3QgaWQ9ImZtdCI+CiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPSJyYXciPlJhdyBVUkkgKFZMRVNTL1Ryb2phbi9TUyk8L29wdGlvbj4KICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9InYycmF5Ij5WMlJheSAvIFhyYXkgKEJhc2U2NCk8L29wdGlvbj4KICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9ImNsYXNoIj5DbGFzaCBQcm92aWRlciAoWUFNTCk8L29wdGlvbj4KICAgICAgICAgICAgPC9zZWxlY3Q+CiAgICAgICAgPC9kaXY+CiAgICA8L2Rpdj4KICAgIDxidXR0b24gaWQ9Imdlbi1idG4iIG9uY2xpY2s9ImdlbmVyYXRlQ29uZmlnKCkiPkdlbmVyYXRlICYgRmV0Y2g8L2J1dHRvbj4KICAgIDxkaXYgY2xhc3M9InN0YXR1cy1iYXIiIGlkPSJzdGF0dXMiPjwvZGl2PgoKICAgIDxkaXYgaWQ9InJlc3VsdC1jb250YWluZXIiPgogICAgICAgIDxsYWJlbD5HZW5lcmF0ZWQgQ29uZmlndXJhdGlvbjwvbGFiZWw+CiAgICAgICAgPHRleHRhcmVhIGlkPSJvdXRwdXQiIHJlYWRvbmx5IG9uY2xpY2s9InRoaXMuc2VsZWN0KCkiPjwvdGV4dGFyZWE+CiAgICAgICAgPGJ1dHRvbiBjbGFzcz0iY29weS1idG4iIG9uY2xpY2s9ImNvcHlUb0NsaXBib2FyZCgpIj5Db3B5IHRvIENsaXBib2FyZDwvYnV0dG9uPgogICAgPC9kaXY+CjwvZGl2PgoKPHNjcmlwdD4KICAgIC8vIEluaXQgcGxhY2Vob2xkZXJzCiAgICBjb25zdCBob3N0bmFtZSA9IHdpbmRvdy5sb2NhdGlvbi5ob3N0bmFtZTsKICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdidWcnKS5wbGFjZWhvbGRlciA9IGhvc3RuYW1lOwogICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NuaScpLnBsYWNlaG9sZGVyID0gaG9zdG5hbWU7CgogICAgYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVDb25maWcoKSB7CiAgICAgICAgY29uc3QgYnRuID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2dlbi1idG4nKTsKICAgICAgICBjb25zdCBzdGF0dXMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc3RhdHVzJyk7CiAgICAgICAgY29uc3QgY29udGFpbmVyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Jlc3VsdC1jb250YWluZXInKTsKICAgICAgICBjb25zdCBvdXRwdXQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnb3V0cHV0Jyk7CgogICAgICAgIC8vIFVJIFN0YXRlOiBMb2FkaW5nCiAgICAgICAgYnRuLmRpc2FibGVkID0gdHJ1ZTsKICAgICAgICBidG4uaW5uZXJUZXh0ID0gIkZldGNoaW5nLi4uIjsKICAgICAgICBzdGF0dXMuaW5uZXJUZXh0ID0gIlJlcXVlc3RpbmcgY29uZmlndXJhdGlvbiBmcm9tIHdvcmtlci4uLiI7CiAgICAgICAgY29udGFpbmVyLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7CiAgICAgICAgY29udGFpbmVyLnN0eWxlLm9wYWNpdHkgPSAnMCc7CgogICAgICAgIC8vIEdhdGhlciBwYXJhbXMKICAgICAgICBjb25zdCBidWcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYnVnJykudmFsdWUudHJpbSgpOwogICAgICAgIGNvbnN0IHNuaSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzbmknKS52YWx1ZS50cmltKCk7CiAgICAgICAgY29uc3QgY2MgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2MnKS52YWx1ZS50cmltKCk7CiAgICAgICAgY29uc3QgbGltaXQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbGltaXQnKS52YWx1ZTsKICAgICAgICBjb25zdCBmbXQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZm10JykudmFsdWU7CgogICAgICAgIGNvbnN0IHBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoKTsKICAgICAgICBpZiAoYnVnKSBwYXJhbXMuYXBwZW5kKCdkb21haW4nLCBidWcpOwogICAgICAgIGlmIChzbmkpIHBhcmFtcy5hcHBlbmQoJ3NuaScsIHNuaSk7IC8vIEJhY2tlbmQgbWFwcyAnc25pJyB0byBhcHBEb21haW4vaG9zdAogICAgICAgIGlmIChjYykgcGFyYW1zLmFwcGVuZCgnY2MnLCBjYy50b1VwcGVyQ2FzZSgpKTsKICAgICAgICBwYXJhbXMuYXBwZW5kKCdsaW1pdCcsIGxpbWl0KTsKCiAgICAgICAgLy8gRGV0ZXJtaW5lIGVuZHBvaW50CiAgICAgICAgbGV0IGVuZHBvaW50ID0gJy9hcGkvdjEvc3ViJzsKICAgICAgICBpZiAoZm10ID09PSAnY2xhc2gnKSB7CiAgICAgICAgICAgIGVuZHBvaW50ID0gJy9zdWInOwogICAgICAgICAgICBwYXJhbXMuYXBwZW5kKCdmb3JtYXQnLCAnY2xhc2gnKTsKICAgICAgICAgICAgLy8gQ2xhc2ggZW5kcG9pbnQgbGVnYWN5IGNvbXBhdAogICAgICAgICAgICBpZiAoc25pKSBwYXJhbXMuYXBwZW5kKCdob3N0Jywgc25pKTsKICAgICAgICB9IGVsc2UgewogICAgICAgICAgICBwYXJhbXMuYXBwZW5kKCdmb3JtYXQnLCBmbXQpOwogICAgICAgIH0KCiAgICAgICAgdHJ5IHsKICAgICAgICAgICAgY29uc3QgdXJsID0gYCR7d2luZG93LmxvY2F0aW9uLm9yaWdpbn0ke2VuZHBvaW50fT8ke3BhcmFtcy50b1N0cmluZygpfWA7CiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsKTsKCiAgICAgICAgICAgIGlmICghcmVzcG9uc2Uub2spIHRocm93IG5ldyBFcnJvcihgU2VydmVyIHJldHVybmVkICR7cmVzcG9uc2Uuc3RhdHVzfWApOwoKICAgICAgICAgICAgY29uc3QgdGV4dCA9IGF3YWl0IHJlc3BvbnNlLnRleHQoKTsKCiAgICAgICAgICAgIC8vIFN1Y2Nlc3MKICAgICAgICAgICAgb3V0cHV0LnZhbHVlID0gdGV4dDsKICAgICAgICAgICAgY29udGFpbmVyLnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snOwogICAgICAgICAgICAvLyBUcmlnZ2VyIHJlZmxvdwogICAgICAgICAgICB2b2lkIGNvbnRhaW5lci5vZmZzZXRXaWR0aDsKICAgICAgICAgICAgY29udGFpbmVyLnN0eWxlLm9wYWNpdHkgPSAnMSc7CiAgICAgICAgICAgIHN0YXR1cy5pbm5lclRleHQgPSBgU3VjY2VzcyEgbG9hZGVkICR7dGV4dC5sZW5ndGh9IGJ5dGVzLmA7CiAgICAgICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgICAgICAgIHN0YXR1cy5pbm5lclRleHQgPSBgRXJyb3I6ICR7ZXJyLm1lc3NhZ2V9YDsKICAgICAgICAgICAgYWxlcnQoIkZhaWxlZCB0byBmZXRjaCBjb25maWc6ICIgKyBlcnIubWVzc2FnZSk7CiAgICAgICAgfSBmaW5hbGx5IHsKICAgICAgICAgICAgYnRuLmRpc2FibGVkID0gZmFsc2U7CiAgICAgICAgICAgIGJ0bi5pbm5lclRleHQgPSAiR2VuZXJhdGUgJiBGZXRjaCI7CiAgICAgICAgfQogICAgfQoKICAgIGZ1bmN0aW9uIGNvcHlUb0NsaXBib2FyZCgpIHsKICAgICAgICBjb25zdCBjb3B5VGV4dCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJvdXRwdXQiKTsKICAgICAgICBjb3B5VGV4dC5zZWxlY3QoKTsKICAgICAgICBjb3B5VGV4dC5zZXRTZWxlY3Rpb25SYW5nZSgwLCA5OTk5OSk7CiAgICAgICAgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQoY29weVRleHQudmFsdWUpLnRoZW4oKCkgPT4gewogICAgICAgICAgICBjb25zdCBidG4gPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcuY29weS1idG4nKTsKICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWwgPSBidG4uaW5uZXJUZXh0OwogICAgICAgICAgICBidG4uaW5uZXJUZXh0ID0gIkNvcGllZCEiOwogICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IGJ0bi5pbm5lclRleHQgPSBvcmlnaW5hbCwgMjAwMCk7CiAgICAgICAgfSk7CiAgICB9Cjwvc2NyaXB0Pgo8L2JvZHk+CjwvaHRtbD4=";

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
        // Decode Base64 HTML at runtime to bypass parser errors
        const html = atob(BASE64_HTML);
        return new Response(html, { 
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=3600"
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
