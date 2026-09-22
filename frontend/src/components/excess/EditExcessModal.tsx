"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { X } from "lucide-react";
import api from "@/lib/api";
import type { ExcessWasteRecord } from "@/types/excess";

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8,
  border: "1px solid #e5e7eb", background: "#f9fafb", fontSize: "0.82rem", outline: "none", color: "#111827",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.65rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.04em", marginBottom: 5,
};

interface EditExcessModalProps {
  record: ExcessWasteRecord;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function EditExcessModal({ record, onClose, onSuccess }: EditExcessModalProps) {
  const [description, setDescription] = useState(record.materialName);
  const [unit, setUnit]               = useState(record.unit);
  const [qty, setQty]                 = useState(String(record.quantity));
  const [kind, setKind]               = useState<"Waste" | "Excess">(record.isReusable ? "Excess" : "Waste");
  const [submitting, setSubmitting]   = useState(false);

  async function handleSave() {
    if (!description.trim() || !unit.trim() || !qty || Number(qty) <= 0) {
      toast.error("Fill in description, unit, and a quantity greater than 0.");
      return;
    }
    setSubmitting(true);
    try {
      await api.put(`/excess-waste/${record.id}`, {
        newMaterialName: description.trim(),
        unit: unit.trim(),
        excessType: kind === "Waste" ? "Damaged" : "Overordered",
        isReusable: kind === "Excess",
        quantity: Number(qty),
      });
      toast.success("Entry updated.");
      onSuccess?.();
      onClose();
    } catch {
      toast.error("Failed to update entry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 420, boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.1rem" }}>
          <div>
            <h2 style={{ fontWeight: 800, fontSize: "1.05rem", margin: 0, color: "#111827" }}>Edit Excess Entry</h2>
            <p style={{ fontSize: "0.75rem", color: "#9ca3af", margin: 0, marginTop: 2 }}>{record.projectName}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.25rem" }}>
          <div>
            <label style={labelStyle}>ITEM DESCRIPTION</label>
            <input value={description} onChange={e => setDescription(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={labelStyle}>UNIT</label>
              <input value={unit} onChange={e => setUnit(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>QTY</label>
              <input type="number" value={qty} onChange={e => setQty(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>WASTE / EXCESS</label>
            <div style={{ display: "flex", gap:4, background: "#e5e7eb", borderRadius: 8, padding: 3 }}>
              {(["Waste", "Excess"] as const).map(k => (
                <button key={k} type="button" onClick={() => setKind(k)}
                  style={{
                    flex: 1, padding: "8px 0", borderRadius: 6, border: "none", cursor: "pointer",
                    fontSize: "0.8rem", fontWeight: 600,
                    background: kind === k ? "#fff" : "transparent",
                    color: kind === k ? "#111827" : "#6b7280",
                    boxShadow: kind === k ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  }}>{k}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button onClick={onClose} disabled={submitting}
            style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={submitting}
            style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontWeight: 700, fontSize: "0.875rem", cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
