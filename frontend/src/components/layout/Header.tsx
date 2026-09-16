"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Bell, Search, Sun, Moon, Menu, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAuthStore } from "@/store/authStore";
import { useTheme } from "@/store/themeStore";
import { useSidebarStore } from "@/store/sidebarStore";
import { useAlertStore, ALERT_ICON_STYLES } from "@/store/alertStore";
import WeatherChip from "./WeatherChip";

interface HeaderProps {
  title: string;
}

export default function Header({ title }: HeaderProps) {
  const router   = useRouter();
  const user     = useAuthStore((s) => s.user);
  const initials = `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`.toUpperCase();
  const theme       = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggleTheme);
  const toggleSidebar = useSidebarStore((s) => s.toggleCollapsed);

  const alerts      = useAlertStore((s) => s.alerts);
  const markRead    = useAlertStore((s) => s.markRead);
  const markAllRead = useAlertStore((s) => s.markAllRead);

  const [notifOpen, setNotifOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const unread  = alerts.filter(n => !n.read).length;

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

  return (
    <header style={{
      background: "#fff",
      borderBottom: "1px solid #e5e7eb",
      padding: "0 1.5rem",
      height: 64,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "1.25rem",
      flexShrink: 0,
      position: "relative",
      zIndex: 100,
    }}>

      {/* ── Left: hamburger + title + breadcrumb ── */}
      <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
        <button onClick={toggleSidebar} title="Toggle sidebar" style={{ color:"#6b7280", border:"none", background:"none", cursor:"pointer", padding:0, display:"flex", alignItems:"center" }}>
          <Menu style={{ width:20, height:20 }} />
        </button>
        <div>
          <p style={{ fontWeight:700, fontSize:"1.05rem", color:"#111827", lineHeight:1.2 }}>{title}</p>
          <p style={{ fontSize:"0.68rem", color:"#9ca3af", lineHeight:1.2, marginTop:1 }}>
            ConstructIQ &nbsp;›&nbsp; <span style={{ color:"#f97316", fontWeight:500 }}>{title}</span>
          </p>
        </div>
      </div>

      {/* ── Center: search ── */}
      <div style={{ position:"relative", flex:1, maxWidth:420 }}>
        <Search style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", width:15, height:15, color:"#9ca3af", pointerEvents:"none" }} />
        <input
          suppressHydrationWarning
          placeholder="Search materials, projects..."
          style={{
            width:"100%", boxSizing:"border-box" as const,
            paddingLeft:36, paddingRight:14, paddingTop:9, paddingBottom:9,
            borderRadius:999, background:"#f3f4f6",
            border:"1px solid #e5e7eb", fontSize:"0.8rem",
            outline:"none", color:"#111827",
          }}
        />
      </div>

      {/* ── Right: weather · bell · sun · avatar ── */}
      <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>

        {/* Weather — live, based on the user's current location. Shared across every page. */}
        <WeatherChip />

        {/* Bell + dropdown */}
        <div ref={bellRef} style={{ position:"relative" }}>
          <button
            onClick={() => setNotifOpen(o => !o)}
            style={{ position:"relative", color:"#6b7280", border:"none", background:"none", cursor:"pointer", padding:4, display:"flex", alignItems:"center" }}
          >
            <Bell style={{ width:18, height:18 }} />
            {unread > 0 && (
              <span style={{
                position:"absolute", top:0, right:0,
                minWidth:16, height:16, padding:"0 3px",
                background:"#ef4444", borderRadius:999,
                border:"1.5px solid #fff",
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:"0.55rem", fontWeight:800, color:"#fff", lineHeight:1,
              }}>
                {unread}
              </span>
            )}
          </button>

          {notifOpen && (
            <div style={{
              position:"absolute", top:"calc(100% + 10px)", right:0,
              width:380, background:"#fff",
              borderRadius:14, boxShadow:"0 8px 32px rgba(0,0,0,0.15)",
              border:"1px solid #e5e7eb", zIndex:999, overflow:"hidden",
            }}>
              <div style={{ padding:"14px 16px", borderBottom:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <p style={{ fontWeight:800, fontSize:"0.9rem" }}>Notifications</p>
                  {unread > 0 && <p style={{ fontSize:"0.7rem", color:"#9ca3af" }}>{unread} unread</p>}
                </div>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  {unread > 0 && (
                    <button onClick={markAllRead} style={{ fontSize:"0.72rem", color:"#f97316", background:"none", border:"none", cursor:"pointer", fontWeight:600 }}>
                      Mark all read
                    </button>
                  )}
                  <button onClick={() => setNotifOpen(false)} style={{ color:"#9ca3af", background:"none", border:"none", cursor:"pointer", padding:2 }}>
                    <X style={{ width:15, height:15 }} />
                  </button>
                </div>
              </div>
              <div style={{ maxHeight:360, overflowY:"auto" }}>
                {alerts.map(n => {
                  const { icon: Icon, color: iconColor, bg: iconBg } = ALERT_ICON_STYLES[n.kind];
                  return (
                    <div
                      key={n.id}
                      onClick={() => markRead(n.id)}
                      style={{ display:"flex", gap:12, padding:"12px 16px", borderBottom:"1px solid #f9fafb", cursor:"pointer", background:n.read?"#fff":"#fffbf5" }}
                    >
                      <div style={{ width:36, height:36, borderRadius:"50%", background:iconBg, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:2 }}>
                        <Icon style={{ width:16, height:16, color:iconColor }} />
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
                          <p style={{ fontWeight:n.read?500:700, fontSize:"0.8rem", color:"#111827", lineHeight:1.3 }}>{n.title}</p>
                          {!n.read && <span style={{ width:7, height:7, borderRadius:"50%", background:"#f97316", flexShrink:0, marginTop:4 }} />}
                        </div>
                        <p style={{ fontSize:"0.72rem", color:"#6b7280", marginTop:2, lineHeight:1.4 }}>{n.body}</p>
                        <p style={{ fontSize:"0.65rem", color:"#9ca3af", marginTop:4 }}>{formatDistanceToNow(n.createdAt, { addSuffix: true })}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ padding:"10px 16px", borderTop:"1px solid #f3f4f6", textAlign:"center" }}>
                <button onClick={() => setNotifOpen(false)} style={{ fontSize:"0.78rem", color:"#f97316", background:"none", border:"none", cursor:"pointer", fontWeight:600 }}>
                  View all notifications
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle dark mode"
          style={{ color:"#6b7280", border:"none", background:"none", cursor:"pointer", padding:4, display:"flex", alignItems:"center" }}
        >
          {theme === "dark" ? <Moon style={{ width:18, height:18 }} /> : <Sun style={{ width:18, height:18 }} />}
        </button>

        {/* Avatar */}
        <button
          onClick={() => router.push("/admin/settings")}
          aria-label="Go to settings"
          style={{
            width:36, height:36, borderRadius:"50%",
            background:"#f97316", border:"none",
            display:"flex", alignItems:"center", justifyContent:"center",
            color:"#fff", fontWeight:700, fontSize:"0.8rem",
            cursor:"pointer", flexShrink:0, userSelect:"none",
          }}
        >
          {initials || "?"}
        </button>
      </div>
    </header>
  );
}
