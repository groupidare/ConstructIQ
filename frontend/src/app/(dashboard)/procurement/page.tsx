"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import Header from "@/components/layout/Header";
import {
  Clock, CheckCircle2, PackageCheck, AlertTriangle, Truck,
  ShoppingCart, Download, Plus, Eye,
  Send, History, X, Mail, Phone, Pencil, Camera, Upload, Check,
  Wind, Droplets, CloudRain, ClipboardList, ChevronRight, ArrowRight,
  Search, ArrowUpDown, Trash2, Tag,
} from "lucide-react";
import { useWeatherStore } from "@/store/weatherStore";
import { useAuthStore } from "@/store/authStore";
import { RISK_VISUALS, RISK_VISUALS_DARK } from "@/lib/weather";
import { computeWeatherAtRiskOrders } from "@/lib/deliveryRisk";
import api from "@/lib/api";
import { resolveUploadUrl } from "@/lib/avatar";
import { formatCurrency, formatDate } from "@/lib/utils";

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
  // Present only when the API returned a price (Admin/ProcurementOfficer).
  unitPrice?: number;
  unit?: string;
  lineTotal?: number;
}

interface DeliveryBatch {
  id: number;
  batchNumber: number;
  uploadedByName: string;
  createdAt: string;
  // One Delivery Receipt (null only for a pre-existing batch saved before
  // this split existed) and one-or-more Proof of Delivery photos.
  drFileUrl: string | null;
  podPhotoUrls: string[];
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
  // The master PO document — uploaded once with the first delivery batch,
  // reused by every later one. Null until the first batch is saved.
  poFileUrl: string | null;
  // Made before the project was in ConstructIQ (numbered IMP-001…), with
  // the paper PO's own number.
  isImported: boolean;
  originalPoNumber: string | null;
}

// "Imported · PO 2024-118" under an imported PO's number.
function ImportedTag({ po }: { po: PO }) {
  if (!po.isImported) return null;
  return (
    <span style={{ display: "block", fontSize: "0.65rem", color: "#6b7280", fontWeight: 500, marginTop: 2 }}>
      Imported{po.originalPoNumber ? ` · original PO ${po.originalPoNumber}` : ""}
    </span>
  );
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

interface ApiPOMaterial { name: string; quantity: number; unit: string; unitPrice?: number | null; }
interface ApiDeliveryBatch {
  id: number; batchNumber: number; uploadedByName: string; createdAt: string;
  drFileUrl: string | null; podPhotoUrls: string[];
}
interface ApiPO {
  id: number; number: string;
  projectId: number; projectName: string;
  supplierId: number; supplierName: string;
  status: string; expectedDate: string;
  materials: ApiPOMaterial[];
  deliveryBatches: ApiDeliveryBatch[];
  hasEvaluation: boolean;
  poFileUrl: string | null;
  isImported?: boolean;
  originalPoNumber?: string | null;
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
    materials: a.materials.map(m => ({
      name: m.name, qty: `${Number(m.quantity)} ${m.unit}`,
      ...(m.unitPrice != null
        ? { unitPrice: Number(m.unitPrice), unit: m.unit, lineTotal: Number(m.quantity) * Number(m.unitPrice) }
        : {}),
    })),
    deliveryBatches: a.deliveryBatches.map(b => ({
      id: b.id, batchNumber: b.batchNumber, uploadedByName: b.uploadedByName,
      createdAt: b.createdAt, drFileUrl: b.drFileUrl, podPhotoUrls: b.podPhotoUrls,
    })),
    hasEvaluation: a.hasEvaluation,
    poFileUrl: a.poFileUrl,
    isImported: !!a.isImported,
    originalPoNumber: a.originalPoNumber ?? null,
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
  // Of pendingCount, saved with "Save Request" and waiting for a supplier choice.
  forApprovalCount?: number;
}

// Up to three suppliers quoted per material, as on the client's Material
// Request Form — one is chosen for the PO.
const MAX_QUOTES = 3;

interface QuoteDraft {
  supplierName: string;
  // Kept as text so the field can be cleared.
  price: string;
  // True while the price is the supplier's last recorded price, untouched.
  fromHistory: boolean;
}

interface RequestRow {
  id: number;
  materialId: number;
  materialName: string;
  specification: string;
  quantity: number;
  // Requested quantity as typed — editable on the form.
  qty: string;
  unit: string;
  requestedByName: string;
  createdAt: string;
  lastUnitPrice: number | null;
  lastUnitPriceSupplier: string | null;
  isAdditional: boolean;
  remarks: string;
  quotes: QuoteDraft[];
  // Slot index chosen for the PO, or null to use the lowest-priced quote.
  chosen: number | null;
  // Sent from a project's cost breakdown for a price only — never a PO.
  // Leaves this form once a price is saved for it.
  isPriceInquiry: boolean;
  // Saved with "Save Request": its quotes are in, and it waits here as
  // "For Approval" until one supplier is chosen and its PO generated.
  forApproval: boolean;
}

interface SuggestedSupplier {
  id: number;
  name: string;
  rating: number;
  onTimePct: number;
  deliveries: number;
  hasHistoryWithMaterial: boolean;
  lastUnitPrice: number | null;
  lastPriceDate: string | null;
}

interface ApiProjectWithRequests { projectId: number; projectName: string; pendingCount: number; forApprovalCount?: number; }
interface ApiQuote { slot: number; supplierName: string; unitPrice: number | null; priceFromHistory: boolean; isSelected: boolean; }
interface ApiMaterialRequest {
  id: number; materialId: number; materialName: string; specification?: string;
  quantity: number; unit: string; requestedByName: string; createdAt: string;
  lastUnitPrice?: number | null; lastUnitPriceSupplier?: string | null;
  remarks?: string | null; quotes?: ApiQuote[]; isAdditional?: boolean;
  isPriceInquiry?: boolean;
  forApproval?: boolean;
}
interface ApiSuggestedSupplier {
  id: number; name: string; rating: number; onTimePct: number; deliveries: number; hasHistoryWithMaterial: boolean;
  lastUnitPrice?: number | null; lastPriceDate?: string | null;
}
interface ApiGeneratedResult {
  purchaseOrders: unknown[];
  requestPoNumbers: Record<number, string>;
}

const emptyQuote = (): QuoteDraft => ({ supplierName: "", price: "", fromHistory: false });

function mapRequestRow(a: ApiMaterialRequest): RequestRow {
  const quotes = Array.from({ length: MAX_QUOTES }, emptyQuote);
  let chosen: number | null = null;
  for (const q of a.quotes ?? []) {
    const i = q.slot - 1;
    if (i < 0 || i >= MAX_QUOTES) continue;
    quotes[i] = { supplierName: q.supplierName, price: q.unitPrice != null ? String(q.unitPrice) : "", fromHistory: q.priceFromHistory };
    if (q.isSelected) chosen = i;
  }
  return {
    id: a.id, materialId: a.materialId, materialName: a.materialName, specification: a.specification ?? "",
    quantity: a.quantity, qty: String(a.quantity), unit: a.unit, requestedByName: a.requestedByName, createdAt: a.createdAt,
    lastUnitPrice: a.lastUnitPrice ?? null, lastUnitPriceSupplier: a.lastUnitPriceSupplier ?? null,
    isAdditional: a.isAdditional ?? false, remarks: a.remarks ?? "", quotes,
    isPriceInquiry: !!a.isPriceInquiry,
    forApproval: !!a.forApproval,
    // On the Requests tab a supplier is chosen only at the review, never
    // carried in from typing; a price check keeps its "Use this price" pick.
    chosen: a.forApproval || a.isPriceInquiry ? chosen : null,
  };
}

function quotePrice(q: QuoteDraft): number | null {
  const text = q.price.trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

// The quote the PO is raised against: the one picked, else the lowest
// priced named quote, else the first named one. -1 when none is named.
function selectedSlot(row: RequestRow): number {
  const named = row.quotes.map((q, i) => ({ q, i })).filter(x => x.q.supplierName.trim());
  if (row.chosen != null && row.quotes[row.chosen]?.supplierName.trim()) return row.chosen;
  const priced = named.filter(x => quotePrice(x.q) != null);
  if (priced.length > 0) return priced.reduce((a, b) => (quotePrice(b.q)! < quotePrice(a.q)! ? b : a)).i;
  return named.length > 0 ? named[0].i : -1;
}

function lowestSlot(row: RequestRow): number {
  const priced = row.quotes.map((q, i) => ({ q, i })).filter(x => x.q.supplierName.trim() && quotePrice(x.q) != null);
  if (priced.length < 2) return -1;
  return priced.reduce((a, b) => (quotePrice(b.q)! < quotePrice(a.q)! ? b : a)).i;
}

// The quotes as the API takes them: named ones only, slot = column 1–3.
function apiQuotes(row: RequestRow, includeSelection: boolean) {
  const sel = selectedSlot(row);
  return row.quotes
    .map((q, i) => ({ q, i }))
    .filter(x => x.q.supplierName.trim())
    .map(x => ({
      slot: x.i + 1,
      supplierName: x.q.supplierName.trim(),
      unitPrice: quotePrice(x.q),
      priceFromHistory: x.q.fromHistory,
      isSelected: includeSelection && x.i === sel,
    }));
}

function rowQty(row: RequestRow): number | null {
  const n = Number(row.qty.trim());
  return row.qty.trim() && Number.isFinite(n) && n > 0 ? n : null;
}

// Null when the row's quotes can be saved / used.
function quoteProblem(row: RequestRow): string | null {
  if (rowQty(row) == null) return `${row.materialName}: quantity must be greater than zero.`;
  const named = row.quotes.filter(q => q.supplierName.trim());
  const names = named.map(q => q.supplierName.trim().toLowerCase());
  if (new Set(names).size !== names.length) return `${row.materialName}: the same supplier is listed twice.`;
  for (const q of named) {
    if (q.price.trim() && (quotePrice(q) == null || quotePrice(q)! < 0))
      return `${row.materialName}: prices must be zero or more.`;
  }
  return null;
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

// ── Material Request Form (Requests Overlay) ─────────────────────────────────
// Follows the client's paper Material Request Form: numbered particulars with
// size, unit and qty, up to three suppliers quoted per material, and remarks.
// Picking a supplier fills in its last price for that material and unit (from
// past POs), which stays editable. The chosen quote per material — the
// lowest price unless another is picked — becomes the PO; materials sharing a
// supplier land on one PO with the next sequential number.
// The Requests tab works in two steps: Procurement enters up to three
// suppliers and prices per material and clicks "Save Request" (no supplier
// is highlighted or recommended yet); each material with a priced supplier
// then shows "For Approval". At the review the purchasing head picks exactly
// one supplier per material, and only then can "Generate P.O. Number" turn
// them into purchase orders, which move to the Purchase Orders tab.
// With priceOnly it's the Quotations tab's form: the price checks sent from a
// project's cost breakdown — quotes are saved, no PO is ever made.

function RequestsOverlayModal({ projectId, projectName, priceOnly, onClose, onChanged, onGenerated }: {
  projectId: number;
  projectName: string;
  priceOnly: boolean;
  onClose: () => void;
  // A request was deleted — the tab's counts need refreshing.
  onChanged: () => void;
  onGenerated: () => void;
}) {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Keyed by `${materialId}|${unit}` — a supplier's last price is per unit.
  const [suggestions, setSuggestions] = useState<Record<string, SuggestedSupplier[]>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);

  const suggestionKey = (r: { materialId: number; unit: string }) => `${r.materialId}|${r.unit}`;
  // An element id can't hold spaces ("sq m") — keep it to safe characters.
  const datalistId = (key: string) => `mrf-suppliers-${key.replace(/[^A-Za-z0-9]+/g, "-")}`;

  async function loadRows() {
      setLoading(true);
      try {
        const { data } = await api.get<ApiMaterialRequest[]>(`/material-requests/project/${projectId}`, { params: { priceInquiry: priceOnly } });
        const mapped = data.map(mapRequestRow);
        setRows(mapped);

        const keys = [...new Map(mapped.map(r => [suggestionKey(r), r])).values()];
        const entries = await Promise.all(keys.map(async r => {
          const res = await api.get<ApiSuggestedSupplier[]>(`/material-requests/suggested-suppliers/${r.materialId}`, { params: { unit: r.unit } });
          return [suggestionKey(r), res.data.map(s => ({ ...s, lastUnitPrice: s.lastUnitPrice ?? null, lastPriceDate: s.lastPriceDate ?? null }))] as const;
        }));
        setSuggestions(Object.fromEntries(entries));
      } catch {
        toast.error("Failed to load material requests.");
      } finally {
        setLoading(false);
      }
  }

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, priceOnly]);

  function updateRow(id: number, change: (r: RequestRow) => RequestRow) {
    setRows(prev => prev.map(r => (r.id === id ? change(r) : r)));
  }

  function historyFor(row: RequestRow, supplierName: string): SuggestedSupplier | undefined {
    const name = supplierName.trim().toLowerCase();
    return name ? (suggestions[suggestionKey(row)] ?? []).find(s => s.name.toLowerCase() === name) : undefined;
  }

  function setSupplier(row: RequestRow, slot: number, supplierName: string) {
    updateRow(row.id, r => {
      const quotes = [...r.quotes];
      const current = quotes[slot];
      const past = historyFor(r, supplierName);
      // Auto-fill only an empty or still-auto-filled price — never one typed in.
      const canFill = !current.price.trim() || current.fromHistory;
      if (canFill && past?.lastUnitPrice != null) {
        quotes[slot] = { supplierName, price: String(past.lastUnitPrice), fromHistory: true };
      } else if (current.fromHistory) {
        quotes[slot] = { supplierName, price: "", fromHistory: false };
      } else {
        quotes[slot] = { ...current, supplierName };
      }
      return { ...r, quotes };
    });
  }

  function setPrice(row: RequestRow, slot: number, price: string) {
    updateRow(row.id, r => {
      const quotes = [...r.quotes];
      quotes[slot] = { ...quotes[slot], price, fromHistory: false };
      return { ...r, quotes };
    });
  }

  // Rows still being filled in, and rows saved and waiting for the review
  // (only on the Requests tab — price checks never become a PO).
  const isReview = (r: RequestRow) => !priceOnly && r.forApproval;
  const entryRows = rows.filter(r => !isReview(r));
  const reviewRows = rows.filter(isReview);
  const allChosen = reviewRows.length > 0 && reviewRows.every(r => r.chosen != null && !!r.quotes[r.chosen]?.supplierName.trim());

  function firstProblem(forGenerate: boolean): string | null {
    for (const r of forGenerate ? reviewRows : entryRows) {
      const problem = quoteProblem(r);
      if (problem) return problem;
      if (forGenerate && (r.chosen == null || !r.quotes[r.chosen]?.supplierName.trim())) return `Choose the supplier to buy ${r.materialName} from.`;
    }
    return null;
  }

  async function handleDelete(row: RequestRow) {
    setDeletingId(row.id);
    try {
      await api.delete(`/material-requests/${row.id}`);
      setRows(prev => prev.filter(r => r.id !== row.id));
      setConfirmDeleteId(null);
      onChanged();
      toast.success(`${row.materialName} request deleted.`);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message ?? "Failed to delete the request.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSave() {
    const problem = firstProblem(false);
    if (problem) { toast.error(problem); return; }
    setSaving(true);
    try {
      await api.put(`/material-requests/project/${projectId}/quotes`, {
        submit: !priceOnly,
        requests: entryRows.map(r => ({ requestId: r.id, quantity: rowQty(r), remarks: r.remarks, quotes: apiQuotes(r, priceOnly && r.chosen != null) })),
      });
      if (!priceOnly) {
        const ready = entryRows.filter(r => r.quotes.some(q => q.supplierName.trim() && quotePrice(q) != null)).length;
        const notYet = entryRows.length - ready;
        onChanged();
        await loadRows();
        toast.success(ready > 0
          ? `Request saved — ${ready} material${ready === 1 ? " is" : "s are"} now For Approval.`
          : "Request saved.");
        if (notYet > 0) toast(`${notYet} material${notYet === 1 ? " still needs" : "s still need"} a supplier with a price before ${notYet === 1 ? "it goes" : "they go"} for approval.`);
        return;
      }
      const answered = rows.filter(r => r.isPriceInquiry && r.quotes.some(q => q.supplierName.trim() && quotePrice(q) != null));
      if (answered.length > 0) {
        // Priced price checks are done: off this form, onto the cost estimate.
        setRows(prev => prev.filter(r => !answered.some(a => a.id === r.id)));
        onChanged();
        toast.success(`Quotations saved. ${answered.length} price check${answered.length === 1 ? "" : "s"} done — now used in the project's cost estimate.`);
      } else {
        toast.success("Quotations saved.");
      }
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message ?? (priceOnly ? "Failed to save quotations." : "Failed to save the request."));
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerate() {
    const problem = firstProblem(true);
    if (problem) { toast.error(problem); return; }
    setGenerating(true);
    try {
      const { data } = await api.post<ApiGeneratedResult>("/material-requests/generate-pos", {
        projectId,
        assignments: reviewRows.map(r => {
          const sel = r.quotes[r.chosen!];
          return {
            requestId: r.id,
            supplierName: sel.supplierName.trim(),
            unitPrice: quotePrice(sel),
            quantity: rowQty(r),
            remarks: r.remarks,
            quotes: apiQuotes(r, true),
          };
        }),
      });
      const numbers = [...new Set(Object.values(data.requestPoNumbers))];
      toast.success(`${numbers.length === 1 ? "Purchase order" : "Purchase orders"} ${numbers.join(", ")} generated — see the Purchase Orders tab.`);
      onGenerated();
      onClose();
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message ?? "Failed to generate purchase orders.");
    } finally {
      setGenerating(false);
    }
  }

  const fieldStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6,
    border: "1px solid #e5e7eb", fontSize: "0.78rem", outline: "none", color: "#111827", background: "#fff",
  };
  const th: React.CSSProperties = {
    padding: "7px 8px", textAlign: "left", fontSize: "0.6rem", fontWeight: 700, color: "#6b7280",
    letterSpacing: "0.05em", whiteSpace: "nowrap", borderBottom: "1px solid #e5e7eb", background: "#f9fafb",
  };
  const td: React.CSSProperties = { padding: "8px", fontSize: "0.8rem", color: "#374151", verticalAlign: "top", borderBottom: "1px solid #f3f4f6" };
  const busy = saving || generating || loading;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: 1180, maxWidth: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1.25rem 1.5rem 0.75rem", flexShrink: 0, gap: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <ClipboardList style={{ width: 18, height: 18, color: "#f97316" }} />
            </div>
            <div>
              <h2 style={{ fontWeight: 800, fontSize: "1.05rem", margin: 0 }}>{priceOnly ? "Quotation Request" : "Material Request Form"}</h2>
              <p style={{ fontSize: "0.75rem", color: "#6b7280", margin: 0 }}>
                <span style={{ fontWeight: 600, color: "#374151" }}>Project Store:</span> {projectName}
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        <div style={{ padding: "0 1.5rem", flex: 1, overflow: "auto" }}>
          {loading ? (
            <p style={{ fontSize: "0.85rem", color: "#9ca3af", textAlign: "center", padding: "2rem 0" }}>Loading requested materials…</p>
          ) : (
            <>
              <p style={{ fontSize: "0.72rem", color: "#9ca3af", marginBottom: "0.75rem", maxWidth: 820 }}>
                {priceOnly ? (
                  <>Price only — no PO is made. Enter up to three supplier quotations per material and save; a material with a priced quote
                    leaves this list and its price goes into the project&apos;s cost estimate. The lowest price is used unless you pick &quot;Use this price&quot; on another.</>
                ) : (
                  <>Enter up to three suppliers and their prices per material, then click <b>Save Request</b> — each material with a priced supplier goes <b>For Approval</b>.
                    At the review, choose the one supplier to buy each material from; <b>Generate P.O. Number</b> then makes the purchase orders.</>
                )}
              </p>
              <table style={{ width: "100%", minWidth: 1000, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 28 }}>#</th>
                    <th style={th}>PARTICULARS</th>
                    <th style={th}>UNIT</th>
                    <th style={th}>QTY</th>
                    {Array.from({ length: MAX_QUOTES }, (_, i) => <th key={i} style={{ ...th, minWidth: 170 }}>SUPPLIER {i + 1}</th>)}
                    {priceOnly && <th style={{ ...th, minWidth: 140 }}>REMARKS</th>}
                    <th style={{ ...th, width: 40 }} aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: "#9ca3af", padding: "1.5rem" }}>{priceOnly ? "No materials waiting for a quotation." : "No pending requests for this project."}</td></tr>
                  )}
                  {rows.map((r, idx) => {
                    const review = isReview(r);
                    const sel = selectedSlot(r);
                    const lowest = lowestSlot(r);
                    const listId = datalistId(suggestionKey(r));
                    return (
                      <tr key={r.id} style={{ background: review ? "#fafaff" : undefined }}>
                        <td style={{ ...td, color: "#9ca3af" }}>{idx + 1}</td>
                        <td style={{ ...td, fontWeight: 600, color: "#111827", minWidth: 150 }}>
                          {r.materialName}
                          {review && (
                            <span title="Saved — choose the one supplier to buy from, then generate the PO"
                              style={{ display: "inline-block", marginLeft: 6, padding: "1px 7px", borderRadius: 999, background: "#ede9fe", color: "#6d28d9", fontSize: "0.6rem", fontWeight: 700, verticalAlign: "middle", whiteSpace: "nowrap" }}>
                              FOR APPROVAL
                            </span>
                          )}
                          {r.isAdditional && (
                            <span title="Beyond what this BOQ row still needed when it was requested" style={{ marginLeft: 6, fontSize: "0.62rem", fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "#fef3c7", color: "#92400e", whiteSpace: "nowrap" }}>Additional</span>
                          )}
                          {r.isPriceInquiry && (
                            <span title="Sent from the project's cost estimate — only a price is needed, no PO"
                              style={{ display: "inline-block", marginLeft: 6, padding: "1px 6px", borderRadius: 999, background: "#dbeafe", color: "#1d4ed8", fontSize: "0.6rem", fontWeight: 700, verticalAlign: "middle" }}>
                              PRICE CHECK
                            </span>
                          )}
                          {r.lastUnitPrice != null && (
                            <p style={{ fontSize: "0.65rem", fontWeight: 400, color: "#9ca3af", margin: "3px 0 0" }}>
                              Last paid {formatCurrency(r.lastUnitPrice)}/{r.unit}{r.lastUnitPriceSupplier ? ` · ${r.lastUnitPriceSupplier}` : ""}
                            </p>
                          )}
                          {review && (
                            <button type="button" onClick={() => updateRow(r.id, x => ({ ...x, forApproval: false, chosen: null }))}
                              style={{ display: "block", marginTop: 4, padding: 0, background: "none", border: "none", color: "#6b7280", fontSize: "0.65rem", fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}>
                              Edit suppliers
                            </button>
                          )}
                        </td>
                        <td style={{ ...td, color: "#6b7280" }}>{r.unit}</td>
                        <td style={{ ...td, minWidth: 80 }}>
                          {review ? (
                            <span style={{ color: "#374151" }}>{(rowQty(r) ?? r.quantity).toLocaleString()}</span>
                          ) : (
                            <input
                              type="number" min="1" step="1" inputMode="numeric"
                              value={r.qty}
                              onChange={e => updateRow(r.id, x => ({ ...x, qty: e.target.value }))}
                              aria-label={`Quantity requested for ${r.materialName}`}
                              style={{ ...fieldStyle, width: 80 }}
                            />
                          )}
                        </td>
                        {r.quotes.map((q, slot) => {
                          const named = !!q.supplierName.trim();
                          const price = quotePrice(q);
                          const past = named ? historyFor(r, q.supplierName) : undefined;
                          // Review: the head's pick is highlighted. Entry on the
                          // Requests tab: nothing is highlighted or recommended.
                          const chosenHere = review ? r.chosen === slot : priceOnly && slot === sel;
                          return (
                            <td key={slot} style={{ ...td, background: named && chosenHere ? "#fff7ed" : undefined }}>
                              {review ? (
                                named ? (
                                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", padding: "4px 6px", borderRadius: 8,
                                    border: `1px solid ${chosenHere ? "#fdba74" : "#e5e7eb"}` }}>
                                    <input type="radio" name={`mrf-choice-${r.id}`} checked={chosenHere}
                                      onChange={() => updateRow(r.id, x => ({ ...x, chosen: slot }))}
                                      aria-label={`Buy ${r.materialName} from ${q.supplierName}`} style={{ marginTop: 3 }} />
                                    <span style={{ fontSize: "0.78rem" }}>
                                      <span style={{ fontWeight: chosenHere ? 700 : 500, color: "#111827" }}>{q.supplierName}</span>
                                      <span style={{ display: "block", color: "#6b7280" }}>{price != null ? `${formatCurrency(price)}/${r.unit}` : "No price"}</span>
                                      {price != null && <span style={{ display: "block", fontSize: "0.62rem", color: "#9ca3af" }}>Total {formatCurrency(price * (rowQty(r) ?? r.quantity))}</span>}
                                      {slot === lowest && <span style={{ display: "block", fontSize: "0.62rem", color: "#15803d", fontWeight: 700 }}>Lowest price</span>}
                                      {chosenHere && <span style={{ display: "block", fontSize: "0.62rem", color: "#c2410c", fontWeight: 700 }}>Chosen supplier</span>}
                                    </span>
                                  </label>
                                ) : <span style={{ color: "#d1d5db" }}>—</span>
                              ) : (
                                <div style={{ display: "grid", gap: 4 }}>
                                  <input
                                    list={listId}
                                    value={q.supplierName}
                                    onChange={e => setSupplier(r, slot, e.target.value)}
                                    placeholder="Supplier"
                                    aria-label={`Supplier ${slot + 1} for ${r.materialName}`}
                                    style={fieldStyle}
                                  />
                                  <input
                                    type="number" min="0" step="0.01" inputMode="decimal"
                                    value={q.price}
                                    onChange={e => setPrice(r, slot, e.target.value)}
                                    placeholder={`₱ per ${r.unit || "unit"}`}
                                    aria-label={`Price from supplier ${slot + 1} (₱ per ${r.unit || "unit"}) for ${r.materialName}`}
                                    disabled={!named}
                                    style={{ ...fieldStyle, opacity: named ? 1 : 0.5 }}
                                  />
                                  {named && (
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, flexWrap: "wrap" }}>
                                      {priceOnly && (
                                        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.68rem", color: chosenHere ? "#c2410c" : "#6b7280", fontWeight: chosenHere ? 700 : 500, cursor: "pointer" }}>
                                          <input type="radio" name={`mrf-choice-${r.id}`} checked={chosenHere}
                                            onChange={() => updateRow(r.id, x => ({ ...x, chosen: slot }))} />
                                          Use this price
                                        </label>
                                      )}
                                      <span style={{ fontSize: "0.62rem", color: "#9ca3af", textAlign: "right" }}>
                                        {priceOnly && slot === lowest && <span style={{ color: "#15803d", fontWeight: 700 }}>Lowest · </span>}
                                        {q.fromHistory && past?.lastPriceDate ? `Last PO ${formatDate(past.lastPriceDate)}` : q.price.trim() && !q.fromHistory ? "Entered" : past?.hasHistoryWithMaterial ? "" : "New supplier"}
                                      </span>
                                    </div>
                                  )}
                                  {named && price != null && price >= 0 && (
                                    <span style={{ fontSize: "0.62rem", color: "#9ca3af" }}>Total {formatCurrency(price * (rowQty(r) ?? 0))}</span>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        {priceOnly && (
                          <td style={td}>
                            <textarea
                              value={r.remarks}
                              onChange={e => updateRow(r.id, x => ({ ...x, remarks: e.target.value }))}
                              rows={2} maxLength={300}
                              placeholder="Remarks"
                              aria-label={`Remarks for ${r.materialName}`}
                              style={{ ...fieldStyle, resize: "vertical", fontFamily: "inherit" }}
                            />
                          </td>
                        )}
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {confirmDeleteId === r.id ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                              <span style={{ fontSize: "0.68rem", color: "#991b1b", fontWeight: 600 }}>Delete?</span>
                              <div style={{ display: "flex", gap: 4 }}>
                                <button type="button" onClick={() => handleDelete(r)} disabled={deletingId === r.id}
                                  style={{ padding: "3px 8px", borderRadius: 6, border: "none", background: "#dc2626", color: "#fff", fontSize: "0.68rem", fontWeight: 700, cursor: "pointer" }}>
                                  {deletingId === r.id ? "…" : "Yes"}
                                </button>
                                <button type="button" onClick={() => setConfirmDeleteId(null)}
                                  style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "0.68rem", fontWeight: 600, cursor: "pointer" }}>
                                  No
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button type="button" onClick={() => setConfirmDeleteId(r.id)} aria-label={`Delete the ${r.materialName} request`} title="Delete request"
                              style={{ background: "none", border: "1px solid #fecaca", borderRadius: 6, padding: 5, cursor: "pointer", color: "#dc2626", display: "flex" }}>
                              <Trash2 style={{ width: 14, height: 14 }} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {/* One suggestion list per material + unit, shared by its supplier fields. */}
              {Object.entries(suggestions).map(([key, list]) => (
                <datalist key={key} id={datalistId(key)}>
                  {list.map(s => <option key={s.id} value={s.name} />)}
                </datalist>
              ))}

            </>
          )}
        </div>

        <div style={{ padding: "1rem 1.5rem 1.25rem", flexShrink: 0, borderTop: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "1rem", flexWrap: "wrap" }}>
          {!priceOnly && reviewRows.length > 0 && !allChosen && (
            <span style={{ fontSize: "0.72rem", color: "#6b7280" }}>
              Choose one supplier for each material marked For Approval to generate the PO.
            </span>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(priceOnly || entryRows.length > 0) && (
              <button onClick={handleSave} disabled={busy || entryRows.length === 0} style={{
                padding: "10px 16px", borderRadius: 8, border: priceOnly ? "1px solid #e5e7eb" : "none",
                background: priceOnly ? "#fff" : "#111827", color: priceOnly ? "#374151" : "#fff",
                fontWeight: 700, fontSize: "0.85rem", cursor: (busy || entryRows.length === 0) ? "not-allowed" : "pointer", opacity: (busy || entryRows.length === 0) ? 0.7 : 1,
              }}>
                {saving ? "Saving…" : priceOnly ? "Save Quotations" : "Save Request"}
              </button>
            )}
            {/* Only once a request is saved, and active once every material has its supplier chosen. */}
            {!priceOnly && reviewRows.length > 0 && (
              <button onClick={handleGenerate} disabled={busy || !allChosen} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 8, border: "none",
                background: allChosen ? "#f97316" : "#e5e7eb", color: allChosen ? "#fff" : "#6b7280", fontWeight: 700, fontSize: "0.85rem",
                cursor: (busy || !allChosen) ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1,
              }}>
                {generating ? "Generating…" : "Generate P.O. Number"}
              </button>
            )}
          </div>
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
            <ImportedTag po={po} />
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
              <span style={{ fontSize: "0.8rem", color: "#6b7280", textAlign: "right" }}>
                {m.qty}
                {m.unitPrice != null && (
                  <span style={{ display: "block", fontSize: "0.72rem" }}>
                    {formatCurrency(m.unitPrice)}/{m.unit} · {formatCurrency(m.lineTotal!)}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
        {po.materials.some(m => m.lineTotal != null) && (
          <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "#111827", textAlign: "right", marginTop: "0.75rem" }}>
            PO Total: {formatCurrency(po.materials.reduce((sum, m) => sum + (m.lineTotal ?? 0), 0))}
          </p>
        )}

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

function HistoryModal({ supplier, onClose, onViewRatings }: { supplier: Supplier; onClose: () => void; onViewRatings: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 460, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div>
            <p style={{ fontWeight: 800, fontSize: "1rem", color: "#111827" }}>{supplier.name}</p>
            <p style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Purchase order history</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        <button
          onClick={onViewRatings}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", marginBottom: "1.25rem" }}
        >
          <Stars rating={supplier.rating} /> View rating summary &amp; feedback
        </button>

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
                          <img key={pi} src={resolveUploadUrl(url) ?? url} alt="Proof of delivery" style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />
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

// One file dropzone for a single required document (PO or DR) — distinct
// from the POD grid below since these are typically a single scanned
// document (often a PDF), not a set of photos of the goods themselves.
function SingleFileDropzone({ label, accept, file, existingUrl, onPick, onClear }: {
  label: string; accept: string; file: File | null; existingUrl?: string | null;
  onPick: (f: File) => void; onClear: () => void;
}) {
  if (file) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, border: "1px solid #e5e7eb", borderRadius: 10, padding: "0.6rem 0.75rem", background: "#f9fafb" }}>
        <span style={{ fontSize: "0.78rem", color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
        <button onClick={onClear} title="Remove" style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", flexShrink: 0, display: "flex" }}>
          <X style={{ width: 14, height: 14 }} />
        </button>
      </div>
    );
  }
  if (existingUrl) {
    return (
      <a href={resolveUploadUrl(existingUrl) ?? existingUrl} target="_blank" rel="noopener noreferrer"
        style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #e5e7eb", borderRadius: 10, padding: "0.6rem 0.75rem", background: "#f9fafb", fontSize: "0.78rem", color: "#f97316", fontWeight: 600, textDecoration: "none" }}>
        View uploaded {label}
      </a>
    );
  }
  return (
    <label style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      border: "2px dashed #e5e7eb", borderRadius: 10, padding: "0.75rem 1rem", cursor: "pointer", background: "#f9fafb",
    }}>
      <Upload style={{ width: 16, height: 16, color: "#9ca3af" }} />
      <span style={{ fontSize: "0.78rem", color: "#6b7280" }}>Click to upload {label}</span>
      <input type="file" accept={accept} onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} style={{ display: "none" }} />
    </label>
  );
}

// ── Delivery Batch Overlay ───────────────────────────────────────────────────
// Opened from the status dropdown/pill once a PO is Approved or already
// DeliveryInProgress. Each batch needs a Delivery Receipt + at least one
// Proof of Delivery photo; the Purchase Order file is only asked for once —
// on the very first batch — and persists afterward as the PO's own master
// document (see PurchaseOrder.PoFileUrl). "Save" persists the currently-
// picked documents as one batch (a partial shipment) and the overlay stays
// open so another batch can be added later. "Delivery Complete" saves
// whatever's currently picked (if anything), then finalizes — it never
// requires a rating, that's a separate step only WarehousePersonnel can do
// (see RateSupplierModal).
function DeliveryBatchModal({ po, onClose, onSaveBatch, onComplete }: {
  po: PO;
  onClose: () => void;
  onSaveBatch: (payload: { poFile: File | null; drFile: File; podPhotos: File[] }) => Promise<void>;
  onComplete: () => Promise<void>;
}) {
  const [poFile, setPoFile] = useState<File | null>(null);
  const [drFile, setDrFile] = useState<File | null>(null);
  const [podPhotos, setPodPhotos] = useState<PhotoEntry[]>([]);
  const [expandedBatchId, setExpandedBatchId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);

  const busy = saving || completing;
  // The PO file is only required/shown once — the first batch, and only if
  // nothing's been uploaded for it yet.
  const needsPoFile = po.deliveryBatches.length === 0 && !po.poFileUrl;
  const hasActiveInput = !!poFile || !!drFile || podPhotos.length > 0;

  function handlePodSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const nonImages = files.filter(f => !f.type.startsWith("image/"));
    if (nonImages.length > 0) { toast.error("Please select image files only."); }
    const entries = files.filter(f => f.type.startsWith("image/")).map(f => ({ file: f, previewUrl: URL.createObjectURL(f) }));
    setPodPhotos(prev => [...prev, ...entries]);
    e.target.value = "";
  }

  function handleRemovePodPhoto(index: number) {
    setPodPhotos(prev => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  function clearActive() {
    setPoFile(null);
    setDrFile(null);
    setPodPhotos(prev => { prev.forEach(p => URL.revokeObjectURL(p.previewUrl)); return []; });
  }

  function handleClose() {
    clearActive();
    onClose();
  }

  // Shared by Save and Complete (when it has to save pending input first) —
  // same requirements the backend enforces, checked here so the error
  // appears before a round trip instead of after.
  function validateActive(): string | null {
    if (needsPoFile && !poFile) return "Upload the Purchase Order file.";
    if (!drFile) return "Upload the Delivery Receipt file.";
    if (podPhotos.length === 0) return "Add at least one Proof of Delivery photo.";
    return null;
  }

  async function handleSave() {
    const err = validateActive();
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      await onSaveBatch({ poFile: needsPoFile ? poFile : null, drFile: drFile!, podPhotos: podPhotos.map(p => p.file) });
      clearActive();
    } catch {
      // Already toasted inside onSaveBatch (which rethrows only so
      // clearActive() above is skipped on failure) — swallow here so it
      // doesn't also surface as an unhandled rejection.
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete() {
    if (hasActiveInput) {
      const err = validateActive();
      if (err) { toast.error(err); return; }
      setCompleting(true);
      try {
        await onSaveBatch({ poFile: needsPoFile ? poFile : null, drFile: drFile!, podPhotos: podPhotos.map(p => p.file) });
        clearActive();
        await onComplete();
      } catch {
        // Same reasoning as handleSave above.
      } finally {
        setCompleting(false);
      }
      return;
    }
    if (po.deliveryBatches.length === 0) {
      toast.error("Add at least one delivery batch before completing delivery.");
      return;
    }
    setCompleting(true);
    try {
      await onComplete();
    } finally {
      setCompleting(false);
    }
  }

  const canComplete = hasActiveInput || po.deliveryBatches.length > 0;

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
          {needsPoFile
            ? "Upload the Purchase Order, Delivery Receipt, and Proof of Delivery photos, then click Save. Once everything has arrived, click Delivery Complete."
            : "Upload the Delivery Receipt and Proof of Delivery photos for each batch as it arrives and click Save — you can come back and add another batch later. Once everything has arrived, click Delivery Complete."}
        </p>

        {/* Collapsed by default — each batch expands on click to show its
            documents, rather than always rendering every photo from every
            past batch at once. */}
        {po.deliveryBatches.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "1.1rem" }}>
            {po.deliveryBatches.map(b => {
              const expanded = expandedBatchId === b.id;
              return (
                <div key={b.id} style={{ border: "1px solid #f3f4f6", borderRadius: 10, padding: "0.6rem 0.75rem" }}>
                  <button
                    onClick={() => setExpandedBatchId(expanded ? null : b.id)}
                    style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <ChevronRight style={{ width: 13, height: 13, color: "#9ca3af", transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
                      <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#111827" }}>Batch {b.batchNumber}</span>
                    </span>
                    <span style={{ fontSize: "0.66rem", color: "#9ca3af" }}>{b.uploadedByName} · {toDisplayDate(b.createdAt)}</span>
                  </button>
                  {expanded && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                      {b.batchNumber === 1 && po.poFileUrl && (
                        <a href={resolveUploadUrl(po.poFileUrl) ?? po.poFileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.75rem", color: "#f97316", fontWeight: 600 }}>
                          View Purchase Order file
                        </a>
                      )}
                      {b.drFileUrl && (
                        <a href={resolveUploadUrl(b.drFileUrl) ?? b.drFileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.75rem", color: "#f97316", fontWeight: 600 }}>
                          View Delivery Receipt file
                        </a>
                      )}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                        {b.podPhotoUrls.map((url, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={i} src={resolveUploadUrl(url) ?? url} alt={`Batch ${b.batchNumber} proof of delivery photo ${i + 1}`} style={{ width: "100%", height: 56, borderRadius: 6, objectFit: "cover" }} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          {po.deliveryBatches.length > 0 && (
            <p style={{ fontWeight: 700, fontSize: "0.85rem", color: "#111827", margin: 0 }}>
              Batch {po.deliveryBatches.length + 1}
            </p>
          )}

          {needsPoFile && (
            <div>
              <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#374151", marginBottom: 5 }}>1. Purchase Order (PO)</label>
              <SingleFileDropzone label="PO file" accept="image/*,application/pdf" file={poFile} onPick={setPoFile} onClear={() => setPoFile(null)} />
            </div>
          )}

          <div>
            <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#374151", marginBottom: 5 }}>
              {needsPoFile ? "2. Delivery Receipt (DR / Photo)" : "Delivery Receipt (DR / Photo)"}
            </label>
            <SingleFileDropzone label="DR file" accept="image/*,application/pdf" file={drFile} onPick={setDrFile} onClear={() => setDrFile(null)} />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#374151", marginBottom: 5 }}>
              {needsPoFile ? "3. Proof of Delivery (POD / Photos)" : "Proof of Delivery (POD / Photos)"}
            </label>
            {podPhotos.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 8 }}>
                {podPhotos.map((p, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.previewUrl} alt={`Proof of delivery ${i + 1}`} style={{ width: "100%", height: 90, borderRadius: 8, objectFit: "cover" }} />
                    <button onClick={() => handleRemovePodPhoto(i)} title="Remove"
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
              <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>{podPhotos.length > 0 ? "Add more photos" : "Click to upload photos"}</span>
              <input type="file" accept="image/*" multiple onChange={handlePodSelected} style={{ display: "none" }} />
            </label>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
          <button onClick={handleSave} disabled={!hasActiveInput || busy} style={{
            flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff",
            color: "#374151", fontWeight: 700, fontSize: "0.875rem",
            cursor: hasActiveInput && !busy ? "pointer" : "not-allowed", opacity: hasActiveInput ? 1 : 0.6,
          }}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={handleComplete} disabled={!canComplete || busy} style={{
            flex: 1, padding: "10px", borderRadius: 8, border: "none",
            background: canComplete ? "#f97316" : "#fbd0a6", color: "#fff", fontWeight: 700, fontSize: "0.875rem",
            cursor: canComplete && !busy ? "pointer" : "not-allowed",
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

type ProcurementTab = "po" | "requests" | "quotations" | "suppliers";

export default function ProcurementPage() {
  return (
    <Suspense fallback={null}>
      <ProcurementContent />
    </Suspense>
  );
}

function ProcurementContent() {
  // ?tab=quotations — where a "need a price" notification lands.
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [tab,      setTab]      = useState<ProcurementTab>("po");
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
  const [quotationProjects, setQuotationProjects] = useState<ProjectWithRequests[]>([]);
  // The project whose form is open, and whether it's its price checks.
  const [openRequests, setOpenRequests] = useState<{ projectId: number; priceOnly: boolean } | null>(null);

  useEffect(() => {
    if (tabParam === "quotations" || tabParam === "requests" || tabParam === "suppliers" || tabParam === "po") setTab(tabParam);
  }, [tabParam]);

  // Suppliers tab search/sort — scoped to that tab only, doesn't touch the
  // separate "Supplier Performance" top-5 ranking below it.
  const [supplierSearch, setSupplierSearch] = useState("");
  // Defaults to "preferred" — who the company actually orders from and
  // trusts most, front and center, rather than an arbitrary alphabetical list.
  const [supplierSort, setSupplierSort] = useState<"name" | "rating" | "preferred">("preferred");
  const [supplierSortOpen, setSupplierSortOpen] = useState(false);

  const viewingPO       = orders.find(o => o.id === viewingPOId) ?? null;
  const contactSupplier = suppliers.find(s => s.id === contactSupplierId) ?? null;
  const historySupplier = suppliers.find(s => s.id === historySupplierId) ?? null;
  const ratingSupplier  = suppliers.find(s => s.id === ratingSupplierId) ?? null;
  const deliveryPO = orders.find(o => o.id === deliveryPOId) ?? null;
  const ratingPO   = orders.find(o => o.id === ratingPOId) ?? null;
  const openRequestsProject = openRequests
    ? (openRequests.priceOnly ? quotationProjects : requestsProjects).find(p => p.projectId === openRequests.projectId) ?? null
    : null;
  const totalPendingRequests = requestsProjects.reduce((sum, p) => sum + p.pendingCount, 0);
  const totalPendingQuotations = quotationProjects.reduce((sum, p) => sum + p.pendingCount, 0);

  const { user } = useAuthStore();
  const role = user?.role ?? "SiteEngineer";
  // Admin/ProcurementOfficer manage the PO lifecycle up through Approved —
  // ProjectManager is view-only for Procurement. WarehousePersonnel is the
  // only role that ever touches delivery — they're the ones physically
  // receiving the goods, so they're the only ones who can click Delivered
  // (save proof-of-delivery batches, then complete it) and the only ones who
  // can rate the supplier afterward. The backend enforces both restrictions
  // independently of this.
  const canManagePOs = role === "Admin" || role === "ProcurementOfficer";
  const canMarkDelivered = role === "WarehousePersonnel" || role === "Admin";
  const canRate = role === "WarehousePersonnel" || role === "Admin";
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
      const [requestsRes, quotationsRes] = await Promise.all([
        api.get<ApiProjectWithRequests[]>("/material-requests/projects-with-pending", { params: { priceInquiry: false } }),
        api.get<ApiProjectWithRequests[]>("/material-requests/projects-with-pending", { params: { priceInquiry: true } }),
      ]);
      setRequestsProjects(requestsRes.data);
      setQuotationProjects(quotationsRes.data);
    } catch {
      setRequestsProjects([]);
      setQuotationProjects([]);
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

  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase();
    const matches = suppliers.filter(s =>
      !q || s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
    );
    return [...matches].sort((a, b) => {
      if (supplierSort === "rating") return b.rating - a.rating;
      if (supplierSort === "preferred") {
        // Who the company actually orders from, preferred ones first: real
        // order volume (deliveries) leads, the formal PREFERRED badge (rating
        // + on-time track record) breaks ties, rating itself after that.
        const aPreferred = getSupplierBadge(a) === "PREFERRED" ? 1 : 0;
        const bPreferred = getSupplierBadge(b) === "PREFERRED" ? 1 : 0;
        return b.deliveries - a.deliveries || bPreferred - aPreferred || b.rating - a.rating;
      }
      return a.name.localeCompare(b.name);
    });
  }, [suppliers, supplierSearch, supplierSort]);

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

  async function handleSaveBatch(po: PO, payload: { poFile: File | null; drFile: File; podPhotos: File[] }) {
    const form = new FormData();
    if (payload.poFile) form.append("PoFile", payload.poFile);
    form.append("DrFile", payload.drFile);
    payload.podPhotos.forEach(f => form.append("PodPhotos", f));
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

  const atRiskOrders = useMemo(() => {
    if (!risk || !snapshot) return [];
    return computeWeatherAtRiskOrders(orders, risk.level, snapshot.conditionLabel);
  }, [orders, risk, snapshot]);

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
      {historySupplier && (
        <HistoryModal
          supplier={historySupplier}
          onClose={() => setHistorySupplierId(null)}
          onViewRatings={() => { setHistorySupplierId(null); setRatingSupplierId(historySupplier.id); }}
        />
      )}
      {ratingSupplier && <SupplierRatingModal supplier={ratingSupplier} onClose={() => setRatingSupplierId(null)} />}
      {deliveryPO && (
        <DeliveryBatchModal
          po={deliveryPO}
          onClose={() => setDeliveryPOId(null)}
          onSaveBatch={payload => handleSaveBatch(deliveryPO, payload)}
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
      {openRequests && openRequestsProject && (
        <RequestsOverlayModal
          key={`${openRequests.projectId}-${openRequests.priceOnly}`}
          projectId={openRequestsProject.projectId}
          projectName={openRequestsProject.projectName}
          priceOnly={openRequests.priceOnly}
          onClose={() => setOpenRequests(null)}
          onChanged={refetch}
          onGenerated={() => { refetch(); setTab("po"); }}
        />
      )}
      <Header title="Procurement" />

      <div className="responsive-page" style={{ padding: "1.25rem 1.5rem" }}>

        {/* ── 4 stat cards ─────────────────────────────────────────────────── */}
        <div className="po-stats" style={{ display: "grid", gap: "1rem", marginBottom: "1.5rem" }}>
          {[
            { icon: Clock,        color: "#6b7280", bg: "#f3f4f6", label: "Pending POs",  value: counts.pending   },
            { icon: CheckCircle2, color: "#16a34a", bg: "#dcfce7", label: "Approved POs", value: counts.approved  },
            { icon: PackageCheck, color: "#1d4ed8", bg: "#dbeafe", label: "Delivered",    value: counts.delivered },
            { icon: AlertTriangle,color: "#dc2626", bg: "#fee2e2", label: "Delayed",      value: counts.delayed   },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="po-stat" style={{ background: "#fff", borderRadius: 14, padding: "1.5rem 1.5rem 1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
                <div className="po-stat-icon" style={{ width: 44, height: 44, borderRadius: 11, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "0.875rem" }}>
                  <Icon style={{ width: 22, height: 22, color: s.color }} />
                </div>
                <p className="po-stat-value" style={{ fontSize: "2.2rem", fontWeight: 800, color: "#111827", lineHeight: 1 }}>{s.value}</p>
                <p style={{ fontSize: "0.78rem", color: "#9ca3af", marginTop: 4 }}>{s.label}</p>
              </div>
            );
          })}
        </div>

        {/* ── Weather & Delivery Risk (R4) — visible above both tabs ─────────── */}
        {snapshot && risk && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }}>
            <div style={{
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

            {/* Weather Impact — same live source as the Dashboard's card, laid out
                landscape (one wide row) instead of a narrow stacked panel. */}
            <div style={{ background: "#1a2235", borderRadius: 14, padding: "1rem 1.25rem", color: "#fff", display: "flex", alignItems: "center", gap: "1.25rem", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: "1.8rem" }}>{snapshot.emoji}</span>
                <div>
                  <p style={{ fontWeight: 700, fontSize: "0.78rem", color: "#9ca3af" }}>Weather Impact</p>
                  <p style={{ fontSize: "1.5rem", fontWeight: 800, lineHeight: 1.15 }}>{snapshot.tempC}°C <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "#9ca3af" }}>{snapshot.conditionLabel}</span></p>
                </div>
              </div>

              <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />

              <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                {[
                  { label: "WIND",          val: `${snapshot.windKph} km/h`,             Icon: Wind },
                  { label: "HUMIDITY",      val: `${snapshot.humidityPct}%`,             Icon: Droplets },
                  { label: "PRECIPITATION", val: `${snapshot.precipitationMm} mm`,       Icon: CloudRain },
                  { label: "RISK LEVEL",    val: risk.level.toUpperCase(),               Icon: AlertTriangle },
                ].map(w => (
                  <div key={w.label} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "0.4rem 0.6rem", minWidth: 92 }}>
                    <p style={{ color: "#6b7280", fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.06em" }}>{w.label}</p>
                    <p style={{ color: "#fff", fontSize: "0.76rem", fontWeight: 600, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                      <w.Icon style={{ width: 11, height: 11 }} /> {w.val}
                    </p>
                  </div>
                ))}
              </div>

              <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />

              <div style={{ flex: "1 1 200px", background: RISK_VISUALS_DARK[risk.level].bg, border: `1px solid ${RISK_VISUALS_DARK[risk.level].border}`, borderRadius: 8, padding: "0.5rem 0.7rem" }}>
                <p style={{ color: RISK_VISUALS_DARK[risk.level].text, fontSize: "0.7rem", lineHeight: 1.4 }}>
                  {risk.level === "low" ? "✓ " : "⚠ "}{risk.advisory}
                </p>
              </div>

              {daily.length > 0 && (
                <>
                  <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />
                  <div style={{ flexShrink: 0 }}>
                    <p style={{ color: "#6b7280", fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.05em", marginBottom: "0.4rem" }}>5-DAY FORECAST</p>
                    <div style={{ display: "flex", gap: "0.6rem" }}>
                      {daily.map(d => (
                        <div key={d.date} style={{ textAlign: "center" }}>
                          <p style={{ color: "#6b7280", fontSize: "0.6rem" }}>{formatShortDate(d.date)}</p>
                          <p style={{ fontSize: "0.9rem", margin: "2px 0" }}>{d.emoji}</p>
                          <p style={{ color: "#fff", fontSize: "0.7rem", fontWeight: 600 }}>{d.maxTempC}°</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Tabs (+ Suppliers-only search/filter, floated right) ───────────── */}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
          <div className="procurement-tabs" style={{ display: "flex", gap: 4, background: "#e5e7eb", borderRadius: 8, padding: 4 }}>
            {([
              { id: "po", label: "Purchase Orders" },
              ...(canManagePOs ? [{ id: "requests", label: "Requests" }, { id: "quotations", label: "Quotations" }] as const : []),
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
                {(t.id === "requests" ? totalPendingRequests : t.id === "quotations" ? totalPendingQuotations : 0) > 0 && (
                  <span style={{
                    position: "absolute", top: -6, right: -6,
                    background: "#ef4444", color: "#fff", borderRadius: 999,
                    minWidth: 18, height: 18, padding: "0 4px",
                    fontSize: "0.65rem", fontWeight: 700, lineHeight: 1,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 0 0 2px #e5e7eb",
                  }}>
                    {t.id === "requests" ? totalPendingRequests : totalPendingQuotations}
                  </span>
                )}
              </button>
            ))}
          </div>

          {tab === "suppliers" && (
            <div className="supplier-tools" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <div className="supplier-search" style={{ position: "relative", width: 220, maxWidth: "100%" }}>
                <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "#9ca3af", pointerEvents: "none" }} />
                <input
                  value={supplierSearch}
                  onChange={e => setSupplierSearch(e.target.value)}
                  placeholder="Search suppliers..."
                  style={{ width: "100%", boxSizing: "border-box", paddingLeft: 32, paddingRight: 10, paddingTop: 8, paddingBottom: 8, borderRadius: 8, background: "#fff", border: "1px solid #e5e7eb", fontSize: "0.82rem", outline: "none", color: "#111827" }}
                />
              </div>
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setSupplierSortOpen(o => !o)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8,
                    border: "1px solid #e5e7eb", background: "#fff", color: "#374151",
                    fontSize: "0.82rem", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  <ArrowUpDown style={{ width: 14, height: 14 }} /> Sort: {supplierSort === "name" ? "Name" : supplierSort === "rating" ? "Rating" : "Preferred"}
                </button>
                {supplierSortOpen && (
                  <>
                    <div onClick={() => setSupplierSortOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                    <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50, width: 210, background: "#fff", borderRadius: 10, border: "1px solid #e5e7eb", boxShadow: "0 12px 30px rgba(0,0,0,0.12)", padding: "0.4rem" }}>
                      {([
                        { id: "preferred", label: "Preferred / Most Ordered" },
                        { id: "name",      label: "Name (A–Z)" },
                        { id: "rating",    label: "Rating (highest first)" },
                      ] as const).map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => { setSupplierSort(opt.id); setSupplierSortOpen(false); }}
                          style={{
                            display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 6, border: "none",
                            background: supplierSort === opt.id ? "#fff7ed" : "transparent",
                            color: supplierSort === opt.id ? "#f97316" : "#374151",
                            fontSize: "0.8rem", fontWeight: supplierSort === opt.id ? 600 : 500, cursor: "pointer",
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
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

            <div className="table-scroll">
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
                        <ImportedTag po={po} />
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
                        ) : (canManagePOs || canMarkDelivered) ? (
                          // Admin has both flags and gets a merged dropdown: PENDING/APPROVED
                          // (set directly) plus DELIVERED (opens the proof-of-delivery overlay
                          // rather than setting the status directly — the backend rejects a
                          // direct PATCH to DeliveryInProgress/Delivered either way).
                          <select
                            value={status === "DELAYED" ? "DELAYED" : canManagePOs ? po.status : status}
                            onChange={e => handleStatusSelect(po, e.target.value as POStatus)}
                            title={status === "DELAYED" ? "Past its expected delivery date" : !canManagePOs ? "You can only mark this purchase order as delivered" : undefined}
                            style={{
                              fontSize: "0.7rem", fontWeight: 700, padding: "3px 8px", borderRadius: 999,
                              background: st.bg, color: st.color, border: "none", cursor: "pointer", outline: "none",
                              appearance: "none" as const,
                            }}
                          >
                            {status === "DELAYED" && <option value="DELAYED" disabled hidden>DELAYED</option>}
                            {canManagePOs
                              ? PO_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)
                              : <option value={status} disabled hidden>{statusLabel(status)}</option>}
                            {canMarkDelivered && <option value="DELIVERED">DELIVERED</option>}
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
          </div>
        )}

        {/* ────────────────────────────────────────────────────────────────── */}
        {/* Tabs: Requests (material to order → PO) and Quotations (price      */}
        {/* checks from a project's cost breakdown → no PO). Only projects    */}
        {/* with something outstanding appear.                                 */}
        {/* ────────────────────────────────────────────────────────────────── */}
        {(tab === "requests" || tab === "quotations") && (() => {
          const priceOnly = tab === "quotations";
          const list = priceOnly ? quotationProjects : requestsProjects;
          return (
            <div style={{ background: "#fff", borderRadius: 12, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: priceOnly ? "0.35rem" : "1.25rem" }}>
                {priceOnly
                  ? <Tag style={{ width: 16, height: 16, color: "#2563eb" }} />
                  : <ClipboardList style={{ width: 16, height: 16, color: "#f97316" }} />}
                <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>{priceOnly ? "Quotation Requests" : "Material Requests"}</span>
              </div>
              {priceOnly && (
                <p style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "1.25rem" }}>
                  Materials a project&apos;s cost estimate has no price for. Get supplier quotations — no purchase order is made.
                </p>
              )}

              {list.length === 0 ? (
                <p style={{ fontSize: "0.85rem", color: "#9ca3af", textAlign: "center", padding: "2rem 0" }}>
                  {priceOnly ? "No materials are waiting for a quotation right now." : "No projects have pending material requests right now."}
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {list.map(p => (
                    <button
                      key={p.projectId}
                      onClick={() => setOpenRequests({ projectId: p.projectId, priceOnly })}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        width: "100%", padding: "14px 16px", borderRadius: 10, border: "none",
                        background: "#f9fafb", cursor: "pointer", textAlign: "left",
                      }}
                    >
                      <div>
                        <p style={{ fontWeight: 700, fontSize: "0.88rem", color: "#111827" }}>{p.projectName}</p>
                        <p style={{ fontSize: "0.72rem", color: "#9ca3af", marginTop: 2 }}>
                          {p.pendingCount} material{p.pendingCount !== 1 ? "s" : ""} {priceOnly ? "need a price" : "requested"}
                        </p>
                      </div>
                      {!priceOnly && (p.forApprovalCount ?? 0) > 0 && (
                        <span title="Saved — choose the supplier for each, then generate the PO"
                          style={{ marginLeft: "auto", marginRight: 10, padding: "3px 10px", borderRadius: 999, background: "#ede9fe", color: "#6d28d9", fontSize: "0.68rem", fontWeight: 700, whiteSpace: "nowrap" }}>
                          {p.forApprovalCount === p.pendingCount ? "For Approval" : `${p.forApprovalCount} For Approval`}
                        </span>
                      )}
                      <ChevronRight style={{ width: 16, height: 16, color: "#9ca3af" }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* ────────────────────────────────────────────────────────────────── */}
        {/* Tab: Suppliers                                                     */}
        {/* ────────────────────────────────────────────────────────────────── */}
        {tab === "suppliers" && (
          <div>

            {/* Supplier cards — fluid 1/2/3-column grid (min 300px per card,
                naturally reflows with available width, including as the
                sidebar collapses/expands, not just at fixed viewport
                breakpoints) */}
            {suppliers.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 14, padding: "2rem", textAlign: "center", color: "#9ca3af", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
                No suppliers yet — they&apos;re added automatically the first time you create a PO for them.
              </div>
            ) : filteredSuppliers.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 14, padding: "2rem", textAlign: "center", color: "#9ca3af", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
                No suppliers match your search/filter.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
                {filteredSuppliers.map(s => (
                  <div key={s.id} style={{ background: "#fff", borderRadius: 14, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", minWidth: 0 }}>
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
                    <div className="supplier-stats" style={{ display: "grid", gap: "0.5rem", marginBottom: "0.875rem" }}>
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

                    {/* Stars + buttons — wraps so Contact/History drop under the stars on narrow cards */}
                    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
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

            {/* Supplier Performance — top 5, ranked most to least preferred */}
            {suppliers.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 14, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
                <p style={{ fontWeight: 700, fontSize: "0.95rem", color: "#111827", marginBottom: "1rem" }}>Supplier Performance</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                  {sortSuppliersByPreference(suppliers)
                    .slice(0, 5)
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
