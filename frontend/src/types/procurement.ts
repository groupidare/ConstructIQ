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

export interface RedistributionTargetSuggestion {
  projectId: number;
  projectName: string;
  // Sole real matching signal — does this project already use the exact
  // material being redistributed (BOQ or current inventory)? No shortage or
  // forecast math involved.
  usesThisMaterial: boolean;
  sameProjectType: boolean;
  matchScore: number;
  matchReason: string;
}

export interface ReceivedRedistribution {
  materialId: number;
  totalQuantity: number;
}

export interface RedistributeFromExcessRequest {
  excessWasteRecordId: number;
  targetProjectId: number;
  quantity?: number;
  notes?: string;
}

export type RedistributionPriority = "Low" | "Medium" | "High";
export type RedistributionStatus =
  | "AiSuggested" | "PendingApproval" | "Approved" | "InTransit" | "Completed" | "Rejected";

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
  unitCost: number;
  estimatedSavings: number;
  priority: RedistributionPriority;
  status: RedistributionStatus;
  isAiRecommended: boolean;
  notes?: string;
  generatedAt: string;
}
