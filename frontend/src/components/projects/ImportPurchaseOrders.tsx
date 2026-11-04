'use client';

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Upload, Plus, Trash2, CheckCircle2, FileText } from 'lucide-react';
import api from '@/lib/api';
import type { BOQItem } from '@/types/boq';
import type { PoParseResult, ProjectDocument } from '@/types/document';
import type { ImportPurchaseOrderRequest, PurchaseOrder } from '@/types/purchaseOrder';
import { inp, lbl } from './MeasurementsAndMaterialPlan/styles';

// POs made before the project was entered in ConstructIQ (an ongoing project
// brought in mid-way). Each one is scanned from its file or typed in,
// reviewed, linked to its Material Plan rows, and saved as IMP-001… — the
// paper PO's own number is kept. See PurchaseOrdersController.Import.

interface LineDraft {
  key: number;
  name: string;
  qty: string;
  unit: string;
  unitPrice: string;
  materialId?: number;
  // '' = not in the Material Plan.
  boqItemId: number | '';
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
}

let nextKey = 1;
const blankLine = (): LineDraft => ({ key: nextKey++, name: '', qty: '', unit: '', unitPrice: '', boqItemId: '' });
const blankDraft = (): PoDraft => ({
  key: nextKey++, originalPoNumber: '', supplierName: '', orderDate: '', delivered: true, expectedDate: '',
  lines: [blankLine()], saving: false,
});

const unitKey = (u?: string | null) => (u ?? '').trim().toLowerCase().replace(/\.$/, '').replace(/s$/, '');
const dateOnly = (d?: string | null) => (d ? d.split('T')[0] : '');

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

export default function ImportPurchaseOrders({ projectId, onImported }: {
  projectId: number;
  // Called after each PO is saved, so the host can refresh its PO list.
  onImported?: (po: PurchaseOrder) => void;
}) {
  const [rows, setRows] = useState<BOQItem[]>([]);
  const [drafts, setDrafts] = useState<PoDraft[]>([]);
  const [scanning, setScanning] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<BOQItem[]>(`/boq/project/${projectId}`)
      .then(({ data }) => setRows(data))
      .catch(() => setRows([]));
  }, [projectId]);

  function updateDraft(key: number, patch: (d: PoDraft) => PoDraft) {
    setDrafts(prev => prev.map(d => (d.key === key ? patch(d) : d)));
  }
  function updateLine(draftKey: number, lineKey: number, patch: Partial<LineDraft>) {
    updateDraft(draftKey, d => ({ ...d, lines: d.lines.map(l => (l.key === lineKey ? { ...l, ...patch } : l)) }));
  }

  // One file = one PO. Uploaded to the project's documents, then scanned;
  // a scan that reads nothing still leaves a draft to fill in by hand.
  async function scanFile(file: File) {
    setScanning(n => n + 1);
    const draft = { ...blankDraft(), fileName: file.name };
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('projectId', String(projectId));
      form.append('category', 'PurchaseOrder');
      const { data: doc } = await api.post<ProjectDocument>('/documents/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      draft.documentId = doc.id;
      try {
        const { data: result } = await api.post<PoParseResult>(`/documents/${doc.id}/parse-po`);
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
          }));
          toast.success(`${file.name}: ${result.items.length} material(s) read — check them before saving.`);
        } else {
          toast.error(`${file.name}: couldn't read the materials — please type them in.`);
        }
      } catch {
        toast.error(`${file.name}: couldn't scan it — please type the details in.`);
      }
      setDrafts(prev => [...prev, draft]);
    } catch (error) {
      toast.error(errorMessage(error, `Failed to upload ${file.name}.`));
    } finally {
      setScanning(n => n - 1);
    }
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    Array.from(e.target.files ?? []).forEach(scanFile);
    e.target.value = '';
  }

  async function save(d: PoDraft) {
    const problem = draftProblem(d);
    if (problem) { toast.error(problem); return; }
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
      toast.success(`Imported as ${data.number}.`);
      onImported?.(data);
    } catch (error) {
      updateDraft(d.key, x => ({ ...x, saving: false }));
      toast.error(errorMessage(error, 'Failed to import the PO.'));
    }
  }

  const cell: React.CSSProperties = { padding: '6px 6px', verticalAlign: 'top' };
  const field: React.CSSProperties = { ...inp, padding: '7px 9px', fontSize: '0.8rem' };
  const th: React.CSSProperties = { padding: '6px', fontSize: '0.62rem', fontWeight: 700, color: '#6b7280', textAlign: 'left', whiteSpace: 'nowrap' };
  const btn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' };
  const savedCount = drafts.filter(d => d.savedNumber).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: 10, padding: '0.75rem 1rem', fontSize: '0.78rem', color: '#4b5563', lineHeight: 1.5 }}>
        Add the purchase orders made <b>before this project was added to ConstructIQ</b>. Upload each PO file (it&apos;s read automatically) or type it in.
        Each one keeps its original PO number and is saved as <b>IMP-001, IMP-002…</b> — the system&apos;s own PO-001 numbers stay for orders made here.
        Imported POs count as <b>already ordered</b> in the Material Plan and the cost estimate.
        Mark a PO <b>Delivered</b> if everything on it has arrived; otherwise it&apos;s received in Procurement like any other PO.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={scanning > 0}
          style={{ ...btn, border: 'none', background: '#f97316', color: '#fff', opacity: scanning > 0 ? 0.7 : 1 }}>
          <Upload style={{ width: 14, height: 14 }} /> {scanning > 0 ? 'Reading…' : 'Upload PO files'}
        </button>
        <button type="button" onClick={() => setDrafts(prev => [...prev, blankDraft()])}
          style={{ ...btn, border: '1px solid #e5e7eb', background: '#fff', color: '#374151' }}>
          <Plus style={{ width: 14, height: 14 }} /> Type in a PO
        </button>
        <input ref={fileRef} type="file" multiple accept=".pdf,.xlsx,.xls,.csv" onChange={handleFiles} style={{ display: 'none' }} />
        {savedCount > 0 && <span style={{ alignSelf: 'center', fontSize: '0.75rem', color: '#15803d', fontWeight: 600 }}>{savedCount} imported</span>}
      </div>

      {drafts.map(d => d.savedNumber ? (
        <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: 10, padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#166534' }}>
          <CheckCircle2 style={{ width: 16, height: 16, flexShrink: 0 }} />
          <span>
            <b>{d.savedNumber}</b> · {d.supplierName}{d.originalPoNumber && <> · original PO {d.originalPoNumber}</>} · {d.lines.length} material{d.lines.length === 1 ? '' : 's'} · {d.delivered ? 'Delivered' : 'Awaiting delivery'}
          </span>
        </div>
      ) : (
        <div key={d.key} style={{ border: '1px solid #fed7aa', borderRadius: 10, padding: '0.9rem 1rem', background: '#fffbf5' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', gap: 8 }}>
            <p style={{ fontWeight: 700, fontSize: '0.82rem', color: '#c2410c', display: 'flex', alignItems: 'center', gap: 6 }}>
              {d.fileName ? <><FileText style={{ width: 14, height: 14 }} /> {d.fileName}</> : 'Purchase order'}
            </p>
            <button type="button" onClick={() => setDrafts(prev => prev.filter(x => x.key !== d.key))} aria-label="Remove this PO"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}>
              <Trash2 style={{ width: 15, height: 15 }} />
            </button>
          </div>

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
                  <tr key={l.key}>
                    <td style={{ ...cell, minWidth: 200 }}>
                      <input style={field} value={l.name} onChange={e => updateLine(d.key, l.key, { name: e.target.value, materialId: undefined })} />
                    </td>
                    <td style={{ ...cell, width: 90 }}>
                      <input style={field} type="number" min="0" inputMode="decimal" value={l.qty} onChange={e => updateLine(d.key, l.key, { qty: e.target.value })} />
                    </td>
                    <td style={{ ...cell, width: 90 }}>
                      <input style={field} value={l.unit} onChange={e => updateLine(d.key, l.key, { unit: e.target.value })} />
                    </td>
                    <td style={{ ...cell, width: 120 }}>
                      <input style={field} type="number" min="0" step="0.01" inputMode="decimal" value={l.unitPrice} placeholder="Optional"
                        onChange={e => updateLine(d.key, l.key, { unitPrice: e.target.value })} />
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
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.6rem', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => updateDraft(d.key, x => ({ ...x, lines: [...x.lines, blankLine()] }))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f97316', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Plus style={{ width: 13, height: 13 }} /> Add material
            </button>
            <button type="button" onClick={() => save(d)} disabled={d.saving}
              style={{ ...btn, border: 'none', background: '#111827', color: '#fff', opacity: d.saving ? 0.7 : 1 }}>
              {d.saving ? 'Saving…' : 'Save this PO'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
