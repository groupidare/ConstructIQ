"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Brain, RefreshCw, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import type { ModelMetrics, ModelStatus, TrainingDataReport } from "@/types/forecast";

// The forecasting model's state, shown above the Forecasting chart to every
// role: whether a trained model exists (and if not, that AI forecasting is
// unavailable), when it was trained, on how much data, how well it scored,
// and whether it's rated Low Confidence. Admins also get the training-data
// eligibility report and the Retrain Model button.

function fmtNumber(n: number | null | undefined, digits = 1): string {
  return n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
}

function MetricRow({ label, m }: { label: string; m: ModelMetrics | null | undefined }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) repeat(4, minmax(0,1fr))", gap: 6, fontSize: "0.72rem", padding: "3px 0" }}>
      <span style={{ color: "#6b7280" }}>{label}</span>
      <span>MAE {fmtNumber(m?.mae)}</span>
      <span>RMSE {fmtNumber(m?.rmse)}</span>
      <span>R² {fmtNumber(m?.r2, 2)}</span>
      <span style={{ color: "#9ca3af" }}>{m ? `${m.n.toLocaleString()} rows` : ""}</span>
    </div>
  );
}

const pill = (bg: string, color: string) => ({
  padding: "3px 10px", borderRadius: 999, background: bg, color, fontSize: "0.7rem", fontWeight: 700, whiteSpace: "nowrap" as const,
});

export default function ModelStatusPanel({ status, report, reportError, isAdmin, running, starting, onRetrain }: {
  status: ModelStatus | null;
  report: TrainingDataReport | null;
  reportError: string | null;
  isAdmin: boolean;
  running: boolean;
  starting: boolean;
  onRetrain: () => Promise<void>;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);

  if (!status) {
    return <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "0.85rem 1rem", marginBottom: "1rem", fontSize: "0.78rem", color: "#9ca3af" }}>Loading model status…</div>;
  }

  const manifest = status.model.manifest;
  const trained = status.serviceReachable && status.model.trained && manifest != null;
  const lowConfidence = trained && manifest.confidence === "Low";
  const lastRun = status.training;
  const canTrain = report?.canTrain ?? true;

  async function handleRetrain() {
    try {
      await onRetrain();
      toast.success("Training started — this page updates when it finishes.");
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Couldn't start training.");
    }
  }

  const excluded = report?.projects.filter(p => !p.eligible || p.reason) ?? [];

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "0.9rem 1rem", marginBottom: "1rem", background: trained ? "#fff" : "#fffbeb" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Brain style={{ width: 15, height: 15, color: "#f97316" }} />
            <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>Model status:</span>
            {!status.serviceReachable ? (
              <span style={pill("#fee2e2", "#b91c1c")}>Unavailable</span>
            ) : trained ? (
              <span style={pill("#dcfce7", "#15803d")}>Trained</span>
            ) : (
              <span style={pill("#fef3c7", "#b45309")}>Not trained</span>
            )}
            {lowConfidence && <span style={pill("#fef3c7", "#b45309")}>Low Confidence</span>}
            {running && <span style={pill("#dbeafe", "#1d4ed8")}>Training in progress…</span>}
          </div>

          {trained ? (
            <p style={{ fontSize: "0.74rem", color: "#4b5563", marginTop: 6, lineHeight: 1.6 }}>
              Last trained: <strong>{fmtDate(manifest.trainedAt)}</strong>
              {" · "}Training rows: <strong>{manifest.sampleCount.toLocaleString()}</strong>
              {" · "}Projects used: <strong>{manifest.projectCount.toLocaleString()}</strong>
              {" · "}Model version: <span style={{ fontFamily: "monospace" }}>{manifest.version}</span>
            </p>
          ) : (
            <p style={{ fontSize: "0.74rem", color: "#92400e", marginTop: 6, lineHeight: 1.6 }}>
              {status.serviceReachable
                ? "AI forecasting is unavailable until an administrator trains the model."
                : "The forecasting service can't be reached right now."}
              {status.model.message && <span style={{ color: "#a16207" }}> ({status.model.message})</span>}
            </p>
          )}

          {lowConfidence && manifest.confidenceReasons.length > 0 && (
            <p style={{ fontSize: "0.7rem", color: "#a16207", marginTop: 2 }}>
              Low confidence: {manifest.confidenceReasons.join(" ")}
            </p>
          )}

          {lastRun.status === "failed" && lastRun.error && (
            <p style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: "0.72rem", color: "#b91c1c", marginTop: 6 }}>
              <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0, marginTop: 1 }} />
              <span>Last training run ({fmtDate(lastRun.finishedAt)}) failed — {lastRun.error}{trained ? " The previous model is still active." : ""}</span>
            </p>
          )}
          {running && lastRun.startedAt && (
            <p style={{ fontSize: "0.7rem", color: "#1d4ed8", marginTop: 4 }}>Started {fmtDate(lastRun.startedAt)} — the current model stays active until the new one is ready.</p>
          )}
        </div>

        {isAdmin && (
          <button
            onClick={handleRetrain}
            disabled={running || starting || !status.serviceReachable || !canTrain}
            title={!canTrain ? "Not enough eligible training data yet — see the report below." : undefined}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "none",
              background: running || starting || !status.serviceReachable || !canTrain ? "#e5e7eb" : "#f97316",
              color: running || starting || !status.serviceReachable || !canTrain ? "#9ca3af" : "#fff",
              fontSize: "0.78rem", fontWeight: 700, cursor: running || starting || !canTrain ? "not-allowed" : "pointer", flexShrink: 0,
            }}
          >
            <RefreshCw style={{ width: 13, height: 13, animation: running ? "spin 1s linear infinite" : undefined }} />
            {running ? "Training…" : starting ? "Starting…" : "Retrain Model"}
          </button>
        )}
      </div>

      {trained && (
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setShowDetails(s => !s)} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, fontSize: "0.7rem", color: "#6b7280", cursor: "pointer" }}>
            {showDetails ? <ChevronUp style={{ width: 12, height: 12 }} /> : <ChevronDown style={{ width: 12, height: 12 }} />}
            Model quality
          </button>
          {showDetails && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #f3f4f6" }}>
              <p style={{ fontSize: "0.66rem", color: "#9ca3af", marginBottom: 2 }}>Holdout of unseen rows (80/20 split)</p>
              <MetricRow label="Ensemble (used)" m={manifest.metrics.ensemble} />
              <MetricRow label="Random Forest" m={manifest.metrics.randomForest} />
              <MetricRow label="XGBoost" m={manifest.metrics.xgboost} />
              <p style={{ fontSize: "0.66rem", color: "#9ca3af", margin: "6px 0 2px" }}>Whole unseen projects (leave-one-project-out) — judges confidence</p>
              <MetricRow label="Ensemble, by project" m={manifest.projectHoldout} />
              <p style={{ fontSize: "0.68rem", color: "#9ca3af", marginTop: 4 }}>
                {manifest.evaluatedProjects} historical project(s) evaluated for the chart
                {manifest.skippedEvaluations.length > 0 && `; ${manifest.skippedEvaluations.length} skipped (too little data from other projects to fit a model without them)`}.
              </p>
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #f3f4f6" }}>
          {reportError && !trained ? (
            <p style={{ fontSize: "0.72rem", color: "#b91c1c" }}>{reportError}</p>
          ) : !report ? (
            <p style={{ fontSize: "0.72rem", color: "#9ca3af" }}>Loading training data…</p>
          ) : (
            <>
              <p style={{ fontSize: "0.74rem", color: "#374151" }}>
                Training data: <strong>{report.eligibleProjects}</strong> eligible project(s) · <strong>{report.eligibleRows.toLocaleString()}</strong> eligible BOQ row(s)
                {" · "}<strong>{report.excludedProjects}</strong> of {report.completedProjects} completed project(s) excluded
              </p>
              {!report.canTrain && (
                <p style={{ fontSize: "0.7rem", color: "#b45309", marginTop: 2 }}>
                  Training needs at least {report.minRows} eligible rows from at least {report.minProjects} projects.
                </p>
              )}
              {excluded.length > 0 && (
                <>
                  <button onClick={() => setShowExcluded(s => !s)} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, marginTop: 4, fontSize: "0.7rem", color: "#6b7280", cursor: "pointer" }}>
                    {showExcluded ? <ChevronUp style={{ width: 12, height: 12 }} /> : <ChevronDown style={{ width: 12, height: 12 }} />}
                    Why some data is excluded ({excluded.length})
                  </button>
                  {showExcluded && (
                    <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 4 }}>
                      {excluded.map(p => (
                        <p key={p.projectId} style={{ fontSize: "0.7rem", color: "#6b7280", margin: "3px 0" }}>
                          <strong style={{ color: "#374151" }}>{p.projectName}</strong>
                          {p.eligible ? ` — ${p.eligibleRows} of ${p.boqRows} rows used. ` : " — excluded. "}
                          {p.reason}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
      <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
    </div>
  );
}
