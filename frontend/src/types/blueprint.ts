// Blueprint → measurements → generated BOQ (see backend Models/DTOs/Blueprint).

export interface BlueprintDrawing { id: string; title: string; scale: string | null }
export interface BlueprintSheet { id: string; title: string; drawings: BlueprintDrawing[] }

/** A note on the drawing: its words, page (1-based) and box [x0, top, x1, bottom] in PDF points. */
export interface BlueprintNote { text: string; page: number | null; sheet?: string | null; box: number[] | null }

export interface BlueprintRoom {
  name: string;
  floorAreaSqm: number;
  perimeterM: number;
  lengthM: number;
  widthM: number;
  confidence: number;
  labels: string[];
  /** Traced outline in the preview image's pixels. */
  outline: [number, number][];
  /** The same outline in PDF points on the drawing's page. */
  outlinePt: [number, number][];
  /** What the floor's reflected ceiling plan says about this room. */
  ceilingNotes: string[];
  ceilingNoteDetails: BlueprintNote[];
  ceilingHeightM: number | null;
}

/** One floor of the plan set and the drawing it is read from. `confirm`: a
 *  second drawing naming the same floor, shown unticked for the user to decide. */
export interface BlueprintFloorPlan {
  floor: string;
  drawingId: string;
  confirm: boolean;
  note: string | null;
  alternatives: string[];
}

export interface BlueprintPreview { image: string; width: number; height: number }

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
  floorPlans: BlueprintFloorPlan[];
  skippedPlans: string[];
  preview: BlueprintPreview | null;
  scaleUsed: string | null;
  /** Drawing id of the reflected ceiling plan read for this floor, if any. */
  ceilingPlan: string | null;
  rooms: BlueprintRoom[];
  openings: BlueprintOpening[];
  ceilingHeightsM: number[];
  finishNotes: string[];
  /** Every finish note on the plan set's architectural sheets. */
  planNotes: BlueprintNote[];
  /** The drawing's page (1-based) and the ceiling plan's. */
  page: number | null;
  ceilingPlanPage: number | null;
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

export type FinishSourceKind = 'drawing' | 'history' | 'default' | 'chosen';

/** Where a generated row's finish came from — the weakest of the rooms it covers. */
export interface BlueprintRowSource {
  kind: FinishSourceKind;
  surface: FinishSurface | null;
  reason: string | null;
  notes: BlueprintNote[];
  projects: number | null;
  of: number | null;
  rooms: { room: string; kind: FinishSourceKind; reason: string | null; template?: string | null }[];
  template?: string | null;
  materialReason: string | null;
}

export interface GeneratedBoqRow {
  materialId: number | null;
  materialName: string | null;
  specification: string;
  /** The specification is the drawing's own note. */
  specificationFromDrawing: boolean;
  boqUnit: string;
  boqQuantity: number;
  primarySection: string;
  subCategory: string;
  sourceNote: string;
  basis: string;
  templateKey: string;
  rooms: string[];
  source: BlueprintRowSource;
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

/** A blueprint read kept with the project (BlueprintRead): what a generated
 *  row is shown against on the plan. `read` is BlueprintReadData as JSON. */
export interface BlueprintReadRecord { id: number; projectId: number; documentId: number; fileName: string; read: string; createdAt: string }

export interface BlueprintReadRoom {
  /** As named in the generated rows ("Ground Floor · Bedroom" with several floors). */
  name: string;
  outline: [number, number][];   // PDF points on the floor's page
  floorAreaSqm: number;
  perimeterM: number;
  heightM: number | null;
  ceilingNotes: BlueprintNote[];
}

export interface BlueprintReadData {
  version: 1;
  floors: { name: string; drawingId: string; title: string; page: number | null; ceilingPlanPage: number | null;
            hasCeilingPlan: boolean; rooms: BlueprintReadRoom[] }[];
  planNotes: BlueprintNote[];
}

/** What a Material Plan row keeps of its blueprint source (BOQItem.BlueprintSource, as JSON). */
export interface SavedBlueprintSource extends BlueprintRowSource {
  readId: number | null;
  /** The rows' rooms, as in the read. */
  roomNames: string[];
}

export interface BlueprintPages { pages: { width: number; height: number }[] }
