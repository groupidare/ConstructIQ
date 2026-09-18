export type DocumentCategory = "Blueprint" | "BOQ" | "PurchaseOrder" | "Contract" | "Other";

export interface ProjectDocument {
  id: number;
  projectId: number;
  projectName: string;
  category: DocumentCategory;
  categoryOther?: string;
  description?: string;
  fileName: string;
  url: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface ParsedBoqRow {
  materialName: string;
  specification: string;
  unit: string;
  estimatedQuantity: number;
  phaseHint?: string;
  matchedMaterialId?: number;
}

export interface DocumentParseResult {
  pageCount: number;
  parseErrors: string[];
  items: ParsedBoqRow[];
}

export interface ParsedPoRow {
  materialName: string;
  unit: string;
  actualQuantityOrdered: number;
  supplierName?: string;
  orderDate?: string;
  promisedDeliveryDate?: string;
  phaseHint?: string;
  matchedMaterialId?: number;
  matchedSupplierId?: number;
}

export interface PoParseResult {
  pageCount: number;
  parseErrors: string[];
  items: ParsedPoRow[];
}
