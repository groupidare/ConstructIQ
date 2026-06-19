import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { clearAuth } from '@/lib/auth';
import api from '@/lib/api';
import type { LoginRequest } from '@/types/auth';

export function useAuth() {
  const { user, token, setAuth, logout: clearStore } = useAuthStore();
  const router = useRouter();

  async function login(credentials: LoginRequest) {
    const { data } = await api.post('/auth/login', credentials);
    setAuth(data.user, data.token);
    router.push('/');
  }

  function logout() {
    clearStore();
    clearAuth();
    router.push('/login');
  }

  return { user, token, login, logout, isAuthenticated: !!token };
}
