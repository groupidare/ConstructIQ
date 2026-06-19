"use client";

import { Bell, Search, Sun, Menu } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

interface HeaderProps { title: string; }

export default function Header({ title }: HeaderProps) {
  const user     = useAuthStore((s) => s.user);
  const initials = `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`;

  return (
    <header style={{
      background: "#fff",
      borderBottom: "1px solid #e5e7eb",
      padding: "0 1.5rem",
      height: 64,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: "1rem", flexShrink: 0,
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
            width: "100%", boxSizing: "border-box",
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

        {/* Bell */}
        <button style={{ position: "relative", color: "#6b7280", border: "none", background: "none", cursor: "pointer", padding: 4 }}>
          <Bell style={{ width: 18, height: 18 }} />
          <span style={{ position: "absolute", top: 2, right: 2, width: 7, height: 7, background: "#ef4444", borderRadius: "50%", border: "1.5px solid #fff" }} />
        </button>

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
