import type { PurchaseOrderStatus } from '@/types/purchaseOrder';

export interface MaterialRequest {
  id: number;
  materialId: number;
  materialName: string;
  quantity: number;
  unit: string;
  requestedByName: string;
  createdAt: string;
}

// What's been asked of Procurement for a project, on a PO or not.
export interface SentMaterialRequest {
  id: number;
  boqItemId?: number | null;
  materialName: string;
  quantity: number;
  unit?: string | null;
  isAdditional: boolean;
  createdAt: string;
  poNumber?: string | null;
  poStatus?: PurchaseOrderStatus | null;
}

export interface ProjectWithRequests {
  projectId: number;
  projectName: string;
  pendingCount: number;
}

export interface SuggestedSupplier {
  id: number;
  name: string;
  rating: number;
  onTimePct: number;
  deliveries: number;
  hasHistoryWithMaterial: boolean;
}

export interface CreateMaterialRequestPayload {
  projectId: number;
  materialId: number;
  quantity: number;
  unit?: string;
  boqItemId?: number;
}

export interface GeneratePOAssignment {
  requestId: number;
  supplierName: string;
}

export interface GeneratePOsFromRequestsPayload {
  projectId: number;
  expectedDate: string;
  assignments: GeneratePOAssignment[];
}

export interface GeneratedPOsResult {
  purchaseOrders: unknown[]; // not consumed directly by the Requests overlay
  requestPoNumbers: Record<number, string>;
}

export interface RemainingRequestable {
  materialId: number;
  remaining: number;
}
