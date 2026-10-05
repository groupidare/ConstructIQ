// Matches backend/ConstructIQ.API/Models/Entities/PurchaseOrder.cs's enum —
// DeliveryInProgress (3) was missing here even though it's a real, reachable
// status (see PurchaseOrderStatus enum's own comment on why it's out of
// numeric order).
export type PurchaseOrderStatus = "Pending" | "Approved" | "Delivered" | "DeliveryInProgress";

export interface PurchaseOrderMaterial {
  id?: number;
  name: string;
  quantity: number;
  unit: string;
  // Links back to the real catalog/BOQ — see backend PurchaseOrderMaterial.
  materialId?: number;
  boqItemId?: number;
  phaseId?: number;
  primarySection?: string;
  subCategory?: string;
}

export interface PurchaseOrder {
  id: number;
  number: string;
  projectId: number;
  projectName: string;
  supplierId: number;
  supplierName: string;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDate: string;
  materials: PurchaseOrderMaterial[];
}

export interface CreatePurchaseOrderRequest {
  projectId: number;
  supplierName: string;
  orderDate?: string;
  expectedDate: string;
  materials: PurchaseOrderMaterial[];
}
