// Builds the real, per-report-type table content for the Generate Report
// feature (see ReportsModal in app/(dashboard)/projects/page.tsx). Each
// report type is backed by the same data the rest of the app already shows
// for that project — nothing here is hardcoded or invented.
import { parseServerDate, formatDate } from "@/lib/utils";
import type { BOQItem } from "@/types/boq";
import type { PurchaseOrder } from "@/types/purchaseOrder";
import type { ExcessWasteRecord } from "@/types/excess";
import type { ForecastResult } from "@/types/forecast";

export interface ReportTable {
  columns: string[];
  rows: (string | number)[][];
}

export interface ReportSourceData {
  boqItems?: BOQItem[];
  purchaseOrders?: PurchaseOrder[];
  excessRecords?: ExcessWasteRecord[];
  forecastResults?: ForecastResult[];
}

function inRange(dateStr: string | undefined | null, from: Date, to: Date): boolean {
  if (!dateStr) return false;
  const t = parseServerDate(dateStr).getTime();
  // A date-only "To" picker parses to midnight (00:00) of that day, which
  // would silently exclude every record from later that same day — end of
  // day instead, so picking "today" actually includes today.
  const endOfTo = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999).getTime();
  return t >= from.getTime() && t <= endOfTo;
}

// Material quantities are always whole units in practice — matches the
// rounding already enforced where these values are saved (BOQService.cs,
// forecasting_service.py). This is a display-layer backstop for any value
// that reaches a report without having passed through that save point
// (e.g. older rows saved before that fix, or fields computed elsewhere).
function num(n: number | undefined | null): number {
  return Math.round(n ?? 0);
}

// Unlike POs/excess records/forecasts, a BOQ item has no "usage date" of its
// own — createdAt is just when the material-plan row was entered (usually
// all at once, during project setup), not when the material was actually
// used. Filtering by it would hide real, currently-tracked usage any time
// the report's period doesn't happen to match that one-time setup date, so
// this report always reflects the material plan's current state instead.
export function buildMaterialUsageTable(items: BOQItem[]): ReportTable {
  const rows = items
    .map(i => [
      i.primarySection,
      i.subCategory ?? "—",
      i.materialName,
      i.unit,
      num(i.estimatedQuantity),
      // estimatedQuantity (above) is the scanned/measured total — what the
      // Material Plan screen itself labels "Total Area/Qty". The purchase
      // estimate is a separate field (estimatedPurchaseQuantity, in its own
      // unit) that this report previously omitted entirely while mislabeling
      // the column above as "Est. Qty" — both are included here now, each
      // under the same name the Material Plan screen already uses for it.
      num(i.estimatedPurchaseQuantity),
      i.estimatedPurchaseUnit ?? "—",
      num(i.actualQuantity),
      num(i.requestedQuantity),
    ]);
  return {
    columns: ["Section", "Sub-Category", "Material", "Unit", "Total Area/Qty", "Est. Purchase Qty", "Purchase Unit", "Actual Qty", "Requested Qty"],
    rows,
  };
}

export function buildProcurementSummaryTable(orders: PurchaseOrder[], from: Date, to: Date): ReportTable {
  const rows: (string | number)[][] = [];
  orders
    .filter(o => inRange(o.orderDate, from, to))
    .forEach(o => {
      o.materials.forEach(m => {
        rows.push([o.number, o.supplierName, o.status, formatDate(o.orderDate), formatDate(o.expectedDate), m.name, num(m.quantity), m.unit]);
      });
    });
  return {
    columns: ["PO Number", "Supplier", "Status", "Order Date", "Expected Date", "Material", "Quantity", "Unit"],
    rows,
  };
}

export function buildExcessAnalyticsTable(records: ExcessWasteRecord[], from: Date, to: Date): ReportTable {
  const rows = records
    .filter(r => inRange(r.recordedAt, from, to))
    .map(r => [
      r.materialName,
      r.excessType,
      num(r.quantity),
      r.unit,
      `${num(r.excessPercent)}%`,
      r.isReusable ? "Yes" : "No",
      r.redistributionStatus ?? "—",
    ]);
  return {
    columns: ["Material", "Type", "Quantity", "Unit", "Excess %", "Reusable", "Redistribution"],
    rows,
  };
}

export function buildForecastReportTable(results: ForecastResult[], from: Date, to: Date): ReportTable {
  const rows: (string | number)[][] = [];
  results
    .filter(f => inRange(f.generatedAt, from, to))
    .forEach(f => {
      f.forecastedMaterials.forEach(m => {
        rows.push([
          f.period,
          formatDate(f.generatedAt),
          m.materialName,
          num(m.forecastedQuantity),
          num(m.currentStock),
          num(m.shortage),
          m.riskLevel,
          num(m.reorderSuggestion),
        ]);
      });
    });
  return {
    columns: ["Period", "Generated", "Material", "Forecasted Qty", "Current Stock", "Shortage", "Risk Level", "Reorder Suggestion"],
    rows,
  };
}

// Dispatches to the right builder for whichever "Report Type" the user
// selected in ReportsModal — the dropdown's options must stay in sync with
// the case labels here (see REPORT_TYPES in that file).
export function buildReportTable(reportType: string, data: ReportSourceData, from: Date, to: Date): ReportTable {
  switch (reportType) {
    case "Material Usage":       return buildMaterialUsageTable(data.boqItems ?? []);
    case "Procurement Summary":  return buildProcurementSummaryTable(data.purchaseOrders ?? [], from, to);
    case "Excess Analytics":     return buildExcessAnalyticsTable(data.excessRecords ?? [], from, to);
    case "Forecast Report":      return buildForecastReportTable(data.forecastResults ?? [], from, to);
    default:                     return { columns: [], rows: [] };
  }
}
