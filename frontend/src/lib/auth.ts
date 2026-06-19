import Cookies from "js-cookie";
import type { User } from "@/types/auth";

export function getToken(): string | undefined {
  return Cookies.get("token");
}

export function setToken(token: string): void {
  Cookies.set("token", token, { expires: 1, secure: true, sameSite: "strict" });
}

export function removeToken(): void {
  Cookies.remove("token");
  Cookies.remove("user");
}

export function getStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("user");
  return raw ? (JSON.parse(raw) as User) : null;
}

export function setStoredUser(user: User): void {
  localStorage.setItem("user", JSON.stringify(user));
}

export function clearAuth(): void {
  removeToken();
  localStorage.removeItem("user");
}
