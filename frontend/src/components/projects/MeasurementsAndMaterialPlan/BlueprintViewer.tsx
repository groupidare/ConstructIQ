'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import type { BlueprintPages, BlueprintReadData, BlueprintReadRecord, SavedBlueprintSource } from '@/types/blueprint';

// "View Plan": the blueprint the Material Plan's generated rows came from —
// the whole PDF, page after page, scrollable and zoomable, docked to the
// right of the Material Plan. Clicking a row there scrolls to where it comes
// from: its rooms outlined on the floor plan, the note it was read from
// boxed (on the ceiling plan, a finishing plan, an elevation). The rows not
// backed by the drawing are listed at the top, to check them in turn.

export const PANEL_WIDTH = 'min(680px, 44vw)';

export interface ViewerRow { key: string; label: string; source: SavedBlueprintSource }

interface Props {
  readId: number;
  rows: ViewerRow[];       // every row of this read — the focused one and the guessed ones
  focusKey: string;        // '' until a row is clicked
  onClose: () => void;
}

const ZOOMS = [1, 1.5, 2, 3, 4, 6];
// Page image widths the backend renders; the panel asks for the one that
// keeps text sharp at the current zoom.
const RENDER_WIDTHS = [1400, 2200, 3600, 5000];

function PageImage({ documentId, page, width, height, zoom, px, children }: {
  documentId: number; page: number; width: number; height: number; zoom: number; px: number; children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const shown = useRef<string | null>(null);
  useEffect(() => () => { if (shown.current) URL.revokeObjectURL(shown.current); }, []);

  // Rendered only once scrolled near — a plan set can have dozens of pages.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let gone = false;
    // A sharper image replaces the shown one only once it has arrived.
    api.get(`/documents/${documentId}/pages/${page}`, { params: { width: px }, responseType: 'blob' })
      .then(r => {
        if (gone) return;
        const made = URL.createObjectURL(r.data as Blob);
        if (shown.current) URL.revokeObjectURL(shown.current);
        shown.current = made;
        setUrl(made);
      })
      .catch(() => { if (!gone && !shown.current) setFailed(true); });
    return () => { gone = true; };
  }, [visible, documentId, page, px]);

  return (
    <div ref={ref} data-page={page} style={{ position: 'relative', width: `${zoom * 100}%`, aspectRatio: `${width} / ${height}`, background: '#fff', border: '1px solid #e5e7eb' }}>
      {url && <img src={url} alt={`Page ${page}`} draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />}
      {!url && (
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', color: '#9ca3af', gap: 6 }}>
          {failed ? 'Couldn\'t show this page.' : <><Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> Page {page}</>}
        </span>
      )}
      <svg viewBox={`0 0 ${width} ${height}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {children}
      </svg>
    </div>
  );
}

const KIND: Record<string, { label: string; color: string; bg: string }> = {
  drawing: { label: 'From the drawing', color: '#15803d', bg: '#dcfce7' },
  history: { label: 'From your past projects', color: '#1d4ed8', bg: '#dbeafe' },
  default: { label: 'Default — please check', color: '#b45309', bg: '#fef3c7' },
  chosen: { label: 'Picked by you', color: '#4b5563', bg: '#f3f4f6' },
};

export default function BlueprintViewer({ readId, rows, focusKey, onClose }: Props) {
  const [record, setRecord] = useState<BlueprintReadRecord | null>(null);
  const [pages, setPages] = useState<BlueprintPages['pages']>([]);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState(focusKey);
  const scroller = useRef<HTMLDivElement>(null);
  const [panelPx, setPanelPx] = useState(640);

  // Zoom keeps the middle of the view where it was.
  const anchor = useRef<{ x: number; y: number } | null>(null);
  function zoomTo(next: number) {
    const el = scroller.current;
    if (el) anchor.current = { x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth, y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight };
    setZoom(Math.min(ZOOMS[ZOOMS.length - 1], Math.max(ZOOMS[0], next)));
  }
  const step = (dir: 1 | -1) => zoomTo(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + dir))]);
  useLayoutEffect(() => {
    const el = scroller.current, a = anchor.current;
    if (!el || !a) return;
    el.scrollLeft = a.x * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = a.y * el.scrollHeight - el.clientHeight / 2;
    anchor.current = null;
  }, [zoom]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setPanelPx(el.clientWidth);
    const ro = new ResizeObserver(() => setPanelPx(el.clientWidth));
    ro.observe(el);
    // Ctrl + scroll (or a trackpad pinch) zooms, like a PDF viewer.
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      step(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener('wheel', wheel); };
  });
  // Drag to move around a zoomed page.
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const px = RENDER_WIDTHS.find(w => w >= panelPx * zoom * (typeof window !== 'undefined' ? window.devicePixelRatio : 1)) ?? RENDER_WIDTHS[RENDER_WIDTHS.length - 1];

  useEffect(() => setCurrent(focusKey), [focusKey]);
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const { data } = await api.get<BlueprintReadRecord>(`/boq/blueprint-reads/${readId}`);
        if (gone) return;
        setRecord(data);
        const p = await api.get<BlueprintPages>(`/documents/${data.documentId}/pages`);
        if (!gone) setPages(p.data.pages);
      } catch (e) {
        const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
        if (!gone) setError(message ?? 'Couldn\'t open the blueprint.');
      }
    })();
    return () => { gone = true; };
  }, [readId]);

  const read = useMemo<BlueprintReadData | null>(() => {
    try { return record ? JSON.parse(record.read) as BlueprintReadData : null; } catch { return null; }
  }, [record]);
  const row = rows.find(r => r.key === current) ?? null;
  const src = row?.source;
  // Only the defaults need checking; a finish from past projects is shown without comment.
  const guessed = rows.filter(r => r.source.kind === 'default');

  // The row's rooms, on their floor's page.
  const rooms = useMemo(() => {
    if (!read || !src) return [];
    const names = new Set(src.roomNames);
    return read.floors.flatMap(f => f.rooms.filter(r => names.has(r.name) && r.outline.length > 2).map(r => ({ ...r, page: f.page })));
  }, [read, src]);

  // Where to look first: the note it was read from (a ceiling is read off
  // the ceiling plan), else its rooms on the floor plan.
  const target = src?.notes.find(n => n.page)?.page && (src.surface === 'ceiling' || rooms.length === 0)
    ? src.notes.find(n => n.page)!.page
    : rooms[0]?.page ?? src?.notes.find(n => n.page)?.page ?? null;

  function scrollTo(page: number | null) {
    const el = page ? scroller.current?.querySelector<HTMLElement>(`[data-page="${page}"]`) : null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  useEffect(() => {
    if (pages.length) requestAnimationFrame(() => scrollTo(target));
  }, [pages.length, current, target]); // eslint-disable-line react-hooks/exhaustive-deps

  const kind = src ? KIND[src.kind] ?? KIND.default : null;

  return (
    <aside role="dialog" aria-label="Blueprint" onClick={e => e.stopPropagation()}
      style={{ width: PANEL_WIDTH, height: '92vh', flexShrink: 0, background: '#fff', borderRadius: 16, overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '0.8rem 1rem', borderBottom: '1px solid #f3f4f6', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <p style={{ fontWeight: 800, color: '#111827', fontSize: '0.9rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={record?.fileName}>
            {record?.fileName ?? 'Blueprint'}
          </p>
          <button onClick={() => step(-1)} disabled={zoom === ZOOMS[0]} aria-label="Zoom out" title="Zoom out (Ctrl + scroll)" style={iconBtn}><ZoomOut style={{ width: 15, height: 15 }} /></button>
          <button onClick={() => zoomTo(1)} title="Fit the page width" style={{ ...iconBtn, width: 46, fontSize: '0.7rem' }}>{Math.round(zoom * 100)}%</button>
          <button onClick={() => step(1)} disabled={zoom === ZOOMS[ZOOMS.length - 1]} aria-label="Zoom in" title="Zoom in (Ctrl + scroll)" style={iconBtn}><ZoomIn style={{ width: 15, height: 15 }} /></button>
          <button onClick={onClose} aria-label="Close the plan" title="Close the plan" style={{ ...iconBtn, marginLeft: 4 }}><X style={{ width: 16, height: 16 }} /></button>
        </div>
        {row && kind && (
          <div style={{ display: 'grid', gap: 4 }}>
            <p style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151' }}>{row.label}</p>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {src!.kind !== 'history' && (
                <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: kind.bg, color: kind.color }}>{kind.label}</span>
              )}
              {src!.reason && src!.kind === 'default' && <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>{src!.reason}</span>}
            </div>
            {src!.notes.map((n, i) => (
              <button key={i} onClick={() => scrollTo(n.page)} disabled={!n.page}
                style={{ textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: n.page ? 'pointer' : 'default', fontSize: '0.72rem', color: '#374151' }}>
                <span style={{ color: '#c2410c', fontWeight: 600 }}>{n.page ? `Page ${n.page}` : 'Note'}:</span> &ldquo;{n.text}&rdquo;
              </button>
            ))}
            {src!.roomNames.length > 0 && <p style={{ fontSize: '0.68rem', color: '#9ca3af' }}>Rooms: {src!.roomNames.join(', ')}</p>}
          </div>
        )}
        {!row && <p style={{ fontSize: '0.72rem', color: '#6b7280' }}>Click a blueprint row in the Material Plan to see it on the plan.</p>}
        {guessed.length > 0 && (
          <details open={guessed.some(g => g.key !== current)} style={{ fontSize: '0.7rem', color: '#b45309' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{guessed.length} material(s) not on the drawing — check these</summary>
            <div style={{ display: 'grid', gap: 2, marginTop: 4 }}>
              {guessed.map(g => (
                <button key={g.key} onClick={() => setCurrent(g.key)}
                  style={{ textAlign: 'left', background: g.key === current ? '#fef3c7' : 'none', border: 'none', borderRadius: 6, padding: '2px 6px', cursor: 'pointer', fontSize: '0.7rem', color: '#92400e' }}>
                  {g.label}
                </button>
              ))}
            </div>
          </details>
        )}
      </div>

      <div ref={scroller}
        onMouseDown={e => { const el = scroller.current!; drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }; }}
        onMouseMove={e => {
          const d = drag.current, el = scroller.current;
          if (!d || !el || e.buttons !== 1) return;
          el.scrollLeft = d.left - (e.clientX - d.x);
          el.scrollTop = d.top - (e.clientY - d.y);
        }}
        onMouseUp={() => { drag.current = null; }} onMouseLeave={() => { drag.current = null; }}
        style={{ flex: 1, overflow: 'auto', padding: '0.75rem', background: '#f3f4f6', display: 'grid', gap: 12, alignContent: 'start',
          cursor: zoom > 1 ? 'grab' : undefined, userSelect: 'none' }}>
        {error && <p style={{ fontSize: '0.78rem', color: '#b91c1c' }}>{error}</p>}
        {!error && pages.length === 0 && (
          <p style={{ fontSize: '0.76rem', color: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> Opening the blueprint…
          </p>
        )}
        {record && pages.map((p, i) => {
          const n = i + 1;
          const stroke = p.width / 300;
          return (
            <div key={n} style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: '0.66rem', color: '#6b7280', fontWeight: 600 }}>Page {n}{n === target ? ' · this row' : ''}</span>
              <PageImage documentId={record.documentId} page={n} width={p.width} height={p.height} zoom={zoom} px={px}>
                {rooms.filter(r => r.page === n).map(r => (
                  <polygon key={r.name} points={r.outline.map(pt => pt.join(',')).join(' ')}
                    fill="rgba(249,115,22,0.28)" stroke="#ea580c" strokeWidth={stroke} />
                ))}
                {src?.notes.filter(x => x.page === n && x.box).map((x, k) => {
                  const [x0, y0, x1, y1] = x.box!;
                  const pad = stroke * 2;
                  return <rect key={k} x={x0 - pad} y={y0 - pad} width={x1 - x0 + 2 * pad} height={y1 - y0 + 2 * pad}
                    fill="rgba(250,204,21,0.25)" stroke="#ca8a04" strokeWidth={stroke} rx={stroke} />;
                })}
              </PageImage>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

const iconBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280',
};
