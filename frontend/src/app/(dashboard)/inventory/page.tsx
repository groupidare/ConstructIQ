"use client";

import { useState, useMemo } from "react";
import toast from "react-hot-toast";
import Header from "@/components/layout/Header";
import {
  Package, CheckCircle2, AlertTriangle, AlertCircle, TrendingUp,
  Search, Filter, Download, BookOpen, Pencil, Trash2, X,
} from "lucide-react";

// ── Types & data ──────────────────────────────────────────────────────────────

type Status = "NORMAL" | "LOW" | "CRITICAL" | "OVERSTOCK";

interface Item {
  id: number; name: string; category: string;
  stock: number; unit: string; min: number; max: number;
  status: Status; price: number; supplier: string; site: string;
}

const INITIAL_ITEMS: Item[] = [
  { id:  1, name: "Portland Cement",           category: "Binders",    stock: 1240, unit: "bags",   min: 500,  max: 2000, status: "NORMAL",    price: 310,  supplier: "Manila Cement Co.",       site: "BGC Tower Complex"        },
  { id:  2, name: "Fine Aggregate (Sand)",      category: "Aggregates", stock: 88,   unit: "m³",    min: 50,   max: 200,  status: "NORMAL",    price: 800,  supplier: "PhilCon Aggregates",      site: "Metro Station Phase 3"    },
  { id:  3, name: "Coarse Gravel",              category: "Aggregates", stock: 42,   unit: "m³",    min: 60,   max: 180,  status: "LOW",       price: 1200, supplier: "PhilCon Aggregates",      site: "Metro Station Phase 3"    },
  { id:  4, name: "Deformed Steel Bars (10mm)", category: "Steel",      stock: 3200, unit: "pcs",   min: 1000, max: 5000, status: "NORMAL",    price: 215,  supplier: "National Steel PH",       site: "BGC Tower Complex"        },
  { id:  5, name: "Deformed Steel Bars (12mm)", category: "Steel",      stock: 280,  unit: "pcs",   min: 500,  max: 3000, status: "CRITICAL",  price: 310,  supplier: "National Steel PH",       site: "Harbor Bridge Renovation" },
  { id:  6, name: "PVC Pipes (2-inch)",         category: "Plumbing",   stock: 2800, unit: "pcs",   min: 200,  max: 1000, status: "OVERSTOCK", price: 145,  supplier: "PolyCon Philippines",     site: "BGC Tower Complex"        },
  { id:  7, name: "Hollow Blocks (4\")",        category: "Masonry",    stock: 4500, unit: "pcs",   min: 1000, max: 6000, status: "NORMAL",    price: 12,   supplier: "CEMEX Philippines",       site: "Metro Station Phase 3"    },
  { id:  8, name: "Plywood (1/2 inch)",         category: "Formwork",   stock: 320,  unit: "sheets",min: 100,  max: 600,  status: "NORMAL",    price: 820,  supplier: "Durawood Supplies",       site: "Southgate Mall Expansion" },
  { id:  9, name: "G.I. Pipes (1-inch)",        category: "Plumbing",   stock: 45,   unit: "m",     min: 80,   max: 300,  status: "LOW",       price: 380,  supplier: "PolyCon Philippines",     site: "Harbor Bridge Renovation" },
  { id: 10, name: "Ready-mix Concrete",         category: "Binders",    stock: 0,    unit: "m³",    min: 50,   max: 200,  status: "CRITICAL",  price: 5500, supplier: "Holcim Philippines",      site: "BGC Tower Complex"        },
  { id: 11, name: "G.I. Wire (16 gauge)",       category: "Steel",      stock: 850,  unit: "rolls", min: 200,  max: 800,  status: "OVERSTOCK", price: 1800, supplier: "National Steel PH",       site: "Harbor Bridge Renovation" },
  { id: 12, name: "Portland Cement (Type II)",  category: "Binders",    stock: 600,  unit: "bags",  min: 300,  max: 1500, status: "NORMAL",    price: 310,  supplier: "Republic Cement Corp.",   site: "Metro Station Phase 3"    },
  { id: 13, name: "Ceramic Floor Tile 60x60",   category: "Finishing",  stock: 210,  unit: "sqm",   min: 100,  max: 500,  status: "NORMAL",    price: 420,  supplier: "Mariwasa Siam Ceramics",  site: "PUP ICTC Building"        },
  { id: 14, name: "Pre-painted GI Sheet",       category: "Roofing",    stock: 340,  unit: "m",     min: 150,  max: 700,  status: "NORMAL",    price: 180,  supplier: "Union Galvasteel",        site: "ICTC HALL"                },
  { id: 15, name: "THHN Wire #12",              category: "Electrical",stock: 18,   unit: "rolls", min: 15,   max: 60,   status: "LOW",       price: 2800, supplier: "Phelps Dodge Philippines",site: "PUP North Wing"           },
  { id: 16, name: "Hollow Blocks 6\"",          category: "Masonry",    stock: 2100, unit: "pcs",   min: 800,  max: 4000, status: "NORMAL",    price: 15,   supplier: "CEMEX Philippines",       site: "Group 11 House"           },
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
  Finishing:  { bg: "#fef3c7", color: "#92400e" },
  Roofing:    { bg: "#ffedd5", color: "#c2410c" },
  Electrical: { bg: "#fee2e2", color: "#b91c1c" },
};

const ALL_CATEGORIES = ["All", ...Array.from(new Set(INITIAL_ITEMS.map(i => i.category)))];

function deriveStatus(stock: number, min: number, max: number): Status {
  if (stock === 0 || stock < min * 0.5) return "CRITICAL";
  if (stock < min) return "LOW";
  if (stock > max) return "OVERSTOCK";
  return "NORMAL";
}

// ── Shared modal backdrop ─────────────────────────────────────────────────────

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:"1rem" }}>
      <div onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  );
}

// ── View Modal ────────────────────────────────────────────────────────────────

function ViewModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const st = STATUS_STYLE[item.status];
  const pct = Math.min((item.stock / item.max) * 100, 100);
  return (
    <Backdrop onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:460, boxShadow:"0 24px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.25rem" }}>
          <h2 style={{ fontWeight:800, fontSize:"1.1rem" }}>Material Details</h2>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:18, height:18 }} /></button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:"0.875rem" }}>
          <div style={{ padding:"1rem", background:"#f9fafb", borderRadius:10 }}>
            <p style={{ fontWeight:700, fontSize:"1rem", color:"#111827" }}>{item.name}</p>
            <p style={{ fontSize:"0.78rem", color:"#9ca3af", marginTop:4 }}>{item.category} · {item.site}</p>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
            {[
              { label:"Current Stock", value:`${item.stock.toLocaleString()} ${item.unit}` },
              { label:"Unit Price",    value:`₱${item.price.toLocaleString()}` },
              { label:"Min Stock",     value:`${item.min.toLocaleString()} ${item.unit}` },
              { label:"Max Stock",     value:`${item.max.toLocaleString()} ${item.unit}` },
              { label:"Supplier",      value:item.supplier },
              { label:"Status",        value:item.status },
            ].map(f => (
              <div key={f.label} style={{ padding:"0.75rem", background:"#f9fafb", borderRadius:8 }}>
                <p style={{ fontSize:"0.68rem", color:"#9ca3af", marginBottom:3 }}>{f.label}</p>
                <p style={{ fontSize:"0.85rem", fontWeight:600, color: f.label==="Status" ? st.color : "#111827" }}>{f.value}</p>
              </div>
            ))}
          </div>
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
              <span style={{ fontSize:"0.72rem", color:"#6b7280" }}>Stock level</span>
              <span style={{ fontSize:"0.72rem", fontWeight:600, color:st.color }}>{pct.toFixed(0)}%</span>
            </div>
            <div style={{ height:8, background:"#e5e7eb", borderRadius:99 }}>
              <div style={{ height:"100%", width:`${pct}%`, background:st.barColor, borderRadius:99, transition:"width 0.3s" }} />
            </div>
          </div>
        </div>
      </div>
    </Backdrop>
  );
}

// ── Edit Modal ────────────────────────────────────────────────────────────────

function EditModal({ item, onClose, onSave }: { item: Item; onClose: () => void; onSave: (updated: Item) => void }) {
  const [form, setForm] = useState({ ...item });
  function set(k: keyof Item, v: string | number) { setForm(f => ({ ...f, [k]: v })); }
  function handleSave() {
    const status = deriveStatus(Number(form.stock), Number(form.min), Number(form.max));
    onSave({ ...form, stock: Number(form.stock), min: Number(form.min), max: Number(form.max), price: Number(form.price), status });
    toast.success(`${form.name} updated`);
    onClose();
  }
  const inp = (label: string, key: keyof Item, type = "text") => (
    <div>
      <label style={{ display:"block", fontSize:"0.75rem", fontWeight:600, color:"#374151", marginBottom:4 }}>{label}</label>
      <input type={type} value={String(form[key])} onChange={e => set(key, e.target.value)}
        style={{ width:"100%", boxSizing:"border-box", padding:"8px 10px", borderRadius:7, border:"1px solid #e5e7eb", fontSize:"0.85rem", outline:"none", color:"#111827" }}
        onFocus={e => (e.currentTarget.style.borderColor = "#f97316")}
        onBlur={e  => (e.currentTarget.style.borderColor = "#e5e7eb")}
      />
    </div>
  );
  return (
    <Backdrop onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem", width:460, boxShadow:"0 24px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.25rem" }}>
          <h2 style={{ fontWeight:800, fontSize:"1.1rem" }}>Edit Material</h2>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#9ca3af" }}><X style={{ width:18, height:18 }} /></button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:"0.875rem" }}>
          {inp("Material Name", "name")}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
            {inp("Current Stock", "stock", "number")}
            {inp("Unit", "unit")}
            {inp("Min Stock", "min", "number")}
            {inp("Max Stock", "max", "number")}
            {inp("Unit Price (₱)", "price", "number")}
            {inp("Supplier", "supplier")}
            {inp("Site", "site")}
          </div>
        </div>
        <div style={{ display:"flex", gap:"0.75rem", marginTop:"1.25rem" }}>
          <button onClick={onClose} style={{ flex:1, padding:"10px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", fontWeight:600, fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={handleSave} style={{ flex:1, padding:"10px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontWeight:700, fontSize:"0.875rem", cursor:"pointer" }}>Save Changes</button>
        </div>
      </div>
    </Backdrop>
  );
}

// ── Delete Confirm ────────────────────────────────────────────────────────────

function DeleteModal({ item, onClose, onConfirm }: { item: Item; onClose: () => void; onConfirm: () => void }) {
  return (
    <Backdrop onClose={onClose}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.75rem 1.5rem", width:400, textAlign:"center", boxShadow:"0 24px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ width:56, height:56, borderRadius:"50%", background:"#fee2e2", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 1rem" }}>
          <Trash2 style={{ width:24, height:24, color:"#dc2626" }} />
        </div>
        <h2 style={{ fontWeight:800, fontSize:"1.05rem", marginBottom:"0.5rem" }}>Delete Material?</h2>
        <p style={{ fontSize:"0.83rem", color:"#6b7280", marginBottom:"1.5rem" }}>
          Are you sure you want to remove <strong>{item.name}</strong>? This action cannot be undone.
        </p>
        <div style={{ display:"flex", gap:"0.75rem" }}>
          <button onClick={onClose} style={{ flex:1, padding:"10px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", fontWeight:600, fontSize:"0.875rem", cursor:"pointer" }}>Cancel</button>
          <button onClick={onConfirm} style={{ flex:1, padding:"10px", borderRadius:8, border:"none", background:"#dc2626", color:"#fff", fontWeight:700, fontSize:"0.875rem", cursor:"pointer" }}>Delete</button>
        </div>
      </div>
    </Backdrop>
  );
}

// ── Filter Panel ──────────────────────────────────────────────────────────────

function FilterPanel({ category, setCategory, onClose }: { category: string; setCategory: (c: string) => void; onClose: () => void }) {
  return (
    <div style={{ position:"absolute", top:"calc(100% + 6px)", right:0, background:"#fff", borderRadius:10, boxShadow:"0 8px 24px rgba(0,0,0,0.13)", padding:"1rem", zIndex:200, minWidth:200, border:"1px solid #e5e7eb" }}>
      <p style={{ fontWeight:700, fontSize:"0.8rem", color:"#374151", marginBottom:"0.75rem" }}>Filter by Category</p>
      {ALL_CATEGORIES.map(c => (
        <button key={c} onClick={() => { setCategory(c); onClose(); }}
          style={{ display:"block", width:"100%", textAlign:"left", padding:"7px 10px", borderRadius:6, border:"none", background: category === c ? "#fff7ed" : "transparent", color: category === c ? "#f97316" : "#374151", fontWeight: category === c ? 700 : 400, fontSize:"0.82rem", cursor:"pointer", marginBottom:2 }}>
          {c}
        </button>
      ))}
    </div>
  );
}

// ── Export CSV helper ─────────────────────────────────────────────────────────

function exportCSV(items: Item[]) {
  const header = ["ID","Name","Category","Stock","Unit","Min","Max","Status","Unit Price","Supplier","Site"];
  const rows = items.map(i => [i.id,`"${i.name}"`,i.category,i.stock,i.unit,i.min,i.max,i.status,i.price,`"${i.supplier}"`,`"${i.site}"`].join(","));
  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "inventory.csv"; a.click();
  URL.revokeObjectURL(url);
  toast.success("Inventory exported");
}

// ── Page ──────────────────────────────────────────────────────────────────────

type ModalState =
  | { type: "view";   item: Item }
  | { type: "edit";   item: Item }
  | { type: "delete"; item: Item }
  | null;

export default function InventoryPage() {
  const [items,          setItems]          = useState<Item[]>(INITIAL_ITEMS);
  const [search,         setSearch]         = useState("");
  const [statusFilter,   setStatusFilter]   = useState<"ALL" | Status>("ALL");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [modal,          setModal]          = useState<ModalState>(null);
  const [filterOpen,     setFilterOpen]     = useState(false);

  const filtered = useMemo(() => items.filter(item => {
    const q = search.toLowerCase();
    const matchSearch = item.name.toLowerCase().includes(q) || item.category.toLowerCase().includes(q) || item.supplier.toLowerCase().includes(q) || item.site.toLowerCase().includes(q);
    const matchStatus = statusFilter === "ALL" || item.status === statusFilter;
    const matchCat = categoryFilter === "All" || item.category === categoryFilter;
    return matchSearch && matchStatus && matchCat;
  }), [items, search, statusFilter, categoryFilter]);

  const counts = useMemo(() => ({
    total:     items.length,
    normal:    items.filter(i => i.status === "NORMAL").length,
    low:       items.filter(i => i.status === "LOW").length,
    critical:  items.filter(i => i.status === "CRITICAL").length,
    overstock: items.filter(i => i.status === "OVERSTOCK").length,
  }), [items]);

  function handleSave(updated: Item) { setItems(prev => prev.map(i => i.id === updated.id ? updated : i)); }
  function handleDelete(id: number) {
    const name = items.find(i => i.id === id)?.name ?? "Item";
    setItems(prev => prev.filter(i => i.id !== id));
    toast.success(`${name} removed`);
    setModal(null);
  }

  return (
    <div style={{ background: "#f5f4f0" }}>
      {/* Modals */}
      {modal?.type === "view"   && <ViewModal   item={modal.item} onClose={() => setModal(null)} />}
      {modal?.type === "edit"   && <EditModal   item={modal.item} onClose={() => setModal(null)} onSave={handleSave} />}
      {modal?.type === "delete" && <DeleteModal item={modal.item} onClose={() => setModal(null)} onConfirm={() => handleDelete(modal.item.id)} />}

      <Header title="Inventory" />

      <div style={{ padding: "1.25rem 1.5rem" }}>

        {/* ── Stat cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "1rem", marginBottom: "1.25rem" }}>
          {[
            { icon: Package,       color: "#6b7280", bg: "#f3f4f6", label: "Total Items", value: counts.total,     filter: "ALL"      },
            { icon: CheckCircle2,  color: "#16a34a", bg: "#dcfce7", label: "Normal",      value: counts.normal,    filter: "NORMAL"   },
            { icon: AlertTriangle, color: "#d97706", bg: "#fef3c7", label: "Low Stock",   value: counts.low,       filter: "LOW"      },
            { icon: AlertCircle,   color: "#dc2626", bg: "#fee2e2", label: "Critical",    value: counts.critical,  filter: "CRITICAL" },
            { icon: TrendingUp,    color: "#ea580c", bg: "#ffedd5", label: "Overstock",   value: counts.overstock, filter: "OVERSTOCK"},
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} onClick={() => setStatusFilter(s.filter as "ALL" | Status)}
                style={{ background: "#fff", borderRadius: 12, padding: "1rem 1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", display: "flex", alignItems: "center", gap: "0.875rem", cursor: "pointer", border: statusFilter === s.filter ? `1.5px solid ${s.color}` : "1.5px solid transparent", transition:"border 0.15s" }}>
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

        {/* ── Search + filter bar ── */}
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 15, height: 15, color: "#9ca3af", pointerEvents: "none" }} />
            <input suppressHydrationWarning value={search} onChange={e => setSearch(e.target.value)} placeholder="Search materials, supplier, site..."
              style={{ width: "100%", boxSizing: "border-box", paddingLeft: 36, paddingRight: 12, paddingTop: 9, paddingBottom: 9, borderRadius: 8, background: "#fff", border: "1px solid #e5e7eb", fontSize: "0.875rem", outline: "none", color: "#111827" }} />
          </div>

          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as "ALL" | Status)}
            style={{ padding: "8px 32px 8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: "0.875rem", background: "#fff", color: "#374151", appearance: "none" as const, cursor: "pointer", outline: "none", fontWeight: 500 }}>
            <option value="ALL">All Status</option>
            <option value="NORMAL">Normal</option>
            <option value="LOW">Low Stock</option>
            <option value="CRITICAL">Critical</option>
            <option value="OVERSTOCK">Overstock</option>
          </select>

          {/* Filter button with dropdown */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setFilterOpen(o => !o)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: categoryFilter !== "All" ? "1.5px solid #f97316" : "1px solid #e5e7eb", background: categoryFilter !== "All" ? "#fff7ed" : "#fff", color: categoryFilter !== "All" ? "#f97316" : "#374151", fontSize: "0.875rem", fontWeight: 500, cursor: "pointer" }}>
              <Filter style={{ width: 14, height: 14 }} /> {categoryFilter !== "All" ? categoryFilter : "Filter"}
            </button>
            {filterOpen && <FilterPanel category={categoryFilter} setCategory={setCategoryFilter} onClose={() => setFilterOpen(false)} />}
          </div>

          <button onClick={() => exportCSV(filtered)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "0.875rem", fontWeight: 500, cursor: "pointer" }}>
            <Download style={{ width: 14, height: 14 }} /> Export
          </button>
        </div>

        {/* ── Table ── */}
        <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.07)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                {["#","MATERIAL NAME","CATEGORY","CURRENT STOCK","MIN / MAX","STATUS","UNIT PRICE","SUPPLIER","SITE","ACTION"].map(h => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: "0.68rem", fontWeight: 700, color: "#6b7280", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => {
                const st  = STATUS_STYLE[item.status];
                const cat = CATEGORY_COLORS[item.category] ?? { bg: "#e5e7eb", color: "#374151" };
                const pct = Math.min((item.stock / item.max) * 100, 100);
                return (
                  <tr key={item.id} style={{ borderBottom: idx < filtered.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                    <td style={{ padding: "12px 14px", fontSize: "0.8rem", color: "#9ca3af", fontWeight: 500 }}>{item.id}</td>
                    <td style={{ padding: "12px 14px" }}><p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#111827" }}>{item.name}</p></td>
                    <td style={{ padding: "12px 14px" }}><span style={{ fontSize: "0.68rem", fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: cat.bg, color: cat.color }}>{item.category}</span></td>
                    <td style={{ padding: "12px 14px", minWidth: 130 }}>
                      <p style={{ fontSize: "0.82rem", fontWeight: 700, color: item.status === "CRITICAL" ? "#dc2626" : item.status === "LOW" ? "#d97706" : "#111827" }}>
                        {item.stock.toLocaleString()} <span style={{ fontWeight: 400, color: "#9ca3af" }}>{item.unit}</span>
                      </p>
                      <div style={{ marginTop: 4, height: 4, background: "#e5e7eb", borderRadius: 99, width: 100 }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: st.barColor, borderRadius: 99 }} />
                      </div>
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: "0.78rem", color: "#6b7280", whiteSpace: "nowrap" }}>{item.min.toLocaleString()} / {item.max.toLocaleString()}</td>
                    <td style={{ padding: "12px 14px" }}><span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: st.bg, color: st.color, whiteSpace: "nowrap" }}>· {item.status}</span></td>
                    <td style={{ padding: "12px 14px", fontSize: "0.82rem", fontWeight: 600, color: "#111827", whiteSpace: "nowrap" }}>₱{item.price.toLocaleString()}</td>
                    <td style={{ padding: "12px 14px", fontSize: "0.78rem", color: "#6b7280", maxWidth: 130 }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{item.supplier}</span></td>
                    <td style={{ padding: "12px 14px", fontSize: "0.78rem", color: "#6b7280", whiteSpace: "nowrap" }}>{item.site}</td>
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", gap: 10 }}>
                        <button title="View" onClick={() => setModal({ type:"view", item })} style={{ color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: 2, borderRadius:4, transition:"color 0.15s" }}
                          onMouseEnter={e => (e.currentTarget.style.color = "#3b82f6")}
                          onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}>
                          <BookOpen style={{ width: 15, height: 15 }} />
                        </button>
                        <button title="Edit" onClick={() => setModal({ type:"edit", item })} style={{ color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: 2, borderRadius:4, transition:"color 0.15s" }}
                          onMouseEnter={e => (e.currentTarget.style.color = "#f97316")}
                          onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}>
                          <Pencil style={{ width: 15, height: 15 }} />
                        </button>
                        <button title="Delete" onClick={() => setModal({ type:"delete", item })} style={{ color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: 2, borderRadius:4, transition:"color 0.15s" }}
                          onMouseEnter={e => (e.currentTarget.style.color = "#dc2626")}
                          onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}>
                          <Trash2 style={{ width: 15, height: 15 }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={10} style={{ padding: "3rem", textAlign: "center", color: "#9ca3af", fontSize: "0.875rem" }}>No materials match your search or filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
