'use client';

import { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Upload, FileText, Trash2, Plus, ShoppingCart, Package, ExternalLink, X } from 'lucide-react';
import { getApiOrigin } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { Project, ProjectType } from '@/types/project';
import type { ProjectDocument } from '@/types/document';
import type { InventoryRecord } from '@/types/inventory';
import type { ForecastedMaterial } from '@/types/forecast';
import type { BOQItem, BOQItemRow } from '@/types/boq';
import { PRIMARY_SECTIONS, PURCHASE_UNITS } from '@/types/boq';
import type { PurchaseOrder, PurchaseOrderMaterial } from '@/types/purchaseOrder';
import { inp, sel, lbl } from './styles';

interface Props {
  project: Project;
  editable: boolean;
  projectType: ProjectType;
  otherTypeSpecify: string;
  inventory: InventoryRecord[];
  forecastedMaterials: ForecastedMaterial[];
  boqDocs: ProjectDocument[];
  uploading: boolean;
  onUploadBoq: (file: File) => void;
  onParseBoq: (documentId: number) => Promise<void>;
  rows: BOQItemRow[];
  boqItems: BOQItem[];
  // Also accepts a React-style updater fn — needed by the historical-estimate
  // auto-suggest effect below, which resolves after a delay and must apply
  // its patch to whatever the rows array is *then*, not the stale snapshot
  // it closed over when the lookup started.
  onRowsChange: (rows: BOQItemRow[] | ((prev: BOQItemRow[]) => BOQItemRow[])) => void;
  // Accepts an explicit rows array so a partial-request split (which computes
  // a freshly-updated array in the same tick) can save it immediately without
  // depending on this row state having propagated up first.
  onSave: (overrideRows?: BOQItemRow[], opts?: { silent?: boolean }) => Promise<void>;
  saving: boolean;
  onNotify: (kind: 'ProcurementOrder' | 'WarehouseCheck', materialId: number | undefined, materialName: string, quantity: number, unit: string) => Promise<boolean>;
  onRemoveDocument: (documentId: number) => void;
  onRunForecast: () => void;
  forecasting: boolean;
  // Purchase Orders — actuals, paired against the BOQ estimates above.
  purchaseOrders: PurchaseOrder[];
  poDocs: ProjectDocument[];
  uploadingPo: boolean;
  savingPo: boolean;
  onUploadPO: (file: File) => void;
  onParsePO: (documentId: number) => Promise<void>;
  onSavePO: () => void;
  onLinkPoMaterial: (materialId: number, boqItemId: number | null) => void;
  poDraftRows: PurchaseOrderMaterial[];
  onPoDraftRowsChange: (rows: PurchaseOrderMaterial[]) => void;
  poSupplierName: string;
  onPoSupplierNameChange: (v: string) => void;
  poOrderDate: string;
  onPoOrderDateChange: (v: string) => void;
  poExpectedDate: string;
  onPoExpectedDateChange: (v: string) => void;
}

export default function MaterialPlanTab({
  project, editable, projectType, otherTypeSpecify,
  inventory, forecastedMaterials, boqDocs, uploading, onUploadBoq, onParseBoq,
  rows, boqItems, onRowsChange, onSave, saving, onNotify, onRemoveDocument, onRunForecast, forecasting,
  purchaseOrders, poDocs, uploadingPo, savingPo, onUploadPO, onParsePO, onSavePO, onLinkPoMaterial,
  poDraftRows, onPoDraftRowsChange, poSupplierName, onPoSupplierNameChange,
  poOrderDate, onPoOrderDateChange, poExpectedDate, onPoExpectedDateChange,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const poFileInputRef = useRef<HTMLInputElement>(null);
  const [parsingPoId, setParsingPoId] = useState<number | null>(null);
  // Partial-quantity request dialog — clicking a row's Notify Procurement/
  // Warehouse button opens this instead of firing the request immediately,
  // so the user can request less than the full Est. Qty (e.g. only what's
  // actually in stock) and have the leftover spun off into its own row.
  const [requestPrompt, setRequestPrompt] = useState<{
    index: number; kind: 'ProcurementOrder' | 'WarehouseCheck'; max: number; unit: string; materialName: string;
  } | null>(null);
  const [requestPromptQty, setRequestPromptQty] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const isCompleted = project.status === 'Completed';
  const isHistorical = project.isHistorical;
  // Flat structure — same Primary/Sub Primary Section + Material Specification
  // + Unit + Total Qty columns as the historical BOQ table, plus Actual Qty
  // (completed projects), a purchase-unit + Est. Qty pair (procurement
  // prediction, auto-suggested from historical BOQ+PO data), and Alerts
  // (purchase/warehouse request actions, not applicable to historical data).
  // No Phase column.
  // Alerts is a fixed, content-sized width (just enough for its 3 icons)
  // rather than a flexible fr column — a flexible share there left visible
  // dead space between the icons and the row's right edge; Material
  // Specification's own flexible share absorbs whatever that frees up.
  const columnsTemplate = isCompleted
    ? 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.5fr) minmax(0,0.5fr) minmax(0,0.7fr) minmax(0,0.7fr) minmax(0,0.5fr) minmax(0,0.7fr) 96px'
    : 'minmax(0,1.1fr) minmax(0,1.1fr) minmax(0,1.6fr) minmax(0,0.55fr) minmax(0,0.75fr) minmax(0,0.55fr) minmax(0,0.75fr) 96px';
  const [parsingId, setParsingId] = useState<number | null>(null);

  const timeRange = `${formatDate(project.startDate)} – ${formatDate(project.targetEndDate)}`;
  const typeLabel = projectType === 'Others' && otherTypeSpecify ? `Others — ${otherTypeSpecify}` : projectType;

  function updateRow(idx: number, patch: Partial<BOQItemRow>) {
    onRowsChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeRow(idx: number) {
    onRowsChange(rows.filter((_, i) => i !== idx));
  }

  // Confirms the partial-quantity dialog: sends the real request for exactly
  // what the user typed, then ADDS it to this row's running requestedQuantity
  // (never overwrites — several partial clicks across Procurement/Warehouse
  // all accumulate against the same original Est. Qty). The row itself is
  // never split or shrunk: its Est. Qty stays the fixed original ask, and it
  // only flips to "Done" once the running total actually reaches it. Saved
  // immediately (not left as a local draft) — the real request behind it
  // already happened for real, so leaving this un-persisted would silently
  // lose the running total the moment this modal is reopened before a
  // manual Save.
  async function handleConfirmRequest() {
    if (!requestPrompt) return;
    const { index, max, unit } = requestPrompt;
    const qty = parseFloat(requestPromptQty);
    if (!qty || qty <= 0) { toast.error('Enter a quantity greater than zero.'); return; }
    // Hard cap: Quantity to request <= Net Left to Order, always — the
    // action buttons stay clickable even once a row is fully covered (so
    // they're never hidden/swapped for a badge), but the modal never lets
    // the actual request exceed what's really still needed.
    if (qty > max) { toast.error(`Cannot request more than ${max.toLocaleString()} ${unit} — that's all this row still needs.`); return; }

    const row = rows[index];
    setSubmittingRequest(true);
    try {
      const ok = await onNotify(requestPrompt.kind, row.materialId, requestPrompt.materialName, qty, unit);
      if (!ok) return;

      const totalRequested = (row.requestedQuantity ?? 0) + qty;
      const newRows = rows.slice();
      newRows[index] = { ...row, requestedQuantity: totalRequested };

      onRowsChange(newRows);
      try {
        await onSave(newRows, { silent: true });
        const remainder = (row.estimatedPurchaseQuantity ?? 0) - totalRequested;
        toast.success(remainder > 0
          ? `Requested ${qty.toLocaleString()} ${unit}. ${remainder.toLocaleString()} ${unit} still remaining.`
          : `Requested ${qty.toLocaleString()} ${unit}. Fully covered.`);
      } catch {
        toast.error('Request sent, but saving the updated Bill of Quantities failed — click Save Material Plan to retry.');
      }
      setRequestPrompt(null);
      setRequestPromptQty('');
    } finally {
      setSubmittingRequest(false);
    }
  }

  function addBlankRow() {
    // Leave primarySection blank rather than silently defaulting to the first
    // option — the user picks it via the same datalist input every row already
    // has, instead of it being pre-filled without any real choice being made.
    onRowsChange([...rows, { primarySection: '', estimatedQuantity: 0 }]);
  }

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files) Array.from(files).forEach(f => onUploadBoq(f));
    e.target.value = '';
  }

  async function handleParseClick(doc: ProjectDocument) {
    setParsingId(doc.id);
    try {
      await onParseBoq(doc.id);
    } finally {
      setParsingId(null);
    }
  }

  function handlePoFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files) Array.from(files).forEach(f => onUploadPO(f));
    e.target.value = '';
  }

  async function handleParsePoClick(doc: ProjectDocument) {
    setParsingPoId(doc.id);
    try {
      await onParsePO(doc.id);
    } finally {
      setParsingPoId(null);
    }
  }

  function updatePoDraftRow(idx: number, patch: Partial<PurchaseOrderMaterial>) {
    onPoDraftRowsChange(poDraftRows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removePoDraftRow(idx: number) {
    onPoDraftRowsChange(poDraftRows.filter((_, i) => i !== idx));
  }

  function addBlankPoDraftRow() {
    onPoDraftRowsChange([...poDraftRows, { name: '', quantity: 0, unit: '' }]);
  }

  // Only real, already-saved BOQ rows (with a DB id) are linkable.
  const linkableBoqRows = rows.filter(r => r.id != null);

  // BOQ (planned) vs. linked PO (actual) reconciliation — only meaningful once
  // a project is Completed and both sides have real, saved data with explicit
  // links between them (see onLinkPoMaterial).
  const reconciliation = useMemo(() => {
    const actualByBoqItemId = new Map<number, number>();
    const unlinked: { po: PurchaseOrder; material: PurchaseOrderMaterial }[] = [];
    purchaseOrders.forEach(po => {
      po.materials.forEach(m => {
        if (m.boqItemId) {
          actualByBoqItemId.set(m.boqItemId, (actualByBoqItemId.get(m.boqItemId) ?? 0) + m.quantity);
        } else {
          unlinked.push({ po, material: m });
        }
      });
    });
    return { actualByBoqItemId, unlinked };
  }, [purchaseOrders]);

  const historicalPurchaseRows = useMemo(
    () => rows.flatMap(row => row.historicalSupply ?? []),
    [rows],
  );

  // Same ranking, but over every saved BOQ row (not just the single top one) —
  // feeds the historical-only "Materials by Demand" list below.
  const rowsByDemand = useMemo(() => {
    if (!isHistorical) return [];
    const effectiveQty = (r: BOQItemRow) => ((r.actualQuantity ?? 0) > 0 ? (r.actualQuantity as number) : r.estimatedQuantity);
    return linkableBoqRows.slice().sort((a, b) => effectiveQty(b) - effectiveQty(a));
  }, [isHistorical, linkableBoqRows]);

  // Totals by unit — rows mix incompatible units (sq.m, pc, l.m, set...), so a
  // single blind sum across all of them would be meaningless. The source
  // file itself has no total row at all; this is purely computed for display.
  const totalsByUnit = useMemo(() => {
    const est = new Map<string, number>();
    const actual = new Map<string, number>();
    rows.forEach(r => {
      const unit = r.unit?.trim() || '—';
      est.set(unit, (est.get(unit) ?? 0) + (r.estimatedQuantity || 0));
      if (isCompleted) actual.set(unit, (actual.get(unit) ?? 0) + (r.actualQuantity || 0));
    });
    return { est, actual };
  }, [rows, isCompleted]);

  // A newly-scanned material has no InventoryRecord yet (that only exists
  // once stock is actually recorded), so inventory alone can't name it —
  // boqItems already carries the real Material.Name resolved server-side.
  const materialNameById = useMemo(() => {
    const map = new Map<number, string>();
    boqItems.forEach(b => map.set(b.materialId, b.materialName));
    inventory.forEach(i => { if (!map.has(i.materialId)) map.set(i.materialId, i.materialName); });
    return map;
  }, [boqItems, inventory]);

  function materialLabel(r: BOQItemRow): string {
    if (r.materialId) {
      // Prefer the resolved catalog name (present once this row has been
      // saved and refetched); until then, the scanned name is the only
      // thing we actually know about this material — show that instead of
      // a meaningless "Material #N".
      return materialNameById.get(r.materialId) ?? r.newMaterialName ?? `Material #${r.materialId}`;
    }
    return r.newMaterialName ?? '(unnamed)';
  }

  function currentStock(r: BOQItemRow): number {
    if (!r.materialId) return 0;
    return inventory.find(i => i.materialId === r.materialId)?.availableQuantity ?? 0;
  }

  return (
    <div>
      <datalist id="primary-section-options">
        {PRIMARY_SECTIONS.map(s => <option key={s} value={s} />)}
      </datalist>

      {requestPrompt && (
        <div onClick={() => !submittingRequest && setRequestPrompt(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: '1.5rem', width: 380, boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
            <p style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 4 }}>
              {requestPrompt.kind === 'ProcurementOrder' ? 'Notify Procurement' : 'Notify Warehouse'}
            </p>
            <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '1rem' }}>{requestPrompt.materialName}</p>
            <label style={{ ...lbl, fontSize: '0.68rem' }}>Quantity to request (up to {requestPrompt.max.toLocaleString()} {requestPrompt.unit})</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4, marginBottom: '1.25rem' }}>
              <input
                type="number"
                autoFocus
                value={requestPromptQty}
                onChange={e => setRequestPromptQty(e.target.value)}
                style={{ ...inp, flex: 1 }}
              />
              <span style={{ ...inp, flex: '0 0 auto', width: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', color: '#6b7280' }}>{requestPrompt.unit}</span>
            </div>
            <p style={{ fontSize: '0.68rem', color: '#9ca3af', marginBottom: '1rem' }}>
              Requesting less than the full amount splits the remainder into a new row below, ready for its own request.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setRequestPrompt(null)} disabled={submittingRequest} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleConfirmRequest} disabled={submittingRequest} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', opacity: submittingRequest ? 0.7 : 1 }}>
                {submittingRequest ? 'Sending…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
        <div>
          <label style={lbl}>Project Type</label>
          <input disabled value={typeLabel} style={{ ...inp, background: '#f9fafb', color: '#6b7280' }} />
        </div>
        <div>
          <label style={lbl}>Time Range</label>
          <input disabled value={timeRange} style={{ ...inp, background: '#f9fafb', color: '#6b7280' }} />
        </div>
      </div>

      {isCompleted && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '0.625rem 0.875rem', marginBottom: '1rem', fontSize: '0.72rem', color: '#9a3412' }}>
          {isHistorical
            // Historical backfills have no live Excess/Waste trail to derive
            // usage from (nothing was ever logged against something that
            // already happened) — typing the real figure here is the only
            // genuine source, so this is the one place manual entry is correct.
            ? <>This is a historical project — fill in <strong>Actual Qty</strong> per material below from your real records. This is what trains the forecasting model on real usage.</>
            // Live projects derive this automatically from logged Excess/Waste
            // against each line — no manual entry. A line with nothing ever
            // logged against it shows its estimate instead, marked "inferred"
            // rather than presented as a confirmed figure.
            : <>Actual Qty below is calculated automatically from logged Excess/Waste per material. Rows marked <strong>inferred</strong> have nothing logged yet, so they show the estimate instead of a confirmed figure.</>}
        </div>
      )}

      {/* Forecasted Material Demand — completed, non-historical projects only;
          ongoing projects only get the summary label on the project card, not
          this full breakdown. Historical projects get "Materials by Demand"
          below instead (ranked by real recorded usage, not a forecast — a
          finished historical project has nothing left to forecast). */}
      {isCompleted && !isHistorical && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', marginBottom: '1rem' }}>
          <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid #e5e7eb' }}>
            <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>Forecasted Material Demand</p>
            <p style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: 2 }}>AI-predicted demand from the latest forecast run on this project.</p>
          </div>
          {forecastedMaterials.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: '#d1d5db', padding: '1rem' }}>No forecast has been run yet — click Run Forecast below.</p>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,0.8fr) minmax(0,0.8fr) minmax(0,0.8fr) minmax(0,0.7fr)', gap: 4, padding: '0.5rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                {['MATERIAL', 'FORECASTED QTY', 'CURRENT STOCK', 'SHORTAGE', 'RISK'].map(h => (
                  <span key={h} style={{ fontSize: '0.6rem', color: '#9ca3af', fontWeight: 700 }}>{h}</span>
                ))}
              </div>
              {/* key includes unit, not just materialId — the same material
                  can now appear twice in one forecast (once per distinct
                  unit actually forecasted; see ForecastedMaterial.Unit on
                  the backend), which would otherwise collide on a bare
                  materialId key. */}
              {forecastedMaterials.map(fm => (
                <div key={`${fm.materialId}-${fm.unit}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,0.8fr) minmax(0,0.8fr) minmax(0,0.8fr) minmax(0,0.7fr)', gap: 4, padding: '7px 1rem', borderBottom: '1px solid #f9fafb', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.76rem', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fm.materialName}</span>
                  <span style={{ fontSize: '0.76rem', color: '#374151' }}>{fm.forecastedQuantity.toLocaleString()} {fm.unit}</span>
                  <span style={{ fontSize: '0.76rem', color: '#6b7280' }}>{fm.currentStock.toLocaleString()} {fm.unit}</span>
                  <span style={{ fontSize: '0.76rem', color: fm.shortage > 0 ? '#ef4444' : '#6b7280' }}>{fm.shortage > 0 ? fm.shortage.toLocaleString() : '—'}</span>
                  <span style={{
                    fontSize: '0.62rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, width: 'fit-content',
                    background: fm.riskLevel === 'Critical' ? '#fee2e2' : fm.riskLevel === 'High' ? '#ffedd5' : fm.riskLevel === 'Medium' ? '#fef3c7' : '#dcfce7',
                    color: fm.riskLevel === 'Critical' ? '#b91c1c' : fm.riskLevel === 'High' ? '#c2410c' : fm.riskLevel === 'Medium' ? '#92400e' : '#15803d',
                  }}>{fm.riskLevel}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}


      {/* Bill of Quantities */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1rem', borderBottom: '1px solid #e5e7eb' }}>
          <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>{isHistorical ? 'Bill of Quantities and Purchased Orders Summary' : 'Bill of Quantities'}</p>
          {editable && (
            <button onClick={() => fileInputRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}>
              <Upload style={{ width: 12, height: 12 }} /> {uploading ? 'Uploading…' : 'Upload BOQ'}
            </button>
          )}
          <input ref={fileInputRef} type="file" multiple accept=".pdf,.xlsx,.xls,.csv" onChange={handleFilePicked} style={{ display: 'none' }} />
        </div>

        {boqDocs.length > 0 && (
          <div style={{ padding: '0.625rem 1rem', borderBottom: '1px solid #f3f4f6', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {boqDocs.map(doc => (
              <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText style={{ width: 12, height: 12, color: '#9ca3af', flexShrink: 0 }} />
                <a href={`${getApiOrigin()}${doc.url}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.fileName}
                </a>
                <ExternalLink style={{ width: 10, height: 10, color: '#9ca3af', flexShrink: 0 }} />
                {editable && (
                  <button onClick={() => handleParseClick(doc)} disabled={parsingId === doc.id} style={{ fontSize: '0.68rem', fontWeight: 600, color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {parsingId === doc.id ? 'Scanning…' : 'Scan & Fill Rows'}
                  </button>
                )}
                {editable && (
                  <button onClick={() => onRemoveDocument(doc.id)} title="Remove file" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2, flexShrink: 0 }}>
                    <X style={{ width: 12, height: 12 }} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {isHistorical && (
          <div style={{ display: 'grid', gap: '1.25rem', padding: '1rem' }}>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1rem', background: '#eff6ff', borderBottom: '1px solid #dbeafe' }}>
                <p style={{ fontWeight: 700, fontSize: '0.82rem', color: '#1d4ed8' }}>Bill of Quantities (BOQ)</p>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 760 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 2fr 0.7fr 1fr', gap: 8, padding: '0.55rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    {['PRIMARY SECTION', 'SUB PRIMARY SECTION', 'MATERIAL SPECIFICATION', 'UNIT', 'TOTAL AREA / QUANTITY'].map(h => <span key={h} style={{ fontSize: '0.6rem', color: '#9ca3af', fontWeight: 700 }}>{h}</span>)}
                  </div>
                  {rows.length === 0 ? <p style={{ padding: '1rem', fontSize: '0.78rem', color: '#9ca3af' }}>No BOQ rows extracted yet.</p> : rows.map((row, index) => (
                    <div key={`${row.id ?? 'new'}-${index}`} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 2fr 0.7fr 1fr', gap: 8, padding: '0.7rem 1rem', borderBottom: '1px solid #f3f4f6', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.76rem', color: '#374151' }}>{row.primarySection || '—'}</span>
                      <span style={{ fontSize: '0.76rem', color: '#374151' }}>{row.subCategory || '—'}</span>
                      <span style={{ fontSize: '0.76rem', color: '#111827' }}>{row.specification || materialLabel(row)}</span>
                      <span style={{ fontSize: '0.76rem', color: '#6b7280' }}>{row.unit || '—'}</span>
                      <span style={{ fontSize: '0.76rem', color: '#111827' }}>{row.estimatedQuantity.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1rem', background: '#fff7ed', borderBottom: '1px solid #fed7aa' }}>
                <p style={{ fontWeight: 700, fontSize: '0.82rem', color: '#c2410c' }}>Purchased Order (PO)</p>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 760 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 0.7fr 1fr 1.8fr', gap: 8, padding: '0.55rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    {['PO NUMBER', 'MATERIAL NAME', 'UNIT', 'QUANTITY', 'SUPPLIER'].map(h => <span key={h} style={{ fontSize: '0.6rem', color: '#9ca3af', fontWeight: 700 }}>{h}</span>)}
                  </div>
                  {historicalPurchaseRows.length === 0 ? <p style={{ padding: '1rem', fontSize: '0.78rem', color: '#9ca3af' }}>No purchased-order rows extracted yet.</p> : historicalPurchaseRows.map((row, index) => (
                    <div key={`${row.poNumber ?? 'po'}-${index}`} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 0.7fr 1fr 1.8fr', gap: 8, padding: '0.7rem 1rem', borderBottom: '1px solid #f3f4f6', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.76rem', color: '#374151' }}>{row.poNumber || '—'}</span>
                      <span style={{ fontSize: '0.76rem', color: '#111827' }}>{row.materialName}</span>
                      <span style={{ fontSize: '0.76rem', color: '#6b7280' }}>{row.unit || '—'}</span>
                      <span style={{ fontSize: '0.76rem', color: '#111827' }}>{row.quantity.toLocaleString()}</span>
                      <span style={{ fontSize: '0.76rem', color: '#374151' }}>{row.supplierName || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: isHistorical ? 'none' : 'block', overflowX: 'auto' }}>
        <div style={{ minWidth: 980 }}>
        <div style={{ display: 'grid', gridTemplateColumns: columnsTemplate, gap: 4, padding: '0.5rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
          {(isCompleted
            ? ['PRIMARY SECTION', 'SUB PRIMARY SECTION', 'MATERIAL SPECIFICATION', 'UNIT', 'TOTAL AREA/QTY', 'ACTUAL QTY', 'UNIT', 'EST. QTY', 'ALERTS']
            : ['PRIMARY SECTION', 'SUB PRIMARY SECTION', 'MATERIAL SPECIFICATION', 'UNIT', 'TOTAL AREA/QTY', 'UNIT', 'EST. QTY', 'ALERTS']
          ).map((h, idx) => (
            <span key={`${h}-${idx}`} style={{ fontSize: '0.6rem', color: '#9ca3af', fontWeight: 700 }}>{h}</span>
          ))}
        </div>

        {/* scrollbarGutter reserves the scrollbar's own width up front, so
            rows never shift a few pixels narrower than the (never-scrolled)
            header once enough rows appear to need a scrollbar. */}
        <div style={{ maxHeight: 320, overflowY: 'auto', scrollbarGutter: 'stable' }}>
          {rows.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: '#d1d5db', padding: '1rem' }}>No materials added yet.</p>
          ) : (
            rows.map((r, i) => {
              const stock = currentStock(r);
              // Alerts/requests operate on the purchase-container Est. Qty/Unit
              // (the columns actually meant for procurement/inventory action),
              // not the raw BOQ Total Area/Qty measurement (sq.m/l.m/...) —
              // matches what the receiving Inventory/Procurement pages show.
              // Deliberately NOT falling back to r.estimatedQuantity when
              // blank — Est. Qty only exists once Run Forecast has filled it
              // in (or the user set it manually), and until then there is no
              // real purchase target to alert against at all.
              const hasPurchaseEstimate = r.estimatedPurchaseQuantity != null;
              const purchaseQty = r.estimatedPurchaseQuantity ?? 0;
              const purchaseUnit = r.estimatedPurchaseUnit ?? r.unit ?? '';
              // Net Left to Order — server-computed: Est. Qty minus whatever
              // has actually been APPROVED so far (an approved redistribution
              // transfer, an approved warehouse release, or a purchase order
              // past Pending). A still-Pending request never moves this
              // number — see ProcurementCapCalculator. Falls back to the full
              // Est. Qty until the row has been saved at least once (nothing
              // server-computed to read yet).
              const netLeftToOrder = hasPurchaseEstimate ? (r.netLeftToOrder ?? purchaseQty) : 0;
              const toOrder = hasPurchaseEstimate ? Math.max(0, netLeftToOrder - stock) : 0;
              // The real cap Notify Procurement/Warehouse will enforce
              // server-side — unlike netLeftToOrder above, this also
              // subtracts every MaterialRequest already submitted for this
              // material (fulfilled or not), so it can be LOWER even when
              // nothing's been approved yet (e.g. a request for the full
              // amount is already sent and awaiting a PO). Both dialogs below
              // must cap at this, or they invite a quantity the backend then
              // rejects. See ProcurementCapCalculator.GetRemainingRequestableAsync.
              const remainingRequestable = hasPurchaseEstimate ? (r.remainingRequestable ?? netLeftToOrder) : 0;
              const needsAlert = hasPurchaseEstimate && toOrder > 0;
              const canRequestBase = editable && !isCompleted && !!r.materialId && hasPurchaseEstimate;
              // Warehouse Check is always the first step; Procurement can't
              // be requested for a row until Warehouse has actually APPROVED
              // a check for it — merely submitting one isn't enough. Neither
              // button is ever disabled just because the estimate's already
              // fully covered — users can still request a buffer amount.
              const canRequestWarehouse = canRequestBase;
              const canRequestProcurement = canRequestBase && !!r.warehouseApproved;
              // The subtext only appears once something's actually been
              // approved against this row (net < the full estimate) — never
              // for a still-Pending request, and never with nothing requested.
              const showLeftToOrder = hasPurchaseEstimate && netLeftToOrder < purchaseQty;
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: columnsTemplate, gap: 4, padding: '8px 1rem', borderBottom: '1px solid #f9fafb', alignItems: 'center', minHeight: 40 }}>
                  {editable ? (
                    <input
                      list="primary-section-options"
                      title="Primary section"
                      value={r.primarySection}
                      onChange={e => updateRow(i, { primarySection: e.target.value })}
                      style={{ ...inp, padding: '4px 6px', fontSize: '0.72rem' }}
                    />
                  ) : (
                    <span style={{ fontSize: '0.76rem', color: '#374151' }}>{r.primarySection || '—'}</span>
                  )}
                  {editable ? (
                    <input
                      title="Sub primary section"
                      value={r.subCategory ?? ''}
                      onChange={e => updateRow(i, { subCategory: e.target.value })}
                      style={{ ...inp, padding: '4px 6px', fontSize: '0.72rem' }}
                    />
                  ) : (
                    <span style={{ fontSize: '0.76rem', color: '#374151' }}>{r.subCategory || '—'}</span>
                  )}
                  {/* A scanned row keeps its own specification/newMaterialName text
                      even once it resolves to a real catalog MaterialId behind the
                      scenes (fuzzy-matched server-side) — show the original BOQ
                      wording, not the catalog's own (possibly differently-worded)
                      name. Only fall back to the catalog name for rows with no
                      scanned text at all (added directly from Stock on Hand). */}
                  {r.materialId && !r.specification && !r.newMaterialName ? (
                    <span style={{ fontSize: '0.78rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{materialLabel(r)}</span>
                  ) : (
                    <input disabled={!editable} value={r.specification || r.newMaterialName || ''} onChange={e => updateRow(i, { newMaterialName: e.target.value })} placeholder="Material specification" style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem' }} />
                  )}
                  <input disabled={!editable} value={r.unit ?? ''} onChange={e => updateRow(i, { unit: e.target.value })} placeholder="unit" style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem' }} />
                  <input disabled={!editable} type="number" value={r.estimatedQuantity || ''} onChange={e => updateRow(i, { estimatedQuantity: parseFloat(e.target.value) || 0 })} style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem' }} />
                  {isCompleted && isHistorical && (
                    // The one legitimate manual-entry path — a historical
                    // backfill has no live Excess/Waste trail to derive this
                    // from, so a real human-typed figure is the only genuine
                    // source. See the banner above and BOQItem.IsUsageConfirmed.
                    <input
                      disabled={!editable}
                      type="number"
                      value={r.actualQuantity || ''}
                      onChange={e => updateRow(i, { actualQuantity: parseFloat(e.target.value) || 0 })}
                      placeholder="Actual used"
                      style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem', background: '#fff7ed', borderColor: '#fed7aa' }}
                    />
                  )}
                  {isCompleted && !isHistorical && (
                    // Read-only — auto-derived from logged Excess/Waste
                    // (ExcessWasteService), never hand-typed for a live
                    // project. "inferred" means nothing has been logged
                    // against this line yet, so the figure shown is just the
                    // estimate, not an observed one.
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '4px 6px' }} title={r.isUsageConfirmed ? 'Calculated from logged Excess/Waste' : 'Nothing logged yet for this line — showing the estimate'}>
                      <span style={{ fontSize: '0.76rem', color: '#374151' }}>{r.actualQuantity || 0}</span>
                      {!r.isUsageConfirmed && (
                        <span style={{ fontSize: '0.6rem', color: '#b45309', fontStyle: 'italic' }}>inferred</span>
                      )}
                    </div>
                  )}
                  <select
                    disabled={!editable}
                    value={r.estimatedPurchaseUnit ?? ''}
                    onChange={e => updateRow(i, { estimatedPurchaseUnit: e.target.value || undefined, estimatePurchaseManuallySet: true })}
                    style={{ ...sel, padding: '4px 4px', fontSize: '0.7rem' }}
                  >
                    <option value="">—</option>
                    {PURCHASE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                  {/* position:relative + the subtext positioned absolute
                      below it keeps this cell's own layout height identical
                      to every other column's — the subtext overlays the
                      row's bottom gap instead of growing the grid row, so
                      showing/hiding it never shifts UNIT/ALERTS in this row
                      or the vertical position of any other row. */}
                  <div style={{ position: 'relative' }}>
                    <input
                      disabled={!editable}
                      type="number"
                      title="Estimated/predicted procurement quantity — auto-suggested from historical data, editable"
                      value={r.estimatedPurchaseQuantity ?? ''}
                      onChange={e => updateRow(i, { estimatedPurchaseQuantity: e.target.value === '' ? undefined : parseFloat(e.target.value) || 0, estimatePurchaseManuallySet: true })}
                      placeholder="Est. qty"
                      style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem' }}
                    />
                    {showLeftToOrder && (
                      <p style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2,
                        fontSize: '0.6rem', color: '#f97316', fontWeight: 600,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {netLeftToOrder.toLocaleString()} left to order
                      </p>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end', paddingRight: 2 }}>
                    {/* Action buttons always stay visible — never swapped for
                        a "Done" badge, even once the estimate is fully
                        covered (though at that point Net Left to Order is 0,
                        so the request dialog's own cap blocks submitting). */}
                    <button
                      disabled={!canRequestProcurement}
                      onClick={() => {
                        const cap = Math.max(0, Math.min(toOrder, remainingRequestable));
                        setRequestPrompt({ index: i, kind: 'ProcurementOrder', max: cap, unit: purchaseUnit, materialName: materialLabel(r) });
                        setRequestPromptQty(cap ? String(cap) : '');
                      }}
                      title={
                        !editable || isCompleted || !r.materialId ? undefined
                          : !hasPurchaseEstimate ? 'Run Forecast first to set an estimated quantity'
                          : !r.warehouseApproved ? 'Procurement unlocks once Warehouse approves a check for this material'
                          : toOrder <= 0 ? 'Nothing left to order — fully covered by approved redistribution/warehouse/PO quantity'
                          : remainingRequestable <= 0 ? 'A request for this material is already pending — wait for it to be fulfilled before asking again'
                          : `Notify procurement — order up to ${Math.min(toOrder, remainingRequestable)} ${purchaseUnit}`
                      }
                      style={{
                        width: 24, height: 24, borderRadius: 6, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: canRequestProcurement ? 'pointer' : 'not-allowed',
                        opacity: canRequestProcurement ? 1 : 0.4,
                        background: needsAlert && canRequestProcurement ? '#fee2e2' : '#f3f4f6',
                      }}
                    >
                      <ShoppingCart style={{ width: 12, height: 12, color: needsAlert && canRequestProcurement ? '#ef4444' : '#9ca3af' }} />
                    </button>
                    <button
                      disabled={!canRequestWarehouse}
                      onClick={() => {
                        const cap = Math.max(0, Math.min(netLeftToOrder, remainingRequestable));
                        setRequestPrompt({ index: i, kind: 'WarehouseCheck', max: cap, unit: purchaseUnit, materialName: materialLabel(r) });
                        setRequestPromptQty(cap ? String(cap) : '');
                      }}
                      title={
                        !editable || isCompleted || !r.materialId ? undefined
                          : !hasPurchaseEstimate ? 'Run Forecast first to set an estimated quantity'
                          : netLeftToOrder <= 0 ? 'Nothing left to order — fully covered by approved redistribution/warehouse/PO quantity'
                          : remainingRequestable <= 0 ? 'A request for this material is already pending — wait for it to be fulfilled before asking again'
                          : `Notify warehouse to check material — up to ${Math.min(netLeftToOrder, remainingRequestable)} ${purchaseUnit}`
                      }
                      style={{
                        width: 24, height: 24, borderRadius: 6, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: canRequestWarehouse ? 'pointer' : 'not-allowed',
                        opacity: canRequestWarehouse ? 1 : 0.4,
                        background: '#f3f4f6',
                      }}
                    >
                      <Package style={{ width: 12, height: 12, color: '#9ca3af' }} />
                    </button>
                    {editable && (
                      <button onClick={() => removeRow(i)} style={{ width: 24, height: 24, borderRadius: 6, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' }}>
                        <Trash2 style={{ width: 12, height: 12, color: '#d1d5db' }} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        </div>
        </div>

        {editable && !isHistorical && (
          <button onClick={addBlankRow} style={{ width: '100%', padding: '8px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.78rem', color: '#f97316', fontWeight: 600, borderTop: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <Plus style={{ width: 13, height: 13 }} /> Add Row
          </button>
        )}

        {rows.length > 0 && !isHistorical && (
          <div style={{ padding: '0.625rem 1rem', borderTop: '1px solid #e5e7eb', background: '#f9fafb' }}>
            <p style={{ fontSize: '0.62rem', fontWeight: 700, color: '#9ca3af', marginBottom: 4 }}>
              TOTAL EST. QTY {isCompleted && '/ ACTUAL QTY'} BY UNIT
              <span style={{ fontWeight: 400, textTransform: 'none' }}> — computed, not from the source file</span>
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem' }}>
              {Array.from(totalsByUnit.est.entries()).map(([unit, sum]) => (
                <span key={unit} style={{ fontSize: '0.76rem', color: '#374151' }}>
                  <strong>{sum.toLocaleString()}</strong> {unit}
                  {isCompleted && <span style={{ color: '#9ca3af' }}> / {(totalsByUnit.actual.get(unit) ?? 0).toLocaleString()} {unit}</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {editable && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '1rem' }}>
          <button onClick={() => onSave()} disabled={saving} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save Material Plan'}
          </button>
          <button
            onClick={() => {
              if (rows.length === 0) { toast.error('Add at least one material first.'); return; }
              onRunForecast();
            }}
            disabled={forecasting}
            style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', opacity: forecasting ? 0.7 : 1 }}
          >
            {forecasting ? 'Forecasting…' : '▶ Run Forecast'}
          </button>
        </div>
      )}

      {/* Purchase Orders — actual ordered quantities, paired against the BOQ
          estimates above. Not applicable to historical projects: they're
          backfilled training data, there's nothing real to order. */}
      {!isHistorical && (
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1rem', borderBottom: '1px solid #e5e7eb' }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>Purchase Orders</p>
            <p style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: 2 }}>What was actually ordered — trains the forecasting model once delivered.</p>
          </div>
          {editable && (
            <button onClick={() => poFileInputRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <Upload style={{ width: 12, height: 12 }} /> {uploadingPo ? 'Uploading…' : 'Upload PO'}
            </button>
          )}
          <input ref={poFileInputRef} type="file" multiple accept=".pdf,.xlsx,.xls,.csv" onChange={handlePoFilePicked} style={{ display: 'none' }} />
        </div>

        {poDocs.length > 0 && (
          <div style={{ padding: '0.625rem 1rem', borderBottom: '1px solid #f3f4f6', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {poDocs.map(doc => (
              <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText style={{ width: 12, height: 12, color: '#9ca3af', flexShrink: 0 }} />
                <a href={`${getApiOrigin()}${doc.url}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.fileName}
                </a>
                <ExternalLink style={{ width: 10, height: 10, color: '#9ca3af', flexShrink: 0 }} />
                {editable && (
                  <button onClick={() => handleParsePoClick(doc)} disabled={parsingPoId === doc.id} style={{ fontSize: '0.68rem', fontWeight: 600, color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {parsingPoId === doc.id ? 'Scanning…' : 'Scan & Fill Rows'}
                  </button>
                )}
                {editable && (
                  <button onClick={() => onRemoveDocument(doc.id)} title="Remove file" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2, flexShrink: 0 }}>
                    <X style={{ width: 12, height: 12 }} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Draft — reviewed rows from a scan (or manually started), not yet saved as a real PO */}
        {editable && (poDraftRows.length > 0 || poSupplierName) && (
          <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid #f3f4f6', background: '#fffbf5' }}>
            <p style={{ fontWeight: 700, fontSize: '0.8rem', color: '#c2410c', marginBottom: '0.625rem' }}>New Purchase Order — review before saving</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr)', gap: 6, marginBottom: '0.75rem' }}>
              <div>
                <label style={{ ...lbl, fontSize: '0.62rem' }}>Supplier</label>
                <input value={poSupplierName} onChange={e => onPoSupplierNameChange(e.target.value)} placeholder="Supplier name" style={{ ...inp, padding: '5px 8px', fontSize: '0.78rem' }} />
              </div>
              <div>
                <label style={{ ...lbl, fontSize: '0.62rem' }}>Order Date</label>
                <input type="date" value={poOrderDate} onChange={e => onPoOrderDateChange(e.target.value)} style={{ ...inp, padding: '5px 8px', fontSize: '0.78rem' }} />
              </div>
              <div>
                <label style={{ ...lbl, fontSize: '0.62rem' }}>Expected Delivery *</label>
                <input type="date" value={poExpectedDate} onChange={e => onPoExpectedDateChange(e.target.value)} style={{ ...inp, padding: '5px 8px', fontSize: '0.78rem' }} />
              </div>
            </div>

            {poDraftRows.map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,0.6fr) minmax(0,0.7fr) auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <input value={r.name} onChange={e => updatePoDraftRow(i, { name: e.target.value })} placeholder="Material name" style={{ ...inp, padding: '5px 8px', fontSize: '0.76rem' }} />
                <input value={r.unit} onChange={e => updatePoDraftRow(i, { unit: e.target.value })} placeholder="unit" style={{ ...inp, padding: '5px 8px', fontSize: '0.76rem' }} />
                <input type="number" step="1" value={r.quantity || ''} onChange={e => updatePoDraftRow(i, { quantity: Math.round(parseFloat(e.target.value)) || 0 })} placeholder="Qty ordered" style={{ ...inp, padding: '5px 8px', fontSize: '0.76rem' }} />
                <button onClick={() => removePoDraftRow(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2 }}>
                  <Trash2 style={{ width: 13, height: 13 }} />
                </button>
              </div>
            ))}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
              <button onClick={addBlankPoDraftRow} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: '#f97316', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer' }}>
                <Plus style={{ width: 12, height: 12 }} /> Add Row
              </button>
              <button onClick={onSavePO} disabled={savingPo} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer', opacity: savingPo ? 0.7 : 1 }}>
                {savingPo ? 'Saving…' : 'Save Purchase Order'}
              </button>
            </div>
          </div>
        )}

        {/* Real, saved purchase orders */}
        <div style={{ maxHeight: 320, overflowY: 'auto', overflowX: 'hidden' }}>
          {purchaseOrders.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: '#d1d5db', padding: '1rem' }}>No purchase orders yet.</p>
          ) : (
            purchaseOrders.map(po => (
              <div key={po.id} style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #f9fafb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.8rem', color: '#111827' }}>{po.number} · {po.supplierName}</span>
                  <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: po.status === 'Delivered' ? '#dcfce7' : '#ffedd5', color: po.status === 'Delivered' ? '#15803d' : '#c2410c' }}>
                    {po.status}
                  </span>
                </div>
                <p style={{ fontSize: '0.65rem', color: '#9ca3af', marginBottom: 6 }}>
                  Ordered {formatDate(po.orderDate)} · Expected {formatDate(po.expectedDate)}
                </p>
                {po.materials.map(m => (
                  <div key={m.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,0.8fr) minmax(0,1fr)', gap: 6, alignItems: 'center', padding: '4px 0' }}>
                    <span style={{ fontSize: '0.76rem', color: '#374151' }}>{m.name}</span>
                    <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>{m.quantity} {m.unit}</span>
                    {editable ? (
                      <select
                        value={m.boqItemId ?? ''}
                        onChange={e => onLinkPoMaterial(m.id!, e.target.value ? Number(e.target.value) : null)}
                        style={{ ...sel, padding: '3px 5px', fontSize: '0.68rem' }}
                      >
                        <option value="">Link to BOQ line…</option>
                        {linkableBoqRows.map(r => <option key={r.id} value={r.id}>{materialLabel(r)}</option>)}
                      </select>
                    ) : (
                      <span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>{m.boqItemId ? 'Linked' : 'Not linked'}</span>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
      )}

      {/* Historical projects have no Purchase Orders to reconcile against (that
          section is hidden for them above) — instead, rank the BOQ itself by
          demand, using the same effective-qty rule as the project card and
          the Forecasted Material Demand panel above. */}
      {isCompleted && isHistorical && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', marginTop: '1.5rem' }}>
          <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid #e5e7eb' }}>
            <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>Materials by Demand</p>
            <p style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: 2 }}>Every material in the uploaded BOQ, ranked by demand/usage (highest first).</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,0.8fr)', gap: 4, padding: '0.5rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            {['MATERIAL', 'QTY', 'UNIT'].map(h => (
              <span key={h} style={{ fontSize: '0.6rem', color: '#9ca3af', fontWeight: 700 }}>{h}</span>
            ))}
          </div>

          {rowsByDemand.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: '#d1d5db', padding: '1rem' }}>Save the Bill of Quantities above first.</p>
          ) : (
            rowsByDemand.map(r => {
              const qty = (r.actualQuantity ?? 0) > 0 ? r.actualQuantity : r.estimatedQuantity;
              return (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,0.8fr)', gap: 4, padding: '7px 1rem', borderBottom: '1px solid #f9fafb', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.76rem', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{materialLabel(r)}</span>
                  <span style={{ fontSize: '0.76rem', fontWeight: 600, color: '#111827' }}>{qty?.toLocaleString()}</span>
                  <span style={{ fontSize: '0.76rem', color: '#6b7280' }}>{r.unit}</span>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* BOQ vs. Purchase Order reconciliation — only meaningful once both BOQ
          (planned) and linked PO (actual) data exist for a real Completed
          project. This is what "Data Review & Verification" means: confirm
          the two sides actually line up per material before the row counts
          as real training data. Not shown for historical projects, which have
          no Purchase Orders section at all (see the ranked list above instead). */}
      {isCompleted && !isHistorical && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', marginTop: '1.5rem' }}>
          <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid #e5e7eb' }}>
            <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>BOQ vs. Purchase Order Reconciliation</p>
            <p style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: 2 }}>Planned (BOQ) vs. actual (linked, delivered POs) per material — this pairing is what feeds ML training.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,0.8fr) minmax(0,0.8fr) minmax(0,0.8fr)', gap: 4, padding: '0.5rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            {['MATERIAL', 'BOQ EST. QTY', 'PO ACTUAL QTY', 'VARIANCE'].map(h => (
              <span key={h} style={{ fontSize: '0.6rem', color: '#9ca3af', fontWeight: 700 }}>{h}</span>
            ))}
          </div>

          {linkableBoqRows.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: '#d1d5db', padding: '1rem' }}>Save the Bill of Quantities above first, then link Purchase Order materials to each line.</p>
          ) : (
            linkableBoqRows.map(r => {
              const actual = reconciliation.actualByBoqItemId.get(r.id!) ?? 0;
              const variance = actual - r.estimatedQuantity;
              return (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,0.8fr) minmax(0,0.8fr) minmax(0,0.8fr)', gap: 4, padding: '7px 1rem', borderBottom: '1px solid #f9fafb', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.76rem', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{materialLabel(r)}</span>
                  <span style={{ fontSize: '0.76rem', color: '#6b7280' }}>{r.estimatedQuantity}</span>
                  <span style={{ fontSize: '0.76rem', color: actual > 0 ? '#111827' : '#d1d5db' }}>{actual > 0 ? actual : '— not linked'}</span>
                  <span style={{ fontSize: '0.76rem', fontWeight: 600, color: variance === 0 ? '#6b7280' : variance > 0 ? '#ef4444' : '#15803d' }}>
                    {actual > 0 ? (variance > 0 ? `+${variance}` : variance) : '—'}
                  </span>
                </div>
              );
            })
          )}

          {reconciliation.unlinked.length > 0 && (
            <div style={{ padding: '0.75rem 1rem', background: '#fffbf5', borderTop: '1px solid #fed7aa' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#c2410c', marginBottom: 4 }}>
                {reconciliation.unlinked.length} PO material(s) not yet linked to a BOQ line — link them above under Purchase Orders so they count toward training.
              </p>
              {reconciliation.unlinked.map(({ po, material }) => (
                <p key={material.id} style={{ fontSize: '0.7rem', color: '#9a3412' }}>
                  {po.number}: {material.name} ({material.quantity} {material.unit})
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
