'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Loader2, AlertTriangle, CheckCircle2, Plus } from 'lucide-react';
import api from '@/lib/api';
import type { Project } from '@/types/project';
import type { ProjectDocument } from '@/types/document';
import type { BOQItem, BOQItemRow } from '@/types/boq';
import type { BlueprintNote, BlueprintReadData, BlueprintReadRecord, BlueprintResult, GeneratedBoq } from '@/types/blueprint';
import { matchPhases, measurementWorkType, floorPrefix } from '@/lib/workPhases';
import { generatedToRows, isGuess } from '@/lib/blueprintSource';
import { inp, sel, lbl } from './styles';

// Blueprint → rows in the Material Plan. Every floor of the plan set is read
// at once — one drawing per floor, shown beside its traced rooms — then the
// rooms are checked floor by floor and the generated rows are added to the
// Material Plan grid as unsaved rows, exactly like "Scan & Fill Rows", to be
// edited there and saved with the normal Save. Finishes aren't picked here:
// the generator reads them off the drawing (the ceiling plan's note in each
// room, the plan set's finish notes), else your past projects, else a
// standard finish — and every row says which. They're reviewed in the
// Material Plan: hover a specification for its source, open it on the plan,
// or change a room's finish there. The read itself is kept with the project
// for that. Historical projects get a read-only "Compare with blueprint" instead.

interface Props {
  project: Project;
  document: ProjectDocument;
  savedBoq: BOQItem[];
  existingRows: BOQItemRow[];
  onClose: () => void;
  onAddRows: (rows: BOQItemRow[]) => void;
}

type Step = 'floors' | 'rooms' | 'compare';

interface EditableRoom {
  include: boolean; name: string; floorAreaSqm: number; perimeterM: number;
  lengthM: number; widthM: number; heightM: number | null; confidence: number;
  traced: number | null;  // index of the traced room it came from (its outline); null for one added by hand
  ceilingNotes: BlueprintNote[]; // what the ceiling plan says about the room
}
interface EditableOpening { type: string; count: number; widthM: number; heightM: number }

interface Floor {
  key: string;
  name: string;
  drawingId: string;
  include: boolean;
  note: string | null;
  alternatives: string[];
  scaleOverride: string;
  result: BlueprintResult | null;
  loading: boolean;
  rooms: EditableRoom[];
  allHeight: string;
}

const FLOOR_NAMES: [RegExp, string][] = [
  [/\bBASEMENT\b/, 'Basement'], [/\bGROUND\b/, 'Ground Floor'], [/\b(FIRST|1ST)\b/, 'First Floor'],
  [/\bMEZZANINE\b/, 'Mezzanine'], [/\b(SECOND|2ND)\b/, 'Second Floor'], [/\b(THIRD|3RD)\b/, 'Third Floor'],
  [/\b(FOURTH|4TH)\b/, 'Fourth Floor'], [/\bROOF\s*DECK\b/, 'Roof Deck'],
];

function apiError(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;
}

const btn = (primary = false): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 8, border: primary ? 'none' : '1px solid #e5e7eb', cursor: 'pointer',
  background: primary ? '#f97316' : '#fff', color: primary ? '#fff' : '#374151', fontSize: '0.8rem', fontWeight: 600,
});
const link: React.CSSProperties = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#c2410c', fontSize: '0.72rem', fontWeight: 600 };
const th: React.CSSProperties = { textAlign: 'left', fontSize: '0.62rem', color: '#9ca3af', fontWeight: 700, padding: '6px 6px', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '4px 6px', fontSize: '0.76rem', color: '#374151', verticalAlign: 'middle' };
const small = { ...inp, padding: '4px 6px', fontSize: '0.74rem' };
// Floor, wall and ceiling rows use the clear area; a plan's area schedule
// (and the footprint checked against it) also counts the floor under walls.
const AREA_HINT = 'Clear: the floor inside the walls — what floor, ceiling and wall rows are measured from. '
  + 'Footprint: the whole outline with walls and partitions, like the area schedule on the plan.';
const fmt = (n: number | null | undefined, d = 2) => (n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: d }));
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

function ScheduleBadge({ result }: { result: BlueprintResult }) {
  const c = result.scheduleCheck;
  if (!c?.planTotalSqm || c.differencePct == null) return null;
  const ok = c.differencePct <= 1.5;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: 999,
      background: ok ? '#dcfce7' : '#fef3c7', color: ok ? '#15803d' : '#b45309' }}
      title="Gross footprint traced from the walls vs the total area stated on the plan">
      {ok ? <CheckCircle2 style={{ width: 12, height: 12 }} /> : <AlertTriangle style={{ width: 12, height: 12 }} />}
      Plan says {fmt(c.planTotalSqm)} m² · traced {fmt(c.extractedTotalSqm)} m² ({fmt(c.differencePct, 1)}% off)
    </span>
  );
}

/** The drawing with its traced rooms outlined; `highlight` is a room index. */
function PlanPreview({ result, highlight, onHover, names }: {
  result: BlueprintResult | null; highlight: number | null; onHover: (i: number | null) => void;
  names?: Record<number, string>;  // traced room index → the name as edited in Check rooms
}) {
  const box: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fafafa', minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' };
  if (!result?.preview) {
    return <div style={box}><p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{result ? 'No preview for this drawing.' : 'Reading the drawing…'}</p></div>;
  }
  const { image, width, height } = result.preview;
  return (
    <div style={{ ...box, display: 'block', overflow: 'hidden', background: '#fff' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', maxHeight: '64vh', display: 'block' }} role="img"
        aria-label={`Drawing with ${result.rooms.length} traced room(s)`}>
        <image href={image} width={width} height={height} />
        {result.rooms.map((r, i) => {
          if (!r.outline || r.outline.length < 3) return null;
          const unlabelled = r.labels.length === 0;
          const on = i === highlight;
          return (
            <polygon key={i} points={r.outline.map(p => p.join(',')).join(' ')}
              fill={on ? 'rgba(249,115,22,0.35)' : unlabelled ? 'rgba(239,68,68,0.22)' : 'rgba(59,130,246,0.16)'}
              stroke={on ? '#ea580c' : unlabelled ? '#dc2626' : '#2563eb'} strokeWidth={on ? 3 : 1.5}
              onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(null)} style={{ cursor: 'pointer' }}>
              <title>{names?.[i] ?? r.name} · {fmt(r.floorAreaSqm)} m²</title>
            </polygon>
          );
        })}
      </svg>
      <p style={{ fontSize: '0.66rem', color: '#9ca3af', padding: '6px 10px', borderTop: '1px solid #f3f4f6' }}>
        <span style={{ color: '#2563eb' }}>■</span> traced room &nbsp; <span style={{ color: '#dc2626' }}>■</span> no name found &nbsp;
        Spaces with no outline (e.g. a toilet) weren&apos;t traced — add them with &quot;Add a room&quot; in Check rooms.
      </p>
    </div>
  );
}

function guessFloorName(title: string | undefined, taken: string[]): string {
  const t = (title ?? '').toUpperCase();
  const base = FLOOR_NAMES.find(([re]) => re.test(t))?.[1] ?? 'Floor';
  let name = base, n = 2;
  while (taken.includes(name)) name = `${base} (${n++})`;
  return name;
}

/** A floor's traced rooms as editable rows: repeated names numbered ("BEDROOM", "BEDROOM 2"). */
function editableRooms(data: BlueprintResult): EditableRoom[] {
  const heights = [...data.ceilingHeightsM].sort((a, b) => a - b);
  const seen: Record<string, number> = {};
  return data.rooms.map((r, i) => {
    seen[r.name] = (seen[r.name] ?? 0) + 1;
    return {
      traced: i,
      include: r.labels.length > 0, name: seen[r.name] > 1 ? `${r.name} ${seen[r.name]}` : r.name,
      floorAreaSqm: r.floorAreaSqm, perimeterM: r.perimeterM, lengthM: r.lengthM, widthM: r.widthM, confidence: r.confidence,
      // The room's own height on the ceiling plan; else, from the plan's
      // "CH = …" notes, the taller height for the larger spaces.
      heightM: r.ceilingHeightM ?? (heights.length === 0 ? null : heights.length === 1 ? heights[0]
        : r.floorAreaSqm >= 10 ? heights[heights.length - 1] : heights[0]),
      ceilingNotes: r.ceilingNoteDetails ?? [],
    };
  });
}

export default function BlueprintWizard({ project, document: doc, savedBoq, existingRows, onClose, onAddRows }: Props) {
  const compareMode = project.isHistorical;
  const [step, setStep] = useState<Step>('floors');
  const [plan, setPlan] = useState<BlueprintResult | null>(null);  // the first read: sheets, floor list, skipped plans
  const [floors, setFloors] = useState<Floor[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [changing, setChanging] = useState<string | null>(null);  // floor whose "Change drawing" is open
  const [adding, setAdding] = useState(false);
  const [starting, setStarting] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [openings, setOpenings] = useState<EditableOpening[]>([]);
  const nextKey = useRef(0);

  const drawings = useMemo(() => {
    const out: Record<string, { title: string; scale: string | null; sheet: string }> = {};
    for (const s of plan?.sheets ?? []) for (const d of s.drawings) out[d.id] = { title: d.title, scale: d.scale, sheet: s.id };
    return out;
  }, [plan]);

  const patchFloor = (key: string, patch: Partial<Floor>) => setFloors(prev => prev.map(f => f.key === key ? { ...f, ...patch } : f));

  async function parse(drawingId: string | null, scale?: string) {
    const { data } = await api.post<BlueprintResult>(`/documents/${doc.id}/parse-blueprint`,
      { drawingId, scaleOverride: scale || null }, { timeout: 300_000 });
    return data;
  }

  async function readFloor(key: string, drawingId: string, scale?: string) {
    patchFloor(key, { loading: true, drawingId });
    try {
      const data = await parse(drawingId, scale);
      patchFloor(key, { result: data, rooms: editableRooms(data), drawingId: data.selectedDrawing ?? drawingId, loading: false });
      if (data.errors.some(e => /scale/i.test(e))) setChanging(key);
    } catch (error) {
      toast.error(apiError(error, 'Failed to read the drawing.'));
      patchFloor(key, { loading: false });
    }
  }

  const newFloor = (name: string, drawingId: string, include: boolean, note: string | null = null, alternatives: string[] = []): Floor => ({
    key: `f${nextKey.current++}`, name, drawingId, include, note, alternatives, scaleOverride: '',
    result: null, loading: false, rooms: [], allHeight: '',
  });

  // First read: the plan set's floors and the first floor's rooms; then every
  // other ticked floor, one after another (the sheet scan is cached, so each
  // takes seconds).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const first = await parse(null);
        if (cancelled) return;
        setPlan(first);
        const list = first.floorPlans?.length ? first.floorPlans
          : first.selectedDrawing ? [{ floor: 'Floor plan', drawingId: first.selectedDrawing, confirm: false, note: null, alternatives: [] }] : [];
        const built = list.map(fp => {
          const f = newFloor(fp.floor, fp.drawingId, !fp.confirm, fp.note, fp.alternatives);
          return fp.drawingId === first.selectedDrawing ? { ...f, result: first, rooms: editableRooms(first) } : f;
        });
        setFloors(built);
        setActiveKey(built[0]?.key ?? null);
        setStarting(false);
        for (const f of built) {
          if (cancelled) return;
          if (f.include && !f.result) await readFloor(f.key, f.drawingId);
        }
      } catch (error) {
        toast.error(apiError(error, 'Failed to read the blueprint.'));
        setStarting(false);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const included = floors.filter(f => f.include);
  const active = floors.find(f => f.key === activeKey) ?? null;
  const multiFloor = included.length > 1;
  const busy = starting || floors.some(f => f.loading);
  const readyToCheck = !busy && included.length > 0 && included.every(f => (f.result?.rooms.length ?? 0) > 0);

  // Warnings every floor shares (OCR used, skipped MEP sheets) are shown once.
  const loaded = floors.filter(f => f.result).map(f => f.result!);
  const sharedWarnings = loaded.length ? loaded[0].warnings.filter(w => loaded.every(r => r.warnings.includes(w))) : [];

  const skippedSummary = useMemo(() => {
    const used = new Set(floors.map(f => f.drawingId));
    const counts: Record<string, number> = {};
    for (const id of plan?.skippedPlans ?? []) {
      if (used.has(id) || !drawings[id]) continue;
      const t = titleCase(drawings[id].title);
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return Object.entries(counts).map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(', ');
  }, [plan, floors, drawings]);

  // The plan set's finish notes — the same sheets for every floor read, so once each.
  const planNotes = useMemo(() => {
    const seen = new Set<string>();
    return included.flatMap(f => f.result?.planNotes ?? []).filter(n => {
      const k = `${n.page}|${n.text}`;
      return !seen.has(k) && !!seen.add(k);
    });
  }, [included]);

  function toRooms() {
    // Doors and windows of every floor read, as one editable total per size.
    const merged: Record<string, EditableOpening> = {};
    for (const f of included) for (const o of f.result?.openings ?? []) {
      const width = o.widthM ?? (o.type === 'door' ? 0.9 : 1.2), height = o.heightM ?? (o.type === 'door' ? 2.1 : 1.2);
      const k = `${o.type}|${width}|${height}`;
      merged[k] = { type: o.type, widthM: width, heightM: height, count: (merged[k]?.count ?? 0) + o.count };
    }
    setOpenings(Object.values(merged));
    if (!included.some(f => f.key === activeKey)) setActiveKey(included[0]?.key ?? null);
    setHighlight(null);
    setStep(compareMode ? 'compare' : 'rooms');
  }

  const roomName = (f: Floor, name: string) => (multiFloor ? `${f.name} · ${name}` : name);
  const includedRooms = included.flatMap(f => f.rooms.filter(r => r.include).map(r => ({ floor: f, room: r })));

  // What the rows are shown against later, on the plan: each floor's page and
  // rooms (outlines in PDF points), and what regenerating a room's finish needs.
  const readData = (): BlueprintReadData => ({
    version: 1,
    floors: included.map(f => ({
      name: f.name, drawingId: f.drawingId, title: drawings[f.drawingId]?.title ?? f.drawingId,
      page: f.result?.page ?? null, ceilingPlanPage: f.result?.ceilingPlanPage ?? null, hasCeilingPlan: !!f.result?.ceilingPlan,
      rooms: f.rooms.filter(r => r.include).map(r => ({
        name: roomName(f, r.name), outline: r.traced != null ? f.result?.rooms[r.traced]?.outlinePt ?? [] : [],
        floorAreaSqm: r.floorAreaSqm, perimeterM: r.perimeterM, heightM: r.heightM, ceilingNotes: r.ceilingNotes,
      })),
    })),
    planNotes,
  });

  async function addToMaterialPlan() {
    setGenerating(true);
    try {
      const { data } = await api.post<GeneratedBoq>('/boq/generate-from-blueprint', {
        projectId: project.id,
        source: included.map(f => f.drawingId).join(', ').slice(0, 60),
        perRoomFloor: true,
        measurements: includedRooms.map(({ floor, room: r }) => ({
          room: roomName(floor, r.name), floorAreaSqm: r.floorAreaSqm, perimeterM: r.perimeterM, heightM: r.heightM, openingsSqm: 0,
          ceilingNotes: r.ceilingNotes, hasCeilingPlan: !!floor.result?.ceilingPlan,
        })),
        finishes: [],
        planNotes,
        openings: openings.filter(o => o.count > 0).map(o => ({ type: o.type, count: o.count, widthM: o.widthM, heightM: o.heightM })),
      });
      if (data.rows.length === 0) { toast.error('Nothing could be generated from these rooms.'); return; }

      // Kept with the project, so each row can be opened on the plan later.
      let readId: number | null = null;
      try {
        const saved = await api.post<BlueprintReadRecord>('/boq/blueprint-reads', { projectId: project.id, documentId: doc.id, read: JSON.stringify(readData()) });
        readId = saved.data.id;
      } catch {
        toast.error('Rows added, but the blueprint couldn\'t be kept with them — they can\'t be opened on the plan.');
      }

      // Number the work items after any architectural rows already in the plan.
      const rows = generatedToRows(data.rows, readId, existingRows.filter(r => /architectural/i.test(r.primarySection)).length);
      onAddRows(rows);

      // Room measurements are kept too when the project has phases to file
      // them under (they need one); the BOQ rows above never do.
      const phases = matchPhases(project.phases ?? []);
      if ((project.phases ?? []).length > 0) {
        const base = { concreteMixRatio: '1:2:4', wasteAllowancePct: 0, thicknessM: 0 };
        const phaseFor = (t: string) => phases[measurementWorkType(t)].phaseId;
        const items = includedRooms.flatMap(({ floor, room: r }) => {
          const prefix = floorPrefix(`${floor.name} ${drawings[floor.drawingId]?.title ?? ''}`);
          return [
            { ...base, elementType: 'Floor', phaseId: phaseFor('Floor'), areaLabel: `${prefix} · ${r.name}`, lengthM: r.lengthM, widthM: r.widthM, heightM: 0, areaSqm: r.floorAreaSqm, perimeterM: r.perimeterM },
            ...(r.heightM ? [{ ...base, elementType: 'Wall', phaseId: phaseFor('Wall'), areaLabel: `${prefix} · ${r.name} walls`, lengthM: r.perimeterM, widthM: 0, heightM: r.heightM }] : []),
          ];
        });
        api.post('/measurements/bulk', { projectId: project.id, items }).catch(() => toast.error('Rows added, but the room measurements couldn\'t be saved.'));
      }

      if (data.warnings.length) toast(data.warnings[0], { icon: '⚠️' });
      const guessed = data.rows.filter(r => isGuess({ ...r.source, readId, roomNames: r.rooms })).length;
      toast.success(`${rows.length} row(s) added to the Material Plan — review them, then Save.`);
      if (guessed) {
        toast(`${guessed} material(s) weren't on the drawing — hover over their specification in the Material Plan to check them.`,
          { icon: '⚠️', duration: 8000 });
      }
      onClose();
    } catch (error) {
      toast.error(apiError(error, 'Failed to generate the BOQ.'));
    } finally {
      setGenerating(false);
    }
  }

  // ── Historical: compare extracted vs saved (read-only) ───────────────────
  const savedFloorArea = savedBoq
    .filter(b => /sq\.?\s?m|m2/i.test(b.unit) && /floor|til/i.test(`${b.subCategory ?? ''} ${b.specification ?? ''} ${b.materialName}`))
    .reduce((s, b) => s + b.estimatedQuantity, 0);
  const sumOf = (pick: (r: BlueprintResult) => number | null | undefined) => {
    const values = included.map(f => (f.result ? pick(f.result) : null)).filter((v): v is number => v != null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };

  const steps: Step[] = compareMode ? ['floors', 'compare'] : ['floors', 'rooms'];
  const stepLabel: Record<Step, string> = { floors: 'Floors', rooms: 'Check rooms', compare: 'Compare' };

  const drawingOptions = (f: Floor) => {
    const others = Object.keys(drawings).filter(id => id !== f.drawingId && !f.alternatives.includes(id));
    return (
      <>
        {f.alternatives.length > 0 && (
          <optgroup label="Other plans of this floor">
            {f.alternatives.map(id => <option key={id} value={id}>{drawings[id]?.title} · {drawings[id]?.sheet}</option>)}
          </optgroup>
        )}
        {(plan?.sheets ?? []).map(s => {
          const ds = s.drawings.filter(d => others.includes(d.id));
          return ds.length > 0 && (
            <optgroup key={s.id} label={`${s.id} — ${s.title}`}>
              {ds.map(d => <option key={d.id} value={d.id}>{d.title}{d.scale ? ` (${d.scale})` : ' (no scale)'}</option>)}
            </optgroup>
          );
        })}
      </>
    );
  };

  function floorCard(f: Floor) {
    const r = f.result;
    const d = drawings[f.drawingId];
    const isActive = f.key === activeKey;
    const own = (r?.warnings ?? []).filter(w => !sharedWarnings.includes(w));
    const area = r ? r.rooms.reduce((s, x) => s + x.floorAreaSqm, 0) : 0;
    const measured = r?.scaleUsed && d?.scale && r.scaleUsed !== d.scale ? ` (measured ${r.scaleUsed})` : '';
    return (
      <div key={f.key} onClick={() => { setActiveKey(f.key); setHighlight(null); }}
        style={{ border: `1px solid ${isActive ? '#fdba74' : '#e5e7eb'}`, background: isActive ? '#fff7ed' : '#fff', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', opacity: f.include ? 1 : 0.7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={f.include} aria-label={`Read ${f.name}`} onClick={e => e.stopPropagation()}
            onChange={e => { const include = e.target.checked; patchFloor(f.key, { include }); if (include && !f.result && !f.loading) readFloor(f.key, f.drawingId); }} />
          <input value={f.name} onClick={e => e.stopPropagation()} onChange={e => patchFloor(f.key, { name: e.target.value })} aria-label="Floor name"
            style={{ ...small, fontWeight: 700, width: 'auto', flex: 1, border: '1px solid transparent', background: 'transparent' }} />
          {f.loading && <Loader2 style={{ width: 14, height: 14, color: '#9ca3af' }} className="animate-spin" />}
        </div>
        <p style={{ fontSize: '0.7rem', color: '#6b7280', margin: '2px 0 0 24px' }}>
          {d ? `${d.title} · sheet ${d.sheet}${d.scale ? ` · ${d.scale}` : ''}${measured}` : f.drawingId}
        </p>
        <div style={{ margin: '4px 0 0 24px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {f.loading ? <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>Reading…</span>
            : r ? <span style={{ fontSize: '0.74rem', color: '#374151' }} title={AREA_HINT}>
                <b>{r.rooms.length}</b> room(s) · {fmt(area)} m² clear
                {r.scheduleCheck?.extractedTotalSqm ? <span style={{ color: '#9ca3af' }}> · footprint {fmt(r.scheduleCheck.extractedTotalSqm)} m²</span> : null}
              </span>
            : <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>Not read yet — tick it to read</span>}
          {r && <ScheduleBadge result={r} />}
          <button style={link} onClick={e => { e.stopPropagation(); setChanging(changing === f.key ? null : f.key); }}>
            {changing === f.key ? 'Close' : 'Change drawing'}
          </button>
        </div>
        {f.note && <p style={{ fontSize: '0.7rem', color: '#b45309', margin: '4px 0 0 24px' }}>{f.note}</p>}
        {r?.errors.map(e => <p key={e} style={{ fontSize: '0.72rem', color: '#b91c1c', margin: '4px 0 0 24px' }}>{e}</p>)}
        {own.map(w => <p key={w} style={{ fontSize: '0.68rem', color: '#b45309', margin: '4px 0 0 24px' }}>{w}</p>)}
        {changing === f.key && (
          <div onClick={e => e.stopPropagation()} style={{ margin: '8px 0 0 24px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 90px auto', gap: 6, alignItems: 'end' }}>
            <div>
              <label style={lbl}>Drawing</label>
              <select value="" onChange={e => e.target.value && readFloor(f.key, e.target.value, f.scaleOverride)} style={{ ...sel, padding: '6px 8px', fontSize: '0.74rem' }}>
                <option value="">Pick another drawing…</option>
                {drawingOptions(f)}
              </select>
            </div>
            <div>
              <label style={lbl}>Scale</label>
              <input value={f.scaleOverride} placeholder="e.g. 1:50" onChange={e => patchFloor(f.key, { scaleOverride: e.target.value })} style={small} />
            </div>
            <button disabled={f.loading} onClick={() => readFloor(f.key, f.drawingId, f.scaleOverride)} style={{ ...btn(), padding: '6px 10px' }}>Re-read</button>
            <p style={{ gridColumn: '1 / -1', fontSize: '0.66rem', color: '#9ca3af' }}>
              Enter a scale only if the drawing has none or the traced areas are clearly off — it overrides the scale read from the plan.
            </p>
          </div>
        )}
        {isActive && r && r.rooms.length > 0 && (
          <div style={{ margin: '8px 0 0 24px', display: 'grid', gap: 2 }}>
            {r.rooms.map((x, i) => (
              <div key={i} onMouseEnter={() => setHighlight(i)} onMouseLeave={() => setHighlight(null)}
                style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '2px 6px', borderRadius: 6,
                  background: highlight === i ? '#ffedd5' : 'transparent', color: x.labels.length ? '#374151' : '#b91c1c' }}>
                <span>{x.name}</span><span>{fmt(x.floorAreaSqm)} m²</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const usedDrawings = new Set(floors.map(f => f.drawingId));

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Generate BOQ from blueprint"
        style={{ background: '#fff', borderRadius: 16, width: 'min(1180px, 100%)', maxHeight: '94vh', display: 'flex', flexDirection: 'column' }}>
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
          {starting && (
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: '#6b7280', marginBottom: 12 }}>
              <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
              Reading the plan set — a large one takes a minute or two the first time…
            </p>
          )}
          {!starting && floors.length === 0 && plan?.errors.map(e => <p key={e} style={{ fontSize: '0.78rem', color: '#b91c1c', marginBottom: 6 }}>{e}</p>)}
          {sharedWarnings.map(w => <p key={w} style={{ fontSize: '0.72rem', color: '#b45309', marginBottom: 4 }}>{w}</p>)}

          {step === 'floors' && floors.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(300px, 2fr)', gap: 16, alignItems: 'start' }}>
              <PlanPreview result={active?.result ?? null} highlight={highlight} onHover={setHighlight} />
              <div style={{ display: 'grid', gap: 8 }}>
                <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                  {floors.length > 1 ? `${floors.length} floor plans found — each floor is read once, from the drawing shown.` : 'Floor plan found — rooms are read from the drawing shown.'} Click a floor to see its rooms.
                </p>
                {floors.map(floorCard)}
                {skippedSummary && (
                  <p style={{ fontSize: '0.68rem', color: '#9ca3af', lineHeight: 1.5 }}>
                    Not read (the same floors drawn for other trades, or not floor plans): {skippedSummary}.
                  </p>
                )}
                {adding ? (
                  <select autoFocus defaultValue="" style={{ ...sel, padding: '6px 8px', fontSize: '0.74rem' }}
                    onBlur={() => setAdding(false)}
                    onChange={e => {
                      const id = e.target.value;
                      if (!id) return;
                      const f = newFloor(guessFloorName(drawings[id]?.title, floors.map(x => x.name)), id, true);
                      setFloors(prev => [...prev, f]);
                      setActiveKey(f.key);
                      setAdding(false);
                      readFloor(f.key, id);
                    }}>
                    <option value="">Pick the floor&apos;s drawing…</option>
                    {(plan?.sheets ?? []).map(s => {
                      const ds = s.drawings.filter(d => !usedDrawings.has(d.id));
                      return ds.length > 0 && (
                        <optgroup key={s.id} label={`${s.id} — ${s.title}`}>
                          {ds.map(d => <option key={d.id} value={d.id}>{d.title}{d.scale ? ` (${d.scale})` : ''}</option>)}
                        </optgroup>
                      );
                    })}
                  </select>
                ) : (
                  <button style={{ ...link, display: 'inline-flex', alignItems: 'center', gap: 4, justifySelf: 'start' }} onClick={() => setAdding(true)}>
                    <Plus style={{ width: 12, height: 12 }} /> Add a floor the wizard missed
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 'rooms' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)', gap: 16, alignItems: 'start' }}>
              {/* Stays in view while the tables scroll; follows the floor and row under the pointer. */}
              <div style={{ position: 'sticky', top: 0, display: 'grid', gap: 6 }}>
                {multiFloor && <p style={{ fontSize: '0.74rem', fontWeight: 700, color: '#374151' }}>{active?.name}</p>}
                <PlanPreview result={active?.result ?? null} highlight={highlight} onHover={setHighlight}
                  names={Object.fromEntries((active?.rooms ?? []).filter(r => r.traced != null).map(r => [r.traced!, r.name || 'Room']))} />
              </div>
            <div style={{ display: 'grid', gap: 16 }}>
              {included.map(f => {
                const setRoom = (i: number, patch: Partial<EditableRoom>) =>
                  patchFloor(f.key, { rooms: f.rooms.map((x, j) => j === i ? { ...x, ...patch } : x) });
                return (
                  <section key={f.key} style={{ display: 'grid', gap: 8 }}
                    onMouseEnter={() => { if (activeKey !== f.key) { setActiveKey(f.key); setHighlight(null); } }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <p style={{ fontWeight: 800, color: '#111827', fontSize: '0.85rem' }}>{f.name}</p>
                      <p style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{drawings[f.drawingId]?.title}</p>
                      <p style={{ fontSize: '0.7rem', color: '#6b7280', marginLeft: 'auto' }} title={AREA_HINT}>
                        Ticked rooms: <b>{fmt(f.rooms.filter(r => r.include).reduce((s, r) => s + r.floorAreaSqm, 0))} m²</b> clear
                        {f.result?.scheduleCheck?.extractedTotalSqm ? ` · footprint ${fmt(f.result.scheduleCheck.extractedTotalSqm)} m² (walls included)` : ''}
                      </p>
                    </div>
                    {/* A floor plan has no heights; most rooms share one, read off the plan's sections. */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label htmlFor={`height-${f.key}`} style={{ fontSize: '0.76rem', color: '#374151' }}>Ceiling height for all rooms (m)</label>
                      <input id={`height-${f.key}`} type="number" min="0" step="0.01" value={f.allHeight} placeholder="e.g. 2.75"
                        onChange={e => patchFloor(f.key, { allHeight: e.target.value })} style={{ ...small, width: 90 }} />
                      <button disabled={!(Number(f.allHeight) > 0)} style={{ ...btn(), padding: '5px 12px', opacity: Number(f.allHeight) > 0 ? 1 : 0.5 }}
                        onClick={() => patchFloor(f.key, { rooms: f.rooms.map(r => ({ ...r, heightM: Number(f.allHeight) })) })}>
                        Apply
                      </button>
                      <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>Floor plans don&apos;t show heights — take it from the sections (floor to ceiling line).</span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                        <thead><tr>{['', 'Room', 'Floor area (m²)', 'Perimeter (m)', 'Ceiling height (m)'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                        <tbody>
                          {f.rooms.map((r, i) => (
                            <tr key={i} onMouseEnter={() => setHighlight(r.traced)} onMouseLeave={() => setHighlight(null)}
                              style={{ borderTop: '1px solid #f3f4f6', opacity: r.include ? 1 : 0.5,
                                background: f.key === activeKey && r.traced != null && r.traced === highlight ? '#ffedd5' : undefined }}>
                              <td style={td}><input type="checkbox" checked={r.include} onChange={e => setRoom(i, { include: e.target.checked })} aria-label={`Include ${r.name}`} /></td>
                              <td style={td}><input value={r.name} placeholder="Room name" onChange={e => setRoom(i, { name: e.target.value })} style={small} aria-label="Room name" /></td>
                              <td style={td}><input type="number" min="0" step="0.01" value={r.floorAreaSqm} onChange={e => setRoom(i, { floorAreaSqm: Number(e.target.value) || 0 })} style={small} aria-label="Floor area" /></td>
                              <td style={td}><input type="number" min="0" step="0.01" value={r.perimeterM} onChange={e => setRoom(i, { perimeterM: Number(e.target.value) || 0 })} style={small} aria-label="Perimeter" /></td>
                              <td style={td}><input type="number" min="0" step="0.01" value={r.heightM ?? ''} placeholder="enter for walls" onChange={e => setRoom(i, { heightM: e.target.value === '' ? null : Number(e.target.value) })}
                                style={{ ...small, borderColor: r.heightM == null ? '#fbbf24' : '#e5e7eb' }} aria-label="Ceiling height" /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button style={{ ...link, display: 'inline-flex', alignItems: 'center', gap: 4, justifySelf: 'start' }}
                      onClick={() => patchFloor(f.key, { rooms: [...f.rooms, { include: true, name: '', floorAreaSqm: 0, perimeterM: 0, lengthM: 0, widthM: 0,
                        heightM: Number(f.allHeight) > 0 ? Number(f.allHeight) : null, confidence: 1, traced: null, ceilingNotes: [] }] })}>
                      <Plus style={{ width: 12, height: 12 }} /> Add a room that wasn&apos;t traced (e.g. a toilet)
                    </button>
                  </section>
                );
              })}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                {['door', 'window'].map(type => {
                  const o = openings.find(x => x.type === type);
                  const setCount = (count: number) => setOpenings(prev => o ? prev.map(x => x === o ? { ...x, count } : x)
                    : [...prev, { type, count, widthM: type === 'door' ? 0.9 : 1.2, heightM: type === 'door' ? 2.1 : 1.2 }]);
                  return (
                    <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: '#374151' }}>
                      {type === 'door' ? 'Doors' : 'Windows'}{multiFloor ? ' (all floors)' : ''}
                      <input type="number" min="0" value={o?.count ?? 0} onChange={e => setCount(Number(e.target.value) || 0)} style={{ ...small, width: 70 }} />
                    </label>
                  );
                })}
              </div>
              <p style={{ fontSize: '0.72rem', color: '#6b7280', lineHeight: 1.5 }}>
                Floor, wall and ceiling finishes are read from the drawing&apos;s notes
                {included.some(f => f.result?.ceilingPlan) ? ' (each room\'s ceiling from the reflected ceiling plan)' : ''};
                where it says nothing, from your past projects, else a standard finish. Check them in the Material Plan:
                hover over a specification to see where it came from, or open it on the plan.
                {multiFloor && ' Each room\'s row is named with its floor ("Ground Floor · Bedroom").'}
              </p>
              {includedRooms.some(({ room }) => room.heightM == null) && <p style={{ fontSize: '0.72rem', color: '#b45309' }}>Rooms without a ceiling height get no wall rows.</p>}
            </div>
            </div>
          )}

          {step === 'compare' && (
            <div style={{ display: 'grid', gap: 8 }}>
              <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>Read-only — nothing about this historical project is changed.</p>
              {[
                ['Plan’s stated total', sumOf(r => r.scheduleCheck?.planTotalSqm)],
                ['Traced gross footprint', sumOf(r => r.scheduleCheck?.extractedTotalSqm)],
                ['Traced room (clear) area', sumOf(r => r.scheduleCheck?.clearTotalSqm)],
                ['Saved BOQ — floor/tile rows', savedFloorArea || null],
              ].map(([label, value]) => (
                <p key={String(label)} style={{ fontSize: '0.78rem', color: '#374151' }}>{label}: <b>{value == null ? '—' : `${fmt(value as number)} m²`}</b></p>
              ))}
              {included.map(f => (
                <div key={f.key}>
                  {multiFloor && <p style={{ fontSize: '0.74rem', fontWeight: 700, color: '#374151', marginTop: 4 }}>{f.name}</p>}
                  {(f.result?.rooms ?? []).map((r, i) => <p key={i} style={{ fontSize: '0.74rem', color: '#6b7280' }}>{r.name}: {fmt(r.floorAreaSqm)} m²</p>)}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button onClick={() => (step === 'floors' ? onClose() : setStep('floors'))} style={btn()}>{step === 'floors' ? 'Cancel' : 'Back'}</button>
          {step === 'floors' && (
            <button disabled={!readyToCheck} onClick={toRooms} style={{ ...btn(true), opacity: readyToCheck ? 1 : 0.5 }}
              title={readyToCheck ? undefined : busy ? 'Still reading…' : 'Every ticked floor needs traced rooms'}>
              {compareMode ? 'Compare' : multiFloor ? `Next: check rooms (${included.length} floors)` : 'Next: check rooms'}
            </button>
          )}
          {step === 'rooms' && (
            <button disabled={generating || includedRooms.length === 0} onClick={addToMaterialPlan} style={btn(true)}>
              {generating ? 'Generating…' : 'Add to Material Plan'}
            </button>
          )}
          {step === 'compare' && <button onClick={onClose} style={btn(true)}>Done</button>}
        </div>
      </div>
    </div>
  );
}
