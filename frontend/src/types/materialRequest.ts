export interface MaterialRequest {
  id: number;
  materialId: number;
  materialName: string;
  quantity: number;
  unit: string;
  requestedByName: string;
  createdAt: string;
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
