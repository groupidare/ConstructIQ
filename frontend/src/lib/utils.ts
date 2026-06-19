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

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-PH", {
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
