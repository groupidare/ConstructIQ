"use client";

import { useEffect, useState } from "react";
import Header from "@/components/layout/Header";
import { TrendingUp } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import api from "@/lib/api";
import type { MonthlyDemandSummary } from "@/types/boq";

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ForecastingPage() {
  const [summary, setSummary] = useState<MonthlyDemandSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get<MonthlyDemandSummary[]>("/boq/monthly-demand-summary")
      .then(({ data }) => { if (!cancelled) setSummary(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Axis label: month name alone once inside a year already shown, "Mon
  // YYYY" the first time a new year appears — computed from each point's
  // own real month value, not a hardcoded year list.
  const chartData = summary.map((m, i) => {
    const year = m.month.slice(0, 4);
    const prevYear = i > 0 ? summary[i - 1].month.slice(0, 4) : null;
    const label = year === prevYear ? m.monthLabel.split(" ")[0] : m.monthLabel;
    return {
      month: label,
      actual: m.actualUsage ?? undefined,
      predicted: m.aiPredicted ?? undefined,
    };
  });

  return (
    <div style={{ background: "#f5f4f0", minHeight: "100vh" }}>
      <Header title="Forecasting" />

      <div style={{ padding: "1.25rem 1.5rem" }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
          <div style={{ marginBottom: "1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <TrendingUp style={{ width: 16, height: 16, color: "#f97316" }} />
              <span style={{ fontWeight: 700, fontSize: "1rem" }}>AI Material Demand Forecast</span>
            </div>
            <p style={{ color: "#9ca3af", fontSize: "0.72rem", marginTop: 3 }}>
              Real project data — each point averages every project&apos;s AI-predicted Est. Qty and Actual Usage for that month.
            </p>
          </div>

          {loading ? (
            <p style={{ fontSize: "0.82rem", color: "#9ca3af", padding: "2rem 0", textAlign: "center" }}>Loading…</p>
          ) : chartData.length === 0 ? (
            <p style={{ fontSize: "0.82rem", color: "#9ca3af", padding: "2rem 0", textAlign: "center" }}>
              No BOQ data yet — upload and save a Material Plan for at least one project to see this chart.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: "0.75rem" }} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: "0.78rem", paddingTop: 16 }} />
                <Line type="monotone" dataKey="actual"    name="Actual Usage" stroke="#374151" strokeWidth={2.5} dot={{ r: 4, fill: "#374151" }} connectNulls />
                <Line type="monotone" dataKey="predicted" name="AI Predicted" stroke="#f97316" strokeWidth={2.5} dot={{ r: 4, fill: "#f97316" }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
