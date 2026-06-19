export type MovementType = "Received" | "Released" | "Returned" | "Wasted" | "Transferred";
export type StockStatus = "Normal" | "LowStock" | "Overstock" | "OutOfStock";

export interface Material {
  id: number;
  name: string;
  specification: string;
  unit: string;
  categoryId: number;
  categoryName: string;
  unitCost: number;
}

export interface InventoryRecord {
  id: number;
  projectId: number;
  materialId: number;
  materialName: string;
  specification: string;
  unit: string;
  availableQuantity: number;
  usedQuantity: number;
  wastedQuantity: number;
  excessQuantity: number;
  reorderPoint: number;
  targetStockLevel: number;
  stockStatus: StockStatus;
  lastUpdated: string;
}

export interface MaterialMovement {
  id: number;
  inventoryRecordId: number;
  projectId: number;
  materialId: number;
  materialName: string;
  movementType: MovementType;
  quantity: number;
  unit: string;
  phaseId?: number;
  phaseName?: string;
  notes?: string;
  recordedBy: string;
  recordedAt: string;
}

export interface MovementCreateRequest {
  projectId: number;
  materialId: number;
  movementType: MovementType;
  quantity: number;
  phaseId?: number;
  notes?: string;
}
