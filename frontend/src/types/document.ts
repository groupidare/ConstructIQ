export type DocumentCategory = "Blueprint" | "BOQ";

export interface ProjectDocument {
  id: number;
  projectId: number;
  category: DocumentCategory;
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

// Best-effort text/OCR scan of a blueprint for dimension callouts — not a
// trained model, always needs review. See ml-service/dimension_extractor.py.
export interface ParsedMeasurementRow {
  elementType: string;
  lengthM: number;
  widthM: number;
  heightM: number;
  thicknessM: number;
  areaLabel?: string;
  sourcePage: number;
  ocrUsed: boolean;
}

export interface MeasurementParseResult {
  pageCount: number;
  ocrPagesUsed: number;
  parseErrors: string[];
  items: ParsedMeasurementRow[];
}
