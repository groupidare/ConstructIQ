"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { useSidebarStore } from "@/store/sidebarStore";
import { Avatar } from "@/components/ui/Avatar";
import {
  FolderKanban, Package, TrendingUp, Trash2, Network,
  ShoppingCart, FileText, LayoutDashboard, Users, Settings, LogOut,
} from "lucide-react";
import type { UserRole } from "@/types/auth";

const ROLE_LABELS: Record<string, string> = {
  Admin:              "System Administration",
  ProjectManager:     "Project Manager",
  SiteEngineer:       "Site Engineer",
  WarehousePersonnel: "Warehouse Personnel",
  ProcurementOfficer: "Procurement Officer",
};

const ALL_ROLES: UserRole[] = ["Admin","ProjectManager","SiteEngineer","WarehousePersonnel","ProcurementOfficer"];

const NAV_ITEMS: { label: string; href: string; icon: React.ElementType; roles: UserRole[] }[] = [
  { label: "Projects",        href: "/projects",        icon: FolderKanban,    roles: ["Admin","ProjectManager","SiteEngineer","ProcurementOfficer"] },
  { label: "Inventory",       href: "/inventory",       icon: Package,         roles: ALL_ROLES },
  { label: "Forecasting",     href: "/forecasting",     icon: TrendingUp,      roles: ["Admin","ProjectManager","ProcurementOfficer"] },
  { label: "Excess Analytics",href: "/excess-analytics",icon: Trash2,          roles: ["Admin","ProjectManager","SiteEngineer","WarehousePersonnel"] },
  { label: "Redistribution",  href: "/redistribution",  icon: Network,         roles: ["Admin","ProjectManager","WarehousePersonnel"] },
  { label: "Procurement",     href: "/procurement",     icon: ShoppingCart,    roles: ALL_ROLES },
  { label: "Reports",         href: "/reports",         icon: FileText,        roles: ALL_ROLES },
  { label: "System Overview", href: "/dashboard",       icon: LayoutDashboard, roles: ALL_ROLES },
  { label: "User Management", href: "/admin/users",     icon: Users,           roles: ["Admin"] },
  { label: "Settings",        href: "/admin/settings",  icon: Settings,        roles: ALL_ROLES },
];

// ── Sign-out confirmation modal ───────────────────────────────────────────────

function SignOutConfirmModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div
      onClick={onCancel}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background:"#fff", borderRadius:20, padding:"2.5rem 2rem 2rem", width:"100%", maxWidth:440, display:"flex", flexDirection:"column", alignItems:"center", gap:"1.25rem", boxShadow:"0 24px 60px rgba(0,0,0,0.3)", margin:"0 1rem" }}
      >
        <div style={{ width:72, height:72, borderRadius:"50%", background:"#fff1f1", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ width:52, height:52, borderRadius:"50%", background:"#fee2e2", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <LogOut style={{ width:26, height:26, color:"#dc2626" }} />
          </div>
        </div>
        <h2 style={{ fontWeight:800, fontSize:"1.3rem", color:"#111827", textAlign:"center", lineHeight:1.3, margin:0 }}>
          Sign out of ConstructIQ?
        </h2>
        <div style={{ display:"flex", gap:"1rem", width:"100%", marginTop:"0.25rem" }}>
          <button
            onClick={onCancel}
            style={{ flex:1, padding:"13px 0", borderRadius:10, border:"1.5px solid #e5e7eb", background:"#fff", fontWeight:700, fontSize:"0.95rem", color:"#374151", cursor:"pointer" }}
          >Stay signed in</button>
          <button
            onClick={onConfirm}
            style={{ flex:1, padding:"13px 0", borderRadius:10, border:"none", background:"#9b1c1c", color:"#fff", fontWeight:700, fontSize:"0.95rem", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}
          >
            <LogOut style={{ width:17, height:17 }} /> Yes, sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const { user } = useAuthStore();
  const logout   = useAuthStore(s => s.logout);
  const collapsed = useSidebarStore(s => s.collapsed);
  const [showConfirm, setShowConfirm] = useState(false);

  function doLogout() {
    logout();
    router.push("/");
  }

  return (
    <>
      {showConfirm && (
        <SignOutConfirmModal
          onCancel={() => setShowConfirm(false)}
          onConfirm={doLogout}
        />
      )}

      <aside id="app-sidebar" suppressHydrationWarning style={{
        width: collapsed ? 76 : 260, flexShrink: 0,
        background: "#1a2235",
        display: "flex", flexDirection: "column",
        height: "100%", overflowY: "auto", overflowX: "hidden",
        transition: "width 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
      }}>
        {/* Logo */}
        <div style={{
          padding: collapsed ? "1.5rem 0.5rem 1rem" : "1.5rem 1.25rem 1rem",
          display:"flex", alignItems:"center",
          justifyContent: collapsed ? "center" : "flex-start",
          gap: collapsed ? 0 : 10,
          transition:"padding 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
        }}>
          <div style={{
            width:40, height:40, borderRadius:10,
            background:"#f97316",
            display:"flex", alignItems:"center", justifyContent:"center",
            flexShrink:0, overflow:"hidden", boxShadow:"0 4px 12px rgba(249,115,22,0.35)",
          }}>
            {/* Same inline pulse icon as the login page's logo — no border
                artifact, unlike the rasterized logo.svg (a stroke-only path
                has no bounding-box edge to show against the orange fill). */}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display:"block" }}>
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <span style={{
            color:"#fff", fontWeight:800, fontSize:"1.1rem", letterSpacing:"-0.01em",
            display:"inline-block", overflow:"hidden", whiteSpace:"nowrap",
            maxWidth: collapsed ? 0 : 160, opacity: collapsed ? 0 : 1,
            transition: "max-width 0.28s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.18s ease",
          }}>ConstructIQ</span>
        </div>

        {/* Nav */}
        <nav style={{ flex:1, overflowY:"auto", overflowX:"hidden", padding: collapsed ? "0.5rem 0.5rem" : "0.5rem 0.75rem", transition:"padding 0.28s cubic-bezier(0.4, 0, 0.2, 1)" }}>
          <p style={{
            color:"#4b5563", fontSize:"0.65rem", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase",
            padding: collapsed ? "0 0.5rem" : "0.5rem 0.5rem 0.75rem",
            maxHeight: collapsed ? 0 : 24, opacity: collapsed ? 0 : 1, overflow:"hidden",
            transition: "max-height 0.28s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.18s ease, padding 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
          }}>
            MAIN
          </p>

          {NAV_ITEMS.filter(item => user?.role && item.roles.includes(user.role)).map((item) => {
            const Icon = item.icon;
            const active = item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                style={{
                  display:"flex", alignItems:"center", gap: collapsed ? 0 : 10,
                  padding: collapsed ? "0.6rem 0" : "0.55rem 0.75rem",
                  borderRadius:8, marginBottom:2,
                  textDecoration:"none",
                  transition:"background 0.15s, padding 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
                  background: active ? "rgba(249,115,22,0.12)" : "transparent",
                  color:      active ? "#fb923c" : "#9ca3af",
                  fontWeight: active ? 600 : 400,
                  fontSize:"0.875rem",
                  justifyContent: collapsed ? "center" : "flex-start",
                  borderLeft: active ? "3px solid #f97316" : "3px solid transparent",
                }}
              >
                <Icon style={{ width:17, height:17, flexShrink:0 }} />
                <span style={{
                  display:"inline-block", overflow:"hidden", whiteSpace:"nowrap",
                  maxWidth: collapsed ? 0 : 160, opacity: collapsed ? 0 : 1,
                  transition: "max-width 0.28s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.18s ease",
                }}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User info + logout — the sign-out button only appears expanded;
            collapsed just shows the avatar, centered. */}
        <div style={{
          padding: collapsed ? "0.875rem 0.5rem" : "0.875rem 1rem",
          borderTop:"1px solid rgba(255,255,255,0.07)",
          display:"flex",
          alignItems:"center",
          justifyContent: collapsed ? "center" : "flex-start",
          gap: collapsed ? 0 : 10, flexShrink:0,
          transition: "padding 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
        }}>
          <Avatar
            avatarUrl={user?.avatarUrl}
            initials={`${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`.toUpperCase()}
            size={36}
          />
          <div style={{
            flex: collapsed ? "0 0 0px" : 1, minWidth:0, overflow:"hidden",
            maxWidth: collapsed ? 0 : 200, maxHeight: collapsed ? 0 : "none", opacity: collapsed ? 0 : 1,
            transition: "max-width 0.28s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.18s ease, flex-basis 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
          }}>
            <p style={{ color:"#fff", fontWeight:600, fontSize:"0.82rem", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {user ? `${user.firstName} ${user.lastName}` : "Guest"}
            </p>
            <p style={{ color:"#6b7280", fontSize:"0.68rem", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {ROLE_LABELS[user?.role ?? ""] ?? ""}
            </p>
          </div>
          {!collapsed && (
            <button
              onClick={() => setShowConfirm(true)}
              title="Sign out"
              style={{ background:"none", border:"none", cursor:"pointer", color:"#6b7280", padding:4, flexShrink:0, display:"flex", alignItems:"center" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#f97316")}
              onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}
            >
              <LogOut style={{ width:17, height:17 }} />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
