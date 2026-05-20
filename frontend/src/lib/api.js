import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

// On 401, try a single refresh; if that still 401s, send the user back to /signin.
let refreshInFlight = null;
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config || {};
    const status = error.response?.status;
    const url = original.url || "";
    const isAuthEndpoint =
      url.includes("/auth/login") ||
      url.includes("/auth/register") ||
      url.includes("/auth/refresh") ||
      url.includes("/auth/me");

    if (status === 401 && !original._retried && !isAuthEndpoint) {
      original._retried = true;
      try {
        if (!refreshInFlight) {
          refreshInFlight = api.post("/auth/refresh").finally(() => { refreshInFlight = null; });
        }
        await refreshInFlight;
        return api(original);
      } catch {
        // Refresh failed — surface a clean redirect to /signin instead of "Not authenticated".
        if (typeof window !== "undefined" && !/\/signin|\/signup|\/$/.test(window.location.pathname)) {
          window.location.href = "/signin";
        }
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
