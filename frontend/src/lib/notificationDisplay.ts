import {
  CloudRain, WifiOff, Truck, ShoppingCart, PackageCheck, Star, Users, ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import type { NotificationKind } from "@/types/notification";

export type NotificationBucket = "WEATHER" | "REDISTRIBUTION" | "PROCUREMENT" | "SYSTEM";

interface KindMeta {
  bucket: NotificationBucket;
  icon: LucideIcon;
  color: string;
  bg: string;
}

// Groups the backend's flat NotificationKind enum into the four display
// buckets the RBAC spec asks for — display-only, no matching backend column.
export const NOTIFICATION_KIND_META: Record<NotificationKind, KindMeta> = {
  Weather:                     { bucket: "WEATHER",       icon: CloudRain,    color: "#0284c7", bg: "#e0f2fe" },
  WeatherApiDown:              { bucket: "SYSTEM",         icon: WifiOff,      color: "#b91c1c", bg: "#fee2e2" },
  RedistributionRequested:     { bucket: "REDISTRIBUTION", icon: Truck,        color: "#7c3aed", bg: "#ede9fe" },
  RedistributionApproved:      { bucket: "REDISTRIBUTION", icon: Truck,        color: "#15803d", bg: "#dcfce7" },
  RedistributionRejected:      { bucket: "REDISTRIBUTION", icon: Truck,        color: "#dc2626", bg: "#fee2e2" },
  ProcurementOrder:            { bucket: "PROCUREMENT",    icon: ShoppingCart, color: "#f97316", bg: "#ffedd5" },
  ProcurementRequestSubmitted: { bucket: "PROCUREMENT",    icon: ShoppingCart, color: "#f97316", bg: "#ffedd5" },
  PurchaseOrderCreated:        { bucket: "PROCUREMENT",    icon: ShoppingCart, color: "#2563eb", bg: "#dbeafe" },
  PurchaseOrderStatusChanged:  { bucket: "PROCUREMENT",    icon: ShoppingCart, color: "#2563eb", bg: "#dbeafe" },
  PurchaseOrderDelayed:        { bucket: "PROCUREMENT",    icon: ShoppingCart, color: "#dc2626", bg: "#fee2e2" },
  MaterialDelivered:           { bucket: "PROCUREMENT",    icon: PackageCheck, color: "#15803d", bg: "#dcfce7" },
  WarehouseCheck:              { bucket: "PROCUREMENT",    icon: PackageCheck, color: "#b45309", bg: "#fef3c7" },
  PodRatingSubmitted:          { bucket: "PROCUREMENT",    icon: Star,         color: "#b45309", bg: "#fef3c7" },
  UserRegistered:              { bucket: "SYSTEM",         icon: Users,        color: "#374151", bg: "#f3f4f6" },
  UserRoleChanged:             { bucket: "SYSTEM",         icon: ShieldAlert,  color: "#374151", bg: "#f3f4f6" },
};
