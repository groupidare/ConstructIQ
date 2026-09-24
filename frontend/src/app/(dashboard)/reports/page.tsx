"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Header from "@/components/layout/Header";
import api from "@/lib/api";
import { useWeatherStore } from "@/store/weatherStore";
import type { Project } from "@/types/project";
import type { WarehouseStockItem } from "@/types/warehouseStock";
import type { WarehouseRequest } from "@/types/warehouseRequest";
import type { ExcessWasteRecord } from "@/types/excess";
import type { ForecastResult, RiskLevel } from "@/types/forecast";
import type { RedistributionRecommendation, RedistributionStatus } from "@/types/procurement";
import {
  LayoutDashboard, TrendingUp, Package, ShoppingCart,
  Trash2, FolderKanban, Network,
  Eye, Download, FileText, Search, Filter, X, Zap, BarChart3,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

// ── Report definitions — one per sidebar page, in the same order ────────────

interface Report {
  id: string;
  title: string;
  desc: string;
  icon: React.ElementType;
  category: string;
}

const REPORTS: Report[] = [
  { id: "projects",    title: "Projects",          desc: "Timeline, status, and phase progress across every project",   icon: FolderKanban,    category: "Management" },
  { id: "inventory",   title: "Inventory",         desc: "Warehouse stock balance, zero-stock items, pending requests", icon: Package,         category: "Operations" },
  { id: "forecasting", title: "Forecasting",       desc: "Demand forecasts, shortage risk, model accuracy",             icon: TrendingUp,      category: "Analytics"  },
  { id: "excess",      title: "Excess Analytics",  desc: "Waste rate, excess rate, reusable materials",                 icon: Trash2,          category: "Analytics"  },
  { id: "redistribution", title: "Redistribution", desc: "Dead-stock opportunities, approvals, and priority",           icon: Network,         category: "Operations" },
  { id: "procurement", title: "Procurement",       desc: "Purchase order status, supplier performance and ratings",     icon: ShoppingCart,    category: "Operations" },
  { id: "system",      title: "System Overview",   desc: "Cross-system snapshot — projects, stock, orders, weather",    icon: LayoutDashboard, category: "Overview"   },
];

// ── Per-report view data (computed live from real API data) ─────────────────

interface ReportViewData {
  subtitle: string;
  stats: { label: string; value: string; sub: string }[];
  chartTitle: string;
  chartData: { name: string; value: number }[];
  healthTitle: string;
  health: { label: string; pct: string; color: string }[];
  aiInsight: string;
}

function pct(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}
function avg(nums: number[]): number {
  return nums.length > 0 ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
}
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const PROJECT_STATUS_COLORS: Record<string, string> = {
  Active: "#22c55e", Planning: "#f97316", OnHold: "#f59e0b", Completed: "#9ca3af", Cancelled: "#ef4444",
};

function buildProjectsData(projects: Project[]): ReportViewData {
  const real = projects.filter(p => !p.isHistorical);
  const byStatus = new Map<string, number>();
  for (const p of real) byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);

  const allPhases = real.flatMap(p => p.phases);
  const avgProgress = avg(allPhases.map(ph => ph.progressPercent));
  const active = byStatus.get("Active") ?? 0;

  return {
    subtitle: `${real.length} project(s) tracked`,
    stats: [
      { label: "TOTAL PROJECTS", value: String(real.length), sub: "Excludes historical records" },
      { label: "ACTIVE",         value: String(active),      sub: `${pct(active, real.length)}% of total` },
      { label: "AVG PHASE PROGRESS", value: `${avgProgress.toFixed(0)}%`, sub: `Across ${allPhases.length} phase(s)` },
    ],
    chartTitle: "Projects by Status",
    chartData: Array.from(byStatus.entries()).map(([name, value]) => ({ name, value })),
    healthTitle: "Project Status",
    health: Array.from(byStatus.entries()).map(([label, count]) => ({
      label, pct: `${pct(count, real.length)}%`, color: PROJECT_STATUS_COLORS[label] ?? "#9ca3af",
    })),
    aiInsight: real.length === 0
      ? "No projects tracked yet — create a project to start seeing real progress data here."
      : `${active} of ${real.length} project(s) are active, averaging ${avgProgress.toFixed(0)}% phase completion.`,
  };
}

function buildInventoryData(items: WarehouseStockItem[], requests: WarehouseRequest[]): ReportViewData {
  const zeroStock = items.filter(i => i.balance <= 0).length;
  const pendingRequests = requests.filter(r => r.status === "Pending").length;
  const lastSynced = items.length > 0 ? items[0].syncedAt : null;
  const topItems = [...items].sort((a, b) => b.balance - a.balance).slice(0, 8);

  return {
    subtitle: lastSynced ? `Last synced ${new Date(lastSynced).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}` : "Not synced yet",
    stats: [
      { label: "TOTAL STOCK ITEMS", value: String(items.length),    sub: "Synced from warehouse sheet" },
      { label: "ZERO-STOCK ITEMS",  value: String(zeroStock),       sub: "Need reorder" },
      { label: "PENDING REQUESTS",  value: String(pendingRequests), sub: "Awaiting warehouse approval" },
    ],
    chartTitle: "Top Stock Items by Balance",
    chartData: topItems.map(i => ({ name: truncate(i.materialName, 14), value: i.balance })),
    healthTitle: "Stock Health",
    health: [
      { label: "In Stock",   pct: `${pct(items.length - zeroStock, items.length)}%`, color: "#22c55e" },
      { label: "Zero Stock", pct: `${pct(zeroStock, items.length)}%`,                color: "#ef4444" },
    ],
    aiInsight: items.length === 0
      ? "No warehouse stock data yet — sync the warehouse sheet from the Inventory page."
      : `${zeroStock} item(s) are at zero balance and may need reordering. ${pendingRequests} warehouse request(s) are awaiting approval.`,
  };
}

const RISK_COLORS: Record<RiskLevel, string> = { Low: "#22c55e", Medium: "#f59e0b", High: "#f97316", Critical: "#ef4444" };

function buildForecastingData(forecasts: ForecastResult[]): ReportViewData {
  const materials = forecasts.flatMap(f => f.forecastedMaterials);
  const riskCounts = new Map<RiskLevel, number>([["Low", 0], ["Medium", 0], ["High", 0], ["Critical", 0]]);
  for (const m of materials) riskCounts.set(m.riskLevel, (riskCounts.get(m.riskLevel) ?? 0) + 1);
  const shortageRisks = (riskCounts.get("High") ?? 0) + (riskCounts.get("Critical") ?? 0);
  const accuracies = forecasts.map(f => f.modelAccuracy).filter((a): a is number => a != null);
  const avgAccuracy = accuracies.length > 0 ? avg(accuracies) : null;

  return {
    subtitle: `${forecasts.length} project forecast(s) · most recent run per project`,
    stats: [
      { label: "PROJECTS FORECASTED", value: String(forecasts.length), sub: "Most recent run each" },
      { label: "SHORTAGE RISKS",      value: String(shortageRisks),    sub: "High + Critical materials" },
      { label: "MODEL ACCURACY",      value: avgAccuracy != null ? `${avgAccuracy.toFixed(1)}%` : "—", sub: avgAccuracy != null ? "Avg across forecasts" : "No accuracy data yet" },
    ],
    chartTitle: "Forecasted Materials by Risk Level",
    chartData: Array.from(riskCounts.entries()).map(([name, value]) => ({ name, value })),
    healthTitle: "Risk Breakdown",
    health: Array.from(riskCounts.entries()).map(([label, count]) => ({
      label, pct: `${pct(count, materials.length)}%`, color: RISK_COLORS[label],
    })),
    aiInsight: forecasts.length === 0
      ? "No forecasts have been generated yet — run a forecast from a project's Material Plan tab."
      : `${shortageRisks} material(s) across ${forecasts.length} project(s) are at High or Critical shortage risk and may need reordering soon.`,
  };
}

const EXCESS_TYPE_COLORS: Record<string, string> = {
  Unused: "#9ca3af", Damaged: "#ef4444", Expired: "#f59e0b", Overordered: "#f97316",
};

function buildExcessData(records: ExcessWasteRecord[]): ReportViewData {
  const totalWasteRate = avg(records.filter(e => !e.isReusable).map(e => e.excessPercent));
  const totalExcessRate = avg(records.map(e => e.excessPercent));
  const reusableMaterialsCount = new Set(records.filter(e => e.isReusable).map(e => e.materialId)).size;

  const byProject = new Map<string, number[]>();
  for (const r of records) {
    const arr = byProject.get(r.projectName) ?? [];
    arr.push(r.excessPercent);
    byProject.set(r.projectName, arr);
  }
  const chartData = Array.from(byProject.entries())
    .map(([name, pcts]) => ({ name: truncate(name, 14), value: Math.round(avg(pcts) * 10) / 10 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const byType = new Map<string, number>();
  for (const r of records) byType.set(r.excessType, (byType.get(r.excessType) ?? 0) + 1);

  return {
    subtitle: `${records.length} excess/waste record(s) across ${byProject.size} project(s)`,
    stats: [
      { label: "TOTAL WASTE RATE",   value: `${totalWasteRate.toFixed(1)}%`, sub: "Non-reusable excess" },
      { label: "TOTAL EXCESS RATE",  value: `${totalExcessRate.toFixed(1)}%`, sub: "All recorded excess" },
      { label: "REUSABLE MATERIALS", value: String(reusableMaterialsCount),  sub: "Distinct materials flagged reusable" },
    ],
    chartTitle: "Avg Excess Rate by Project",
    chartData,
    healthTitle: "Excess by Type",
    health: Array.from(byType.entries()).map(([label, count]) => ({
      label, pct: `${pct(count, records.length)}%`, color: EXCESS_TYPE_COLORS[label] ?? "#9ca3af",
    })),
    aiInsight: records.length === 0
      ? "No excess or waste has been recorded yet."
      : `Waste rate is running at ${totalWasteRate.toFixed(1)}%. ${reusableMaterialsCount} distinct material(s) are flagged reusable and are good redistribution candidates.`,
  };
}

const REDISTRIBUTION_ACTIVE: RedistributionStatus[] = ["AiSuggested", "PendingApproval", "Approved", "InTransit"];
const REDISTRIBUTION_APPROVABLE: RedistributionStatus[] = ["AiSuggested", "PendingApproval"];
const PRIORITY_COLORS: Record<string, string> = { Low: "#22c55e", Medium: "#f59e0b", High: "#ef4444" };

function buildRedistributionData(items: RedistributionRecommendation[]): ReportViewData {
  const active = items.filter(r => REDISTRIBUTION_ACTIVE.includes(r.status));
  const approvable = items.filter(r => REDISTRIBUTION_APPROVABLE.includes(r.status));
  const deadStockCount = new Set(items.map(r => `${r.sourceProjectId}-${r.sourceMaterialId}`)).size;

  const byStatus = new Map<string, number>();
  for (const r of items) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  const byPriority = new Map<string, number>([["Low", 0], ["Medium", 0], ["High", 0]]);
  for (const r of items) byPriority.set(r.priority, (byPriority.get(r.priority) ?? 0) + 1);

  return {
    subtitle: `${items.length} recommendation(s) · ${deadStockCount} dead-stock item(s)`,
    stats: [
      { label: "ACTIVE OPPORTUNITIES", value: String(active.length),      sub: "AI-suggested through in-transit" },
      { label: "PENDING APPROVAL",     value: String(approvable.length), sub: "Awaiting review" },
      { label: "DEAD STOCK ITEMS",     value: String(deadStockCount),    sub: "Distinct source materials" },
    ],
    chartTitle: "Recommendations by Status",
    chartData: Array.from(byStatus.entries()).map(([name, value]) => ({ name, value })),
    healthTitle: "By Priority",
    health: Array.from(byPriority.entries()).map(([label, count]) => ({
      label, pct: `${pct(count, items.length)}%`, color: PRIORITY_COLORS[label],
    })),
    aiInsight: items.length === 0
      ? "No redistribution opportunities detected yet."
      : `${approvable.length} recommendation(s) are awaiting approval across ${deadStockCount} dead-stock item(s).`,
  };
}

interface ApiPO { id: number; status: string; expectedDate: string; }
interface ApiSupplier { id: number; name: string; rating: number; onTimePct: number; deliveries: number; }

function poEffectiveStatus(po: ApiPO): string {
  if (po.status === "Delivered" || po.status === "DeliveryInProgress") return po.status;
  return new Date(po.expectedDate).getTime() < Date.now() ? "Delayed" : po.status;
}
function isPreferredSupplier(s: ApiSupplier): boolean {
  return s.deliveries > 0 && s.rating >= 4.5 && s.onTimePct >= 90;
}
const PO_STATUS_COLORS: Record<string, string> = {
  Pending: "#b45309", Approved: "#15803d", DeliveryInProgress: "#4338ca", Delivered: "#374151", Delayed: "#dc2626",
};

function buildProcurementData(orders: ApiPO[], suppliers: ApiSupplier[]): ReportViewData {
  const byStatus = new Map<string, number>([["Pending", 0], ["Approved", 0], ["DeliveryInProgress", 0], ["Delivered", 0], ["Delayed", 0]]);
  for (const po of orders) {
    const s = poEffectiveStatus(po);
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }
  const delayed = byStatus.get("Delayed") ?? 0;
  const avgOnTime = avg(suppliers.map(s => s.onTimePct));
  const preferredCount = suppliers.filter(isPreferredSupplier).length;

  return {
    subtitle: `${orders.length} purchase order(s) · ${suppliers.length} supplier(s)`,
    stats: [
      { label: "TOTAL POs",        value: String(orders.length), sub: "All statuses" },
      { label: "DELAYED",          value: String(delayed),       sub: "Past expected delivery date" },
      { label: "AVG ON-TIME RATE", value: suppliers.length > 0 ? `${avgOnTime.toFixed(0)}%` : "—", sub: "Across rated suppliers" },
    ],
    chartTitle: "PO Status Breakdown",
    chartData: Array.from(byStatus.entries()).filter(([, v]) => v > 0 || byStatus.size <= 5).map(([name, value]) => ({ name, value })),
    healthTitle: "Supplier Tier",
    health: [
      { label: "Preferred", pct: `${pct(preferredCount, suppliers.length)}%`, color: "#22c55e" },
      { label: "Active",    pct: `${pct(suppliers.length - preferredCount, suppliers.length)}%`, color: "#3b82f6" },
    ],
    aiInsight: orders.length === 0
      ? "No purchase orders yet."
      : `${delayed} PO(s) are past their expected delivery date. ${preferredCount} of ${suppliers.length} supplier(s) qualify as Preferred (4.5+ rating, 90%+ on-time).`,
  };
}

function buildSystemData(
  projects: Project[], stockItems: WarehouseStockItem[], orders: ApiPO[],
  redistribution: RedistributionRecommendation[], excessRecords: ExcessWasteRecord[],
  weatherRisk: string | null, weatherAdvisory: string | null,
): ReportViewData {
  const real = projects.filter(p => !p.isHistorical);
  const active = real.filter(p => p.status === "Active").length;
  const zeroStock = stockItems.filter(i => i.balance <= 0).length;
  const activePOs = orders.filter(po => poEffectiveStatus(po) !== "Delivered").length;
  const activeRedistribution = redistribution.filter(r => REDISTRIBUTION_ACTIVE.includes(r.status)).length;

  return {
    subtitle: "Live cross-system snapshot",
    stats: [
      { label: "ACTIVE PROJECTS",  value: String(active),   sub: `${real.length} total tracked` },
      { label: "OPEN PURCHASE ORDERS", value: String(activePOs), sub: `${orders.length} total` },
      { label: "WEATHER RISK",     value: weatherRisk ?? "—", sub: weatherRisk ? "Current delivery risk" : "Not available" },
    ],
    chartTitle: "System Totals",
    chartData: [
      { name: "Projects", value: real.length },
      { name: "Stock Items", value: stockItems.length },
      { name: "POs", value: orders.length },
      { name: "Redistribution", value: redistribution.length },
      { name: "Excess Records", value: excessRecords.length },
    ],
    healthTitle: "Attention Needed",
    health: [
      { label: "Zero-Stock Items",       pct: String(zeroStock),            color: zeroStock > 0 ? "#ef4444" : "#22c55e" },
      { label: "Delayed POs",            pct: String(orders.filter(po => poEffectiveStatus(po) === "Delayed").length), color: "#f97316" },
      { label: "Redistribution Pending", pct: String(activeRedistribution), color: "#3b82f6" },
    ],
    aiInsight: weatherAdvisory
      ? `${weatherAdvisory} ${activePOs} purchase order(s) are still open and ${zeroStock} stock item(s) are at zero balance.`
      : `${active} of ${real.length} project(s) are active. ${activePOs} purchase order(s) are still open and ${zeroStock} stock item(s) are at zero balance.`,
  };
}

// ── PDF generator ─────────────────────────────────────────────────────────────

function generatePDF(report: Report, data: ReportViewData) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>ConstructIQ — ${report.title} Report</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; color: #111827; padding: 40px; }
    .header { display:flex; justify-content:space-between; align-items:center; padding-bottom:16px; border-bottom:3px solid #f97316; margin-bottom:24px; }
    .logo { font-size:22px; font-weight:900; color:#f97316; }
    .subtitle { font-size:12px; color:#9ca3af; margin-top:4px; }
    h1 { font-size:20px; color:#111827; margin-bottom:4px; }
    .stats { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:24px; }
    .stat-box { background:#f9fafb; border-radius:8px; padding:16px; border:1px solid #e5e7eb; }
    .stat-label { font-size:10px; color:#9ca3af; text-transform:uppercase; letter-spacing:.05em; }
    .stat-value { font-size:26px; font-weight:900; color:#111827; margin:4px 0; }
    .stat-sub { font-size:11px; color:#6b7280; }
    .section { margin-bottom:20px; }
    .section-title { font-size:13px; font-weight:700; color:#374151; margin-bottom:12px; }
    .health-row { display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #f3f4f6; font-size:12px; }
    .ai-box { background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; padding:14px; margin-top:24px; font-size:12px; color:#92400e; line-height:1.6; }
    .footer { margin-top:32px; padding-top:12px; border-top:1px solid #e5e7eb; font-size:11px; color:#9ca3af; display:flex; justify-content:space-between; }
    @media print { body { padding:20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">ConstructIQ</div>
      <div class="subtitle">Automated Material Intelligence Platform</div>
    </div>
    <div style="text-align:right">
      <h1>${report.title} Report</h1>
      <div class="subtitle">${data.subtitle}</div>
    </div>
  </div>
  <div class="stats">
    ${data.stats.map(s => `<div class="stat-box"><div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div><div class="stat-sub">${s.sub}</div></div>`).join("")}
  </div>
  <div class="section">
    <div class="section-title">${data.healthTitle}</div>
    ${data.health.map(h => `<div class="health-row"><span>${h.label}</span><span style="font-weight:700;color:${h.color}">${h.pct}</span></div>`).join("")}
  </div>
  <div class="ai-box">
    <strong>⚡ Insight:</strong><br>${data.aiInsight}
  </div>
  <div class="footer">
    <span>Generated by ConstructIQ · ${new Date().toLocaleDateString("en-PH", { year:"numeric", month:"long", day:"numeric" })}</span>
    <span>Confidential — For internal use only</span>
  </div>
</body>
</html>`;
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 400);
}

// ── Generate Report modal ─────────────────────────────────────────────────────

function GenerateModal({ report, data, onClose }: { report: Report; data: ReportViewData; onClose: () => void }) {
  const [format,    setFormat]    = useState(".PDF");
  const [generated, setGenerated] = useState(false);

  const lightIn: React.CSSProperties = {
    background: "#fff", color: "#111827", border: "1px solid #e5e7eb",
    borderRadius: 8, padding: "9px 12px", fontSize: "0.875rem", outline: "none",
    width: "100%", boxSizing: "border-box" as const,
  };

  function handleGenerate() {
    setGenerated(true);
    setTimeout(() => { generatePDF(report, data); onClose(); }, 600);
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 440, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ marginBottom: "1.25rem" }}>
          <p style={{ fontWeight: 800, fontSize: "1.05rem", color: "#111827" }}>Generate Report</p>
          <p style={{ fontSize: "0.78rem", color: "#9ca3af", marginTop: 2 }}>{report.title} · {data.subtitle}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <div>
            <p style={{ fontSize: "0.65rem", color: "#6b7280", marginBottom: 4 }}>Format</p>
            <select value={format} onChange={e => setFormat(e.target.value)} style={{ ...lightIn, appearance: "none" as const, cursor: "pointer" }}>
              {[".PDF"].map(f => <option key={f}>{f}</option>)}
            </select>
          </div>
          <div style={{ background: "#f9fafb", borderRadius: 8, padding: "0.75rem 1rem" }}>
            <p style={{ fontSize: "0.72rem", color: "#6b7280" }}>This will export the current live summary for {report.title} — the same numbers shown in the View panel.</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "1.5rem" }}>
          <button onClick={onClose} style={{ padding: "9px 20px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: "0.875rem", cursor: "pointer" }}>Cancel</button>
          <button onClick={handleGenerate} style={{ padding: "9px 24px", borderRadius: 8, border: "none", background: generated ? "#22c55e" : "#f97316", color: "#fff", fontSize: "0.875rem", fontWeight: 700, cursor: "pointer", transition: "background 0.2s" }}>
            {generated ? "✓ Generating..." : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── View Report modal ─────────────────────────────────────────────────────────

function ViewModal({ report, data, lastUpdated, onClose }: { report: Report; data: ReportViewData; lastUpdated: Date | null; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 640, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, background: "#ffedd5", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <BarChart3 style={{ width: 18, height: 18, color: "#f97316" }} />
            </div>
            <div>
              <p style={{ fontWeight: 800, fontSize: "1.05rem" }}>{report.title} Summary</p>
              <p style={{ fontSize: "0.72rem", color: "#9ca3af" }}>{data.subtitle}</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button onClick={() => generatePDF(report, data)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}>
              <Download style={{ width: 13, height: 13 }} /> Export PDF
            </button>
            <button onClick={onClose} style={{ color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 4 }}><X style={{ width: 20, height: 20 }} /></button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.75rem", marginBottom: "1.25rem" }}>
          {data.stats.map(s => (
            <div key={s.label} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.875rem" }}>
              <p style={{ fontSize: "0.62rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.06em" }}>{s.label}</p>
              <p style={{ fontSize: "1.8rem", fontWeight: 800, color: "#111827", lineHeight: 1.1, margin: "4px 0" }}>{s.value}</p>
              <p style={{ fontSize: "0.7rem", color: "#9ca3af" }}>{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Chart + Health */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: "1rem", marginBottom: "1.25rem" }}>
          <div>
            <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#374151", marginBottom: "0.75rem" }}>{data.chartTitle}</p>
            {data.chartData.length === 0 ? (
              <p style={{ fontSize: "0.78rem", color: "#d1d5db", padding: "2.5rem 0", textAlign: "center" }}>No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data.chartData} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: "0.72rem" }} />
                  <Bar dataKey="value" fill="#f97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div>
            <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#374151", marginBottom: "0.75rem" }}>{data.healthTitle}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {data.health.length === 0
                ? <p style={{ fontSize: "0.75rem", color: "#d1d5db" }}>No data yet</p>
                : data.health.map(h => (
                  <div key={h.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem" }}>
                    <span style={{ color: "#6b7280" }}>{h.label}</span>
                    <span style={{ fontWeight: 700, color: h.color }}>{h.pct}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Insight */}
        <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "0.875rem 1rem", marginBottom: "1.25rem", display: "flex", gap: 8 }}>
          <Zap style={{ width: 14, height: 14, color: "#f97316", flexShrink: 0, marginTop: 2 }} />
          <p style={{ fontSize: "0.78rem", color: "#92400e", lineHeight: 1.5 }}>{data.aiInsight}</p>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p style={{ fontSize: "0.72rem", color: "#9ca3af" }}>
            Data refreshed: {lastUpdated ? lastUpdated.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "—"}
          </p>
          <button onClick={onClose} style={{ padding: "9px 24px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer" }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type ModalState = { type: "view" | "generate"; report: Report } | null;

export default function ReportsPage() {
  const [modal,    setModal]    = useState<ModalState>(null);
  const [search,   setSearch]   = useState("");
  const [category, setCategory] = useState("All Categories");
  const [loading,  setLoading]  = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [stockItems, setStockItems] = useState<WarehouseStockItem[]>([]);
  const [warehouseRequests, setWarehouseRequests] = useState<WarehouseRequest[]>([]);
  const [redistribution, setRedistribution] = useState<RedistributionRecommendation[]>([]);
  const [orders, setOrders] = useState<ApiPO[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [excessRecords, setExcessRecords] = useState<ExcessWasteRecord[]>([]);
  const [forecasts, setForecasts] = useState<ForecastResult[]>([]);

  const risk = useWeatherStore(s => s.risk);

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      try {
        const [projectsRes, stockRes, whReqRes, redisRes, poRes, supRes] = await Promise.all([
          api.get<Project[]>("/projects"),
          api.get<WarehouseStockItem[]>("/warehouse-stock"),
          api.get<WarehouseRequest[]>("/warehouse-requests"),
          api.get<RedistributionRecommendation[]>("/redistribution"),
          api.get<ApiPO[]>("/purchase-orders"),
          api.get<ApiSupplier[]>("/suppliers"),
        ]);
        setProjects(projectsRes.data);
        setStockItems(stockRes.data);
        setWarehouseRequests(whReqRes.data);
        setRedistribution(redisRes.data);
        setOrders(poRes.data);
        setSuppliers(supRes.data);

        // Excess/waste and forecasts are recorded per project — pull each
        // active (non-historical) project's data and flatten. Isolated in
        // its own catch per project so one project with no data yet can't
        // take down the whole report.
        const activeProjects = projectsRes.data.filter(p => !p.isHistorical);
        const [excessLists, forecastLists] = await Promise.all([
          Promise.all(activeProjects.map(p =>
            api.get<ExcessWasteRecord[]>(`/excess-waste/project/${p.id}`).then(r => r.data).catch(() => []))),
          Promise.all(activeProjects.map(p =>
            // Most recent forecast run only (index 0 — backend returns newest first) so
            // stale historical runs don't skew the current risk/accuracy picture.
            api.get<ForecastResult[]>(`/forecast/project/${p.id}`).then(r => r.data.slice(0, 1)).catch(() => []))),
        ]);
        setExcessRecords(excessLists.flat());
        setForecasts(forecastLists.flat());
        setLastUpdated(new Date());
      } catch {
        toast.error("Failed to load report data.");
      } finally {
        setLoading(false);
      }
    }
    loadAll();
  }, []);

  const REPORT_DATA = useMemo<Record<string, ReportViewData>>(() => ({
    projects: buildProjectsData(projects),
    inventory: buildInventoryData(stockItems, warehouseRequests),
    forecasting: buildForecastingData(forecasts),
    excess: buildExcessData(excessRecords),
    redistribution: buildRedistributionData(redistribution),
    procurement: buildProcurementData(orders, suppliers),
    system: buildSystemData(
      projects, stockItems, orders, redistribution, excessRecords,
      risk?.level ?? null, risk?.advisory ?? null,
    ),
  }), [projects, stockItems, warehouseRequests, forecasts, excessRecords, redistribution, orders, suppliers, risk]);

  const filtered = useMemo(() => REPORTS.filter(r => {
    const matchSearch   = r.title.toLowerCase().includes(search.toLowerCase()) || r.desc.toLowerCase().includes(search.toLowerCase());
    const matchCategory = category === "All Categories" || r.category === category;
    return matchSearch && matchCategory;
  }), [search, category]);

  const btnOutline: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 5,
    padding: "6px 12px", borderRadius: 7, border: "1px solid #e5e7eb",
    background: "#fff", color: "#374151", fontSize: "0.75rem",
    fontWeight: 500, cursor: "pointer",
  };
  const btnDark: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 6,
    padding: "6px 14px", borderRadius: 7, border: "none",
    background: "#111827", color: "#fff", fontSize: "0.75rem",
    fontWeight: 600, cursor: "pointer",
  };

  return (
    <div style={{ background: "#f5f4f0" }}>
      {modal?.type === "view"     && <ViewModal     report={modal.report} data={REPORT_DATA[modal.report.id]} lastUpdated={lastUpdated} onClose={() => setModal(null)} />}
      {modal?.type === "generate" && <GenerateModal report={modal.report} data={REPORT_DATA[modal.report.id]} onClose={() => setModal(null)} />}

      <Header title="Reports" />

      <div style={{ padding: "1.25rem 1.5rem" }}>

        {/* Filter bar */}
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1.25rem" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "#9ca3af", pointerEvents: "none" }} />
            <input
              suppressHydrationWarning
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search reports..."
              style={{ width: "100%", boxSizing: "border-box" as const, paddingLeft: 34, paddingRight: 12, paddingTop: 9, paddingBottom: 9, borderRadius: 8, background: "#fff", border: "1px solid #e5e7eb", fontSize: "0.875rem", outline: "none" }}
            />
          </div>
          <select value={category} onChange={e => setCategory(e.target.value)} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontSize: "0.875rem", color: "#374151", outline: "none", cursor: "pointer", appearance: "none" as const }}>
            {["All Categories", "Overview", "Analytics", "Operations", "Management"].map(c => <option key={c}>{c}</option>)}
          </select>
          <span style={{ ...btnOutline, cursor: "default" }} title="Report data reflects the current state of each page — there's no historical date range to filter yet">
            <Filter style={{ width: 13, height: 13 }} /> {loading ? "Loading…" : lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}` : "Live"}
          </span>
        </div>

        {/* Report cards grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          {filtered.map(report => {
            const Icon = report.icon;
            const data = REPORT_DATA[report.id];
            return (
              <div key={report.id} style={{ background: "#fff", borderRadius: 14, padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: "0.875rem" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: "#f9fafb", border: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon style={{ width: 18, height: 18, color: "#6b7280" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 700, fontSize: "0.95rem", color: "#111827" }}>{report.title}</p>
                    <p style={{ fontSize: "0.72rem", color: "#9ca3af", marginTop: 2 }}>{report.desc}</p>
                  </div>
                </div>
                {!loading && data && (
                  <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.875rem" }}>
                    {data.stats.slice(0, 2).map(s => (
                      <div key={s.label} style={{ flex: 1, background: "#f9fafb", borderRadius: 8, padding: "0.5rem 0.7rem" }}>
                        <p style={{ fontSize: "0.58rem", fontWeight: 700, color: "#9ca3af", letterSpacing: "0.04em" }}>{s.label}</p>
                        <p style={{ fontSize: "1.1rem", fontWeight: 800, color: "#111827" }}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button disabled={loading} onClick={() => setModal({ type: "view", report })} style={{ ...btnOutline, opacity: loading ? 0.5 : 1, cursor: loading ? "default" : "pointer" }}>
                      <Eye style={{ width: 12, height: 12 }} /> View
                    </button>
                    <button disabled={loading} onClick={() => generatePDF(report, REPORT_DATA[report.id])} style={{ ...btnOutline, opacity: loading ? 0.5 : 1, cursor: loading ? "default" : "pointer" }}>
                      <Download style={{ width: 12, height: 12 }} /> PDF
                    </button>
                    <button disabled={loading} onClick={() => setModal({ type: "generate", report })} style={{ ...btnDark, opacity: loading ? 0.5 : 1, cursor: loading ? "default" : "pointer" }}>
                      <FileText style={{ width: 12, height: 12 }} /> Generate Report
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
