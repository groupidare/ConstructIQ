"use client";

import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { X, AlertTriangle, Plus, Trash2 } from "lucide-react";
import api from "@/lib/api";
import type { Project } from "@/types/project";

interface MaterialRow {
  description: string;
  unit: string;
  qty: string;
  kind: "Waste" | "Excess";
}

const EMPTY_ROW: MaterialRow = { description: "", unit: "", qty: "", kind: "Excess" };

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
  const [date, setDate]           = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows]           = useState<MaterialRow[]>([{ ...EMPTY_ROW }]);
  const [submitting, setSubmitting] = useState(false);

  const selectedProject = useMemo(() => projects.find(p => p.id === projectId) ?? null, [projects, projectId]);

  function updateRow(idx: number, patch: Partial<MaterialRow>) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function addRow() {
    setRows(prev => [...prev, { ...EMPTY_ROW }]);
  }

  function removeRow(idx: number) {
    setRows(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx));
  }

  function validate(): string | null {
    if (!projectId) return "Select a project.";
    for (const r of rows) {
      if (!r.description.trim()) return "Every material needs an item description.";
      if (!r.unit.trim()) return "Every material needs a unit.";
      if (!r.qty || Number(r.qty) <= 0) return "Every material needs a quantity greater than 0.";
    }
    return null;
  }

  async function submitRows() {
    await Promise.all(rows.map(r => api.post("/excess-waste", {
      projectId,
      newMaterialName: r.description.trim(),
      unit: r.unit.trim(),
      excessType: r.kind === "Waste" ? "Damaged" : "Overordered",
      isReusable: r.kind === "Excess",
      quantity: Number(r.qty),
      unitCost: 0,
    })));
  }

  async function handleSaveAndAddAnother() {
    const error = validate();
    if (error) { toast.error(error); return; }
    setSubmitting(true);
    try {
      await submitRows();
      toast.success("Entry saved.");
      onSuccess?.();
      setRows([{ ...EMPTY_ROW }]);
    } catch {
      toast.error("Failed to save entry.");
    } finally {
      setSubmitting(false);
    }
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

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 620, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>

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
        <div style={{ marginBottom: "1.25rem" }}>
          <label style={labelStyle}>DATE *</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inputStyle, maxWidth: 220 }} />
        </div>

        {/* Material Details */}
        <p style={{ fontSize: "0.65rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em", marginBottom: 8 }}>MATERIAL DETAILS</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "0.5rem" }}>
          {rows.map((r, idx) => (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 0.9fr 0.8fr 1.3fr auto", gap: 8, alignItems: "end" }}>
              <div>
                <label style={labelStyle}>ITEM DESCRIPTION</label>
                <input value={r.description} onChange={e => updateRow(idx, { description: e.target.value })}
                  placeholder="Portland Cement (40kg)" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>UNIT</label>
                <input value={r.unit} onChange={e => updateRow(idx, { unit: e.target.value })}
                  placeholder="bags" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>QTY</label>
                <input type="number" value={r.qty} onChange={e => updateRow(idx, { qty: e.target.value })}
                  placeholder="8" style={inputStyle} />
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
          ))}
        </div>
        <button type="button" onClick={addRow}
          style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", color: "#16a34a", fontSize: "0.8rem", fontWeight: 600, padding: "6px 0", marginBottom: "1.25rem" }}>
          <Plus style={{ width: 14, height: 14 }} /> Add material
        </button>

        {/* Footer */}
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", borderTop: "1px solid #f3f4f6", paddingTop: "1.1rem" }}>
          <button onClick={onClose} disabled={submitting}
            style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={handleSaveAndAddAnother} disabled={submitting}
            style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontWeight: 600, fontSize: "0.85rem", cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1 }}>
            Save &amp; Add Another
          </button>
          <button onClick={handleSaveEntry} disabled={submitting}
            style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Saving…" : "Save Entry"}
          </button>
        </div>
      </div>
    </div>
  );
}
