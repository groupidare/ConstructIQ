import type { BOQItemRow } from '@/types/boq';
import { sectionKey } from '@/lib/boqSections';

// "Scan & Fill Rows" on a plan the blueprint already filled: the whole
// scanned BOQ set beside the blueprint's rows, section by section. Inside a
// section, rows are grouped by the work they belong to (ceiling, floor
// finish…), and each work item's materials are paired across the two BOQs,
// one pair per table row: the same material first, then the same type of
// material (fiber cement board ↔ gypsum board — both boards), then names
// sharing words, closest area breaking ties. What is left over stands alone
// as "only in" its side. Each pair is one decision, so the same work is
// never counted twice.

export type PairStatus = 'same' | 'similar' | 'included' | 'blueprint' | 'uploaded';

export interface CompareSide {
  rows: BOQItemRow[];
  quantity: number;
  unit: string;
  material: string;   // as the BOQ names it, or the next best text
  unnamed: boolean;   // the row names no material — `material` is its work item or line
}

export interface ComparePair {
  key: string;
  blueprint: CompareSide | null;
  uploaded: CompareSide | null;
  status: PairStatus;
  // uploaded − blueprint, in the shared unit; null when units differ or one side is missing.
  difference: number | null;
  differencePct: number | null;
  sameQuantity: boolean;      // within MATCH_TOLERANCE, same unit
  includedIn: string[];       // uploaded line numbers that already cover it ("1.6")
}

export interface CompareArea { blueprint: number; uploaded: number; difference: number; differencePct: number; unit: string }

export interface CompareGroup {
  key: string;
  label: string;
  pairs: ComparePair[];
  // The area each side's rows cover, for floor, wall and ceiling work — shown
  // when materials differ between the sides, to tell whether the total still agrees.
  area: CompareArea | null;
}

export interface CompareSection {
  key: string;
  label: string;
  fromBlueprint: boolean;   // the blueprint generated rows for it — compared; else listed as the BOQ's own
  groups: CompareGroup[];
}

export const MATCH_TOLERANCE = 0.05;

const LAYERS = new Set(['paint', 'primer']);

/** The area a side's rows for one work item cover. Floor and wall rows are
 *  layers over the same area (tile + adhesive + grout; skim coat + primer +
 *  paint), so the largest is the area. A ceiling may be split by room —
 *  acoustic panels over the back rooms, painted slab over the sales area —
 *  so its ceilings add up. Paint covers a gypsum or fiber cement board under
 *  it (the same area again) and is a ceiling of its own beyond that — a
 *  painted slab; acoustic panels are never painted. */
function coveredArea(group: string, sides: CompareSide[]): number {
  if (group !== 'ceiling') {
    // Rows of one material type add up (paint in two colours covers two sets
    // of walls); the layers over them don't (the primer under the paint).
    const byKind = new Map<string, number>();
    for (const s of sides) {
      const kind = kindOf(group, s.rows[0]) ?? s.material.toLowerCase();
      byKind.set(kind, (byKind.get(kind) ?? 0) + s.quantity);
    }
    return Math.max(0, ...byKind.values());
  }
  let painted = 0, unpainted = 0, paint = 0;
  for (const s of sides) {
    const kind = kindOf('ceiling', s.rows[0]);
    if (kind && LAYERS.has(kind)) paint += s.quantity;
    else if (kind === 'board') painted += s.quantity;
    else unpainted += s.quantity;
  }
  return unpainted + painted + Math.max(0, paint - painted);
}

const textOf = (r: BOQItemRow) => `${r.subCategory ?? ''} ${r.specification ?? ''} ${r.newMaterialName ?? ''}`.toLowerCase();
const nameOf = (r: BOQItemRow) => (r.specification || r.newMaterialName || '').trim();
export const lineNumber = (r: BOQItemRow) => (r.subCategory ?? '').match(/^\s*(\d+(?:\.\d+)+)/)?.[1] ?? '';
const workName = (r: BOQItemRow) => (r.subCategory ?? '').replace(/^\s*\d+(\.\d+)*[.)]?\s*/, '').trim();
/** The material as the BOQ names it — else its work item, else its line: never blank. */
export const materialOf = (r: BOQItemRow) =>
  nameOf(r) || workName(r) || (lineNumber(r) ? `Unnamed item, line ${lineNumber(r)}` : 'Unnamed item');
const unitKey = (u?: string) => (u ?? '').toLowerCase().replace(/[\s.]/g, '').replace(/^(m2|sqm|sqmeter|sqmeters)$/, 'sqm').replace(/^(lm|m|lnm)$/, 'lm');
const round2 = (n: number) => Math.round(n * 100) / 100;

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

// The type of material a row is within its work — read from the material
// itself. Two different products of one type (gypsum vs fiber cement board)
// are "similar"; null when the name says no known type.
function kindOf(group: string, r: BOQItemRow): string | null {
  const m = nameOf(r).toLowerCase();
  if (!m) return null;
  switch (group) {
    case 'ceiling': return /acoustic|mineral (fib|wool)/.test(m) ? 'acoustic panel' : /board|gypsum|fiber|fibre|cement|plywood/.test(m) ? 'board' : /paint|latex|enamel|emulsion/.test(m) ? 'paint' : null;
    case 'floor': return /adhesive|thinset/.test(m) ? 'adhesive' : /grout/.test(m) ? 'grout' : /tile|porcelain|ceramic|vinyl|granite|marble|plank/.test(m) ? 'tile' : null;
    case 'wall': return /skim/.test(m) ? 'skim coat' : /primer/.test(m) && !/paint/.test(m) ? 'primer' : /paint|latex|enamel|emulsion/.test(m) ? 'paint' : /plaster/.test(m) ? 'plaster' : null;
    case 'masonry': return 'chb';
    case 'trim': case 'baseboard': case 'partition': case 'door': case 'window': return group;
    default: return null;
  }
}

// Words that say nothing about which material it is.
const FILLER = new Set(['and', 'or', 'of', 'the', 'with', 'for', 'to', 'in', 'on', 'at', 'a', 'an', 'supply', 'install',
  'installation', 'provide', 'complete', 'including', 'incl', 'all', 'mm', 'thk', 'thick', 'type', 'coat', 'coats', 'x', 'pcs', 'sqm', 'm']);
const SYNONYMS: Record<string, string> = { fibre: 'fiber', colour: 'color', gypsumboard: 'gypsum' };
function tokens(text: string): { words: Set<string>; numbers: Set<string> } {
  const words = new Set<string>(), numbers = new Set<string>();
  for (const t of text.toLowerCase().replace(/(\d)\s*[x×]\s*(\d)/g, '$1 $2').split(/[^a-z0-9.]+/)) {
    const w = SYNONYMS[t] ?? t.replace(/\.$/, '');
    if (!w || FILLER.has(w)) continue;
    if (/^\d+(\.\d+)?$/.test(w)) numbers.add(w); else if (w.length > 1) words.add(w.replace(/s$/, ''));
  }
  return { words, numbers };
}
const overlap = (a: Set<string>, b: Set<string>) => {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  a.forEach(w => { if (b.has(w)) shared++; });
  return shared / Math.min(a.size, b.size);
};
// Sizes both name must agree: a 300×300 tile is not a 600×600 tile.
const sizesAgree = (a: Set<string>, b: Set<string>) => a.size === 0 || b.size === 0 || [...a].some(n => b.has(n));

// Types with no real variety between products: any tile adhesive is the tile adhesive.
const ONE_PRODUCT = new Set(['adhesive', 'grout', 'primer', 'skim coat', 'acoustic panel', 'chb']);
// Layers an uploaded line may name inside another ("latex paint, 2 coats + primer").
const INCLUDABLE = new Set(['primer', 'grout', 'adhesive', 'skim coat']);

/** How alike two materials of one work item are: 'same', 'similar' or null. */
function likeness(group: string, b: CompareSide, u: CompareSide): 'same' | 'similar' | null {
  if (b.unnamed || u.unnamed) return null;
  const kb = kindOf(group, b.rows[0]), ku = kindOf(group, u.rows[0]);
  if (kb && ku && kb !== ku) return null;
  const tb = tokens(b.material), tu = tokens(u.material);
  const words = overlap(tb.words, tu.words);
  const sized = tb.numbers.size > 0 && tu.numbers.size > 0;
  // One product either way it is named: "600×600 porcelain tile" is the "floor tile 600×600".
  const sameKind = kb != null && kb === ku && (ONE_PRODUCT.has(kb) || sized);
  if (sizesAgree(tb.numbers, tu.numbers) && (words >= 0.6 || sameKind)) return 'same';
  if (kb && kb === ku) return 'similar';
  return words >= 0.5 ? 'similar' : null;
}

/** A side's rows for one work item, one entry per material (the blueprint's
 *  floor tiles come room by room; they are one material). Unnamed rows stay one each. */
function sides(rows: BOQItemRow[]): CompareSide[] {
  const by = new Map<string, BOQItemRow[]>();
  rows.forEach((r, i) => {
    const name = nameOf(r);
    const key = name ? `${name.toLowerCase()}|${unitKey(r.unit)}` : `#${i}`;
    by.set(key, [...(by.get(key) ?? []), r]);
  });
  return [...by.values()].map(rs => ({
    rows: rs, unit: rs[0].unit ?? '', material: materialOf(rs[0]), unnamed: !nameOf(rs[0]),
    quantity: round2(rs.reduce((s, r) => s + (r.estimatedQuantity || 0), 0)),
  }));
}

function pairOf(key: string, b: CompareSide | null, u: CompareSide | null, status: PairStatus, includedIn: string[] = []): ComparePair {
  let difference: number | null = null, differencePct: number | null = null;
  if (b && u && unitKey(b.unit) === unitKey(u.unit)) {
    difference = round2(u.quantity - b.quantity);
    differencePct = b.quantity > 0 ? Math.round(Math.abs(difference) / b.quantity * 1000) / 10 : null;
  }
  const sameQuantity = difference != null && (difference === 0 || (differencePct != null && differencePct <= MATCH_TOLERANCE * 100));
  return { key, blueprint: b, uploaded: u, status, difference, differencePct, sameQuantity, includedIn };
}

/** Pairs a work item's blueprint materials with the uploaded BOQ's: the same
 *  material, then a similar one, then (for a row that names no material) the
 *  closest area — each step taking the closest quantity first. */
function pairUp(groupKey: string, group: string, blueprint: CompareSide[], uploaded: CompareSide[]): ComparePair[] {
  const freeB = new Set(blueprint), freeU = new Set(uploaded);
  const found: [CompareSide, CompareSide, PairStatus][] = [];
  const gap = (b: CompareSide, u: CompareSide) => unitKey(b.unit) === unitKey(u.unit) ? Math.abs(b.quantity - u.quantity) : Infinity;
  const steps: [PairStatus, (b: CompareSide, u: CompareSide) => boolean][] = [
    ['same', (b, u) => likeness(group, b, u) === 'same'],
    ['similar', (b, u) => likeness(group, b, u) === 'similar'],
    // A row naming no material is compared by its area — the closest one of the same unit.
    ['similar', (b, u) => (b.unnamed || u.unnamed) && unitKey(b.unit) === unitKey(u.unit)],
  ];
  for (const [status, fits] of steps) {
    const candidates: [CompareSide, CompareSide][] = [];
    freeB.forEach(b => freeU.forEach(u => { if (fits(b, u)) candidates.push([b, u]); }));
    // The closest name first ("Matte Black Wall Paint" pairs with the matte
    // black paint, not the blue one of a nearer area), then the closest quantity.
    const score = (b: CompareSide, u: CompareSide) => overlap(tokens(b.material).words, tokens(u.material).words);
    candidates.sort((x, y) => score(...y) - score(...x) || gap(...x) - gap(...y));
    for (const [b, u] of candidates) {
      if (!freeB.has(b) || !freeU.has(u)) continue;
      freeB.delete(b); freeU.delete(u);
      found.push([b, u, status]);
    }
  }
  const uploadedAll = uploaded.flatMap(s => s.rows);
  let n = 0;
  const key = () => `${groupKey}|${n++}`;
  // In BOQ order: paired rows by the blueprint's order, then each side's leftovers.
  const pairs = blueprint.filter(b => !freeB.has(b)).map(b => {
    const [, u, status] = found.find(([fb]) => fb === b)!;
    return pairOf(key(), b, u, status);
  });
  freeB.forEach(b => {
    // "Latex paint, 2 coats + primer" already includes the blueprint's primer.
    const kind = kindOf(group, b.rows[0]);
    const covering = kind && INCLUDABLE.has(kind)
      ? uploadedAll.filter(r => kindOf(group, r) !== kind && textOf(r).includes(kind)) : [];
    const lines = covering.map(lineNumber).filter(Boolean);
    pairs.push(pairOf(key(), b, null, lines.length ? 'included' : 'blueprint', lines));
  });
  freeU.forEach(u => pairs.push(pairOf(key(), null, u, 'uploaded')));
  return pairs;
}

// An uploaded BOQ's work item column says what the work is ("1.12
// Storefront" is storefront, though its architrave has a paint finish). A
// blueprint row's may be a room ("SALES AREA" for its floor tiles), so its
// material says it.
function classify(r: BOQItemRow, from: 'blueprint' | 'uploaded'): { group: string; label: string } {
  const work = workName(r).toLowerCase();
  const rule = workOf(work) ?? (from === 'blueprint' || !work ? workOf(textOf(r)) : undefined);
  if (rule) return { group: rule[1], label: rule[2] };
  // Anything else stands as its own work item, named as the BOQ names it.
  const name = workName(r) || materialOf(r);
  return { group: `other:${name.toLowerCase()}`, label: name };
}

/** One section's blueprint rows vs the scanned BOQ's rows for it, work item by work item. */
function compareSection(section: string, blueprintRows: BOQItemRow[], uploadedRows: BOQItemRow[]): CompareGroup[] {
  const groups = new Map<string, { label: string; blueprint: BOQItemRow[]; uploaded: BOQItemRow[] }>();
  const put = (r: BOQItemRow, from: 'blueprint' | 'uploaded') => {
    const c = classify(r, from);
    const g = groups.get(c.group) ?? { label: c.label, blueprint: [], uploaded: [] };
    groups.set(c.group, g);
    g[from].push(r);
  };
  blueprintRows.forEach(r => put(r, 'blueprint'));
  uploadedRows.forEach(r => put(r, 'uploaded'));

  return [...groups].map(([group, g]) => {
    const key = `${section}|${group}`;
    const b = sides(g.blueprint), u = sides(g.uploaded);
    const pairs = pairUp(key, group, b, u);
    let area: CompareArea | null = null;
    const sqm = (s: CompareSide[]) => s.length > 0 && s.every(x => unitKey(x.unit) === 'sqm');
    const mixed = pairs.some(p => p.status !== 'same' && p.status !== 'included');
    if (['floor', 'wall', 'ceiling'].includes(group) && mixed && sqm(b) && sqm(u)) {
      const bArea = round2(coveredArea(group, b)), uArea = round2(coveredArea(group, u));
      area = { blueprint: bArea, uploaded: uArea, difference: round2(uArea - bArea),
               differencePct: bArea > 0 ? Math.round(Math.abs(uArea - bArea) / bArea * 1000) / 10 : 0, unit: 'sq.m' };
    }
    return { key, label: g.label, pairs, area };
  });
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
        key: `${key}|rows`, label: s.label, area: null,
        pairs: s.uploaded.map((r, i) => pairOf(`${key}|rows|${i}`, null, {
          rows: [r], quantity: round2(r.estimatedQuantity || 0), unit: r.unit ?? '', material: materialOf(r), unnamed: !nameOf(r),
        }, 'uploaded')),
      }],
    });
}

// ── Decisions ────────────────────────────────────────────────────────────

export type Choice = 'blueprint' | 'uploaded' | 'both';

/** What the user decides for a pair: a choice where both sides have it and
 *  differ; keep/add where only one side has it; nothing where they agree. */
export type Decision = 'choice' | 'keep' | 'add' | 'none';

export function decisionOf(p: ComparePair): Decision {
  if (p.status === 'included') return 'none';
  if (p.status === 'same') return p.sameQuantity ? 'none' : 'choice';
  if (p.status === 'similar') return 'choice';
  return p.status === 'blueprint' ? 'keep' : 'add';
}

/** The choice a pair starts with: the blueprint's figure for the same
 *  material (it is measured from the drawing); none for a similar material —
 *  that is a material decision the user must make. */
export const defaultChoice = (p: ComparePair): Choice | undefined => (p.status === 'same' ? 'blueprint' : undefined);

export interface Decisions {
  choices: Record<string, Choice>;   // pair key → choice (absent: defaultChoice)
  unticked: Set<string>;              // keep/add pairs the user unticked
}

export const choiceOf = (p: ComparePair, d: Decisions) => d.choices[p.key] ?? defaultChoice(p);

/** The rows to add to the plan and the blueprint rows to take out of it. `added`/`removed` count rows,
 *  `replaced` materials (pairs switched to the uploaded BOQ), `undecided` pairs still needing a choice. */
export function applyComparison(sections: CompareSection[], d: Decisions) {
  const add: BOQItemRow[] = [], remove: BOQItemRow[] = [];
  let added = 0, replaced = 0, removed = 0, undecided = 0;
  for (const p of sections.flatMap(s => s.groups.flatMap(g => g.pairs))) {
    const decision = decisionOf(p);
    if (decision === 'add' && !d.unticked.has(p.key)) { add.push(...p.uploaded!.rows); added += p.uploaded!.rows.length; }
    if (decision === 'keep' && d.unticked.has(p.key)) { remove.push(...p.blueprint!.rows); removed += p.blueprint!.rows.length; }
    if (decision !== 'choice') continue;
    const choice = choiceOf(p, d);
    if (!choice) { undecided++; continue; }
    if (choice === 'uploaded') { add.push(...p.uploaded!.rows); remove.push(...p.blueprint!.rows); replaced++; }
    if (choice === 'both') { add.push(...p.uploaded!.rows); added += p.uploaded!.rows.length; }
  }
  return { add, remove, added, replaced, removed, undecided };
}
