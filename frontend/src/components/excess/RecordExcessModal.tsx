"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { X, AlertTriangle, Search } from "lucide-react";
import api from "@/lib/api";
import type { Project } from "@/types/project";
import type { PendingBOQItem } from "@/types/excess";

// What the user marked a material as. "None" = nothing left over: no excess
// and no waste — saved through /excess-waste/confirm-none, not as a record.
type Kind = "Excess" | "Waste" | "None";
const KINDS: Kind[] = ["Excess", "Waste", "None"];

const KIND_STYLE: Record<Kind, { color: string; bg: string; hint: string }> = {
  Excess: { color: "#15803d", bg: "#dcfce7", hint: "Left over and still usable — can be redistributed to other projects" },
  Waste:  { color: "#b91c1c", bg: "#fee2e2", hint: "Damaged, expired or otherwise unusable" },
  None:   { color: "#1d4ed8", bg: "#dbeafe", hint: "No excess or waste — everything delivered was used. It won't be listed in later entries." },
};

// One BOQ line of the project. Lines marked None in an earlier entry are done
// and not listed; the rest stay listed every entry — excess and waste are
// logged weekly, so a line can take more of either later.
interface MaterialRow {
  boqItemId: number;
  materialId: number;
  name: string;
  unit: string;
  estQty: number;
  // Actual Usage is computed from these, the same way the save does:
  // delivered − already logged − this entry.
  delivered: number;
  alreadyLogged: number;
  excessLogged: number;
  wasteLogged: number;
  // An undecided redistribution request out of this project for the
  // material — no new excess/waste until it's settled.
  redistributionPending: boolean;
  kind: Kind | null;
  qty: string;
}

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8,
  border: "1px solid #e5e7eb", background: "#f9fafb", fontSize: "0.82rem", outline: "none", color: "#111827",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.65rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.04em", marginBottom: 5,
};
const headStyle: React.CSSProperties = {
  padding: "8px 10px", textAlign: "left", fontSize: "0.62rem", fontWeight: 700, color: "#9ca3af",
  letterSpacing: "0.04em", whiteSpace: "nowrap", background: "#f9fafb", position: "sticky", top: 0, zIndex: 1,
};

interface RecordExcessModalProps {
  projects: Project[];
  onClose: () => void;
  onSuccess?: () => void;
}

export default function RecordExcessModal({ projects, onClose, onSuccess }: RecordExcessModalProps) {
  const [projectId, setProjectId] = useState(0);
  const [rows, setRows]           = useState<MaterialRow[]>([]);
  const [search, setSearch]       = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingPending, setLoadingPending] = useState(false);
  // Projects with at least one BOQ line not yet marked None — any other is
  // a dead end here, so it's kept out of the picker entirely.
  const [pendingProjectIds, setPendingProjectIds] = useState<Set<number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<number[]>("/excess-waste/projects-with-boq-items")
      .then(({ data }) => { if (!cancelled) setPendingProjectIds(new Set(data)); })
      .catch(() => { if (!cancelled) setPendingProjectIds(new Set(projects.map(p => p.id))); }); // fail open
    return () => { cancelled = true; };
  }, [projects]);

  const selectableProjects = useMemo(
    () => pendingProjectIds === null ? projects : projects.filter(p => pendingProjectIds.has(p.id)),
    [projects, pendingProjectIds],
  );

  const selectedProject = useMemo(() => selectableProjects.find(p => p.id === projectId) ?? null, [selectableProjects, projectId]);

  // The project's BOQ lines not yet marked None, with what's been logged so far.
  useEffect(() => {
    setRows([]);
    setSearch("");
    if (!projectId) return;
    let cancelled = false;
    setLoadingPending(true);
    api.get<PendingBOQItem[]>(`/excess-waste/boq-items/${projectId}`)
      .then(({ data }) => {
        if (cancelled) return;
        setRows(data.map(item => ({
          boqItemId: item.boqItemId, materialId: item.materialId, name: item.materialName,
          unit: item.unit, estQty: item.estimatedQuantity,
          delivered: item.deliveredQuantity ?? item.estimatedQuantity,
          alreadyLogged: item.alreadyLogged ?? 0,
          excessLogged: item.excessLogged ?? 0,
          wasteLogged: item.wasteLogged ?? 0,
          redistributionPending: item.redistributionPending ?? false,
          kind: null, qty: "",
        })));
      })
      .catch(() => { if (!cancelled) toast.error("Failed to load this project's materials."); })
      .finally(() => { if (!cancelled) setLoadingPending(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  function updateRow(boqItemId: number, patch: Partial<MaterialRow>) {
    setRows(prev => prev.map(r => r.boqItemId === boqItemId ? { ...r, ...patch } : r));
  }

  // Clicking the selected kind again clears it — a row left unmarked is
  // simply not saved this time.
  function setKind(row: MaterialRow, kind: Kind) {
    updateRow(row.boqItemId, row.kind === kind ? { kind: null, qty: "" } : { kind, qty: kind === "None" ? "" : row.qty });
  }

  function markRestAsNone() {
    setRows(prev => prev.map(r => r.kind ? r : { ...r, kind: "None", qty: "" }));
  }

  // What's still unaccounted for on a line: delivered minus everything
  // logged as excess/waste so far — the most a new entry can log.
  const remainingOf = (r: MaterialRow) => Math.max(0, r.delivered - r.alreadyLogged);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter(r => r.name.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const marked = rows.filter(r => r.kind);
  const counts = { Excess: 0, Waste: 0, None: 0 } as Record<Kind, number>;
  marked.forEach(r => { counts[r.kind!]++; });

  function validate(): string | null {
    if (!projectId) return "Select a project.";
    if (marked.length === 0) return "Mark at least one material as Excess, Waste or None.";
    const missingQty = marked.find(r => r.kind !== "None" && !(Number(r.qty) > 0));
    if (missingQty) return `Enter a quantity greater than 0 for ${missingQty.name}.`;
    const tooMuch = marked.find(r => r.kind !== "None" && Number(r.qty) > remainingOf(r));
    if (tooMuch) return `${tooMuch.name}: only ${remainingOf(tooMuch).toLocaleString()} ${tooMuch.unit} is left to log after what's already been recorded.`;
    return null;
  }

  async function submitRows() {
    const logged = marked.filter(r => r.kind === "Excess" || r.kind === "Waste");
    const none = marked.filter(r => r.kind === "None");
    await Promise.all(logged.map(r => api.post("/excess-waste", {
      projectId,
      boqItemId: r.boqItemId,
      materialId: r.materialId,
      unit: r.unit,
      excessType: r.kind === "Waste" ? "Damaged" : "Overordered",
      isReusable: r.kind === "Excess",
      quantity: Number(r.qty),
      unitCost: 0,
    })));
    if (none.length) {
      await api.post("/excess-waste/confirm-none", { projectId, boqItemIds: none.map(r => r.boqItemId) });
    }
  }

  async function handleSaveEntry() {
    const error = validate();
    if (error) { toast.error(error); return; }
    setSubmitting(true);
    try {
      await submitRows();
      toast.success(`Saved ${marked.length} material${marked.length === 1 ? "" : "s"}.`);
      onSuccess?.();
      onClose();
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message ?? "Failed to save entry.");
    } finally {
      setSubmitting(false);
    }
  }

  const noMaterialsLeft = projectId > 0 && !loadingPending && rows.length === 0;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 900, maxWidth: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>

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
            <select
              value={projectId}
              onChange={e => setProjectId(+e.target.value)}
              style={inputStyle}
            >
              <option value={0} disabled>Select a project…</option>
              {selectableProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
          <p style={{ fontSize: "0.65rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em", margin: 0 }}>MATERIAL DETAILS</p>
          {rows.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {rows.length > 6 && (
                <div style={{ position: "relative" }}>
                  <Search style={{ width: 12, height: 12, color: "#9ca3af", position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)" }} />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search material"
                    style={{ ...inputStyle, width: 180, padding: "5px 8px 5px 25px", fontSize: "0.75rem" }} />
                </div>
              )}
              <button type="button" onClick={markRestAsNone} disabled={marked.length === rows.length}
                title="Mark every material you haven't marked yet as None (no excess or waste)"
                style={{ background: "none", border: "none", padding: 0, fontSize: "0.72rem", fontWeight: 600, whiteSpace: "nowrap",
                  color: marked.length === rows.length ? "#d1d5db" : "#1d4ed8", cursor: marked.length === rows.length ? "default" : "pointer" }}>
                Mark unmarked as None
              </button>
            </div>
          )}
        </div>

        {!projectId ? (
          <p style={{ fontSize: "0.8rem", color: "#9ca3af", padding: "0.75rem 0" }}>Select a project to see its Bill of Quantities materials.</p>
        ) : loadingPending ? (
          <p style={{ fontSize: "0.8rem", color: "#9ca3af", padding: "0.75rem 0" }}>Loading materials…</p>
        ) : noMaterialsLeft ? (
          <p style={{ fontSize: "0.8rem", color: "#9ca3af", padding: "0.75rem 0" }}>
            No materials left to log — this project&apos;s Bill of Quantities materials are all marked None.
          </p>
        ) : (
          <>
            <div style={{ border: "1px solid #f3f4f6", borderRadius: 10, overflow: "auto", flex: 1, minHeight: 0, maxHeight: 380 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["MATERIAL (FROM BOQ)", "UNIT", "DELIVERED / EST.", "EXCESS / WASTE / NONE", "QTY", "ACTUAL USAGE"].map(h => (
                      <th key={h} style={headStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: "1rem", fontSize: "0.78rem", color: "#9ca3af" }}>No materials match “{search}”.</td></tr>
                  ) : visibleRows.map(r => {
                    const qtyNum = Number(r.qty) || 0;
                    const remaining = remainingOf(r);
                    const actualUsage = r.kind === "None" ? remaining : r.kind ? Math.max(0, remaining - qtyNum) : null;
                    const needsQty = r.kind === "Excess" || r.kind === "Waste";
                    return (
                      <tr key={r.boqItemId} style={{ borderTop: "1px solid #f3f4f6", background: r.kind ? "#fff" : "#fcfcfd" }}>
                        <td style={{ padding: "8px 10px", fontSize: "0.8rem", fontWeight: 600, color: "#111827", minWidth: 200 }}>{r.name}</td>
                        <td style={{ padding: "8px 10px", fontSize: "0.78rem", color: "#6b7280", whiteSpace: "nowrap" }}>{r.unit || "—"}</td>
                        <td style={{ padding: "8px 10px", fontSize: "0.78rem", color: "#6b7280", whiteSpace: "nowrap" }}>
                          {r.delivered.toLocaleString()}
                          {r.alreadyLogged > 0 && (
                            <span title={`Logged in earlier entries: ${r.excessLogged.toLocaleString()} excess + ${r.wasteLogged.toLocaleString()} waste — Actual Usage starts from ${remaining.toLocaleString()} ${r.unit}`}
                              style={{ display: "block", fontSize: "0.65rem", color: "#b45309", marginTop: 2 }}>
                              −{r.alreadyLogged.toLocaleString()} logged
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <div role="radiogroup" aria-label={`Excess, waste or none for ${r.name}`}
                            style={{ display: "flex", gap: 3, background: "#f3f4f6", borderRadius: 8, padding: 3, minWidth: 200 }}>
                            {KINDS.map(k => {
                              const allowed = k === "None" || (remaining > 0 && !r.redistributionPending);
                              const active = r.kind === k;
                              return (
                                <button key={k} type="button" role="radio" aria-checked={active} disabled={!allowed}
                                  onClick={() => setKind(r, k)}
                                  title={allowed ? KIND_STYLE[k].hint
                                    : r.redistributionPending ? "A redistribution request for this material is still waiting for a decision"
                                    : "Everything delivered is already logged as excess or waste"}
                                  style={{
                                    flex: 1, padding: "5px 0", borderRadius: 6, border: "none",
                                    cursor: allowed ? "pointer" : "not-allowed", fontSize: "0.7rem", fontWeight: 600,
                                    background: active ? KIND_STYLE[k].bg : "transparent",
                                    color: !allowed ? "#d1d5db" : active ? KIND_STYLE[k].color : "#6b7280",
                                    boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                                  }}>{k}</button>
                              );
                            })}
                          </div>
                        </td>
                        <td style={{ padding: "8px 10px", width: 100 }}>
                          <input type="number" min="0" value={needsQty ? r.qty : ""}
                            onChange={e => updateRow(r.boqItemId, { qty: e.target.value })}
                            placeholder={needsQty ? "0" : "—"} disabled={!needsQty}
                            aria-label={`Quantity for ${r.name}`}
                            style={{ ...inputStyle, padding: "6px 8px", background: needsQty ? "#fff" : "#f3f4f6" }} />
                        </td>
                        <td style={{ padding: "8px 10px", fontSize: "0.78rem", whiteSpace: "nowrap", color: actualUsage == null ? "#d1d5db" : "#15803d", fontWeight: 600 }}>
                          {actualUsage == null ? "—" : `${actualUsage.toLocaleString()} ${r.unit}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: "0.7rem", color: "#9ca3af", margin: "8px 2px 1.1rem", lineHeight: 1.5 }}>
              <strong style={{ color: KIND_STYLE.Excess.color }}>Excess</strong> — usable leftover ·{" "}
              <strong style={{ color: KIND_STYLE.Waste.color }}>Waste</strong> — unusable ·{" "}
              <strong style={{ color: KIND_STYLE.None.color }}>None</strong> — no excess or waste, everything was used; it won&apos;t be listed again.
              {" "}Unmarked materials and those with excess/waste stay listed for your next entry.
            </p>
          </>
        )}

        {/* Footer */}
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", justifyContent: "flex-end", borderTop: "1px solid #f3f4f6", paddingTop: "1.1rem" }}>
          {rows.length > 0 && (
            <span style={{ fontSize: "0.72rem", color: "#6b7280", marginRight: "auto" }}>
              {marked.length} of {rows.length} marked
              {marked.length > 0 && ` · ${counts.Excess} excess · ${counts.Waste} waste · ${counts.None} none`}
            </span>
          )}
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
