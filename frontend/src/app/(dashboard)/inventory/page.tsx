"use client";

import { useState, useMemo } from "react";
import Header from "@/components/layout/Header";
import {
  Package, CheckCircle2, AlertTriangle, AlertCircle, TrendingUp,
  Search, Filter, Download, BookOpen, Pencil, Trash2,
} from "lucide-react";

// ── Types & data ──────────────────────────────────────────────────────────────

type Status = "NORMAL" | "LOW" | "CRITICAL" | "OVERSTOCK";

interface Item {
  id: number;
  name: string;
  category: string;
  stock: number;
  unit: string;
  min: number;
  max: number;
  status: Status;
  price: number;
  supplier: string;
  site: string;
}

const ITEMS: Item[] = [
  { id:  1, name: "Portland Cement",          category: "Binders",    stock: 1240, unit: "bags",   min: 500,  max: 2000, status: "NORMAL",    price: 285,   supplier: "Manila Cement Co.",       site: "BGC Tower"          },
  { id:  2, name: "Fine Aggregate (Sand)",     category: "Aggregates", stock: 88,   unit: "m³",    min: 50,   max: 200,  status: "NORMAL",    price: 1200,  supplier: "PhilCon Aggregates",      site: "Metro Station Ph.3" },
  { id:  3, name: "Coarse Gravel",             category: "Aggregates", stock: 42,   unit: "m³",    min: 60,   max: 180,  status: "LOW",       price: 1450,  supplier: "PhilCon Aggregates",      site: "Metro Station Ph.3" },
  { id:  4, name: "Deformed Steel Bars (10mm)",category: "Steel",      stock: 3200, unit: "pcs",   min: 1000, max: 5000, status: "NORMAL",    price: 185,   supplier: "National Steel PH",       site: "BGC Tower"          },
  { id:  5, name: "Deformed Steel Bars (12mm)",category: "Steel",      stock: 280,  unit: "pcs",   min: 500,  max: 3000, status: "CRITICAL",  price: 220,   supplier: "National Steel PH",       site: "Harbor Bridge"      },
  { id:  6, name: "PVC Pipes (2-inch)",        category: "Plumbing",   stock: 2800, unit: "pcs",   min: 200,  max: 1000, status: "OVERSTOCK", price: 145,   supplier: "PolyCon Philippines",     site: "BGC Tower"          },
  { id:  7, name: "Hollow Blocks (4\")",       category: "Masonry",    stock: 4500, unit: "pcs",   min: 1000, max: 6000, status: "NORMAL",    price: 14,    supplier: "CEMEX Philippines",       site: "Metro Station Ph.3" },
  { id:  8, name: "Plywood (1/2 inch)",        category: "Formwork",   stock: 320,  unit: "sheets",min: 100,  max: 600,  status: "NORMAL",    price: 425,   supplier: "Durawood Supplies",       site: "BGC Tower"          },
  { id:  9, name: "G.I. Pipes (1-inch)",       category: "Plumbing",   stock: 45,   unit: "m",     min: 80,   max: 300,  status: "LOW",       price: 380,   supplier: "PolyCon Philippines",     site: "Harbor Bridge"      },
  { id: 10, name: "Ready-mix Concrete",        category: "Binders",    stock: 0,    unit: "m³",    min: 50,   max: 200,  status: "CRITICAL",  price: 5500,  supplier: "Holcim Philippines",      site: "BGC Tower"          },
  { id: 11, name: "G.I. Wire (16 gauge)",      category: "Steel",      stock: 850,  unit: "rolls", min: 200,  max: 800,  status: "OVERSTOCK", price: 95,    supplier: "National Steel PH",       site: "Harbor Bridge"      },
  { id: 12, name: "Portland Cement (Type II)", category: "Binders",    stock: 600,  unit: "bags",  min: 300,  max: 1500, status: "NORMAL",    price: 310,   supplier: "Republic Cement Corp.",   site: "Metro Station Ph.3" },
];

const STATUS_STYLE: Record<Status, { bg: string; color: string; barColor: string }> = {
  NORMAL:    { bg: "#dcfce7", color: "#15803d",  barColor: "#22c55e" },
  LOW:       { bg: "#fef3c7", color: "#b45309",  barColor: "#f59e0b" },
  CRITICAL:  { bg: "#fee2e2", color: "#dc2626",  barColor: "#ef4444" },
  OVERSTOCK: { bg: "#ffedd5", color: "#c2410c",  barColor: "#f97316" },
};

const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  Binders:    { bg: "#e5e7eb", color: "#374151" },
  Aggregates: { bg: "#e5e7eb", color: "#374151" },
  Steel:      { bg: "#dbeafe", color: "#1e40af" },
  Plumbing:   { bg: "#ede9fe", color: "#6d28d9" },
  Masonry:    { bg: "#fce7f3", color: "#9d174d" },
  Formwork:   { bg: "#d1fae5", color: "#065f46" },
};

function stockPct(item: Item) {
  if (item.status === "OVERSTOCK") return Math.min((item.stock / item.max) * 100, 100);
  return Math.min((item.stock / item.max) * 100, 100);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const [search,     setSearch]     = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | Status>("ALL");

  const filtered = useMemo(() => ITEMS.filter(item => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase()) ||
                        item.category.toLowerCase().includes(search.toLowerCase()) ||
                        item.supplier.toLowerCase().includes(search.toLowerCase()) ||
                        item.site.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "ALL" || item.status === statusFilter;
    return matchSearch && matchStatus;
  }), [search, statusFilter]);

  const counts = useMemo(() => ({
    total:     ITEMS.length,
    normal:    ITEMS.filter(i => i.status === "NORMAL").length,
    low:       ITEMS.filter(i => i.status === "LOW").length,
    critical:  ITEMS.filter(i => i.status === "CRITICAL").length,
    overstock: ITEMS.filter(i => i.status === "OVERSTOCK").length,
  }), []);

  return (
    <div style={{ background: "#f5f4f0" }}>
      <Header title="Inventory" />

      <div style={{ padding: "1.25rem 1.5rem" }}>

        {/* ── Stat cards ──────────────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "1rem", marginBottom: "1.25rem" }}>
          {[
            { icon: Package,      color: "#6b7280", bg: "#f3f4f6", label: "Total Items", value: counts.total     },
            { icon: CheckCircle2, color: "#16a34a", bg: "#dcfce7", label: "Normal",      value: counts.normal    },
            { icon: AlertTriangle,color: "#d97706", bg: "#fef3c7", label: "Low Stock",   value: counts.low       },
            { icon: AlertCircle,  color: "#dc2626", bg: "#fee2e2", label: "Critical",    value: counts.critical  },
            { icon: TrendingUp,   color: "#ea580c", bg: "#ffedd5", label: "Overstock",   value: counts.overstock },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} style={{ background: "#fff", borderRadius: 12, padding: "1rem 1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", display: "flex", alignItems: "center", gap: "0.875rem" }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon style={{ width: 20, height: 20, color: s.color }} />
                </div>
                <div>
                  <p style={{ fontSize: "1.6rem", fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</p>
                  <p style={{ fontSize: "0.72rem", color: "#9ca3af", marginTop: 2 }}>{s.label}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Search + filter bar ──────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 15, height: 15, color: "#9ca3af", pointerEvents: "none" }} />
            <input
              suppressHydrationWarning
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search materials..."
              style={{
                width: "100%", boxSizing: "border-box",
                paddingLeft: 36, paddingRight: 12, paddingTop: 9, paddingBottom: 9,
                borderRadius: 8, background: "#fff", border: "1px solid #e5e7eb",
                fontSize: "0.875rem", outline: "none", color: "#111827",
              }}
            />
          </div>

          {/* Status dropdown */}
          <div style={{ position: "relative" }}>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as "ALL" | Status)}
              style={{
                padding: "8px 32px 8px 12px", borderRadius: 8, border: "1px solid #e5e7eb",
                fontSize: "0.875rem", background: "#fff", color: "#374151",
                appearance: "none", cursor: "pointer", outline: "none", fontWeight: 500,
              }}
            >
              <option value="ALL">All Status</option>
              <option value="NORMAL">Normal</option>
              <option value="LOW">Low Stock</option>
              <option value="CRITICAL">Critical</option>
              <option value="OVERSTOCK">Overstock</option>
            </select>
            <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#6b7280", fontSize: "0.7rem" }}>▼</span>
          </div>

          <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "0.875rem", fontWeight: 500, cursor: "pointer" }}>
            <Filter style={{ width: 14, height: 14 }} /> Filter
          </button>

          <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "0.875rem", fontWeight: 500, cursor: "pointer" }}>
            <Download style={{ width: 14, height: 14 }} /> Export
          </button>
        </div>

        {/* ── Table ────────────────────────────────────────────────────────── */}
        <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.07)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                {["#","MATERIAL NAME","CATEGORY","CURRENT STOCK","MIN / MAX","STATUS","UNIT PRICE","SUPPLIER","SITE","ACTION"].map(h => (
                  <th key={h} style={{
                    padding: "10px 14px", textAlign: "left",
                    fontSize: "0.68rem", fontWeight: 700,
                    color: "#6b7280", letterSpacing: "0.05em", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => {
                const st  = STATUS_STYLE[item.status];
                const cat = CATEGORY_COLORS[item.category] ?? { bg: "#e5e7eb", color: "#374151" };
                const pct = stockPct(item);

                return (
                  <tr key={item.id} style={{ borderBottom: idx < filtered.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                    {/* # */}
                    <td style={{ padding: "12px 14px", fontSize: "0.8rem", color: "#9ca3af", fontWeight: 500 }}>{item.id}</td>

                    {/* Name */}
                    <td style={{ padding: "12px 14px" }}>
                      <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#111827" }}>{item.name}</p>
                    </td>

                    {/* Category */}
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ fontSize: "0.68rem", fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: cat.bg, color: cat.color }}>
                        {item.category}
                      </span>
                    </td>

                    {/* Current Stock */}
                    <td style={{ padding: "12px 14px", minWidth: 130 }}>
                      <p style={{ fontSize: "0.82rem", fontWeight: 700, color: item.status === "CRITICAL" ? "#dc2626" : item.status === "LOW" ? "#d97706" : "#111827" }}>
                        {item.stock.toLocaleString()} <span style={{ fontWeight: 400, color: "#9ca3af" }}>{item.unit}</span>
                      </p>
                      <div style={{ marginTop: 4, height: 4, background: "#e5e7eb", borderRadius: 99, width: 100 }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: st.barColor, borderRadius: 99, transition: "width 0.3s" }} />
                      </div>
                    </td>

                    {/* Min/Max */}
                    <td style={{ padding: "12px 14px", fontSize: "0.78rem", color: "#6b7280", whiteSpace: "nowrap" }}>
                      {item.min.toLocaleString()} / {item.max.toLocaleString()}
                    </td>

                    {/* Status */}
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: st.bg, color: st.color, whiteSpace: "nowrap" }}>
                        · {item.status}
                      </span>
                    </td>

                    {/* Unit Price */}
                    <td style={{ padding: "12px 14px", fontSize: "0.82rem", fontWeight: 600, color: "#111827", whiteSpace: "nowrap" }}>
                      ₱{item.price.toLocaleString()}
                    </td>

                    {/* Supplier */}
                    <td style={{ padding: "12px 14px", fontSize: "0.78rem", color: "#6b7280", maxWidth: 130 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                        {item.supplier}
                      </span>
                    </td>

                    {/* Site */}
                    <td style={{ padding: "12px 14px", fontSize: "0.78rem", color: "#6b7280", whiteSpace: "nowrap" }}>
                      {item.site}
                    </td>

                    {/* Action */}
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", gap: 10 }}>
                        <button title="View" style={{ color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                          <BookOpen style={{ width: 15, height: 15 }} />
                        </button>
                        <button title="Edit" style={{ color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                          <Pencil style={{ width: 15, height: 15 }} />
                        </button>
                        <button title="Delete" style={{ color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                          <Trash2 style={{ width: 15, height: 15 }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: "3rem", textAlign: "center", color: "#9ca3af", fontSize: "0.875rem" }}>
                    No materials match your search or filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
