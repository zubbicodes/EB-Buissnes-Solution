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
 * Why we can't just use <a href={url} download>: the Authorization Bearer token
 * lives in localStorage and is attached by the axios interceptor; a plain
 * anchor click bypasses axios and the browser only sends cookies (which are
 * unreliable under strict tracking-prevention / Safari ITP / Brave Shields).
 *
 * We fetch the file ourselves with the proper auth header, then defer the
 * actual "save to disk" to file-saver's `saveAs()`, which has accumulated
 * years of cross-browser fixes (Chrome download throttling, Safari quirks,
 * etc.) — vastly more reliable than a hand-rolled <a>.click() loop.
 *
 * @param {string} path  Path under /api (e.g. "/allocations/abc/export")
 * @param {string} filename  Suggested filename for the saved file
 */
export async function downloadAuthed(path, filename) {
  const url = `${API_BASE}${path}`;
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(url, { method: "GET", credentials: "include", headers });
  if (!res.ok) {
    const ct = res.headers.get("content-type") || "";
    let detail = "";
    try {
      if (ct.includes("application/json")) {
        const body = await res.json();
        detail = body?.detail || body?.message || JSON.stringify(body);
      } else {
        detail = await res.text();
      }
    } catch {
      detail = `HTTP ${res.status}`;
    }
    throw new Error(`Download failed (${res.status}): ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  const blob = await res.blob();
  saveAs(blob, filename);
}
