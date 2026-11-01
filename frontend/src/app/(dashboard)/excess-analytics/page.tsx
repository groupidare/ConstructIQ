"use client";

import { Fragment, useMemo, useState, useEffect, type CSSProperties } from "react";
import Header from "@/components/layout/Header";
import { useAuthStore } from "@/store/authStore";
import { useProjects } from "@/hooks/useProjects";
import api from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { canSeeCostImpact, shareOfPurchases, type ExcessCostImpact, type ExcessWasteRecord } from "@/types/excess";
import RedistributeModal from "@/components/excess/RedistributeModal";
import RecordExcessModal from "@/components/excess/RecordExcessModal";
import EditExcessModal from "@/components/excess/EditExcessModal";
import toast from "react-hot-toast";
import {
  Trash2, Package,
  TrendingUp, FileText, Plus, Search, Recycle, ChevronDown, ChevronRight, Pencil, PhilippinePeso,
} from "lucide-react";

function average(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((s, n) => s + n, 0) / nums.length;
}

// Colors for a linked redistribution request's status — shown alongside the
// "Redistribute" action (not instead of it) so the user still knows the
// current target project but can still send it elsewhere.
const REDISTRIBUTION_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  AiSuggested:     { bg: "#f3f4f6", color: "#6b7280" },
  PendingApproval: { bg: "#fef3c7", color: "#b45309" },
  Approved:        { bg: "#dbeafe", color: "#1d4ed8" },
  InTransit:       { bg: "#dbeafe", color: "#1d4ed8" },
  Completed:       { bg: "#dcfce7", color: "#15803d" },
};

// The "Redistribute To" column only names a target once it's actually
// approved — a still-pending AI suggestion isn't a real destination yet.
const APPROVED_REDISTRIBUTION_STATUSES = new Set(["Approved", "InTransit", "Completed"]);

// The "Redistribute" action itself is blocked earlier, while a request is
// still pending too — not just once it's approved — so a material can't be
// sent to two places at once. Approved is the terminal state in this app
// (no InTransit/Completed step).
const ACTIVE_REDISTRIBUTION_STATUSES = new Set(["AiSuggested", "PendingApproval", "Approved"]);

// ── Cost impact ───────────────────────────────────────────────────────────────

const COST_TH: CSSProperties = { padding:"8px 10px", textAlign:"left", fontSize:"0.62rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.05em", whiteSpace:"nowrap" };
const COST_TD: CSSProperties = { padding:"10px", fontSize:"0.8rem", color:"#374151", whiteSpace:"nowrap" };

const TREND_SERIES: { key: "excessValue" | "wasteCost" | "redistributedValue"; label: string; color: string }[] = [
  { key: "excessValue",        label: "Excess value",  color: "#fbbf24" },
  { key: "wasteCost",          label: "Waste cost",    color: "#dc2626" },
  { key: "redistributedValue", label: "Redistributed", color: "#22c55e" },
];

function CostImpactCard({ impact }: { impact: ExcessCostImpact }) {
  const priceRange = impact.oldestPriceDate && impact.newestPriceDate
    ? ` Prices recorded ${formatDate(impact.oldestPriceDate)} – ${formatDate(impact.newestPriceDate)}.`
    : "";
  const share = shareOfPurchases(impact.excessValue, impact.wasteCost, impact.purchasedValue);
  const unpricedNotes = [
    impact.unpricedRecords    > 0 ? `${impact.unpricedRecords} excess/waste entr${impact.unpricedRecords === 1 ? "y" : "ies"}` : null,
    impact.unpricedTransfers  > 0 ? `${impact.unpricedTransfers} transfer${impact.unpricedTransfers === 1 ? "" : "s"}` : null,
    impact.unpricedDeliveries > 0 ? `${impact.unpricedDeliveries} delivered PO line${impact.unpricedDeliveries === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  // Last 12 months that have anything, oldest first.
  const trend = impact.monthlyTrend.slice(-12);
  const maxTrend = Math.max(1, ...trend.flatMap(t => [t.excessValue, t.wasteCost, t.redistributedValue]));

  return (
    <div style={{ background:"#fff", borderRadius:12, padding:"1.5rem", boxShadow:"0 1px 3px rgba(0,0,0,0.07)", marginTop:"1rem" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
        <div style={{ width:26, height:26, borderRadius:6, background:"#f3f4f6", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <PhilippinePeso style={{ width:14, height:14, color:"#6b7280" }} />
        </div>
        <span style={{ fontWeight:700, fontSize:"1rem" }}>Cost Impact</span>
      </div>
      <p style={{ color:"#9ca3af", fontSize:"0.72rem", marginBottom:"1.25rem" }}>
        Material cost only, at the latest recorded price for each material (PO, then historical, then catalog).{priceRange}
        {unpricedNotes.length > 0 && ` Not included (no recorded price in their unit): ${unpricedNotes.join(", ")}.`}
      </p>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(170px, 1fr))", gap:"0.75rem", marginBottom:"1.25rem" }}>
        {[
          { label:"Excess value",            sub:"Reusable — can still be used or redistributed",              value:formatCurrency(impact.excessValue),        color:"#b45309", bg:"#fffbeb" },
          { label:"Waste cost",              sub:"Non-reusable — money lost",                                  value:formatCurrency(impact.wasteCost),          color:"#dc2626", bg:"#fef2f2" },
          { label:"Saved by redistributing", sub:"Excess reused on other projects instead of bought again",    value:formatCurrency(impact.redistributedValue), color:"#15803d", bg:"#f0fdf4" },
          { label:"Purchased (delivered)",   sub: share != null ? `Excess + waste = ${share.toFixed(1)}% of purchases` : "No priced deliveries yet", value:formatCurrency(impact.purchasedValue), color:"#111827", bg:"#f9fafb" },
        ].map(s => (
          <div key={s.label} style={{ background:s.bg, borderRadius:10, padding:"0.875rem" }}>
            <p style={{ fontSize:"0.72rem", color:"#6b7280" }}>{s.label}</p>
            <p style={{ fontSize:"1.15rem", fontWeight:800, color:s.color, margin:"2px 0" }}>{s.value}</p>
            <p style={{ fontSize:"0.68rem", color:"#9ca3af" }}>{s.sub}</p>
          </div>
        ))}
      </div>

      {trend.length > 0 && (
        <>
          <p style={{ fontWeight:700, fontSize:"0.85rem", color:"#111827", marginBottom:"0.25rem" }}>Monthly trend</p>
          <p style={{ color:"#9ca3af", fontSize:"0.7rem", marginBottom:"0.75rem" }}>Excess and waste by month logged, redistribution by month approved</p>
          <div style={{ overflowX:"auto", marginBottom:"0.5rem" }}>
            <div style={{ display:"flex", alignItems:"flex-end", gap:"0.75rem", height:140, minWidth: trend.length * 56 }}>
              {trend.map(t => (
                <div key={t.month} style={{ flex:1, minWidth:44, display:"flex", flexDirection:"column", alignItems:"center", height:"100%" }}>
                  <div style={{ flex:1, width:"100%", display:"flex", alignItems:"flex-end", justifyContent:"center", gap:2 }}>
                    {TREND_SERIES.map(b => (
                      <div key={b.key} title={`${b.label}: ${formatCurrency(t[b.key])}`}
                        style={{ width:10, height:`${(t[b.key] / maxTrend) * 100}%`, minHeight: t[b.key] > 0 ? 2 : 0, background:b.color, borderRadius:"3px 3px 0 0" }} />
                    ))}
                  </div>
                  <span style={{ fontSize:"0.62rem", color:"#9ca3af", marginTop:4, whiteSpace:"nowrap" }}>{t.month}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display:"flex", gap:"1.25rem", justifyContent:"center", flexWrap:"wrap", marginBottom:"1.25rem" }}>
            {TREND_SERIES.map(b => (
              <div key={b.key} style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:10, height:10, borderRadius:"50%", background:b.color }} />
                <span style={{ fontSize:"0.72rem", color:"#6b7280" }}>{b.label}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <p style={{ fontWeight:700, fontSize:"0.85rem", color:"#111827", marginBottom:"0.5rem" }}>By project</p>
      <div style={{ overflowX:"auto", marginBottom: impact.byMaterial.length > 0 ? "1.25rem" : 0 }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:"1px solid #e5e7eb" }}>
              {["PROJECT","PURCHASED","EXCESS VALUE","WASTE COST","% OF PURCHASES","REDISTRIBUTED","UNPRICED ENTRIES"].map(h => <th key={h} style={COST_TH}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {impact.byProject.map(p => {
              const projectShare = shareOfPurchases(p.excessValue, p.wasteCost, p.purchasedValue);
              return (
                <tr key={p.projectId} style={{ borderTop:"1px solid #f3f4f6" }}>
                  <td style={{ ...COST_TD, fontWeight:600, color:"#111827" }}>{p.projectName}</td>
                  <td style={COST_TD}>{formatCurrency(p.purchasedValue)}</td>
                  <td style={{ ...COST_TD, color:"#b45309" }}>{formatCurrency(p.excessValue)}</td>
                  <td style={{ ...COST_TD, color:"#dc2626" }}>{formatCurrency(p.wasteCost)}</td>
                  <td style={COST_TD}>{projectShare != null ? `${projectShare.toFixed(1)}%` : "—"}</td>
                  <td style={{ ...COST_TD, color:"#15803d" }}>{formatCurrency(p.redistributedValue)}</td>
                  <td style={{ ...COST_TD, color:"#9ca3af" }}>{p.unpricedRecords || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {impact.byMaterial.length > 0 && (
        <>
          <p style={{ fontWeight:700, fontSize:"0.85rem", color:"#111827", marginBottom:"0.5rem" }}>By material</p>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ borderBottom:"1px solid #e5e7eb" }}>
                  {["MATERIAL","UNIT PRICE","EXCESS QTY","EXCESS VALUE","WASTE QTY","WASTE COST"].map(h => <th key={h} style={COST_TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {impact.byMaterial.map(m => (
                  <tr key={`${m.materialId}-${m.unit}`} style={{ borderTop:"1px solid #f3f4f6" }}>
                    <td style={{ ...COST_TD, fontWeight:600, color:"#111827", whiteSpace:"normal" }}>{m.materialName}</td>
                    <td style={COST_TD}>{formatCurrency(m.unitPrice)}/{m.unit}</td>
                    <td style={COST_TD}>{m.excessQuantity.toLocaleString()} {m.unit}</td>
                    <td style={{ ...COST_TD, color:"#b45309" }}>{formatCurrency(m.excessValue)}</td>
                    <td style={COST_TD}>{m.wasteQuantity.toLocaleString()} {m.unit}</td>
                    <td style={{ ...COST_TD, color:"#dc2626" }}>{formatCurrency(m.wasteCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "overview" | "log";

export default function ExcessAnalyticsPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [logSearch, setLogSearch] = useState("");

  // Mirrors the backend's own restriction on POST/PUT /excess-waste (Admin,
  // WarehousePersonnel) — SiteEngineer's Excess Analytics access is
  // view-only. Without this, anyone could see and click "+ Excess Log"/
  // "Edit" and only find out they lack permission after a confusing
  // generic failure from the server's 403.
  const { user } = useAuthStore();
  const canManageExcess = user?.role === "Admin" || user?.role === "WarehousePersonnel";
  const showCostImpact = canSeeCostImpact(user?.role);

  const { projects } = useProjects();
  const [records, setRecords] = useState<ExcessWasteRecord[]>([]);
  const [costImpact, setCostImpact] = useState<ExcessCostImpact | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [redistributeTarget, setRedistributeTarget] = useState<ExcessWasteRecord | null>(null);
  const [editTarget, setEditTarget] = useState<ExcessWasteRecord | null>(null);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [expandedProjectId, setExpandedProjectId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function loadRecords() {
    if (projects.length === 0) return;
    // Independent of the records below — a failure just hides the cost
    // figures rather than affecting the rest of the page.
    if (showCostImpact) {
      api.get<ExcessCostImpact>("/excess-waste/cost-impact")
        .then(r => setCostImpact(r.data))
        .catch(() => setCostImpact(null));
    }
    setRecordsLoading(true);
    try {
      const results = await Promise.all(
        projects.map(p => api.get<ExcessWasteRecord[]>(`/excess-waste/project/${p.id}`).then(r => r.data).catch(() => []))
      );
      setRecords(results.flat().sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()));
    } finally {
      setRecordsLoading(false);
    }
  }

  useEffect(() => { loadRecords(); }, [projects]);

  // Removing the entry from local state (rather than a full reload) is what
  // makes a project with no remaining entries disappear from the log
  // immediately — groupedByProject is derived purely from `records`.
  async function handleDelete(record: ExcessWasteRecord) {
    if (!window.confirm(`Delete this ${record.materialName} entry (${record.quantity.toLocaleString()} ${record.unit})? This can't be undone.`)) return;
    setDeletingId(record.id);
    try {
      await api.delete(`/excess-waste/${record.id}`);
      setRecords(prev => prev.filter(r => r.id !== record.id));
      toast.success("Entry deleted.");
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message ?? "Failed to delete entry.");
    } finally {
      setDeletingId(null);
    }
  }

  // Approve/Reject on the Redistribution page updates that page's own list
  // immediately, but this page has no way to know about it otherwise — no
  // polling exists anywhere in this app, so a lightweight focus/visibility
  // refetch is the minimal way to reflect it here without a manual reload.
  useEffect(() => {
    function onFocus() { loadRecords(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  const filteredLog = records.filter(e =>
    e.materialName.toLowerCase().includes(logSearch.toLowerCase()) ||
    e.projectName.toLowerCase().includes(logSearch.toLowerCase())
  );

  const groupedByProject = useMemo(() => {
    const map = new Map<number, { projectId: number; projectName: string; records: ExcessWasteRecord[] }>();
    for (const e of filteredLog) {
      if (!map.has(e.projectId)) map.set(e.projectId, { projectId: e.projectId, projectName: e.projectName, records: [] });
      map.get(e.projectId)!.records.push(e);
    }
    return Array.from(map.values()).sort((a, b) =>
      Math.max(...b.records.map(r => new Date(r.recordedAt).getTime())) -
      Math.max(...a.records.map(r => new Date(r.recordedAt).getTime()))
    );
  }, [filteredLog]);

  // ── Real Overview metrics, derived from the recorded entries ──────────────
  const overview = useMemo(() => {
    const wasteRecords  = records.filter(e => !e.isReusable);
    const excessRecords = records.filter(e => e.isReusable);

    const totalWasteRate  = average(wasteRecords.map(e => e.excessPercent));
    const totalExcessRate = average(records.map(e => e.excessPercent));

    const reusableMaterialsCount = new Set(excessRecords.map(e => e.materialId)).size;

    const byProjectMap = new Map<number, { project: string; wasteRates: number[]; excessRates: number[] }>();

    // Completed projects always get a bar, even with 0% so far — they're the
    // ones with a final excess/waste story worth tracking to completion.
    for (const p of projects) {
      if (p.status === "Completed") byProjectMap.set(p.id, { project: p.name, wasteRates: [], excessRates: [] });
    }

    for (const e of records) {
      if (!byProjectMap.has(e.projectId)) byProjectMap.set(e.projectId, { project: e.projectName, wasteRates: [], excessRates: [] });
      const bucket = byProjectMap.get(e.projectId)!;
      (e.isReusable ? bucket.excessRates : bucket.wasteRates).push(e.excessPercent);
    }
    const chartData = Array.from(byProjectMap.values())
      .map(p => ({ project: p.project, wasteRate: average(p.wasteRates), excessRate: average(p.excessRates) }))
      .sort((a, b) => (b.wasteRate + b.excessRate) - (a.wasteRate + a.excessRate))
      .slice(0, 8);

    return { totalWasteRate, totalExcessRate, reusableMaterialsCount, chartData };
  }, [records, projects]);

  const maxChartRate = Math.max(1, ...overview.chartData.flatMap(d => [d.wasteRate, d.excessRate]));

  const TABS: { id: Tab; label: string }[] = [
    { id:"overview", label:"Overview" },
    { id:"log",      label:"Excess Recording Log" },
  ];

  return (
    <div style={{ background:"#f5f4f0" }}>
      {redistributeTarget && (
        <RedistributeModal
          record={{
            id: redistributeTarget.id,
            materialName: redistributeTarget.materialName,
            quantity: redistributeTarget.quantity,
            unit: redistributeTarget.unit,
            projectId: redistributeTarget.projectId,
            projectName: redistributeTarget.projectName,
          }}
          onClose={() => setRedistributeTarget(null)}
          onSuccess={loadRecords}
        />
      )}

      {showRecordModal && (
        <RecordExcessModal
          projects={projects}
          onClose={() => setShowRecordModal(false)}
          onSuccess={loadRecords}
        />
      )}

      {editTarget && (
        <EditExcessModal
          record={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={loadRecords}
        />
      )}

      <Header title="Excess" />

      <div className="responsive-page" style={{ padding:"1.25rem 1.5rem" }}>

        {/* ── Tabs ──────────────────────────────────────────────────────────── */}
        <div style={{ display:"flex", gap:4, background:"#e5e7eb", borderRadius:8, padding:4, width:"fit-content", marginBottom:"1.25rem" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              padding:"6px 20px", borderRadius:6, fontSize:"0.875rem",
              fontWeight: tab===t.id ? 600 : 400, border:"none", cursor:"pointer",
              background: tab===t.id ? "#fff" : "transparent",
              color: tab===t.id ? "#111827" : "#6b7280",
              boxShadow: tab===t.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              transition:"all 0.15s",
            }}>{t.label}</button>
          ))}
        </div>

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* Tab: Overview — real metrics, derived live from recorded entries      */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {tab === "overview" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 320px", gap:"1rem" }}>

            {/* Bar chart */}
            <div style={{ background:"#fff", borderRadius:12, padding:"1.5rem", boxShadow:"0 1px 3px rgba(0,0,0,0.07)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                <div style={{ width:26, height:26, borderRadius:6, background:"#f3f4f6", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <Package style={{ width:14, height:14, color:"#6b7280" }} />
                </div>
                <span style={{ fontWeight:700, fontSize:"1rem" }}>Excess &amp; Waste by Project</span>
              </div>
              <p style={{ color:"#9ca3af", fontSize:"0.72rem", marginBottom:"1.5rem" }}>Excess and waste rate per project</p>

              {overview.chartData.length === 0 ? (
                <p style={{ textAlign:"center", color:"#9ca3af", fontSize:"0.85rem", padding:"2rem 0" }}>
                  No excess entries recorded yet — use &quot;+ Excess Log&quot; to start tracking.
                </p>
              ) : (
                <>
                  <div style={{ display:"flex", flexDirection:"column", gap:"1.1rem" }}>
                    {overview.chartData.map(d => (
                      <div key={d.project} style={{ display:"flex", alignItems:"center", gap:"1rem" }}>
                        <span style={{ fontSize:"0.78rem", color:"#374151", width:180, flexShrink:0, textAlign:"right", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{d.project}</span>
                        <div style={{ flex:1, display:"flex", flexDirection:"column", gap:4 }}>
                          <div style={{ height:10, background:"#f3f4f6", borderRadius:99 }}>
                            <div style={{ height:"100%", width:`${(d.excessRate/maxChartRate)*100}%`, background:"#fbbf24", borderRadius:99 }} />
                          </div>
                          <div style={{ height:10, background:"#f3f4f6", borderRadius:99 }}>
                            <div style={{ height:"100%", width:`${(d.wasteRate/maxChartRate)*100}%`, background:"#dc2626", borderRadius:99 }} />
                          </div>
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", width:44, flexShrink:0 }}>
                          <span style={{ fontSize:"0.7rem", fontWeight:600, color:"#b45309" }}>{d.excessRate.toFixed(1)}%</span>
                          <span style={{ fontSize:"0.7rem", fontWeight:600, color:"#dc2626" }}>{d.wasteRate.toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display:"flex", gap:"1.5rem", justifyContent:"center", marginTop:"1.25rem" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <div style={{ width:12, height:12, borderRadius:"50%", background:"#fbbf24" }} />
                      <span style={{ fontSize:"0.75rem", color:"#6b7280" }}>Excess Rate (%)</span>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <div style={{ width:12, height:12, borderRadius:"50%", background:"#dc2626" }} />
                      <span style={{ fontSize:"0.75rem", color:"#6b7280" }}>Waste Rate (%)</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Excess Summary panel */}
            <div style={{ background:"#fff", borderRadius:12, padding:"1.5rem", boxShadow:"0 1px 3px rgba(0,0,0,0.07)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                <FileText style={{ width:16, height:16, color:"#6b7280" }} />
                <span style={{ fontWeight:700, fontSize:"0.95rem" }}>Excess Summary</span>
              </div>
              <p style={{ color:"#9ca3af", fontSize:"0.72rem", marginBottom:"1.5rem" }}>Overall project summary</p>

              {[
                { icon:TrendingUp, iconBg:"#fffbeb", iconColor:"#d97706", label:"Total Excess Rate", value:`${overview.totalExcessRate.toFixed(1)}%` },
                { icon:Trash2,     iconBg:"#fee2e2", iconColor:"#dc2626", label:"Total Waste Rate",  value:`${overview.totalWasteRate.toFixed(1)}%` },
                ...(costImpact ? [
                  { icon:PhilippinePeso, iconBg:"#fffbeb", iconColor:"#d97706", label:"Excess Value (reusable)", value:formatCurrency(costImpact.excessValue) },
                  { icon:PhilippinePeso, iconBg:"#fee2e2", iconColor:"#dc2626", label:"Waste Cost (lost)",       value:formatCurrency(costImpact.wasteCost) },
                ] : []),
              ].map(r => {
                const Icon = r.icon;
                return (
                  <div key={r.label} style={{ display:"flex", alignItems:"center", gap:10, padding:"0.875rem", background:"#f9fafb", borderRadius:10, marginBottom:"0.75rem" }}>
                    <div style={{ width:34, height:34, borderRadius:8, background:r.iconBg, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <Icon style={{ width:16, height:16, color:r.iconColor }} />
                    </div>
                    <div style={{ flex:1 }}>
                      <p style={{ fontSize:"0.75rem", color:"#6b7280" }}>{r.label}</p>
                    </div>
                    <span style={{ fontWeight:700, fontSize:"0.9rem", color:"#111827" }}>{r.value}</span>
                  </div>
                );
              })}

              <p style={{ fontSize:"0.78rem", color:"#9ca3af", lineHeight:1.6, marginTop:"1rem" }}>
                {records.length === 0
                  ? "No excess or waste has been recorded yet."
                  : `Excess rate stands at ${overview.totalExcessRate.toFixed(1)}% and waste rate at ${overview.totalWasteRate.toFixed(1)}% across all recorded entries.`}
                {costImpact && costImpact.unpricedRecords > 0 && (
                  ` ${costImpact.unpricedRecords} entr${costImpact.unpricedRecords === 1 ? "y has" : "ies have"} no recorded price in ${costImpact.unpricedRecords === 1 ? "its" : "their"} unit and ${costImpact.unpricedRecords === 1 ? "is" : "are"} left out of the ₱ totals.`
                )}
              </p>
            </div>
          </div>
        )}

        {/* Cost impact — the per-material table only comes back for roles that may see prices */}
        {tab === "overview" && costImpact && (costImpact.pricedRecords > 0 || costImpact.redistributedValue > 0 || costImpact.purchasedValue > 0) && (
          <CostImpactCard impact={costImpact} />
        )}

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* Tab: Excess Recording Log — real data, aggregated across projects     */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {tab === "log" && (
          <div style={{ background:"#fff", borderRadius:12, padding:"1.5rem", boxShadow:"0 1px 3px rgba(0,0,0,0.07)", border:"2px solid #f97316" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1.25rem" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:36, height:36, borderRadius:8, background:"#ffedd5", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <FileText style={{ width:18, height:18, color:"#f97316" }} />
                </div>
                <div>
                  <p style={{ fontWeight:800, fontSize:"1rem", color:"#111827" }}>Excess Recording Log</p>
                  <p style={{ fontSize:"0.7rem", color:"#9ca3af" }}>All recorded waste &amp; excess entries, across every project</p>
                </div>
              </div>
              <div style={{ display:"flex", gap:"0.75rem", alignItems:"center" }}>
                <div style={{ position:"relative" }}>
                  <Search style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", width:14, height:14, color:"#9ca3af", pointerEvents:"none" }} />
                  <input
                    suppressHydrationWarning value={logSearch} onChange={e=>setLogSearch(e.target.value)}
                    placeholder="Search material, project..."
                    style={{ paddingLeft:32, paddingRight:12, paddingTop:8, paddingBottom:8, borderRadius:8, border:"1px solid #e5e7eb", background:"#f9fafb", fontSize:"0.8rem", outline:"none", width:220, color:"#111827" }}
                  />
                </div>
                {canManageExcess && (
                  <button onClick={() => setShowRecordModal(true)} style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 16px", borderRadius:8, border:"none", background:"#f97316", color:"#fff", fontSize:"0.8rem", fontWeight:700, cursor:"pointer" }}>
                    <Plus style={{ width:14, height:14 }} /> Excess Log
                  </button>
                )}
              </div>
            </div>

            {recordsLoading && records.length === 0 ? (
              <p style={{ textAlign:"center", color:"#9ca3af", padding:"2.5rem" }}>Loading excess records…</p>
            ) : (
              <>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead>
                    <tr style={{ borderBottom:"1px solid #e5e7eb" }}>
                      {["PROJECT","ENTRIES","LAST RECORDED","ACTION"].map(h => (
                        <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontSize:"0.65rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.06em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupedByProject.map((g, gi) => {
                      const expanded = expandedProjectId === g.projectId;
                      const lastRecorded = Math.max(...g.records.map(r => new Date(r.recordedAt).getTime()));
                      return (
                        <Fragment key={g.projectId}>
                          <tr style={{ borderBottom: !expanded && gi < groupedByProject.length-1 ? "1px solid #f3f4f6" : "none" }}>
                            <td style={{ padding:"14px 12px", fontSize:"0.85rem", fontWeight:700, color:"#111827" }}>{g.projectName}</td>
                            <td style={{ padding:"14px 12px", fontSize:"0.82rem", color:"#374151" }}>{g.records.length}</td>
                            <td style={{ padding:"14px 12px", fontSize:"0.82rem", color:"#374151", whiteSpace:"nowrap" }}>{formatDate(new Date(lastRecorded).toISOString())}</td>
                            <td style={{ padding:"14px 12px" }}>
                              <div style={{ display:"flex", gap:6 }}>
                                <button
                                  onClick={() => setExpandedProjectId(expanded ? null : g.projectId)}
                                  style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 12px", borderRadius:8, border:"1px solid #e5e7eb", background:"#fff", color:"#374151", fontSize:"0.72rem", fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}
                                >
                                  {expanded ? <ChevronDown style={{ width:12, height:12 }} /> : <ChevronRight style={{ width:12, height:12 }} />} View
                                </button>
                              </div>
                            </td>
                          </tr>
                          {expanded && (
                            <tr style={{ borderBottom: gi < groupedByProject.length-1 ? "1px solid #f3f4f6" : "none" }}>
                              <td colSpan={4} style={{ padding:"0 12px 16px 12px", background:"#f9fafb" }}>
                                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                                  <thead>
                                    <tr>
                                      {["DATE","MATERIAL","TYPE","QTY","UNIT","REDISTRIBUTE TO","ACTION"].map(h => (
                                        <th key={h} style={{ padding:"8px 10px", textAlign:"left", fontSize:"0.62rem", fontWeight:700, color:"#9ca3af", letterSpacing:"0.05em" }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.records.map(e => {
                                      const typeStyle = e.isReusable
                                        ? { label: "Excess", bg: "#fef3c7", color: "#b45309" }
                                        : { label: "Waste",  bg: "#fee2e2", color: "#dc2626" };
                                      return (
                                        <tr key={e.id} style={{ borderTop:"1px solid #e5e7eb" }}>
                                          <td style={{ padding:"10px", fontSize:"0.8rem", color:"#374151", whiteSpace:"nowrap" }}>{formatDate(e.recordedAt)}</td>
                                          <td style={{ padding:"10px", fontSize:"0.8rem", fontWeight:600, color:"#111827" }}>{e.materialName}</td>
                                          <td style={{ padding:"10px" }}>
                                            <span style={{ fontSize:"0.65rem", fontWeight:700, padding:"3px 8px", borderRadius:999, background:typeStyle.bg, color:typeStyle.color, whiteSpace:"nowrap" }}>
                                              {typeStyle.label}
                                            </span>
                                          </td>
                                          <td style={{ padding:"10px", fontSize:"0.8rem", color:"#374151" }}>{e.quantity.toLocaleString()}</td>
                                          <td style={{ padding:"10px", fontSize:"0.8rem", color:"#9ca3af" }}>{e.unit}</td>
                                          <td style={{ padding:"10px" }}>
                                            {!e.isReusable ? null : e.redistributionTargetProjectName && APPROVED_REDISTRIBUTION_STATUSES.has(e.redistributionStatus ?? "") ? (
                                              <span style={{
                                                display:"inline-flex", alignItems:"center", gap:5, padding:"3px 9px", borderRadius:999,
                                                background: REDISTRIBUTION_STATUS_STYLE[e.redistributionStatus!]?.bg ?? "#f3f4f6",
                                                color: REDISTRIBUTION_STATUS_STYLE[e.redistributionStatus!]?.color ?? "#6b7280",
                                                fontSize:"0.72rem", fontWeight:600, whiteSpace:"nowrap",
                                              }}>
                                                <Recycle style={{ width:11, height:11 }} /> {e.redistributionTargetProjectName}
                                              </span>
                                            ) : (
                                              <span style={{ color:"#d1d5db", fontSize:"0.8rem" }}>—</span>
                                            )}
                                          </td>
                                          <td style={{ padding:"10px" }}>
                                            <div style={{ display:"flex", gap:6 }}>
                                              {canManageExcess && (() => {
                                                const alreadyRedistributed = APPROVED_REDISTRIBUTION_STATUSES.has(e.redistributionStatus ?? "");
                                                return (
                                                  <button
                                                    onClick={() => !alreadyRedistributed && setEditTarget(e)}
                                                    disabled={alreadyRedistributed}
                                                    title={alreadyRedistributed ? `Already redistributed to ${e.redistributionTargetProjectName} — can't be edited.` : undefined}
                                                    style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 10px", borderRadius:8, border:"1px solid #e5e7eb", background: alreadyRedistributed ? "#f3f4f6" : "#fff", color: alreadyRedistributed ? "#9ca3af" : "#374151", fontSize:"0.7rem", fontWeight:600, cursor: alreadyRedistributed ? "not-allowed" : "pointer", whiteSpace:"nowrap" }}
                                                  >
                                                    <Pencil style={{ width:11, height:11 }} /> Edit
                                                  </button>
                                                );
                                              })()}
                                              {canManageExcess && e.isReusable && (() => {
                                                const isActive = ACTIVE_REDISTRIBUTION_STATUSES.has(e.redistributionStatus ?? "");
                                                const isBlocked = isActive || e.quantity <= 0;
                                                const title = isActive
                                                  ? `Already redistributed to ${e.redistributionTargetProjectName}`
                                                  : e.quantity <= 0
                                                    ? "Nothing left to redistribute — fully allocated already."
                                                    : undefined;
                                                return (
                                                  <button
                                                    onClick={() => !isBlocked && setRedistributeTarget(e)}
                                                    disabled={isBlocked}
                                                    title={title}
                                                    style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 10px", borderRadius:8, border:"1px solid #e5e7eb", background: isBlocked ? "#f3f4f6" : "#fff", color: isBlocked ? "#9ca3af" : "#374151", fontSize:"0.7rem", fontWeight:600, cursor: isBlocked ? "not-allowed" : "pointer", whiteSpace:"nowrap" }}
                                                  >
                                                    <Recycle style={{ width:11, height:11 }} /> Redistribute
                                                  </button>
                                                );
                                              })()}
                                              {canManageExcess && (() => {
                                                const isActive = ACTIVE_REDISTRIBUTION_STATUSES.has(e.redistributionStatus ?? "");
                                                const isDeleting = deletingId === e.id;
                                                const isBlocked = isActive || isDeleting;
                                                return (
                                                  <button
                                                    onClick={() => !isBlocked && handleDelete(e)}
                                                    disabled={isBlocked}
                                                    title={isActive ? `Already redistributed to ${e.redistributionTargetProjectName} — can't be deleted.` : undefined}
                                                    style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 10px", borderRadius:8, border:"1px solid #fecaca", background: isBlocked ? "#f3f4f6" : "#fff", color: isBlocked ? "#9ca3af" : "#dc2626", fontSize:"0.7rem", fontWeight:600, cursor: isBlocked ? "not-allowed" : "pointer", whiteSpace:"nowrap" }}
                                                  >
                                                    <Trash2 style={{ width:11, height:11 }} /> {isDeleting ? "Deleting…" : "Delete"}
                                                  </button>
                                                );
                                              })()}
                                            </div>
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
                    {groupedByProject.length === 0 && (
                      <tr><td colSpan={4} style={{ padding:"2.5rem", textAlign:"center", color:"#9ca3af" }}>No entries match your search.</td></tr>
                    )}
                  </tbody>
                </table>

                <div style={{ marginTop:"1.25rem", paddingTop:"1rem", borderTop:"1px solid #f3f4f6" }}>
                  <p style={{ fontSize:"0.78rem", color:"#9ca3af" }}>
                    Showing {groupedByProject.length} project{groupedByProject.length === 1 ? "" : "s"} ({filteredLog.length} entries)
                  </p>
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
