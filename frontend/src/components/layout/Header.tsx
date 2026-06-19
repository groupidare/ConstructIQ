"use client";

import { useState, useRef, useEffect } from "react";
import { Bell, Search, Sun, Menu, X, AlertTriangle, Package, ShoppingCart, TrendingUp, CheckCircle } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

// ── Mock notifications ────────────────────────────────────────────────────────

interface Notification {
  id: number;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  title: string;
  body: string;
  time: string;
  read: boolean;
}

const INIT_NOTIFS: Notification[] = [
  { id:1, icon:AlertTriangle, iconColor:"#ef4444", iconBg:"#fee2e2", title:"Critical Stock Alert",       body:"Portland Cement has dropped below minimum threshold (48 bags remaining).",           time:"2 min ago",   read:false },
  { id:2, icon:ShoppingCart,  iconColor:"#f97316", iconBg:"#ffedd5", title:"PO Delayed",                 body:"PO-2025-0839 from PhilCon Aggregates is now 6 days overdue.",                        time:"18 min ago",  read:false },
  { id:3, icon:TrendingUp,    iconColor:"#3b82f6", iconBg:"#dbeafe", title:"AI Forecast Updated",        body:"Demand forecast for Cement (+18.4%) and Steel (+12.1%) updated for next 30 days.",   time:"1 hr ago",    read:false },
  { id:4, icon:Package,       iconColor:"#f59e0b", iconBg:"#fef3c7", title:"Overstock Warning",          body:"PVC Pipes (2,800 units) exceed maximum threshold at BGC Tower Complex.",              time:"3 hrs ago",   read:true  },
  { id:5, icon:CheckCircle,   iconColor:"#22c55e", iconBg:"#dcfce7", title:"Procurement Approved",       body:"PO-2025-0844 for Deformed Steel Bars has been approved by Ana Bonifacio.",           time:"Yesterday",   read:true  },
  { id:6, icon:AlertTriangle, iconColor:"#f59e0b", iconBg:"#fef3c7", title:"Low Stock — CHB 4 inch",    body:"CHB 4 inch at Metro Station Phase 3 is at 12% of minimum stock level.",               time:"Yesterday",   read:true  },
];

interface HeaderProps { title: string; }

export default function Header({ title }: HeaderProps) {
  const user     = useAuthStore((s) => s.user);
  const initials = `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`;

  const [notifOpen,  setNotifOpen]  = useState(false);
  const [notifs,     setNotifs]     = useState<Notification[]>(INIT_NOTIFS);
  const bellRef = useRef<HTMLDivElement>(null);

  const unread = notifs.filter(n => !n.read).length;

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!notifOpen) return;
    function handleOutside(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [notifOpen]);

  function markAllRead() {
    setNotifs(n => n.map(x => ({ ...x, read: true })));
  }

  function markRead(id: number) {
    setNotifs(n => n.map(x => x.id === id ? { ...x, read: true } : x));
  }

  return (
    <header style={{
      background: "#fff",
      borderBottom: "1px solid #e5e7eb",
      padding: "0 1.5rem",
      height: 64,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: "1rem", flexShrink: 0, position: "relative", zIndex: 100,
    }}>
      {/* Left — title + breadcrumb */}
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button style={{ color: "#6b7280", border: "none", background: "none", cursor: "pointer", padding: 0 }}>
            <Menu style={{ width: 20, height: 20 }} />
          </button>
          <span style={{ fontWeight: 700, fontSize: "1.05rem", color: "#111827", whiteSpace: "nowrap" }}>{title}</span>
        </div>
        <p style={{ fontSize: "0.68rem", color: "#9ca3af", marginLeft: 30 }}>
          ConstructIQ &nbsp;›&nbsp; <span style={{ color: "#f97316" }}>{title}</span>
        </p>
      </div>

      {/* Search */}
      <div style={{ position: "relative", flex: 1, maxWidth: 380 }}>
        <Search style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 15, height: 15, color: "#9ca3af", pointerEvents: "none" }} />
        <input
          suppressHydrationWarning
          placeholder="Search materials, projects..."
          style={{
            width: "100%", boxSizing: "border-box" as const,
            paddingLeft: 36, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
            borderRadius: 999, background: "#f3f4f6",
            border: "1px solid #e5e7eb", fontSize: "0.8rem",
            outline: "none", color: "#111827",
          }}
        />
      </div>

      {/* Right */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        {/* Weather */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "#fffbeb", border: "1px solid #fde68a",
          borderRadius: 8, padding: "5px 10px",
        }}>
          <span style={{ fontSize: "1rem" }}>☀️</span>
          <div>
            <span style={{ fontWeight: 700, fontSize: "0.8rem", color: "#111827" }}>32°C</span>
            <span style={{ color: "#9ca3af", fontSize: "0.68rem", marginLeft: 5 }}>Sunny · Manila</span>
          </div>
        </div>

        {/* Bell + notification dropdown */}
        <div ref={bellRef} style={{ position: "relative" }}>
          <button
            onClick={() => setNotifOpen(o => !o)}
            style={{ position: "relative", color: "#6b7280", border: "none", background: "none", cursor: "pointer", padding: 4 }}
          >
            <Bell style={{ width: 18, height: 18 }} />
            {unread > 0 && (
              <span style={{
                position: "absolute", top: 0, right: 0,
                minWidth: 16, height: 16, padding: "0 3px",
                background: "#ef4444", borderRadius: 999,
                border: "1.5px solid #fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.55rem", fontWeight: 800, color: "#fff", lineHeight: 1,
              }}>
                {unread}
              </span>
            )}
          </button>

          {/* Notification dropdown */}
          {notifOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 10px)", right: 0,
              width: 380, background: "#fff",
              borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
              border: "1px solid #e5e7eb", zIndex: 999, overflow: "hidden",
            }}>
              {/* Header */}
              <div style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ fontWeight: 800, fontSize: "0.9rem" }}>Notifications</p>
                  {unread > 0 && <p style={{ fontSize: "0.7rem", color: "#9ca3af" }}>{unread} unread</p>}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {unread > 0 && (
                    <button onClick={markAllRead} style={{ fontSize: "0.72rem", color: "#f97316", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                      Mark all read
                    </button>
                  )}
                  <button onClick={() => setNotifOpen(false)} style={{ color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                    <X style={{ width: 15, height: 15 }} />
                  </button>
                </div>
              </div>

              {/* List */}
              <div style={{ maxHeight: 380, overflowY: "auto" }}>
                {notifs.map(n => {
                  const Icon = n.icon;
                  return (
                    <div
                      key={n.id}
                      onClick={() => markRead(n.id)}
                      style={{
                        display: "flex", gap: 12, padding: "12px 16px",
                        borderBottom: "1px solid #f9fafb", cursor: "pointer",
                        background: n.read ? "#fff" : "#fffbf5",
                        transition: "background 0.15s",
                      }}
                    >
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: n.iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                        <Icon style={{ width: 16, height: 16, color: n.iconColor }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                          <p style={{ fontWeight: n.read ? 500 : 700, fontSize: "0.8rem", color: "#111827", lineHeight: 1.3 }}>{n.title}</p>
                          {!n.read && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f97316", flexShrink: 0, marginTop: 4 }} />}
                        </div>
                        <p style={{ fontSize: "0.72rem", color: "#6b7280", marginTop: 2, lineHeight: 1.4 }}>{n.body}</p>
                        <p style={{ fontSize: "0.65rem", color: "#9ca3af", marginTop: 4 }}>{n.time}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div style={{ padding: "10px 16px", borderTop: "1px solid #f3f4f6", textAlign: "center" }}>
                <button onClick={() => setNotifOpen(false)} style={{ fontSize: "0.78rem", color: "#f97316", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                  View all notifications
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Brightness */}
        <button style={{ color: "#6b7280", border: "none", background: "none", cursor: "pointer", padding: 4 }}>
          <Sun style={{ width: 18, height: 18 }} />
        </button>

        {/* Avatar */}
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: "#f97316",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontWeight: 700, fontSize: "0.8rem",
          cursor: "pointer", flexShrink: 0,
        }}>
          {initials}
        </div>
      </div>
    </header>
  );
}
