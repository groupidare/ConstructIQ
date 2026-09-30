"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/layout/Header";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import {
  Package, AlertCircle, ShoppingCart,
  TrendingUp, Truck,
  Eye, Zap, Check, Activity, Bell,
  Wind, Droplets, CloudRain,
} from "lucide-react";
import { useWeatherStore } from "@/store/weatherStore";
import { RISK_VISUALS_DARK } from "@/lib/weather";
import { useNotificationPolling } from "@/hooks/useNotificationPolling";
import { NOTIFICATION_KIND_META } from "@/lib/notificationDisplay";
import type { Project } from "@/types/project";
import type { WarehouseStockItem } from "@/types/warehouseStock";
import type { ForecastResult, TopForecastedDemand } from "@/types/forecast";

// ── Real data shapes for the bits this page reads directly (not via a hook) ──

interface ApiPO { id: number; status: string; expectedDate: string; }

interface ActivityLogEntry {
  id: number;
  userDisplay: string;
  action: string;
  entityType: string | null;
  createdAt: string;
}

// The backend serializes DateTimes as UTC but without a "Z"/offset suffix (a
// MySQL + EF Core quirk) — treat bare timestamps as UTC so relative times
// aren't off by the local UTC offset.
function parseUtc(iso: string): Date {
  const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(iso);
  return new Date(hasTimezone ? iso : `${iso}Z`);
}

function relativeTime(iso: string): string {
  const diff = Date.now() - parseUtc(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

// Turns a raw "POST /api/purchase-orders" audit entry into a readable
// sentence — real fields only, no invented detail beyond what was logged.
function describeActivity(log: ActivityLogEntry): { text: string; dot: string } {
  const [method, path] = log.action.split(" ");
  const verb = method === "POST" ? "created" : method === "DELETE" ? "deleted" : "updated";
  const dot = method === "POST" ? "#22c55e" : method === "DELETE" ? "#dc2626" : "#3b82f6";
  const resource = (path ?? "").replace(/^\/api\//, "").split("/")[0]?.replace(/-/g, " ") || "a record";
  return { text: `${log.userDisplay} ${verb} ${resource}`, dot };
}

function poEffectiveStatus(po: ApiPO): string {
  if (po.status === "Delivered" || po.status === "DeliveryInProgress") return po.status;
  return new Date(po.expectedDate).getTime() < Date.now() ? "Delayed" : po.status;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const role = useAuthStore(s => s.user?.role);
  const isAdmin = role === "Admin";

  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [stockItems, setStockItems] = useState<WarehouseStockItem[]>([]);
  const [orders, setOrders] = useState<ApiPO[]>([]);
  const [forecasts, setForecasts] = useState<ForecastResult[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);

  // "Top Forecasted Material Demand" panel — a separate fetch from `forecasts`
  // above (which the Insights panel and "Predicted Demand" stat still read).
  // This calls a dedicated backend aggregation endpoint rather than looping
  // per project, so it doesn't share state/loading with the rest of the page.
  const [topDemand, setTopDemand] = useState<TopForecastedDemand | null>(null);
  const [topDemandLoading, setTopDemandLoading] = useState(true);
  const [topDemandError, setTopDemandError] = useState(false);
  const [selectedDemandUnit, setSelectedDemandUnit] = useState<string | null>(null);
  const [expandedMaterialId, setExpandedMaterialId] = useState<number | null>(null);

  const snapshot = useWeatherStore(s => s.snapshot);
  const daily     = useWeatherStore(s => s.daily);
  const risk      = useWeatherStore(s => s.risk);

  // Non-admin roles get their own notifications in the Activity Feed slot
  // instead of the admin-only audit log — same hook/data the header bell
  // already polls, so no extra request.
  const { notifications: myNotifications, markRead: markNotificationRead } = useNotificationPolling();

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      try {
        const [projectsRes, stockRes, poRes] = await Promise.all([
          api.get<Project[]>("/projects"),
          api.get<WarehouseStockItem[]>("/warehouse-stock"),
          api.get<ApiPO[]>("/purchase-orders"),
        ]);
        setProjects(projectsRes.data);
        setStockItems(stockRes.data);
        setOrders(poRes.data);

        const activeProjects = projectsRes.data.filter(p => !p.isHistorical);
        const forecastLists = await Promise.all(
          activeProjects.map(p =>
            api.get<ForecastResult[]>(`/forecast/project/${p.id}`).then(r => r.data.slice(0, 1)).catch(() => [])),
        );
        setForecasts(forecastLists.flat());
      } catch {
        // Leave whatever loaded successfully — each card below handles empty data.
      } finally {
        setLoading(false);
      }
    }
    loadAll();
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    api.get<ActivityLogEntry[]>("/activity-logs?page=1&pageSize=6")
      .then(r => setActivity(r.data))
      .catch(() => setActivity([]));
  }, [isAdmin]);

  // Never auto-generates a forecast — this only reads whatever has already
  // been saved. Deliberately company-wide (every role sees the same
  // aggregate), a single request rather than one call per project.
  const loadTopDemand = useCallback(async (unit?: string | null) => {
    setTopDemandLoading(true);
    setTopDemandError(false);
    try {
      const { data } = await api.get<TopForecastedDemand>("/forecast/top-demand", {
        params: unit ? { unit } : undefined,
      });
      setTopDemand(data);
      setSelectedDemandUnit(data.selectedUnit);
      setExpandedMaterialId(null);
    } catch {
      setTopDemandError(true);
    } finally {
      setTopDemandLoading(false);
    }
  }, []);

  useEffect(() => { loadTopDemand(); }, [loadTopDemand]);

  const materials = useMemo(() => forecasts.flatMap(f => f.forecastedMaterials), [forecasts]);

  // "Total Materials" = distinct materials the warehouse currently has stock
  // of; "Shortage Alerts" = the complement — materials at zero/negative
  // balance. Together they partition every synced stock item.
  const materialsInStock = useMemo(() => stockItems.filter(i => i.balance > 0).length, [stockItems]);
  const outOfStockCount  = useMemo(() => stockItems.filter(i => i.balance <= 0).length, [stockItems]);
  const forecastRiskCount = useMemo(() => materials.filter(m => m.riskLevel === "High" || m.riskLevel === "Critical").length, [materials]);
  const pendingPOs = useMemo(() => orders.filter(po => poEffectiveStatus(po) !== "Delivered").length, [orders]);
  const delayedPOs = useMemo(() => orders.filter(po => poEffectiveStatus(po) === "Delayed").length, [orders]);
  const predictedDemandPct = useMemo(() => {
    const totalForecasted = materials.reduce((s, m) => s + m.forecastedQuantity, 0);
    const totalCurrent = materials.reduce((s, m) => s + m.currentStock, 0);
    return totalCurrent > 0 ? ((totalForecasted - totalCurrent) / totalCurrent) * 100 : null;
  }, [materials]);

  const STATS: { icon: React.ElementType; iconBg: string; iconColor: string; value: string; label: string; sub: string }[] = [
    { icon: Package,     iconBg: "#dcfce7", iconColor: "#16a34a", value: materialsInStock.toLocaleString(), label: "Total Materials", sub: "Materials currently in stock" },
    { icon: AlertCircle, iconBg: "#fee2e2", iconColor: "#dc2626", value: String(outOfStockCount),           label: "Shortage Alerts",  sub: "Materials out of stock" },
    { icon: ShoppingCart,iconBg: "#ede9fe", iconColor: "#7c3aed", value: String(pendingPOs),                  label: "Procurement",      sub: "Purchase orders in progress" },
    { icon: TrendingUp,  iconBg: "#ffedd5", iconColor: "#ea580c", value: predictedDemandPct != null ? `${predictedDemandPct >= 0 ? "+" : ""}${predictedDemandPct.toFixed(1)}%` : "—", label: "Predicted Demand", sub: "Forecasted vs current stock" },
    { icon: Truck,       iconBg: "#f3f4f6", iconColor: "#6b7280", value: String(delayedPOs),                  label: "Delayed Deliveries", sub: "Past expected delivery date" },
  ];

  const insights = useMemo(() => {
    const list: { type: "warning" | "success" | "info"; text: string }[] = [];
    if (outOfStockCount > 0) list.push({ type: "warning", text: `${outOfStockCount} material(s) are out of stock and may need reordering.` });
    if (delayedPOs > 0) list.push({ type: "warning", text: `${delayedPOs} purchase order(s) are past their expected delivery date.` });
    if (forecastRiskCount > 0) list.push({ type: "info", text: `${forecastRiskCount} material(s) are at High or Critical shortage risk based on the latest forecasts.` });
    if (list.length === 0) list.push({ type: "success", text: "No out-of-stock materials, delayed deliveries, or forecasted shortage risks right now." });
    return list.slice(0, 3);
  }, [outOfStockCount, delayedPOs, forecastRiskCount]);

  const watchlist = useMemo(() =>
    [...stockItems].sort((a, b) => a.balance - b.balance).slice(0, 5),
  [stockItems]);

  return (
    <div style={{ background: "#f5f4f0" }}>
      <Header title="System Overview" />

      <div style={{ padding: "1.25rem 1.5rem" }}>

        {/* Stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: "0.875rem", marginBottom: "1.25rem" }}>
          {STATS.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} style={{ background: "#fff", borderRadius: 12, padding: "1.1rem 1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: s.iconBg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "0.75rem" }}>
                  <Icon style={{ width: 18, height: 18, color: s.iconColor }} />
                </div>
                <p style={{ fontSize: "1.7rem", fontWeight: 800, color: "#111827", lineHeight: 1 }}>{loading ? "—" : s.value}</p>
                <p style={{ fontSize: "0.78rem", fontWeight: 600, color: "#374151", marginTop: "0.3rem" }}>{s.label}</p>
                <p style={{ fontSize: "0.7rem", color: "#9ca3af" }}>{s.sub}</p>
              </div>
            );
          })}
        </div>

        {/* Chart + AI Insights */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "1rem", marginBottom: "1rem" }}>

          {/* Top Forecasted Material Demand */}
          <div style={{ background: "#fff", borderRadius: 12, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
                <TrendingUp style={{ width: 15, height: 15, color: "#f97316" }} />
                <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#111827" }}>Top Forecasted Material Demand</span>
              </div>
              {topDemand && topDemand.availableUnits.length > 1 && (
                <select
                  aria-label="Unit"
                  value={selectedDemandUnit ?? topDemand.selectedUnit ?? ""}
                  onChange={e => loadTopDemand(e.target.value)}
                  style={{ fontSize: "0.72rem", padding: "3px 6px", borderRadius: 6, border: "1px solid #e5e7eb", color: "#374151", background: "#fff", cursor: "pointer" }}
                >
                  {topDemand.availableUnits.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              )}
            </div>
            <p style={{ color: "#9ca3af", fontSize: "0.72rem", marginBottom: 3 }}>Top 5 materials by predicted quantity in the selected unit.</p>
            <p style={{ color: "#d1d5db", fontSize: "0.65rem", marginBottom: "0.875rem" }}>
              Based on the latest saved project forecasts.
              {!topDemandLoading && !topDemandError && topDemand && topDemand.eligibleProjectCount > 0 && (
                <>
                  {" "}{topDemand.projectsWithForecastCount} of {topDemand.eligibleProjectCount} eligible projects have forecasts
                  {topDemand.phaseOnlyProjectCount > 0 ? ` (${topDemand.phaseOnlyProjectCount} phase-scoped only)` : ""}.
                </>
              )}
            </p>

            {topDemandLoading ? (
              <p style={{ fontSize: "0.85rem", color: "#d1d5db", padding: "3.5rem 0", textAlign: "center" }}>Loading…</p>
            ) : topDemandError ? (
              <div style={{ textAlign: "center", padding: "2.75rem 0" }}>
                <p style={{ fontSize: "0.82rem", color: "#dc2626", marginBottom: 10 }}>Couldn&apos;t load forecast demand data.</p>
                <button
                  onClick={() => loadTopDemand(selectedDemandUnit)}
                  style={{ fontSize: "0.75rem", color: "#f97316", background: "none", border: "1px solid #fed7aa", borderRadius: 6, padding: "5px 14px", cursor: "pointer" }}
                >
                  Retry
                </button>
              </div>
            ) : !topDemand || topDemand.eligibleProjectCount === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "#d1d5db", padding: "3.5rem 0", textAlign: "center" }}>
                No eligible Planning or Active projects to forecast for.
              </p>
            ) : topDemand.projectsWithForecastCount === 0 && !topDemand.usedHistoricalFallback ? (
              <p style={{ fontSize: "0.82rem", color: "#d1d5db", padding: "2.5rem 0.5rem", textAlign: "center" }}>
                No saved forecasts available. Generate a forecast from a project&apos;s Material Plan to see material demand.
              </p>
            ) : !topDemand.selectedUnit || topDemand.materials.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "#d1d5db", padding: "3.5rem 0", textAlign: "center" }}>
                No positive forecasted demand.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {topDemand.usedHistoricalFallback && (
                  <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "7px 10px", fontSize: "0.68rem", color: "#9a3412" }}>
                    No active project has a forecast yet — showing real forecast data from {topDemand.historicalProjectsWithForecastCount} completed reference project{topDemand.historicalProjectsWithForecastCount === 1 ? "" : "s"} instead.
                  </div>
                )}
                {(() => {
                  const max = Math.max(...topDemand.materials.map(m => m.totalForecastedQuantity));
                  return topDemand.materials.map(m => {
                    const expanded = expandedMaterialId === m.materialId;
                    const label = m.specification ? `${m.materialName} — ${m.specification}` : m.materialName;
                    return (
                      <div key={m.materialId}>
                        <button
                          type="button"
                          onClick={() => setExpandedMaterialId(expanded ? null : m.materialId)}
                          aria-expanded={expanded}
                          style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
                            <span
                              title={label}
                              style={{ fontSize: "0.78rem", fontWeight: 600, color: "#111827", display: "flex", gap: 6, minWidth: 0, flex: 1 }}
                            >
                              <span style={{ color: "#9ca3af", fontWeight: 700, flexShrink: 0 }}>{m.rank}.</span>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                            </span>
                            <span style={{ fontSize: "0.72rem", color: "#374151", fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>
                              {m.totalForecastedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} {m.unit}
                            </span>
                          </div>
                          <div style={{ height: 6, borderRadius: 3, background: "#f3f4f6", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${max > 0 ? (m.totalForecastedQuantity / max) * 100 : 0}%`, background: "#f97316", borderRadius: 3 }} />
                          </div>
                          <div style={{ fontSize: "0.65rem", color: "#9ca3af", marginTop: 3 }}>
                            {m.contributingProjectCount} contributing project{m.contributingProjectCount === 1 ? "" : "s"} · {expanded ? "hide" : "show"} details
                          </div>
                        </button>
                        {expanded && (
                          <div style={{ marginTop: 6, marginLeft: 18, borderLeft: "2px solid #f3f4f6", paddingLeft: 10, display: "flex", flexDirection: "column", gap: 2 }}>
                            {m.contributions.map(c => (
                              <div key={c.projectId} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0", fontSize: "0.66rem", color: "#6b7280" }}>
                                <span>{c.projectName}{c.isPhaseScoped ? " (phase-scoped)" : ""}</span>
                                <span style={{ whiteSpace: "nowrap" }}>
                                  {c.forecastedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} {m.unit} · {parseUtc(c.generatedAt).toLocaleDateString()} · {c.period}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>

          {/* AI Insights */}
          <div style={{ background: "#1a2235", borderRadius: 12, padding: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <Zap style={{ width: 15, height: 15, color: "#f97316" }} />
                <span style={{ color: "#fff", fontWeight: 700, fontSize: "0.9rem" }}>Insights</span>
              </div>
              <span style={{ background: "#22c55e", color: "#fff", fontSize: "0.62rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999 }}>LIVE</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
              {insights.map((ins, i) => (
                <div key={i} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "0.7rem" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                      background: ins.type === "warning" ? "#fee2e2" : ins.type === "success" ? "#dcfce7" : "#dbeafe",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {ins.type === "warning" ? <AlertCircle style={{ width: 10, height: 10, color: "#dc2626" }} /> :
                       ins.type === "success"  ? <Check       style={{ width: 10, height: 10, color: "#16a34a" }} /> :
                                                 <TrendingUp  style={{ width: 10, height: 10, color: "#3b82f6" }} />}
                    </div>
                    <p style={{ color: "#d1d5db", fontSize: "0.76rem", lineHeight: 1.5 }}>{ins.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom row: Inventory | Activity | Weather */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 280px", gap: "1rem" }}>

          {/* Inventory watchlist — lowest-balance items */}
          <div style={{ background: "#fff", borderRadius: 12, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.875rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <Package style={{ width: 15, height: 15, color: "#f97316" }} />
                <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Inventory Watchlist</span>
              </div>
              <button onClick={() => router.push("/inventory")} style={{ display: "flex", alignItems: "center", gap: 4, color: "#6b7280", fontSize: "0.72rem", border: "none", background: "none", cursor: "pointer" }}>
                <Eye style={{ width: 12, height: 12 }} /> View All
              </button>
            </div>
            <div>
              {watchlist.length === 0 ? (
                <p style={{ fontSize: "0.8rem", color: "#d1d5db", padding: "1rem 0" }}>{loading ? "Loading…" : "No warehouse stock synced yet."}</p>
              ) : watchlist.map((item, i) => (
                <div key={item.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "0.55rem 0",
                  borderBottom: i < watchlist.length - 1 ? "1px solid #f3f4f6" : "none",
                }}>
                  <div>
                    <p style={{ fontSize: "0.78rem", fontWeight: 500, color: "#111827" }}>{item.materialName}</p>
                    <p style={{ fontSize: "0.68rem", color: "#9ca3af" }}>{item.balance.toLocaleString()} {item.unit}</p>
                  </div>
                  <span style={{
                    fontSize: "0.68rem", fontWeight: 700, padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap",
                    background: item.balance <= 0 ? "#fee2e2" : "#dcfce7",
                    color: item.balance <= 0 ? "#dc2626" : "#16a34a",
                  }}>
                    • {item.balance <= 0 ? "ZERO STOCK" : "IN STOCK"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Activity Feed (Admin: real audit log) / Notifications (everyone else) */}
          <div style={{ background: "#fff", borderRadius: 12, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.875rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                {isAdmin ? <Activity style={{ width: 15, height: 15, color: "#f97316" }} /> : <Bell style={{ width: 15, height: 15, color: "#f97316" }} />}
                <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{isAdmin ? "Activity Feed" : "Notifications"}</span>
              </div>
            </div>
            {!isAdmin ? (
              myNotifications.length === 0 ? (
                <p style={{ fontSize: "0.8rem", color: "#d1d5db", padding: "1rem 0" }}>No notifications yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
                  {myNotifications.slice(0, 6).map(n => {
                    const meta = NOTIFICATION_KIND_META[n.kind];
                    return (
                      <div
                        key={n.id}
                        onClick={() => {
                          void markNotificationRead(n.id);
                          if (n.actionLink) router.push(n.actionLink);
                        }}
                        style={{ display: "flex", gap: 9, alignItems: "flex-start", cursor: n.actionLink ? "pointer" : "default" }}
                      >
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: meta?.color ?? "#9ca3af", flexShrink: 0, marginTop: 5 }} />
                        <div>
                          <p style={{ fontSize: "0.76rem", color: "#111827", fontWeight: n.isRead ? 500 : 700, lineHeight: 1.4 }}>{n.title}</p>
                          <p style={{ fontSize: "0.66rem", color: "#9ca3af", marginTop: 1 }}>{relativeTime(n.createdAt)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : activity.length === 0 ? (
              <p style={{ fontSize: "0.8rem", color: "#d1d5db", padding: "1rem 0" }}>No recent activity.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
                {activity.map(log => {
                  const { text, dot } = describeActivity(log);
                  return (
                    <div key={log.id} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0, marginTop: 5 }} />
                      <div>
                        <p style={{ fontSize: "0.76rem", color: "#111827", fontWeight: 500, lineHeight: 1.4 }}>{text}</p>
                        <p style={{ fontSize: "0.66rem", color: "#9ca3af", marginTop: 1 }}>{relativeTime(log.createdAt)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Weather Impact — live, same source as the header's weather chip (R4) */}
          <div style={{ background: "#1a2235", borderRadius: 12, padding: "1.25rem", color: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.875rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>{snapshot?.emoji ?? "🌡️"}</span>
                <span style={{ fontWeight: 700, fontSize: "0.875rem" }}>Weather Impact</span>
              </div>
              <span style={{ color: "#6b7280", fontSize: "0.65rem" }}>{snapshot?.locationName ?? "Locating…"}, Today</span>
            </div>

            {!snapshot ? (
              <p style={{ color: "#6b7280", fontSize: "0.8rem", padding: "0.5rem 0" }}>Loading live weather…</p>
            ) : (
              <>
                <div style={{ fontSize: "2.4rem", fontWeight: 800, lineHeight: 1 }}>{snapshot.tempC}°C</div>
                <p style={{ color: "#9ca3af", fontSize: "0.78rem", marginTop: 4, marginBottom: "0.875rem" }}>{snapshot.conditionLabel}</p>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.875rem" }}>
                  {[
                    { label: "WIND",          val: `${snapshot.windKph} km/h`,        Icon: Wind },
                    { label: "HUMIDITY",      val: `${snapshot.humidityPct}%`,        Icon: Droplets },
                    { label: "PRECIPITATION", val: `${snapshot.precipitationMm} mm`,  Icon: CloudRain },
                    { label: "RISK LEVEL",    val: risk ? risk.level.toUpperCase() : "—", Icon: AlertCircle },
                  ].map(w => (
                    <div key={w.label} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "0.5rem 0.6rem" }}>
                      <p style={{ color: "#6b7280", fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.06em" }}>{w.label}</p>
                      <p style={{ color: "#fff", fontSize: "0.76rem", fontWeight: 600, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                        <w.Icon style={{ width: 11, height: 11 }} /> {w.val}
                      </p>
                    </div>
                  ))}
                </div>

                {risk && (
                  <div style={{ background: RISK_VISUALS_DARK[risk.level].bg, border: `1px solid ${RISK_VISUALS_DARK[risk.level].border}`, borderRadius: 8, padding: "0.5rem 0.7rem", marginBottom: "0.875rem" }}>
                    <p style={{ color: RISK_VISUALS_DARK[risk.level].text, fontSize: "0.7rem", lineHeight: 1.4 }}>
                      {risk.level === "low" ? "✓ " : "⚠ "}{risk.advisory}
                    </p>
                  </div>
                )}

                <p style={{ color: "#6b7280", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.05em", marginBottom: "0.5rem" }}>5-Day Forecast</p>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  {daily.map(d => (
                    <div key={d.date} style={{ textAlign: "center" }}>
                      <p style={{ color: "#6b7280", fontSize: "0.62rem" }}>{d.label}</p>
                      <p style={{ fontSize: "1rem", margin: "2px 0" }}>{d.emoji}</p>
                      <p style={{ color: "#fff", fontSize: "0.72rem", fontWeight: 600 }}>{d.maxTempC}°</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
