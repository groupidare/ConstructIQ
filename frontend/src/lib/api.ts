import axios from "axios";
import Cookies from "js-cookie";

// How many GET requests are still on their way — read by the page preloader
// (components/layout/PageDataLoader) to know when a page's data has arrived.
let pendingGets = 0;
const pendingListeners = new Set<(count: number) => void>();
function setPending(delta: number) {
  pendingGets = Math.max(0, pendingGets + delta);
  pendingListeners.forEach(l => l(pendingGets));
}
export function getPendingGets(): number { return pendingGets; }
export function onPendingGetsChange(listener: (count: number) => void): () => void {
  pendingListeners.add(listener);
  return () => { pendingListeners.delete(listener); };
}
type TrackedConfig = { __tracked?: boolean };
function untrack(config?: TrackedConfig) {
  if (config?.__tracked) { config.__tracked = false; setPending(-1); }
}

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = Cookies.get("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if ((config.method ?? "get").toLowerCase() === "get") {
    (config as TrackedConfig).__tracked = true;
    setPending(1);
  }
  return config;
});

api.interceptors.response.use(
  (res) => { untrack(res.config as TrackedConfig); return res; },
  (error) => {
    untrack(error.config as TrackedConfig);
    // A 401 from the auth endpoints themselves just means "wrong credentials"
    // or "unregistered account" — there's no session to expire yet, so force-
    // redirecting here would wipe the page (and any error message) before the
    // login form ever got to show it. Only treat 401s from already-authenticated
    // requests as a dead session.
    const url: string = error.config?.url ?? "";
    if (error.response?.status === 401 && !url.startsWith("/auth")) {
      Cookies.remove("token");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

// Static files (uploaded blueprints/BOQ docs) are served from the API's origin,
// not under "/api" — strip that suffix to get a fetchable base for relative Urls.
export function getApiOrigin(): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";
  return base.replace(/\/api\/?$/, "");
}

export default api;
