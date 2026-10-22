'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import type { BOQItemRow } from '@/types/boq';

// Rows from a scanned BOQ whose section the blueprint already filled. None
// are added unless ticked — see lib/boqSections.ts for why.

interface Props {
  rows: BOQItemRow[];
  onAdd: (rows: BOQItemRow[]) => void;
  onClose: () => void;
}

const btn = (primary = false): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 8, border: primary ? 'none' : '1px solid #e5e7eb', cursor: 'pointer',
  background: primary ? '#f97316' : '#fff', color: primary ? '#fff' : '#374151', fontSize: '0.8rem', fontWeight: 600,
});
const th: React.CSSProperties = { textAlign: 'left', fontSize: '0.62rem', color: '#9ca3af', fontWeight: 700, padding: '6px 6px', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '5px 6px', fontSize: '0.76rem', color: '#374151', verticalAlign: 'top' };

export default function ScanCoveredDialog({ rows, onAdd, onClose }: Props) {
  const [picked, setPicked] = useState<boolean[]>(() => rows.map(() => false));
  const chosen = rows.filter((_, i) => picked[i]);
  const sections = [...new Set(rows.map(r => r.primarySection))].join(', ');

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Already covered by blueprint"
        style={{ background: '#fff', borderRadius: 16, width: 'min(820px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <p style={{ fontWeight: 800, color: '#111827' }}>Already covered by blueprint</p>
            <p style={{ fontSize: '0.74rem', color: '#6b7280', marginTop: 4, lineHeight: 1.5 }}>
              The blueprint already filled <b>{sections}</b>, so these {rows.length} row(s) from the BOQ were not added — the same
              work would be counted twice. Tick any the blueprint missed.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', alignSelf: 'flex-start' }}><X style={{ width: 18, height: 18 }} /></button>
        </div>

        <div style={{ padding: '0.5rem 1.25rem', overflow: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={th}>
                  <input type="checkbox" aria-label="Tick all" checked={chosen.length === rows.length}
                    onChange={e => setPicked(rows.map(() => e.target.checked))} />
                </th>
                {['Work item', 'Description', 'Unit', 'Qty'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={td}>
                    <input type="checkbox" checked={picked[i]} aria-label={`Add ${r.specification || r.newMaterialName}`}
                      onChange={e => setPicked(prev => prev.map((p, j) => (j === i ? e.target.checked : p)))} />
                  </td>
                  <td style={{ ...td, color: '#6b7280' }}>{r.subCategory || '—'}</td>
                  <td style={td}>{r.specification || r.newMaterialName}</td>
                  <td style={td}>{r.unit || '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.estimatedQuantity ? r.estimatedQuantity.toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button onClick={onClose} style={btn()}>Skip these</button>
          <button disabled={chosen.length === 0} onClick={() => onAdd(chosen)} style={{ ...btn(true), opacity: chosen.length ? 1 : 0.5 }}>
            Add {chosen.length || ''} selected
          </button>
        </div>
      </div>
    </div>
  );
}
