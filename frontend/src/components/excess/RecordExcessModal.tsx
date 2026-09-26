"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { X, AlertTriangle, Plus, Trash2 } from "lucide-react";
import api from "@/lib/api";
import type { Project } from "@/types/project";
import type { PendingBOQItem } from "@/types/excess";

interface MaterialRow {
  boqItemId: number | null;
  materialId: number | null;
  description: string;
  unit: string;
  estQty: number;
  qty: string;
  kind: "Waste" | "Excess";
}

const EMPTY_ROW: MaterialRow = { boqItemId: null, materialId: null, description: "", unit: "", estQty: 0, qty: "", kind: "Excess" };

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8,
  border: "1px solid #e5e7eb", background: "#f9fafb", fontSize: "0.82rem", outline: "none", color: "#111827",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.65rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.04em", marginBottom: 5,
};

interface RecordExcessModalProps {
  projects: Project[];
  onClose: () => void;
  onSuccess?: () => void;
}

export default function RecordExcessModal({ projects, onClose, onSuccess }: RecordExcessModalProps) {
  const [projectId, setProjectId] = useState(0);
  const [rows, setRows]           = useState<MaterialRow[]>([{ ...EMPTY_ROW }]);
  const [submitting, setSubmitting] = useState(false);
  const [pendingItems, setPendingItems] = useState<PendingBOQItem[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);

  const selectedProject = useMemo(() => projects.find(p => p.id === projectId) ?? null, [projects, projectId]);

  // Every BOQ line for this project that hasn't had excess/waste logged
  // against it yet — this is what "the remaining materials list" means:
  // a material logged once (in this session or an earlier one) drops out.
  useEffect(() => {
    if (!projectId) { setPendingItems([]); return; }
    let cancelled = false;
    setLoadingPending(true);
    api.get<PendingBOQItem[]>(`/excess-waste/pending-boq-items/${projectId}`)
      .then(({ data }) => { if (!cancelled) setPendingItems(data); })
      .catch(() => { if (!cancelled) setPendingItems([]); })
      .finally(() => { if (!cancelled) setLoadingPending(false); });
    setRows([{ ...EMPTY_ROW }]);
    return () => { cancelled = true; };
  }, [projectId]);

  function updateRow(idx: number, patch: Partial<MaterialRow>) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function pickBoqItem(idx: number, boqItemId: number) {
    const item = pendingItems.find(p => p.boqItemId === boqItemId);
    if (!item) return;
    updateRow(idx, {
      boqItemId: item.boqItemId,
      materialId: item.materialId,
      description: item.materialName,
      unit: item.unit,
      estQty: item.estimatedQuantity,
    });
  }

  function addRow() {
    setRows(prev => [...prev, { ...EMPTY_ROW }]);
  }

  function removeRow(idx: number) {
    setRows(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx));
  }

  // Options for one row's picker: every pending item, minus whichever ones
  // other rows in this same form have already claimed (a row keeps its own
  // current pick in its own list even after picking it).
  function optionsFor(idx: number): PendingBOQItem[] {
    const claimedElsewhere = new Set(
      rows.filter((_, i) => i !== idx).map(r => r.boqItemId).filter((id): id is number => id !== null)
    );
    return pendingItems.filter(p => !claimedElsewhere.has(p.boqItemId));
  }

  function validate(): string | null {
    if (!projectId) return "Select a project.";
    for (const r of rows) {
      if (!r.boqItemId) return "Select a material from the Bill of Quantities for every row.";
      if (!r.qty || Number(r.qty) <= 0) return "Every material needs a quantity greater than 0.";
    }
    return null;
  }

  async function submitRows() {
    await Promise.all(rows.map(r => api.post("/excess-waste", {
      projectId,
      boqItemId: r.boqItemId,
      materialId: r.materialId,
      unit: r.unit,
      excessType: r.kind === "Waste" ? "Damaged" : "Overordered",
      isReusable: r.kind === "Excess",
      quantity: Number(r.qty),
      unitCost: 0,
    })));
  }

  async function handleSaveEntry() {
    const error = validate();
    if (error) { toast.error(error); return; }
    setSubmitting(true);
    try {
      await submitRows();
      toast.success("Entry saved.");
      onSuccess?.();
      onClose();
    } catch {
      toast.error("Failed to save entry.");
    } finally {
      setSubmitting(false);
    }
  }

  const noMaterialsLeft = projectId > 0 && !loadingPending && pendingItems.length === 0;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 720, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.1rem" }}>
          <div>
            <h2 style={{ fontWeight: 800, fontSize: "1.15rem", margin: 0, color: "#111827" }}>Record Material Excess</h2>
            <p style={{ fontSize: "0.78rem", color: "#9ca3af", margin: 0, marginTop: 2 }}>Document excess material quantity</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        {/* AI banner */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "0.75rem 0.9rem", marginBottom: "1.25rem" }}>
          <AlertTriangle style={{ width: 16, height: 16, color: "#dc2626", flexShrink: 0, marginTop: 2 }} />
          <p style={{ fontSize: "0.78rem", color: "#b91c1c", lineHeight: 1.5, margin: 0 }}>
            Help improve our AI demand predictions. Documenting your weekly material excess directly informs the forecasting engine and optimizes future production cycle.
          </p>
        </div>

        {/* Project Details */}
        <p style={{ fontSize: "0.65rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em", marginBottom: 8 }}>PROJECT DETAILS</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <div>
            <label style={labelStyle}>PROJECT *</label>
            <select value={projectId} onChange={e => setProjectId(+e.target.value)} style={inputStyle}>
              <option value={0} disabled>Select project…</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>PROJECT TYPE</label>
            <div style={{ ...inputStyle, background: "#f3f4f6", color: selectedProject ? "#111827" : "#9ca3af" }}>
              {selectedProject ? selectedProject.type : "—"}
            </div>
          </div>
        </div>
        {/* Material Details */}
        <p style={{ fontSize: "0.65rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em", marginBottom: 8 }}>MATERIAL DETAILS</p>

        {!projectId ? (
          <p style={{ fontSize: "0.8rem", color: "#9ca3af", padding: "0.75rem 0" }}>Select a project to see its Bill of Quantities materials.</p>
        ) : loadingPending ? (
          <p style={{ fontSize: "0.8rem", color: "#9ca3af", padding: "0.75rem 0" }}>Loading materials…</p>
        ) : noMaterialsLeft ? (
          <p style={{ fontSize: "0.8rem", color: "#9ca3af", padding: "0.75rem 0" }}>
            No materials left to log — every Bill of Quantities line for this project already has excess/waste recorded.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "0.5rem" }}>
              {rows.map((r, idx) => {
                const qtyNum = Number(r.qty) || 0;
                const actualUsage = r.boqItemId ? Math.max(0, r.estQty - qtyNum) : null;
                return (
                  <div key={idx} style={{ border: "1px solid #f3f4f6", borderRadius: 10, padding: "0.75rem" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 0.9fr 0.8fr 1.3fr auto", gap: 8, alignItems: "end" }}>
                      <div>
                        <label style={labelStyle}>MATERIAL (FROM BOQ)</label>
                        <select
                          value={r.boqItemId ?? 0}
                          onChange={e => pickBoqItem(idx, +e.target.value)}
                          style={inputStyle}
                        >
                          <option value={0} disabled>Select material…</option>
                          {optionsFor(idx).map(p => (
                            <option key={p.boqItemId} value={p.boqItemId}>
                              {p.materialName} (Est. {p.estimatedQuantity.toLocaleString()} {p.unit})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={labelStyle}>UNIT</label>
                        <div style={{ ...inputStyle, background: "#f3f4f6", color: r.unit ? "#111827" : "#9ca3af" }}>{r.unit || "—"}</div>
                      </div>
                      <div>
                        <label style={labelStyle}>QTY</label>
                        <input type="number" value={r.qty} onChange={e => updateRow(idx, { qty: e.target.value })}
                          placeholder="8" style={inputStyle} disabled={!r.boqItemId} />
                      </div>
                      <div>
                        <label style={labelStyle}>WASTE / EXCESS</label>
                        <div style={{ display: "flex", gap:4, background: "#e5e7eb", borderRadius: 8, padding: 3 }}>
                          {(["Waste", "Excess"] as const).map(k => (
                            <button key={k} type="button" onClick={() => updateRow(idx, { kind: k })}
                              style={{
                                flex: 1, padding: "6px 0", borderRadius: 6, border: "none", cursor: "pointer",
                                fontSize: "0.72rem", fontWeight: 600,
                                background: r.kind === k ? "#fff" : "transparent",
                                color: r.kind === k ? "#111827" : "#6b7280",
                                boxShadow: r.kind === k ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                              }}>{k}</button>
                          ))}
                        </div>
                      </div>
                      <button type="button" onClick={() => removeRow(idx)} disabled={rows.length === 1}
                        style={{ background: "none", border: "none", cursor: rows.length === 1 ? "default" : "pointer", color: rows.length === 1 ? "#e5e7eb" : "#dc2626", padding: 8 }}>
                        <Trash2 style={{ width: 15, height: 15 }} />
                      </button>
                    </div>
                    {r.boqItemId != null && (
                      <p style={{ fontSize: "0.7rem", color: "#6b7280", margin: "8px 2px 0" }}>
                        Est. Qty <strong>{r.estQty.toLocaleString()} {r.unit}</strong>
                        {" — "}
                        Actual Usage once saved: <strong style={{ color: "#15803d" }}>{actualUsage?.toLocaleString()} {r.unit}</strong>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {rows.length < pendingItems.length && (
              <button type="button" onClick={addRow}
                style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", color: "#16a34a", fontSize: "0.8rem", fontWeight: 600, padding: "6px 0", marginBottom: "1.25rem" }}>
                <Plus style={{ width: 14, height: 14 }} /> Add material
              </button>
            )}
          </>
        )}

        {/* Footer */}
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", borderTop: "1px solid #f3f4f6", paddingTop: "1.1rem" }}>
          <button onClick={onClose} disabled={submitting}
            style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={handleSaveEntry} disabled={submitting || noMaterialsLeft}
            style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Saving…" : "Save Entry"}
          </button>
        </div>
      </div>
    </div>
  );
}
