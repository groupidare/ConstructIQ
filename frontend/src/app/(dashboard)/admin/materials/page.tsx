"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Search, Wand2, Pencil, X } from "lucide-react";
import Header from "@/components/layout/Header";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

// Admin-only: the catalog's physical properties, which feed the engineering
// baseline (Material Plan's "Expected ≈" tooltip and alerts, and the AI
// forecast's reference quantity). See backend Algorithms/BaselineCalculator.

type CalculationType = "UnitArea" | "CoverageRate" | "Volume" | "Count" | "Length";

interface MaterialProperties {
  calculationType: CalculationType | null;
  lengthMm: number | null;
  widthMm: number | null;
  thicknessMm: number | null;
  piecesPerPackage: number | null;
  coveragePerUnit: number | null;
  coverageUnit: string | null;
  unitLengthM: number | null;
  coats: number | null;
  purchaseUnit: string | null;
  propertiesSource: string | null;
}

interface CatalogMaterial {
  id: number;
  name: string;
  specification: string;
  unit: string;
  categoryName: string;
  isActive: boolean;
  properties: MaterialProperties;
}

const TYPE_HELP: Record<CalculationType, string> = {
  UnitArea: "sq.m ÷ (length × width) ÷ pieces per package — CHB, tiles, boards",
  CoverageRate: "sq.m × coats ÷ coverage per unit — adhesive, grout, paint",
  Volume: "cu.m ÷ coverage per unit — cement, sand, gravel",
  Count: "pieces ÷ pieces per package — doors, windows",
  Length: "l.m ÷ unit length — rebar, studs",
};

const NUMBER_FIELDS: { key: keyof MaterialProperties; label: string; types: CalculationType[]; step?: string }[] = [
  { key: "lengthMm", label: "Length (mm)", types: ["UnitArea"] },
  { key: "widthMm", label: "Width (mm)", types: ["UnitArea"] },
  { key: "thicknessMm", label: "Thickness (mm)", types: ["UnitArea"] },
  { key: "piecesPerPackage", label: "Pieces per package", types: ["UnitArea", "Count"] },
  { key: "coveragePerUnit", label: "Coverage per unit", types: ["CoverageRate", "Volume"], step: "0.0001" },
  { key: "coats", label: "Coats", types: ["CoverageRate"], step: "1" },
  { key: "unitLengthM", label: "Unit length (m)", types: ["Length"], step: "0.001" },
];

const inp: React.CSSProperties = { width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: "0.82rem", outline: "none", background: "#fff" };
const lbl: React.CSSProperties = { display: "block", fontSize: "0.7rem", fontWeight: 600, color: "#6b7280", marginBottom: 3 };

function summary(p: MaterialProperties): string {
  switch (p.calculationType) {
    case "UnitArea": return `${p.lengthMm ?? "?"} × ${p.widthMm ?? "?"} mm${p.piecesPerPackage && p.piecesPerPackage > 1 ? `, ${p.piecesPerPackage}/pkg` : ""}`;
    case "CoverageRate": return `${p.coveragePerUnit ?? "?"} ${p.coverageUnit ?? "sq.m"}/unit${p.coats && p.coats > 1 ? `, ${p.coats} coats` : ""}`;
    case "Volume": return `${p.coveragePerUnit ?? "?"} ${p.coverageUnit ?? "cu.m"}/unit`;
    case "Count": return p.piecesPerPackage && p.piecesPerPackage > 1 ? `${p.piecesPerPackage}/pkg` : "1 per unit";
    case "Length": return `${p.unitLengthM ?? "?"} m/unit`;
    default: return "—";
  }
}

function EditModal({ material, onClose, onSaved }: { material: CatalogMaterial; onClose: () => void; onSaved: (m: CatalogMaterial) => void }) {
  const [p, setP] = useState<MaterialProperties>(material.properties);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<MaterialProperties>) => setP(prev => ({ ...prev, ...patch }));

  async function save() {
    setSaving(true);
    try {
      const { data } = await api.put<CatalogMaterial>(`/materials/${material.id}/properties`, p);
      onSaved(data);
      toast.success(`${material.name} updated.`);
      onClose();
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message ?? "Failed to save properties.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.5rem", width: 520, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
          <div>
            <p style={{ fontWeight: 800, fontSize: "1rem", color: "#111827" }}>{material.name}</p>
            <p style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Catalog unit: {material.unit}</p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        <label style={lbl}>Calculation type</label>
        <select value={p.calculationType ?? ""} onChange={e => set({ calculationType: (e.target.value || null) as CalculationType | null })} style={inp}>
          <option value="">None (no baseline)</option>
          {(Object.keys(TYPE_HELP) as CalculationType[]).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {p.calculationType && <p style={{ fontSize: "0.7rem", color: "#9ca3af", marginTop: 4 }}>{TYPE_HELP[p.calculationType]}</p>}

        {p.calculationType && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
            {NUMBER_FIELDS.filter(f => f.types.includes(p.calculationType!)).map(f => (
              <div key={f.key}>
                <label style={lbl}>{f.label}</label>
                <input
                  type="number" min="0" step={f.step ?? "0.01"}
                  value={(p[f.key] as number | null) ?? ""}
                  onChange={e => set({ [f.key]: e.target.value === "" ? null : Number(e.target.value) } as Partial<MaterialProperties>)}
                  style={inp}
                />
              </div>
            ))}
            {(p.calculationType === "CoverageRate" || p.calculationType === "Volume") && (
              <div>
                <label style={lbl}>Coverage unit</label>
                <select value={p.coverageUnit ?? ""} onChange={e => set({ coverageUnit: e.target.value || null })} style={inp}>
                  <option value="">—</option>
                  <option value="sq.m">sq.m</option>
                  <option value="cu.m">cu.m</option>
                  <option value="l.m">l.m</option>
                </select>
              </div>
            )}
            <div>
              <label style={lbl}>Purchase unit</label>
              <input value={p.purchaseUnit ?? ""} onChange={e => set({ purchaseUnit: e.target.value || null })} placeholder={material.unit} style={inp} />
            </div>
          </div>
        )}

        <label style={{ ...lbl, marginTop: 12 }}>Source</label>
        <input value={p.propertiesSource ?? ""} onChange={e => set({ propertiesSource: e.target.value || null })} placeholder="e.g. Manufacturer TDS 2025" style={inp} />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: "1.25rem" }}>
          <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontSize: "0.85rem", cursor: "pointer" }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontSize: "0.85rem", fontWeight: 700, cursor: "pointer", opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MaterialPropertiesPage() {
  const isAdmin = useAuthStore(s => s.user?.role) === "Admin";
  const [materials, setMaterials] = useState<CatalogMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [editing, setEditing] = useState<CatalogMaterial | null>(null);
  const [applying, setApplying] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<CatalogMaterial[]>("/materials");
      setMaterials(data);
    } catch {
      toast.error("Failed to load materials.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => materials.filter(m =>
    (!onlyMissing || !m.properties.calculationType)
    && (!query.trim() || m.name.toLowerCase().includes(query.trim().toLowerCase()))), [materials, query, onlyMissing]);
  const withProperties = materials.filter(m => m.properties.calculationType).length;

  async function applyDefaults() {
    setApplying(true);
    try {
      const { data } = await api.post<{ updated: number; materials: string[] }>("/materials/properties/apply-defaults");
      toast.success(data.updated > 0 ? `Filled typical properties for ${data.updated} material(s).` : "No more materials matched a typical default.");
      await load();
    } catch {
      toast.error("Failed to fill defaults.");
    } finally {
      setApplying(false);
    }
  }

  if (!isAdmin) {
    return (
      <div style={{ background: "#f5f4f0", minHeight: "100vh" }}>
        <Header title="Material Properties" />
        <p style={{ padding: "2rem", color: "#9ca3af" }}>Only administrators can edit material properties.</p>
      </div>
    );
  }

  return (
    <div style={{ background: "#f5f4f0", minHeight: "100vh" }}>
      {editing && <EditModal material={editing} onClose={() => setEditing(null)} onSaved={m => setMaterials(prev => prev.map(x => x.id === m.id ? m : x))} />}
      <Header title="Material Properties" />

      <div className="responsive-page" style={{ padding: "1.25rem 1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: "1.25rem" }}>
          <div>
            <p style={{ fontWeight: 800, fontSize: "1.4rem", color: "#111827" }}>Material Properties</p>
            <p style={{ fontSize: "0.78rem", color: "#9ca3af", marginTop: 2 }}>
              {loading ? "Loading…" : `${withProperties} of ${materials.length} materials have physical properties — used for the engineering baseline`}
            </p>
          </div>
          <button
            onClick={applyDefaults}
            disabled={applying}
            title="Fills typical properties for common materials (CHB, tiles, boards, adhesive, grout, paint, cement, sand, gravel, rebar, doors, windows) — only where none are set yet"
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 10, border: "none", background: "#f97316", color: "#fff", fontSize: "0.85rem", fontWeight: 700, cursor: "pointer", opacity: applying ? 0.7 : 1 }}
          >
            <Wand2 style={{ width: 15, height: 15 }} /> {applying ? "Filling…" : "Fill common defaults"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 360 }}>
            <Search style={{ position: "absolute", left: 10, top: 9, width: 14, height: 14, color: "#9ca3af" }} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search materials…" style={{ ...inp, paddingLeft: 30 }} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "#6b7280" }}>
            <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} /> Only missing properties
          </label>
        </div>

        <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.07)", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                {["Material", "Unit", "Type", "Properties", "Purchase unit", "Source", ""].map(h => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: "0.65rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em" }}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "#9ca3af" }}>Loading materials…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "#9ca3af" }}>No materials match.</td></tr>
              ) : visible.map(m => (
                <tr key={m.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "9px 12px", fontSize: "0.82rem", color: "#111827", fontWeight: 500 }}>{m.name}</td>
                  <td style={{ padding: "9px 12px", fontSize: "0.78rem", color: "#6b7280" }}>{m.unit}</td>
                  <td style={{ padding: "9px 12px", fontSize: "0.78rem", color: m.properties.calculationType ? "#111827" : "#d1d5db" }}>{m.properties.calculationType ?? "—"}</td>
                  <td style={{ padding: "9px 12px", fontSize: "0.78rem", color: "#374151" }}>{summary(m.properties)}</td>
                  <td style={{ padding: "9px 12px", fontSize: "0.78rem", color: "#6b7280" }}>{m.properties.calculationType ? (m.properties.purchaseUnit ?? m.unit) : "—"}</td>
                  <td style={{ padding: "9px 12px", fontSize: "0.72rem", color: "#9ca3af", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.properties.propertiesSource ?? ""}>{m.properties.propertiesSource ?? "—"}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right" }}>
                    <button onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}>
                      <Pencil style={{ width: 14, height: 14 }} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
