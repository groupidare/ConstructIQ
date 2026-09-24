"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Header from "@/components/layout/Header";
import {
  Clock, CheckCircle2, PackageCheck, AlertTriangle, Truck,
  ShoppingCart, Download, Plus, Eye,
  Send, History, X, Mail, Phone, Pencil, Camera, Upload, Check,
  Wind, Droplets, CloudRain, ClipboardList, ChevronRight, ArrowRight,
} from "lucide-react";
import { useWeatherStore } from "@/store/weatherStore";
import { useAlertStore } from "@/store/alertStore";
import { useAuthStore } from "@/store/authStore";
import { RISK_VISUALS, RISK_VISUALS_DARK } from "@/lib/weather";
import { computeWeatherAtRiskOrders } from "@/lib/deliveryRisk";
import api from "@/lib/api";

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

type POStatus = "PENDING" | "APPROVED" | "DELIVERY_IN_PROGRESS" | "DELIVERED" | "DELAYED";

interface POMaterial {
  name: string;
  qty: string;
}

interface DeliveryBatch {
  id: number;
  batchNumber: number;
  uploadedByName: string;
  createdAt: string;
  photoUrls: string[];
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
  deliveryBatches: DeliveryBatch[];
  hasEvaluation: boolean;
}

// DELAYED is never manually selectable — it's derived from the expected date
// having passed while the order is still PENDING/APPROVED. DELIVERED isn't
// offered here at all — only WarehousePersonnel can click it (see their own
// dropdown further down), since they're the only ones who physically receive
// the goods; Admin/ProjectManager/ProcurementOfficer manage the lifecycle up
// through Approved and then just watch delivery progress read-only.
const PO_STATUSES: POStatus[] = ["PENDING", "APPROVED"];

const PO_STATUS_STYLE: Record<POStatus, { bg: string; color: string }> = {
  PENDING:               { bg: "#fef3c7", color: "#b45309"  },
  APPROVED:              { bg: "#dcfce7", color: "#15803d"  },
  DELIVERY_IN_PROGRESS:  { bg: "#e0e7ff", color: "#4338ca"  },
  DELIVERED:             { bg: "#f3f4f6", color: "#374151"  },
  DELAYED:               { bg: "#fee2e2", color: "#dc2626"  },
};

const STATUS_SORT_ORDER: Record<POStatus, number> = { DELAYED: 0, PENDING: 1, APPROVED: 2, DELIVERY_IN_PROGRESS: 3, DELIVERED: 4 };

// A non-delivered, not-yet-in-progress order becomes DELAYED the moment its
// expected date passes — this is computed, never stored, so it can't drift
// out of sync or be set by hand. Once delivery has actually started, the real
// status is more useful than a stale "was this late" guess.
function getEffectiveStatus(po: PO): POStatus {
  if (po.status === "DELIVERED" || po.status === "DELIVERY_IN_PROGRESS") return po.status;
  const expected = new Date(po.expectedDate).getTime();
  if (!Number.isNaN(expected) && expected < Date.now()) return "DELAYED";
  return po.status;
}

function statusLabel(s: POStatus): string {
  return s.replace(/_/g, " ");
}

// The backend's PurchaseOrderStatus enum serializes as "Pending"/"Approved"/
// "DeliveryInProgress"/"Delivered" — the frontend works in ALL-CAPS (with
// underscores) everywhere else, so these two helpers are the only place that
// conversion happens.
function apiStatusToFrontend(s: string): POStatus {
  if (s === "DeliveryInProgress") return "DELIVERY_IN_PROGRESS";
  return s.toUpperCase() as POStatus;
}
function frontendStatusToApi(s: POStatus): string {
  if (s === "DELIVERY_IN_PROGRESS") return "DeliveryInProgress";
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

// What the rating modal hands back up — the backend derives the rater from
// the auth token, so no name is sent from the client. Photos aren't part of
// this anymore — they're already on the PO's delivery batches by the time a
// rating is submitted.
interface RatingSubmission {
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
interface ApiDeliveryBatch {
  id: number; batchNumber: number; uploadedByName: string; createdAt: string; photoUrls: string[];
}
interface ApiPO {
  id: number; number: string;
  projectId: number; projectName: string;
  supplierId: number; supplierName: string;
  status: string; expectedDate: string;
  materials: ApiPOMaterial[];
  deliveryBatches: ApiDeliveryBatch[];
  hasEvaluation: boolean;
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
    deliveryBatches: a.deliveryBatches.map(b => ({
      id: b.id, batchNumber: b.batchNumber, uploadedByName: b.uploadedByName,
      createdAt: b.createdAt, photoUrls: b.photoUrls,
    })),
    hasEvaluation: a.hasEvaluation,
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

// ── Material Requests ─────────────────────────────────────────────────────────

interface ProjectWithRequests {
  projectId: number;
  projectName: string;
  pendingCount: number;
}

interface RequestRow {
  id: number;
  materialId: number;
  materialName: string;
  quantity: number;
  unit: string;
  requestedByName: string;
}

interface SuggestedSupplier {
  id: number;
  name: string;
  rating: number;
  onTimePct: number;
  deliveries: number;
  hasHistoryWithMaterial: boolean;
}

interface ApiProjectWithRequests { projectId: number; projectName: string; pendingCount: number; }
interface ApiMaterialRequest {
  id: number; materialId: number; materialName: string;
  quantity: number; unit: string; requestedByName: string; createdAt: string;
}
interface ApiSuggestedSupplier {
  id: number; name: string; rating: number; onTimePct: number; deliveries: number; hasHistoryWithMaterial: boolean;
}
interface ApiGeneratedResult {
  purchaseOrders: unknown[];
  requestPoNumbers: Record<number, string>;
}

function mapRequestRow(a: ApiMaterialRequest): RequestRow {
  return {
    id: a.id, materialId: a.materialId, materialName: a.materialName,
    quantity: a.quantity, unit: a.unit, requestedByName: a.requestedByName,
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

// ── Requests Overlay Modal ───────────────────────────────────────────────────
// Reviews every pending material request for one project: pick a supplier
// per material (ranked by order history + rating, or type a new one), then
// generate real purchase orders — one per unique supplier chosen, grouping
// every material assigned to that supplier onto the same PO/number.

function RequestsOverlayModal({ projectId, projectName, onClose, onGenerated }: {
  projectId: number;
  projectName: string;
  onClose: () => void;
  onGenerated: () => void;
}) {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [suggestionsByMaterial, setSuggestionsByMaterial] = useState<Record<number, SuggestedSupplier[]>>({});
  const [assignments, setAssignments] = useState<Record<number, string>>({});
  const [expectedDate, setExpectedDate] = useState("");
  const [generating, setGenerating] = useState(false);
  const [poNumbers, setPoNumbers] = useState<Record<number, string>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get<ApiMaterialRequest[]>(`/material-requests/project/${projectId}`);
        const mapped = data.map(mapRequestRow);
        setRows(mapped);

        const uniqueMaterialIds = [...new Set(mapped.map(r => r.materialId))];
        const entries = await Promise.all(
          uniqueMaterialIds.map(async id => {
            const res = await api.get<ApiSuggestedSupplier[]>(`/material-requests/suggested-suppliers/${id}`);
            return [id, res.data] as const;
          })
        );
        setSuggestionsByMaterial(Object.fromEntries(entries));
      } catch {
        toast.error("Failed to load material requests.");
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  const generated = Object.keys(poNumbers).length > 0;
  const allAssigned = rows.length > 0 && rows.every(r => assignments[r.id]?.trim());

  async function handleGenerate() {
    if (!expectedDate) { toast.error("Pick an expected delivery date."); return; }
    if (!allAssigned) { toast.error("Choose a supplier for every material."); return; }
    setGenerating(true);
    try {
      const { data } = await api.post<ApiGeneratedResult>("/material-requests/generate-pos", {
        projectId,
        expectedDate,
        assignments: rows.map(r => ({ requestId: r.id, supplierName: assignments[r.id] })),
      });
      setPoNumbers(data.requestPoNumbers);
      toast.success("Purchase order(s) generated.");
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message ?? "Failed to generate purchase orders.");
    } finally {
      setGenerating(false);
    }
  }

  function handleGoToPurchaseOrders() {
    onGenerated();
    onClose();
  }

  const fieldStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "7px 9px", borderRadius: 7,
    border: "1px solid #e5e7eb", fontSize: "0.82rem", outline: "none", color: "#111827",
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: 640, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.5rem 1.5rem 1rem", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ClipboardList style={{ width: 18, height: 18, color: "#f97316" }} />
            </div>
            <div>
              <h2 style={{ fontWeight: 800, fontSize: "1.05rem", margin: 0 }}>{projectName}</h2>
              <p style={{ fontSize: "0.72rem", color: "#9ca3af", margin: 0 }}>Requested materials</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        <div style={{ padding: "0 1.5rem", flex: 1, overflowY: "auto" }}>
          {loading ? (
            <p style={{ fontSize: "0.85rem", color: "#9ca3af", textAlign: "center", padding: "2rem 0" }}>Loading requested materials…</p>
          ) : (
            <>
              <p style={{ fontSize: "0.72rem", color: "#9ca3af", marginBottom: "0.75rem" }}>
                Supplier suggestions are ranked by past orders of that exact material first, then overall rating — or type a new supplier name.
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                    {["MATERIAL", "UNIT", "QTY", "SUPPLIER", "PO #"].map(h => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: "0.62rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const suggestions = suggestionsByMaterial[r.materialId] ?? [];
                    const poNumber = poNumbers[r.id];
                    return (
                      <tr key={r.id} style={{ borderBottom: i < rows.length - 1 ? "1px solid #f9fafb" : "none" }}>
                        <td style={{ padding: "8px", fontSize: "0.82rem", fontWeight: 600, color: "#111827" }}>{r.materialName}</td>
                        <td style={{ padding: "8px", fontSize: "0.78rem", color: "#6b7280" }}>{r.unit}</td>
                        <td style={{ padding: "8px", fontSize: "0.78rem", color: "#6b7280" }}>{r.quantity}</td>
                        <td style={{ padding: "8px", minWidth: 180 }}>
                          {poNumber ? (
                            <span style={{ fontSize: "0.8rem", color: "#111827" }}>{assignments[r.id]}</span>
                          ) : (
                            <>
                              <input
                                list={`suppliers-for-material-${r.materialId}`}
                                value={assignments[r.id] ?? ""}
                                onChange={e => setAssignments(prev => ({ ...prev, [r.id]: e.target.value }))}
                                placeholder="Pick or type a supplier"
                                style={fieldStyle}
                              />
                              <datalist id={`suppliers-for-material-${r.materialId}`}>
                                {suggestions.map(s => <option key={s.id} value={s.name} />)}
                              </datalist>
                            </>
                          )}
                        </td>
                        <td style={{ padding: "8px", fontSize: "0.8rem", fontWeight: 700, color: "#f97316", whiteSpace: "nowrap" }}>{poNumber ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div style={{ padding: "1rem 1.5rem 1.5rem", flexShrink: 0, borderTop: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.68rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>Expected Delivery</label>
            <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} disabled={generated}
              style={{ ...fieldStyle, width: 170, opacity: generated ? 0.6 : 1 }} />
          </div>
          {generated ? (
            <button onClick={handleGoToPurchaseOrders} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
              Purchase Order <ArrowRight style={{ width: 14, height: 14 }} />
            </button>
          ) : (
            <button onClick={handleGenerate} disabled={generating || loading || rows.length === 0} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 8, border: "none",
              background: "#f97316", color: "#fff", fontWeight: 700, fontSize: "0.85rem",
              cursor: (generating || loading || rows.length === 0) ? "not-allowed" : "pointer",
              opacity: (generating || loading || rows.length === 0) ? 0.7 : 1,
            }}>
              {generating ? "Generating…" : "Generate P.O. Number"}
            </button>
          )}
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

// ── Delivery Batch Overlay ───────────────────────────────────────────────────
// Opened from the status dropdown/pill once a PO is Approved or already
// DeliveryInProgress. Each "Save" persists the currently-picked photos as one
// batch (a partial shipment) and the overlay stays open so another batch can
// be added later, whenever the next one arrives. "Delivery Complete" saves
// any photos still pending, then finalizes — it never requires a rating,
// that's a separate step only WarehousePersonnel can do (see RateSupplierModal).
function DeliveryBatchModal({ po, onClose, onSaveBatch, onComplete }: {
  po: PO;
  onClose: () => void;
  onSaveBatch: (photos: File[]) => Promise<void>;
  onComplete: () => Promise<void>;
}) {
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);

  const busy = saving || completing;
  const hasAnyPhoto = po.deliveryBatches.some(b => b.photoUrls.length > 0) || photos.length > 0;

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

  function clearPending() {
    setPhotos(prev => { prev.forEach(p => URL.revokeObjectURL(p.previewUrl)); return []; });
  }

  function handleClose() {
    clearPending();
    onClose();
  }

  async function handleSave() {
    if (photos.length === 0) { toast.error("Add at least one photo before saving this batch."); return; }
    setSaving(true);
    try {
      await onSaveBatch(photos.map(p => p.file));
      clearPending();
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete() {
    setCompleting(true);
    try {
      if (photos.length > 0) {
        await onSaveBatch(photos.map(p => p.file));
        clearPending();
      }
      await onComplete();
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div onClick={handleClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Camera style={{ width: 18, height: 18, color: "#f97316" }} />
            </div>
            <div>
              <h2 style={{ fontWeight: 800, fontSize: "1.05rem", margin: 0 }}>Proof of Delivery</h2>
              <p style={{ fontSize: "0.72rem", color: "#9ca3af", margin: 0 }}>{po.number} · {po.supplier}</p>
            </div>
          </div>
          <button onClick={handleClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        <p style={{ fontSize: "0.82rem", color: "#374151", marginTop: 0, marginBottom: "1.1rem" }}>
          Upload photos for each batch as it arrives and click Save — you can come back and add another batch later. Once everything has arrived, click Delivery Complete.
        </p>

        {po.deliveryBatches.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "1.1rem" }}>
            {po.deliveryBatches.map(b => (
              <div key={b.id} style={{ border: "1px solid #f3f4f6", borderRadius: 10, padding: "0.6rem 0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#111827" }}>Batch {b.batchNumber}</span>
                  <span style={{ fontSize: "0.66rem", color: "#9ca3af" }}>{b.uploadedByName} · {toDisplayDate(b.createdAt)}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                  {b.photoUrls.map((url, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={url} alt={`Batch ${b.batchNumber} photo ${i + 1}`} style={{ width: "100%", height: 56, borderRadius: 6, objectFit: "cover" }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <p style={{ fontWeight: 700, fontSize: "0.85rem", color: "#111827", margin: 0 }}>
            Batch {po.deliveryBatches.length + 1}
          </p>

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
            border: "2px dashed #e5e7eb", borderRadius: 12, padding: "1.25rem 1rem", cursor: "pointer", background: "#f9fafb",
          }}>
            <Upload style={{ width: 22, height: 22, color: "#9ca3af" }} />
            <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>{photos.length > 0 ? "Add more photos" : "Click to upload photos"}</span>
            <input type="file" accept="image/*" multiple onChange={handlePhotoSelected} style={{ display: "none" }} />
          </label>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
          <button onClick={handleSave} disabled={photos.length === 0 || busy} style={{
            flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff",
            color: "#374151", fontWeight: 700, fontSize: "0.875rem",
            cursor: photos.length > 0 && !busy ? "pointer" : "not-allowed", opacity: photos.length > 0 ? 1 : 0.6,
          }}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={handleComplete} disabled={!hasAnyPhoto || busy} style={{
            flex: 1, padding: "10px", borderRadius: 8, border: "none",
            background: hasAnyPhoto ? "#f97316" : "#fbd0a6", color: "#fff", fontWeight: 700, fontSize: "0.875rem",
            cursor: hasAnyPhoto && !busy ? "pointer" : "not-allowed",
          }}>
            {completing ? "Completing…" : "Delivery Complete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rate Supplier (WarehousePersonnel only) ─────────────────────────────────
// Independent of however many delivery batches it took to get here — proof
// of delivery already lives on the PO's batches, so this is rating-only.
function RateSupplierModal({ po, supplier, onClose, onSubmit }: {
  po: PO;
  supplier: Supplier | undefined;
  onClose: () => void;
  onSubmit: (data: RatingSubmission) => Promise<void>;
}) {
  const [ratings, setRatings] = useState<CategoryRatings>({ price: 0, delivery: 0, quality: 0, accuracy: 0, responsiveness: 0 });
  const [onTime, setOnTime] = useState<boolean | null>(null);
  const [actualLeadDays, setActualLeadDays] = useState("");
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function setCategoryRating(key: keyof CategoryRatings, value: number) {
    setRatings(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    const allRated = RATING_CATEGORIES.every(c => ratings[c.key] > 0);
    if (!allRated || onTime === null || !actualLeadDays.trim()) {
      toast.error("Please complete the delivery evaluation.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ ratings, onTime, actualLeadDays: Number(actualLeadDays), comments: comments.trim() });
    } finally {
      setSubmitting(false);
    }
  }

  const lead = committedLeadDays(supplier?.lead ?? "5");

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 460, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CheckCircle2 style={{ width: 18, height: 18, color: "#f97316" }} />
            </div>
            <div>
              <h2 style={{ fontWeight: 800, fontSize: "1.05rem", margin: 0 }}>Rate the Supplier</h2>
              <p style={{ fontSize: "0.72rem", color: "#9ca3af", margin: 0 }}>{po.number} · {po.supplier}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

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

        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
          <button onClick={onClose} disabled={submitting} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontWeight: 700, fontSize: "0.875rem", cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}>
            {submitting ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProcurementPage() {
  const [tab,      setTab]      = useState<"po" | "requests" | "suppliers">("po");
  const [orders,   setOrders]   = useState<PO[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading,  setLoading]  = useState(true);

  const [viewingPOId, setViewingPOId] = useState<number | null>(null);
  const [contactSupplierId, setContactSupplierId] = useState<number | null>(null);
  const [historySupplierId, setHistorySupplierId] = useState<number | null>(null);
  const [ratingSupplierId, setRatingSupplierId] = useState<number | null>(null);
  const [deliveryPOId, setDeliveryPOId] = useState<number | null>(null);
  const [ratingPOId, setRatingPOId] = useState<number | null>(null);
  const [requestsProjects, setRequestsProjects] = useState<ProjectWithRequests[]>([]);
  const [openRequestsProjectId, setOpenRequestsProjectId] = useState<number | null>(null);

  const viewingPO       = orders.find(o => o.id === viewingPOId) ?? null;
  const contactSupplier = suppliers.find(s => s.id === contactSupplierId) ?? null;
  const historySupplier = suppliers.find(s => s.id === historySupplierId) ?? null;
  const ratingSupplier  = suppliers.find(s => s.id === ratingSupplierId) ?? null;
  const deliveryPO = orders.find(o => o.id === deliveryPOId) ?? null;
  const ratingPO   = orders.find(o => o.id === ratingPOId) ?? null;
  const openRequestsProject = requestsProjects.find(p => p.projectId === openRequestsProjectId) ?? null;
  const totalPendingRequests = requestsProjects.reduce((sum, p) => sum + p.pendingCount, 0);

  const { user } = useAuthStore();
  const role = user?.role ?? "SiteEngineer";
  // Admin/ProjectManager/ProcurementOfficer manage the PO lifecycle up through
  // Approved. WarehousePersonnel is the only role that ever touches delivery —
  // they're the ones physically receiving the goods, so they're the only ones
  // who can click Delivered (save proof-of-delivery batches, then complete it)
  // and the only ones who can rate the supplier afterward. SiteEngineer is
  // view-only. The backend enforces both restrictions independently of this.
  const canManagePOs = role === "Admin" || role === "ProjectManager" || role === "ProcurementOfficer";
  const canMarkDelivered = role === "WarehousePersonnel";
  const canRate = role === "WarehousePersonnel";
  const canEditContact = role === "ProcurementOfficer" || role === "Admin";

  async function refetch() {
    const [ordersRes, suppliersRes] = await Promise.all([
      api.get<ApiPO[]>("/purchase-orders"),
      api.get<ApiSupplier[]>("/suppliers"),
    ]);
    setOrders(ordersRes.data.map(mapPO));
    setSuppliers(suppliersRes.data.map(mapSupplier));

    // Isolated from the Promise.all above on purpose: a 403 here (roles that
    // don't manage POs) must never take down orders/suppliers loading too,
    // and the tab itself is already hidden for those roles regardless.
    try {
      const requestsRes = await api.get<ApiProjectWithRequests[]>("/material-requests/projects-with-pending");
      setRequestsProjects(requestsRes.data);
    } catch {
      setRequestsProjects([]);
    }
  }

  useEffect(() => {
    refetch()
      .catch(() => toast.error("Failed to load procurement data."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Progressing delivery (in-progress or delivered) always opens the batch
  // overlay — neither status can be set by hand. Every other transition
  // applies immediately.
  async function handleStatusSelect(po: PO, status: POStatus) {
    if ((status === "DELIVERY_IN_PROGRESS" || status === "DELIVERED") && po.status !== "DELIVERED") {
      setDeliveryPOId(po.id);
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

  async function handleSaveBatch(po: PO, photos: File[]) {
    const form = new FormData();
    photos.forEach(f => form.append("Photos", f));
    try {
      await api.post(`/purchase-orders/${po.id}/delivery-batches`, form, { headers: { "Content-Type": undefined } });
      await refetch();
      toast.success("Batch saved.");
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message ?? "Failed to save this batch.");
      throw err;
    }
  }

  async function handleCompleteDelivery(po: PO) {
    try {
      await api.post(`/purchase-orders/${po.id}/complete-delivery`, {});
      await refetch();
      setDeliveryPOId(null);
      toast.success(`${po.number} marked delivered.`);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message ?? "Failed to complete delivery.");
    }
  }

  async function handleSubmitRating(po: PO, submission: RatingSubmission) {
    try {
      await api.post(`/purchase-orders/${po.id}/rate`, {
        PriceRating: submission.ratings.price,
        DeliveryRating: submission.ratings.delivery,
        QualityRating: submission.ratings.quality,
        AccuracyRating: submission.ratings.accuracy,
        ResponsivenessRating: submission.ratings.responsiveness,
        OnTime: submission.onTime,
        ActualLeadDays: submission.actualLeadDays,
        Comments: submission.comments || undefined,
      });
      await refetch();
      setRatingPOId(null);
      toast.success(`${po.supplier} rated.`);
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
      {deliveryPO && (
        <DeliveryBatchModal
          po={deliveryPO}
          onClose={() => setDeliveryPOId(null)}
          onSaveBatch={photos => handleSaveBatch(deliveryPO, photos)}
          onComplete={() => handleCompleteDelivery(deliveryPO)}
        />
      )}
      {ratingPO && (
        <RateSupplierModal
          po={ratingPO}
          supplier={suppliers.find(s => s.id === ratingPO.supplierId)}
          onClose={() => setRatingPOId(null)}
          onSubmit={submission => handleSubmitRating(ratingPO, submission)}
        />
      )}
      {openRequestsProject && (
        <RequestsOverlayModal
          projectId={openRequestsProject.projectId}
          projectName={openRequestsProject.projectName}
          onClose={() => setOpenRequestsProjectId(null)}
          onGenerated={() => { refetch(); setTab("po"); }}
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
          {([
            { id: "po", label: "Purchase Orders" },
            ...(canManagePOs ? [{ id: "requests", label: "Requests" }] as const : []),
            { id: "suppliers", label: "Suppliers" },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              position: "relative",
              padding: "6px 20px", borderRadius: 6, fontSize: "0.875rem",
              fontWeight: tab === t.id ? 600 : 400, border: "none", cursor: "pointer",
              background: tab === t.id ? "#fff" : "transparent",
              color: tab === t.id ? "#111827" : "#6b7280",
              boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              transition: "all 0.15s",
            }}>
              {t.label}
              {t.id === "requests" && totalPendingRequests > 0 && (
                <span style={{
                  position: "absolute", top: -6, right: -6,
                  background: "#ef4444", color: "#fff", borderRadius: 999,
                  minWidth: 18, height: 18, padding: "0 4px",
                  fontSize: "0.65rem", fontWeight: 700, lineHeight: 1,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 0 0 2px #e5e7eb",
                }}>
                  {totalPendingRequests}
                </span>
              )}
            </button>
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
                        {status === "DELIVERY_IN_PROGRESS" ? (
                          // Neither role picks this from a dropdown twice — it's already
                          // selected, so re-opening means clicking the pill to add another
                          // batch or complete the delivery.
                          canMarkDelivered ? (
                            <button onClick={() => setDeliveryPOId(po.id)} title="Add another batch or complete delivery" style={{
                              fontSize: "0.7rem", fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                              background: st.bg, color: st.color, border: "none", cursor: "pointer", whiteSpace: "nowrap",
                            }}>
                              · {statusLabel(status)}
                            </button>
                          ) : (
                            <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: st.bg, color: st.color, whiteSpace: "nowrap" }}>
                              · {statusLabel(status)}
                            </span>
                          )
                        ) : status === "DELIVERED" ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: st.bg, color: st.color, whiteSpace: "nowrap" }}>
                              · DELIVERED
                            </span>
                            {canRate && !po.hasEvaluation && (
                              <button onClick={() => setRatingPOId(po.id)} title="Rate the supplier" style={{
                                fontSize: "0.65rem", fontWeight: 700, padding: "3px 8px", borderRadius: 999,
                                background: "#fff7ed", color: "#f97316", border: "1px solid #fed7aa", cursor: "pointer",
                              }}>
                                Rate
                              </button>
                            )}
                          </div>
                        ) : canManagePOs ? (
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
                            {PO_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                          </select>
                        ) : canMarkDelivered ? (
                          // Warehouse personnel: the only action available is marking a PO
                          // Delivered, which opens the proof-of-delivery overlay rather than
                          // setting the status directly — Pending/Approved are never
                          // selectable, and the backend rejects them too if attempted directly.
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
                            <option value={status} disabled hidden>{statusLabel(status)}</option>
                            <option value="DELIVERED">DELIVERED</option>
                          </select>
                        ) : (
                          <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: st.bg, color: st.color, whiteSpace: "nowrap" }}>
                            · {statusLabel(status)}
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
        {/* Tab: Requests — projects with pending material requests only;      */}
        {/* a project with nothing outstanding simply doesn't appear.          */}
        {/* ────────────────────────────────────────────────────────────────── */}
        {tab === "requests" && (
          <div style={{ background: "#fff", borderRadius: 12, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.25rem" }}>
              <ClipboardList style={{ width: 16, height: 16, color: "#f97316" }} />
              <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Material Requests</span>
            </div>

            {requestsProjects.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "#9ca3af", textAlign: "center", padding: "2rem 0" }}>
                No projects have pending material requests right now.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {requestsProjects.map(p => (
                  <button
                    key={p.projectId}
                    onClick={() => setOpenRequestsProjectId(p.projectId)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      width: "100%", padding: "14px 16px", borderRadius: 10, border: "none",
                      background: "#f9fafb", cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <div>
                      <p style={{ fontWeight: 700, fontSize: "0.88rem", color: "#111827" }}>{p.projectName}</p>
                      <p style={{ fontSize: "0.72rem", color: "#9ca3af", marginTop: 2 }}>
                        {p.pendingCount} material{p.pendingCount !== 1 ? "s" : ""} requested
                      </p>
                    </div>
                    <ChevronRight style={{ width: 16, height: 16, color: "#9ca3af" }} />
                  </button>
                ))}
              </div>
            )}
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
