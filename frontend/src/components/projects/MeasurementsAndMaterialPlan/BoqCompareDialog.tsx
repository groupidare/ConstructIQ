'use client';

import { useMemo, useState } from 'react';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import type { BOQItemRow } from '@/types/boq';
import {
  applyComparison, choiceOf, compareBoqSections, decisionOf, lineNumber, MATCH_TOLERANCE,
  type Choice, type CompareArea, type ComparePair, type CompareSection, type CompareSide, type Decisions,
} from '@/lib/boqCompare';

// The BOQ generated from the blueprint (left) beside the uploaded BOQ
// (right), section by section, one material per row (see lib/boqCompare.ts
// for how materials are paired). The comparison column says in words how
// they differ; the last column is the user's decision for that material.
// Nothing changes until Apply, and Apply waits for every "similar material"
// row to be decided. Sections the blueprint never generates start collapsed.

interface Props {
  blueprintRows: BOQItemRow[];
  uploadedRows: BOQItemRow[];
  onApply: (add: BOQItemRow[], remove: BOQItemRow[]) => void;
  onClose: () => void;
}

type Category = 'same' | 'different' | 'similar' | 'blueprint' | 'uploaded';
type Filter = 'all' | 'decide' | Category;

const btn = (primary = false): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 8, border: primary ? 'none' : '1px solid #e5e7eb', cursor: 'pointer',
  background: primary ? '#f97316' : '#fff', color: primary ? '#fff' : '#374151', fontSize: '0.8rem', fontWeight: 600,
});
const th: React.CSSProperties = { textAlign: 'left', fontSize: '0.62rem', color: '#9ca3af', fontWeight: 700, padding: '6px 8px', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '9px 10px', fontSize: '0.76rem', color: '#374151', verticalAlign: 'top', lineHeight: 1.4 };
// The divider between the blueprint and the uploaded half.
const LEFT_EDGE: React.CSSProperties = { borderLeft: '2px solid #e5e7eb' };
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const isSqm = (u: string) => /^(sq\.?\s*m|m2|sqm)$/i.test(u.trim());

const COLORS = {
  green: { bg: '#dcfce7', color: '#15803d' },
  red: { bg: '#fee2e2', color: '#b91c1c' },
  amber: { bg: '#fef3c7', color: '#b45309' },
  blue: { bg: '#dbeafe', color: '#1d4ed8' },
  orange: { bg: '#ffedd5', color: '#c2410c' },
};

function categoryOf(p: ComparePair): Category {
  if (p.status === 'same' || p.status === 'included') return p.sameQuantity || p.status === 'included' ? 'same' : 'different';
  return p.status;
}

/** "6.34 sq.m less" / "10 pcs more" — the uploaded BOQ against the blueprint. */
function amount(difference: number, unit: string): string {
  return `${difference < 0 ? '▼' : '▲'} ${fmt(Math.abs(difference))} ${unit} ${difference < 0 ? 'less' : 'more'}`;
}
const what = (unit: string) => (isSqm(unit) ? 'area' : 'quantity');

interface Verdict { text: string; detail?: string; tone: keyof typeof COLORS }

/** The comparison: a short label (one line, coloured) and, under it, what it means. */
function comparison(p: ComparePair): Verdict {
  const b = p.blueprint, u = p.uploaded;
  if (p.status === 'included') return { text: '✓ Included', detail: `Part of uploaded line ${p.includedIn.join(', ')}`, tone: 'green' };
  if (p.status === 'blueprint') return { text: 'Only in blueprint', detail: 'Not in the uploaded BOQ', tone: 'blue' };
  if (p.status === 'uploaded') return { text: 'Only in uploaded', detail: 'Not generated from the blueprint', tone: 'orange' };
  const material = b!.unnamed || u!.unnamed ? 'No material name' : p.status === 'same' ? 'Same material' : 'Similar material';
  if (p.difference == null) return { text: '⚠ Different unit', detail: `${material} · ${b!.unit} vs ${u!.unit}`, tone: 'amber' };
  if (p.sameQuantity) {
    return p.status === 'same' && !b!.unnamed && !u!.unnamed
      ? { text: '✓ Match', detail: `Same material, same ${what(b!.unit)}`, tone: 'green' }
      : { text: `⚠ ${material}`, detail: `Same ${what(b!.unit)} — check the material`, tone: 'amber' };
  }
  const pct = p.differencePct != null ? ` (${p.differencePct}%)` : '';
  return {
    text: amount(p.difference, b!.unit),
    detail: `${material} · uploaded vs blueprint${pct}`,
    tone: p.status === 'same' && p.difference < 0 ? 'red' : 'amber',
  };
}

const Chip = ({ text, detail, tone }: Verdict) => (
  <div style={{ display: 'grid', gap: 3, justifyItems: 'start' }}>
    <span style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', fontSize: '0.7rem', fontWeight: 700, padding: '2px 9px',
      borderRadius: 999, background: COLORS[tone].bg, color: COLORS[tone].color }}>{text}</span>
    {detail && <span style={{ fontSize: '0.66rem', color: '#6b7280', lineHeight: 1.35 }}>{detail}</span>}
  </div>
);

function MaterialCell({ side, uploaded }: { side: CompareSide | null; uploaded: boolean }) {
  if (!side) return <td style={{ ...td, color: '#d1d5db', ...(uploaded ? LEFT_EDGE : {}) }}>—</td>;
  const lines = uploaded ? side.rows.map(lineNumber).filter(Boolean) : [];
  return (
    <td style={{ ...td, ...(uploaded ? LEFT_EDGE : {}) }} title={side.material}>
      {lines.length > 0 && <span style={{ color: '#9ca3af' }}>{lines.join(', ')} · </span>}
      {side.material}
      {side.unnamed && (
        <span title="This row names no material — shown by its work item or line"
          style={{ marginLeft: 6, fontSize: '0.62rem', padding: '1px 6px', borderRadius: 999, background: '#f3f4f6', color: '#6b7280', whiteSpace: 'nowrap' }}>
          No material name
        </span>
      )}
    </td>
  );
}

function AreaCell({ side }: { side: CompareSide | null }) {
  if (!side) return <td style={{ ...td, color: '#d1d5db' }}>—</td>;
  // Floor finish rows come one per room: list the rooms behind the total.
  const parts = side.rows.length > 1
    ? side.rows.map(r => `${(r.subCategory ?? '').replace(/^\s*\d+(\.\d+)*\s*/, '') || '·'}: ${fmt(r.estimatedQuantity)} ${r.unit ?? ''}`).join('\n') : undefined;
  return (
    <td style={{ ...td, whiteSpace: 'nowrap' }} title={parts}>
      {fmt(side.quantity)} {side.unit}
      {side.rows.length > 1 && <span style={{ color: '#9ca3af' }}> ({side.rows.length} rows)</span>}
    </td>
  );
}

const pill = (on: boolean, warn = false): React.CSSProperties => ({
  fontSize: '0.66rem', fontWeight: 600, padding: '2px 8px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
  border: '1px solid ' + (on ? '#fb923c' : warn ? '#fca5a5' : '#e5e7eb'), background: on ? '#fff7ed' : '#fff', color: on ? '#c2410c' : '#6b7280',
});

export default function BoqCompareDialog({ blueprintRows, uploadedRows, onApply, onClose }: Props) {
  const sections = useMemo(() => compareBoqSections(blueprintRows, uploadedRows), [blueprintRows, uploadedRows]);
  const [decisions, setDecisions] = useState<Decisions>({ choices: {}, unticked: new Set() });
  const [filter, setFilter] = useState<Filter>('all');
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => {
    const deciding = sections.filter(s => s.groups.some(g => g.pairs.some(p => decisionOf(p) === 'choice')));
    // Nothing to decide: still open the compared sections, so the comparison shows.
    return new Set((deciding.length ? deciding : sections.filter(s => s.fromBlueprint)).map(s => s.key));
  });

  const result = applyComparison(sections, decisions);
  const pairs = sections.flatMap(s => s.groups.flatMap(g => g.pairs));
  const undecided = (p: ComparePair) => decisionOf(p) === 'choice' && !choiceOf(p, decisions);
  const count = (c: Category) => pairs.filter(p => categoryOf(p) === c).length;
  const filters: [Filter, string, number][] = [
    ['decide', 'need a decision', pairs.filter(undecided).length],
    ['same', 'same', count('same')], ['different', 'different area or quantity', count('different')],
    ['similar', 'similar material', count('similar')], ['blueprint', 'only in blueprint', count('blueprint')],
    ['uploaded', 'only in uploaded', count('uploaded')],
  ];
  const shows = (p: ComparePair) => filter === 'all' || (filter === 'decide' ? undecided(p) : categoryOf(p) === filter);

  const choose = (keys: string[], choice: Choice) => {
    setConfirming(false);
    setDecisions(d => ({ ...d, choices: { ...d.choices, ...Object.fromEntries(keys.map(k => [k, choice])) } }));
  };
  const tick = (key: string, on: boolean) => {
    setConfirming(false);
    setDecisions(d => {
      const unticked = new Set(d.unticked);
      if (on) unticked.delete(key); else unticked.add(key);
      return { ...d, unticked };
    });
  };
  const flip = (key: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  // "Use blueprint / uploaded for all" sets the rows that need a choice; keep/add ticks stay as they are.
  const choiceKeys = (s: CompareSection[]) => s.flatMap(x => x.groups.flatMap(g => g.pairs)).filter(p => decisionOf(p) === 'choice').map(p => p.key);

  function sectionSummary(s: CompareSection): string {
    const all = s.groups.flatMap(g => g.pairs);
    if (!s.fromBlueprint) {
      const adding = all.filter(p => !decisions.unticked.has(p.key)).length;
      return `${all.length} item(s) · not generated from blueprint · ${adding === all.length ? 'all added' : `${adding} of ${all.length} added`}`;
    }
    const left = all.filter(undecided).length;
    const same = all.filter(p => categoryOf(p) === 'same').length;
    return [`${all.length} material(s)`, same ? `${same} same` : '', left ? `${left} need a decision` : ''].filter(Boolean).join(' · ');
  }

  function decisionCell(p: ComparePair) {
    const decision = decisionOf(p);
    if (decision === 'none') return <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>✓ Already in plan</span>;
    if (decision === 'keep' || decision === 'add') {
      const on = !decisions.unticked.has(p.key);
      return (
        <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: '0.72rem', cursor: 'pointer' }}
          title={decision === 'keep' ? 'Untick to remove this blueprint row from the plan' : 'Untick to leave this uploaded row out'}>
          <input type="checkbox" checked={on} onChange={e => tick(p.key, e.target.checked)} />
          {decision === 'keep' ? 'Keep' : 'Add'}
        </label>
      );
    }
    const choice = choiceOf(p, decisions);
    const options: [Choice, string][] = [['blueprint', 'Blueprint'], ['uploaded', 'Uploaded']];
    if (p.status === 'similar') options.push(['both', 'Both']);
    const twice = choice === 'both' && p.blueprint && p.uploaded && p.difference != null && isSqm(p.blueprint.unit);
    return (
      <div style={{ display: 'grid', gap: 3 }}>
        <span role="radiogroup" aria-label="Which to keep" style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {options.map(([c, label]) => (
            <button key={c} role="radio" aria-checked={choice === c} onClick={() => choose([p.key], c)} style={pill(choice === c, !choice)}
              title={c === 'uploaded' ? 'Replace the blueprint row with the uploaded BOQ\'s' : c === 'both' ? 'Keep both rows — only if they cover different areas' : 'Keep the blueprint row; the uploaded row is not added'}>
              {label}
            </button>
          ))}
        </span>
        {!choice && <span style={{ fontSize: '0.64rem', color: '#b91c1c' }}>Pick one</span>}
        {twice && (
          <span style={{ fontSize: '0.64rem', color: '#b45309' }}>
            Counts this area twice ({fmt(p.blueprint!.quantity + p.uploaded!.quantity)} {p.blueprint!.unit})
          </span>
        )}
      </div>
    );
  }

  const areaRow = (key: string, label: string, a: CompareArea) => {
    const same = a.differencePct <= MATCH_TOLERANCE * 100;
    return (
      <tr key={`${key}-area`} style={{ background: '#fffbeb' }}>
        <td style={{ ...td, fontWeight: 600, fontSize: '0.72rem' }}>Total {label.toLowerCase()}</td>
        <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(a.blueprint)} {a.unit}</td>
        <td style={{ ...td, ...LEFT_EDGE, fontWeight: 600, fontSize: '0.72rem' }}>Total {label.toLowerCase()}</td>
        <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(a.uploaded)} {a.unit}</td>
        <td style={td} colSpan={2}>
          <Chip tone={same ? 'green' : 'amber'} text={same ? '✓ Same total area' : amount(a.difference, a.unit)}
            detail={same ? undefined : 'Total area, uploaded vs blueprint'} />
        </td>
      </tr>
    );
  };

  function sectionRows(s: CompareSection) {
    const out: React.ReactNode[] = [];
    for (const g of s.groups) {
      const shown = g.pairs.filter(shows);
      if (shown.length === 0) continue;
      // A section the blueprint never generates is one list — no work-item heading needed.
      if (s.fromBlueprint && s.groups.length > 1) {
        out.push(
          <tr key={g.key}>
            <td colSpan={6} style={{ ...td, fontWeight: 700, fontSize: '0.7rem', color: '#6b7280', paddingTop: 10 }}>{g.label}</td>
          </tr>,
        );
      }
      for (const p of shown) {
        const c = comparison(p);
        out.push(
          <tr key={p.key} style={{ borderTop: '1px solid #f3f4f6', background: undecided(p) ? '#fef2f2' : undefined }}>
            <MaterialCell side={p.blueprint} uploaded={false} />
            <AreaCell side={p.blueprint} />
            <MaterialCell side={p.uploaded} uploaded />
            <AreaCell side={p.uploaded} />
            <td style={td}><Chip {...c} /></td>
            <td style={td}>{decisionCell(p)}</td>
          </tr>,
        );
      }
      if (g.area && filter === 'all') out.push(areaRow(g.key, g.label, g.area));
    }
    return out;
  }

  const summaryChip = (f: Filter, label: string, n: number) => (
    <button key={f} onClick={() => setFilter(filter === f ? 'all' : f)}
      style={{ fontSize: '0.7rem', fontWeight: 600, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
        border: '1px solid ' + (filter === f ? '#fdba74' : f === 'decide' && n ? '#fca5a5' : '#e5e7eb'),
        background: filter === f ? '#fff7ed' : '#fff', color: filter === f ? '#c2410c' : f === 'decide' && n ? '#b91c1c' : '#6b7280' }}>
      {n} {label}
    </button>
  );

  const changes = [
    result.added ? `add ${result.added} row(s)` : '',
    result.replaced ? `replace ${result.replaced} blueprint material(s) with the uploaded BOQ's` : '',
    result.removed ? `remove ${result.removed} blueprint row(s)` : '',
  ].filter(Boolean);
  const nothing = result.add.length === 0 && result.remove.length === 0;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Compare with the blueprint"
        style={{ background: '#fff', borderRadius: 16, width: 'min(1240px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <p style={{ fontWeight: 800, color: '#111827' }}>Compare with the blueprint</p>
            <p style={{ fontSize: '0.74rem', color: '#6b7280', marginTop: 4, lineHeight: 1.5 }}>
              The BOQ generated from the blueprint (left) beside the uploaded BOQ (right), material by material. For each material, choose
              what to keep. Nothing changes until you click Apply.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', alignSelf: 'flex-start' }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        <div style={{ padding: '0.6rem 1.25rem 0', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {summaryChip('all', 'materials in all', pairs.length)}
          {filters.filter(([f, , n]) => n > 0 || f === 'decide').map(([f, label, n]) => summaryChip(f, label, n))}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
            <button onClick={() => choose(choiceKeys(sections), 'blueprint')} style={pill(false)}
              title="Every material both BOQs have but differ on: keep the blueprint's">Use blueprint for all</button>
            <button onClick={() => choose(choiceKeys(sections), 'uploaded')} style={pill(false)}
              title="Every material both BOQs have but differ on: use the uploaded BOQ's">Use uploaded for all</button>
          </span>
        </div>

        <div style={{ padding: '0.5rem 1.25rem', overflow: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1040, tableLayout: 'fixed' }}>
            {/* Fixed widths: the material names wrap, the numbers and labels never do. */}
            <colgroup>
              <col style={{ width: '22%' }} /><col style={{ width: '10%' }} />
              <col style={{ width: '23%' }} /><col style={{ width: '10%' }} />
              <col style={{ width: '18%' }} /><col style={{ width: '17%' }} />
            </colgroup>
            <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
              <tr>
                <th colSpan={2} style={{ ...th, color: '#1d4ed8', fontSize: '0.66rem' }}>GENERATED FROM BLUEPRINT</th>
                <th colSpan={2} style={{ ...th, ...LEFT_EDGE, color: '#c2410c', fontSize: '0.66rem' }}>UPLOADED BOQ</th>
                <th style={th} />
                <th style={th} />
              </tr>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={th}>Material</th><th style={th}>Area / Qty</th>
                <th style={{ ...th, ...LEFT_EDGE }}>Material</th><th style={th}>Area / Qty</th>
                <th style={th}>Comparison</th><th style={th}>Keep</th>
              </tr>
            </thead>
            <tbody>
              {sections.map(s => {
                const rows = sectionRows(s);
                if (rows.length === 0) return null;
                // A filter shows its rows wherever they are; otherwise sections open and close.
                const isOpen = filter !== 'all' || open.has(s.key);
                const keys = choiceKeys([s]);
                return [
                  <tr key={s.key} style={{ background: '#f3f4f6', borderTop: '2px solid #e5e7eb' }}>
                    <td colSpan={6} style={{ ...td, padding: '7px 8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button onClick={() => flip(s.key)} aria-expanded={isOpen}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flex: 1, textAlign: 'left' }}>
                          {isOpen ? <ChevronDown style={{ width: 14, height: 14, color: '#6b7280' }} /> : <ChevronRight style={{ width: 14, height: 14, color: '#6b7280' }} />}
                          <span style={{ fontWeight: 800, fontSize: '0.76rem', color: '#111827', textTransform: 'uppercase' }}>{s.label}</span>
                          <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>— {sectionSummary(s)}</span>
                        </button>
                        {keys.length > 0 && (
                          <>
                            <button onClick={() => choose(keys, 'blueprint')} style={pill(false)}>Use blueprint for all</button>
                            <button onClick={() => choose(keys, 'uploaded')} style={pill(false)}>Use uploaded for all</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>,
                  ...(isOpen ? rows : []),
                ];
              })}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8 }}>
          {confirming ? (
            <>
              <span style={{ fontSize: '0.76rem', color: '#374151' }}>
                This will {changes.join(', ')}. Review the rows afterwards, then Save.
              </span>
              <button onClick={() => setConfirming(false)} style={{ ...btn(), marginLeft: 'auto' }}>Back</button>
              <button onClick={() => onApply(result.add, result.remove)} style={btn(true)}>Confirm</button>
            </>
          ) : (
            <>
              <button onClick={onClose} style={btn()}>Cancel</button>
              <span style={{ fontSize: '0.72rem', color: result.undecided ? '#b91c1c' : '#6b7280', marginLeft: 'auto' }}>
                {result.undecided ? `${result.undecided} material(s) still need a choice` : nothing ? 'Nothing to change' : changes.join(' · ')}
              </span>
              <button disabled={result.undecided > 0 || nothing} onClick={() => setConfirming(true)}
                style={{ ...btn(true), opacity: result.undecided || nothing ? 0.5 : 1, cursor: result.undecided || nothing ? 'not-allowed' : 'pointer' }}>
                Apply
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
