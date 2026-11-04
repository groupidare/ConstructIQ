'use client';

import { useMemo, useState } from 'react';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import type { BOQItemRow } from '@/types/boq';
import {
  applyComparison, compareBoqSections, lineNumber, materialOf, MATCH_TOLERANCE,
  type CompareGroup, type CompareLine, type CompareSection, type GroupChoice,
} from '@/lib/boqCompare';

// The whole scanned BOQ beside the blueprint rows already in the plan,
// section by section (see lib/boqCompare.ts). Sections the blueprint filled
// are compared material by material; the rest are listed as the BOQ's own.
// Nothing is added until "Apply": rows only in the uploaded BOQ are ticked;
// where both cover the same work differently the user picks which to keep.
// Sections needing no choice start collapsed, so the decisions come first.

interface Props {
  blueprintRows: BOQItemRow[];
  uploadedRows: BOQItemRow[];
  onApply: (add: BOQItemRow[], remove: BOQItemRow[]) => void;
  onClose: () => void;
}

type Filter = 'all' | 'choose' | 'match' | 'uploaded' | 'blueprint';

const btn = (primary = false): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 8, border: primary ? 'none' : '1px solid #e5e7eb', cursor: 'pointer',
  background: primary ? '#f97316' : '#fff', color: primary ? '#fff' : '#374151', fontSize: '0.8rem', fontWeight: 600,
});
const th: React.CSSProperties = { textAlign: 'left', fontSize: '0.62rem', color: '#9ca3af', fontWeight: 700, padding: '6px 8px', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '5px 8px', fontSize: '0.76rem', color: '#374151', verticalAlign: 'top' };
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const STATUS: Record<CompareLine['status'], { label: string; bg: string; color: string }> = {
  match: { label: 'In both', bg: '#dcfce7', color: '#15803d' },
  included: { label: 'In both', bg: '#dcfce7', color: '#15803d' },
  differ: { label: 'Quantities differ', bg: '#fef3c7', color: '#b45309' },
  blueprint: { label: 'Only in blueprint', bg: '#dbeafe', color: '#1d4ed8' },
  uploaded: { label: 'Only in uploaded BOQ', bg: '#ffedd5', color: '#c2410c' },
};

// A material only one side uses where the other side has a material of its
// own for the same work — fiber cement board vs acoustic panels. A layer only
// one side lists (a skim coat under paint) is just "only in" that side.
const otherMaterial = (line: CompareLine, group: CompareGroup) =>
  group.alternative && (line.status === 'blueprint' || line.status === 'uploaded');
// Both sides cover the same area overall but split it differently (paint over
// every room vs paint over the sales area only): a per-material % misleads.
const splitDifferently = (line: CompareLine, group: CompareGroup) =>
  line.status === 'differ' && group.alternative && group.area != null && group.area.differencePct <= MATCH_TOLERANCE * 100;

function statusLabel(line: CompareLine, group: CompareGroup): string {
  if (line.status === 'included') return `In both — included in ${line.includedIn.join(', ')}`;
  if (splitDifferently(line, group)) return 'Same area, split differently';
  if (line.status === 'differ') {
    const units = line.blueprint && line.uploaded && line.blueprint.unit !== line.uploaded.unit;
    return units ? `Quantities differ (${line.blueprint!.unit} vs ${line.uploaded!.unit})` : `Quantities differ (${line.differencePct}%)`;
  }
  return otherMaterial(line, group) ? 'Same work, other material' : STATUS[line.status].label;
}

const Chip = ({ line, group }: { line: CompareLine; group: CompareGroup }) => {
  const s = otherMaterial(line, group) ? STATUS.differ : STATUS[line.status];
  return <span style={{ fontSize: '0.66rem', fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>{statusLabel(line, group)}</span>;
};

function BlueprintCell({ line, fromBlueprint }: { line: CompareLine; fromBlueprint: boolean }) {
  const b = line.blueprint;
  if (!b) return <span style={{ color: '#d1d5db' }}>{fromBlueprint ? '—' : '— not generated from blueprint'}</span>;
  // Floor finish rows are one per room: show the rooms behind the total.
  const rooms = b.rows.map(r => `${(r.subCategory ?? '').replace(/^\s*\d+(\.\d+)*\s*/, '')}: ${fmt(r.estimatedQuantity)} ${r.unit ?? ''}`).join('\n');
  return <span title={`${materialOf(b.rows[0])}\n${rooms}`}>{fmt(b.quantity)} {b.unit}{b.rows.length > 1 ? <span style={{ color: '#9ca3af' }}> ({b.rows.length} rows)</span> : null}</span>;
}

function UploadedCell({ line }: { line: CompareLine }) {
  const u = line.uploaded;
  if (!u) return <span style={{ color: '#d1d5db' }}>{line.includedIn.length ? `in ${line.includedIn.join(', ')}` : '—'}</span>;
  return (
    <span style={{ display: 'grid', gap: 2 }}>
      {u.rows.map((r, i) => (
        <span key={i} title={materialOf(r)}>
          <span style={{ color: '#9ca3af' }}>{lineNumber(r) || '·'}:</span> {fmt(r.estimatedQuantity)} {r.unit}
        </span>
      ))}
    </span>
  );
}

const uploadedOf = (groups: CompareGroup[]) => groups.filter(g => g.mode === 'uploaded').flatMap(g => g.lines.flatMap(l => l.uploaded?.rows ?? []));

export default function BoqCompareDialog({ blueprintRows, uploadedRows, onApply, onClose }: Props) {
  const sections = useMemo(() => compareBoqSections(blueprintRows, uploadedRows), [blueprintRows, uploadedRows]);
  const [choices, setChoices] = useState<Record<string, GroupChoice>>({});
  const [ticked, setTicked] = useState<Set<BOQItemRow>>(() => new Set(uploadedOf(sections.flatMap(s => s.groups))));
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Set<string>>(() => {
    const deciding = sections.filter(s => s.groups.some(g => g.mode === 'choose'));
    // Nothing to decide: still open the compared sections, so the comparison shows.
    return new Set((deciding.length ? deciding : sections.filter(s => s.fromBlueprint)).map(s => s.key));
  });

  const { add, remove } = applyComparison(sections, choices, ticked);
  const groups = sections.flatMap(s => s.groups);
  const counts: Record<Filter, number> = {
    all: uploadedRows.length + blueprintRows.length,
    choose: groups.filter(g => g.mode === 'choose').length,
    match: groups.filter(g => g.mode === 'match').length,
    uploaded: uploadedOf(groups).length,
    blueprint: groups.filter(g => g.mode === 'blueprint').length,
  };
  const filters: [Filter, string][] = [
    ['all', `All (${uploadedRows.length} uploaded · ${blueprintRows.length} blueprint rows)`],
    ['choose', `Needs a choice (${counts.choose})`], ['match', `In both (${counts.match})`],
    ['uploaded', `Only in uploaded BOQ (${counts.uploaded} rows)`], ['blueprint', `Only in blueprint (${counts.blueprint})`],
  ];

  const toggle = (rows: BOQItemRow[], on: boolean) => setTicked(prev => {
    const next = new Set(prev);
    rows.forEach(r => (on ? next.add(r) : next.delete(r)));
    return next;
  });
  const flip = (key: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  function summary(s: CompareSection): string {
    const deciding = s.groups.filter(g => g.mode === 'choose').length;
    const rows = uploadedOf(s.groups);
    const added = rows.filter(r => ticked.has(r)).length;
    const parts = [
      deciding ? `${deciding} need a choice` : '',
      rows.length ? (added === rows.length ? `${rows.length} row(s) · all added` : `${added} of ${rows.length} row(s) added`) : '',
      s.fromBlueprint ? '' : 'not generated from blueprint',
    ];
    return parts.filter(Boolean).join(' · ');
  }

  function groupRows(s: CompareSection, g: CompareGroup) {
    const uploaded = g.lines.flatMap(l => l.uploaded?.rows ?? []);
    const choice = choices[g.key] ?? 'blueprint';
    // A section the blueprint never generates is one list — no work-item heading needed.
    const heading = s.fromBlueprint && (
      <tr key={g.key} style={{ background: '#fafafa', borderTop: '1px solid #f3f4f6' }}>
        <td style={td}>
          {g.mode === 'uploaded' && (
            <input type="checkbox" checked={uploaded.every(r => ticked.has(r))} aria-label={`Add ${g.label}`} onChange={e => toggle(uploaded, e.target.checked)} />
          )}
        </td>
        <td colSpan={4} style={{ ...td, fontWeight: 700, fontSize: '0.74rem' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{g.label}</span>
            {g.area && (
              <span style={{ fontSize: '0.68rem', fontWeight: 500, color: g.area.differencePct <= MATCH_TOLERANCE * 100 ? '#15803d' : '#b45309' }}
                title="The area each BOQ's rows for this work cover">
                Area: blueprint {fmt(g.area.blueprint)} · uploaded {fmt(g.area.uploaded)} {g.area.unit}
                {g.area.differencePct <= MATCH_TOLERANCE * 100 ? ` — same area (${g.area.differencePct}%)` : ` — ${g.area.differencePct}% apart`}
              </span>
            )}
            {g.mode === 'match' && <span style={{ fontSize: '0.68rem', fontWeight: 500, color: '#15803d' }}>Matches — nothing added</span>}
            {g.mode === 'blueprint' && <span style={{ fontSize: '0.68rem', fontWeight: 500, color: '#6b7280' }}>Kept as is</span>}
            {g.mode === 'choose' && (
              <span role="radiogroup" aria-label={`${g.label}: which to keep`} style={{ display: 'inline-flex', gap: 4 }}>
                {([['blueprint', 'Keep blueprint'], ['uploaded', 'Use uploaded'], ['both', 'Keep both']] as [GroupChoice, string][]).map(([c, label]) => (
                  <button key={c} role="radio" aria-checked={choice === c} onClick={() => setChoices(prev => ({ ...prev, [g.key]: c }))}
                    title={c === 'uploaded' ? 'Replaces the blueprint rows for this work with the uploaded BOQ\'s'
                      : c === 'both' ? 'Adds the uploaded rows too — only if they are different work' : 'Nothing from the uploaded BOQ is added'}
                    style={{ fontSize: '0.66rem', fontWeight: 600, padding: '2px 8px', borderRadius: 999, cursor: 'pointer',
                      border: '1px solid ' + (choice === c ? '#fb923c' : '#e5e7eb'), background: choice === c ? '#fff7ed' : '#fff', color: choice === c ? '#c2410c' : '#6b7280' }}>
                    {label}
                  </button>
                ))}
              </span>
            )}
          </div>
        </td>
      </tr>
    );
    return [heading, ...g.lines.map((l, i) => (
      <tr key={`${g.key}-${i}`} style={{ borderTop: '1px solid #f3f4f6' }}>
        <td style={td}>
          {g.mode === 'uploaded' && l.uploaded && (
            <input type="checkbox" checked={l.uploaded.rows.every(r => ticked.has(r))} aria-label={`Add ${l.material}`}
              onChange={e => toggle(l.uploaded!.rows, e.target.checked)} />
          )}
        </td>
        <td style={td} title={[l.uploaded && `Uploaded: ${materialOf(l.uploaded.rows[0])}`, l.blueprint && `Blueprint: ${materialOf(l.blueprint.rows[0])}`].filter(Boolean).join('\n')}>
          {!s.fromBlueprint && l.uploaded && <span style={{ color: '#9ca3af' }}>{(l.uploaded.rows[0].subCategory ?? '').replace(/^\s*\d+(\.\d+)*\s*/, '')} · </span>}
          {l.material}
        </td>
        <td style={{ ...td, whiteSpace: 'nowrap' }}><BlueprintCell line={l} fromBlueprint={s.fromBlueprint} /></td>
        <td style={{ ...td, whiteSpace: 'nowrap' }}><UploadedCell line={l} /></td>
        <td style={td}><Chip line={l} group={g} /></td>
      </tr>
    ))];
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Compare with the blueprint"
        style={{ background: '#fff', borderRadius: 16, width: 'min(1120px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <p style={{ fontWeight: 800, color: '#111827' }}>Compare with the blueprint</p>
            <p style={{ fontSize: '0.74rem', color: '#6b7280', marginTop: 4, lineHeight: 1.5 }}>
              Every row of the uploaded BOQ beside the BOQ generated from the blueprint, by material. Items only in the uploaded BOQ are
              ticked to add; where both cover the same work differently, pick which one to keep — the same work is never added twice.
              Nothing is added until you click Apply.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', alignSelf: 'flex-start' }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        <div style={{ padding: '0.6rem 1.25rem 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {filters.filter(([f]) => f === 'all' || counts[f] > 0).map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)} style={{ fontSize: '0.7rem', fontWeight: 600, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
              border: '1px solid ' + (filter === f ? '#fdba74' : '#e5e7eb'), background: filter === f ? '#fff7ed' : '#fff', color: filter === f ? '#c2410c' : '#6b7280' }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ padding: '0.5rem 1.25rem', overflow: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 28 }} />
                {['Material', 'Blueprint BOQ', 'Uploaded BOQ', 'Status'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {sections.map(s => {
                const shown = s.groups.filter(g => filter === 'all' || g.mode === filter);
                if (shown.length === 0) return null;
                // A filter shows its rows wherever they are; otherwise sections open and close.
                const isOpen = filter !== 'all' || open.has(s.key);
                const rows = uploadedOf(s.groups);
                const allTicked = rows.length > 0 && rows.every(r => ticked.has(r));
                return [
                  <tr key={s.key} style={{ background: '#f3f4f6', borderTop: '2px solid #e5e7eb' }}>
                    <td style={td}>
                      {rows.length > 0 && (
                        <input type="checkbox" checked={allTicked} aria-label={`Add all of ${s.label}`} onChange={e => toggle(rows, e.target.checked)} />
                      )}
                    </td>
                    <td colSpan={4} style={{ ...td, padding: '7px 8px' }}>
                      <button onClick={() => flip(s.key)} aria-expanded={isOpen}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left' }}>
                        {isOpen ? <ChevronDown style={{ width: 14, height: 14, color: '#6b7280' }} /> : <ChevronRight style={{ width: 14, height: 14, color: '#6b7280' }} />}
                        <span style={{ fontWeight: 800, fontSize: '0.76rem', color: '#111827', textTransform: 'uppercase' }}>{s.label}</span>
                        <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>— {summary(s)}</span>
                      </button>
                    </td>
                  </tr>,
                  ...(isOpen ? shown.flatMap(g => groupRows(s, g)) : []),
                ];
              })}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <button onClick={onClose} style={btn()}>Cancel</button>
          <span style={{ fontSize: '0.72rem', color: '#6b7280', marginLeft: 'auto' }}>
            {add.length} row(s) to add{remove.length ? ` · ${remove.length} blueprint row(s) replaced` : ''}
          </span>
          <button disabled={add.length === 0 && remove.length === 0} onClick={() => onApply(add, remove)}
            style={{ ...btn(true), opacity: add.length || remove.length ? 1 : 0.5 }}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
