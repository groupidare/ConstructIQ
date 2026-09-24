export type MaterialRequestStatus = "Pending" | "Approved";

export interface MaterialRequest {
  id: number;
  projectId: number;
  projectName: string;
  materialId: number;
  materialName: string;
  unit: string;
  requestedQuantity: number;
  status: MaterialRequestStatus;
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface MaterialRequestCreateRequest {
  projectId: number;
  materialId: number;
  requestedQuantity: number;
}
