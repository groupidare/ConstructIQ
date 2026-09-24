"use client";

import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import Header from "@/components/layout/Header";
import { useAuthStore } from "@/store/authStore";
import { useWarehouseStock } from "@/hooks/useWarehouseStock";
import { useMaterialRequests } from "@/hooks/useMaterialRequests";
import { formatDate } from "@/lib/utils";
import type { MaterialRequest } from "@/types/materialRequest";
import {
  Package, AlertCircle, RefreshCw, Search, Download, Clock, ArrowDownAZ,
  ClipboardList, ChevronDown, ChevronRight, CheckSquare,
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

const REQUEST_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Pending:  { bg: "#fef3c7", color: "#b45309" },
  Approved: { bg: "#dcfce7", color: "#15803d" },
};

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "stock" | "requests";

function InventoryPageInner() {
  const searchParams = useSearchParams();
  const { items, loading, syncing, fetchItems, sync } = useWarehouseStock();
  const { requests, loading: requestsLoading, fetchAll: fetchRequests, approveRequest } = useMaterialRequests();

  const [search, setSearch] = useState("");
  const [sortAZ, setSortAZ] = useState(false);
  const [tab, setTab] = useState<Tab>(searchParams.get("tab") === "requests" ? "requests" : "stock");
  const [expandedProjectId, setExpandedProjectId] = useState<number | null>(null);
  const [approvingId, setApprovingId] = useState<number | null>(null);

  const { user } = useAuthStore();
  const role = user?.role ?? "SiteEngineer";
  const canSync = role === "Admin" || role === "WarehousePersonnel";
  const canApprove = role === "Admin" || role === "WarehousePersonnel";

  useEffect(() => { fetchItems(); fetchRequests(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const pendingCount = useMemo(() => requests.filter(r => r.status === "Pending").length, [requests]);

  const groupedRequestsByProject = useMemo(() => {
    const map = new Map<number, { projectId: number; projectName: string; records: MaterialRequest[] }>();
    for (const r of requests) {
      if (!map.has(r.projectId)) map.set(r.projectId, { projectId: r.projectId, projectName: r.projectName, records: [] });
      map.get(r.projectId)!.records.push(r);
    }
    return Array.from(map.values()).sort((a, b) =>
      Math.max(...b.records.map(x => new Date(x.requestedAt).getTime())) -
      Math.max(...a.records.map(x => new Date(x.requestedAt).getTime()))
    );
  }, [requests]);

  async function handleSync() {
    try {
      const result = await sync();
      toast.success(`Synced ${result.itemCount} material(s) from the warehouse sheet.`);
    } catch {
      toast.error("Failed to sync — check the Google Sheets API key and sheet sharing settings.");
    }
  }

  async function handleApprove(id: number) {
    setApprovingId(id);
    try {
      await approveRequest(id);
      toast.success("Request approved.");
    } catch {
      toast.error("Failed to approve request.");
    } finally {
      setApprovingId(null);
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "stock", label: "Stock Balance" },
    { id: "requests", label: "Requests" },
  ];

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
          {tab === "stock" && canSync && (
            <button onClick={handleSync} disabled={syncing}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 10, border: "none", background: "#f97316", color: "#fff", fontSize: "0.875rem", fontWeight: 700, cursor: syncing ? "default" : "pointer", opacity: syncing ? 0.7 : 1 }}>
              <RefreshCw style={{ width: 14, height: 14, animation: syncing ? "spin 1s linear infinite" : undefined }} />
              {syncing ? "Syncing…" : "Sync Now"}
            </button>
          )}
        </div>

        {/* ── Tabs ── */}
        <div style={{ display: "flex", gap: 4, background: "#e5e7eb", borderRadius: 8, padding: 4, width: "fit-content", marginBottom: "1.25rem" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              position: "relative", padding: "6px 20px", borderRadius: 6, fontSize: "0.875rem",
              fontWeight: tab === t.id ? 600 : 400, border: "none", cursor: "pointer",
              background: tab === t.id ? "#fff" : "transparent",
              color: tab === t.id ? "#111827" : "#6b7280",
              boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              transition: "all 0.15s",
            }}>
              {t.label}
              {t.id === "requests" && pendingCount > 0 && (
                <span style={{ position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, padding: "0 3px", background: "#ef4444", borderRadius: 999, border: "1.5px solid #fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.55rem", fontWeight: 800, color: "#fff", lineHeight: 1 }}>
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "stock" && (
          <>
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
          </>
        )}

        {tab === "requests" && (
          <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.07)", padding: "1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "1rem" }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: "#ffedd5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ClipboardList style={{ width: 18, height: 18, color: "#f97316" }} />
              </div>
              <div>
                <p style={{ fontWeight: 800, fontSize: "1rem", color: "#111827" }}>Material Requests</p>
                <p style={{ fontSize: "0.7rem", color: "#9ca3af" }}>Materials requested from the warehouse during a project's Material Plan — double-click a project to view</p>
              </div>
            </div>

            {requestsLoading && requests.length === 0 ? (
              <p style={{ textAlign: "center", color: "#9ca3af", padding: "2.5rem" }}>Loading requests…</p>
            ) : groupedRequestsByProject.length === 0 ? (
              <p style={{ textAlign: "center", color: "#9ca3af", padding: "2.5rem", fontSize: "0.875rem" }}>No material requests yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                    {["PROJECT", "ENTRIES", "LAST REQUESTED", ""].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: "0.65rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupedRequestsByProject.map((g, gi) => {
                    const expanded = expandedProjectId === g.projectId;
                    const lastRequested = Math.max(...g.records.map(r => new Date(r.requestedAt).getTime()));
                    return (
                      <Fragment key={g.projectId}>
                        <tr
                          onDoubleClick={() => setExpandedProjectId(expanded ? null : g.projectId)}
                          style={{ borderBottom: !expanded && gi < groupedRequestsByProject.length - 1 ? "1px solid #f3f4f6" : "none", cursor: "pointer" }}
                        >
                          <td style={{ padding: "14px 12px", fontSize: "0.85rem", fontWeight: 700, color: "#111827" }}>{g.projectName}</td>
                          <td style={{ padding: "14px 12px", fontSize: "0.82rem", color: "#374151" }}>{g.records.length}</td>
                          <td style={{ padding: "14px 12px", fontSize: "0.82rem", color: "#374151", whiteSpace: "nowrap" }}>{formatDate(new Date(lastRequested).toISOString())}</td>
                          <td style={{ padding: "14px 12px", color: "#9ca3af" }}>
                            {expanded ? <ChevronDown style={{ width: 14, height: 14 }} /> : <ChevronRight style={{ width: 14, height: 14 }} />}
                          </td>
                        </tr>
                        {expanded && (
                          <tr style={{ borderBottom: gi < groupedRequestsByProject.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                            <td colSpan={4} style={{ padding: "0 12px 16px 12px", background: "#f9fafb" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                  <tr>
                                    {["MATERIAL", "QTY", "UNIT", "REQUESTED", "STATUS", "ACTION"].map(h => (
                                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: "0.62rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em" }}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.records.map(r => {
                                    const style = REQUEST_STATUS_STYLE[r.status] ?? { bg: "#f3f4f6", color: "#6b7280" };
                                    return (
                                      <tr key={r.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                                        <td style={{ padding: "10px", fontSize: "0.8rem", fontWeight: 600, color: "#111827" }}>{r.materialName}</td>
                                        <td style={{ padding: "10px", fontSize: "0.8rem", color: "#374151" }}>{r.requestedQuantity.toLocaleString()}</td>
                                        <td style={{ padding: "10px", fontSize: "0.8rem", color: "#9ca3af" }}>{r.unit}</td>
                                        <td style={{ padding: "10px", fontSize: "0.8rem", color: "#374151", whiteSpace: "nowrap" }}>{formatDate(r.requestedAt)}</td>
                                        <td style={{ padding: "10px" }}>
                                          <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: style.bg, color: style.color, whiteSpace: "nowrap" }}>
                                            {r.status}
                                          </span>
                                        </td>
                                        <td style={{ padding: "10px" }}>
                                          {canApprove && r.status === "Pending" ? (
                                            <button
                                              onClick={() => handleApprove(r.id)}
                                              disabled={approvingId === r.id}
                                              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "0.7rem", fontWeight: 600, cursor: approvingId === r.id ? "default" : "pointer", whiteSpace: "nowrap" }}
                                            >
                                              <CheckSquare style={{ width: 11, height: 11 }} /> {approvingId === r.id ? "Approving…" : "Approve"}
                                            </button>
                                          ) : (
                                            <span style={{ color: "#d1d5db", fontSize: "0.78rem" }}>—</span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={null}>
      <InventoryPageInner />
    </Suspense>
  );
}
