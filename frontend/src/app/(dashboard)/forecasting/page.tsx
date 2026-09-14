"use client";

import { useState } from "react";
import Header from "@/components/layout/Header";
import { BarChart3, TrendingUp, ShoppingCart, AlertTriangle } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ── Static data ───────────────────────────────────────────────────────────────

const CHART_DATA = [
  { month: "Jan", actual: 3800, predicted: 3800, budget: 4200 },
  { month: "Feb", actual: 4050, predicted: 4100, budget: 4200 },
  { month: "Mar", actual: 4200, predicted: 4350, budget: 4200 },
  { month: "Apr", actual: 4450, predicted: 4600, budget: 4200 },
  { month: "May", actual: 4750, predicted: 5000, budget: 4500 },
  { month: "Jun", actual: 4950, predicted: 5300, budget: 4800 },
  { month: "Jul", actual: undefined, predicted: 5600, budget: 5000 },
  { month: "Aug", actual: undefined, predicted: 5950, budget: 5200 },
];

type Risk = "LOW" | "MED" | "HIGH" | "CRITICAL";

const MATERIALS   = ["Cement", "Gravel", "Steel", "Concrete", "Plywood", "PVC"];
const MONTHS      = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const HEATMAP: Risk[][] = [
  ["HIGH", "MED",  "HIGH",     "CRITICAL", "CRITICAL", "CRITICAL"],
  ["MED",  "MED",  "HIGH",     "CRITICAL", "CRITICAL", "CRITICAL"],
  ["MED",  "HIGH", "HIGH",     "HIGH",     "CRITICAL", "CRITICAL"],
  ["LOW",  "MED",  "HIGH",     "HIGH",     "CRITICAL", "CRITICAL"],
  ["MED",  "MED",  "MED",      "HIGH",     "HIGH",     "HIGH"    ],
  ["HIGH", "HIGH", "CRITICAL", "CRITICAL", "CRITICAL", "HIGH"    ],
];

const RISK: Record<Risk, { bg: string; color: string }> = {
  LOW:      { bg: "#fef3c7", color: "#92400e"  },
  MED:      { bg: "#fed7aa", color: "#9a3412"  },
  HIGH:     { bg: "#f97316", color: "#fff"     },
  CRITICAL: { bg: "#ef4444", color: "#fff"     },
};

const PROCUREMENT = [
  { name: "Portland Cement",    sub: "Current 1240 → Predicted 1680", pct: "+35.5%", pctColor: "#f97316", status: "MODERATE", sBg: "#ffedd5", sColor: "#c2410c", po: true  },
  { name: "Coarse Gravel",      sub: "Current 42 → Predicted 95",     pct: "+126%",  pctColor: "#f97316", status: "HIGH",     sBg: "#fee2e2", sColor: "#991b1b", po: true  },
  { name: "Steel Bars 12mm",    sub: "Current 280 → Predicted 520",   pct: "+85.7%", pctColor: "#f97316", status: "HIGH",     sBg: "#fee2e2", sColor: "#991b1b", po: true  },
  { name: "Ready-mix Concrete", sub: "Current 1240 → Predicted 1680", pct: "—",      pctColor: "#ef4444", status: "CRITICAL", sBg: "#ef4444", sColor: "#fff",    po: true  },
  { name: "Fine Aggregate",     sub: "Current 68 → Predicted 110",    pct: "+25%",   pctColor: "#22c55e", status: "LOW",      sBg: "#dcfce7", sColor: "#166534", po: false },
  { name: "Plywood",            sub: "Current 320 → Predicted 290",   pct: "-9.4%",  pctColor: "#22c55e", status: "LOW",      sBg: "#dcfce7", sColor: "#166534", po: false },
];

const MODEL_ROWS = [
  { label: "Algorithm",      value: "Random Forest + XGBoost"   },
  { label: "Training Data",  value: "155 BOQ records · 8 projects" },
  { label: "Features",       value: "11 variables"              },
  { label: "Accuracy (R²)",  value: "0.978"                     },
  { label: "Latest Updated", value: "Today 8:00 AM"             },
  { label: "Next Updated",   value: "Tomorrow 8:00 AM"          },
];

const FORECAST_TABLE = [
  { name: "Tomorrow 8:00 AM",   status: "MODERATE", sBg: "#ffedd5", sColor: "#c2410c" },
  { name: "Coarse Gravel",      status: "HIGH",     sBg: "#fee2e2", sColor: "#991b1b" },
  { name: "Steel Bars 12mm",    status: "HIGH",     sBg: "#fee2e2", sColor: "#991b1b" },
  { name: "Ready-mix Concrete", status: "CRITICAL", sBg: "#ef4444", sColor: "#fff"    },
  { name: "Fine Aggregate",     status: "LOW",      sBg: "#dcfce7", sColor: "#166534" },
  { name: "Plywood",            status: "LOW",      sBg: "#dcfce7", sColor: "#166534" },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ForecastingPage() {
  const [tab, setTab] = useState<"demand" | "heatmap" | "procurement">("demand");

  return (
    <div style={{ background: "#f5f4f0" }}>
      <Header title="Forecasting" />

      <div style={{ padding: "1.25rem 1.5rem", display: "flex", gap: "1rem", alignItems: "flex-start" }}>

        {/* ── Left: tabbed content ─────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, background: "#e5e7eb", borderRadius: 8, padding: 4, width: "fit-content", marginBottom: "1.25rem" }}>
            {([
              { id: "demand",      label: "Demand Forecast"    },
              { id: "heatmap",     label: "Shortage Heatmap"   },
              { id: "procurement", label: "Procurement Recs"   },
            ] as const).map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: "6px 18px", borderRadius: 6, fontSize: "0.875rem",
                fontWeight: tab === t.id ? 600 : 400,
                border: "none", cursor: "pointer",
                background: tab === t.id ? "#fff" : "transparent",
                color: tab === t.id ? "#111827" : "#6b7280",
                boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                transition: "all 0.15s", whiteSpace: "nowrap",
              }}>{t.label}</button>
            ))}
          </div>

          {/* ── Tab: Demand Forecast ──────────────────────────────────────── */}
          {tab === "demand" && (
            <div style={{ background: "#fff", borderRadius: 12, padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
              <div style={{ marginBottom: "1.25rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <TrendingUp style={{ width: 16, height: 16, color: "#f97316" }} />
                  <span style={{ fontWeight: 700, fontSize: "1rem" }}>AI Material Demand Forecast</span>
                </div>
                <p style={{ color: "#9ca3af", fontSize: "0.72rem", marginTop: 3 }}>Historical usage vs AI-predicted demand (next 90 days)</p>
              </div>

              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={CHART_DATA} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false} domain={[0, 6500]} ticks={[0,1000,2000,3000,4000,5000,6000]} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: "0.75rem" }} />
                  <Legend iconType="plainline" wrapperStyle={{ fontSize: "0.78rem", paddingTop: 16 }} />
                  <Line type="monotone" dataKey="actual"    name="Actual Usage" stroke="#374151" strokeWidth={2.5} dot={{ r: 4, fill: "#374151" }} connectNulls={false} />
                  <Line type="monotone" dataKey="predicted" name="AI Predicted"  stroke="#f97316" strokeWidth={2.5} dot={{ r: 4, fill: "#f97316" }} />
                  <Line type="monotone" dataKey="budget"    name="Budget"        stroke="#d1d5db" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>

              {/* 3 stat boxes */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginTop: "1.5rem" }}>
                {[
                  { value: "97.8%",   label: "Model Accuracy",    color: "#22c55e" },
                  { value: "90 days", label: "Forecast Horizon",  color: "#111827" },
                  { value: "High",    label: "Confidence",        color: "#f97316" },
                ].map(s => (
                  <div key={s.label} style={{ background: "#f9fafb", borderRadius: 10, padding: "1rem 1.25rem", textAlign: "center", border: "1px solid #e5e7eb" }}>
                    <p style={{ fontSize: "2rem", fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</p>
                    <p style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: 4 }}>{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Tab: Shortage Heatmap ─────────────────────────────────────── */}
          {tab === "heatmap" && (
            <div style={{ background: "#fff", borderRadius: 12, padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
              <div style={{ marginBottom: "1.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <BarChart3 style={{ width: 16, height: 16, color: "#f97316" }} />
                  <span style={{ fontWeight: 700, fontSize: "1rem" }}>Material Shortage Heatmap</span>
                </div>
                <p style={{ color: "#9ca3af", fontSize: "0.72rem", marginTop: 3 }}>Predicted shortage risk by material &amp; month</p>
              </div>

              {/* Grid */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "6px" }}>
                  <thead>
                    <tr>
                      <th style={{ width: 100 }} />
                      {MONTHS.map(m => (
                        <th key={m} style={{ fontWeight: 600, fontSize: "0.8rem", color: "#6b7280", textAlign: "center", paddingBottom: 6 }}>{m}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MATERIALS.map((mat, ri) => (
                      <tr key={mat}>
                        <td style={{ fontWeight: 600, fontSize: "0.875rem", color: "#374151", paddingRight: 12, whiteSpace: "nowrap" }}>{mat}</td>
                        {HEATMAP[ri].map((level, ci) => {
                          const isCritical = level === "CRITICAL";
                          return (
                            <td key={ci} style={{ textAlign: "center", padding: 3 }}>
                              <div style={{
                                background: RISK[level].bg,
                                color: RISK[level].color,
                                borderRadius: 8, padding: "8px 6px",
                                fontSize: "0.7rem", fontWeight: 700,
                                display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
                                minWidth: 72,
                              }}>
                                {isCritical && <AlertTriangle style={{ width: 10, height: 10 }} />}
                                {level}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Legend */}
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: "1.5rem" }}>
                <span style={{ fontSize: "0.75rem", color: "#6b7280", fontWeight: 600 }}>Risk Level:</span>
                {(["LOW","MED","HIGH","CRITICAL"] as Risk[]).map(r => (
                  <div key={r} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 14, height: 14, borderRadius: 3, background: RISK[r].bg, border: r === "LOW" ? "1px solid #e5e7eb" : "none" }} />
                    <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                      {r === "MED" ? "Medium" : r === "LOW" ? "Low" : r === "HIGH" ? "High" : "Critical"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Tab: Procurement Recs ─────────────────────────────────────── */}
          {tab === "procurement" && (
            <div style={{ background: "#fff", borderRadius: 12, padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
              <div style={{ marginBottom: "1.25rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ShoppingCart style={{ width: 16, height: 16, color: "#f97316" }} />
                  <span style={{ fontWeight: 700, fontSize: "1rem" }}>Procurement Recommendations</span>
                </div>
                <p style={{ color: "#9ca3af", fontSize: "0.72rem", marginTop: 3 }}>AI-generated reorder suggestions</p>
              </div>

              <div>
                {PROCUREMENT.map((item, i) => (
                  <div key={item.name} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "1rem 0",
                    borderBottom: i < PROCUREMENT.length - 1 ? "1px solid #f3f4f6" : "none",
                    gap: "1rem",
                  }}>
                    {/* Name + sub */}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontWeight: 600, fontSize: "0.875rem", color: "#111827" }}>{item.name}</p>
                      <p style={{ fontSize: "0.7rem", color: "#9ca3af", marginTop: 2 }}>{item.sub}</p>
                    </div>

                    {/* Pct change */}
                    <span style={{ fontWeight: 700, fontSize: "0.875rem", color: item.pctColor, flexShrink: 0, minWidth: 52, textAlign: "right" }}>{item.pct}</span>

                    {/* Status badge */}
                    <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: item.sBg, color: item.sColor, flexShrink: 0 }}>
                      · {item.status}
                    </span>

                    {/* PO button */}
                    {item.po ? (
                      <button style={{
                        background: "#f97316", color: "#fff", border: "none", borderRadius: 8,
                        padding: "6px 14px", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", flexShrink: 0,
                      }}>PO</button>
                    ) : (
                      <div style={{ width: 42, flexShrink: 0 }} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: info panel ────────────────────────────────────────────── */}
        <div style={{ width: 280, flexShrink: 0, position: "sticky", top: 0, display: "flex", flexDirection: "column", gap: "1rem" }}>

          {/* Demand Forecast card */}
          <div style={{ background: "#1e3154", borderRadius: 12, padding: "1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.1rem" }}>
              <BarChart3 style={{ width: 16, height: 16, color: "#f97316" }} />
              <span style={{ color: "#fff", fontWeight: 700, fontSize: "0.9rem" }}>Demand Forecast</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {MODEL_ROWS.map(r => (
                <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: "0.72rem", color: "#94a3b8", flexShrink: 0 }}>{r.label}</span>
                  <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "#fff", textAlign: "right" }}>{r.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Material Forecast Table */}
          <div style={{ background: "#fff", borderRadius: 12, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem" }}>
              <BarChart3 style={{ width: 15, height: 15, color: "#f97316" }} />
              <span style={{ fontWeight: 700, fontSize: "0.875rem", color: "#111827" }}>Material Forecast Table</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {FORECAST_TABLE.map((r, i) => (
                <div key={r.name} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "0.5rem 0",
                  borderBottom: i < FORECAST_TABLE.length - 1 ? "1px solid #f3f4f6" : "none",
                }}>
                  <span style={{ fontSize: "0.78rem", color: "#374151" }}>{r.name}</span>
                  <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: r.sBg, color: r.sColor }}>
                    · {r.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
