import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/types/auth";
import { clearAuth, setToken } from "@/lib/auth";

interface AuthStore {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      setAuth: (user, token) => {
        setToken(token);
        set({ user, token, isAuthenticated: true });
      },
      logout: () => {
        clearAuth();
        set({ user: null, token: null, isAuthenticated: false });
      },
    }),
    { name: "auth-storage" }
  )
);
