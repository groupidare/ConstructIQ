"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Header from "@/components/layout/Header";
import {
  Clock, CheckCircle2, Truck, AlertTriangle,
  ShoppingCart, Download, Plus, BookOpen, CheckSquare,
  Send, History, X,
} from "lucide-react";
import { useWeatherStore } from "@/store/weatherStore";
import { useAlertStore } from "@/store/alertStore";
import { RISK_VISUALS } from "@/lib/weather";
import { computeWeatherAtRiskOrders } from "@/lib/deliveryRisk";

// ── Types & data ──────────────────────────────────────────────────────────────

type POStatus = "PENDING" | "APPROVED" | "TRANSIT" | "DELIVERED" | "DELAYED";

interface PO {
  number: string;
  material: string;
  supplier: string;
  qty: string;
  amount: number;
  status: POStatus;
  expectedDate: string;
}

const PO_STATUS_STYLE: Record<POStatus, { bg: string; color: string }> = {
  PENDING:   { bg: "#fef3c7", color: "#b45309"  },
  APPROVED:  { bg: "#dcfce7", color: "#15803d"  },
  TRANSIT:   { bg: "#dbeafe", color: "#1d4ed8"  },
  DELIVERED: { bg: "#f3f4f6", color: "#374151"  },
  DELAYED:   { bg: "#fee2e2", color: "#dc2626"  },
};

const PURCHASE_ORDERS: PO[] = [
  { number: "PO-2025-0841", material: "Ready-mix Concrete",         supplier: "Holcim Philippines",   qty: "50 m³",    amount: 240000, status: "PENDING",   expectedDate: "Jun 28, 2026" },
  { number: "PO-2025-0842", material: "Portland Cement",            supplier: "Manila Cement Corp.",  qty: "500 bags", amount: 142500, status: "APPROVED",  expectedDate: "Jun 26, 2026" },
  { number: "PO-2025-0843", material: "Deformed Steel Bars (12mm)", supplier: "National Steel PH",    qty: "300 pcs",  amount: 66000,  status: "TRANSIT",   expectedDate: "Jun 24, 2026" },
  { number: "PO-2025-0844", material: "Coarse Gravel",              supplier: "PhilCon Aggregates",   qty: "40 m³",    amount: 58000,  status: "TRANSIT",   expectedDate: "Jun 24, 2026" },
  { number: "PO-2025-0840", material: "G.I. Pipes (1-inch)",        supplier: "PolyCon Philippines",  qty: "50 m",     amount: 19000,  status: "DELIVERED", expectedDate: "Jun 20, 2026" },
  { number: "PO-2025-0839", material: "Fine Aggregate (Sand)",      supplier: "PhilCon Aggregates",   qty: "30 m³",    amount: 36000,  status: "DELAYED",   expectedDate: "Jun 18, 2026" },
];

const TIMELINE_STEPS = [
  { label: "PO Created",           date: "May 26",   done: true,  active: false },
  { label: "Approval Review",      date: "May 26",   done: true,  active: false },
  { label: "Supplier Confirmation",date: "May 27",   done: false, active: true  },
  { label: "In Transit",           date: "May 28-29",done: false, active: false },
  { label: "Delivery & Receiving", date: "May 30",   done: false, active: false },
  { label: "Invoice Processing",   date: "Jun 2",    done: false, active: false },
];

interface Supplier {
  initials: string;
  name: string;
  category: string;
  lead: string;
  badge: "PREFERRED" | "ACTIVE" | "AT RISK";
  rating: number;
  deliveries: number;
  onTime: number;
  avatarBg: string;
}

const SUPPLIERS: Supplier[] = [
  { initials: "MC", name: "Manila Cement Corp.",      category: "Binders",    lead: "3-5 days", badge: "PREFERRED", rating: 4.8, deliveries: 24, onTime: 96, avatarBg: "#1e3154" },
  { initials: "PA", name: "PhilCon Aggregates",       category: "Aggregates", lead: "2-4 days", badge: "PREFERRED", rating: 4.5, deliveries: 18, onTime: 92, avatarBg: "#1e3154" },
  { initials: "NS", name: "National Steel PH",        category: "Steel",      lead: "5-7 days", badge: "ACTIVE",    rating: 4.2, deliveries: 31, onTime: 88, avatarBg: "#1e3154" },
  { initials: "PP", name: "PolyCon Philippines",      category: "Plumbing",   lead: "3-5 days", badge: "PREFERRED", rating: 4.7, deliveries: 22, onTime: 94, avatarBg: "#1e3154" },
];

const BADGE_STYLE: Record<"PREFERRED" | "ACTIVE" | "AT RISK", { bg: string; color: string }> = {
  PREFERRED: { bg: "#dcfce7", color: "#15803d" },
  ACTIVE:    { bg: "#dbeafe", color: "#1d4ed8" },
  "AT RISK": { bg: "#fee2e2", color: "#dc2626" },
};

const PERF_SUPPLIERS = [
  { initials: "CS", name: "Cruz & Sons Hardware",       badge: "PREFERRED" as const, onTime: 96, lead: 3,  deliveries: 42, rating: 4.8, onTimePct: "#22c55e" },
  { initials: "MC", name: "Metro Construction Supply",  badge: "ACTIVE"    as const, onTime: 88, lead: 5,  deliveries: 28, rating: 4.2, onTimePct: "#22c55e" },
  { initials: "NM", name: "Northstar Materials",        badge: "AT RISK"   as const, onTime: 79, lead: 7,  deliveries: 15, rating: 3.9, onTimePct: "#f97316" },
  { initials: "PS", name: "Pacific Steel Corp.",        badge: "PREFERRED" as const, onTime: 93, lead: 4,  deliveries: 31, rating: 4.6, onTimePct: "#22c55e" },
];

// ── Export CSV ────────────────────────────────────────────────────────────────

function exportPOs(orders: PO[]) {
  const header = ["PO Number","Material","Supplier","Qty","Amount","Status","Expected Date"];
  const rows = orders.map(p => [p.number, `"${p.material}"`, `"${p.supplier}"`, p.qty, p.amount, p.status, p.expectedDate].join(","));
  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "purchase-orders.csv"; a.click();
  URL.revokeObjectURL(url);
  toast.success("Purchase orders exported");
}

// ── New PO Modal ──────────────────────────────────────────────────────────────

const SUPPLIERS_LIST = ["Holcim Philippines", "Manila Cement Corp.", "National Steel PH", "PhilCon Aggregates", "PolyCon Philippines"];

function NewPOModal({ onClose, onAdd }: { onClose: () => void; onAdd: (po: PO) => void }) {
  const [form, setForm] = useState({ material: "", supplier: SUPPLIERS_LIST[0], qty: "", unit: "bags", amount: "", expectedDate: "", notes: "" });
  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  function handleSubmit() {
    if (!form.material || !form.qty || !form.amount || !form.expectedDate) {
      toast.error("Please fill in all required fields"); return;
    }
    const num = `PO-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    onAdd({ number: num, material: form.material, supplier: form.supplier, qty: `${form.qty} ${form.unit}`, amount: Number(form.amount), status: "PENDING", expectedDate: form.expectedDate });
    toast.success(`${num} created`);
    onClose();
  }

  const inp = (label: string, key: string, type = "text", placeholder = "", required = true) => (
    <div>
      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>
        {label}{required && <span style={{ color: "#dc2626" }}> *</span>}
      </label>
      <input type={type} value={(form as Record<string, string>)[key]} onChange={e => set(key, e.target.value)} placeholder={placeholder}
        style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 7, border: "1px solid #e5e7eb", fontSize: "0.85rem", outline: "none", color: "#111827" }}
        onFocus={e => (e.currentTarget.style.borderColor = "#f97316")}
        onBlur={e  => (e.currentTarget.style.borderColor = "#e5e7eb")}
      />
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 500, boxShadow: "0 24px 60px rgba(0,0,0,0.2)", maxHeight: "90vh", overflowY: "auto" }}>
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
          {inp("Material", "material", "text", "e.g. Portland Cement")}

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>
              Supplier <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <select value={form.supplier} onChange={e => set("supplier", e.target.value)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid #e5e7eb", fontSize: "0.85rem", outline: "none", color: "#111827", appearance: "none" as const }}>
              {SUPPLIERS_LIST.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.75rem" }}>
            {inp("Quantity", "qty", "number", "e.g. 500")}
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>Unit</label>
              <select value={form.unit} onChange={e => set("unit", e.target.value)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid #e5e7eb", fontSize: "0.85rem", outline: "none", color: "#111827", appearance: "none" as const }}>
                {["bags","pcs","m³","m","rolls","sheets"].map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            {inp("Total Amount (₱)", "amount", "number", "e.g. 142500")}
            {inp("Expected Delivery", "expectedDate", "text", "e.g. Jun 28, 2026")}
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>Notes <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span></label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Any additional notes..."
              rows={3}
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 7, border: "1px solid #e5e7eb", fontSize: "0.85rem", outline: "none", color: "#111827", resize: "vertical" as const }}
              onFocus={e => (e.currentTarget.style.borderColor = "#f97316")}
              onBlur={e  => (e.currentTarget.style.borderColor = "#e5e7eb")}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSubmit} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontWeight: 700, fontSize: "0.875rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Plus style={{ width: 14, height: 14 }} /> Create PO
          </button>
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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProcurementPage() {
  const [tab,      setTab]      = useState<"po" | "suppliers">("po");
  const [orders,   setOrders]   = useState<PO[]>(PURCHASE_ORDERS);
  const [showNewPO, setShowNewPO] = useState(false);

  function countByStatus(s: POStatus) { return orders.filter(p => p.status === s).length; }

  const counts = {
    pending:   countByStatus("PENDING"),
    approved:  countByStatus("APPROVED"),
    transit:   countByStatus("TRANSIT"),
    delayed:   countByStatus("DELAYED"),
  };

  // ── R4: weather-adjusted delivery risk ──────────────────────────────────
  const snapshot = useWeatherStore(s => s.snapshot);
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

  return (
    <div style={{ background: "#f5f4f0" }}>
      {showNewPO && <NewPOModal onClose={() => setShowNewPO(false)} onAdd={po => setOrders(prev => [po, ...prev])} />}
      <Header title="Procurement" />

      <div style={{ padding: "1.25rem 1.5rem" }}>

        {/* ── 4 stat cards ─────────────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
          {[
            { icon: Clock,        color: "#6b7280", bg: "#f3f4f6", label: "Pending POs",  value: counts.pending  },
            { icon: CheckCircle2, color: "#16a34a", bg: "#dcfce7", label: "Approved POs", value: counts.approved },
            { icon: Truck,        color: "#1d4ed8", bg: "#dbeafe", label: "In Transit",   value: counts.transit  },
            { icon: AlertTriangle,color: "#dc2626", bg: "#fee2e2", label: "Delayed",      value: counts.delayed  },
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
          <div style={{
            background: RISK_VISUALS[risk.level].bg,
            border: `1px solid ${RISK_VISUALS[risk.level].border}`,
            borderRadius: 14, padding: "1rem 1.25rem", marginBottom: "1.5rem",
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
                    <span style={{ fontSize: "0.76rem", fontWeight: 600, color: "#111827" }}>{po.number} · {po.material} <span style={{ color: "#9ca3af", fontWeight: 400 }}>({po.supplier})</span></span>
                    <span style={{ fontSize: "0.72rem", color: "#b45309", fontWeight: 600, whiteSpace: "nowrap" }}>+{po.bufferDays}d buffer</span>
                  </div>
                ))}
              </div>
            )}
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
          <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>

            {/* PO table */}
            <div style={{ flex: 1, minWidth: 0, background: "#fff", borderRadius: 12, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ShoppingCart style={{ width: 16, height: 16, color: "#f97316" }} />
                  <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Purchase Orders</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setShowNewPO(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" }}>
                    <Plus style={{ width: 14, height: 14 }} /> New PO
                  </button>
                  <button onClick={() => exportPOs(orders)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "0.8rem", fontWeight: 500, cursor: "pointer" }}>
                    <Download style={{ width: 14, height: 14 }} /> Export
                  </button>
                </div>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                    {["PO NUMBER","MATERIAL","SUPPLIER","QTY","AMOUNT","STATUS","EXPECTED DATE","ACTION"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: "0.65rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((po, i) => {
                    const st = PO_STATUS_STYLE[po.status];
                    return (
                      <tr key={po.number + i} style={{ borderBottom: i < orders.length - 1 ? "1px solid #f9fafb" : "none" }}>
                        <td style={{ padding: "14px 12px" }}>
                          <span style={{ fontWeight: 700, fontSize: "0.8rem", color: "#f97316" }}>{po.number}</span>
                        </td>
                        <td style={{ padding: "14px 12px" }}>
                          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#111827" }}>{po.material}</span>
                        </td>
                        <td style={{ padding: "14px 12px", fontSize: "0.78rem", color: "#6b7280" }}>{po.supplier}</td>
                        <td style={{ padding: "14px 12px", fontSize: "0.8rem", color: "#374151", fontWeight: 500 }}>{po.qty}</td>
                        <td style={{ padding: "14px 12px", fontSize: "0.82rem", fontWeight: 700, color: "#111827" }}>
                          ₱{po.amount.toLocaleString()}
                        </td>
                        <td style={{ padding: "14px 12px" }}>
                          <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: st.bg, color: st.color, whiteSpace: "nowrap" }}>
                            · {po.status}
                          </span>
                        </td>
                        <td style={{ padding: "14px 12px", fontSize: "0.78rem", color: "#6b7280", whiteSpace: "nowrap" }}>{po.expectedDate}</td>
                        <td style={{ padding: "14px 12px" }}>
                          <div style={{ display: "flex", gap: 10 }}>
                            <button title="View" style={{ color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                              <BookOpen style={{ width: 15, height: 15 }} />
                            </button>
                            <button title="Approve" style={{ color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                              <CheckSquare style={{ width: 15, height: 15 }} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* PO Timeline */}
            <div style={{ width: 240, flexShrink: 0, background: "#fff", borderRadius: 12, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.25rem" }}>
                <Clock style={{ width: 15, height: 15, color: "#f97316" }} />
                <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>PO Timeline</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {TIMELINE_STEPS.map((step, i) => (
                  <div key={step.label} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    {/* Dot + line */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                      <div style={{
                        width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                        background: step.done ? "#22c55e" : step.active ? "#f97316" : "#e5e7eb",
                        border: step.done ? "2px solid #22c55e" : step.active ? "2px solid #f97316" : "2px solid #d1d5db",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        marginTop: 2,
                      }}>
                        {step.done && <span style={{ color: "#fff", fontSize: "0.5rem", fontWeight: 900 }}>✓</span>}
                        {step.active && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />}
                      </div>
                      {i < TIMELINE_STEPS.length - 1 && (
                        <div style={{ width: 2, flex: 1, background: step.done ? "#22c55e" : "#e5e7eb", minHeight: 28, marginTop: 2 }} />
                      )}
                    </div>

                    {/* Text */}
                    <div style={{ paddingBottom: i < TIMELINE_STEPS.length - 1 ? "1rem" : 0 }}>
                      <p style={{ fontSize: "0.8rem", fontWeight: step.active ? 700 : 500, color: step.done || step.active ? "#111827" : "#9ca3af" }}>{step.label}</p>
                      <p style={{ fontSize: "0.67rem", color: "#9ca3af", marginTop: 1 }}>{step.date}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* ────────────────────────────────────────────────────────────────── */}
        {/* Tab: Suppliers                                                     */}
        {/* ────────────────────────────────────────────────────────────────── */}
        {tab === "suppliers" && (
          <div>

            {/* 2×2 Supplier cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.25rem" }}>
              {SUPPLIERS.map(s => {
                const badge = BADGE_STYLE[s.badge];
                return (
                  <div key={s.name} style={{ background: "#fff", borderRadius: 14, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 48, height: 48, borderRadius: 10, background: s.avatarBg, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: "0.875rem", flexShrink: 0 }}>
                          {s.initials}
                        </div>
                        <div>
                          <p style={{ fontWeight: 700, fontSize: "0.95rem", color: "#111827" }}>{s.name}</p>
                          <p style={{ fontSize: "0.72rem", color: "#9ca3af", marginTop: 2 }}>{s.category} · Lead: {s.lead}</p>
                        </div>
                      </div>
                      <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: badge.bg, color: badge.color, whiteSpace: "nowrap" }}>
                        · {s.badge}
                      </span>
                    </div>

                    {/* 3 stat boxes */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", marginBottom: "0.875rem" }}>
                      {[
                        { label: "Rating",     value: s.rating.toFixed(1) },
                        { label: "Deliveries", value: s.deliveries        },
                        { label: "On-Time",    value: `${s.onTime}%`     },
                      ].map(b => (
                        <div key={b.label} style={{ background: "#f9fafb", borderRadius: 8, padding: "0.6rem", textAlign: "center" }}>
                          <p style={{ fontSize: "1rem", fontWeight: 700, color: "#111827" }}>{b.value}</p>
                          <p style={{ fontSize: "0.62rem", color: "#9ca3af", marginTop: 2 }}>{b.label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Stars + buttons */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Stars rating={s.rating} />
                        <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "#374151" }}>{s.rating.toFixed(1)}</span>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}>
                          <Send style={{ width: 12, height: 12 }} /> Contact
                        </button>
                        <button style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}>
                          <History style={{ width: 12, height: 12 }} /> History
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Supplier Performance */}
            <div style={{ background: "#fff", borderRadius: 14, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
              <p style={{ fontWeight: 700, fontSize: "0.95rem", color: "#111827", marginBottom: "1rem" }}>Supplier Performance</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
                {PERF_SUPPLIERS.map(s => {
                  const badge = BADGE_STYLE[s.badge];
                  return (
                    <div key={s.name} style={{ background: "#1e3154", borderRadius: 12, padding: "1.1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.875rem" }}>
                        <Truck style={{ width: 18, height: 18, color: "#94a3b8" }} />
                        <span style={{ fontSize: "0.6rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: badge.bg, color: badge.color }}>
                          {s.badge}
                        </span>
                      </div>
                      <p style={{ fontWeight: 700, fontSize: "0.85rem", color: "#fff", marginBottom: "0.75rem" }}>{s.name}</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.75rem" }}>
                        {[
                          { label: "On-Time Delivery", value: `${s.onTime}%`, color: s.onTimePct },
                          { label: "Avg. Lead Time",   value: `${s.lead} days`, color: "#fff"    },
                          { label: "Total Deliveries", value: String(s.deliveries), color: "#fff" },
                        ].map(r => (
                          <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                            <span style={{ fontSize: "0.68rem", color: "#94a3b8" }}>{r.label}</span>
                            <span style={{ fontSize: "0.78rem", fontWeight: 700, color: r.color }}>{r.value}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <Stars rating={s.rating} />
                        <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>{s.rating.toFixed(1)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
