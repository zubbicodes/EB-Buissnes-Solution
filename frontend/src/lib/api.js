import axios from "axios";
import { saveAs } from "file-saver";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

const TOKEN_KEY = "ebrr_access_token";

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}
export function setToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // keep cookies as a fallback
});

// Attach Authorization header on every request when we have a token.
api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${t}`;
  }
  return config;
});

// On 401 from any non-auth endpoint, clear the stale token so AuthContext can react.
// We DO NOT redirect here — React Router handles that via Protected when user becomes false.
api.interceptors.response.use(
  (r) => r,
  (error) => {
    const url = error?.config?.url || "";
    const status = error?.response?.status;
    const isAuthEndpoint = /\/auth\/(login|register|refresh|me|logout)/.test(url);
    if (status === 401 && !isAuthEndpoint) {
      setToken("");
      // soft signal to React: dispatch a custom event AuthContext will listen for.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("ebrr:logout"));
      }
    }
    return Promise.reject(error);
  }
);

export function formatError(err) {
  const d = err?.response?.data?.detail;
  if (d == null) return err?.message || "Something went wrong";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(", ");
  if (d?.message) return d.message;
  return JSON.stringify(d);
}

export const fmtGBP = (n) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(n || 0));


/**
 * Programmatic authenticated file download.
 *
 * Why this is non-trivial:
 *  - The Bearer token is in localStorage, so we can't use a plain <a href> link
 *    (it would be sent with no Authorization header and 401).
 *  - When the page is rendered inside a sandboxed iframe (e.g. the Emergent
 *    preview shell), Chrome silently blocks programmatic downloads from blob:
 *    URLs unless the parent set sandbox="... allow-downloads ...". The fetch
 *    + saveAs() approach therefore works in a regular browser tab but not in
 *    the embedded preview.
 *
 * Strategy:
 *  1. Open a same-origin popup IMMEDIATELY (while we still hold user
 *     activation). This popup is a top-level browsing context, NOT subject
 *     to the parent iframe's sandbox — downloads inside it just work.
 *  2. The popup runs its own fetch with the Bearer token, creates a blob,
 *     and triggers the download via an anchor click. Then closes itself.
 *  3. If popup_blocked OR we're already top-level, fall back to in-page
 *     file-saver, which is the right thing for normal browser tabs.
 *
 * Side benefit: works identically in iframes and top-level tabs.
 *
 * @param {string} path  Path under /api (e.g. "/allocations/abc/export")
 * @param {string} filename  Suggested filename for the saved file
 */
export async function downloadAuthed(path, filename) {
  const url = `${API_BASE}${path}`;
  const token = getToken() || "";
  const inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();

  // 1) In-iframe → route through a popup window (top-level browsing context).
  if (inIframe) {
    let popup = null;
    try { popup = window.open("", "_blank"); } catch { popup = null; }
    if (popup && !popup.closed) {
      // Write a tiny page that does the auth'd fetch and triggers the
      // download itself. JSON.stringify safely embeds the values (escapes
      // </script>, quotes, etc.).
      const html = `<!doctype html><html><head><title>Downloading…</title>
<style>body{font-family:system-ui,sans-serif;padding:2rem;background:#f8fafc;color:#0f172a}
.err{color:#b91c1c;background:#fee2e2;border:1px solid #fecaca;padding:.75rem 1rem;border-radius:.5rem;margin-top:1rem}
.ok{color:#065f46}</style></head><body>
<h3>Preparing ${filename.replace(/[<>&]/g, "")}…</h3>
<p id="status">Fetching file…</p>
<script>
(async () => {
  try {
    const res = await fetch(${JSON.stringify(url)}, {
      credentials: 'include',
      headers: ${JSON.stringify(token ? { Authorization: `Bearer ${token}` } : {})},
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      document.getElementById('status').className = 'err';
      document.getElementById('status').textContent = 'Download failed (HTTP ' + res.status + '): ' + t.slice(0, 300);
      return;
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = ${JSON.stringify(filename)};
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.getElementById('status').className = 'ok';
    document.getElementById('status').textContent = 'Download started — saving as ' + ${JSON.stringify(filename)} + '. You can close this tab.';
    setTimeout(() => { try { window.close(); } catch (e) {} }, 1500);
  } catch (e) {
    document.getElementById('status').className = 'err';
    document.getElementById('status').textContent = 'Download error: ' + (e && e.message ? e.message : String(e));
  }
})();
</script></body></html>`;
      popup.document.open();
      popup.document.write(html);
      popup.document.close();
      return;
    }
    // Popup was blocked → fall through to in-page path with a hint.
  }

  // 2) Top-level (or popup blocked) → fetch + file-saver in-page.
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: "GET", credentials: "include", headers });
  if (!res.ok) {
    let detail = "";
    try {
      const raw = await res.text();
      try {
        const j = JSON.parse(raw);
        detail = j?.detail || j?.message || raw;
      } catch {
        detail = raw;
      }
    } catch {
      detail = `HTTP ${res.status}`;
    }
    if (!detail) detail = `HTTP ${res.status}`;
    throw new Error(`Download failed (${res.status}): ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  const blob = await res.blob();
  saveAs(blob, filename);
  if (inIframe) {
    throw new Error("Your browser blocked the popup. Please allow popups for this site and try again — exports use a popup tab to bypass the preview iframe.");
  }
}
