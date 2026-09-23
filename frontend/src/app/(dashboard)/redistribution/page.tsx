"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import Header from "@/components/layout/Header";
import { useProcurement } from "@/hooks/useProcurement";
import type { RedistributionRecommendation, RedistributionStatus } from "@/types/procurement";
import { Zap, Package, ClipboardCheck, Repeat, CheckSquare, Eye, X, RefreshCw } from "lucide-react";

// ── Need coverage (how much of the target's shortage the transfer fills) ───
function compatibilityOf(r: RedistributionRecommendation) {
  const ratio = r.neededQuantity > 0 ? r.transferQuantity / r.neededQuantity : 1;
  if (ratio >= 0.9) return { label: "90%+ NEED COVERAGE",   bg: "#dcfce7", color: "#15803d", ratio };
  if (ratio >= 0.5) return { label: "50-89% NEED COVERAGE", bg: "#fef3c7", color: "#b45309", ratio };
  return              { label: "<50% NEED COVERAGE",        bg: "#fee2e2", color: "#dc2626", ratio };
}

const ACTIVE_STATUSES: RedistributionStatus[] = ["AiSuggested", "PendingApproval", "Approved", "InTransit"];
const APPROVABLE_STATUSES: RedistributionStatus[] = ["AiSuggested", "PendingApproval"];

const PRIORITY_STYLE: Record<string, { bg: string; color: string }> = {
  High:   { bg: "#fee2e2", color: "#dc2626" },
  Medium: { bg: "#fef3c7", color: "#b45309" },
  Low:    { bg: "#f3f4f6", color: "#6b7280" },
};

function priorityAdvice(priority: string): string {
  if (priority === "High")   return "High priority — the target project has an active shortage. Recommend immediate transfer.";
  if (priority === "Medium") return "Medium priority — schedule the transfer within the week to stay ahead of the target project's reorder point.";
  return "Low priority — no urgent shortage detected at the target project. Transfer at logistical convenience.";
}

// ── Detailed Analysis modal ─────────────────────────────────────────────────

function ReviewModal({ item, onClose }: { item: RedistributionRecommendation; onClose: () => void }) {
  const compat = compatibilityOf(item);

  const row = (label: string, value: string) => (
    <div>
      <p style={{ fontSize: "0.65rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em", marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: "0.85rem", color: "#111827", fontWeight: 600, lineHeight: 1.4 }}>{value}</p>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Package style={{ width: 18, height: 18, color: "#f97316" }} />
            </div>
            <div>
              <h2 style={{ fontWeight: 800, fontSize: "1.05rem", margin: 0 }}>Detailed Analysis</h2>
              <p style={{ fontSize: "0.72rem", color: "#9ca3af", margin: 0 }}>{item.materialName} · {item.sourceProjectName} → {item.targetProjectName}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: "1.25rem" }}>
          <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: compat.bg, color: compat.color }}>· {compat.label}</span>
          <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: PRIORITY_STYLE[item.priority]?.bg ?? "#f3f4f6", color: PRIORITY_STYLE[item.priority]?.color ?? "#6b7280" }}>{item.priority} priority</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.25rem" }}>
          {row("AVAILABLE AT SOURCE", `${item.availableQuantity.toLocaleString()} ${item.unit}`)}
          {row("NEEDED AT TARGET", `${item.neededQuantity.toLocaleString()} ${item.unit}`)}
          {row("TRANSFER QUANTITY", `${item.transferQuantity.toLocaleString()} ${item.unit}`)}
        </div>

        <div>
          <p style={{ fontSize: "0.65rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em", marginBottom: 6 }}>AI RECOMMENDATION</p>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.7rem 0.9rem", fontSize: "0.78rem", color: "#374151", lineHeight: 1.5 }}>
            {item.notes && <p style={{ marginBottom: 6 }}>{item.notes}</p>}
            <p>{priorityAdvice(item.priority)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RedistributionPage() {
  const { redistribution, fetchRedistribution, generateRedistribution, approveTransfer, rejectTransfer, cancelApproval } = useProcurement(0);

  const [generating, setGenerating] = useState(false);
  const [executingAll, setExecutingAll] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [cancelingId, setCancelingId] = useState<number | null>(null);
  const [reviewItem, setReviewItem] = useState<RedistributionRecommendation | null>(null);

  useEffect(() => {
    generateRedistribution().catch(() => fetchRedistribution());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deadStockCount = new Set(redistribution.map(r => `${r.sourceProjectId}-${r.sourceMaterialId}`)).size;

  const activeOpportunities     = redistribution.filter(r => ACTIVE_STATUSES.includes(r.status));
  const approvableOpportunities = redistribution.filter(r => APPROVABLE_STATUSES.includes(r.status));

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generateRedistribution();
      toast.success("Redistribution opportunities refreshed.");
    } catch {
      toast.error("Failed to refresh redistribution opportunities.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleApprove(id: number) {
    setApprovingId(id);
    try {
      await approveTransfer(id);
      toast.success("Transfer approved.");
    } catch {
      toast.error("Failed to approve transfer.");
    } finally {
      setApprovingId(null);
    }
  }

  async function handleReject(id: number) {
    if (!window.confirm("Reject this AI-recommended transfer? It won't be suggested again unless conditions change.")) return;
    setRejectingId(id);
    try {
      await rejectTransfer(id);
      toast.success("Recommendation rejected.");
    } catch {
      toast.error("Failed to reject recommendation.");
    } finally {
      setRejectingId(null);
    }
  }

  async function handleCancelApproval(id: number) {
    setCancelingId(id);
    try {
      await cancelApproval(id);
      toast.success("Approval cancelled — back to pending.");
    } catch {
      toast.error("Failed to cancel approval.");
    } finally {
      setCancelingId(null);
    }
  }

  async function handleExecuteAll() {
    if (approvableOpportunities.length === 0) return;
    setExecutingAll(true);
    try {
      await Promise.all(approvableOpportunities.map(r => approveTransfer(r.id)));
      toast.success(`Approved ${approvableOpportunities.length} redistribution${approvableOpportunities.length > 1 ? "s" : ""}.`);
    } catch {
      toast.error("Some transfers failed to approve.");
    } finally {
      setExecutingAll(false);
    }
  }

  return (
    <div style={{ background: "#f5f4f0" }}>
      {reviewItem && <ReviewModal item={reviewItem} onClose={() => setReviewItem(null)} />}
      <Header title="Redistribution" />

      <div style={{ padding: "1.25rem 1.5rem" }}>

        {/* ── 3 stat cards — all derived from real redistribution data ─────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
          {[
            { icon: Repeat,         color: "#0d9488", bg: "#ccfbf1", label: "Active Opportunities", value: String(activeOpportunities.length) },
            { icon: ClipboardCheck, color: "#15803d", bg: "#dcfce7", label: "Pending Approval",      value: String(approvableOpportunities.length) },
            { icon: Package,        color: "#b45309", bg: "#fef3c7", label: "Dead Stock Items",      value: String(deadStockCount) },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} style={{ background: "#fff", borderRadius: 14, padding: "1.5rem 1.5rem 1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
                <div style={{ width: 44, height: 44, borderRadius: 11, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "0.875rem" }}>
                  <Icon style={{ width: 22, height: 22, color: s.color }} />
                </div>
                <p style={{ fontSize: "1.7rem", fontWeight: 800, color: "#111827", lineHeight: 1 }}>{s.value}</p>
                <p style={{ fontSize: "0.78rem", color: "#9ca3af", marginTop: 4 }}>{s.label}</p>
              </div>
            );
          })}
        </div>

        {/* ── AI Redistribution Engine banner ─────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 14, padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Zap style={{ width: 20, height: 20, color: "#f97316" }} />
            <div>
              <p style={{ fontWeight: 700, fontSize: "0.9rem", color: "#111827" }}>
                AI Redistribution Engine — {activeOpportunities.length} opportunit{activeOpportunities.length === 1 ? "y" : "ies"} detected
              </p>
              <p style={{ fontSize: "0.78rem", color: "#6b7280", marginTop: 2 }}>
                AI-recommended transfers between projects with matching excess and shortages
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleGenerate} disabled={generating} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "0.8rem", fontWeight: 600, cursor: generating ? "default" : "pointer", opacity: generating ? 0.6 : 1 }}>
              <RefreshCw style={{ width: 14, height: 14 }} /> {generating ? "Refreshing…" : "Refresh"}
            </button>
            <button onClick={handleExecuteAll} disabled={executingAll || approvableOpportunities.length === 0} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontSize: "0.8rem", fontWeight: 700, cursor: executingAll || approvableOpportunities.length === 0 ? "default" : "pointer", opacity: executingAll || approvableOpportunities.length === 0 ? 0.6 : 1 }}>
              {executingAll ? "Executing…" : "Execute All"}
            </button>
          </div>
        </div>

        {/* ── Opportunities list ───────────────────────────────────────────── */}
        <div style={{ background: "#fff", borderRadius: 14, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Repeat style={{ width: 16, height: 16, color: "#f97316" }} />
            <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Material Redistribution Opportunities</span>
          </div>
          <p style={{ fontSize: "0.78rem", color: "#9ca3af", marginBottom: "1rem" }}>AI-recommended transfers between projects, based on current excess inventory and excess/waste logs</p>

          {activeOpportunities.length === 0 && (
            <p style={{ textAlign: "center", color: "#9ca3af", fontSize: "0.85rem", padding: "2rem 0" }}>
              No redistribution opportunities right now — no project currently has excess that matches another project's shortage.
            </p>
          )}

          <div>
            {activeOpportunities.map((r, i) => {
              const compat = compatibilityOf(r);
              const canApprove = APPROVABLE_STATUSES.includes(r.status);
              return (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "1rem 0", borderTop: i > 0 ? "1px solid #f3f4f6" : "none", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: compat.bg, color: compat.color, whiteSpace: "nowrap" }}>· {compat.label}</span>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#111827" }}>{r.materialName}</span>
                      {r.status !== "AiSuggested" && (
                        <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#f3f4f6", color: "#6b7280" }}>{r.status}</span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: "0.78rem", color: "#374151", background: "#f9fafb", padding: "3px 10px", borderRadius: 6 }}>{r.sourceProjectName}</span>
                      <span style={{ color: "#f97316" }}>›</span>
                      <span style={{ fontSize: "0.78rem", color: "#374151", background: "#f9fafb", padding: "3px 10px", borderRadius: 6 }}>{r.targetProjectName}</span>
                    </div>
                    <p style={{ fontSize: "0.78rem", color: "#6b7280" }}>
                      Qty: {r.transferQuantity.toLocaleString()} {r.unit}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    {r.status === "Approved" ? (
                      <>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: "#e5e7eb", color: "#9ca3af", fontSize: "0.8rem", fontWeight: 600 }}>
                          <CheckSquare style={{ width: 14, height: 14 }} /> Approved
                        </span>
                        <button
                          onClick={() => handleCancelApproval(r.id)}
                          disabled={cancelingId === r.id}
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff", color: "#dc2626", fontSize: "0.8rem", fontWeight: 600, cursor: cancelingId === r.id ? "default" : "pointer" }}
                        >
                          <X style={{ width: 14, height: 14 }} /> {cancelingId === r.id ? "Cancelling…" : "Cancel"}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleApprove(r.id)}
                          disabled={!canApprove || approvingId === r.id}
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "none", background: canApprove ? "#f97316" : "#e5e7eb", color: canApprove ? "#fff" : "#9ca3af", fontSize: "0.8rem", fontWeight: 600, cursor: canApprove && approvingId !== r.id ? "pointer" : "default" }}
                        >
                          <CheckSquare style={{ width: 14, height: 14 }} /> {approvingId === r.id ? "Approving…" : canApprove ? "Approve" : r.status}
                        </button>
                        {canApprove && (
                          <button
                            onClick={() => handleReject(r.id)}
                            disabled={rejectingId === r.id}
                            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff", color: "#dc2626", fontSize: "0.8rem", fontWeight: 600, cursor: rejectingId === r.id ? "default" : "pointer" }}
                          >
                            <X style={{ width: 14, height: 14 }} /> {rejectingId === r.id ? "Rejecting…" : "Reject"}
                          </button>
                        )}
                      </>
                    )}
                    <button onClick={() => setReviewItem(r)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "0.8rem", fontWeight: 500, cursor: "pointer" }}>
                      <Eye style={{ width: 14, height: 14 }} /> Review
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
