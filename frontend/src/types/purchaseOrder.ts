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
  // ₱ per unit. Only Admin/ProcurementOfficer ever receive it (null otherwise).
  unitPrice?: number | null;
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
  // A PO made before the project was entered in ConstructIQ — numbered
  // IMP-001…, with the paper PO's own number kept here.
  isImported?: boolean;
  originalPoNumber?: string | null;
  // Storage path of the PO's file (an imported PO keeps its document's).
  poFileUrl?: string | null;
}

export interface ImportPurchaseOrderRequest {
  projectId: number;
  supplierName: string;
  originalPoNumber?: string;
  orderDate: string;
  // Required unless delivered.
  expectedDate?: string;
  delivered: boolean;
  documentId?: number;
  materials: PurchaseOrderMaterial[];
}

export interface CreatePurchaseOrderRequest {
  projectId: number;
  supplierName: string;
  orderDate?: string;
  expectedDate: string;
  materials: PurchaseOrderMaterial[];
}
