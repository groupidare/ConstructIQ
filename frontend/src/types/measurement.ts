export type ElementType = "Wall" | "Column" | "Beam" | "Slab" | "Footing";

export const ELEMENT_TYPES: ElementType[] = ["Wall", "Column", "Beam", "Slab", "Footing"];

export interface MeasurementRow {
  id?: number; // undefined = not yet saved
  phaseId?: number; // undefined = not yet assigned (e.g. fresh auto-scan result)
  elementType: ElementType;
  areaLabel?: string;
  lengthM: number;
  widthM: number;
  heightM: number;
  thicknessM: number;
  concreteMixRatio: string;
  wasteAllowancePct: number;
  // Frontend-only, dropped by the backend — flags a row that came from the
  // best-effort blueprint scanner rather than manual entry.
  autoScanned?: boolean;
  sourcePage?: number;
  ocrUsed?: boolean;
}

export interface Measurement {
  id: number;
  projectId: number;
  phaseId: number;
  phaseName: string;
  elementType: ElementType;
  areaLabel?: string;
  lengthM: number;
  widthM: number;
  heightM: number;
  thicknessM: number;
  areaSqm: number;
  volumeCbm: number;
  concreteMixRatio: string;
  wasteAllowancePct: number;
  recordedAt: string;
}

export interface MeasurementBulkSaveRequest {
  projectId: number;
  items: MeasurementRow[];
}
