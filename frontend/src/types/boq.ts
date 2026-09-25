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

// Purchasable container units — offered for the Est. Qty column's Unit
// dropdown (new/non-historical projects). Deliberately excludes measurement
// units (sq.m, l.m, cu.m...) already used for Total Area/Qty above, since
// those aren't real order quantities.
export const PURCHASE_UNITS = ['pc', 'bag', 'sheet', 'pail', 'gal', 'roll', 'set', 'box'] as const;

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
  createdAt: string;
}

export interface HistoricalEstimate {
  estimatedQuantity: number | null;
  unit: string | null;
  matchCount: number;
}

export interface BOQBulkSaveRequest {
  projectId: number;
  items: BOQItemRow[];
}
