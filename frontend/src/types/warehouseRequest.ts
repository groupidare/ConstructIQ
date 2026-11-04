export type WarehouseRequestStatus = "Pending" | "Approved" | "Rejected";

export interface WarehouseRequest {
  id: number;
  projectId: number;
  projectName: string;
  materialId: number;
  materialName: string;
  unit: string;
  requestedQuantity: number;
  approvedQuantity?: number;
  status: WarehouseRequestStatus;
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  boqItemId?: number | null;
  // Beyond what the row still needed when asked.
  isAdditional?: boolean;
  linkedStockName?: string | null;
  linkedStockUnit?: string | null;
  linkedStockBalance?: number | null;
}

export interface WarehouseRequestCreateRequest {
  projectId: number;
  materialId: number;
  requestedQuantity: number;
  boqItemId?: number;
  unit?: string;
}
