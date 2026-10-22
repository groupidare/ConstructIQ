// Blueprint → measurements → generated BOQ (see backend Models/DTOs/Blueprint).

export interface BlueprintDrawing { id: string; title: string; scale: string | null }
export interface BlueprintSheet { id: string; title: string; drawings: BlueprintDrawing[] }

export interface BlueprintRoom {
  name: string;
  floorAreaSqm: number;
  perimeterM: number;
  lengthM: number;
  widthM: number;
  confidence: number;
  labels: string[];
}

export interface BlueprintOpening {
  type: 'door' | 'window' | string;
  count: number;
  widthM: number | null;
  heightM: number | null;
  assumedWidth: boolean;
  assumedHeight: boolean;
}

export interface BlueprintScheduleCheck {
  planTotalSqm: number | null;
  extractedTotalSqm: number | null;
  clearTotalSqm: number | null;
  differencePct: number | null;
}

export interface BlueprintResult {
  sheets: BlueprintSheet[];
  selectedDrawing: string | null;
  rooms: BlueprintRoom[];
  openings: BlueprintOpening[];
  ceilingHeightsM: number[];
  finishNotes: string[];
  scheduleCheck: BlueprintScheduleCheck | null;
  warnings: string[];
  errors: string[];
}

export type FinishSurface = 'floor' | 'wall' | 'ceiling' | 'openings';

export interface FinishTemplate {
  key: string;
  surface: FinishSurface;
  label: string;
  notePattern: string | null;
  rows: { name: string; boqUnit: string; basis: string; subCategory: string }[];
}

export interface GeneratedBoqRow {
  materialId: number | null;
  materialName: string | null;
  specification: string;
  boqUnit: string;
  boqQuantity: number;
  primarySection: string;
  subCategory: string;
  sourceNote: string;
  basis: string;
  templateKey: string;
  rooms: string[];
  baseline: {
    baselineQuantity: number | null;
    purchaseQuantity: number | null;
    purchaseUnit: string | null;
    formulaText: string | null;
    reason: string | null;
  };
}

export interface GeneratedBoq { rows: GeneratedBoqRow[]; warnings: string[] }

export type MergeAction = 'add' | 'skip' | 'flag' | 'incomplete';

export interface MergeRow {
  action: MergeAction;
  scanned: {
    materialName: string;
    specification?: string | null;
    unit: string;
    estimatedQuantity: number;
    primarySection?: string | null;
    subCategory?: string | null;
    matchedMaterialId?: number | null;
  };
  generatedIndex: number | null;
  generatedQuantity: number | null;
  differencePct: number | null;
  reason: string | null;
}

export interface MergePreview { rows: MergeRow[]; parseErrors: string[] }
