'use client';

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import api from '@/lib/api';
import type { Project } from '@/types/project';
import type { ProjectDocument } from '@/types/document';
import type { BOQItem, BOQItemRow } from '@/types/boq';
import type { BlueprintResult, FinishTemplate, GeneratedBoq } from '@/types/blueprint';
import { matchPhases, measurementWorkType, floorPrefix } from '@/lib/workPhases';
import { inp, sel, lbl } from './styles';

// Blueprint → rows in the Material Plan. Pick the drawing, check the traced
// rooms, and the generated rows are added to the Material Plan grid as
// unsaved rows — exactly like "Scan & Fill Rows" — to be edited there and
// saved with the normal Save. Finishes are chosen automatically (wet rooms
// get non-slip tiles, the rest the plan's noted or typical finishes); any
// specification can be changed in the grid afterwards.
// Historical projects get a read-only "Compare with blueprint" instead.

interface Props {
  project: Project;
  document: ProjectDocument;
  savedBoq: BOQItem[];
  existingRows: BOQItemRow[];
  onClose: () => void;
  onAddRows: (rows: BOQItemRow[]) => void;
}

type Step = 'drawing' | 'rooms' | 'compare';

interface EditableRoom {
  include: boolean; name: string; floorAreaSqm: number; perimeterM: number;
  lengthM: number; widthM: number; heightM: number | null; confidence: number;
}
interface EditableOpening { type: string; count: number; widthM: number; heightM: number }

const PRIMARY_SECTION = 'Architectural Works';
const WET_ROOM = /\b(c\.?r\.?|toilet|t\s*&\s*b|bath|wc|lavatory|kitchen|laundry|powder|shower)\b/i;
const DEFAULTS = { dryFloor: 'floor_tile_600', wetFloor: 'floor_tile_300', wall: 'painted_plaster', ceiling: 'fiber_cement_ceiling' };

function apiError(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

const btn = (primary = false): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 8, border: primary ? 'none' : '1px solid #e5e7eb', cursor: 'pointer',
  background: primary ? '#f97316' : '#fff', color: primary ? '#fff' : '#374151', fontSize: '0.8rem', fontWeight: 600,
});
const th: React.CSSProperties = { textAlign: 'left', fontSize: '0.62rem', color: '#9ca3af', fontWeight: 700, padding: '6px 6px', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '4px 6px', fontSize: '0.76rem', color: '#374151', verticalAlign: 'middle' };
const small = { ...inp, padding: '4px 6px', fontSize: '0.74rem' };
const fmt = (n: number | null | undefined, d = 2) => (n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: d }));

function ScheduleBadge({ result }: { result: BlueprintResult }) {
  const c = result.scheduleCheck;
  if (!c?.planTotalSqm || c.differencePct == null) return null;
  const ok = c.differencePct <= 1.5;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', fontWeight: 600, padding: '3px 9px', borderRadius: 999,
      background: ok ? '#dcfce7' : '#fef3c7', color: ok ? '#15803d' : '#b45309' }}
      title="Gross footprint traced from the walls vs the total area stated on the plan">
      {ok ? <CheckCircle2 style={{ width: 12, height: 12 }} /> : <AlertTriangle style={{ width: 12, height: 12 }} />}
      Plan says {fmt(c.planTotalSqm)} m² · traced {fmt(c.extractedTotalSqm)} m² ({fmt(c.differencePct, 1)}% off)
    </span>
  );
}

export default function BlueprintWizard({ project, document: doc, savedBoq, existingRows, onClose, onAddRows }: Props) {
  const compareMode = project.isHistorical;
  const [step, setStep] = useState<Step>('drawing');
  const [result, setResult] = useState<BlueprintResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [drawingId, setDrawingId] = useState('');
  const [scaleOverride, setScaleOverride] = useState('');
  const [rooms, setRooms] = useState<EditableRoom[]>([]);
  const [openings, setOpenings] = useState<EditableOpening[]>([]);
  const [templates, setTemplates] = useState<FinishTemplate[]>([]);

  const selectedTitle = result?.sheets.flatMap(s => s.drawings).find(d => d.id === result?.selectedDrawing)?.title;

  async function read(drawing?: string, scale?: string) {
    setLoading(true);
    try {
      const { data } = await api.post<BlueprintResult>(`/documents/${doc.id}/parse-blueprint`,
        { drawingId: drawing || null, scaleOverride: scale || null }, { timeout: 300_000 });
      setResult(data);
      setDrawingId(data.selectedDrawing ?? '');
      const heights = [...data.ceilingHeightsM].sort((a, b) => a - b);
      setRooms(data.rooms.map(r => ({
        include: !r.name.startsWith('Unlabelled'), name: r.name, floorAreaSqm: r.floorAreaSqm, perimeterM: r.perimeterM,
        lengthM: r.lengthM, widthM: r.widthM, confidence: r.confidence,
        // From the plan's "CH = …" notes: the taller height for the larger spaces.
        heightM: heights.length === 0 ? null : heights.length === 1 ? heights[0] : r.floorAreaSqm >= 10 ? heights[heights.length - 1] : heights[0],
      })));
      setOpenings(data.openings.map(o => ({
        type: o.type, count: o.count, widthM: o.widthM ?? (o.type === 'door' ? 0.9 : 1.2), heightM: o.heightM ?? (o.type === 'door' ? 2.1 : 1.2),
      })));
    } catch (error) {
      toast.error(apiError(error, 'Failed to read the blueprint.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    read();
    if (!compareMode)
      api.get<{ templates: FinishTemplate[] }>('/boq/templates').then(r => setTemplates(r.data.templates)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Finishes named on the plan ("600x600mm FLOOR TILES") win over the defaults.
  const noted = useMemo(() => {
    const out: Partial<Record<'floor' | 'wall' | 'ceiling', string>> = {};
    for (const t of templates) {
      if (t.surface === 'openings' || out[t.surface] || !t.notePattern) continue;
      try {
        const re = new RegExp(t.notePattern, 'i');
        if (result?.finishNotes.some(n => re.test(n))) out[t.surface] = t.key;
      } catch { /* a pattern JS can't parse just isn't used */ }
    }
    return out;
  }, [templates, result]);
  const labelOf = (key: string) => templates.find(t => t.key === key)?.label ?? key;
  const finishFor = (room: string) => ({
    floor: WET_ROOM.test(room) ? DEFAULTS.wetFloor : (noted.floor ?? DEFAULTS.dryFloor),
    wall: noted.wall ?? DEFAULTS.wall,
    ceiling: noted.ceiling ?? DEFAULTS.ceiling,
  });

  const included = rooms.filter(r => r.include);

  async function addToMaterialPlan() {
    setLoading(true);
    try {
      const { data } = await api.post<GeneratedBoq>('/boq/generate-from-blueprint', {
        projectId: project.id,
        source: result?.selectedDrawing,
        perRoomFloor: true,
        measurements: included.map(r => ({ room: r.name, floorAreaSqm: r.floorAreaSqm, perimeterM: r.perimeterM, heightM: r.heightM, openingsSqm: 0 })),
        finishes: included.map(r => ({ room: r.name, ...finishFor(r.name) })),
        openings: openings.filter(o => o.count > 0).map(o => ({ type: o.type, count: o.count, widthM: o.widthM, heightM: o.heightM })),
      });
      if (data.rows.length === 0) { toast.error('Nothing could be generated from these rooms.'); return; }

      // Number the work items after any architectural rows already in the plan.
      let n = existingRows.filter(r => /architectural/i.test(r.primarySection)).length;
      const rows: BOQItemRow[] = data.rows.map(r => ({
        primarySection: PRIMARY_SECTION,
        subCategory: `1.${++n} ${r.subCategory}`,
        specification: r.materialName ?? r.specification,
        materialId: r.materialId ?? undefined,
        newMaterialName: r.materialName ?? r.specification,
        unit: r.boqUnit,
        estimatedQuantity: r.boqQuantity,
        notes: r.sourceNote,
      } as BOQItemRow));
      onAddRows(rows);

      // Room measurements are kept too when the project has phases to file
      // them under (they need one); the BOQ rows above never do.
      const phases = matchPhases(project.phases ?? []);
      if ((project.phases ?? []).length > 0) {
        const prefix = floorPrefix(selectedTitle);
        const base = { concreteMixRatio: '1:2:4', wasteAllowancePct: 0, thicknessM: 0 };
        const phaseFor = (t: string) => phases[measurementWorkType(t)].phaseId;
        const items = included.flatMap(r => [
          { ...base, elementType: 'Floor', phaseId: phaseFor('Floor'), areaLabel: `${prefix} · ${r.name}`, lengthM: r.lengthM, widthM: r.widthM, heightM: 0, areaSqm: r.floorAreaSqm, perimeterM: r.perimeterM },
          ...(r.heightM ? [{ ...base, elementType: 'Wall', phaseId: phaseFor('Wall'), areaLabel: `${prefix} · ${r.name} walls`, lengthM: r.perimeterM, widthM: 0, heightM: r.heightM }] : []),
        ]);
        api.post('/measurements/bulk', { projectId: project.id, items }).catch(() => toast.error('Rows added, but the room measurements couldn\'t be saved.'));
      }

      if (data.warnings.length) toast(data.warnings[0], { icon: '⚠️' });
      toast.success(`${rows.length} row(s) added to the Material Plan — review them, then Save.`);
      onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to generate the BOQ.'));
    } finally {
      setLoading(false);
    }
  }

  // ── Historical: compare extracted vs saved (read-only) ───────────────────
  const savedFloorArea = savedBoq
    .filter(b => /sq\.?\s?m|m2/i.test(b.unit) && /floor|til/i.test(`${b.subCategory ?? ''} ${b.specification ?? ''} ${b.materialName}`))
    .reduce((s, b) => s + b.estimatedQuantity, 0);

  const hasRooms = (result?.rooms.length ?? 0) > 0;
  const steps: Step[] = compareMode ? ['drawing', 'compare'] : ['drawing', 'rooms'];
  const stepLabel: Record<Step, string> = { drawing: 'Choose drawing', rooms: 'Check rooms', compare: 'Compare' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Generate BOQ from blueprint"
        style={{ background: '#fff', borderRadius: 16, width: 'min(920px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontWeight: 800, color: '#111827' }}>{compareMode ? 'Compare with blueprint' : 'Generate BOQ from blueprint'}</p>
            <p style={{ fontSize: '0.72rem', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.fileName}</p>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {steps.map((s, i) => (
                <span key={s} style={{ fontSize: '0.68rem', fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                  background: s === step ? '#fff7ed' : '#f9fafb', color: s === step ? '#c2410c' : '#9ca3af' }}>{i + 1}. {stepLabel[s]}</span>
              ))}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', alignSelf: 'flex-start' }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        <div style={{ padding: '1rem 1.25rem', overflowY: 'auto', flex: 1 }}>
          {loading && (
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: '#6b7280', marginBottom: 12 }}>
              <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
              {step === 'drawing' ? 'Reading the plan set — a large one takes a minute or two the first time…' : 'Generating rows…'}
            </p>
          )}
          {result?.errors.map(e => <p key={e} style={{ fontSize: '0.78rem', color: '#b91c1c', marginBottom: 6 }}>{e}</p>)}
          {result?.warnings.map(w => <p key={w} style={{ fontSize: '0.72rem', color: '#b45309', marginBottom: 4 }}>{w}</p>)}

          {step === 'drawing' && result && (
            <div style={{ display: 'grid', gap: 12 }}>
              <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>Pick the floor plan to measure — not an elevation, ceiling or finishing plan.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) auto', gap: 8, alignItems: 'end' }}>
                <div>
                  <label style={lbl}>Drawing</label>
                  <select value={drawingId} onChange={e => setDrawingId(e.target.value)} style={sel}>
                    {result.sheets.map(s => (
                      <optgroup key={s.id} label={`${s.id} — ${s.title}`}>
                        {s.drawings.map(d => <option key={d.id} value={d.id}>{d.title}{d.scale ? ` (${d.scale})` : ' (no scale)'}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Scale (if missing or wrong)</label>
                  <input value={scaleOverride} onChange={e => setScaleOverride(e.target.value)} placeholder="e.g. 1:50" style={inp} />
                </div>
                <button disabled={loading} onClick={() => read(drawingId, scaleOverride)} style={btn()}>Read drawing</button>
              </div>
              {hasRooms && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.78rem', color: '#374151' }}>{result.rooms.length} room(s) found on <b>{selectedTitle}</b></span>
                  <ScheduleBadge result={result} />
                </div>
              )}
            </div>
          )}

          {step === 'rooms' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                  <thead><tr>{['', 'Room', 'Floor area (m²)', 'Perimeter (m)', 'Ceiling height (m)', 'Floor finish'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {rooms.map((r, i) => {
                      const set = (patch: Partial<EditableRoom>) => setRooms(prev => prev.map((x, j) => j === i ? { ...x, ...patch } : x));
                      return (
                        <tr key={i} style={{ borderTop: '1px solid #f3f4f6', opacity: r.include ? 1 : 0.5 }}>
                          <td style={td}><input type="checkbox" checked={r.include} onChange={e => set({ include: e.target.checked })} aria-label={`Include ${r.name}`} /></td>
                          <td style={td}><input value={r.name} onChange={e => set({ name: e.target.value })} style={small} aria-label="Room name" /></td>
                          <td style={td}><input type="number" min="0" step="0.01" value={r.floorAreaSqm} onChange={e => set({ floorAreaSqm: Number(e.target.value) || 0 })} style={small} aria-label="Floor area" /></td>
                          <td style={td}><input type="number" min="0" step="0.01" value={r.perimeterM} onChange={e => set({ perimeterM: Number(e.target.value) || 0 })} style={small} aria-label="Perimeter" /></td>
                          <td style={td}><input type="number" min="0" step="0.01" value={r.heightM ?? ''} placeholder="enter for walls" onChange={e => set({ heightM: e.target.value === '' ? null : Number(e.target.value) })}
                            style={{ ...small, borderColor: r.heightM == null ? '#fbbf24' : '#e5e7eb' }} aria-label="Ceiling height" /></td>
                          <td style={{ ...td, fontSize: '0.7rem', color: '#6b7280' }}>{labelOf(finishFor(r.name).floor)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                {['door', 'window'].map(type => {
                  const o = openings.find(x => x.type === type);
                  const setCount = (count: number) => setOpenings(prev => o ? prev.map(x => x.type === type ? { ...x, count } : x)
                    : [...prev, { type, count, widthM: type === 'door' ? 0.9 : 1.2, heightM: type === 'door' ? 2.1 : 1.2 }]);
                  return (
                    <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: '#374151' }}>
                      {type === 'door' ? 'Doors' : 'Windows'}
                      <input type="number" min="0" value={o?.count ?? 0} onChange={e => setCount(Number(e.target.value) || 0)} style={{ ...small, width: 70 }} />
                    </label>
                  );
                })}
              </div>
              <p style={{ fontSize: '0.72rem', color: '#6b7280', lineHeight: 1.5 }}>
                Rows will use: floors — {labelOf(noted.floor ?? DEFAULTS.dryFloor)} ({labelOf(DEFAULTS.wetFloor)} in CR/toilet/kitchen);
                walls — {labelOf(noted.wall ?? DEFAULTS.wall)}; ceilings — {labelOf(noted.ceiling ?? DEFAULTS.ceiling)}.
                You can change any specification in the Material Plan afterwards.
              </p>
              {included.some(r => r.heightM == null) && <p style={{ fontSize: '0.72rem', color: '#b45309' }}>Rooms without a ceiling height get no wall rows.</p>}
            </div>
          )}

          {step === 'compare' && result && (
            <div style={{ display: 'grid', gap: 8 }}>
              <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>Read-only — nothing about this historical project is changed.</p>
              {[
                ['Plan’s stated total', result.scheduleCheck?.planTotalSqm],
                ['Traced gross footprint', result.scheduleCheck?.extractedTotalSqm],
                ['Traced room (clear) area', result.scheduleCheck?.clearTotalSqm],
                ['Saved BOQ — floor/tile rows', savedFloorArea || null],
              ].map(([label, value]) => (
                <p key={String(label)} style={{ fontSize: '0.78rem', color: '#374151' }}>{label}: <b>{value == null ? '—' : `${fmt(value as number)} m²`}</b></p>
              ))}
              {result.rooms.map(r => <p key={r.name} style={{ fontSize: '0.74rem', color: '#6b7280' }}>{r.name}: {fmt(r.floorAreaSqm)} m²</p>)}
            </div>
          )}
        </div>

        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button onClick={() => (step === 'drawing' ? onClose() : setStep('drawing'))} style={btn()}>{step === 'drawing' ? 'Cancel' : 'Back'}</button>
          {step === 'drawing' && (
            <button disabled={!hasRooms || loading} onClick={() => setStep(compareMode ? 'compare' : 'rooms')} style={{ ...btn(true), opacity: hasRooms ? 1 : 0.5 }}>
              {compareMode ? 'Compare' : 'Next: check rooms'}
            </button>
          )}
          {step === 'rooms' && (
            <button disabled={loading || included.length === 0} onClick={addToMaterialPlan} style={btn(true)}>
              {loading ? 'Generating…' : 'Add to Material Plan'}
            </button>
          )}
          {step === 'compare' && <button onClick={onClose} style={btn(true)}>Done</button>}
        </div>
      </div>
    </div>
  );
}
