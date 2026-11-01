import type { BOQItemRow } from '@/types/boq';

// "Scan & Fill Rows" on a plan the blueprint has already started: the
// blueprint owns the sections it filled (Architectural Works), so a client's
// BOQ only fills the other sections. Its rows for an owned section are held
// back for the user to pick from — the blueprint's separate materials (tiles,
// adhesive, grout) and a BOQ's combined line ("CHB + plaster + paint, sq.m")
// describe the same work differently, so adding both would count it twice.

const SECTION_KEYWORDS: [RegExp, string][] = [
  [/architect/i, 'Architectural Works'],
  [/fire\s*detection|fdas|alarm/i, 'Fire Detection & Alarm System Works'],
  [/fire\s*protection|sprinkler|fire\s*suppression/i, 'Fire Protection Works'],
  [/electrical/i, 'Electrical Works'],
  [/mechanical|hvac|air[\s-]?con/i, 'Mechanical Works'],
  [/fabrication/i, 'Special Fabrication Works'],
];

// A scanned section heading ("III. ELECTRICAL WORKS") as the plan's section name.
export function knownSection(section?: string): string | undefined {
  return SECTION_KEYWORDS.find(([re]) => re.test(section ?? ''))?.[1];
}

// For comparing sections: the known name, else the heading without numbering.
function sectionKey(section?: string): string {
  return knownSection(section) ?? (section ?? '').trim().replace(/^[ivxlc\d]+[.)]?\s+/i, '').toLowerCase();
}

export const isBlueprintRow = (row: BOQItemRow) => /^from blueprint/i.test(row.notes ?? '');

const normal = (s?: string) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function rowKey(row: BOQItemRow): string {
  const what = row.materialId != null ? `#${row.materialId}` : normal(row.specification || row.newMaterialName);
  return [sectionKey(row.primarySection), what, normal(row.unit), Math.round(row.estimatedQuantity * 1000)].join('|');
}

export interface ScanSplit {
  add: BOQItemRow[];       // sections the blueprint didn't fill
  covered: BOQItemRow[];   // sections the blueprint filled — the user picks
  duplicates: number;      // already in the plan (e.g. the same BOQ scanned twice)
}

export function splitScannedRows(scanned: BOQItemRow[], existing: BOQItemRow[]): ScanSplit {
  const owned = new Set(existing.filter(isBlueprintRow).map(r => sectionKey(r.primarySection)));
  const present = new Set(existing.map(rowKey));
  const split: ScanSplit = { add: [], covered: [], duplicates: 0 };
  for (const row of scanned) {
    if (present.has(rowKey(row))) { split.duplicates++; continue; }
    (owned.has(sectionKey(row.primarySection)) ? split.covered : split.add).push(row);
  }
  return split;
}
