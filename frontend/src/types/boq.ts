export const PRIMARY_SECTIONS = [
  "Architectural Works",
  "Electrical Works",
  "Fire Detection & Alarm System Works",
  "Mechanical Works",
  "Fire Protection Works",
  "Special Fabrication Works",
  "Others",
] as const;

export type PrimarySection = (typeof PRIMARY_SECTIONS)[number];

export interface BOQItemRow {
  id?: number; // undefined = not yet saved
  phaseId?: number;
  primarySection: string;
  subCategory?: string;
  materialId?: number;
  newMaterialName?: string;
  unit?: string;
  estimatedQuantity: number;
  // Only entered for historical/completed projects backfilling training data.
  actualQuantity?: number;
  notes?: string;
}

export interface BOQItem {
  id: number;
  projectId: number;
  phaseId?: number;
  phaseName?: string;
  primarySection: string;
  subCategory?: string;
  materialId: number;
  materialName: string;
  unit: string;
  estimatedQuantity: number;
  actualQuantity: number;
  notes?: string;
  createdAt: string;
}

export interface BOQBulkSaveRequest {
  projectId: number;
  items: BOQItemRow[];
}
