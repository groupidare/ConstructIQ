import { create } from "zustand";
import { AlertTriangle, ShoppingCart, TrendingUp, Package, CheckCircle, CloudRain, Truck, type LucideIcon } from "lucide-react";

export type AlertKind = "critical" | "delay" | "forecast" | "overstock" | "approved" | "lowstock" | "weather" | "supplier";

export interface AlertItem {
  id: string;
  kind: AlertKind;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  dedupeKey?: string;
}

export const ALERT_ICON_STYLES: Record<AlertKind, { icon: LucideIcon; color: string; bg: string }> = {
  critical:  { icon: AlertTriangle, color: "#ef4444", bg: "#fee2e2" },
  delay:     { icon: ShoppingCart,  color: "#f97316", bg: "#ffedd5" },
  forecast:  { icon: TrendingUp,    color: "#3b82f6", bg: "#dbeafe" },
  overstock: { icon: Package,       color: "#f59e0b", bg: "#fef3c7" },
  approved:  { icon: CheckCircle,   color: "#22c55e", bg: "#dcfce7" },
  lowstock:  { icon: AlertTriangle, color: "#f59e0b", bg: "#fef3c7" },
  weather:   { icon: CloudRain,     color: "#0284c7", bg: "#e0f2fe" },
  supplier:  { icon: Truck,         color: "#dc2626", bg: "#fee2e2" },
};

const now = Date.now();

const INITIAL_ALERTS: AlertItem[] = [
  { id: "seed-1", kind: "critical",  title: "Critical Stock Alert",   body: "Portland Cement has dropped below minimum threshold (48 bags remaining).",         createdAt: now - 2 * 60_000,       read: false },
  { id: "seed-2", kind: "delay",     title: "PO Delayed",             body: "PO-2025-0839 from PhilCon Aggregates is now 6 days overdue.",                      createdAt: now - 18 * 60_000,      read: false },
  { id: "seed-3", kind: "forecast",  title: "AI Forecast Updated",    body: "Demand forecast for Cement (+18.4%) and Steel (+12.1%) updated for next 30 days.", createdAt: now - 60 * 60_000,      read: false },
  { id: "seed-4", kind: "overstock", title: "Overstock Warning",      body: "PVC Pipes (2,800 units) exceed maximum threshold at BGC Tower Complex.",           createdAt: now - 3 * 60 * 60_000,  read: true  },
  { id: "seed-5", kind: "approved",  title: "Procurement Approved",   body: "PO-2025-0844 for Deformed Steel Bars has been approved by Ana Bonifacio.",         createdAt: now - 24 * 60 * 60_000, read: true  },
  { id: "seed-6", kind: "lowstock",  title: "Low Stock — CHB 4 inch", body: "CHB 4 inch at Metro Station Phase 3 is at 12% of minimum stock level.",            createdAt: now - 26 * 60 * 60_000, read: true  },
];

function generateId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface AddAlertInput {
  kind: AlertKind;
  title: string;
  body: string;
  /** Skip inserting if an alert with this key already exists — prevents re-triggering the same weather/delay alert on every re-render. */
  dedupeKey?: string;
}

interface AlertStore {
  alerts: AlertItem[];
  markRead: (id: string) => void;
  markAllRead: () => void;
  addAlert: (input: AddAlertInput) => void;
}

export const useAlertStore = create<AlertStore>((set, get) => ({
  alerts: INITIAL_ALERTS,

  markRead(id) {
    set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, read: true } : a)) }));
  },

  markAllRead() {
    set((s) => ({ alerts: s.alerts.map((a) => ({ ...a, read: true })) }));
  },

  addAlert(input) {
    const { alerts } = get();
    if (input.dedupeKey && alerts.some((a) => a.dedupeKey === input.dedupeKey)) return;
    const alert: AlertItem = {
      id: generateId(),
      kind: input.kind,
      title: input.title,
      body: input.body,
      dedupeKey: input.dedupeKey,
      createdAt: Date.now(),
      read: false,
    };
    set((s) => ({ alerts: [alert, ...s.alerts].slice(0, 40) }));
  },
}));
