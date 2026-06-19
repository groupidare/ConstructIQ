export type ForecastPeriod = "Weekly" | "Monthly" | "PhaseEnd";
export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export interface ForecastRequest {
  projectId: number;
  phaseId?: number;
  period: ForecastPeriod;
  planningWeeks?: number;
}

export interface ForecastedMaterial {
  materialId: number;
  materialName: string;
  unit: string;
  forecastedQuantity: number;
  currentStock: number;
  shortage: number;
  riskLevel: RiskLevel;
  reorderSuggestion: number;
}

export interface ForecastResult {
  id: number;
  projectId: number;
  phaseId?: number;
  period: ForecastPeriod;
  generatedAt: string;
  forecastedMaterials: ForecastedMaterial[];
  modelAccuracy?: number;
  notes?: string;
}

export interface ForecastComparison {
  materialId: number;
  materialName: string;
  unit: string;
  forecastedQuantity: number;
  actualQuantity: number;
  variance: number;
  variancePercent: number;
  accuracyPercent: number;
}

export interface ForecastAccuracyReport {
  projectId: number;
  projectName: string;
  overallAccuracy: number;
  mae: number;
  rmse: number;
  comparisons: ForecastComparison[];
}
