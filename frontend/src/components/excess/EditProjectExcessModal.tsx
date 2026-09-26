"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { X, Plus, Trash2 } from "lucide-react";
import api from "@/lib/api";
import type { ExcessWasteRecord, PendingBOQItem } from "@/types/excess";

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8,
  border: "1px solid #e5e7eb", background: "#f9fafb", fontSize: "0.82rem", outline: "none", color: "#111827",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.65rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.04em", marginBottom: 5,
};

interface ExistingRow {
  id: number;
  description: string;
  unit: string;
  qty: string;
  kind: "Waste" | "Excess";
}

interface NewRow {
  boqItemId: number | null;
  materialId: number | null;
  description: string;
  unit: string;
  estQty: number;
  qty: string;
  kind: "Waste" | "Excess";
}

const EMPTY_NEW_ROW: NewRow = { boqItemId: null, materialId: null, description: "", unit: "", estQty: 0, qty: "", kind: "Excess" };

interface EditProjectExcessModalProps {
  projectId: number;
  projectName: string;
  records: ExcessWasteRecord[];
  onClose: () => void;
  onSuccess?: () => void;
}

// Edits every recorded excess/waste entry for one project in a single form —
// the per-material Edit button only ever touches one row at a time, but the
// user also wants to adjust a whole project's log (e.g. a batch saved as
// draft), and to add materials they hadn't logged yet, without opening the
// separate "Record Material Excess" flow.
export default function EditProjectExcessModal({ projectId, projectName, records, onClose, onSuccess }: EditProjectExcessModalProps) {
  const [rows, setRows] = useState<ExistingRow[]>(
    records.map(r => ({
      id: r.id,
      description: r.materialName,
      unit: r.unit,
      qty: String(r.quantity),
      kind: r.isReusable ? "Excess" : "Waste",
    }))
  );
  const [newRows, setNewRows] = useState<NewRow[]>([]);
  const [pendingItems, setPendingItems] = useState<PendingBOQItem[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Same "remaining materials list" source as Record Material Excess — BOQ
  // lines for this project with no excess/waste logged against them yet.
  useEffect(() => {
    let cancelled = false;
    setLoadingPending(true);
    api.get<PendingBOQItem[]>(`/excess-waste/pending-boq-items/${projectId}`)
      .then(({ data }) => { if (!cancelled) setPendingItems(data); })
      .catch(() => { if (!cancelled) setPendingItems([]); })
      .finally(() => { if (!cancelled) setLoadingPending(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  function updateRow(idx: number, patch: Partial<ExistingRow>) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function updateNewRow(idx: number, patch: Partial<NewRow>) {
    setNewRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function addMaterial() {
    setNewRows(prev => [...prev, { ...EMPTY_NEW_ROW }]);
  }

  function removeNewRow(idx: number) {
    setNewRows(prev => prev.filter((_, i) => i !== idx));
  }

  function pickBoqItem(idx: number, boqItemId: number) {
    const item = pendingItems.find(p => p.boqItemId === boqItemId);
    if (!item) return;
    updateNewRow(idx, {
      boqItemId: item.boqItemId,
      materialId: item.materialId,
      description: item.materialName,
      unit: item.unit,
      estQty: item.estimatedQuantity,
    });
  }

  // Options for one new-material row: every pending item, minus whichever
  // ones other new rows in this same form have already claimed.
  function optionsFor(idx: number): PendingBOQItem[] {
    const claimedElsewhere = new Set(
      newRows.filter((_, i) => i !== idx).map(r => r.boqItemId).filter((id): id is number => id !== null)
    );
    return pendingItems.filter(p => !claimedElsewhere.has(p.boqItemId));
  }

  const noMaterialsLeft = !loadingPending && pendingItems.length === 0;

  function validate(): string | null {
    for (const r of rows) {
      if (!r.description.trim() || !r.unit.trim()) return "Every entry needs a material description and unit.";
      if (!r.qty || Number(r.qty) <= 0) return "Every entry needs a quantity greater than 0.";
    }
    for (const r of newRows) {
      if (!r.boqItemId) return "Select a material from the Bill of Quantities for every added row.";
      if (!r.qty || Number(r.qty) <= 0) return "Every added material needs a quantity greater than 0.";
    }
    return null;
  }

  async function handleSave() {
    const error = validate();
    if (error) { toast.error(error); return; }
    setSubmitting(true);
    try {
      await Promise.all([
        ...rows.map(r => api.put(`/excess-waste/${r.id}`, {
          newMaterialName: r.description.trim(),
          unit: r.unit.trim(),
          excessType: r.kind === "Waste" ? "Damaged" : "Overordered",
          isReusable: r.kind === "Excess",
          quantity: Number(r.qty),
        })),
        ...newRows.map(r => api.post("/excess-waste", {
          projectId,
          boqItemId: r.boqItemId,
          materialId: r.materialId,
          unit: r.unit,
          excessType: r.kind === "Waste" ? "Damaged" : "Overordered",
          isReusable: r.kind === "Excess",
          quantity: Number(r.qty),
          unitCost: 0,
        })),
      ]);
      toast.success("Excess log updated.");
      onSuccess?.();
      onClose();
    } catch {
      toast.error("Failed to save changes.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 720, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.1rem" }}>
          <div>
            <h2 style={{ fontWeight: 800, fontSize: "1.05rem", margin: 0, color: "#111827" }}>Edit Excess Log</h2>
            <p style={{ fontSize: "0.75rem", color: "#9ca3af", margin: 0, marginTop: 2 }}>{projectName} — {rows.length} entr{rows.length === 1 ? "y" : "ies"}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        {rows.length === 0 ? (
          <p style={{ fontSize: "0.8rem", color: "#9ca3af", padding: "0.75rem 0" }}>No entries recorded for this project yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
            {rows.map((r, idx) => (
              <div key={r.id} style={{ border: "1px solid #f3f4f6", borderRadius: 10, padding: "0.75rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 0.9fr 0.8fr 1.3fr", gap: 8, alignItems: "end" }}>
                  <div>
                    <label style={labelStyle}>ITEM DESCRIPTION</label>
                    <input value={r.description} onChange={e => updateRow(idx, { description: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>UNIT</label>
                    <input value={r.unit} onChange={e => updateRow(idx, { unit: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>QTY</label>
                    <input type="number" value={r.qty} onChange={e => updateRow(idx, { qty: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>WASTE / EXCESS</label>
                    <div style={{ display: "flex", gap: 4, background: "#e5e7eb", borderRadius: 8, padding: 3 }}>
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
                </div>
              </div>
            ))}
          </div>
        )}

        {/* New materials — same "remaining BOQ materials" picker as Record Material Excess */}
        {newRows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "0.5rem" }}>
            {newRows.map((r, idx) => {
              const qtyNum = Number(r.qty) || 0;
              const actualUsage = r.boqItemId ? Math.max(0, r.estQty - qtyNum) : null;
              return (
                <div key={idx} style={{ border: "1px solid #dcfce7", background: "#f0fdf4", borderRadius: 10, padding: "0.75rem" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 0.9fr 0.8fr 1.3fr auto", gap: 8, alignItems: "end" }}>
                    <div>
                      <label style={labelStyle}>MATERIAL (FROM BOQ)</label>
                      <select value={r.boqItemId ?? 0} onChange={e => pickBoqItem(idx, +e.target.value)} style={inputStyle}>
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
                      <input type="number" value={r.qty} onChange={e => updateNewRow(idx, { qty: e.target.value })}
                        placeholder="8" style={inputStyle} disabled={!r.boqItemId} />
                    </div>
                    <div>
                      <label style={labelStyle}>WASTE / EXCESS</label>
                      <div style={{ display: "flex", gap: 4, background: "#e5e7eb", borderRadius: 8, padding: 3 }}>
                        {(["Waste", "Excess"] as const).map(k => (
                          <button key={k} type="button" onClick={() => updateNewRow(idx, { kind: k })}
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
                    <button type="button" onClick={() => removeNewRow(idx)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", padding: 8 }}>
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
        )}

        {!noMaterialsLeft && (
          <button type="button" onClick={addMaterial} disabled={newRows.length >= pendingItems.length}
            style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: newRows.length >= pendingItems.length ? "default" : "pointer", color: newRows.length >= pendingItems.length ? "#d1d5db" : "#16a34a", fontSize: "0.8rem", fontWeight: 600, padding: "6px 0", marginBottom: "1.25rem" }}>
            <Plus style={{ width: 14, height: 14 }} /> Add material
          </button>
        )}

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", borderTop: "1px solid #f3f4f6", paddingTop: "1.1rem" }}>
          <button onClick={onClose} disabled={submitting}
            style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={submitting || (rows.length === 0 && newRows.length === 0)}
            style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
