'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Upload, Plus, Trash2, CheckCircle2, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import api from '@/lib/api';
import type { BOQItem } from '@/types/boq';
import type { PoParseResult, ProjectDocument } from '@/types/document';
import type { ImportPurchaseOrderRequest, PurchaseOrder } from '@/types/purchaseOrder';
import { inp, lbl } from './MeasurementsAndMaterialPlan/styles';

// POs made before the project was entered in ConstructIQ (an ongoing project
// brought in mid-way). Built for batches — a project can have 30+ POs, one per
// supplier and order date, many of them scanned JPGs. Files are read one at a
// time (so 30 scans don't hit the server at once), listed in one summary
// table with a status each, reviewed row by row, and saved as IMP-001… with
// the paper PO's own number kept. See PurchaseOrdersController.Import.

interface LineDraft {
  key: number;
  name: string;
  qty: string;
  unit: string;
  unitPrice: string;
  materialId?: number;
  // '' = not in the Material Plan.
  boqItemId: number | '';
  // Qty × price didn't match the line's printed total (OCR misread or a
  // crossed-out line). Cleared once the line is edited or confirmed.
  flagged?: boolean;
}

interface PoDraft {
  key: number;
  documentId?: number;
  fileName?: string;
  originalPoNumber: string;
  supplierName: string;
  orderDate: string;
  delivered: boolean;
  expectedDate: string;
  lines: LineDraft[];
  saving: boolean;
  savedNumber?: string;
  // The file was uploaded but nothing could be read from it.
  unread?: boolean;
}

type Status = { label: 'Saved' | 'Duplicate' | 'Check' | 'Ready'; reason?: string };

let nextKey = 1;
const blankLine = (): LineDraft => ({ key: nextKey++, name: '', qty: '', unit: '', unitPrice: '', boqItemId: '' });
const blankDraft = (): PoDraft => ({
  key: nextKey++, originalPoNumber: '', supplierName: '', orderDate: '', delivered: true, expectedDate: '',
  lines: [blankLine()], saving: false,
});

const ACCEPT = '.pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png,image/jpeg,image/png';
const unitKey = (u?: string | null) => (u ?? '').trim().toLowerCase().replace(/\.$/, '').replace(/s$/, '');
const dateOnly = (d?: string | null) => (d ? d.split('T')[0] : '');
const poKey = (supplier: string, number: string) => `${supplier.trim().toLowerCase()}|${number.trim().toLowerCase()}`;
const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function errorMessage(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
}

// The Material Plan row a scanned line most likely belongs to: same material
// in the same purchase unit, else the same material, else the same name.
function suggestRow(rows: BOQItem[], materialId: number | undefined, name: string, unit: string): number | '' {
  const sameMaterial = rows.filter(r => (materialId != null && r.materialId === materialId)
    || r.materialName.trim().toLowerCase() === name.trim().toLowerCase());
  const sameUnit = sameMaterial.find(r => unitKey(r.estimatedPurchaseUnit ?? r.unit) === unitKey(unit));
  return (sameUnit ?? sameMaterial[0])?.id ?? '';
}

function lineProblem(l: LineDraft): string | null {
  if (!l.name.trim()) return 'Every material needs a name.';
  const qty = Number(l.qty);
  if (!l.qty.trim() || !Number.isFinite(qty) || qty <= 0) return `${l.name}: enter a quantity above zero.`;
  if (!l.unit.trim()) return `${l.name}: enter the unit.`;
  if (l.unitPrice.trim() && !(Number(l.unitPrice) >= 0)) return `${l.name}: the price must be a number, zero or more.`;
  return null;
}

function draftProblem(d: PoDraft): string | null {
  if (!d.supplierName.trim()) return 'Enter the supplier.';
  if (!d.orderDate) return 'Enter the PO date.';
  if (!d.delivered && !d.expectedDate) return 'Enter the expected delivery date, or mark it delivered.';
  if (d.lines.length === 0) return 'Add at least one material.';
  for (const l of d.lines) {
    const p = lineProblem(l);
    if (p) return p;
  }
  return null;
}

const draftTotal = (d: PoDraft) => d.lines.reduce((sum, l) => {
  const qty = Number(l.qty);
  const price = Number(l.unitPrice);
  return l.unitPrice.trim() && Number.isFinite(qty) && Number.isFinite(price) ? sum + qty * price : sum;
}, 0);

const STATUS_STYLE: Record<Status['label'], { bg: string; color: string }> = {
  Saved:     { bg: '#dcfce7', color: '#166534' },
  Ready:     { bg: '#dbeafe', color: '#1e40af' },
  Check:     { bg: '#fef3c7', color: '#92400e' },
  Duplicate: { bg: '#fee2e2', color: '#991b1b' },
};

export default function ImportPurchaseOrders({ projectId, onImported }: {
  projectId: number;
  // Called after each PO is saved, so the host can refresh its PO list.
  onImported?: (po: PurchaseOrder) => void;
}) {
  const [rows, setRows] = useState<BOQItem[]>([]);
  const [drafts, setDrafts] = useState<PoDraft[]>([]);
  // supplier|original PO number of POs already imported into this project.
  const [existing, setExisting] = useState<Set<string>>(new Set());
  // PO files already in the project's documents that no imported PO uses
  // yet — e.g. uploaded before the page was reloaded — readable again
  // without uploading them twice.
  const [unimportedDocs, setUnimportedDocs] = useState<ProjectDocument[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<BOQItem[]>(`/boq/project/${projectId}`)
      .then(({ data }) => setRows(data))
      .catch(() => setRows([]));
    Promise.all([
      api.get<PurchaseOrder[]>('/purchase-orders', { params: { projectId } }),
      api.get<ProjectDocument[]>(`/documents/project/${projectId}`),
    ]).then(([{ data: pos }, { data: docs }]) => {
      setExisting(new Set(pos
        .filter(p => p.isImported && p.originalPoNumber)
        .map(p => poKey(p.supplierName, p.originalPoNumber!))));
      const used = new Set(pos.map(p => p.poFileUrl).filter(Boolean));
      setUnimportedDocs(docs.filter(d => d.category === 'PurchaseOrder' && !used.has(d.url)));
    }).catch(() => { setExisting(new Set()); setUnimportedDocs([]); });
  }, [projectId]);

  function updateDraft(key: number, patch: (d: PoDraft) => PoDraft) {
    setDrafts(prev => prev.map(d => (d.key === key ? patch(d) : d)));
  }
  function updateLine(draftKey: number, lineKey: number, patch: Partial<LineDraft>) {
    updateDraft(draftKey, d => ({ ...d, lines: d.lines.map(l => (l.key === lineKey ? { ...l, ...patch } : l)) }));
  }

  function statusOf(d: PoDraft, index: number): Status {
    if (d.savedNumber) return { label: 'Saved' };
    if (d.originalPoNumber.trim() && d.supplierName.trim()) {
      const key = poKey(d.supplierName, d.originalPoNumber);
      if (existing.has(key)) return { label: 'Duplicate', reason: 'Already imported into this project.' };
      if (drafts.some((o, i) => i < index && poKey(o.supplierName, o.originalPoNumber) === key))
        return { label: 'Duplicate', reason: 'The same PO is listed above.' };
    }
    if (d.unread) return { label: 'Check', reason: "Couldn't read this file — type the details in." };
    const problem = draftProblem(d);
    if (problem) return { label: 'Check', reason: problem };
    const flagged = d.lines.filter(l => l.flagged).length;
    if (flagged > 0) return { label: 'Check', reason: `${flagged} line${flagged === 1 ? '' : 's'} to confirm — qty × price doesn't match the PO's total.` };
    return { label: 'Ready' };
  }

  // One file = one PO. Uploaded to the project's documents, then scanned;
  // a scan that reads nothing still leaves a draft to fill in by hand.
  async function scanFile(file: File): Promise<PoDraft | null> {
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('projectId', String(projectId));
      form.append('category', 'PurchaseOrder');
      const { data: doc } = await api.post<ProjectDocument>('/documents/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      return readDocument(doc.id, file.name);
    } catch (error) {
      toast.error(errorMessage(error, `Failed to upload ${file.name}.`));
      return null;
    }
  }

  async function readDocument(documentId: number, fileName: string): Promise<PoDraft> {
    const draft: PoDraft = { ...blankDraft(), fileName, documentId };
    try {
      const { data: result } = await api.post<PoParseResult>(`/documents/${draft.documentId}/parse-po`);
      if (result.items.length > 0) {
        const first = result.items.find(i => i.supplierName) ?? result.items[0];
        draft.supplierName = first.supplierName ?? '';
        draft.orderDate = dateOnly(result.items.find(i => i.orderDate)?.orderDate);
        draft.expectedDate = dateOnly(result.items.find(i => i.promisedDeliveryDate)?.promisedDeliveryDate);
        draft.originalPoNumber = result.items.find(i => i.poNumber)?.poNumber ?? '';
        draft.lines = result.items.map(i => ({
          key: nextKey++,
          name: i.materialName,
          qty: String(i.actualQuantityOrdered),
          unit: i.unit,
          unitPrice: i.unitPrice != null ? String(i.unitPrice) : '',
          materialId: i.matchedMaterialId,
          boqItemId: suggestRow(rows, i.matchedMaterialId, i.materialName, i.unit),
          flagged: !!i.totalMismatch,
        }));
      } else {
        draft.unread = true;
      }
    } catch {
      draft.unread = true;
    }
    return draft;
  }

  // Read one after another, each added to the table as soon as it's done.
  async function readAll<T>(items: T[], read: (item: T) => Promise<PoDraft | null>) {
    if (items.length === 0) return;
    setProgress({ done: 0, total: items.length });
    let unread = 0;
    for (const [i, item] of items.entries()) {
      const draft = await read(item);
      if (draft) {
        if (draft.unread) unread++;
        setDrafts(prev => [...prev, draft]);
      }
      setProgress({ done: i + 1, total: items.length });
    }
    setProgress(null);
    toast.success(`Read ${items.length} file${items.length === 1 ? '' : 's'} — check each PO, then save.`);
    if (unread > 0) toast.error(`${unread} file${unread === 1 ? '' : 's'} couldn't be read — type ${unread === 1 ? 'it' : 'them'} in.`);
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    void readAll(files, scanFile);
  }

  const loadedDocIds = new Set(drafts.map(d => d.documentId));
  const docsToRead = unimportedDocs.filter(d => !loadedDocIds.has(d.id));

  async function save(d: PoDraft, quiet = false): Promise<boolean> {
    const problem = draftProblem(d);
    if (problem) { if (!quiet) toast.error(problem); return false; }
    updateDraft(d.key, x => ({ ...x, saving: true }));
    try {
      const payload: ImportPurchaseOrderRequest = {
        projectId,
        supplierName: d.supplierName.trim(),
        originalPoNumber: d.originalPoNumber.trim() || undefined,
        orderDate: d.orderDate,
        expectedDate: d.delivered ? undefined : d.expectedDate,
        delivered: d.delivered,
        documentId: d.documentId,
        materials: d.lines.map(l => ({
          name: l.name.trim(),
          quantity: Number(l.qty),
          unit: l.unit.trim(),
          unitPrice: l.unitPrice.trim() ? Number(l.unitPrice) : null,
          boqItemId: l.boqItemId === '' ? undefined : l.boqItemId,
          // A Material Plan link supplies the material on the server.
          materialId: l.boqItemId === '' ? l.materialId : undefined,
        })),
      };
      const { data } = await api.post<PurchaseOrder>('/purchase-orders/import', payload);
      updateDraft(d.key, x => ({ ...x, saving: false, savedNumber: data.number }));
      if (d.originalPoNumber.trim()) setExisting(prev => new Set(prev).add(poKey(d.supplierName, d.originalPoNumber)));
      if (!quiet) toast.success(`Imported as ${data.number}.`);
      if (expanded === d.key) setExpanded(null);
      onImported?.(data);
      return true;
    } catch (error) {
      updateDraft(d.key, x => ({ ...x, saving: false }));
      toast.error(errorMessage(error, `Failed to import ${d.originalPoNumber || d.fileName || 'the PO'}.`));
      return false;
    }
  }

  const statuses = drafts.map((d, i) => statusOf(d, i));
  const ready = drafts.filter((_, i) => statuses[i].label === 'Ready');
  const counts = statuses.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.label]: (acc[s.label] ?? 0) + 1 }), {});

  async function saveAllReady() {
    setSavingAll(true);
    let saved = 0;
    for (const d of ready) if (await save(d, true)) saved++;
    setSavingAll(false);
    toast.success(`Imported ${saved} PO${saved === 1 ? '' : 's'}.`);
  }

  const cell: React.CSSProperties = { padding: '6px 6px', verticalAlign: 'top' };
  const field: React.CSSProperties = { ...inp, padding: '7px 9px', fontSize: '0.8rem' };
  const th: React.CSSProperties = { padding: '6px', fontSize: '0.62rem', fontWeight: 700, color: '#6b7280', textAlign: 'left', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '8px 6px', fontSize: '0.78rem', color: '#111827', borderTop: '1px solid #f3f4f6', verticalAlign: 'middle' };
  const btn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' };
  const busy = progress !== null || savingAll;

  function editor(d: PoDraft) {
    return (
      <div style={{ border: '1px solid #fed7aa', borderRadius: 10, padding: '0.9rem 1rem', background: '#fffbf5' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem', marginBottom: '0.75rem' }}>
          <div>
            <label style={lbl}>Original PO No.</label>
            <input style={field} value={d.originalPoNumber} placeholder="As written on the PO"
              onChange={e => updateDraft(d.key, x => ({ ...x, originalPoNumber: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Supplier *</label>
            <input style={field} value={d.supplierName}
              onChange={e => updateDraft(d.key, x => ({ ...x, supplierName: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>PO date *</label>
            <input style={field} type="date" value={d.orderDate}
              onChange={e => updateDraft(d.key, x => ({ ...x, orderDate: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Delivery</label>
            <select style={field} value={d.delivered ? 'yes' : 'no'}
              onChange={e => updateDraft(d.key, x => ({ ...x, delivered: e.target.value === 'yes' }))}>
              <option value="yes">Delivered (all arrived)</option>
              <option value="no">Not yet / partly delivered</option>
            </select>
          </div>
          {!d.delivered && (
            <div>
              <label style={lbl}>Expected delivery *</label>
              <input style={field} type="date" value={d.expectedDate}
                onChange={e => updateDraft(d.key, x => ({ ...x, expectedDate: e.target.value }))} />
            </div>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={th}>MATERIAL (AS ON THE PO)</th>
                <th style={th}>QTY</th>
                <th style={th}>UNIT</th>
                <th style={th}>UNIT PRICE (₱)</th>
                <th style={th}>MATERIAL PLAN ROW</th>
                <th style={th} aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {d.lines.map(l => (
                <Fragment key={l.key}>
                  <tr style={{ background: l.flagged ? '#fef3c7' : undefined }}>
                    <td style={{ ...cell, minWidth: 200 }}>
                      <input style={field} value={l.name} onChange={e => updateLine(d.key, l.key, { name: e.target.value, materialId: undefined, flagged: false })} />
                    </td>
                    <td style={{ ...cell, width: 90 }}>
                      <input style={field} type="number" min="0" inputMode="decimal" value={l.qty} onChange={e => updateLine(d.key, l.key, { qty: e.target.value, flagged: false })} />
                    </td>
                    <td style={{ ...cell, width: 90 }}>
                      <input style={field} value={l.unit} onChange={e => updateLine(d.key, l.key, { unit: e.target.value })} />
                    </td>
                    <td style={{ ...cell, width: 120 }}>
                      <input style={field} type="number" min="0" step="0.01" inputMode="decimal" value={l.unitPrice} placeholder="Optional"
                        onChange={e => updateLine(d.key, l.key, { unitPrice: e.target.value, flagged: false })} />
                    </td>
                    <td style={{ ...cell, minWidth: 220 }}>
                      <select style={field} value={l.boqItemId}
                        onChange={e => updateLine(d.key, l.key, { boqItemId: e.target.value === '' ? '' : Number(e.target.value) })}>
                        <option value="">Not in the Material Plan</option>
                        {rows.map(r => (
                          <option key={r.id} value={r.id}>
                            {r.materialName}{r.specification ? ` — ${r.specification}` : ''} ({r.estimatedPurchaseUnit ?? r.unit})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ ...cell, width: 32 }}>
                      <button type="button" aria-label="Remove material" onClick={() => updateDraft(d.key, x => ({ ...x, lines: x.lines.filter(y => y.key !== l.key) }))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', padding: 6 }}>
                        <Trash2 style={{ width: 13, height: 13 }} />
                      </button>
                    </td>
                  </tr>
                  {l.flagged && (
                    <tr style={{ background: '#fef3c7' }}>
                      <td colSpan={6} style={{ padding: '0 8px 8px', fontSize: '0.7rem', color: '#92400e' }}>
                        Qty × price doesn&apos;t match this line&apos;s total on the PO — the scan may have misread it, or the line is crossed out.
                        Fix it, delete it, or{' '}
                        <button type="button" onClick={() => updateLine(d.key, l.key, { flagged: false })}
                          style={{ background: 'none', border: 'none', padding: 0, color: '#c2410c', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', fontSize: '0.7rem' }}>
                          it&apos;s correct
                        </button>.
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.6rem', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => updateDraft(d.key, x => ({ ...x, lines: [...x.lines, blankLine()] }))}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f97316', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Plus style={{ width: 13, height: 13 }} /> Add material
          </button>
          <button type="button" onClick={() => save(d)} disabled={d.saving || busy}
            style={{ ...btn, border: 'none', background: '#111827', color: '#fff', opacity: d.saving || busy ? 0.7 : 1 }}>
            {d.saving ? 'Saving…' : 'Save this PO'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: 10, padding: '0.75rem 1rem', fontSize: '0.78rem', color: '#4b5563', lineHeight: 1.5 }}>
        Add the purchase orders made <b>before this project was added to ConstructIQ</b>. Select all the PO files at once — PDF, Excel, or
        scanned <b>JPG/PNG</b> — and each is read automatically, or type one in. Check each PO in the table, then save.
        Each keeps its original PO number and is saved as <b>IMP-001, IMP-002…</b>; imported POs count as <b>already ordered</b> in the
        Material Plan and the cost estimate. Mark a PO <b>Delivered</b> if everything on it has arrived.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
          style={{ ...btn, border: 'none', background: '#f97316', color: '#fff', opacity: busy ? 0.7 : 1 }}>
          <Upload style={{ width: 14, height: 14 }} />
          {progress ? `Reading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : 'Upload PO files'}
        </button>
        <button type="button" onClick={() => { const d = blankDraft(); setDrafts(prev => [...prev, d]); setExpanded(d.key); }} disabled={busy}
          style={{ ...btn, border: '1px solid #e5e7eb', background: '#fff', color: '#374151' }}>
          <Plus style={{ width: 14, height: 14 }} /> Type in a PO
        </button>
        <input ref={fileRef} type="file" multiple accept={ACCEPT} onChange={handleFiles} style={{ display: 'none' }} />
        {docsToRead.length > 0 && (
          <button type="button" disabled={busy} onClick={() => void readAll(docsToRead, d => readDocument(d.id, d.fileName))}
            title="PO files already uploaded to this project but not imported yet — read them again without uploading"
            style={{ ...btn, border: '1px solid #fed7aa', background: '#fff7ed', color: '#c2410c', opacity: busy ? 0.7 : 1 }}>
            <FileText style={{ width: 14, height: 14 }} /> Read uploaded PO files ({docsToRead.length})
          </button>
        )}
        {drafts.some(d => !d.savedNumber) && (
          <button type="button" onClick={saveAllReady} disabled={busy || ready.length === 0}
            title={ready.length === 0 ? 'Fix the POs marked Check first — open a row to see what it needs' : undefined}
            style={{ ...btn, border: 'none', marginLeft: 'auto',
              background: ready.length > 0 ? '#111827' : '#e5e7eb', color: ready.length > 0 ? '#fff' : '#6b7280',
              cursor: ready.length > 0 ? 'pointer' : 'default', opacity: busy ? 0.7 : 1 }}>
            {savingAll ? 'Saving…' : `Save all ready (${ready.length})`}
          </button>
        )}
      </div>

      {drafts.length > 0 && (
        <>
          <p style={{ fontSize: '0.72rem', color: '#6b7280' }}>
            {drafts.length} PO{drafts.length === 1 ? '' : 's'}
            {(['Ready', 'Check', 'Duplicate', 'Saved'] as const).filter(s => counts[s]).map(s => ` · ${counts[s]} ${s.toLowerCase()}`).join('')}
            {' '}— click a row to review it. &quot;Save all ready&quot; saves every <b>Ready</b> PO; one PO can also be saved from its row.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
              <thead>
                <tr>
                  <th style={th} aria-label="Expand" />
                  <th style={th}>FILE</th>
                  <th style={th}>ORIGINAL PO NO.</th>
                  <th style={th}>SUPPLIER</th>
                  <th style={th}>PO DATE</th>
                  <th style={{ ...th, textAlign: 'right' }}>MATERIALS</th>
                  <th style={{ ...th, textAlign: 'right' }}>TOTAL</th>
                  <th style={th}>STATUS</th>
                  <th style={th} aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {drafts.map((d, i) => {
                  const status = statuses[i];
                  const open = expanded === d.key && !d.savedNumber;
                  const total = draftTotal(d);
                  const unpriced = d.lines.filter(l => !l.unitPrice.trim()).length;
                  return (
                    <Fragment key={d.key}>
                      <tr onClick={() => !d.savedNumber && setExpanded(open ? null : d.key)}
                        style={{ cursor: d.savedNumber ? 'default' : 'pointer', background: open ? '#fff7ed' : undefined }}>
                        <td style={{ ...td, width: 24, color: '#9ca3af' }}>
                          {d.savedNumber ? <CheckCircle2 style={{ width: 14, height: 14, color: '#16a34a' }} />
                            : open ? <ChevronDown style={{ width: 14, height: 14 }} /> : <ChevronRight style={{ width: 14, height: 14 }} />}
                        </td>
                        <td style={{ ...td, maxWidth: 200 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.fileName}>
                            <FileText style={{ width: 13, height: 13, flexShrink: 0, color: '#9ca3af' }} />
                            {d.fileName ?? 'Typed in'}
                          </span>
                        </td>
                        <td style={td}>{d.savedNumber ? <><b>{d.savedNumber}</b>{d.originalPoNumber && ` · ${d.originalPoNumber}`}</> : d.originalPoNumber || '—'}</td>
                        <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.supplierName}>{d.supplierName || '—'}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{d.orderDate || '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{d.lines.length}</td>
                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {total > 0 ? peso(total) : '—'}
                          {unpriced > 0 && total > 0 && <span style={{ display: 'block', fontSize: '0.62rem', color: '#b45309' }}>{unpriced} without price</span>}
                        </td>
                        <td style={td}>
                          <span title={status.reason}
                            style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: '0.66rem', fontWeight: 700, ...STATUS_STYLE[status.label] }}>
                            {status.label}
                          </span>
                          {status.reason && <span style={{ display: 'block', fontSize: '0.62rem', color: '#6b7280', marginTop: 2, maxWidth: 220 }}>{status.reason}</span>}
                        </td>
                        <td style={{ ...td, width: 32 }}>
                          {!d.savedNumber && (
                            <button type="button" aria-label="Remove this PO" disabled={busy}
                              onClick={e => { e.stopPropagation(); setDrafts(prev => prev.filter(x => x.key !== d.key)); }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 4 }}>
                              <Trash2 style={{ width: 14, height: 14 }} />
                            </button>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={9} style={{ padding: '4px 0 12px' }}>{editor(d)}</td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
