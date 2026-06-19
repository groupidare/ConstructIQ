export type PurchaseRequestStatus = "Draft" | "Pending" | "Approved" | "Rejected" | "Ordered";

export interface ProcurementRecommendation {
  id: number;
  projectId: number;
  materialId: number;
  materialName: string;
  unit: string;
  currentStock: number;
  reorderPoint: number;
  targetStockLevel: number;
  forecastedDemand: number;
  recommendedQuantity: number;
  suggestedReorderDate: string;
  estimatedLeadTimeDays: number;
  estimatedCost: number;
  urgencyLevel: "Low" | "Medium" | "High" | "Critical";
  generatedAt: string;
  notes?: string;
}

export interface PurchaseRequest {
  id: number;
  projectId: number;
  projectName: string;
  recommendationId?: number;
  materialId: number;
  materialName: string;
  unit: string;
  requestedQuantity: number;
  estimatedUnitCost: number;
  totalEstimatedCost: number;
  status: PurchaseRequestStatus;
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  notes?: string;
}

export interface PurchaseRequestCreateRequest {
  projectId: number;
  recommendationId?: number;
  materialId: number;
  requestedQuantity: number;
  estimatedUnitCost: number;
  notes?: string;
}

export interface RedistributionRecommendation {
  id: number;
  sourceMaterialId: number;
  materialName: string;
  unit: string;
  sourceProjectId: number;
  sourceProjectName: string;
  targetProjectId: number;
  targetProjectName: string;
  availableQuantity: number;
  neededQuantity: number;
  transferQuantity: number;
  estimatedSavings: number;
  status: "Pending" | "Approved" | "Transferred" | "Rejected";
  generatedAt: string;
}
