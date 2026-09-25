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
  notes?: string;
  historicalSupply?: HistoricalSupplyLine[];
  // Predicted procurement qty/unit for new projects — auto-suggested from
  // historical BOQ+PO data, user-editable. Not applicable to historical rows.
  estimatedPurchaseQuantity?: number;
  estimatedPurchaseUnit?: string;
  // Client-only: true once the user has directly edited the Est. Qty/Unit
  // fields for this row, so the auto-suggest effect stops overwriting it.
  // Never sent to the backend (BOQItemUpsertDto has no matching field).
  estimatePurchaseManuallySet?: boolean;
  // How much of estimatedPurchaseQuantity has been requested so far (a
  // partial request shrinks this row to what was actually requested and
  // spins the leftover off into a new sibling row) — see BOQService.
  requestedQuantity?: number;
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
  notes?: string;
  historicalSupply?: HistoricalSupplyLine[];
  estimatedPurchaseQuantity?: number;
  estimatedPurchaseUnit?: string;
  requestedQuantity?: number;
  createdAt: string;
}

export interface HistoricalEstimate {
  estimatedQuantity: number | null;
  unit: string | null;
  matchCount: number;
}

// One point on the Forecasting page's chart — real project data (not a
// trained model's own output), see BOQController.GetMonthlyDemandSummary.
export interface MonthlyDemandSummary {
  month: string;
  monthLabel: string;
  aiPredicted: number | null;
  actualUsage: number | null;
}

export interface BOQBulkSaveRequest {
  projectId: number;
  items: BOQItemRow[];
}
