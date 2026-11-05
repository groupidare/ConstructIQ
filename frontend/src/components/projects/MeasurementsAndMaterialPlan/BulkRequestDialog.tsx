'use client';

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { planBulkRequests, type BulkEntry, type BulkGroup, type BulkRowInput } from '@/lib/bulkRequestPlan';
import { inp } from './styles';

export interface BulkSendItem {
  kind: 'warehouse' | 'procurement';
  boqItemId: number;
  materialId: number;
  quantity: number;
  unit: string;
}

interface Props {
  projectName: string;
  rows: BulkRowInput[];
  stockLoaded: boolean;
  onResolveSimilar: (rowName: string) => void;
  // The rows that didn't go, and why; null if nothing was sent at all.
  onSend: (items: BulkSendItem[]) => Promise<Map<number, string> | null>;
  onClose: () => void;
}

const SECTIONS: { group: BulkGroup; title: string; hint: string; color: string }[] = [
  { group: 'warehouse', title: 'Warehouse', hint: 'Has stock, so the warehouse is asked first', color: '#2563eb' },
  { group: 'procurement', title: 'Procurement', hint: 'No stock, so these go straight to purchasing', color: '#dc2626' },
  { group: 'afterWarehouse', title: 'Ready for Procurement', hint: "The warehouse has answered; this is what's still needed", color: '#c2410c' },
  { group: 'needsInput', title: 'Needs your input', hint: 'Answer these first', color: '#b45309' },
];

const COLUMNS = '20px minmax(0,1fr) 92px 62px';

export default function BulkRequestDialog({ projectName, rows, stockLoaded, onResolveSimilar, onSend, onClose }: Props) {
  const entries = useMemo(() => planBulkRequests(rows), [rows]);
  // Only what the user changed; everything else follows the plan, so a row that
  // moves between groups (once linked) picks up its new suggestion.
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const [typedQty, setTypedQty] = useState<Record<number, string>>({});
  const [failures, setFailures] = useState<Map<number, string>>(new Map());
  const [sending, setSending] = useState(false);

  const qtyOf = (e: BulkEntry) => typedQty[e.row.id] ?? (e.quantity != null ? String(e.quantity) : '');
  const isSendable = (e: BulkEntry) => e.group === 'warehouse' || e.group === 'procurement' || e.group === 'afterWarehouse';
  // A row whose quantity only the user can give starts unticked, until they do.
  const isTicked = (e: BulkEntry) => isSendable(e) && !unticked.has(e.row.id) && parseFloat(qtyOf(e)) > 0;
  const selected = entries.filter(isTicked);

  const waiting = entries.filter(e => e.hiddenBecause === 'waiting').length;
  const done = entries.filter(e => e.hiddenBecause === 'done').length;

  function setTicked(id: number, ticked: boolean) {
    setUnticked(prev => {
      const next = new Set(prev);
      if (ticked) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSend() {
    if (selected.length === 0) { toast.error('Tick at least one material with a quantity.'); return; }
    setSending(true);
    try {
      const result = await onSend(selected.map(e => ({
        kind: e.group === 'warehouse' ? 'warehouse' : 'procurement',
        boqItemId: e.row.id,
        materialId: e.row.materialId,
        quantity: parseFloat(qtyOf(e)),
        unit: e.row.materialUnit ?? '',
      })));
      if (result === null) return;
      if (result.size === 0) { onClose(); return; }
      setFailures(result);
      toast.error(`${result.size} request${result.size === 1 ? '' : 's'} couldn't be sent. See the rows marked red.`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div onClick={() => !sending && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div role="dialog" aria-modal="true" aria-label="Request Materials" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 780, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '1.25rem 1.5rem 0.75rem', borderBottom: '1px solid #f3f4f6' }}>
          <p style={{ fontWeight: 700, fontSize: '1rem' }}>Request Materials</p>
          <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>{projectName}. Check the quantities, untick anything not needed yet, then send.</p>
          {!stockLoaded && (
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#b45309', marginTop: 6 }}>
              The warehouse&apos;s stock couldn&apos;t be loaded, so nothing can be sorted. Close this and try again.
            </p>
          )}
        </div>

        <div style={{ overflowY: 'auto', padding: '0.5rem 1.5rem 1rem', flex: 1 }}>
          {SECTIONS.map(section => {
            const list = entries.filter(e => e.group === section.group);
            if (list.length === 0) return null;
            return (
              <section key={section.group} style={{ marginTop: '0.9rem' }}>
                <p style={{ fontSize: '0.74rem', fontWeight: 700, color: section.color }}>
                  {section.title} <span style={{ color: '#9ca3af', fontWeight: 600 }}>({list.length})</span>
                </p>
                <p style={{ fontSize: '0.66rem', color: '#9ca3af', marginBottom: 6 }}>{section.hint}</p>
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 8 }}>
                  {list.map(e => (
                    <div key={e.row.id} style={{ padding: '7px 10px', borderBottom: '1px solid #f3f4f6', background: failures.has(e.row.id) ? '#fef2f2' : '#fff' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: COLUMNS, gap: 8, alignItems: 'center' }}>
                        {isSendable(e)
                          ? <input type="checkbox" aria-label={`Include ${e.row.name}`} checked={isTicked(e)} onChange={ev => setTicked(e.row.id, ev.target.checked)} />
                          : <span />}
                        <div style={{ minWidth: 0 }}>
                          <p title={e.row.name} style={{ fontSize: '0.76rem', fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.row.name}</p>
                          {e.note && <p style={{ fontSize: '0.66rem', color: e.group === 'needsInput' ? '#b45309' : '#6b7280' }}>{e.note}</p>}
                        </div>
                        {isSendable(e) ? (
                          <input
                            type="number"
                            min={0}
                            aria-label={`Quantity of ${e.row.name}`}
                            value={qtyOf(e)}
                            onChange={ev => setTypedQty(prev => ({ ...prev, [e.row.id]: ev.target.value }))}
                            style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem' }}
                          />
                        ) : <span />}
                        <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>{isSendable(e) ? e.row.materialUnit : ''}</span>
                      </div>

                      {e.reason === 'similar' && (
                        <div style={{ margin: '6px 0 2px 28px' }}>
                          <button onClick={() => onResolveSimilar(e.row.name)} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #fed7aa', background: '#fff7ed', color: '#c2410c', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>
                            Check if it&apos;s the same material
                          </button>
                        </div>
                      )}
                      {failures.has(e.row.id) && (
                        <p style={{ fontSize: '0.66rem', fontWeight: 600, color: '#b91c1c', margin: '4px 0 0 28px' }}>{failures.get(e.row.id)}</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
          {entries.every(e => e.group === 'hidden') && (
            <p style={{ textAlign: 'center', fontSize: '0.8rem', color: '#9ca3af', padding: '2rem 0' }}>Nothing left to request.</p>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.875rem 1.5rem', borderTop: '1px solid #f3f4f6' }}>
          <p style={{ fontSize: '0.68rem', color: '#9ca3af', marginRight: 'auto' }}>
            {[done ? `${done} already fully requested` : '', waiting ? `${waiting} waiting for the warehouse` : ''].filter(Boolean).join(' · ') || ' '}
          </p>
          <button onClick={onClose} disabled={sending} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSend} disabled={sending || selected.length === 0} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', fontSize: '0.78rem', fontWeight: 700, cursor: sending || selected.length === 0 ? 'not-allowed' : 'pointer', opacity: sending || selected.length === 0 ? 0.6 : 1 }}>
            {sending ? 'Sending…' : `Send ${selected.length} request${selected.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
