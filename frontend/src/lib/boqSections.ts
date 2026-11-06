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

// Which of the plan's sections a scanned heading ("III. ELECTRICAL WORKS") means.
// For comparing only: scanned rows keep and display the BOQ's own label.
function knownSection(section?: string): string | undefined {
  return SECTION_KEYWORDS.find(([re]) => re.test(section ?? ''))?.[1];
}

// For comparing sections: the known name, else the heading without numbering.
export function sectionKey(section?: string): string {
  return knownSection(section) ?? withoutNumbering(section).toLowerCase();
}

// "4. PLUMBING WORKS" → "PLUMBING WORKS". A roman numeral needs its point, so
// a heading that merely starts with those letters ("CIVIL WORKS") stays whole.
const withoutNumbering = (section?: string) =>
  (section ?? '').trim().replace(/^(?:[ivxlc]+[.)]|\d+[.)]?)\s+/i, '');

/** The heading a section shows: the standard name, else the BOQ's own without numbering or shouting. */
export function sectionLabel(section?: string): string {
  const known = knownSection(section);
  if (known) return known;
  const name = withoutNumbering(section);
  return name === name.toUpperCase() ? name.toLowerCase().replace(/(^|[\s/-])\p{L}/gu, c => c.toUpperCase()) : name;
}

export interface SectionGroup { key: string; label: string; indexes: number[] }

/** A plan's rows under one heading per section, however each BOQ wrote it —
 *  sections in the order they first appear, rows in plan order, so a new row
 *  lands at the bottom of its section. Rows with no section come last. */
export function groupBySection(rows: BOQItemRow[]): SectionGroup[] {
  const groups = new Map<string, SectionGroup>();
  rows.forEach((row, index) => {
    const key = sectionKey(row.primarySection);
    const group = groups.get(key) ?? { key, label: sectionLabel(row.primarySection), indexes: [] };
    groups.set(key, group);
    group.indexes.push(index);
  });
  return [...groups.values()].sort((a, b) => Number(a.key === '') - Number(b.key === ''));
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
