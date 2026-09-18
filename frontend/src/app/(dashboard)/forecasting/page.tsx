"use client";

import Header from "@/components/layout/Header";
import { BarChart3, TrendingUp } from "lucide-react";
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

const MODEL_ROWS = [
  { label: "Algorithm",      value: "Random Forest + XGBoost"   },
  { label: "Training Data",  value: "155 BOQ records · 8 projects · Actual Usage" },
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
  return (
    <div style={{ background: "#f5f4f0" }}>
      <Header title="Forecasting" />

      <div style={{ padding: "1.25rem 1.5rem", display: "flex", gap: "1rem", alignItems: "flex-start" }}>

        {/* ── Left: demand forecast ────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0 }}>
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
          </div>
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
