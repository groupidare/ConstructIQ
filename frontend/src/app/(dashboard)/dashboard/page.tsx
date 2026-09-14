"use client";

import { useState } from "react";
import Header from "@/components/layout/Header";
import {
  Package, AlertTriangle, AlertCircle, ShoppingCart,
  Trash2, TrendingUp, PiggyBank, Truck,
  RefreshCw, Eye, Zap, Check, Activity,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ── Static data ──────────────────────────────────────────────────────────────

const CHART_DATA = [
  { month: "Jan", actual: 3800, predicted: 3800, budget: 4200 },
  { month: "Feb", actual: 4100, predicted: 4100, budget: 4200 },
  { month: "Mar", actual: 4300, predicted: 4350, budget: 4200 },
  { month: "Apr", actual: 4500, predicted: 4600, budget: 4200 },
  { month: "May", actual: 4800, predicted: 5000, budget: 4500 },
  { month: "Jun", actual: 5100, predicted: 5300, budget: 4800 },
  { month: "Jul", actual: undefined, predicted: 5700, budget: 5000 },
  { month: "Aug", actual: undefined, predicted: 6000, budget: 5200 },
];

const STATS: {
  icon: React.ElementType; iconBg: string; iconColor: string;
  value: string; label: string; sub: string;
  badge: string; badgeBg: string; badgeColor: string;
}[] = [
  { icon: Package,       iconBg: "#dcfce7", iconColor: "#16a34a", value: "47,320",  label: "Total Materials",    sub: "Units across all sites",  badge: "↑ +8.2%",  badgeBg: "#dcfce7", badgeColor: "#166534" },
  { icon: AlertTriangle, iconBg: "#fef3c7", iconColor: "#d97706", value: "3",       label: "Overstock Risk",     sub: "Items flagged",           badge: "↓ +1",     badgeBg: "#fee2e2", badgeColor: "#991b1b" },
  { icon: AlertCircle,   iconBg: "#fee2e2", iconColor: "#dc2626", value: "2",       label: "Shortage Alerts",    sub: "Critical materials",      badge: "↓ +2",     badgeBg: "#fee2e2", badgeColor: "#991b1b" },
  { icon: ShoppingCart,  iconBg: "#ede9fe", iconColor: "#7c3aed", value: "12",      label: "Procurement",        sub: "Pending orders",          badge: "↑ -3",     badgeBg: "#dcfce7", badgeColor: "#166534" },
  { icon: Trash2,        iconBg: "#fee2e2", iconColor: "#dc2626", value: "5.2%",    label: "Waste Rate",         sub: "Of total materials",      badge: "+1.3%",    badgeBg: "#dcfce7", badgeColor: "#166534" },
  { icon: TrendingUp,    iconBg: "#ffedd5", iconColor: "#ea580c", value: "+18.4%",  label: "Predicted Demand",   sub: "Next 30 days",            badge: "+18.4%",   badgeBg: "#dcfce7", badgeColor: "#166534" },
  { icon: PiggyBank,     iconBg: "#dcfce7", iconColor: "#16a34a", value: "₱248K",   label: "Cost Savings",       sub: "Via AI optimization",     badge: "+12%",     badgeBg: "#dcfce7", badgeColor: "#166534" },
  { icon: Truck,         iconBg: "#f3f4f6", iconColor: "#6b7280", value: "1",       label: "Delayed Deliveries", sub: "Active delays",           badge: "↑ -2",     badgeBg: "#dcfce7", badgeColor: "#166534" },
];

const AI_INSIGHTS = [
  { type: "warning",  text: "Actual UsageSand stock will hit critical level in ~5 days. Recommend PO now." },
  { type: "info",     text: "Cement demand forecasted +22% for June due to Phase 3 start." },
  { type: "success",  text: "Cost savings us ₱48K this month via optimized reorder points." },
];

const INVENTORY = [
  { name: "Portland Cement",            qty: "1240 bags", max: "2000 max", status: "NORMAL",   sBg: "#dcfce7", sColor: "#16a34a" },
  { name: "Fine Aggregate (Sand)",       qty: "88 m³",    max: "200 max",  status: "NORMAL",   sBg: "#dcfce7", sColor: "#16a34a" },
  { name: "Portland Cement",            qty: "42 m³",    max: "180 max",  status: "LOW",      sBg: "#fef3c7", sColor: "#b45309" },
  { name: "Deformed Steel Bars (10mm)", qty: "3200 pcs", max: "5000 max", status: "NORMAL",   sBg: "#dcfce7", sColor: "#16a34a" },
  { name: "Deformed Steel Bars (12mm)", qty: "280 pcs",  max: "3000 max", status: "CRITICAL", sBg: "#fee2e2", sColor: "#dc2626" },
];

const ACTIVITY = [
  { dot: "#dc2626", text: "Critical: Ready-mix Concrete stock at 0 units",         source: "BGC Tower Complex",    time: "2 min ago"  },
  { dot: "#3b82f6", text: "PO-2025-0840 approved for ₱110,000 Steel procurement",  source: "Procurement Module",   time: "18 min ago" },
  { dot: "#f59e0b", text: "Coarse Gravel below minimum threshold (42/60 m³)",      source: "Metro Station Phase 3",time: "45 min ago" },
  { dot: "#22c55e", text: "PO-2023-0838 delivered — Portland cement 600 bags",     source: "BGC Tower Warehouse",  time: "2 hrs ago"  },
  { dot: "#3b82f6", text: "AI Forecast updated: +18.4% demand increase next 30d",  source: "Forecasting Engine",   time: "3 hrs ago"  },
  { dot: "#f59e0b", text: "PVC Pipes overstock detected — 2,800 excess units",     source: "BGC Tower Warehouse",  time: "5 hrs ago"  },
];

const WEATHER_DAYS = [
  { day: "Wed", icon: "🌤️", temp: "30°" },
  { day: "Thu", icon: "🌥️", temp: "26°" },
  { day: "Fri", icon: "🌤️", temp: "28°" },
  { day: "Sat", icon: "☀️", temp: "33°" },
  { day: "Sun", icon: "☀️", temp: "34°" },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [tab,    setTab]    = useState("overview");
  const [period, setPeriod] = useState("6M");

  return (
    <div style={{ background: "#f5f4f0" }}>
      <Header title="System Overview" />

      <div style={{ padding: "1.25rem 1.5rem" }}>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, background: "#e5e7eb", borderRadius: 8, padding: 4, width: "fit-content", marginBottom: "1.25rem" }}>
          {[{ id: "overview", label: "System Overview" }, { id: "usage", label: "Usage Log" }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "6px 18px", borderRadius: 6, fontSize: "0.875rem",
              fontWeight: tab === t.id ? 600 : 400,
              border: "none", cursor: "pointer",
              background: tab === t.id ? "#fff" : "transparent",
              color: tab === t.id ? "#111827" : "#6b7280",
              boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              transition: "all 0.15s",
            }}>{t.label}</button>
          ))}
        </div>

        {/* Stats grid — 4 columns × 2 rows */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "0.875rem", marginBottom: "1.25rem" }}>
          {STATS.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} style={{ background: "#fff", borderRadius: 12, padding: "1.1rem 1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: s.iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon style={{ width: 18, height: 18, color: s.iconColor }} />
                  </div>
                  <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: s.badgeBg, color: s.badgeColor }}>
                    {s.badge}
                  </span>
                </div>
                <p style={{ fontSize: "1.7rem", fontWeight: 800, color: "#111827", lineHeight: 1 }}>{s.value}</p>
                <p style={{ fontSize: "0.78rem", fontWeight: 600, color: "#374151", marginTop: "0.3rem" }}>{s.label}</p>
                <p style={{ fontSize: "0.7rem", color: "#9ca3af" }}>{s.sub}</p>
              </div>
            );
          })}
        </div>

        {/* Chart + AI Insights */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "1rem", marginBottom: "1rem" }}>

          {/* Line Chart */}
          <div style={{ background: "#fff", borderRadius: 12, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <TrendingUp style={{ width: 15, height: 15, color: "#f97316" }} />
                  <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#111827" }}>Material Demand Forecast</span>
                </div>
                <p style={{ color: "#9ca3af", fontSize: "0.72rem", marginTop: 2 }}>Actual vs. AI-predicted (units)</p>
              </div>
              <div style={{ display: "flex", gap: 3 }}>
                {["1M","3M","6M","1Y"].map(p => (
                  <button key={p} onClick={() => setPeriod(p)} style={{
                    padding: "4px 10px", borderRadius: 6, fontSize: "0.72rem", fontWeight: 500,
                    border: "none", cursor: "pointer",
                    background: period === p ? "#111827" : "transparent",
                    color: period === p ? "#fff" : "#6b7280",
                  }}>{p}</button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={CHART_DATA} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: "0.75rem" }} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: "0.72rem", paddingTop: 8 }} />
                <Line type="monotone" dataKey="actual"    name="Actual Usage" stroke="#374151" strokeWidth={2} dot={{ r: 3, fill: "#374151" }} connectNulls={false} />
                <Line type="monotone" dataKey="predicted" name="AI Predicted"  stroke="#f97316" strokeWidth={2} dot={{ r: 3, fill: "#f97316" }} strokeDasharray="5 4" />
                <Line type="monotone" dataKey="budget"    name="Budget"        stroke="#d1d5db" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* AI Insights */}
          <div style={{ background: "#1a2235", borderRadius: 12, padding: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <Zap style={{ width: 15, height: 15, color: "#f97316" }} />
                <span style={{ color: "#fff", fontWeight: 700, fontSize: "0.9rem" }}>AI Insights</span>
              </div>
              <span style={{ background: "#22c55e", color: "#fff", fontSize: "0.62rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999 }}>LIVE</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
              {AI_INSIGHTS.map((ins, i) => (
                <div key={i} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.7rem" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                      background: ins.type === "warning" ? "#fee2e2" : ins.type === "success" ? "#dcfce7" : "#dbeafe",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {ins.type === "warning" ? <AlertTriangle style={{ width: 10, height: 10, color: "#dc2626" }} /> :
                       ins.type === "success"  ? <Check        style={{ width: 10, height: 10, color: "#16a34a" }} /> :
                                                 <TrendingUp   style={{ width: 10, height: 10, color: "#3b82f6" }} />}
                    </div>
                    <p style={{ color: "#d1d5db", fontSize: "0.76rem", lineHeight: 1.5 }}>{ins.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom row: Inventory | Activity | Weather */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 280px", gap: "1rem" }}>

          {/* Inventory Status */}
          <div style={{ background: "#fff", borderRadius: 12, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.875rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <Package style={{ width: 15, height: 15, color: "#f97316" }} />
                <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Inventory Status</span>
              </div>
              <button style={{ display: "flex", alignItems: "center", gap: 4, color: "#6b7280", fontSize: "0.72rem", border: "none", background: "none", cursor: "pointer" }}>
                <Eye style={{ width: 12, height: 12 }} /> View All
              </button>
            </div>
            <div>
              {INVENTORY.map((item, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "0.55rem 0",
                  borderBottom: i < INVENTORY.length - 1 ? "1px solid #f3f4f6" : "none",
                }}>
                  <div>
                    <p style={{ fontSize: "0.78rem", fontWeight: 500, color: "#111827" }}>{item.name}</p>
                    <p style={{ fontSize: "0.68rem", color: "#9ca3af" }}>{item.qty} / {item.max}</p>
                  </div>
                  <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: item.sBg, color: item.sColor, whiteSpace: "nowrap" }}>
                    • {item.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Activity Feed */}
          <div style={{ background: "#fff", borderRadius: 12, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.875rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <Activity style={{ width: 15, height: 15, color: "#f97316" }} />
                <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Activity Feed</span>
              </div>
              <button style={{ color: "#9ca3af", border: "none", background: "none", cursor: "pointer" }}>
                <RefreshCw style={{ width: 14, height: 14 }} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
              {ACTIVITY.map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: a.dot, flexShrink: 0, marginTop: 5 }} />
                  <div>
                    <p style={{ fontSize: "0.76rem", color: "#111827", fontWeight: 500, lineHeight: 1.4 }}>{a.text}</p>
                    <p style={{ fontSize: "0.66rem", color: "#9ca3af", marginTop: 1 }}>{a.source} · {a.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Weather Impact */}
          <div style={{ background: "#1a2235", borderRadius: 12, padding: "1.25rem", color: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.875rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>☀️</span>
                <span style={{ fontWeight: 700, fontSize: "0.875rem" }}>Weather Impact</span>
              </div>
              <span style={{ color: "#6b7280", fontSize: "0.65rem" }}>Manila, Today</span>
            </div>

            <div style={{ fontSize: "2.4rem", fontWeight: 800, lineHeight: 1 }}>32°C</div>
            <p style={{ color: "#9ca3af", fontSize: "0.78rem", marginTop: 4, marginBottom: "0.875rem" }}>Sunny, Light Breeze</p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.875rem" }}>
              {[
                { label: "WIND",       val: "18 km/h", emoji: "💨" },
                { label: "HUMIDITY",   val: "65%",     emoji: "💧" },
                { label: "UV INDEX",   val: "High",    emoji: "☀️" },
                { label: "VISIBILITY", val: "10 km",   emoji: "👁️" },
              ].map(w => (
                <div key={w.label} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "0.5rem 0.6rem" }}>
                  <p style={{ color: "#6b7280", fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.06em" }}>{w.label}</p>
                  <p style={{ color: "#fff", fontSize: "0.76rem", fontWeight: 600, marginTop: 2 }}>{w.emoji} {w.val}</p>
                </div>
              ))}
            </div>

            <div style={{ background: "rgba(34,197,94,0.14)", border: "1px solid rgba(34,197,94,0.28)", borderRadius: 8, padding: "0.5rem 0.7rem", marginBottom: "0.875rem" }}>
              <p style={{ color: "#4ade80", fontSize: "0.7rem", lineHeight: 1.4 }}>✓ No weather delays expected. Concrete pouring safe.</p>
            </div>

            <p style={{ color: "#6b7280", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.05em", marginBottom: "0.5rem" }}>5-Day Forecast</p>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              {WEATHER_DAYS.map(d => (
                <div key={d.day} style={{ textAlign: "center" }}>
                  <p style={{ color: "#6b7280", fontSize: "0.62rem" }}>{d.day}</p>
                  <p style={{ fontSize: "1rem", margin: "2px 0" }}>{d.icon}</p>
                  <p style={{ color: "#fff", fontSize: "0.72rem", fontWeight: 600 }}>{d.temp}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
