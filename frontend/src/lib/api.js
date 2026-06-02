import axios from "axios";

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
