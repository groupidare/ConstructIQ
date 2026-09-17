"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Header from "@/components/layout/Header";
import {
  Clock, CheckCircle2, PackageCheck, AlertTriangle, Truck,
  ShoppingCart, Download, Plus, Eye,
  Send, History, X, Mail, Phone, Pencil, Camera, Upload, Check,
  Wind, Droplets, CloudRain,
} from "lucide-react";
import { useWeatherStore } from "@/store/weatherStore";
import { useAlertStore } from "@/store/alertStore";
import { useAuthStore } from "@/store/authStore";
import { RISK_VISUALS, RISK_VISUALS_DARK } from "@/lib/weather";
import { computeWeatherAtRiskOrders } from "@/lib/deliveryRisk";
import api from "@/lib/api";

interface ProjectListDto {
  id: number;
  name: string;
  status: string;
}

// Formats an ISO date string as a short calendar date (e.g. "Sep 18").
function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Formats an ISO/date-input value as "Sep 28, 2026" — the display format used
// throughout the PO table.
function toDisplayDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Types & data ──────────────────────────────────────────────────────────────

type POStatus = "PENDING" | "APPROVED" | "DELIVERED" | "DELAYED";

interface POMaterial {
  name: string;
  qty: string;
}

interface PO {
  id: number;
  number: string;
  projectId: number;
  projectName: string;
  supplierId: number;
  supplier: string;
  status: POStatus;
  expectedDate: string;
  materials: POMaterial[];
}

// DELAYED is never manually selectable — it's derived from the expected date
// having passed while the order is still PENDING/APPROVED.
const PO_STATUSES: POStatus[] = ["PENDING", "APPROVED", "DELIVERED"];

const PO_STATUS_STYLE: Record<POStatus, { bg: string; color: string }> = {
  PENDING:   { bg: "#fef3c7", color: "#b45309"  },
  APPROVED:  { bg: "#dcfce7", color: "#15803d"  },
  DELIVERED: { bg: "#f3f4f6", color: "#374151"  },
  DELAYED:   { bg: "#fee2e2", color: "#dc2626"  },
};

const STATUS_SORT_ORDER: Record<POStatus, number> = { DELAYED: 0, PENDING: 1, APPROVED: 2, DELIVERED: 3 };

// A non-delivered order becomes DELAYED the moment its expected date passes —
// this is computed, never stored, so it can't drift out of sync or be set by hand.
function getEffectiveStatus(po: PO): POStatus {
  if (po.status === "DELIVERED") return "DELIVERED";
  const expected = new Date(po.expectedDate).getTime();
  if (!Number.isNaN(expected) && expected < Date.now()) return "DELAYED";
  return po.status;
}

// The backend's PurchaseOrderStatus enum serializes as "Pending"/"Approved"/
// "Delivered" — the frontend works in ALL-CAPS everywhere else, so these two
// helpers are the only place that conversion happens.
function apiStatusToFrontend(s: string): POStatus {
  return s.toUpperCase() as POStatus;
}
function frontendStatusToApi(s: POStatus): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

type SupplierBadge = "PREFERRED" | "ACTIVE";

interface CategoryRatings {
  price: number;
  delivery: number;
  quality: number;
  accuracy: number;
  responsiveness: number;
}

const RATING_CATEGORIES: { key: keyof CategoryRatings; label: string; short: string }[] = [
  { key: "price",          label: "Price Competitiveness", short: "Price" },
  { key: "delivery",       label: "Delivery Timeliness",   short: "Delivery" },
  { key: "quality",        label: "Material Quality",      short: "Quality" },
  { key: "accuracy",       label: "Order Accuracy",        short: "Accuracy" },
  { key: "responsiveness", label: "Responsiveness",        short: "Response" },
];

function categoryAverage(ratings: CategoryRatings): number {
  return (ratings.price + ratings.delivery + ratings.quality + ratings.accuracy + ratings.responsiveness) / 5;
}

// Display-only shape, hydrated from the backend's DeliveryEvaluationDto.
interface DeliveryEvaluation {
  photoUrls: string[];
  ratings: CategoryRatings;
  onTime: boolean;
  actualLeadDays: number;
  comments: string;
  raterName: string;
}

// What the delivery-confirmation modal hands back up — real File objects for
// upload, not URLs. The backend derives the rater from the auth token, so no
// name is sent from the client.
interface DeliverySubmission {
  photoFiles: File[];
  ratings: CategoryRatings;
  onTime: boolean;
  actualLeadDays: number;
  comments: string;
}

interface SupplierHistoryEntry {
  poNumber: string;
  projectName: string;
  date: string;
  status: POStatus;
  evaluation?: DeliveryEvaluation;
}

interface SupplierContact {
  email: string;
  phone: string;
}

interface Supplier {
  id: number;
  initials: string;
  name: string;
  category: string;
  lead: string;
  rating: number;
  deliveries: number;
  onTimePct: number;
  avatarBg: string;
  contact: SupplierContact;
  history: SupplierHistoryEntry[];
}

function initialsFor(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
}

// Preference tier is derived from performance, not hand-set — it stays honest
// as new suppliers get auto-added with no track record yet.
function getSupplierBadge(s: Supplier): SupplierBadge {
  if (s.deliveries > 0 && s.rating >= 4.5 && s.onTimePct >= 90) return "PREFERRED";
  return "ACTIVE";
}

const BADGE_STYLE: Record<SupplierBadge, { bg: string; color: string }> = {
  PREFERRED: { bg: "#dcfce7", color: "#15803d" },
  ACTIVE:    { bg: "#dbeafe", color: "#1d4ed8" },
};

// Same ranking used by the Supplier Performance section — most preferred first.
function sortSuppliersByPreference(suppliers: Supplier[]): Supplier[] {
  return [...suppliers].sort((a, b) => b.rating - a.rating || b.onTimePct - a.onTimePct);
}

// ── API response shapes + mappers ────────────────────────────────────────────

interface ApiPOMaterial { name: string; quantity: number; unit: string; }
interface ApiPO {
  id: number; number: string;
  projectId: number; projectName: string;
  supplierId: number; supplierName: string;
  status: string; expectedDate: string;
  materials: ApiPOMaterial[];
}
interface ApiEvaluation {
  priceRating: number; deliveryRating: number; qualityRating: number;
  accuracyRating: number; responsivenessRating: number;
  onTime: boolean; actualLeadDays: number; comments: string | null;
  raterName: string; photoUrls: string[];
}
interface ApiHistoryEntry {
  poNumber: string; projectName: string; status: string; expectedDate: string;
  evaluation: ApiEvaluation | null;
}
interface ApiSupplier {
  id: number; name: string; category: string; lead: string;
  contactEmail: string | null; contactPhone: string | null;
  rating: number; onTimePct: number; deliveries: number;
  history: ApiHistoryEntry[];
}

function mapPO(a: ApiPO): PO {
  return {
    id: a.id, number: a.number,
    projectId: a.projectId, projectName: a.projectName,
    supplierId: a.supplierId, supplier: a.supplierName,
    status: apiStatusToFrontend(a.status),
    expectedDate: toDisplayDate(a.expectedDate),
    materials: a.materials.map(m => ({ name: m.name, qty: `${Number(m.quantity)} ${m.unit}` })),
  };
}

function mapEvaluation(e: ApiEvaluation): DeliveryEvaluation {
  return {
    photoUrls: e.photoUrls,
    ratings: {
      price: e.priceRating, delivery: e.deliveryRating, quality: e.qualityRating,
      accuracy: e.accuracyRating, responsiveness: e.responsivenessRating,
    },
    onTime: e.onTime,
    actualLeadDays: e.actualLeadDays,
    comments: e.comments ?? "",
    raterName: e.raterName,
  };
}

function mapSupplier(a: ApiSupplier): Supplier {
  return {
    id: a.id, initials: initialsFor(a.name), name: a.name, category: a.category, lead: a.lead,
    rating: a.rating, onTimePct: a.onTimePct, deliveries: a.deliveries, avatarBg: "#1e3154",
    contact: { email: a.contactEmail ?? "", phone: a.contactPhone ?? "" },
    history: a.history.map(h => ({
      poNumber: h.poNumber, projectName: h.projectName, date: toDisplayDate(h.expectedDate),
      status: apiStatusToFrontend(h.status),
      evaluation: h.evaluation ? mapEvaluation(h.evaluation) : undefined,
    })),
  };
}

// ── Export CSV ────────────────────────────────────────────────────────────────

function exportPOs(orders: PO[]) {
  const header = ["PO Number","Project Name","Supplier","Status","Expected Date","Materials"];
  const rows = orders.map(p => [p.number, `"${p.projectName}"`, `"${p.supplier}"`, getEffectiveStatus(p), p.expectedDate, `"${p.materials.map(m => `${m.name} (${m.qty})`).join("; ")}"`].join(","));
  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "purchase-orders.csv"; a.click();
  URL.revokeObjectURL(url);
  toast.success("Purchase orders exported");
}

// ── New PO Modal ──────────────────────────────────────────────────────────────

const MATERIAL_UNITS = ["bags", "pcs", "m³", "m", "rolls", "sheets"];

interface MaterialRow { name: string; qty: string; unit: string; }

interface NewPOInput {
  projectId: number;
  supplierName: string;
  expectedDate: string;
  materials: { name: string; quantity: number; unit: string }[];
}

function NewPOModal({ onClose, onAdd, supplierNames }: {
  onClose: () => void;
  onAdd: (input: NewPOInput) => Promise<void>;
  supplierNames: string[];
}) {
  const [projectOptions, setProjectOptions] = useState<{ id: number; name: string }[]>([]);
  const [projectId,      setProjectId]      = useState<number | null>(null);
  const [supplier,       setSupplier]       = useState(supplierNames[0] ?? "");
  const [materials,      setMaterials]      = useState<MaterialRow[]>([{ name: "", qty: "", unit: "bags" }]);
  const [expectedDate,   setExpectedDate]   = useState("");
  const [notes,          setNotes]          = useState("");
  const [saving,         setSaving]         = useState(false);

  useEffect(() => {
    api.get<ProjectListDto[]>("/projects")
      .then(({ data }) => {
        const active = data.filter(p => p.status === "Active").map(p => ({ id: p.id, name: p.name }));
        setProjectOptions(active);
        setProjectId(prev => prev ?? active[0]?.id ?? null);
      })
      .catch(() => setProjectOptions([]));
  }, []);

  function updateMaterial(i: number, field: keyof MaterialRow, value: string) {
    setMaterials(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: value } : m));
  }
  function addMaterialRow() {
    setMaterials(prev => [...prev, { name: "", qty: "", unit: "bags" }]);
  }
  function removeMaterialRow(i: number) {
    setMaterials(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);
  }

  async function handleSubmit() {
    const validMaterials = materials.filter(m => m.name.trim() && m.qty.trim());
    if (!projectId || !supplier.trim() || validMaterials.length === 0 || !expectedDate) {
      toast.error("Please fill in all required fields"); return;
    }
    setSaving(true);
    try {
      await onAdd({
        projectId, supplierName: supplier.trim(), expectedDate,
        materials: validMaterials.map(m => ({ name: m.name.trim(), quantity: Number(m.qty), unit: m.unit })),
      });
      onClose();
    } catch {
      // onAdd already surfaced an error toast — keep the modal open to retry.
    } finally {
      setSaving(false);
    }
  }

  const fieldStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 7,
    border: "1px solid #e5e7eb", fontSize: "0.85rem", outline: "none", color: "#111827",
  };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 4 };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 520, boxShadow: "0 24px 60px rgba(0,0,0,0.2)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ShoppingCart style={{ width: 18, height: 18, color: "#f97316" }} />
            </div>
            <div>
              <h2 style={{ fontWeight: 800, fontSize: "1.05rem", margin: 0 }}>New Purchase Order</h2>
              <p style={{ fontSize: "0.72rem", color: "#9ca3af", margin: 0 }}>Fill in the details below</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Project Name — pulled from active projects */}
          <div>
            <label style={labelStyle}>Project Name <span style={{ color: "#dc2626" }}>*</span></label>
            <select value={projectId ?? ""} onChange={e => setProjectId(Number(e.target.value))}
              style={{ ...fieldStyle, appearance: "none" as const, cursor: "pointer" }}>
              {projectOptions.length === 0
                ? <option value="">No active projects</option>
                : projectOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* Supplier — ranked by Supplier Performance, but free text still works */}
          <div>
            <label style={labelStyle}>Supplier <span style={{ color: "#dc2626" }}>*</span></label>
            <input list="supplier-options" value={supplier} onChange={e => setSupplier(e.target.value)}
              placeholder="Pick an existing supplier or type a new one"
              style={fieldStyle}
              onFocus={e => (e.currentTarget.style.borderColor = "#f97316")}
              onBlur={e  => (e.currentTarget.style.borderColor = "#e5e7eb")}
            />
            <datalist id="supplier-options">
              {supplierNames.map(s => <option key={s} value={s} />)}
            </datalist>
            <p style={{ fontSize: "0.68rem", color: "#9ca3af", marginTop: 4 }}>Ranked from most to least preferred. A new name will be added to Suppliers automatically.</p>
          </div>

          {/* Materials — one or more line items */}
          <div>
            <label style={labelStyle}>Materials <span style={{ color: "#dc2626" }}>*</span></label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {materials.map((m, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 6, alignItems: "center" }}>
                  <input value={m.name} onChange={e => updateMaterial(i, "name", e.target.value)} placeholder="e.g. Portland Cement" style={fieldStyle} />
                  <input type="number" value={m.qty} onChange={e => updateMaterial(i, "qty", e.target.value)} placeholder="Qty" style={fieldStyle} />
                  <select value={m.unit} onChange={e => updateMaterial(i, "unit", e.target.value)} style={{ ...fieldStyle, appearance: "none" as const, cursor: "pointer" }}>
                    {MATERIAL_UNITS.map(u => <option key={u}>{u}</option>)}
                  </select>
                  <button type="button" onClick={() => removeMaterialRow(i)} disabled={materials.length === 1}
                    style={{ background: "none", border: "none", cursor: materials.length === 1 ? "not-allowed" : "pointer", color: materials.length === 1 ? "#d1d5db" : "#dc2626", padding: 4 }}>
                    <X style={{ width: 14, height: 14 }} />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addMaterialRow}
              style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 5, fontSize: "0.75rem", fontWeight: 600, color: "#f97316", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              <Plus style={{ width: 12, height: 12 }} /> Add another material
            </button>
          </div>

          {/* Expected Delivery — calendar picker */}
          <div>
            <label style={labelStyle}>Expected Delivery <span style={{ color: "#dc2626" }}>*</span></label>
            <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} style={fieldStyle} />
          </div>

          <div>
            <label style={labelStyle}>Notes <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span></label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional notes..."
              rows={3}
              style={{ ...fieldStyle, resize: "vertical" as const }}
              onFocus={e => (e.currentTarget.style.borderColor = "#f97316")}
              onBlur={e  => (e.currentTarget.style.borderColor = "#e5e7eb")}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontWeight: 700, fontSize: "0.875rem", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Plus style={{ width: 14, height: 14 }} /> {saving ? "Creating…" : "Create PO"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── View PO Materials Modal ─────────────────────────────────────────────────

function ViewPOModal({ po, onClose }: { po: PO; onClose: () => void }) {
  const st = PO_STATUS_STYLE[po.status];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 440, boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
          <div>
            <p style={{ fontWeight: 800, fontSize: "1.05rem", color: "#f97316" }}>{po.number}</p>
            <p style={{ fontSize: "0.82rem", color: "#111827", fontWeight: 600, marginTop: 2 }}>{po.projectName}</p>
            <p style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: 2 }}>{po.supplier} · {po.expectedDate}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        <span style={{ display: "inline-block", fontSize: "0.7rem", fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: st.bg, color: st.color, marginBottom: "1rem" }}>
          · {po.status}
        </span>

        <p style={{ fontSize: "0.72rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>MATERIALS</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {po.materials.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f9fafb", borderRadius: 8, padding: "10px 12px" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#111827" }}>{m.name}</span>
              <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>{m.qty}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.5rem" }}>
          <button onClick={onClose} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Contact Modal ────────────────────────────────────────────────────────────

function ContactModal({ supplier, canEdit, onClose, onSave }: {
  supplier: Supplier; canEdit: boolean; onClose: () => void; onSave: (contact: SupplierContact) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(supplier.contact.email);
  const [phone, setPhone] = useState(supplier.contact.phone);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ email: email.trim(), phone: phone.trim() });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const fieldStyle = { width: "100%", boxSizing: "border-box" as const, padding: "8px 10px", borderRadius: 7, border: "1px solid #e5e7eb", fontSize: "0.85rem", outline: "none", color: "#111827" };
  const hasContact = !!(supplier.contact.email || supplier.contact.phone);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 420, boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <div>
            <p style={{ fontWeight: 800, fontSize: "1rem", color: "#111827" }}>{supplier.name}</p>
            <p style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Contact information</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        {editing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="e.g. sales@supplier.ph" style={fieldStyle} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>Phone</label>
              <input type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. +63 2 8555 0100" style={fieldStyle} />
            </div>
          </div>
        ) : hasContact ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#f9fafb", borderRadius: 8, padding: "10px 12px" }}>
              <Mail style={{ width: 15, height: 15, color: "#9ca3af", flexShrink: 0 }} />
              <span style={{ fontSize: "0.85rem", color: "#111827" }}>{supplier.contact.email || "Not set"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#f9fafb", borderRadius: 8, padding: "10px 12px" }}>
              <Phone style={{ width: 15, height: 15, color: "#9ca3af", flexShrink: 0 }} />
              <span style={{ fontSize: "0.85rem", color: "#111827" }}>{supplier.contact.phone || "Not set"}</span>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "1.5rem 0" }}>
            <p style={{ fontSize: "0.85rem", color: "#9ca3af" }}>No contact information saved yet.</p>
          </div>
        )}

        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
          {editing ? (
            <>
              <button onClick={() => setEditing(false)} disabled={saving} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontWeight: 700, fontSize: "0.875rem", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          ) : canEdit ? (
            <>
              <button onClick={onClose} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}>Close</button>
              <button onClick={() => setEditing(true)} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                {hasContact ? <><Pencil style={{ width: 13, height: 13 }} /> Edit Contact</> : <><Plus style={{ width: 13, height: 13 }} /> Add Contact Info</>}
              </button>
            </>
          ) : (
            <button onClick={onClose} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}>Close</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── History Modal ────────────────────────────────────────────────────────────

function HistoryModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 460, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <div>
            <p style={{ fontWeight: 800, fontSize: "1rem", color: "#111827" }}>{supplier.name}</p>
            <p style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Purchase order history</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        {supplier.history.length === 0 ? (
          <p style={{ fontSize: "0.85rem", color: "#9ca3af", textAlign: "center", padding: "1.5rem 0" }}>No purchase orders yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...supplier.history].reverse().map((h, i) => {
              const st = PO_STATUS_STYLE[h.status];
              return (
                <div key={h.poNumber + i} style={{ background: "#f9fafb", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#f97316" }}>{h.poNumber}</p>
                      <p style={{ fontSize: "0.76rem", color: "#374151", marginTop: 1 }}>{h.projectName}</p>
                      <p style={{ fontSize: "0.68rem", color: "#9ca3af", marginTop: 1 }}>{h.date}</p>
                    </div>
                    <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: st.bg, color: st.color, whiteSpace: "nowrap" }}>
                      · {h.status}
                    </span>
                  </div>
                  {h.evaluation && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, paddingTop: 8, borderTop: "1px solid #f0f0f0" }}>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        {h.evaluation.photoUrls.map((url, pi) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={pi} src={url} alt="Proof of delivery" style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />
                        ))}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <Stars rating={categoryAverage(h.evaluation.ratings)} />
                      </div>
                      <span style={{ fontSize: "0.68rem", fontWeight: 600, color: h.evaluation.onTime ? "#15803d" : "#dc2626" }}>
                        {h.evaluation.onTime ? "On time" : "Delayed"} · {h.evaluation.actualLeadDays}d
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.5rem" }}>
          <button onClick={onClose} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Supplier Rating Modal (overall + category breakdown + transaction history) ─

function SupplierRatingModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const rated = supplier.history.filter((h): h is SupplierHistoryEntry & { evaluation: DeliveryEvaluation } => !!h.evaluation);

  const categoryAverages: CategoryRatings = {
    price: 0, delivery: 0, quality: 0, accuracy: 0, responsiveness: 0,
  };
  if (rated.length > 0) {
    for (const c of RATING_CATEGORIES) {
      categoryAverages[c.key] = rated.reduce((sum, h) => sum + h.evaluation.ratings[c.key], 0) / rated.length;
    }
  }

  const avgLead = rated.length > 0 ? Math.round(rated.reduce((sum, h) => sum + h.evaluation.actualLeadDays, 0) / rated.length) : null;
  const committed = committedLeadDays(supplier.lead);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: 480, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1.5rem 1.5rem 1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: supplier.avatarBg, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: "0.9rem", flexShrink: 0 }}>
              {supplier.initials}
            </div>
            <div>
              <p style={{ fontWeight: 800, fontSize: "1.05rem", color: "#111827" }}>{supplier.name}</p>
              <p style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: 2 }}>{supplier.category} · {rated.length} evaluated transaction{rated.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        {/* Overall score + stats + category breakdown */}
        <div style={{ background: "#f9fafb", padding: "1.25rem 1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <p style={{ fontSize: "2.4rem", fontWeight: 800, color: "#111827", lineHeight: 1 }}>{supplier.rating.toFixed(1)}</p>
              <Stars rating={supplier.rating} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 28, rowGap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>On-Time Rate</span>
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#16a34a" }}>{supplier.onTimePct}%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Avg Lead</span>
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#111827" }}>{avgLead !== null ? `${avgLead}d` : "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Transactions</span>
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#111827" }}>{rated.length}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Committed</span>
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#111827" }}>{committed}d</span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {RATING_CATEGORIES.map(c => (
              <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: "0.78rem", color: "#374151", width: 150, flexShrink: 0 }}>{c.label}</span>
                <div style={{ flex: 1, height: 6, background: "#e5e7eb", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${(categoryAverages[c.key] / 5) * 100}%`, height: "100%", background: "#f97316", borderRadius: 999 }} />
                </div>
                <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#111827", width: 28, textAlign: "right" }}>{categoryAverages[c.key].toFixed(1)}</span>
              </div>
            ))}
          </div>

          <p style={{ fontSize: "0.7rem", color: "#9ca3af", fontStyle: "italic", marginTop: 12 }}>
            Aggregate score calculated exclusively from company-logged transaction evaluations.
          </p>
        </div>

        {/* Transaction history */}
        <div style={{ padding: "1.25rem 1.5rem 1.5rem" }}>
          <p style={{ fontSize: "0.68rem", fontWeight: 800, color: "#9ca3af", letterSpacing: "0.08em", marginBottom: "0.75rem" }}>TRANSACTION HISTORY</p>
          {rated.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "#9ca3af", textAlign: "center", padding: "1.5rem 0" }}>No evaluated transactions yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[...rated].reverse().map((h, i) => {
                const avg = categoryAverage(h.evaluation.ratings);
                return (
                  <div key={h.poNumber + i} style={{ background: "#f9fafb", borderRadius: 10, padding: "0.9rem 1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <p style={{ fontWeight: 700, fontSize: "0.85rem", color: "#111827" }}>{h.poNumber}</p>
                      <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: h.evaluation.onTime ? "#16a34a" : "#dc2626" }}>
                        {h.evaluation.onTime ? <><CheckCircle2 style={{ width: 12, height: 12 }} /> On Time</> : <><AlertTriangle style={{ width: 12, height: 12 }} /> Delayed</>}
                      </span>
                    </div>
                    <p style={{ fontSize: "0.72rem", color: "#9ca3af", marginTop: 2 }}>{h.date} · {h.evaluation.raterName}</p>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginTop: 10 }}>
                      {RATING_CATEGORIES.map(c => (
                        <div key={c.key} style={{ textAlign: "center" }}>
                          <Stars rating={h.evaluation.ratings[c.key]} />
                          <p style={{ fontSize: "0.6rem", color: "#9ca3af", marginTop: 2 }}>{c.short}</p>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                      <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#111827" }}>★ {avg.toFixed(1)} avg</span>
                      <span style={{ fontSize: "0.72rem", color: "#6b7280" }}>Lead: {h.evaluation.actualLeadDays}d (committed {committed}d)</span>
                    </div>

                    {h.evaluation.comments && (
                      <div style={{ background: "#fff", borderRadius: 8, padding: "0.6rem 0.75rem", marginTop: 8 }}>
                        <p style={{ fontSize: "0.76rem", color: "#374151", fontStyle: "italic" }}>&ldquo;{h.evaluation.comments}&rdquo;</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 1.5rem 1.5rem" }}>
          <button onClick={onClose} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {[1,2,3,4,5].map(i => (
        <span key={i} style={{ color: i <= Math.floor(rating) ? "#f59e0b" : i - 0.5 <= rating ? "#f59e0b" : "#d1d5db", fontSize: "0.9rem" }}>★</span>
      ))}
    </span>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {[1,2,3,4,5].map(i => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: i <= value ? "#f59e0b" : "#d1d5db", fontSize: "1.6rem", lineHeight: 1 }}
        >★</button>
      ))}
    </span>
  );
}

// ── Delivery Confirmation Modal (proof of delivery + supplier rating) ────────

// Reads e.g. "3-5 days" -> 3, "4-6 days" -> 4, falls back to 5 for suppliers
// with no established lead time yet (freshly auto-added ones).
function committedLeadDays(lead: string): number {
  const match = lead.match(/\d+/);
  return match ? Number(match[0]) : 5;
}

const RATING_CATEGORY_SUBTITLES: Record<keyof CategoryRatings, string> = {
  price:          "How competitive was their pricing compared to alternatives?",
  delivery:       "How reliably did they meet the agreed delivery schedule?",
  quality:        "How was the quality of the materials received?",
  accuracy:       "Did they deliver the correct items and quantities?",
  responsiveness: "How fast did they address service or supply updates?",
};

interface PhotoEntry { file: File; previewUrl: string; }

function DeliveryConfirmModal({ po, supplier, onClose, onSubmit }: {
  po: PO;
  supplier: Supplier | undefined;
  onClose: () => void;
  onSubmit: (data: DeliverySubmission) => Promise<void>;
}) {
  const [step, setStep] = useState<"photo" | "rating">("photo");
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [ratings, setRatings] = useState<CategoryRatings>({ price: 0, delivery: 0, quality: 0, accuracy: 0, responsiveness: 0 });
  const [onTime, setOnTime] = useState<boolean | null>(null);
  const [actualLeadDays, setActualLeadDays] = useState("");
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function setCategoryRating(key: keyof CategoryRatings, value: number) {
    setRatings(prev => ({ ...prev, [key]: value }));
  }

  function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const nonImages = files.filter(f => !f.type.startsWith("image/"));
    if (nonImages.length > 0) { toast.error("Please select image files only."); }
    const entries = files.filter(f => f.type.startsWith("image/")).map(f => ({ file: f, previewUrl: URL.createObjectURL(f) }));
    setPhotos(prev => [...prev, ...entries]);
    e.target.value = "";
  }

  function handleRemovePhoto(index: number) {
    setPhotos(prev => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  function handleClose() {
    photos.forEach(p => URL.revokeObjectURL(p.previewUrl));
    onClose();
  }

  async function handleSubmit() {
    const allRated = RATING_CATEGORIES.every(c => ratings[c.key] > 0);
    if (photos.length === 0 || !allRated || onTime === null || !actualLeadDays.trim()) {
      toast.error("Please complete the delivery evaluation.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        photoFiles: photos.map(p => p.file),
        ratings,
        onTime,
        actualLeadDays: Number(actualLeadDays),
        comments: comments.trim(),
      });
    } finally {
      setSubmitting(false);
    }
  }

  const lead = committedLeadDays(supplier?.lead ?? "5");

  return (
    <div onClick={handleClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 460, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {step === "photo" ? <Camera style={{ width: 18, height: 18, color: "#f97316" }} /> : <CheckCircle2 style={{ width: 18, height: 18, color: "#f97316" }} />}
            </div>
            <div>
              <h2 style={{ fontWeight: 800, fontSize: "1.05rem", margin: 0 }}>{step === "photo" ? "Proof of Delivery" : "Rate the Supplier"}</h2>
              <p style={{ fontSize: "0.72rem", color: "#9ca3af", margin: 0 }}>{po.number} · {po.supplier}</p>
            </div>
          </div>
          <button onClick={handleClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        {step === "photo" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <p style={{ fontSize: "0.82rem", color: "#374151" }}>Upload one or more photos showing the delivered materials before marking this PO as delivered.</p>

            {photos.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {photos.map((p, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.previewUrl} alt={`Proof of delivery ${i + 1}`} style={{ width: "100%", height: 90, borderRadius: 8, objectFit: "cover" }} />
                    <button onClick={() => handleRemovePhoto(i)} title="Remove"
                      style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: "50%", background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <X style={{ width: 12, height: 12 }} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <label style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
              border: "2px dashed #e5e7eb", borderRadius: 12, padding: "1.5rem 1rem", cursor: "pointer", background: "#f9fafb",
            }}>
              <Upload style={{ width: 22, height: 22, color: "#9ca3af" }} />
              <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>{photos.length > 0 ? "Add more photos" : "Click to upload photos"}</span>
              <input type="file" accept="image/*" multiple onChange={handlePhotoSelected} style={{ display: "none" }} />
            </label>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {RATING_CATEGORIES.map(c => (
              <div key={c.key}>
                <p style={{ fontWeight: 700, fontSize: "0.9rem", color: "#111827", marginBottom: 2 }}>{c.label}</p>
                <p style={{ fontSize: "0.75rem", color: "#9ca3af", marginBottom: 8 }}>{RATING_CATEGORY_SUBTITLES[c.key]}</p>
                <StarPicker value={ratings[c.key]} onChange={v => setCategoryRating(c.key, v)} />
              </div>
            ))}

            <div>
              <p style={{ fontWeight: 700, fontSize: "0.9rem", color: "#111827", marginBottom: 8 }}>Was delivery on time?</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <button onClick={() => setOnTime(true)} style={{
                  padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem", fontWeight: 600,
                  border: onTime === true ? "1.5px solid #15803d" : "1px solid #e5e7eb",
                  background: onTime === true ? "#dcfce7" : "#f9fafb",
                  color: onTime === true ? "#15803d" : "#6b7280",
                }}>
                  <Check style={{ width: 13, height: 13, display: "inline", marginRight: 5, verticalAlign: "-2px" }} /> Yes, on time
                </button>
                <button onClick={() => setOnTime(false)} style={{
                  padding: "10px", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem", fontWeight: 600,
                  border: onTime === false ? "1.5px solid #dc2626" : "1px solid #e5e7eb",
                  background: onTime === false ? "#fee2e2" : "#f9fafb",
                  color: onTime === false ? "#dc2626" : "#6b7280",
                }}>
                  <X style={{ width: 13, height: 13, display: "inline", marginRight: 5, verticalAlign: "-2px" }} /> No, was delayed
                </button>
              </div>
            </div>

            <div>
              <p style={{ fontWeight: 700, fontSize: "0.9rem", color: "#111827", marginBottom: 8 }}>Actual Lead Time (Days)</p>
              <input type="number" min={0} value={actualLeadDays} onChange={e => setActualLeadDays(e.target.value)} placeholder={`Committed: ${lead} days`}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: "0.85rem", outline: "none", color: "#111827" }}
              />
            </div>

            <div>
              <p style={{ fontWeight: 700, fontSize: "0.9rem", color: "#111827", marginBottom: 8 }}>Comments <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span></p>
              <textarea value={comments} onChange={e => setComments(e.target.value)} placeholder="Note quality, pricing, communication issues, etc."
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: "0.85rem", outline: "none", color: "#111827", resize: "vertical" as const }}
              />
            </div>

            <div style={{ background: "#f9fafb", borderRadius: 8, padding: "0.75rem 1rem" }}>
              <p style={{ fontSize: "0.75rem", color: "#9ca3af", fontStyle: "italic" }}>
                This evaluation is logged against <strong style={{ color: "#374151" }}>{po.number}</strong> and will contribute to{" "}
                <strong style={{ color: "#374151" }}>{po.supplier}</strong>&apos;s aggregate performance score.
              </p>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
          {step === "photo" ? (
            <>
              <button onClick={handleClose} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}>Cancel</button>
              <button onClick={() => setStep("rating")} disabled={photos.length === 0} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: photos.length > 0 ? "#f97316" : "#fbd0a6", color: "#fff", fontWeight: 700, fontSize: "0.875rem", cursor: photos.length > 0 ? "pointer" : "not-allowed" }}>
                Continue
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep("photo")} disabled={submitting} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                ← Back
              </button>
              <button onClick={handleSubmit} disabled={submitting} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontWeight: 700, fontSize: "0.875rem", cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}>
                {submitting ? "Submitting…" : "Submit"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProcurementPage() {
  const [tab,      setTab]      = useState<"po" | "suppliers">("po");
  const [orders,   setOrders]   = useState<PO[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading,  setLoading]  = useState(true);

  const [showNewPO, setShowNewPO] = useState(false);
  const [viewingPOId, setViewingPOId] = useState<number | null>(null);
  const [contactSupplierId, setContactSupplierId] = useState<number | null>(null);
  const [historySupplierId, setHistorySupplierId] = useState<number | null>(null);
  const [ratingSupplierId, setRatingSupplierId] = useState<number | null>(null);
  const [deliveryConfirmPOId, setDeliveryConfirmPOId] = useState<number | null>(null);

  const viewingPO       = orders.find(o => o.id === viewingPOId) ?? null;
  const contactSupplier = suppliers.find(s => s.id === contactSupplierId) ?? null;
  const historySupplier = suppliers.find(s => s.id === historySupplierId) ?? null;
  const ratingSupplier  = suppliers.find(s => s.id === ratingSupplierId) ?? null;
  const deliveryConfirmPO = orders.find(o => o.id === deliveryConfirmPOId) ?? null;

  const { user } = useAuthStore();
  const role = user?.role ?? "SiteEngineer";
  // Admin/ProjectManager/ProcurementOfficer manage the full PO lifecycle.
  // WarehousePersonnel only receives deliveries — they can't create POs or set
  // Pending/Approved, but can mark a PO Delivered (photo + rating required).
  // SiteEngineer is view-only.
  const canManagePOs = role === "Admin" || role === "ProjectManager" || role === "ProcurementOfficer";
  const canMarkDelivered = canManagePOs || role === "WarehousePersonnel";
  const canEditContact = role === "ProcurementOfficer" || role === "Admin";

  async function refetch() {
    const [ordersRes, suppliersRes] = await Promise.all([
      api.get<ApiPO[]>("/purchase-orders"),
      api.get<ApiSupplier[]>("/suppliers"),
    ]);
    setOrders(ordersRes.data.map(mapPO));
    setSuppliers(suppliersRes.data.map(mapSupplier));
  }

  useEffect(() => {
    refetch()
      .catch(() => toast.error("Failed to load procurement data."))
      .finally(() => setLoading(false));
  }, []);

  async function handleAddPO(input: NewPOInput) {
    try {
      const { data } = await api.post<ApiPO>("/purchase-orders", input);
      await refetch();
      toast.success(`${data.number} created`);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message ?? "Failed to create purchase order.");
      throw err;
    }
  }

  async function handleSaveContact(supplierId: number, contact: SupplierContact) {
    const target = suppliers.find(s => s.id === supplierId);
    const hadContact = !!(target?.contact.email || target?.contact.phone);
    try {
      await api.put(`/suppliers/${supplierId}/contact`, { email: contact.email || null, phone: contact.phone || null });
      await refetch();
      toast.success(hadContact ? "Contact info updated" : "Contact info added");
    } catch {
      toast.error("Failed to update contact info.");
      throw new Error("save-contact-failed");
    }
  }

  function countByStatus(s: POStatus) { return orders.filter(p => getEffectiveStatus(p) === s).length; }

  const sortedOrders = useMemo(
    () => [...orders].sort((a, b) => STATUS_SORT_ORDER[getEffectiveStatus(a)] - STATUS_SORT_ORDER[getEffectiveStatus(b)]),
    [orders]
  );

  const counts = {
    pending:   countByStatus("PENDING"),
    approved:  countByStatus("APPROVED"),
    delivered: countByStatus("DELIVERED"),
    delayed:   countByStatus("DELAYED"),
  };

  // Marking a PO delivered requires proof-of-delivery + a supplier rating first;
  // every other transition applies immediately.
  async function handleStatusSelect(po: PO, status: POStatus) {
    if (status === "DELIVERED" && po.status !== "DELIVERED") {
      setDeliveryConfirmPOId(po.id);
      return;
    }
    try {
      await api.patch(`/purchase-orders/${po.id}/status`, { status: frontendStatusToApi(status) });
      await refetch();
      toast.success(`${po.number} marked ${status.toLowerCase()}`);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message ?? "Failed to update status.");
    }
  }

  async function handleConfirmDelivery(po: PO, submission: DeliverySubmission) {
    const form = new FormData();
    form.append("PriceRating", String(submission.ratings.price));
    form.append("DeliveryRating", String(submission.ratings.delivery));
    form.append("QualityRating", String(submission.ratings.quality));
    form.append("AccuracyRating", String(submission.ratings.accuracy));
    form.append("ResponsivenessRating", String(submission.ratings.responsiveness));
    form.append("OnTime", String(submission.onTime));
    form.append("ActualLeadDays", String(submission.actualLeadDays));
    if (submission.comments) form.append("Comments", submission.comments);
    submission.photoFiles.forEach(f => form.append("Photos", f));

    try {
      await api.post(`/purchase-orders/${po.id}/deliver`, form, { headers: { "Content-Type": undefined } });
      await refetch();
      setDeliveryConfirmPOId(null);
      toast.success(`${po.number} marked delivered — ${po.supplier} rated`);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message ?? "Failed to submit delivery evaluation.");
    }
  }

  // ── R4: weather-adjusted delivery risk ──────────────────────────────────
  const snapshot = useWeatherStore(s => s.snapshot);
  const daily    = useWeatherStore(s => s.daily);
  const risk     = useWeatherStore(s => s.risk);
  const addAlert = useAlertStore(s => s.addAlert);

  const atRiskOrders = useMemo(() => {
    if (!risk || !snapshot) return [];
    return computeWeatherAtRiskOrders(orders, risk.level, snapshot.conditionLabel);
  }, [orders, risk, snapshot]);

  useEffect(() => {
    if (!risk || !snapshot || atRiskOrders.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    addAlert({
      kind: "weather",
      title: "Weather-Adjusted Delivery Risk",
      body: `${atRiskOrders.length} active purchase order${atRiskOrders.length > 1 ? "s" : ""} may be delayed due to ${snapshot.conditionLabel.toLowerCase()} in ${snapshot.locationName}. Recommended buffer: +${atRiskOrders[0].bufferDays} day(s).`,
      dedupeKey: `po-weather-${today}-${risk.level}-${atRiskOrders.length}`,
    });
  }, [atRiskOrders, risk, snapshot, addAlert]);

  if (loading) {
    return (
      <div style={{ background: "#f5f4f0", minHeight: "100vh" }}>
        <Header title="Procurement" />
        <div style={{ padding: "3rem", textAlign: "center", color: "#9ca3af", fontSize: "0.9rem" }}>Loading procurement data…</div>
      </div>
    );
  }

  return (
    <div style={{ background: "#f5f4f0" }}>
      {showNewPO && <NewPOModal onClose={() => setShowNewPO(false)} onAdd={handleAddPO} supplierNames={sortSuppliersByPreference(suppliers).map(s => s.name)} />}
      {viewingPO && <ViewPOModal po={viewingPO} onClose={() => setViewingPOId(null)} />}
      {contactSupplier && (
        <ContactModal
          supplier={contactSupplier}
          canEdit={canEditContact}
          onClose={() => setContactSupplierId(null)}
          onSave={contact => handleSaveContact(contactSupplier.id, contact)}
        />
      )}
      {historySupplier && <HistoryModal supplier={historySupplier} onClose={() => setHistorySupplierId(null)} />}
      {ratingSupplier && <SupplierRatingModal supplier={ratingSupplier} onClose={() => setRatingSupplierId(null)} />}
      {deliveryConfirmPO && (
        <DeliveryConfirmModal
          po={deliveryConfirmPO}
          supplier={suppliers.find(s => s.id === deliveryConfirmPO.supplierId)}
          onClose={() => setDeliveryConfirmPOId(null)}
          onSubmit={submission => handleConfirmDelivery(deliveryConfirmPO, submission)}
        />
      )}
      <Header title="Procurement" />

      <div style={{ padding: "1.25rem 1.5rem" }}>

        {/* ── 4 stat cards ─────────────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
          {[
            { icon: Clock,        color: "#6b7280", bg: "#f3f4f6", label: "Pending POs",  value: counts.pending   },
            { icon: CheckCircle2, color: "#16a34a", bg: "#dcfce7", label: "Approved POs", value: counts.approved  },
            { icon: PackageCheck, color: "#1d4ed8", bg: "#dbeafe", label: "Delivered",    value: counts.delivered },
            { icon: AlertTriangle,color: "#dc2626", bg: "#fee2e2", label: "Delayed",      value: counts.delayed   },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} style={{ background: "#fff", borderRadius: 14, padding: "1.5rem 1.5rem 1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
                <div style={{ width: 44, height: 44, borderRadius: 11, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "0.875rem" }}>
                  <Icon style={{ width: 22, height: 22, color: s.color }} />
                </div>
                <p style={{ fontSize: "2.2rem", fontWeight: 800, color: "#111827", lineHeight: 1 }}>{s.value}</p>
                <p style={{ fontSize: "0.78rem", color: "#9ca3af", marginTop: 4 }}>{s.label}</p>
              </div>
            );
          })}
        </div>

        {/* ── Weather & Delivery Risk (R4) — visible above both tabs ─────────── */}
        {snapshot && risk && (
          <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", marginBottom: "1.5rem" }}>
            <div style={{
              flex: 1, minWidth: 0,
              background: RISK_VISUALS[risk.level].bg,
              border: `1px solid ${RISK_VISUALS[risk.level].border}`,
              borderRadius: 14, padding: "1rem 1.25rem",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: "1.6rem" }}>{snapshot.emoji}</span>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: "0.9rem", color: "#111827" }}>
                      {snapshot.tempC}°C · {snapshot.conditionLabel} — {snapshot.locationName}
                    </p>
                    <p style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: 2 }}>{risk.advisory}</p>
                  </div>
                </div>
                <span style={{
                  fontSize: "0.68rem", fontWeight: 700, padding: "4px 12px", borderRadius: 999,
                  background: RISK_VISUALS[risk.level].badgeBg, color: RISK_VISUALS[risk.level].badgeColor,
                  textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap",
                }}>
                  {risk.level} risk
                </span>
              </div>

              {atRiskOrders.length > 0 && (
                <div style={{ marginTop: "0.9rem", display: "flex", flexDirection: "column", gap: 6 }}>
                  <p style={{ fontSize: "0.72rem", fontWeight: 700, color: "#374151" }}>
                    {atRiskOrders.length} active purchase order{atRiskOrders.length > 1 ? "s" : ""} may be delayed — recommended reorder buffer applied:
                  </p>
                  {atRiskOrders.map(po => (
                    <div key={po.number} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.6)", borderRadius: 8, padding: "6px 10px" }}>
                      <span style={{ fontSize: "0.76rem", fontWeight: 600, color: "#111827" }}>{po.number} · {po.projectName} <span style={{ color: "#9ca3af", fontWeight: 400 }}>({po.supplier})</span></span>
                      <span style={{ fontSize: "0.72rem", color: "#b45309", fontWeight: 600, whiteSpace: "nowrap" }}>+{po.bufferDays}d buffer</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Weather Impact — same live source as the Dashboard's card */}
            <div style={{ width: 300, flexShrink: 0, background: "#1a2235", borderRadius: 14, padding: "1.25rem", color: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.875rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span>{snapshot.emoji}</span>
                  <span style={{ fontWeight: 700, fontSize: "0.875rem" }}>Weather Impact</span>
                </div>
                <span style={{ color: "#6b7280", fontSize: "0.65rem" }}>{snapshot.locationName}, Today</span>
              </div>

              <div style={{ fontSize: "2.4rem", fontWeight: 800, lineHeight: 1 }}>{snapshot.tempC}°C</div>
              <p style={{ color: "#9ca3af", fontSize: "0.78rem", marginTop: 4, marginBottom: "0.875rem" }}>{snapshot.conditionLabel}</p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.875rem" }}>
                {[
                  { label: "WIND",          val: `${snapshot.windKph} km/h`,             Icon: Wind },
                  { label: "HUMIDITY",      val: `${snapshot.humidityPct}%`,             Icon: Droplets },
                  { label: "PRECIPITATION", val: `${snapshot.precipitationMm} mm`,       Icon: CloudRain },
                  { label: "RISK LEVEL",    val: risk.level.toUpperCase(),               Icon: AlertTriangle },
                ].map(w => (
                  <div key={w.label} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "0.5rem 0.6rem" }}>
                    <p style={{ color: "#6b7280", fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.06em" }}>{w.label}</p>
                    <p style={{ color: "#fff", fontSize: "0.76rem", fontWeight: 600, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                      <w.Icon style={{ width: 11, height: 11 }} /> {w.val}
                    </p>
                  </div>
                ))}
              </div>

              <div style={{ background: RISK_VISUALS_DARK[risk.level].bg, border: `1px solid ${RISK_VISUALS_DARK[risk.level].border}`, borderRadius: 8, padding: "0.5rem 0.7rem", marginBottom: "0.875rem" }}>
                <p style={{ color: RISK_VISUALS_DARK[risk.level].text, fontSize: "0.7rem", lineHeight: 1.4 }}>
                  {risk.level === "low" ? "✓ " : "⚠ "}{risk.advisory}
                </p>
              </div>

              {daily.length > 0 && (
                <>
                  <p style={{ color: "#6b7280", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.05em", marginBottom: "0.5rem" }}>5-Day Forecast</p>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    {daily.map(d => (
                      <div key={d.date} style={{ textAlign: "center" }}>
                        <p style={{ color: "#6b7280", fontSize: "0.62rem" }}>{formatShortDate(d.date)}</p>
                        <p style={{ fontSize: "1rem", margin: "2px 0" }}>{d.emoji}</p>
                        <p style={{ color: "#fff", fontSize: "0.72rem", fontWeight: 600 }}>{d.maxTempC}°</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 4, background: "#e5e7eb", borderRadius: 8, padding: 4, width: "fit-content", marginBottom: "1.25rem" }}>
          {([{ id: "po", label: "Purchase Orders" }, { id: "suppliers", label: "Suppliers" }] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "6px 20px", borderRadius: 6, fontSize: "0.875rem",
              fontWeight: tab === t.id ? 600 : 400, border: "none", cursor: "pointer",
              background: tab === t.id ? "#fff" : "transparent",
              color: tab === t.id ? "#111827" : "#6b7280",
              boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              transition: "all 0.15s",
            }}>{t.label}</button>
          ))}
        </div>

        {/* ────────────────────────────────────────────────────────────────── */}
        {/* Tab: Purchase Orders                                               */}
        {/* ────────────────────────────────────────────────────────────────── */}
        {tab === "po" && (
          <div style={{ background: "#fff", borderRadius: 12, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ShoppingCart style={{ width: 16, height: 16, color: "#f97316" }} />
                <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Purchase Orders</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {canManagePOs && (
                  <button onClick={() => setShowNewPO(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" }}>
                    <Plus style={{ width: 14, height: 14 }} /> New PO
                  </button>
                )}
                <button onClick={() => exportPOs(sortedOrders)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "0.8rem", fontWeight: 500, cursor: "pointer" }}>
                  <Download style={{ width: 14, height: 14 }} /> Export
                </button>
              </div>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                  {["PO NUMBER","PROJECT NAME","SUPPLIER","STATUS","EXPECTED DATE","VIEW"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: "0.65rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedOrders.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: "2rem 12px", textAlign: "center", color: "#9ca3af", fontSize: "0.85rem" }}>No purchase orders yet.</td></tr>
                ) : sortedOrders.map((po, i) => {
                  const status = getEffectiveStatus(po);
                  const st = PO_STATUS_STYLE[status];
                  return (
                    <tr key={po.id} style={{ borderBottom: i < sortedOrders.length - 1 ? "1px solid #f9fafb" : "none" }}>
                      <td style={{ padding: "14px 12px" }}>
                        <span style={{ fontWeight: 700, fontSize: "0.8rem", color: "#f97316" }}>{po.number}</span>
                      </td>
                      <td style={{ padding: "14px 12px" }}>
                        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#111827" }}>{po.projectName}</span>
                      </td>
                      <td style={{ padding: "14px 12px", fontSize: "0.78rem", color: "#6b7280" }}>{po.supplier}</td>
                      <td style={{ padding: "14px 12px" }}>
                        {canManagePOs ? (
                          <select
                            value={status === "DELAYED" ? "DELAYED" : po.status}
                            onChange={e => handleStatusSelect(po, e.target.value as POStatus)}
                            title={status === "DELAYED" ? "Past its expected delivery date" : undefined}
                            style={{
                              fontSize: "0.7rem", fontWeight: 700, padding: "3px 8px", borderRadius: 999,
                              background: st.bg, color: st.color, border: "none", cursor: "pointer", outline: "none",
                              appearance: "none" as const,
                            }}
                          >
                            {status === "DELAYED" && <option value="DELAYED" disabled hidden>DELAYED</option>}
                            {PO_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : canMarkDelivered && status !== "DELIVERED" ? (
                          // Warehouse personnel: the only action available is marking a PO
                          // Delivered (which requires proof of delivery + a supplier rating) —
                          // Pending/Approved are never selectable, and the backend rejects
                          // them too if attempted directly.
                          <select
                            value={status}
                            onChange={e => handleStatusSelect(po, e.target.value as POStatus)}
                            title="You can only mark this purchase order as delivered"
                            style={{
                              fontSize: "0.7rem", fontWeight: 700, padding: "3px 8px", borderRadius: 999,
                              background: st.bg, color: st.color, border: "none", cursor: "pointer", outline: "none",
                              appearance: "none" as const,
                            }}
                          >
                            <option value={status} disabled hidden>{status}</option>
                            <option value="DELIVERED">DELIVERED</option>
                          </select>
                        ) : (
                          <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: st.bg, color: st.color, whiteSpace: "nowrap" }}>
                            · {status}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "14px 12px", fontSize: "0.78rem", color: "#6b7280", whiteSpace: "nowrap" }}>{po.expectedDate}</td>
                      <td style={{ padding: "14px 12px" }}>
                        <button title="View materials" onClick={() => setViewingPOId(po.id)} style={{ color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                          <Eye style={{ width: 16, height: 16 }} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ────────────────────────────────────────────────────────────────── */}
        {/* Tab: Suppliers                                                     */}
        {/* ────────────────────────────────────────────────────────────────── */}
        {tab === "suppliers" && (
          <div>

            {/* Supplier cards */}
            {suppliers.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 14, padding: "2rem", textAlign: "center", color: "#9ca3af", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
                No suppliers yet — they&apos;re added automatically the first time you create a PO for them.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.25rem" }}>
                {suppliers.map(s => (
                  <div key={s.id} style={{ background: "#fff", borderRadius: 14, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
                    {/* Header */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1rem" }}>
                      <div style={{ width: 48, height: 48, borderRadius: 10, background: s.avatarBg, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: "0.875rem", flexShrink: 0 }}>
                        {s.initials}
                      </div>
                      <div>
                        <p style={{ fontWeight: 700, fontSize: "0.95rem", color: "#111827" }}>{s.name}</p>
                        <p style={{ fontSize: "0.72rem", color: "#9ca3af", marginTop: 2 }}>{s.category} · Lead: {s.lead}</p>
                      </div>
                    </div>

                    {/* 3 stat boxes */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", marginBottom: "0.875rem" }}>
                      {[
                        { label: "Rating",     value: s.rating.toFixed(1) },
                        { label: "Deliveries", value: s.deliveries        },
                        { label: "On-Time",    value: `${s.onTimePct}%`  },
                      ].map(b => (
                        <div key={b.label} style={{ background: "#f9fafb", borderRadius: 8, padding: "0.6rem", textAlign: "center" }}>
                          <p style={{ fontSize: "1rem", fontWeight: 700, color: "#111827" }}>{b.value}</p>
                          <p style={{ fontSize: "0.62rem", color: "#9ca3af", marginTop: 2 }}>{b.label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Stars + buttons */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <button onClick={() => setRatingSupplierId(s.id)} title="View rating breakdown" style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                        <Stars rating={s.rating} />
                        <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "#374151" }}>{s.rating.toFixed(1)}</span>
                      </button>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => setContactSupplierId(s.id)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}>
                          <Send style={{ width: 12, height: 12 }} /> Contact
                        </button>
                        <button onClick={() => setHistorySupplierId(s.id)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}>
                          <History style={{ width: 12, height: 12 }} /> History
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Supplier Performance — ranked most to least preferred */}
            {suppliers.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 14, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
                <p style={{ fontWeight: 700, fontSize: "0.95rem", color: "#111827", marginBottom: "1rem" }}>Supplier Performance</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                  {sortSuppliersByPreference(suppliers)
                    .map((s, i) => {
                      const badgeName = getSupplierBadge(s);
                      const badge = BADGE_STYLE[badgeName];
                      const onTimeColor = s.onTimePct >= 90 ? "#22c55e" : s.onTimePct >= 80 ? "#f97316" : "#ef4444";
                      return (
                        <div key={s.id} style={{ background: "#1e3154", borderRadius: 12, padding: "1.1rem", position: "relative" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.875rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "#f97316" }}>#{i + 1}</span>
                              <Truck style={{ width: 18, height: 18, color: "#94a3b8" }} />
                            </div>
                            <span style={{ fontSize: "0.6rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: badge.bg, color: badge.color }}>
                              {badgeName}
                            </span>
                          </div>
                          <p style={{ fontWeight: 700, fontSize: "0.85rem", color: "#fff", marginBottom: "0.75rem" }}>{s.name}</p>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.75rem" }}>
                            {[
                              { label: "On-Time Delivery", value: `${s.onTimePct}%`, color: onTimeColor },
                              { label: "Avg. Lead Time",   value: s.lead,           color: "#fff"    },
                              { label: "Total Deliveries", value: String(s.deliveries), color: "#fff" },
                            ].map(r => (
                              <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                <span style={{ fontSize: "0.68rem", color: "#94a3b8" }}>{r.label}</span>
                                <span style={{ fontSize: "0.78rem", fontWeight: 700, color: r.color }}>{r.value}</span>
                              </div>
                            ))}
                          </div>
                          <button onClick={() => setRatingSupplierId(s.id)} title="View rating breakdown" style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                            <Stars rating={s.rating} />
                            <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>{s.rating.toFixed(1)}</span>
                          </button>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

          </div>
        )}

      </div>
    </div>
  );
}
