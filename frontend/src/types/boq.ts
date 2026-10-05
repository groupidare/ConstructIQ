export const PRIMARY_SECTIONS = [
  "Architectural Works",
  "Electrical Works",
  "Fire Detection & Alarm System Works",
  "Mechanical Works",
  "Fire Protection Works",
  "Special Fabrication Works",
  "Others",
] as const;

export type PrimarySection = (typeof PRIMARY_SECTIONS)[number];

// Offered for the Est. Qty column's Unit dropdown (new/non-historical
// projects) — mirrors BOQService's PurchaseUnits allowlist. Originally just
// container units, but real historical PO data legitimately orders some
// materials (roofing sheets, gutters, pipe) by sq.m/l.m/cu.m too, so those
// are included as well rather than silently blocking a real match.
export const PURCHASE_UNITS = ['pc', 'bag', 'sheet', 'pail', 'gal', 'roll', 'set', 'box', 'sq.m', 'l.m', 'cu.m', 'lot', 'kg', 'pack'] as const;

export interface BOQItemRow {
  id?: number; // undefined = not yet saved
  phaseId?: number;
  primarySection: string;
  subCategory?: string;
  specification?: string;
  materialId?: number;
  newMaterialName?: string;
  unit?: string;
  estimatedQuantity: number;
  // Only entered for historical/completed projects backfilling training data.
  actualQuantity?: number;
  // Server-computed, read-only — true only when actualQuantity is a genuine
  // logged/entered figure (a real Excess/Waste record, or a human-typed
  // historical backfill), false when it's just the estimate standing in
  // because nothing was ever confirmed. Never sent to the backend on save.
  isUsageConfirmed?: boolean;
  notes?: string;
  historicalSupply?: HistoricalSupplyLine[];
  // Predicted procurement qty/unit for new projects — suggested from
  // historical BOQ+PO data, user-editable. Stays blank until the user clicks
  // "Run Forecast" (see Shell.tsx's handleRunForecast) — never filled in the
  // background just from scanning/typing. Not applicable to historical rows.
  estimatedPurchaseQuantity?: number;
  estimatedPurchaseUnit?: string;
  // Client-only: true once the user has directly edited the Est. Qty/Unit
  // fields for this row, so Run Forecast's suggestion step never overwrites it.
  // Never sent to the backend (BOQItemUpsertDto has no matching field).
  estimatePurchaseManuallySet?: boolean;
  // How much of estimatedPurchaseQuantity has been requested so far (a
  // partial request shrinks this row to what was actually requested and
  // spins the leftover off into a new sibling row) — see BOQService.
  requestedQuantity?: number;
  // Server-computed, read-only — never sent to the backend on save (no
  // matching field on BOQItemUpsertDto). "Net Left to Order": Est. Qty minus
  // whatever's actually been APPROVED so far (redistribution transfer,
  // warehouse release, or purchase order past Pending) — a still-Pending
  // request never moves this. See ProcurementCapCalculator.
  netLeftToOrder?: number;
  // Server-computed, read-only — true once at least one Warehouse Check for
  // this row's material has been approved by Warehouse personnel.
  // Procurement must not be requestable before this.
  warehouseApproved?: boolean;
  // Server-computed, read-only — the real cap Notify Procurement/Warehouse
  // will enforce: NetLeftToOrder further reduced by every MaterialRequest
  // ever submitted for this material (not just approved sources). Can be
  // LOWER than netLeftToOrder — e.g. a request for the full amount is
  // already sent and awaiting a Purchase Order. Use this, not
  // netLeftToOrder, as the request dialog's actual quantity cap, or the
  // dialog can invite a quantity the backend will then reject.
  remainingRequestable?: number;
}

export interface HistoricalSupplyLine {
  poNumber?: string;
  materialName: string;
  unit: string;
  quantity: number;
  supplierName?: string;
}

export interface BOQItem {
  id: number;
  projectId: number;
  phaseId?: number;
  phaseName?: string;
  primarySection: string;
  subCategory?: string;
  materialId: number;
  materialName: string;
  specification?: string;
  unit: string;
  estimatedQuantity: number;
  actualQuantity: number;
  // See BOQItemRow — same confirmed/inferred signal, carried through on the
  // plain response type too.
  isUsageConfirmed: boolean;
  notes?: string;
  historicalSupply?: HistoricalSupplyLine[];
  estimatedPurchaseQuantity?: number;
  estimatedPurchaseUnit?: string;
  requestedQuantity?: number;
  // See BOQItemRow — same server-computed fields, carried through on the
  // plain response type too.
  netLeftToOrder?: number;
  warehouseApproved?: boolean;
  remainingRequestable?: number;
  createdAt: string;
}

export interface HistoricalEstimate {
  estimatedQuantity: number | null;
  unit: string | null;
  matchCount: number;
}

// One point on the Forecasting page's chart — completed projects only, each
// placed in its completion month, see BOQController.GetMonthlyDemandSummary.
export interface MonthlyDemandSummary {
  month: string;
  monthLabel: string;
  materialId: number;
  materialName: string;
  unit: string;
  actualUsage: number | null;
  aiPredicted: number | null;
  // Every project behind either figure this month.
  projectCount: number;
  contributingProjects: string[];
  estimatedTotal: number | null;
  excessTotal: number | null;
  wasteTotal: number | null;
}

// One entry in the Forecasting page's material selector — every unique
// material+unit pair that has ever contributed a real, validated Actual
// Usage figure, ranked by total historical demand. See
// BOQController.GetMaterialOptions.
export interface MaterialOption {
  materialId: number;
  materialName: string;
  unit: string;
  totalHistoricalDemand: number;
}

// A BOQItem where logged Excess+Waste exceeds its EstimatedQuantity — data
// that can't be trusted for the Actual Usage calculation, surfaced for
// review rather than silently clamped or hidden. See
// BOQController.GetFlaggedExcessItems.
export interface FlaggedExcessItem {
  boqItemId: number;
  projectId: number;
  projectName: string;
  materialName: string;
  unit: string;
  estimatedQuantity: number;
  excessTotal: number;
  wasteTotal: number;
  reason: string;
}

export interface BOQBulkSaveRequest {
  projectId: number;
  items: BOQItemRow[];
}
