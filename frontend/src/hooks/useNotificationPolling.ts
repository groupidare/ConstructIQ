import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import type { AppNotification } from "@/types/notification";

const POLL_MS = 15000;

// No push/SSE/WebSocket infra exists in this app — same visibility-gated
// interval pattern as ActivityLogView.tsx's admin log poll, applied to the
// header bell so it shows real, role-scoped data without a manual refresh.
export function useNotificationPolling() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const { data } = await api.get<AppNotification[]>("/notifications/mine");
      setNotifications(data);
    } catch {
      // Silent — the bell just keeps showing its last-known state until the next successful poll.
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  async function markRead(id: number) {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, isRead: true } : n)));
    try { await api.put(`/notifications/${id}/read`); } catch { /* next poll reconciles */ }
  }

  async function markAllRead() {
    const unread = notifications.filter(n => !n.isRead);
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    await Promise.all(unread.map(n => api.put(`/notifications/${n.id}/read`).catch(() => {})));
  }

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return { notifications, unreadCount, markRead, markAllRead, refresh };
}
