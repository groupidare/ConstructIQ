import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(amount);
}

// The backend serializes DateTime values (always UTC — DateTime.UtcNow) with
// no "Z"/offset suffix, which the Date constructor otherwise treats as LOCAL
// time — silently showing the wrong calendar day for anything created
// between local midnight and however many hours ahead of UTC the viewer's
// timezone is (e.g. up to 8am in Manila/UTC+8). A bare "YYYY-MM-DD" (no time
// component) is already unambiguous — the spec always treats that form as
// UTC — so it's left alone.
function parseServerDate(dateStr: string): Date {
  const hasTime = dateStr.includes("T");
  const hasZone = /Z$|[+-]\d{2}:\d{2}$/.test(dateStr);
  return new Date(hasTime && !hasZone ? `${dateStr}Z` : dateStr);
}

export function formatDate(dateStr: string): string {
  return parseServerDate(dateStr).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function getRiskColor(risk: string): string {
  const map: Record<string, string> = {
    Low: "text-green-600",
    Medium: "text-yellow-600",
    High: "text-orange-600",
    Critical: "text-red-600",
  };
  return map[risk] ?? "text-gray-600";
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    Active: "bg-green-100 text-green-800",
    Planning: "bg-blue-100 text-blue-800",
    OnHold: "bg-yellow-100 text-yellow-800",
    Completed: "bg-gray-100 text-gray-800",
    Cancelled: "bg-red-100 text-red-800",
  };
  return map[status] ?? "bg-gray-100 text-gray-800";
}
