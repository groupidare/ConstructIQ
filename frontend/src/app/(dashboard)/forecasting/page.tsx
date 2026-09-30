"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "@/components/layout/Header";
import { TrendingUp, AlertTriangle } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, TooltipProps,
} from "recharts";
import api from "@/lib/api";
import type { MonthlyDemandSummary, MaterialOption, FlaggedExcessItem } from "@/types/boq";

// ── Chart point + tooltip ────────────────────────────────────────────────────

interface ChartPoint {
  month: string;
  monthLabel: string;
  actual?: number;
  predicted?: number;
  status: "Provisional" | "Finalized" | null;
  contributingProjects: string[];
  estimatedTotal: number | null;
  excessTotal: number | null;
  wasteTotal: number | null;
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as ChartPoint;
  const row = (label: string, value: number | null | undefined, color?: string) =>
    value == null ? null : (
      <p style={{ margin: "2px 0", color: color ?? "#374151" }}>
        {label}: <strong>{value.toLocaleString()}</strong>
      </p>
    );
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.75rem 0.9rem", fontSize: "0.75rem", maxWidth: 260, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}>
      <p style={{ fontWeight: 800, marginBottom: 6 }}>{point.monthLabel}</p>
      {point.contributingProjects.length > 0 && (
        <p style={{ color: "#9ca3af", marginBottom: 6, fontSize: "0.7rem" }}>{point.contributingProjects.join(", ")}</p>
      )}
      {row("Estimated", point.estimatedTotal)}
      {row("Excess", point.excessTotal)}
      {row("Waste", point.wasteTotal)}
      {row("Actual Usage", point.actual, "#374151")}
      {row("AI Predicted", point.predicted, "#f97316")}
      {point.status && (
        <span style={{
          display: "inline-block", marginTop: 8, padding: "2px 8px", borderRadius: 999, fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.03em",
          background: point.status === "Finalized" ? "#dcfce7" : "#fef3c7", color: point.status === "Finalized" ? "#15803d" : "#b45309",
        }}>
          {point.status.toUpperCase()}
        </span>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ForecastingPage() {
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null); // `${materialId}:${unit}`
  const [summary, setSummary] = useState<MonthlyDemandSummary[]>([]);
  const [flagged, setFlagged] = useState<FlaggedExcessItem[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFlagged, setShowFlagged] = useState(false);

  // Material selector: every unique material+unit pair that has ever
  // contributed a real, unit-safe Actual Usage figure, highest-demand first —
  // the same list the backend ranks for us (GetMaterialOptionsAsync).
  useEffect(() => {
    let cancelled = false;
    api.get<MaterialOption[]>("/boq/material-options")
      .then(({ data }) => {
        if (cancelled) return;
        setMaterials(data);
        if (data.length > 0) setSelectedKey(`${data[0].materialId}:${data[0].unit}`);
      })
      .catch(() => { if (!cancelled) setError("Failed to load the material list."); })
      .finally(() => { if (!cancelled) setLoadingMaterials(false); });
    api.get<FlaggedExcessItem[]>("/boq/flagged-excess-items")
      .then(({ data }) => { if (!cancelled) setFlagged(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(() => {
    if (!selectedKey) return null;
    const [materialId, unit] = selectedKey.split(":");
    return { materialId: Number(materialId), unit };
  }, [selectedKey]);

  useEffect(() => {
    if (!selected) { setSummary([]); return; }
    let cancelled = false;
    setLoadingSummary(true);
    setError(null);
    api.get<MonthlyDemandSummary[]>("/boq/monthly-demand-summary", { params: { materialId: selected.materialId, unit: selected.unit } })
      .then(({ data }) => { if (!cancelled) setSummary(data); })
      .catch(() => { if (!cancelled) setError("Failed to load the chart for this material."); })
      .finally(() => { if (!cancelled) setLoadingSummary(false); });
    return () => { cancelled = true; };
  }, [selected]);

  // Axis label: month name alone once inside a year already shown, "Mon
  // YYYY" the first time a new year appears.
  const chartData: ChartPoint[] = summary.map((m, i) => {
    const year = m.month.slice(0, 4);
    const prevYear = i > 0 ? summary[i - 1].month.slice(0, 4) : null;
    return {
      month: year === prevYear ? m.monthLabel.split(" ")[0] : m.monthLabel,
      monthLabel: m.monthLabel,
      actual: m.actualUsage ?? undefined,
      predicted: m.aiPredicted ?? undefined,
      status: m.reconciliationStatus,
      contributingProjects: m.contributingProjects,
      estimatedTotal: m.estimatedTotal,
      excessTotal: m.excessTotal,
      wasteTotal: m.wasteTotal,
    };
  });

  const selectedMaterial = materials.find(m => `${m.materialId}:${m.unit}` === selectedKey);

  return (
    <div style={{ background: "#f5f4f0", minHeight: "100vh" }}>
      <Header title="Forecasting" />

      <div style={{ padding: "1.25rem 1.5rem" }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>

          {/* Header + material selector */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TrendingUp style={{ width: 16, height: 16, color: "#f97316" }} />
                <span style={{ fontWeight: 700, fontSize: "1rem" }}>AI Material Demand Forecast</span>
              </div>
              <p style={{ color: "#9ca3af", fontSize: "0.72rem", marginTop: 3 }}>
                Actual Usage is calculated from reconciled Excess/Waste records; AI Predicted is the forecasting model&apos;s own output — never the same figure.
              </p>
            </div>
            {materials.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <select
                  value={selectedKey ?? ""}
                  onChange={e => setSelectedKey(e.target.value)}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f9fafb", fontSize: "0.8rem", outline: "none", cursor: "pointer", minWidth: 220 }}
                >
                  {materials.map(m => (
                    <option key={`${m.materialId}:${m.unit}`} value={`${m.materialId}:${m.unit}`}>
                      {m.materialName} ({m.unit})
                    </option>
                  ))}
                </select>
                {selectedMaterial && (
                  <span style={{ padding: "5px 10px", borderRadius: 999, background: "#f3f4f6", fontSize: "0.7rem", fontWeight: 700, color: "#374151" }}>
                    {selectedMaterial.unit}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Flagged-items banner */}
          {flagged.length > 0 && (
            <div style={{ marginBottom: "0.75rem" }}>
              <button
                onClick={() => setShowFlagged(s => !s)}
                style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: "0.55rem 0.85rem", fontSize: "0.75rem", color: "#c2410c", fontWeight: 600, cursor: "pointer", width: "100%", textAlign: "left" }}
              >
                <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0 }} />
                {flagged.length} BOQ item{flagged.length > 1 ? "s are" : " is"} excluded from these charts due to data issues — click to review
              </button>
              {showFlagged && (
                <div style={{ border: "1px solid #f3f4f6", borderTop: "none", borderRadius: "0 0 8px 8px", padding: "0.5rem 0.85rem" }}>
                  {flagged.map(f => (
                    <p key={f.boqItemId} style={{ fontSize: "0.72rem", color: "#6b7280", margin: "4px 0" }}>
                      <strong>{f.materialName}</strong> ({f.projectName}) — {f.reason}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Chart / states */}
          {loadingMaterials || loadingSummary ? (
            <div style={{ padding: "2.5rem 0", textAlign: "center" }}>
              <div style={{ width: 28, height: 28, border: "3px solid #f3f4f6", borderTopColor: "#f97316", borderRadius: "50%", margin: "0 auto 10px", animation: "spin 0.8s linear infinite" }} />
              <p style={{ fontSize: "0.8rem", color: "#9ca3af" }}>Loading…</p>
              <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
            </div>
          ) : error ? (
            <p style={{ fontSize: "0.82rem", color: "#b91c1c", padding: "2rem 0", textAlign: "center" }}>{error}</p>
          ) : materials.length === 0 ? (
            <p style={{ fontSize: "0.82rem", color: "#9ca3af", padding: "2rem 0", textAlign: "center" }}>
              No reconciled excess/waste data yet — record Excess or Waste against a BOQ item to see this chart.
            </p>
          ) : chartData.length === 0 ? (
            <p style={{ fontSize: "0.82rem", color: "#9ca3af", padding: "2rem 0", textAlign: "center" }}>
              No reconciled data for {selectedMaterial?.materialName ?? "this material"} yet.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: "0.78rem", paddingTop: 16 }} />
                {/* connectNulls intentionally omitted (defaults to false) — a
                    missing month must render as a real gap, never bridged as
                    if data existed. */}
                <Line type="monotone" dataKey="actual"    name="Actual Usage" stroke="#374151" strokeWidth={2.5} dot={{ r: 4, fill: "#374151" }} />
                <Line type="monotone" dataKey="predicted" name="AI Predicted" stroke="#f97316" strokeWidth={2.5} dot={{ r: 4, fill: "#f97316" }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
