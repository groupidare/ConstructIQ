'use client';

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { planBulkRequests, type BulkEntry, type BulkRowInput } from '@/lib/bulkRequestPlan';
import type { WarehouseRequest } from '@/types/warehouseRequest';
import type { SentMaterialRequest } from '@/types/materialRequest';
import type { PurchaseOrderStatus } from '@/types/purchaseOrder';
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
  onLoadWarehouseRequests: () => Promise<WarehouseRequest[]>;
  onLoadProcurementRequests: () => Promise<SentMaterialRequest[]>;
  onClose: () => void;
}

const isWarehouse = (e: BulkEntry) => e.group === 'warehouse';
const isProcurement = (e: BulkEntry) => e.group === 'procurement' || e.group === 'afterWarehouse';

interface Section { pick: (e: BulkEntry) => boolean; title: string; hint: string; color: string }

const NEEDS_INPUT: Section = { pick: e => e.group === 'needsInput', title: 'Needs your input', hint: 'Answer these first', color: '#b45309' };

const WAREHOUSE_STEP: Section[] = [
  { pick: isWarehouse, title: 'Warehouse', hint: 'Has stock, so the warehouse is asked first', color: '#2563eb' },
  NEEDS_INPUT,
];

const PROCUREMENT_STEP: Section[] = [
  { pick: e => e.group === 'procurement', title: 'Procurement', hint: 'No stock, so these go straight to purchasing', color: '#dc2626' },
  { pick: e => e.group === 'afterWarehouse', title: 'Ready for Procurement', hint: "The warehouse has answered; this is what's still needed", color: '#c2410c' },
  NEEDS_INPUT,
  { pick: e => e.hiddenBecause === 'waiting', title: 'Waiting for the warehouse', hint: 'These can go to Procurement once the warehouse answers', color: '#6b7280' },
  { pick: isWarehouse, title: 'Not sent to the warehouse', hint: 'Go back to the Warehouse step to send these. They can\'t go to Procurement until the warehouse answers', color: '#6b7280' },
];

const COLUMNS = '20px minmax(0,1fr) 92px 62px';

interface HistoryStatus { label: string; background: string; color: string }

const WAITING: HistoryStatus = { label: 'Waiting', background: '#fef3c7', color: '#b45309' };
const WAREHOUSE_STATUS: Record<WarehouseRequest['status'], HistoryStatus> = {
  Pending: WAITING,
  Approved: { label: 'Approved', background: '#dcfce7', color: '#15803d' },
  Rejected: { label: 'Rejected', background: '#fee2e2', color: '#b91c1c' },
};
const WAITING_FOR_PO: HistoryStatus = { ...WAITING, label: 'Waiting for PO' };
const PO_STATUS: Record<PurchaseOrderStatus, HistoryStatus> = {
  Pending: { ...WAITING, label: 'PO pending approval' },
  Approved: { label: 'PO approved', background: '#dbeafe', color: '#1d4ed8' },
  DeliveryInProgress: { label: 'Delivery in progress', background: '#ffedd5', color: '#c2410c' },
  Delivered: { label: 'Delivered', background: '#dcfce7', color: '#15803d' },
  Cancelled: { label: 'PO cancelled', background: '#fee2e2', color: '#b91c1c' },
};

interface HistoryItem { id: number; name: string; summary: string; status: HistoryStatus; waiting: boolean }

const dated = (at: string, isAdditional?: boolean) => `${new Date(at).toLocaleDateString()}${isAdditional ? ' · Additional' : ''}`;

function warehouseHistory(r: WarehouseRequest, nameOf: (boqItemId?: number | null) => string | undefined): HistoryItem {
  const asked = `${r.requestedQuantity.toLocaleString()} ${r.unit}`;
  const what = r.status === 'Approved' ? `Approved ${(r.approvedQuantity ?? r.requestedQuantity).toLocaleString()} of ${asked}` : `Asked for ${asked}`;
  return {
    id: r.id, name: nameOf(r.boqItemId) ?? r.materialName,
    summary: `${what} · ${dated(r.requestedAt, r.isAdditional)}${r.releaseSources?.length ? ` · Excess from ${r.releaseSources.map(s => `${s.projectName} (${s.quantity.toLocaleString()} ${r.unit})`).join(', ')}` : ''}`,
    status: WAREHOUSE_STATUS[r.status], waiting: r.status === 'Pending',
  };
}

function procurementHistory(r: SentMaterialRequest, nameOf: (boqItemId?: number | null) => string | undefined): HistoryItem {
  return {
    id: r.id, name: nameOf(r.boqItemId) ?? r.materialName,
    summary: `Requested ${r.quantity.toLocaleString()} ${r.unit ?? ''} · ${dated(r.createdAt, r.isAdditional)}${r.poNumber ? ` · ${r.poNumber}` : ''}`,
    status: r.poStatus ? PO_STATUS[r.poStatus] : WAITING_FOR_PO,
    // Still needs someone to act before anything's on its way.
    waiting: !r.poStatus || r.poStatus === 'Pending',
  };
}

// What's already been asked for. Only to read: the warehouse answers in
// Inventory, Procurement makes the POs, and nothing here can be sent again.
function RequestHistory({ title, items, failed }: { title: string; items: HistoryItem[]; failed: boolean }) {
  const [open, setOpen] = useState(false);
  if (failed) return <p style={{ fontSize: '0.68rem', color: '#b45309', marginTop: '0.9rem' }}>The {title.toLowerCase()} couldn&apos;t be loaded.</p>;
  if (items.length === 0) return null;

  const waiting = items.filter(i => i.waiting).length;
  return (
    <section style={{ marginTop: '0.9rem' }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', fontSize: '0.72rem', fontWeight: 700, color: '#374151', cursor: 'pointer', textAlign: 'left' }}>
        <span aria-hidden="true" style={{ color: '#9ca3af' }}>{open ? '▾' : '▸'}</span>
        {title} ({items.length})
        {waiting > 0 && <span style={{ fontWeight: 600, color: '#b45309' }}>· {waiting} waiting</span>}
      </button>
      {open && (
        <div style={{ border: '1px solid #e5e7eb', borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
          {items.map(item => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p title={item.name} style={{ fontSize: '0.76rem', fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</p>
                <p style={{ fontSize: '0.66rem', color: '#6b7280' }}>{item.summary}</p>
              </div>
              <span style={{ flexShrink: 0, padding: '3px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: item.status.background, color: item.status.color }}>{item.status.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function StepLabel({ number, label, count, active, onClick }: { number: number; label: string; count: number; active: boolean; onClick?: () => void }) {
  const style: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: 0, border: 'none', background: 'none', fontSize: '0.72rem', fontWeight: 700, color: active ? '#c2410c' : '#9ca3af', cursor: onClick ? 'pointer' : 'default' };
  const content = (
    <>
      <span style={{ width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.64rem', color: '#fff', background: active ? '#f97316' : '#d1d5db' }}>{number}</span>
      {label} ({count})
    </>
  );
  return onClick ? <button type="button" onClick={onClick} style={style}>{content}</button> : <span style={style} aria-current={active ? 'step' : undefined}>{content}</span>;
}

export default function BulkRequestDialog({ projectName, rows, stockLoaded, onResolveSimilar, onSend, onLoadWarehouseRequests, onLoadProcurementRequests, onClose }: Props) {
  const entries = useMemo(() => planBulkRequests(rows), [rows]);
  // Only what the user changed; everything else follows the plan, so a row that
  // moves between groups (once linked) picks up its new suggestion.
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const [typedQty, setTypedQty] = useState<Record<number, string>>({});
  const [failures, setFailures] = useState<Map<number, string>>(new Map());
  const [sending, setSending] = useState(false);
  const [skippedWarehouse, setSkippedWarehouse] = useState(false);
  const [warehouseRequests, setWarehouseRequests] = useState<WarehouseRequest[]>([]);
  const [warehouseFailed, setWarehouseFailed] = useState(false);
  const [procurementRequests, setProcurementRequests] = useState<SentMaterialRequest[]>([]);
  const [procurementFailed, setProcurementFailed] = useState(false);

  // Each on its own, so one failing still shows the other.
  async function loadRequests() {
    await Promise.all([
      onLoadWarehouseRequests().then(list => { setWarehouseRequests(list); setWarehouseFailed(false); }, () => setWarehouseFailed(true)),
      onLoadProcurementRequests().then(list => { setProcurementRequests(list); setProcurementFailed(false); }, () => setProcurementFailed(true)),
    ]);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadRequests(); }, []);

  const rowName = (boqItemId?: number | null) => rows.find(row => row.id === boqItemId)?.name;

  const warehouseRows = entries.filter(isWarehouse);
  const procurementRows = entries.filter(isProcurement);
  // The step follows the rows, so this reopens wherever things stand: once the
  // warehouse has been asked, its rows are no longer waiting to be sent.
  const onWarehouseStep = warehouseRows.length > 0 && !skippedWarehouse;
  const stepRows = onWarehouseStep ? warehouseRows : procurementRows;
  const sections = onWarehouseStep ? WAREHOUSE_STEP : PROCUREMENT_STEP;

  const qtyOf = (e: BulkEntry) => typedQty[e.row.id] ?? (e.quantity != null ? String(e.quantity) : '');
  const isSendable = (e: BulkEntry) => stepRows.includes(e);
  // A row whose quantity only the user can give starts unticked, until they do.
  const isTicked = (e: BulkEntry) => isSendable(e) && !unticked.has(e.row.id) && parseFloat(qtyOf(e)) > 0;
  const selected = stepRows.filter(isTicked);
  const nothingToShow = !sections.some(s => entries.some(s.pick));

  const done = entries.filter(e => e.hiddenBecause === 'done').length;

  function setTicked(id: number, ticked: boolean) {
    setUnticked(prev => {
      const next = new Set(prev);
      if (ticked) next.delete(id); else next.add(id);
      return next;
    });
  }

  // This step's rows only. A row with no quantity yet can't be ticked either
  // way, so it doesn't count against "all".
  const tickable = stepRows.filter(e => parseFloat(qtyOf(e)) > 0);
  const allTicked = tickable.length > 0 && tickable.every(isTicked);

  function setAllTicked(ticked: boolean) {
    setUnticked(prev => {
      const next = new Set(prev);
      stepRows.forEach(e => { if (ticked) next.delete(e.row.id); else next.add(e.row.id); });
      return next;
    });
  }

  async function handleSend() {
    if (selected.length === 0) { toast.error('Tick at least one material with a quantity.'); return; }
    const kind = onWarehouseStep ? 'warehouse' : 'procurement';
    setSending(true);
    try {
      const result = await onSend(selected.map(e => ({
        kind,
        boqItemId: e.row.id,
        materialId: e.row.materialId,
        quantity: parseFloat(qtyOf(e)),
        unit: e.row.materialUnit ?? '',
      })));
      if (result === null) return;
      setFailures(result);
      if (result.size > 0) {
        await loadRequests();
        toast.error(`${result.size} request${result.size === 1 ? '' : 's'} couldn't be sent. See the rows marked red.`);
      } else if (kind === 'procurement') {
        onClose();
      } else {
        await loadRequests();
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div onClick={() => !sending && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div role="dialog" aria-modal="true" aria-label="Request Materials" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 780, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '1.25rem 1.5rem 0.75rem', borderBottom: '1px solid #f3f4f6' }}>
          <p style={{ fontWeight: 700, fontSize: '1rem' }}>Request Materials</p>
          <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>
            {projectName}. {onWarehouseStep ? 'Ask the warehouse first for what it has in stock.' : "Send what the warehouse can't supply to Procurement."} Check the quantities, untick anything not needed yet, then send.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <StepLabel
              number={1}
              label="Warehouse"
              count={warehouseRows.length}
              active={onWarehouseStep}
              onClick={!onWarehouseStep && warehouseRows.length > 0 ? () => setSkippedWarehouse(false) : undefined}
            />
            <span style={{ flex: '0 0 24px', height: 1, background: '#e5e7eb' }} />
            <StepLabel number={2} label="Procurement" count={procurementRows.length} active={!onWarehouseStep} />
            {tickable.length > 0 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', fontSize: '0.72rem', fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={allTicked}
                  ref={el => { if (el) el.indeterminate = !allTicked && selected.length > 0; }}
                  onChange={ev => setAllTicked(ev.target.checked)}
                />
                Select all ({selected.length}/{tickable.length})
              </label>
            )}
          </div>
          {!stockLoaded && (
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#b45309', marginTop: 6 }}>
              The warehouse&apos;s stock couldn&apos;t be loaded, so nothing can be sorted. Close this and try again.
            </p>
          )}
        </div>

        <div style={{ overflowY: 'auto', padding: '0.5rem 1.5rem 1rem', flex: 1 }}>
          <RequestHistory title="Warehouse requests" items={warehouseRequests.map(r => warehouseHistory(r, rowName))} failed={warehouseFailed} />
          <RequestHistory title="Procurement requests" items={procurementRequests.map(r => procurementHistory(r, rowName))} failed={procurementFailed} />
          {sections.map(section => {
            const list = entries.filter(section.pick);
            if (list.length === 0) return null;
            return (
              <section key={section.title} style={{ marginTop: '0.9rem' }}>
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
          {nothingToShow && (
            <p style={{ textAlign: 'center', fontSize: '0.8rem', color: '#9ca3af', padding: '2rem 0' }}>Nothing left to request.</p>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.875rem 1.5rem', borderTop: '1px solid #f3f4f6' }}>
          <p style={{ fontSize: '0.68rem', color: '#9ca3af', marginRight: 'auto' }}>
            {done ? `${done} already fully requested` : ' '}
          </p>
          <button onClick={onClose} disabled={sending} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
            Close
          </button>
          {/* Only with nothing ticked here: the order can't be skipped by accident.
              A skipped material still can't go to Procurement, only the no-stock ones. */}
          {onWarehouseStep && selected.length === 0 && procurementRows.length > 0 && (
            <button onClick={() => setSkippedWarehouse(true)} disabled={sending} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #fed7aa', background: '#fff7ed', color: '#c2410c', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}>
              Skip to Procurement
            </button>
          )}
          {stepRows.length > 0 && (
            <button onClick={handleSend} disabled={sending || selected.length === 0} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', fontSize: '0.78rem', fontWeight: 700, cursor: sending || selected.length === 0 ? 'not-allowed' : 'pointer', opacity: sending || selected.length === 0 ? 0.6 : 1 }}>
              {sending ? 'Sending…' : `Send ${selected.length} to ${onWarehouseStep ? 'Warehouse' : 'Procurement'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
