export type ExcessType = "Unused" | "Damaged" | "Expired" | "Overordered";

export interface ExcessWasteRecord {
  id: number;
  projectId: number;
  projectName: string;
  phaseId: number | null;
  phaseName: string;
  boqItemId?: number | null;
  materialId: number;
  materialName: string;
  unit: string;
  excessType: ExcessType;
  quantity: number;
  unitCost: number;
  totalCost: number;
  excessPercent: number;
  isReusable: boolean;
  notes?: string;
  recordedBy: string;
  recordedAt: string;
  redistributionStatus?: string;
  redistributionTargetProjectName?: string;
}

export interface ExcessWasteCreateRequest {
  projectId: number;
  phaseId?: number;
  boqItemId?: number;
  materialId?: number;
  newMaterialName?: string;
  unit?: string;
  excessType: ExcessType;
  quantity: number;
  unitCost: number;
  isReusable: boolean;
  notes?: string;
}

// A BOQ line from the project's real Material Plan that has no excess/waste
// logged against it yet — see ExcessWasteController.GetPendingBOQItems.
export interface PendingBOQItem {
  boqItemId: number;
  materialId: number;
  materialName: string;
  unit: string;
  estimatedQuantity: number;
}

export interface ExcessAnalyticsSummary {
  projectId: number;
  projectName: string;
  totalExcessCost: number;
  totalExcessQuantity: number;
  excessByMaterial: ExcessByMaterial[];
  monthlyTrend: MonthlyExcessTrend[];
  reusableValue: number;
}

export interface ExcessByMaterial {
  materialId: number;
  materialName: string;
  totalQuantity: number;
  totalCost: number;
  excessPercent: number;
}

// ₱ value of logged excess (reusable) and waste (non-reusable), at the latest
// recorded price — GET /excess-waste/cost-impact (Admin, ProjectManager,
// ProcurementOfficer). byMaterial is empty for ProjectManager, since it
// reveals unit prices.
export interface ExcessCostImpact {
  currency: string;
  excessValue: number;
  wasteCost: number;
  totalCost: number;
  // Approved redistribution transfers out — excess reused instead of bought again.
  redistributedValue: number;
  // Delivered PO lines — what excess + waste is a share of.
  purchasedValue: number;
  pricedRecords: number;
  unpricedRecords: number;
  unpricedTransfers: number;
  unpricedDeliveries: number;
  oldestPriceDate: string | null;
  newestPriceDate: string | null;
  byProject: ExcessCostByProject[];
  monthlyTrend: ExcessCostTrend[];
  byMaterial: ExcessCostByMaterial[];
}

export interface ExcessCostTrend {
  month: string; // yyyy-MM
  excessValue: number;
  wasteCost: number;
  redistributedValue: number;
}

export interface ExcessCostByProject {
  projectId: number;
  projectName: string;
  excessValue: number;
  wasteCost: number;
  redistributedValue: number;
  purchasedValue: number;
  unpricedRecords: number;
}

export interface ExcessCostByMaterial {
  materialId: number;
  materialName: string;
  unit: string;
  unitPrice: number;
  excessQuantity: number;
  wasteQuantity: number;
  excessValue: number;
  wasteCost: number;
}

// Excess + waste as a share of what was purchased, or null when nothing
// priced was purchased.
export function shareOfPurchases(excessValue: number, wasteCost: number, purchasedValue: number): number | null {
  return purchasedValue > 0 ? ((excessValue + wasteCost) / purchasedValue) * 100 : null;
}

// Mirrors the backend's role restriction on GET /excess-waste/cost-impact,
// so other roles never fire a call that would 403.
export function canSeeCostImpact(role: string | undefined): boolean {
  return role === "Admin" || role === "ProjectManager" || role === "ProcurementOfficer";
}

export interface MonthlyExcessTrend {
  month: string;
  totalCost: number;
  totalQuantity: number;
}
