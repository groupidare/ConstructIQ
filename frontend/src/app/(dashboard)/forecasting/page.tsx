"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "@/components/layout/Header";
import { TrendingUp, AlertTriangle } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, TooltipProps,
} from "recharts";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/authStore";
import { useModelTraining } from "@/hooks/useModelTraining";
import ModelStatusPanel from "@/components/forecasting/ModelStatusPanel";
import type { MonthlyDemandSummary, MaterialOption, FlaggedExcessItem } from "@/types/boq";

// ── Chart point + tooltip ────────────────────────────────────────────────────

interface ChartPoint {
  month: string;
  monthLabel: string;
  actual?: number;
  purchased?: number;
  predicted?: number;
  projectCount: number;
  contributingProjects: string[];
  estimatedTotal: number | null;
  excessTotal: number | null;
  wasteTotal: number | null;
}

// The tooltip follows the cursor, so nothing inside it can be clicked — a
// show/hide toggle isn't reachable. The first few names plus a count keeps
// the numbers below them in view even when dozens of projects finished in
// the same month.
const TOOLTIP_PROJECT_NAMES = 5;

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as ChartPoint;
  const row = (label: string, value: number | null | undefined, color?: string) =>
    value == null ? null : (
      <p style={{ margin: "2px 0", color: color ?? "#374151" }}>
        {label}: <strong>{value.toLocaleString()}</strong>
      </p>
    );
  const shownNames = point.contributingProjects.slice(0, TOOLTIP_PROJECT_NAMES);
  const hiddenCount = point.contributingProjects.length - shownNames.length;
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.75rem 0.9rem", fontSize: "0.75rem", maxWidth: 260, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}>
      <p style={{ fontWeight: 800, marginBottom: 2 }}>{point.monthLabel}</p>
      {point.projectCount > 0 && (
        <>
          <p style={{ color: "#6b7280", fontWeight: 600, marginBottom: 2 }}>
            {point.projectCount} project{point.projectCount > 1 ? "s" : ""}
          </p>
          <p style={{ color: "#9ca3af", marginBottom: 6, fontSize: "0.7rem" }}>
            {shownNames.join(", ")}{hiddenCount > 0 && ` and ${hiddenCount} more`}
          </p>
        </>
      )}
      {row("Estimated", point.estimatedTotal)}
      {row("Excess", point.excessTotal)}
      {row("Waste", point.wasteTotal)}
      {row("Purchased (PO)", point.purchased, "#2563eb")}
      {row("Actual Usage", point.actual, "#374151")}
      {row("AI Predicted", point.predicted, "#f97316")}
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
  // Bumped when a training run finishes — the chart's AI Predicted line for
  // historical projects comes from the new model's evaluations, so reload it.
  const [dataVersion, setDataVersion] = useState(0);
  const { user } = useAuthStore();
  const isAdmin = user?.role === "Admin";
  const training = useModelTraining({
    isAdmin,
    onRunFinished: job => {
      if (job.status === "succeeded") toast.success("Model trained — forecasts now use the new model.");
      else if (job.status === "failed") toast.error(job.error ?? "Training failed — the previous model is still active.");
      setDataVersion(v => v + 1);
    },
  });

  // Material selector: every unique material+unit pair that has ever
  // contributed a real, unit-safe Actual Usage figure, highest-demand first —
  // the same list the backend ranks for us (GetMaterialOptionsAsync).
  useEffect(() => {
    let cancelled = false;
    api.get<MaterialOption[]>("/boq/material-options")
      .then(({ data }) => {
        if (cancelled) return;
        setMaterials(data);
        // Keep the current selection across a reload (e.g. after training)
        // when it's still in the list; otherwise start at the top.
        setSelectedKey(prev => prev && data.some(m => `${m.materialId}:${m.unit}` === prev)
          ? prev
          : data.length > 0 ? `${data[0].materialId}:${data[0].unit}` : null);
      })
      .catch(() => { if (!cancelled) setError("Failed to load the material list."); })
      .finally(() => { if (!cancelled) setLoadingMaterials(false); });
    api.get<FlaggedExcessItem[]>("/boq/flagged-excess-items")
      .then(({ data }) => { if (!cancelled) setFlagged(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dataVersion]);

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
  }, [selected, dataVersion]);

  // Axis label: month name alone once inside a year already shown, "Mon
  // YYYY" the first time a new year appears.
  const chartData: ChartPoint[] = summary.map((m, i) => {
    const year = m.month.slice(0, 4);
    const prevYear = i > 0 ? summary[i - 1].month.slice(0, 4) : null;
    return {
      month: year === prevYear ? m.monthLabel.split(" ")[0] : m.monthLabel,
      monthLabel: m.monthLabel,
      actual: m.actualUsage ?? undefined,
      purchased: m.purchasedTotal ?? undefined,
      // Rounded up like every other forecast display — a material quantity
      // isn't fractional, and rounding down would understate what's needed.
      predicted: m.aiPredicted == null ? undefined : Math.ceil(m.aiPredicted),
      projectCount: m.projectCount,
      contributingProjects: m.contributingProjects,
      estimatedTotal: m.estimatedTotal,
      excessTotal: m.excessTotal,
      wasteTotal: m.wasteTotal,
    };
  });

  const selectedMaterial = materials.find(m => `${m.materialId}:${m.unit}` === selectedKey);

  // Real accuracy only — computed from the same Purchased/Predicted pairs
  // the chart itself plots, never a stored/fabricated figure. Scored against
  // Purchased (PO), not Actual Usage: the PO quantity is what the model is
  // trained to predict (what to order for a BOQ line). A month missing
  // either side (one of them null) contributes nothing; there's genuinely
  // no comparison to score for it. Accuracy per point = 100% minus the
  // absolute error as a percentage of the purchased quantity, floored at 0
  // so a wildly-off prediction reads as 0%, not a negative number.
  const accuracyPoints = chartData.filter(
    (p): p is ChartPoint & { purchased: number; predicted: number } => p.purchased != null && p.predicted != null && p.purchased > 0,
  );
  const meanAbsoluteError = accuracyPoints.length > 0
    ? accuracyPoints.reduce((sum, p) => sum + Math.abs(p.purchased - p.predicted), 0) / accuracyPoints.length
    : null;
  const modelAccuracy = accuracyPoints.length > 0
    ? accuracyPoints.reduce((sum, p) => sum + Math.max(0, 100 - (Math.abs(p.purchased - p.predicted) / p.purchased) * 100), 0) / accuracyPoints.length
    : null;

  return (
    <div style={{ background: "#f5f4f0", minHeight: "100vh" }}>
      <Header title="Forecasting" />

      <div className="responsive-page" style={{ padding: "1.25rem 1.5rem" }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>

          {/* Header + material selector */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TrendingUp style={{ width: 16, height: 16, color: "#f97316" }} />
                <span style={{ fontWeight: 700, fontSize: "1rem" }}>AI Material Demand Forecast</span>
              </div>
              <p style={{ color: "#9ca3af", fontSize: "0.72rem", marginTop: 3 }}>
                Completed projects demand over time: what was purchased (PO) and actually used, against the AI&apos;s prediction — the original forecast for live projects, a held-out model evaluation for historical ones.
              </p>
              {modelAccuracy != null && meanAbsoluteError != null && (
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <span style={{ padding: "4px 10px", borderRadius: 999, background: "#dcfce7", color: "#15803d", fontSize: "0.72rem", fontWeight: 700 }}>
                    Model Accuracy (vs Purchased): {modelAccuracy.toFixed(1)}%
                  </span>
                  <span style={{ padding: "4px 10px", borderRadius: 999, background: "#f3f4f6", color: "#374151", fontSize: "0.72rem", fontWeight: 700 }}>
                    Error Margin: ±{meanAbsoluteError.toLocaleString(undefined, { maximumFractionDigits: 1 })} {selectedMaterial?.unit}
                  </span>
                  <span style={{ fontSize: "0.68rem", color: "#9ca3af", alignSelf: "center" }}>
                    across {accuracyPoints.length} scored month{accuracyPoints.length > 1 ? "s" : ""}
                  </span>
                </div>
              )}
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

          <ModelStatusPanel
            status={training.status}
            report={training.report}
            reportError={training.reportError}
            isAdmin={isAdmin}
            running={training.running}
            starting={training.starting}
            onRetrain={training.startTraining}
          />

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
              No completed-project data yet — projects appear on this chart once they&apos;re completed.
            </p>
          ) : chartData.length === 0 ? (
            <p style={{ fontSize: "0.82rem", color: "#9ca3af", padding: "2rem 0", textAlign: "center" }}>
              No completed-project data for {selectedMaterial?.materialName ?? "this material"} yet.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: "0.78rem", paddingTop: 16 }} />
                {/* connectNulls={false} — a missing month must render as a
                    real gap, never bridged as if data existed. */}
                <Line type="monotone" dataKey="purchased" name="Purchased (PO)" stroke="#2563eb" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4, fill: "#2563eb" }} connectNulls={false} />
                <Line type="monotone" dataKey="actual"    name="Actual Usage" stroke="#374151" strokeWidth={2.5} dot={{ r: 4, fill: "#374151" }} connectNulls={false} />
                <Line type="monotone" dataKey="predicted" name="AI Predicted" stroke="#f97316" strokeWidth={2.5} dot={{ r: 4, fill: "#f97316" }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
