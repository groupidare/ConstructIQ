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

// One BOQ row's own prediction (actual usage, in the row's purchase unit
// when known) — forecastedMaterials sums these per material+unit.
export interface ForecastedLine {
  boqItemId: number;
  materialId: number;
  unit: string;
  forecastedQuantity: number;
  // false when `unit` is only the row's BOQ unit (no purchase unit known
  // for this row/material) — not usable as a purchase-unit Est. Qty.
  purchaseUnitKnown: boolean;
}

export interface ForecastResult {
  id: number;
  projectId: number;
  phaseId?: number;
  period: ForecastPeriod;
  generatedAt: string;
  forecastedMaterials: ForecastedMaterial[];
  // Only present on the response to generateForecast — never on saved
  // forecast history (not persisted server-side).
  lineForecasts?: ForecastedLine[];
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

// ── Model training workflow (GET /forecast/model-status, POST /forecast/train,
// GET /forecast/training-data) ────────────────────────────────────────────────

// null when the metric couldn't be computed (e.g. R² of an all-identical holdout).
export interface ModelMetrics {
  mae: number | null;
  rmse: number | null;
  r2: number | null;
  n: number;
}

export interface ModelManifest {
  version: string;
  trainedAt: string | null;
  sampleCount: number;
  projectCount: number;
  // Random 80/20 row holdout, per model and for the ensemble.
  metrics: { randomForest: ModelMetrics; xgboost: ModelMetrics; ensemble: ModelMetrics };
  // Whole-project (leave-one-project-out) holdout — the stricter check.
  projectHoldout: ModelMetrics | null;
  evaluatedProjects: number;
  skippedEvaluations: { projectId: number; reason: string }[];
  confidence: 'Normal' | 'Low' | string;
  confidenceReasons: string[];
  storage: string;
}

export type TrainingStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export interface TrainingJob {
  jobId: string | null;
  status: TrainingStatus;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface ModelStatus {
  serviceReachable: boolean;
  model: { trained: boolean; message: string | null; manifest: ModelManifest | null };
  training: TrainingJob;
}

export interface ProjectTrainingEligibility {
  projectId: number;
  projectName: string;
  boqRows: number;
  rowsWithPoLines: number;
  eligibleRows: number;
  eligible: boolean;
  reason: string | null;
}

export interface TrainingDataReport {
  completedProjects: number;
  eligibleProjects: number;
  eligibleRows: number;
  excludedProjects: number;
  minRows: number;
  minProjects: number;
  canTrain: boolean;
  projects: ProjectTrainingEligibility[];
}

export interface ForecastContribution {
  projectId: number;
  projectName: string;
  forecastedQuantity: number;
  generatedAt: string;
  period: ForecastPeriod;
  isPhaseScoped: boolean;
}

export interface TopForecastedMaterial {
  rank: number;
  materialId: number;
  materialName: string;
  specification: string;
  unit: string;
  totalForecastedQuantity: number;
  contributingProjectCount: number;
  contributions: ForecastContribution[];
}

export interface TopForecastedDemand {
  availableUnits: string[];
  selectedUnit: string | null;
  eligibleProjectCount: number;
  projectsWithForecastCount: number;
  phaseOnlyProjectCount: number;
  usedHistoricalFallback: boolean;
  historicalProjectsWithForecastCount: number;
  materials: TopForecastedMaterial[];
}
