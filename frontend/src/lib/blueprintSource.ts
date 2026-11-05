import type { BOQItemRow } from '@/types/boq';
import type { GeneratedBoqRow, SavedBlueprintSource } from '@/types/blueprint';

// A blueprint-generated Material Plan row keeps where its finish came from
// (BOQItem.BlueprintSource): the drawing's note and page, the company's past
// projects, a default, or the user's pick — shown when hovering its
// specification and in its plan viewer.

export const PRIMARY_SECTION = 'Architectural Works';

export function sourceOf(row: Pick<BOQItemRow, 'blueprintSource'>): SavedBlueprintSource | null {
  if (!row.blueprintSource) return null;
  try { return JSON.parse(row.blueprintSource) as SavedBlueprintSource; } catch { return null; }
}


const page = (p: number | null) => (p ? `page ${p}` : 'the drawing');

/** The hover text for a row's specification. */
export function sourceTooltip(row: BOQItemRow): string | undefined {
  const s = sourceOf(row);
  if (!s) return undefined;
  const lines: string[] = [];
  if (s.kind === 'drawing') {
    const [first, ...more] = s.notes;
    lines.push(first ? `From the drawing, ${page(first.page)}:` : (s.reason ?? 'From the drawing'));
    if (first) lines.push(`"${first.text}"`);
    if (more.length) lines.push(`Also noted on ${[...new Set(more.map(n => page(n.page)))].join(', ')}`);
  } else if (s.kind === 'history') {
    lines.push(s.reason ?? 'Not on the drawing — from your past projects.');
  } else if (s.kind === 'default') {
    lines.push(s.reason ?? 'Not on the drawing — standard finish used, please check.');
  } else {
    lines.push('Finish picked by you.');
  }
  // A row over several rooms whose sources differ: say which is which.
  const kinds = new Set(s.rooms.map(r => r.kind));
  if (kinds.size > 1) {
    for (const r of s.rooms) lines.push(`· ${r.room}: ${r.kind === 'drawing' ? 'from the drawing' : r.kind === 'chosen' ? 'picked by you' : r.reason ?? r.kind}`);
  } else if (s.roomNames.length) {
    lines.push(`Rooms: ${s.roomNames.join(', ')}`);
  }
  if (s.materialReason) lines.push(s.materialReason);
  if (s.readId) lines.push('Open View Plan, then click this row to see it on the blueprint.');
  return lines.join('\n');
}

/** Generated rows as unsaved Material Plan rows, numbered "1.n" after `startNumber`. */
export function generatedToRows(rows: GeneratedBoqRow[], readId: number | null, startNumber: number): BOQItemRow[] {
  let n = startNumber;
  return rows.map(r => {
    const source: SavedBlueprintSource = { ...r.source, readId, roomNames: r.rooms };
    return {
      primarySection: PRIMARY_SECTION,
      subCategory: `1.${++n} ${r.subCategory}`,
      // The drawing's own words when the finish is read off it; else the catalog material's name.
      specification: r.specificationFromDrawing ? r.specification : (r.materialName ?? r.specification),
      materialId: r.materialId ?? undefined,
      newMaterialName: r.materialName ?? r.specification,
      unit: r.boqUnit,
      estimatedQuantity: r.boqQuantity,
      notes: r.sourceNote,
      blueprintSource: JSON.stringify(source),
    } as BOQItemRow;
  });
}
