"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Header from "@/components/layout/Header";
import api from "@/lib/api";
import { useWeatherStore } from "@/store/weatherStore";
import { useAuthStore } from "@/store/authStore";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { ReportTable } from "@/lib/reportTables";
import { buildProcurementSummaryTable, poStatusLabel } from "@/lib/reportTables";
import { excessOverviewOf } from "@/lib/excessOverview";
import type { FlaggedExcessItem, MaterialOption } from "@/types/boq";
import type { Project } from "@/types/project";
import type { WarehouseStockItem } from "@/types/warehouseStock";
import type { WarehouseRequest } from "@/types/warehouseRequest";
import { canSeeCostImpact, shareOfPurchases, type ExcessCostImpact, type ExcessWasteRecord } from "@/types/excess";
import type { ForecastResult, ForecastAccuracyReport, ModelStatus } from "@/types/forecast";
import type { ExcessRelease, RedistributionRecommendation } from "@/types/procurement";
import { REDISTRIBUTED_STATUSES, UNDECIDED_STATUSES, buildProjectOverviews, movementsOf } from "@/lib/redistributionMovements";
import type { PurchaseOrder } from "@/types/purchaseOrder";
import {
  TrendingUp, Package, ShoppingCart,
  Trash2, FolderKanban, Network,
  Eye, Download, FileText, Search, Filter, X, Zap, BarChart3,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

// ── Report definitions — in sidebar order; System Overview has none ────────────

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
  { id: "forecasting", title: "Forecasting",       desc: "Demand forecasts and model accuracy",                         icon: TrendingUp,      category: "Analytics"  },
  { id: "excess",      title: "Excess",            desc: "Waste rate, excess rate, reusable materials",                 icon: Trash2,          category: "Analytics"  },
  { id: "redistribution", title: "Redistribution", desc: "Excess moved between projects, sent out and received",          icon: Network,         category: "Operations" },
  { id: "procurement", title: "Procurement",       desc: "Purchase order status, supplier performance and ratings",     icon: ShoppingCart,    category: "Operations" },
];

// ── Per-report view data (computed live from real API data) ─────────────────

interface ReportViewData {
  subtitle: string;
  stats: { label: string; value: string; sub: string }[];
  chartTitle: string;
  chartData: { name: string; value: number; value2?: number }[];
  // Only for a chart with two bars per name.
  chartBars?: { key: "value" | "value2"; name: string; color: string }[];
  healthTitle: string;
  health: { label: string; pct: string; color: string }[];
  aiInsight: string;
  // Full underlying detail — the actual lists/records behind the summary
  // stats above, not just aggregates. Rendered as real tables in both the
  // View modal and the exported PDF.
  detailTables: { title: string; table: ReportTable }[];
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
// Material/money quantities are always whole units in practice in this
// system (see BOQService.cs, forecasting_service.py) — a display-layer
// backstop, same convention lib/reportTables.ts already uses.
function num(n: number | undefined | null): number {
  return Math.round(n ?? 0);
}
const PROJECT_STATUS_COLORS: Record<string, string> = {
  Active: "#22c55e", Planning: "#f97316", OnHold: "#f59e0b", Completed: "#9ca3af", Cancelled: "#ef4444",
};

// Split as the Projects page's two tabs are, on the same Progress Tracker figure.
function buildProjectsData(projects: Project[]): ReportViewData {
  const tracked = projects.filter(p => !p.isHistorical);
  const historical = projects.filter(p => p.isHistorical);
  const byStatus = new Map<string, number>([["Active", 0], ["Planning", 0], ["Completed", 0]]);
  for (const p of tracked) byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);

  const avgProgress = avg(tracked.map(p => p.progress));
  const active = byStatus.get("Active") ?? 0;

  const tableOf = (list: Project[]): ReportTable => ({
    columns: ["Name", "Type", "Status", "Progress %", "Location", "Project Manager", "Site Engineer/PIC", "Start Date", "Target End Date"],
    rows: list.map(p => [
      p.name, p.type, p.status,
      `${num(p.progress)}%`,
      p.location, p.projectManagerName, p.siteEngineerName ?? "—",
      formatDate(p.startDate), formatDate(p.targetEndDate),
    ]),
  });

  return {
    subtitle: `${tracked.length} project(s) · ${active} active · ${historical.length} in Historical Data`,
    stats: [
      { label: "PROJECTS",        value: String(tracked.length),     sub: "On the Projects tab" },
      { label: "ACTIVE",          value: String(active),             sub: `${pct(active, tracked.length)}% of projects` },
      { label: "AVG PROGRESS",    value: `${avgProgress.toFixed(0)}%`, sub: "From the Progress Tracker" },
      { label: "HISTORICAL DATA", value: String(historical.length),  sub: "Finished projects, read-only" },
    ],
    chartTitle: "Projects by Status",
    chartData: Array.from(byStatus.entries()).map(([name, value]) => ({ name, value })),
    healthTitle: "Project Status",
    health: Array.from(byStatus.entries()).map(([label, count]) => ({
      label, pct: `${pct(count, tracked.length)}%`, color: PROJECT_STATUS_COLORS[label] ?? "#9ca3af",
    })),
    aiInsight: projects.length === 0
      ? "No projects tracked yet — create a project to start seeing real progress data here."
      : `${active} of ${tracked.length} project(s) are active, averaging ${avgProgress.toFixed(0)}% progress. ${historical.length} finished project(s) are in Historical Data.`,
    detailTables: [
      { title: "Projects", table: tableOf(tracked) },
      { title: "Historical Data", table: tableOf(historical) },
    ],
  };
}

function buildInventoryData(items: WarehouseStockItem[], requests: WarehouseRequest[]): ReportViewData {
  const zeroStock = items.filter(i => i.balance <= 0).length;
  const pendingRequests = requests.filter(r => r.status === "Pending").length;
  const lastSynced = items.length > 0 ? items[0].syncedAt : null;
  const topItems = [...items].sort((a, b) => b.balance - a.balance).slice(0, 8);

  const stockTable: ReportTable = {
    columns: ["Material", "Unit", "Balance"],
    rows: items.map(i => [i.materialName, i.unit, i.balance.toLocaleString()]),
  };
  // Rejected ones have nothing left to act on, so the page's queue drops them too.
  const requestsTable: ReportTable = {
    columns: ["Project", "Material", "Requested Qty", "Approved Qty", "Unit", "Requested", "Status", "Excess From", "Requested By", "Approved By"],
    rows: requests.filter(r => r.status !== "Rejected").map(r => [
      r.projectName, r.isAdditional ? `${r.materialName} (Additional)` : r.materialName,
      r.requestedQuantity.toLocaleString(),
      r.approvedQuantity != null ? r.approvedQuantity.toLocaleString() : "—",
      r.unit, formatDate(r.requestedAt), r.status,
      r.releaseSources?.map(x => `${x.projectName} (${x.quantity.toLocaleString()} ${r.unit})`).join(", ") || "—",
      r.requestedBy, r.approvedBy ?? "—",
    ]),
  };

  return {
    subtitle: lastSynced ? `Last synced ${new Date(lastSynced).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}` : "Not synced yet",
    stats: [
      { label: "TOTAL MATERIALS",   value: String(items.length),    sub: "Synced from warehouse sheet" },
      { label: "ZERO STOCK",        value: String(zeroStock),       sub: "Need reorder" },
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
    detailTables: [
      { title: "Stock Balance", table: stockTable },
      { title: "Requests", table: requestsTable },
    ],
  };
}

function buildForecastingData(
  forecasts: ForecastResult[],
  accuracyReports: ForecastAccuracyReport[],
  projects: Project[],
  modelStatus: ModelStatus | null,
  demandMaterials: MaterialOption[],
  excluded: FlaggedExcessItem[],
): ReportViewData {
  const materials = forecasts.flatMap(f => f.forecastedMaterials);
  const forecastByMaterial = new Map<string, number>();
  for (const material of materials) {
    forecastByMaterial.set(material.materialName, (forecastByMaterial.get(material.materialName) ?? 0) + material.forecastedQuantity);
  }

  // Real accuracy, not the forecast run's own ModelAccuracy field (the
  // ml-service never sets it) — /forecast/accuracy/{id} compares each
  // confirmed-actual BOQ row against the project's forecast directly.
  // Only projects with at least one confirmed comparison count toward the
  // average; a project with a forecast but no confirmed usage yet
  // contributes nothing (there's genuinely nothing to score it against).
  const withComparisons = accuracyReports.filter(a => a.comparisons.length > 0);
  const avgAccuracy = withComparisons.length > 0 ? avg(withComparisons.map(a => a.overallAccuracy)) : null;
  const forecastedProjectIds = new Set(forecasts.map(f => f.projectId));
  const eligibleProjects = projects.filter(p => !p.isHistorical);
  const forecastCoverage = pct(forecastedProjectIds.size, eligibleProjects.length);
  const modelR2 = modelStatus?.model.manifest?.projectHoldout?.r2
    ?? modelStatus?.model.manifest?.metrics.ensemble.r2;
  const trainedModelAccuracy = modelR2 != null
    ? Math.max(0, Math.min(100, modelR2 * 100))
    : null;

  const projectName = (id: number) => projects.find(p => p.id === id)?.name ?? `Project #${id}`;

  const comparisonTable: ReportTable = {
    columns: ["Project", "Material", "Forecasted Qty", "Actual Qty", "Variance", "Variance %", "Accuracy %"],
    rows: withComparisons.flatMap(a => a.comparisons.map(c => [
      a.projectName, c.materialName, num(c.forecastedQuantity), num(c.actualQuantity),
      num(c.variance), `${num(c.variancePercent)}%`, `${num(c.accuracyPercent)}%`,
    ])),
  };
  const forecastDetailTable: ReportTable = {
    columns: ["Project", "Material", "Forecasted Qty"],
    rows: forecasts.flatMap(f => f.forecastedMaterials.map(m => [
      projectName(f.projectId), m.materialName, num(m.forecastedQuantity),
    ])),
  };
  const demandTable: ReportTable = {
    columns: ["Material", "Unit", "Total Historical Demand"],
    rows: demandMaterials.map(m => [m.materialName, m.unit, m.totalHistoricalDemand.toLocaleString()]),
  };
  const excludedTable: ReportTable = {
    columns: ["Project", "Material", "Reason"],
    rows: excluded.map(f => [f.projectName, f.materialName, f.reason]),
  };
  const excludedNote = excluded.length > 0
    ? ` ${excluded.length} BOQ item(s) are excluded from the demand charts due to data issues.`
    : "";

  return {
    subtitle: `${forecasts.length} project forecast(s) · most recent run per project`,
    stats: [
      { label: "PROJECTS FORECASTED", value: String(forecasts.length), sub: "Most recent run each" },
      { label: "FORECASTED MATERIALS", value: String(materials.length), sub: "Current forecast rows" },
      { label: "FORECAST COVERAGE", value: `${forecastCoverage}%`, sub: `${forecastedProjectIds.size} of ${eligibleProjects.length} active project(s)` },
      // Not the Forecasting page's "Model Accuracy (vs Purchased)": that one is scored per material.
      { label: avgAccuracy != null ? "FORECAST VS ACTUAL USAGE" : "TRAINED MODEL SCORE", value: avgAccuracy != null ? `${avgAccuracy.toFixed(1)}%` : trainedModelAccuracy != null ? `${trainedModelAccuracy.toFixed(1)}%` : "—", sub: avgAccuracy != null ? `Avg across ${withComparisons.length} project(s) with confirmed usage` : trainedModelAccuracy != null ? "Trained-model evaluation (R²)" : "Model evaluation unavailable" },
      { label: "MATERIALS WITH DEMAND DATA", value: String(demandMaterials.length), sub: "From completed projects" },
      { label: "EXCLUDED BOQ ITEMS", value: String(excluded.length), sub: "Left out of the demand charts" },
    ],
    chartTitle: "Forecasted Quantity by Material",
    chartData: Array.from(forecastByMaterial.entries())
      .map(([name, value]) => ({ name: truncate(name, 14), value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8),
    healthTitle: "Forecast Coverage",
    health: [
      { label: "Forecasted",     pct: `${forecastCoverage}%`,       color: "#f97316" },
      { label: "Not Forecasted", pct: `${100 - forecastCoverage}%`, color: "#9ca3af" },
    ],
    aiInsight: forecasts.length === 0
      ? `No forecasts have been generated yet — run a forecast from a project's Material Plan tab.${excludedNote}`
      : `${materials.length} forecast material row(s) across ${forecasts.length} project(s). Accuracy measures how close the forecast was to confirmed actual usage (100% is an exact match). Variance is the difference between actual and forecasted quantity; a positive value means actual usage was higher, while a negative value means it was lower.${excludedNote}`,
    detailTables: [
      { title: "Predicted vs. Actual Usage", table: comparisonTable },
      { title: "Current Forecast Detail", table: forecastDetailTable },
      { title: "Materials in the Demand Chart", table: demandTable },
      ...(excluded.length > 0 ? [{ title: "BOQ Items Excluded from the Charts", table: excludedTable }] : []),
    ],
  };
}

// Same as the log's "Redistributed To" column.
function redistributedTo(r: ExcessWasteRecord): string {
  if (!r.isReusable) return "—";
  const transferred = r.redistributionTargetProjectName
    && REDISTRIBUTED_STATUSES.some(status => status === r.redistributionStatus);
  return [
    ...(transferred ? [r.redistributionTargetProjectName] : []),
    ...(r.warehouseReleases ?? []).map(w => `${w.projectName} (${w.quantity.toLocaleString()} ${r.unit})`),
  ].join("; ") || "—";
}

// costImpact is null for roles that can't see costs — the report is then
// exactly the quantity-only version.
function buildExcessData(records: ExcessWasteRecord[], costImpact: ExcessCostImpact | null, projects: Project[]): ReportViewData {
  const { totalWasteRate, totalExcessRate, reusableMaterialsCount, chartData } = excessOverviewOf(records, projects);
  const excessEntries = records.filter(r => r.isReusable).length;
  const projectCount = new Set(records.map(r => r.projectId)).size;

  // Excess (reusable surplus) first, highest-impact first — waste
  // (non-reusable) still included, just lower priority in the ordering.
  const excessTable: ReportTable = {
    columns: ["Project", "Material", "Type", "Quantity", "Left", "Unit", "Excess %", "Redistributed To", "Recorded By", "Recorded At"],
    rows: [...records]
      .sort((a, b) => Number(b.isReusable) - Number(a.isReusable) || b.excessPercent - a.excessPercent)
      .map(r => [
        r.projectName, r.materialName, r.isReusable ? "Excess" : "Waste", r.loggedQuantity.toLocaleString(),
        r.quantity > 0 && r.quantity < r.loggedQuantity ? r.quantity.toLocaleString() : "—", r.unit,
        `${num(r.excessPercent)}%`,
        redistributedTo(r),
        r.recordedBy, formatDate(r.recordedAt),
      ]),
  };

  const hasCost = costImpact !== null
    && (costImpact.pricedRecords > 0 || costImpact.redistributedValue > 0 || costImpact.purchasedValue > 0);
  const share = hasCost ? shareOfPurchases(costImpact.excessValue, costImpact.wasteCost, costImpact.purchasedValue) : null;
  const costTables: { title: string; table: ReportTable }[] = !hasCost ? [] : [
    {
      title: "Cost Impact by Project (material cost, latest recorded price)",
      table: {
        columns: ["Project", "Purchased", "Excess Value", "Waste Cost", "% of Purchases", "Redistributed", "Unpriced Entries"],
        rows: costImpact.byProject.map(p => {
          const projectShare = shareOfPurchases(p.excessValue, p.wasteCost, p.purchasedValue);
          return [
            p.projectName, formatCurrency(p.purchasedValue), formatCurrency(p.excessValue), formatCurrency(p.wasteCost),
            projectShare != null ? `${projectShare.toFixed(1)}%` : "—", formatCurrency(p.redistributedValue), p.unpricedRecords,
          ];
        }),
      },
    },
    ...(costImpact.monthlyTrend.length === 0 ? [] : [{
      title: "Cost Impact by Month (excess/waste by month logged, redistribution by month it moved)",
      table: {
        columns: ["Month", "Excess Value", "Waste Cost", "Redistributed"],
        rows: costImpact.monthlyTrend.map(t => [
          t.month, formatCurrency(t.excessValue), formatCurrency(t.wasteCost), formatCurrency(t.redistributedValue),
        ]),
      },
    }]),
    ...(costImpact.byMaterial.length === 0 ? [] : [{
      title: "Cost Impact by Material",
      table: {
        columns: ["Material", "Unit Price", "Excess Qty", "Excess Value", "Waste Qty", "Waste Cost"],
        rows: costImpact.byMaterial.map(m => [
          m.materialName, `${formatCurrency(m.unitPrice)}/${m.unit}`,
          `${num(m.excessQuantity)} ${m.unit}`, formatCurrency(m.excessValue),
          `${num(m.wasteQuantity)} ${m.unit}`, formatCurrency(m.wasteCost),
        ]),
      },
    }]),
  ];
  const costInsight = !hasCost ? "" :
    ` Excess still on hand is worth ${formatCurrency(costImpact.excessValue)} and waste has cost ${formatCurrency(costImpact.wasteCost)}` +
    (share != null ? ` — ${share.toFixed(1)}% of the ${formatCurrency(costImpact.purchasedValue)} purchased` : "") +
    `; redistributing excess has saved ${formatCurrency(costImpact.redistributedValue)}` +
    (costImpact.unpricedRecords > 0 ? ` (${costImpact.unpricedRecords} excess/waste entr${costImpact.unpricedRecords === 1 ? "y has" : "ies have"} no recorded price and ${costImpact.unpricedRecords === 1 ? "is" : "are"} not included).` : ".");

  return {
    subtitle: `${records.length} excess/waste record(s) across ${projectCount} project(s)`,
    stats: [
      { label: "TOTAL WASTE RATE",   value: `${totalWasteRate.toFixed(1)}%`, sub: "Non-reusable waste" },
      { label: "TOTAL EXCESS RATE",  value: `${totalExcessRate.toFixed(1)}%`, sub: "All recorded excess" },
      { label: "REUSABLE MATERIALS", value: String(reusableMaterialsCount),  sub: "Distinct materials flagged reusable" },
      ...(hasCost ? [
        { label: "EXCESS VALUE", value: formatCurrency(costImpact.excessValue), sub: "Reusable excess, at latest price" },
        { label: "WASTE COST",   value: formatCurrency(costImpact.wasteCost),   sub: "Non-reusable waste, at latest price" },
        { label: "SAVED BY REDISTRIBUTING", value: formatCurrency(costImpact.redistributedValue), sub: "Excess reused instead of bought again" },
        { label: "SHARE OF PURCHASES", value: share != null ? `${share.toFixed(1)}%` : "—",
          sub: share != null ? `Excess + waste of ${formatCurrency(costImpact.purchasedValue)} delivered` : "No priced deliveries yet" },
      ] : []),
    ],
    chartTitle: "Excess & Waste by Project",
    chartData: chartData.map(d => ({
      name: truncate(d.project, 14),
      value: Math.round(d.excessRate * 10) / 10,
      value2: Math.round(d.wasteRate * 10) / 10,
    })),
    chartBars: [
      { key: "value",  name: "Excess Rate (%)", color: "#fbbf24" },
      { key: "value2", name: "Waste Rate (%)",  color: "#dc2626" },
    ],
    healthTitle: "Excess vs Waste",
    health: [
      { label: "Excess", pct: `${pct(excessEntries, records.length)}%`,                  color: "#b45309" },
      { label: "Waste",  pct: `${pct(records.length - excessEntries, records.length)}%`, color: "#dc2626" },
    ],
    aiInsight: records.length === 0
      ? "No excess or waste has been recorded yet."
      : `Excess rate stands at ${totalExcessRate.toFixed(1)}% and waste rate at ${totalWasteRate.toFixed(1)}% across all recorded entries. ${reusableMaterialsCount} distinct material(s) are reusable, so the warehouse can release them to other projects.${costInsight}`,
    detailTables: [...costTables, { title: "Excess & Waste Records (excess prioritized)", table: excessTable }],
  };
}

// Same movements, cards and overview as the Redistribution page.
function buildRedistributionData(transfers: RedistributionRecommendation[], releases: ExcessRelease[]): ReportViewData {
  const movements = movementsOf(transfers, releases);
  const overviews = buildProjectOverviews(movements);
  const undecided = transfers.filter(t => UNDECIDED_STATUSES.includes(t.status));
  const sentProjects = overviews.filter(o => o.sentCount > 0).length;
  const receivedProjects = overviews.filter(o => o.receivedCount > 0).length;

  const overviewTable: ReportTable = {
    columns: ["Project", "Sent Out", "Received", "Last Movement"],
    rows: overviews.map(o => [o.projectName, o.sentCount, o.receivedCount, formatDate(o.movements[0].movement.at)]),
  };
  const movementsTable: ReportTable = {
    columns: ["Date", "Material", "From", "To", "Quantity", "Unit"],
    rows: movements.map(m => [
      formatDate(m.at), m.materialName, m.sourceProjectName, m.targetProjectName,
      m.quantity.toLocaleString(), m.unit,
    ]),
  };
  const undecidedTable: ReportTable = {
    columns: ["Material", "From", "To", "Quantity", "Unit"],
    rows: undecided.map(t => [t.materialName, t.sourceProjectName, t.targetProjectName, t.transferQuantity.toLocaleString(), t.unit]),
  };
  const waiting = undecided.length > 0
    ? ` ${undecided.length} transfer(s) are waiting for a decision and holding their excess until then.`
    : "";

  return {
    subtitle: `${movements.length} redistributed · ${overviews.length} project(s)`,
    stats: [
      { label: "MATERIALS REDISTRIBUTED",   value: String(movements.length), sub: "Logged excess that went to another project" },
      { label: "PROJECTS THAT SENT EXCESS", value: String(sentProjects),     sub: "Sent out at least one material" },
      { label: "PROJECTS THAT RECEIVED",    value: String(receivedProjects), sub: "Received at least one material" },
    ],
    chartTitle: "Materials Sent Out by Project",
    chartData: overviews
      .filter(o => o.sentCount > 0)
      .map(o => ({ name: truncate(o.projectName, 14), value: o.sentCount }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8),
    healthTitle: "Materials Received by Project",
    health: overviews
      .filter(o => o.receivedCount > 0)
      .sort((a, b) => b.receivedCount - a.receivedCount)
      .slice(0, 8)
      .map(o => ({ label: o.projectName, pct: String(o.receivedCount), color: "#15803d" })),
    aiInsight: movements.length === 0
      ? `No materials have been redistributed yet.${waiting}`
      : `${movements.length} logged excess movement(s) between projects: ${sentProjects} project(s) sent and ${receivedProjects} received.${waiting}`,
    detailTables: [
      { title: "Redistribution Overview per Project", table: overviewTable },
      { title: "Redistributed Materials", table: movementsTable },
      ...(undecided.length > 0 ? [{ title: "Transfers Waiting for a Decision", table: undecidedTable }] : []),
    ],
  };
}

interface ApiSupplier { id: number; name: string; rating: number; onTimePct: number; deliveries: number; }

// A PO's own status — no "Delayed" is worked out from its estimated delivery.
function poEffectiveStatus(po: PurchaseOrder): string {
  return po.status;
}
// Deliveries Warehouse rated as late — a real record, not a past-the-estimate guess.
function lateDeliveries(orders: PurchaseOrder[]): number {
  return orders.filter(po => po.deliveredOnTime === false).length;
}
function isPreferredSupplier(s: ApiSupplier): boolean {
  return s.deliveries > 0 && s.rating >= 4.5 && s.onTimePct >= 90;
}

// Wide-open range so buildProcurementSummaryTable (lib/reportTables.ts,
// already built for the per-project date-filtered report) includes every
// order regardless of date instead of duplicating that builder here.
const ALL_TIME_FROM = new Date(2000, 0, 1);
const ALL_TIME_TO   = new Date(2100, 0, 1);

function buildProcurementData(
  orders: PurchaseOrder[],
  suppliers: ApiSupplier[],
  weatherRisk: string | null,
  weatherAdvisory: string | null,
): ReportViewData {
  const byStatus = new Map<string, number>([["Pending", 0], ["Approved", 0], ["DeliveryInProgress", 0], ["Delivered", 0], ["Cancelled", 0]]);
  for (const po of orders) {
    const s = poEffectiveStatus(po);
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }
  const late = lateDeliveries(orders);
  const avgOnTime = avg(suppliers.map(s => s.onTimePct));
  const preferredCount = suppliers.filter(isPreferredSupplier).length;
  const statusCount = (status: string) => byStatus.get(status) ?? 0;

  const poTable = buildProcurementSummaryTable(orders, ALL_TIME_FROM, ALL_TIME_TO);
  const supplierTable: ReportTable = {
    columns: ["Supplier", "Rating", "On-Time %", "Deliveries", "Tier"],
    rows: suppliers.map(s => [s.name, s.rating.toFixed(1), `${num(s.onTimePct)}%`, s.deliveries, isPreferredSupplier(s) ? "Preferred" : "Active"]),
  };

  const weatherNote = weatherAdvisory
    ? ` Current weather conditions (${weatherRisk ?? "unknown"} risk): ${weatherAdvisory} — factor this into supplier lead-time expectations on top of each supplier's own on-time history below.`
    : "";

  return {
    subtitle: `${orders.length} purchase order(s) · ${suppliers.length} supplier(s)`,
    stats: [
      { label: "PENDING POs",      value: String(statusCount("Pending")),            sub: "Waiting for approval" },
      { label: "APPROVED POs",     value: String(statusCount("Approved")),           sub: "Approved, not yet delivering" },
      { label: "DELIVERED",        value: String(statusCount("Delivered")),          sub: "Fully delivered" },
      { label: "IN DELIVERY",      value: String(statusCount("DeliveryInProgress")), sub: "Delivery in progress" },
      { label: "LATE DELIVERIES",  value: String(late),          sub: "Rated late by Warehouse" },
      { label: "AVG ON-TIME RATE", value: suppliers.length > 0 ? `${avgOnTime.toFixed(0)}%` : "—", sub: "Across rated suppliers" },
    ],
    chartTitle: "PO Status Breakdown",
    chartData: Array.from(byStatus.entries()).filter(([, v]) => v > 0 || byStatus.size <= 5).map(([name, value]) => ({ name: poStatusLabel(name), value })),
    healthTitle: "Supplier Tier",
    health: [
      { label: "Preferred", pct: `${pct(preferredCount, suppliers.length)}%`, color: "#22c55e" },
      { label: "Active",    pct: `${pct(suppliers.length - preferredCount, suppliers.length)}%`, color: "#3b82f6" },
    ],
    aiInsight: (orders.length === 0
      ? "No purchase orders yet."
      : `${late} deliver${late === 1 ? "y was" : "ies were"} rated late by Warehouse. ${preferredCount} of ${suppliers.length} supplier(s) qualify as Preferred (4.5+ rating, 90%+ on-time).`) + weatherNote,
    detailTables: [
      { title: "Purchase Orders (by material line)", table: poTable },
      { title: "Suppliers", table: supplierTable },
    ],
  };
}

// ── PDF generator ─────────────────────────────────────────────────────────────

// Several of the strings interpolated below (project names, material names)
// come from user-entered data, and this HTML is injected via document.write
// into a same-origin window — unescaped, a project named e.g. `<script>...`
// would execute in that window. Escaped here rather than trusting every
// upstream string builder to have done it already.
function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function generatePDF(report: Report, data: ReportViewData, userName: string) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>ConstructIQ — ${esc(report.title)} Report</title>
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
    .ai-box { background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; padding:14px; margin-top:24px; margin-bottom:24px; font-size:12px; color:#92400e; line-height:1.6; }
    .detail-table { width:100%; border-collapse:collapse; font-size:10px; }
    .detail-table th { background:#f9fafb; text-align:left; padding:6px 8px; border-bottom:2px solid #e5e7eb; color:#374151; white-space:nowrap; }
    .detail-table td { padding:5px 8px; border-bottom:1px solid #f3f4f6; color:#374151; }
    .detail-table tr { page-break-inside:avoid; }
    .footer { margin-top:32px; padding-top:12px; border-top:1px solid #e5e7eb; font-size:11px; color:#9ca3af; display:flex; justify-content:space-between; }
    @media print { body { padding:20px; } .section { page-break-inside:auto; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">ConstructIQ</div>
      <div class="subtitle">Automated Material Intelligence Platform</div>
    </div>
    <div style="text-align:right">
      <h1>${esc(report.title)} Report</h1>
      <div class="subtitle">${esc(data.subtitle)}</div>
    </div>
  </div>
  <div class="stats">
    ${data.stats.map(s => `<div class="stat-box"><div class="stat-label">${esc(s.label)}</div><div class="stat-value">${esc(s.value)}</div><div class="stat-sub">${esc(s.sub)}</div></div>`).join("")}
  </div>
  <div class="section">
    <div class="section-title">${esc(data.healthTitle)}</div>
    ${data.health.map(h => `<div class="health-row"><span>${esc(h.label)}</span><span style="font-weight:700;color:${esc(h.color)}">${esc(h.pct)}</span></div>`).join("")}
  </div>
  <div class="ai-box">
    <strong>⚡ Insight:</strong><br>${esc(data.aiInsight)}
  </div>
  ${data.detailTables.map(dt => `
  <div class="section">
    <div class="section-title">${esc(dt.title)}</div>
    <table class="detail-table">
      <thead><tr>${dt.table.columns.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${dt.table.rows.length > 0
        ? dt.table.rows.map(row => `<tr>${row.map(v => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${dt.table.columns.length}">No data available.</td></tr>`}</tbody>
    </table>
  </div>`).join("")}
  <div class="footer">
    <span>Generated by ${esc(userName)} · ${new Date().toLocaleDateString("en-PH", { year:"numeric", month:"long", day:"numeric" })}</span>
    <span>Confidential — For internal use only</span>
  </div>
</body>
</html>`;
  const win = window.open("", "_blank");
  if (!win) {
    toast.error("Pop-up blocked — allow pop-ups for this site to generate the report.");
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 400);
}

// ── Generate Report modal ─────────────────────────────────────────────────────

function GenerateModal({ report, data, userName, onClose }: { report: Report; data: ReportViewData; userName: string; onClose: () => void }) {
  const [format,    setFormat]    = useState(".PDF");
  const [generated, setGenerated] = useState(false);

  const lightIn: React.CSSProperties = {
    background: "#fff", color: "#111827", border: "1px solid #e5e7eb",
    borderRadius: 8, padding: "9px 12px", fontSize: "0.875rem", outline: "none",
    width: "100%", boxSizing: "border-box" as const,
  };

  function handleGenerate() {
    setGenerated(true);
    setTimeout(() => { generatePDF(report, data, userName); onClose(); }, 600);
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
            <p style={{ fontSize: "0.72rem", color: "#6b7280" }}>This will export the full {report.title} report — summary stats plus the complete underlying detail, attributed to you ({userName}).</p>
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

// ── Shared detail-table renderer (View modal) ────────────────────────────────

function DetailTableSection({ title, table }: { title: string; table: ReportTable }) {
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#374151", marginBottom: "0.5rem" }}>{title}</p>
      <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 8, maxHeight: 280, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem" }}>
          <thead>
            <tr>
              {table.columns.map(c => (
                <th key={c} style={{ textAlign: "left", padding: "6px 10px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", color: "#6b7280", fontWeight: 600, whiteSpace: "nowrap", position: "sticky", top: 0 }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 ? (
              <tr><td colSpan={table.columns.length} style={{ padding: "10px 10px", color: "#d1d5db" }}>No data available.</td></tr>
            ) : table.rows.map((row, i) => (
              <tr key={i}>
                {row.map((v, j) => <td key={j} style={{ padding: "6px 10px", borderTop: "1px solid #f3f4f6", color: "#374151", whiteSpace: "nowrap" }}>{v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── View Report modal ─────────────────────────────────────────────────────────

function ViewModal({ report, data, lastUpdated, userName, onClose }: { report: Report; data: ReportViewData; lastUpdated: Date | null; userName: string; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: "1.75rem", width: 780, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
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
            <button onClick={() => generatePDF(report, data, userName)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "none", background: "#f97316", color: "#fff", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}>
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
                  {data.chartBars
                    ? data.chartBars.map(b => <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} radius={[4, 4, 0, 0]} />)
                    : <Bar dataKey="value" fill="#f97316" radius={[4, 4, 0, 0]} />}
                  {data.chartBars && <Legend wrapperStyle={{ fontSize: "0.7rem" }} />}
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

        {/* Full detail */}
        {data.detailTables.map(dt => <DetailTableSection key={dt.title} title={dt.title} table={dt.table} />)}

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
  const [excessReleases, setExcessReleases] = useState<ExcessRelease[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);
  const [excessRecords, setExcessRecords] = useState<ExcessWasteRecord[]>([]);
  const [excessCostImpact, setExcessCostImpact] = useState<ExcessCostImpact | null>(null);
  const [forecasts, setForecasts] = useState<ForecastResult[]>([]);
  const [accuracyReports, setAccuracyReports] = useState<ForecastAccuracyReport[]>([]);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [demandMaterials, setDemandMaterials] = useState<MaterialOption[]>([]);
  const [excludedItems, setExcludedItems] = useState<FlaggedExcessItem[]>([]);

  const risk = useWeatherStore(s => s.risk);
  const user = useAuthStore(s => s.user);
  const showCostImpact = canSeeCostImpact(user?.role);
  const userName = user ? `${user.firstName} ${user.lastName}`.trim() : "ConstructIQ System";

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      try {
        const [projectsRes, stockRes, whReqRes, redisRes, releasesRes, poRes, supRes] = await Promise.all([
          api.get<Project[]>("/projects"),
          api.get<WarehouseStockItem[]>("/warehouse-stock"),
          api.get<WarehouseRequest[]>("/warehouse-requests"),
          // Every request; the report keeps the same ones the Redistribution
          // page shows, so Rejected ones are left out.
          api.get<RedistributionRecommendation[]>("/redistribution/history"),
          api.get<ExcessRelease[]>("/redistribution/excess-releases"),
          api.get<PurchaseOrder[]>("/purchase-orders"),
          api.get<ApiSupplier[]>("/suppliers"),
        ]);
        setProjects(projectsRes.data);
        setStockItems(stockRes.data);
        setWarehouseRequests(whReqRes.data);
        setRedistribution(redisRes.data);
        setExcessReleases(releasesRes.data);
        setOrders(poRes.data);
        setSuppliers(supRes.data);
        api.get<ModelStatus>("/forecast/model-status").then(r => setModelStatus(r.data)).catch(() => setModelStatus(null));
        api.get<MaterialOption[]>("/boq/material-options").then(r => setDemandMaterials(r.data)).catch(() => setDemandMaterials([]));
        api.get<FlaggedExcessItem[]>("/boq/flagged-excess-items").then(r => setExcludedItems(r.data)).catch(() => setExcludedItems([]));
        // Only roles allowed to see costs — others skip the call (it would 403)
        // and get the quantity-only Excess report.
        if (showCostImpact) {
          api.get<ExcessCostImpact>("/excess-waste/cost-impact").then(r => setExcessCostImpact(r.data)).catch(() => setExcessCostImpact(null));
        } else {
          setExcessCostImpact(null);
        }

        // Excess/waste records belong to every project, including historical
        // projects. Forecasts remain scoped to live projects so stale
        // historical runs do not distort the forecasting report.
        const allProjects = projectsRes.data;
        const activeProjects = allProjects.filter(p => !p.isHistorical);
        const [excessLists, forecastLists, accuracyLists] = await Promise.all([
          Promise.all(allProjects.map(p =>
            api.get<ExcessWasteRecord[]>(`/excess-waste/project/${p.id}`).then(r => r.data).catch(() => []))),
          Promise.all(activeProjects.map(p =>
            // Most recent forecast run only (index 0 — backend returns newest first) so
            // stale historical runs don't skew the current risk/accuracy picture.
            api.get<ForecastResult[]>(`/forecast/project/${p.id}`).then(r => r.data.slice(0, 1)).catch(() => []))),
          Promise.all(activeProjects.map(p =>
            api.get<ForecastAccuracyReport>(`/forecast/accuracy/${p.id}`).then(r => r.data).catch(() => null))),
        ]);
        setExcessRecords(excessLists.flat());
        setForecasts(forecastLists.flat());
        setAccuracyReports(accuracyLists.filter((a): a is ForecastAccuracyReport => a !== null));

        setLastUpdated(new Date());
      } catch {
        toast.error("Failed to load report data.");
      } finally {
        setLoading(false);
      }
    }
    loadAll();
    const refreshOnFocus = () => { void loadAll(); };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCostImpact]);

  const REPORT_DATA = useMemo<Record<string, ReportViewData>>(() => ({
    projects: buildProjectsData(projects),
    inventory: buildInventoryData(stockItems, warehouseRequests),
    forecasting: buildForecastingData(forecasts, accuracyReports, projects, modelStatus, demandMaterials, excludedItems),
    excess: buildExcessData(excessRecords, excessCostImpact, projects),
    redistribution: buildRedistributionData(redistribution, excessReleases),
    procurement: buildProcurementData(orders, suppliers, risk?.level ?? null, risk?.advisory ?? null),
  }), [projects, stockItems, warehouseRequests, forecasts, accuracyReports, modelStatus, demandMaterials, excludedItems, excessRecords, excessCostImpact, redistribution, excessReleases, orders, suppliers, risk]);

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
      {modal?.type === "view"     && <ViewModal     report={modal.report} data={REPORT_DATA[modal.report.id]} lastUpdated={lastUpdated} userName={userName} onClose={() => setModal(null)} />}
      {modal?.type === "generate" && <GenerateModal report={modal.report} data={REPORT_DATA[modal.report.id]} userName={userName} onClose={() => setModal(null)} />}

      <Header title="Reports" />

      <div className="responsive-page" style={{ padding: "1.25rem 1.5rem" }}>

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
            {["All Categories", "Analytics", "Operations", "Management"].map(c => <option key={c}>{c}</option>)}
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
                    <button disabled={loading} onClick={() => generatePDF(report, REPORT_DATA[report.id], userName)} style={{ ...btnOutline, opacity: loading ? 0.5 : 1, cursor: loading ? "default" : "pointer" }}>
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
