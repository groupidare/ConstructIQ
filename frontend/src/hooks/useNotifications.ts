import { useState } from 'react';
import api from '@/lib/api';
import type { AppNotification, NotificationCreateRequest } from '@/types/notification';

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading]              = useState(false);
  const [error, setError]                  = useState<string | null>(null);

  async function fetchMine() {
    setLoading(true);
    try {
      const { data } = await api.get<AppNotification[]>('/notifications/mine');
      setNotifications(data);
    } catch {
      setError('Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  }

  async function sendNotification(payload: NotificationCreateRequest): Promise<AppNotification> {
    const { data } = await api.post<AppNotification>('/notifications', payload);
    return data;
  }

  async function markRead(id: number) {
    await api.put(`/notifications/${id}/read`);
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, isRead: true } : n)));
  }

  return { notifications, loading, error, fetchMine, sendNotification, markRead };
}
