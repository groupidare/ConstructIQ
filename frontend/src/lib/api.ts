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
    if (error.response?.status === 401) {
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
