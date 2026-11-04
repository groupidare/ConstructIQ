import type { BOQItemRow } from '@/types/boq';
import { sectionKey } from '@/lib/boqSections';

// "Scan & Fill Rows" on a plan the blueprint already filled: the whole
// scanned BOQ set beside the blueprint's rows, section by section. Sections
// the blueprint filled are compared by material, grouped under the work
// they belong to; the others are the BOQ's alone. The two describe the
// same work differently — the blueprint lists tiles room by room and paint
// as skim coat + primer + paint; a BOQ lists one tile line and "paint,
// 2 coats + primer" — so materials are matched by kind, not by wording,
// and a work item done with different materials on each side (fiber cement
// board vs acoustic panels) is one choice, never two rows to tick, which
// would count the ceiling twice.

export type LineStatus = 'match' | 'differ' | 'included' | 'blueprint' | 'uploaded';
export type GroupMode = 'match' | 'choose' | 'uploaded' | 'blueprint';

export interface CompareSide { rows: BOQItemRow[]; quantity: number; unit: string }

export interface CompareLine {
  kind: string;
  material: string;              // the uploaded BOQ's wording when it has one — the more specific
  blueprint: CompareSide | null;
  uploaded: CompareSide | null;
  status: LineStatus;
  differencePct: number | null;
  includedIn: string[];          // uploaded line numbers that already cover it ("1.6")
}

export interface CompareArea { blueprint: number; uploaded: number; differencePct: number; unit: string }

export interface CompareGroup {
  key: string;
  label: string;
  lines: CompareLine[];
  mode: GroupMode;
  // Both sides have a material of their own for this work (fiber cement
  // board vs acoustic panel) — alternatives, not an extra layer one side adds.
  alternative: boolean;
  // The area each side's rows cover, for floor, wall and ceiling work.
  area: CompareArea | null;
}

const LAYERS = new Set(['paint', 'primer']);

/** The area a side's rows for one work item cover. Floor and wall rows are
 *  layers over the same area (tile + adhesive + grout; skim coat + primer +
 *  paint), so the largest is the area. A ceiling may be split by room —
 *  acoustic panels over the back rooms, painted slab over the sales area —
 *  so its ceilings add up. Paint covers a gypsum or fiber cement board under
 *  it (the same area again) and is a ceiling of its own beyond that — a
 *  painted slab; acoustic panels are never painted. */
function coveredArea(group: string, kinds: Map<string, BOQItemRow[]>): number {
  const total = (rows: BOQItemRow[]) => rows.reduce((s, r) => s + (r.estimatedQuantity || 0), 0);
  if (group !== 'ceiling') return Math.max(0, ...[...kinds.values()].map(total));
  let painted = 0, unpainted = 0, paint = 0;
  for (const [kind, rows] of kinds) {
    if (LAYERS.has(kind)) paint += total(rows);
    else if (kind === 'board') painted += total(rows);
    else unpainted += total(rows);
  }
  return unpainted + painted + Math.max(0, paint - painted);
}

export const MATCH_TOLERANCE = 0.05;

const textOf = (r: BOQItemRow) => `${r.subCategory ?? ''} ${r.specification ?? ''} ${r.newMaterialName ?? ''}`.toLowerCase();
export const materialOf = (r: BOQItemRow) => r.specification || r.newMaterialName || '—';
export const lineNumber = (r: BOQItemRow) => (r.subCategory ?? '').match(/^\s*(\d+(?:\.\d+)+)/)?.[1] ?? '';
const workName = (r: BOQItemRow) => (r.subCategory ?? '').replace(/^\s*\d+(\.\d+)*[.)]?\s*/, '').trim();
const unitKey = (u?: string) => (u ?? '').toLowerCase().replace(/[\s.]/g, '').replace(/^(m2|sqm|sqmeter|sqmeters)$/, 'sqm').replace(/^(lm|m|lnm)$/, 'lm');

// The work a row belongs to. Order matters: a tile trim is trim, not tile;
// ceiling paint is ceiling.
const WORK: [RegExp, string, string][] = [
  [/ceiling|soffit/, 'ceiling', 'Ceiling'],
  [/\btrim\b/, 'trim', 'Tile Trim'],
  [/adhesive|grout|tile|porcelain|ceramic|vinyl|granite|marble|floor finish|flooring/, 'floor', 'Floor Finish'],
  [/baseboard|skirting/, 'baseboard', 'Baseboard'],
  [/partition|drywall|metal stud/, 'partition', 'Partitions'],
  [/hollow block|\bchb\b|masonry|brick/, 'masonry', 'Masonry Walls'],
  [/skim|paint|primer|plaster|latex|enamel|emulsion|wall finish/, 'wall', 'Wall Finish'],
  [/\bdoors?\b/, 'door', 'Doors'],
  [/windows?\b/, 'window', 'Windows'],
];
const workOf = (text: string) => WORK.find(([re]) => re.test(text));

// Which material of its work a row is — read from the material itself.
function kindOf(group: string, r: BOQItemRow): string {
  const m = `${r.specification ?? ''} ${r.newMaterialName ?? ''}`.toLowerCase();
  switch (group) {
    case 'ceiling': return /acoustic/.test(m) ? 'acoustic panel' : /board|gypsum|fiber|fibre|cement/.test(m) ? 'board' : /paint/.test(m) ? 'paint' : m.trim();
    case 'floor': return /adhesive/.test(m) ? 'adhesive' : /grout/.test(m) ? 'grout' : 'tile';
    case 'wall': return /skim/.test(m) ? 'skim coat' : /paint|latex|enamel|emulsion/.test(m) ? 'paint' : /primer/.test(m) ? 'primer' : /plaster/.test(m) ? 'plaster' : m.trim();
    case 'masonry': return /100\s*mm|4"/.test(m) ? 'chb 100' : /150\s*mm|6"/.test(m) ? 'chb 150' : 'chb';
    case 'trim': case 'baseboard': case 'partition': return group;
    default: return m.trim();
  }
}

// An uploaded BOQ's work item column says what the work is ("1.12
// Storefront" is storefront, though its architrave has a paint finish). A
// blueprint row's may be a room ("SALES AREA" for its floor tiles), so its
// material says it.
function classify(r: BOQItemRow, from: 'blueprint' | 'uploaded'): { group: string; label: string; kind: string } {
  const work = workName(r).toLowerCase();
  const rule = workOf(work) ?? (from === 'blueprint' || !work ? workOf(textOf(r)) : undefined);
  if (rule) return { group: rule[1], label: rule[2], kind: kindOf(rule[1], r) };
  // Anything else stands as its own work item, named as the BOQ names it.
  const name = workName(r) || materialOf(r);
  return { group: `other:${name.toLowerCase()}`, label: name, kind: kindOf('other', r) };
}

function side(rows: BOQItemRow[]): CompareSide | null {
  if (rows.length === 0) return null;
  return { rows, quantity: Math.round(rows.reduce((s, r) => s + (r.estimatedQuantity || 0), 0) * 100) / 100, unit: rows[0].unit ?? '' };
}

/** One section's blueprint rows vs the scanned BOQ's rows for it, work item by work item. */
function compareSection(section: string, blueprintRows: BOQItemRow[], uploadedRows: BOQItemRow[]): CompareGroup[] {
  const groups = new Map<string, { label: string; blueprint: Map<string, BOQItemRow[]>; uploaded: Map<string, BOQItemRow[]> }>();
  const put = (r: BOQItemRow, from: 'blueprint' | 'uploaded') => {
    const c = classify(r, from);
    const g = groups.get(c.group) ?? { label: c.label, blueprint: new Map(), uploaded: new Map() };
    groups.set(c.group, g);
    g[from].set(c.kind, [...(g[from].get(c.kind) ?? []), r]);
  };
  blueprintRows.forEach(r => put(r, 'blueprint'));
  uploadedRows.forEach(r => put(r, 'uploaded'));

  const out: CompareGroup[] = [];
  for (const [key, g] of groups) {
    const kinds = [...new Set([...g.blueprint.keys(), ...g.uploaded.keys()])];
    const uploadedAll = [...g.uploaded.values()].flat();
    const lines: CompareLine[] = kinds.map(kind => {
      const b = side(g.blueprint.get(kind) ?? []), u = side(g.uploaded.get(kind) ?? []);
      let status: LineStatus, differencePct: number | null = null, includedIn: string[] = [];
      if (b && u) {
        differencePct = b.quantity > 0 ? Math.round(Math.abs(u.quantity - b.quantity) / b.quantity * 1000) / 10 : null;
        status = unitKey(b.unit) === unitKey(u.unit) && differencePct != null && differencePct <= MATCH_TOLERANCE * 100 ? 'match' : 'differ';
      } else if (b) {
        // "Latex paint, 2 coats + primer" already includes the blueprint's primer.
        const covering = uploadedAll.filter(r => textOf(r).includes(kind));
        includedIn = covering.map(lineNumber).filter(Boolean);
        status = covering.length ? 'included' : 'blueprint';
      } else {
        status = 'uploaded';
      }
      return { kind, material: materialOf((u ?? b)!.rows[0]), blueprint: b, uploaded: u, status, differencePct, includedIn };
    });
    const hasBlueprint = g.blueprint.size > 0, hasUploaded = g.uploaded.size > 0;
    const mode: GroupMode = !hasBlueprint ? 'uploaded' : !hasUploaded ? 'blueprint'
      : lines.every(l => l.status === 'match' || l.status === 'included') ? 'match' : 'choose';
    const alternative = lines.some(l => l.status === 'blueprint') && lines.some(l => l.status === 'uploaded');
    let area: CompareArea | null = null;
    const sqm = (rows: BOQItemRow[]) => rows.length > 0 && rows.every(r => unitKey(r.unit) === 'sqm');
    if (['floor', 'wall', 'ceiling'].includes(key) && hasBlueprint && hasUploaded
        && sqm([...g.blueprint.values()].flat()) && sqm(uploadedAll)) {
      const b = coveredArea(key, g.blueprint), u = coveredArea(key, g.uploaded);
      area = { blueprint: Math.round(b * 100) / 100, uploaded: Math.round(u * 100) / 100,
               differencePct: b > 0 ? Math.round(Math.abs(u - b) / b * 1000) / 10 : 0, unit: 'sq.m' };
    }
    out.push({ key: `${section}|${key}`, label: g.label, lines, mode, alternative, area });
  }
  // Groups needing a choice first, then matches, then the rest in BOQ order.
  const order: Record<GroupMode, number> = { choose: 0, match: 1, uploaded: 2, blueprint: 3 };
  return out.sort((a, b) => order[a.mode] - order[b.mode]);
}

export type GroupChoice = 'blueprint' | 'uploaded' | 'both';

export interface CompareSection {
  key: string;
  label: string;
  fromBlueprint: boolean;   // the blueprint generated rows for it — compared; else listed as the BOQ's own
  groups: CompareGroup[];
}

/** The whole scanned BOQ, section by section, beside the blueprint rows in the plan. Sections the
 *  blueprint filled are compared material by material; the rest (Electrical, Mechanical…) the
 *  blueprint never generates, so each of their rows is "only in the uploaded BOQ". */
export function compareBoqSections(blueprintRows: BOQItemRow[], uploadedRows: BOQItemRow[]): CompareSection[] {
  const sections = new Map<string, { label: string; blueprint: BOQItemRow[]; uploaded: BOQItemRow[] }>();
  const into = (r: BOQItemRow, from: 'blueprint' | 'uploaded') => {
    const key = sectionKey(r.primarySection);
    const s = sections.get(key) ?? { label: r.primarySection || 'Others', blueprint: [], uploaded: [] };
    sections.set(key, s);
    s[from].push(r);
  };
  // The BOQ's own section order; blueprint-only sections after it.
  uploadedRows.forEach(r => into(r, 'uploaded'));
  blueprintRows.forEach(r => into(r, 'blueprint'));
  return [...sections].map(([key, s]) => s.blueprint.length > 0
    ? { key, label: s.label, fromBlueprint: true, groups: compareSection(key, s.blueprint, s.uploaded) }
    : {
      key, label: s.label, fromBlueprint: false,
      groups: [{
        key: `${key}|rows`, label: s.label, mode: 'uploaded' as const, alternative: false, area: null,
        lines: s.uploaded.map(r => ({
          kind: materialOf(r).toLowerCase(), material: materialOf(r), blueprint: null, uploaded: side([r]),
          status: 'uploaded' as const, differencePct: null, includedIn: [],
        })),
      }],
    });
}

/** The rows to add to the plan and the blueprint rows to take out of it. */
export function applyComparison(sections: CompareSection[], choices: Record<string, GroupChoice>, ticked: Set<BOQItemRow>) {
  const add: BOQItemRow[] = [], remove: BOQItemRow[] = [];
  for (const g of sections.flatMap(s => s.groups)) {
    const uploaded = g.lines.flatMap(l => l.uploaded?.rows ?? []);
    if (g.mode === 'uploaded') add.push(...uploaded.filter(r => ticked.has(r)));
    if (g.mode !== 'choose') continue;
    const choice = choices[g.key] ?? 'blueprint';
    if (choice !== 'blueprint') add.push(...uploaded);
    if (choice === 'uploaded') remove.push(...g.lines.flatMap(l => l.blueprint?.rows ?? []));
  }
  return { add, remove };
}
