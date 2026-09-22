"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Header from "@/components/layout/Header";
import { useAuthStore } from "@/store/authStore";
import { useWarehouseStock } from "@/hooks/useWarehouseStock";
import {
  Package, AlertCircle, RefreshCw, Search, Download, Clock, ArrowDownAZ,
} from "lucide-react";

// ── Export CSV helper ─────────────────────────────────────────────────────────

function exportCSV(items: { materialName: string; unit: string; balance: number }[]) {
  const header = ["Material Name", "Unit", "Balance"];
  const rows = items.map(i => [`"${i.materialName}"`, i.unit, i.balance].join(","));
  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "warehouse-stock-balance.csv"; a.click();
  URL.revokeObjectURL(url);
  toast.success("Stock balance exported");
}

function formatSyncedAt(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const { items, loading, syncing, fetchItems, sync } = useWarehouseStock();
  const [search, setSearch] = useState("");
  const [sortAZ, setSortAZ] = useState(false);
  const { user } = useAuthStore();
  const role = user?.role ?? "SiteEngineer";
  const canSync = role === "Admin" || role === "WarehousePersonnel";

  useEffect(() => { fetchItems(); }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const result = items.filter(i => !q || i.materialName.toLowerCase().includes(q) || i.unit.toLowerCase().includes(q));
    if (sortAZ) {
      return [...result].sort((a, b) => a.materialName.localeCompare(b.materialName));
    }
    return result;
  }, [items, search, sortAZ]);

  const zeroStockCount = useMemo(() => items.filter(i => i.balance <= 0).length, [items]);
  const lastSyncedAt = items.length > 0 ? items[0].syncedAt : null;

  async function handleSync() {
    try {
      const result = await sync();
      toast.success(`Synced ${result.itemCount} material(s) from the warehouse sheet.`);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Failed to sync — check the Google Sheets API key and sheet sharing settings.");
    }
  }

  return (
    <div style={{ background: "#f5f4f0", minHeight: "100vh" }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <Header title="Inventory" />

      <div style={{ padding: "1.25rem 1.5rem" }}>

        {/* ── Page header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
          <div>
            <p style={{ fontWeight: 800, fontSize: "1.35rem", color: "#111827" }}>Warehouse Stock Balance</p>
            <p style={{ fontSize: "0.78rem", color: "#9ca3af", marginTop: 2 }}>Synced from the warehouse's Google Sheet stock balance log</p>
          </div>
          {canSync && (
            <button onClick={handleSync} disabled={syncing}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 10, border: "none", background: "#f97316", color: "#fff", fontSize: "0.875rem", fontWeight: 700, cursor: syncing ? "default" : "pointer", opacity: syncing ? 0.7 : 1 }}>
              <RefreshCw style={{ width: 14, height: 14, animation: syncing ? "spin 1s linear infinite" : undefined }} />
              {syncing ? "Syncing…" : "Sync Now"}
            </button>
          )}
        </div>

        {/* ── Stat cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1.25rem" }}>
          {[
            { icon: Package,     color: "#6b7280", bg: "#f3f4f6", label: "Total Materials", value: items.length },
            { icon: AlertCircle, color: "#dc2626", bg: "#fee2e2", label: "Zero Stock",       value: zeroStockCount },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label}
                style={{ background: "#fff", borderRadius: 12, padding: "1rem 1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", display: "flex", alignItems: "center", gap: "0.875rem" }}>
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
          <div style={{ background: "#fff", borderRadius: 12, padding: "1rem 1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", display: "flex", alignItems: "center", gap: "0.875rem" }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Clock style={{ width: 20, height: 20, color: "#2563eb" }} />
            </div>
            <div>
              <p style={{ fontSize: "0.92rem", fontWeight: 800, color: "#2563eb", lineHeight: 1.2 }}>{formatSyncedAt(lastSyncedAt)}</p>
              <p style={{ fontSize: "0.72rem", color: "#9ca3af", marginTop: 2 }}>Last Synced</p>
            </div>
          </div>
        </div>

        {/* ── Search + export bar ── */}
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 15, height: 15, color: "#9ca3af", pointerEvents: "none" }} />
            <input suppressHydrationWarning value={search} onChange={e => setSearch(e.target.value)} placeholder="Search materials..."
              style={{ width: "100%", boxSizing: "border-box", paddingLeft: 36, paddingRight: 12, paddingTop: 9, paddingBottom: 9, borderRadius: 8, background: "#fff", border: "1px solid #e5e7eb", fontSize: "0.875rem", outline: "none", color: "#111827" }} />
          </div>
          <button onClick={() => setSortAZ(s => !s)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: sortAZ ? "1px solid #f97316" : "1px solid #e5e7eb", background: sortAZ ? "#fff7ed" : "#fff", color: sortAZ ? "#f97316" : "#374151", fontSize: "0.875rem", fontWeight: 500, cursor: "pointer" }}>
            <ArrowDownAZ style={{ width: 14, height: 14 }} /> A–Z
          </button>
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
                {["#", "MATERIAL NAME", "UNIT", "BALANCE"].map(h => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: "0.68rem", fontWeight: 700, color: "#6b7280", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => (
                <tr key={item.id} style={{ borderBottom: idx < filtered.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                  <td style={{ padding: "12px 14px", fontSize: "0.8rem", color: "#9ca3af", fontWeight: 500 }}>{idx + 1}</td>
                  <td style={{ padding: "12px 14px" }}><p style={{ fontSize: "0.8rem", fontWeight: 600, color: item.balance <= 0 ? "#dc2626" : "#111827" }}>{item.materialName}</p></td>
                  <td style={{ padding: "12px 14px", fontSize: "0.8rem", color: "#6b7280" }}>{item.unit}</td>
                  <td style={{ padding: "12px 14px" }}>
                    <p style={{ fontSize: "0.85rem", fontWeight: 700, color: item.balance <= 0 ? "#dc2626" : "#111827" }}>{item.balance.toLocaleString()}</p>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={4} style={{ padding: "3rem", textAlign: "center", color: "#9ca3af", fontSize: "0.875rem" }}>
                  {items.length === 0 ? "No stock balance synced yet — click \"Sync Now\" to pull it from the warehouse sheet." : "No materials match your search."}
                </td></tr>
              )}
              {loading && (
                <tr><td colSpan={4} style={{ padding: "3rem", textAlign: "center", color: "#9ca3af", fontSize: "0.875rem" }}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
