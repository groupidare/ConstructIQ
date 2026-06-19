"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import type { UserRole } from "@/types/auth";
import {
  LayoutDashboard, TrendingUp, Package, ShoppingCart,
  Trash2, FolderKanban, FileText, Users, Settings,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard",       href: "/",                    icon: LayoutDashboard, roles: ["Admin","ProjectManager","SiteEngineer","WarehousePersonnel","ProcurementOfficer"] },
  { label: "Forecasting",     href: "/forecasting",         icon: TrendingUp,      roles: ["Admin","ProjectManager","SiteEngineer"] },
  { label: "Inventory",       href: "/inventory",           icon: Package,         roles: ["Admin","ProjectManager","SiteEngineer","WarehousePersonnel"] },
  { label: "Procurement",     href: "/procurement",         icon: ShoppingCart,    roles: ["Admin","ProjectManager","ProcurementOfficer"] },
  { label: "Waste Analytics", href: "/excess-analytics",    icon: Trash2,          roles: ["Admin","ProjectManager","SiteEngineer","WarehousePersonnel"] },
  { label: "Projects",        href: "/projects",            icon: FolderKanban,    roles: ["Admin","ProjectManager","SiteEngineer"] },
  { label: "Reports",         href: "/reports",             icon: FileText,        roles: ["Admin","ProjectManager"] },
  { label: "User Management", href: "/admin/users",         icon: Users,           roles: ["Admin"] },
  { label: "Settings",        href: "/admin/settings",      icon: Settings,        roles: ["Admin"] },
];

export default function Sidebar() {
  const pathname  = usePathname();
  const { user }  = useAuthStore();

  const visible = NAV_ITEMS.filter(item => user && item.roles.includes(user.role));

  return (
    <aside style={{
      width: 260, flexShrink: 0,
      background: "#1a2235",
      display: "flex", flexDirection: "column",
      height: "100%", overflowY: "auto",
    }}>
      {/* Logo */}
      <div style={{ padding: "1.5rem 1.25rem 1rem", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: "#f97316",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, boxShadow: "0 4px 12px rgba(249,115,22,0.35)",
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" style={{ width: 22, height: 22 }} />
        </div>
        <span style={{ color: "#fff", fontWeight: 800, fontSize: "1.1rem", letterSpacing: "-0.01em" }}>ConstructIQ</span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: "auto", padding: "0.5rem 0.75rem" }}>
        <p style={{ color: "#4b5563", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "0.5rem 0.5rem 0.75rem" }}>
          MAIN
        </p>

        {visible.map((item) => {
          const Icon   = item.icon;
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "0.55rem 0.75rem", borderRadius: 8, marginBottom: 2,
                textDecoration: "none", transition: "background 0.15s",
                background: active ? "rgba(249,115,22,0.12)" : "transparent",
                color: active ? "#fb923c" : "#9ca3af",
                fontWeight: active ? 600 : 400,
                fontSize: "0.875rem",
              }}
            >
              <Icon style={{ width: 17, height: 17, flexShrink: 0 }} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
