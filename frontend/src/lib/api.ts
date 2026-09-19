import axios from "axios";
import Cookies from "js-cookie";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = Cookies.get("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
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

export default api;
