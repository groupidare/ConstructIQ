export type ElementType = "Wall" | "Column" | "Beam" | "Slab" | "Footing";

export const ELEMENT_TYPES: ElementType[] = ["Wall", "Column", "Beam", "Slab", "Footing"];

export interface MeasurementRow {
  id?: number; // undefined = not yet saved
  phaseId: number;
  elementType: ElementType;
  areaLabel?: string;
  lengthM: number;
  widthM: number;
  heightM: number;
  thicknessM: number;
  concreteMixRatio: string;
  wasteAllowancePct: number;
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
