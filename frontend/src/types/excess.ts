export type ExcessType = "Unused" | "Damaged" | "Expired" | "Overordered";

export interface ExcessWasteRecord {
  id: number;
  projectId: number;
  projectName: string;
  phaseId: number | null;
  phaseName: string;
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
}

export interface ExcessWasteCreateRequest {
  projectId: number;
  phaseId?: number;
  materialId?: number;
  newMaterialName?: string;
  unit?: string;
  excessType: ExcessType;
  quantity: number;
  unitCost: number;
  isReusable: boolean;
  notes?: string;
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

export interface MonthlyExcessTrend {
  month: string;
  totalCost: number;
  totalQuantity: number;
}
