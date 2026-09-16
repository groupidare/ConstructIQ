"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { X, Recycle, Sparkles } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { useProcurement } from "@/hooks/useProcurement";
import type { RedistributionTargetSuggestion } from "@/types/procurement";

export interface RedistributeCandidate {
  id: number;
  materialName: string;
  quantity: number;
  unit: string;
  projectId: number;
  projectName: string;
}

interface RedistributeModalProps {
  record: RedistributeCandidate;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function RedistributeModal({ record, onClose, onSuccess }: RedistributeModalProps) {
  const { projects } = useProjects();
  const { suggestTargets, redistributeFromExcess } = useProcurement(0);

  const [suggestions, setSuggestions]           = useState<RedistributionTargetSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [targetProjectId, setTargetProjectId]   = useState(0);
  const [quantity, setQuantity]                 = useState(record.quantity);
  const [notes, setNotes]                       = useState("");
  const [submitting, setSubmitting]             = useState(false);

  useEffect(() => {
    let cancelled = false;
    suggestTargets(record.id)
      .then(data => {
        if (cancelled) return;
        setSuggestions(data);
        if (data.length > 0) setTargetProjectId(data[0].projectId);
      })
      .catch(() => toast.error("Couldn't load target suggestions — pick a project manually."))
      .finally(() => { if (!cancelled) setLoadingSuggestions(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id]);

  async function handleSubmit() {
    if (!targetProjectId) { toast.error("Select a target project."); return; }
    setSubmitting(true);
    try {
      await redistributeFromExcess({
        excessWasteRecordId: record.id,
        targetProjectId,
        quantity,
        notes: notes || undefined,
      });
      toast.success("Sent to the Redistribution dashboard.");
      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message ?? "Failed to create redistribution request.");
    } finally {
      setSubmitting(false);
    }
  }

  const otherProjects  = projects.filter(p => p.id !== record.projectId);
  const topSuggestions = suggestions.slice(0, 3);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Recycle style={{ width: 18, height: 18, color: "#f97316" }} />
            </div>
            <div>
              <h2 style={{ fontWeight: 800, fontSize: "1.05rem", margin: 0 }}>Redistribute {record.materialName}</h2>
              <p style={{ fontSize: "0.72rem", color: "#9ca3af", margin: 0 }}>
                {record.quantity.toLocaleString()} {record.unit} available at {record.projectName}
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        <p style={{ fontSize: "0.65rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
          <Sparkles style={{ width: 12, height: 12 }} /> RECOMMENDED PROJECTS
        </p>

        {loadingSuggestions ? (
          <p style={{ fontSize: "0.8rem", color: "#9ca3af", marginBottom: "1rem" }}>Checking forecasts and project needs…</p>
        ) : topSuggestions.length === 0 ? (
          <p style={{ fontSize: "0.8rem", color: "#9ca3af", marginBottom: "1rem" }}>No active projects to suggest — choose one manually below.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "1.25rem" }}>
            {topSuggestions.map(s => (
              <button
                key={s.projectId}
                type="button"
                onClick={() => setTargetProjectId(s.projectId)}
                style={{
                  textAlign: "left", padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                  border: targetProjectId === s.projectId ? "2px solid #f97316" : "1px solid #e5e7eb",
                  background: targetProjectId === s.projectId ? "#fff7ed" : "#fff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#111827" }}>{s.projectName}</span>
                  {s.hasForecastedShortage && (
                    <span style={{ fontSize: "0.62rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fee2e2", color: "#dc2626", whiteSpace: "nowrap" }}>FORECASTED SHORTAGE</span>
                  )}
                </div>
                <p style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: 2 }}>{s.matchReason}</p>
              </button>
            ))}
          </div>
        )}

        <div style={{ marginBottom: "0.9rem" }}>
          <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#374151", marginBottom: 5 }}>Or choose a different project</label>
          <select
            value={targetProjectId}
            onChange={e => setTargetProjectId(+e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: "0.85rem", outline: "none", color: "#111827" }}
          >
            <option value={0} disabled>Select a project…</option>
            {otherProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#374151", marginBottom: 5 }}>Quantity to transfer</label>
            <input
              type="number" step="0.01" max={record.quantity} value={quantity}
              onChange={e => setQuantity(+e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: "0.85rem", outline: "none", color: "#111827" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#374151", marginBottom: 5 }}>Notes <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span></label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: "0.85rem", outline: "none", color: "#111827", resize: "vertical" as const }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontWeight: 700, fontSize: "0.875rem", cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Sending…" : "Send to Redistribution"}
          </button>
        </div>
      </div>
    </div>
  );
}
