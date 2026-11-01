// Floor/Ceiling/Opening come from blueprint extraction (BlueprintWizard).
export type ElementType = "Wall" | "Column" | "Beam" | "Slab" | "Footing" | "Floor" | "Ceiling" | "Opening";

export const ELEMENT_TYPES: ElementType[] = ["Wall", "Column", "Beam", "Slab", "Footing", "Floor", "Ceiling", "Opening"];

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
  // A traced room's perimeter (Floor/Ceiling rows from a blueprint).
  perimeterM?: number | null;
  concreteMixRatio: string;
  wasteAllowancePct: number;
  recordedAt: string;
}

export interface MeasurementBulkSaveRequest {
  projectId: number;
  items: MeasurementRow[];
}
