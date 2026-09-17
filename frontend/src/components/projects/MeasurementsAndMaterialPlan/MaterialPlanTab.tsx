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
import type { BOQItemRow } from '@/types/boq';
import { PRIMARY_SECTIONS } from '@/types/boq';
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
  onRowsChange: (rows: BOQItemRow[]) => void;
  onSave: () => void;
  saving: boolean;
  onNotify: (kind: 'ProcurementOrder' | 'WarehouseCheck', materialId: number | undefined, materialName: string, quantity: number) => void;
  onRemoveDocument: (documentId: number) => void;
}

export default function MaterialPlanTab({
  project, editable, projectType, otherTypeSpecify,
  inventory, forecastedMaterials, boqDocs, uploading, onUploadBoq, onParseBoq,
  rows, onRowsChange, onSave, saving, onNotify, onRemoveDocument,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phaseChoice, setPhaseChoice] = useState<Record<number, number | ''>>({});
  const isCompleted = project.status === 'Completed';
  const columnsTemplate = isCompleted
    ? 'minmax(0,1.3fr) minmax(0,0.8fr) minmax(0,0.5fr) minmax(0,0.7fr) minmax(0,0.7fr) minmax(0,0.7fr)'
    : 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,0.5fr) minmax(0,0.8fr) minmax(0,0.7fr)';
  const [parsingId, setParsingId] = useState<number | null>(null);

  const timeRange = `${formatDate(project.startDate)} – ${formatDate(project.targetEndDate)}`;
  const typeLabel = projectType === 'Others' && otherTypeSpecify ? `Others — ${otherTypeSpecify}` : projectType;

  const forecastByMaterial = useMemo(() => {
    const map = new Map<number, ForecastedMaterial>();
    forecastedMaterials.forEach(f => map.set(f.materialId, f));
    return map;
  }, [forecastedMaterials]);

  function addRow(materialId: number, materialName: string, unit: string) {
    const phaseId = phaseChoice[materialId];
    if (!phaseId) { toast.error('Choose a phase first.'); return; }
    if (rows.some(r => r.materialId === materialId && r.phaseId === phaseId)) {
      toast.error(`${materialName} is already added to that phase.`);
      return;
    }
    const forecast = forecastByMaterial.get(materialId);
    onRowsChange([
      ...rows,
      {
        phaseId: Number(phaseId),
        primarySection: 'Others',
        materialId,
        unit,
        estimatedQuantity: forecast?.forecastedQuantity ?? 0,
        notes: forecast ? 'Forecasted' : undefined,
      },
    ]);
    toast.success(`${materialName} added.`);
  }

  function updateRow(idx: number, patch: Partial<BOQItemRow>) {
    onRowsChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeRow(idx: number) {
    onRowsChange(rows.filter((_, i) => i !== idx));
  }

  function addBlankRow() {
    onRowsChange([...rows, { primarySection: PRIMARY_SECTIONS[0], estimatedQuantity: 0 }]);
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

  // Group rows by Primary Section → Sub-category for display.
  const grouped = useMemo(() => {
    const bySection = new Map<string, Map<string, { r: BOQItemRow; i: number }[]>>();
    rows.forEach((r, i) => {
      const section = r.primarySection || 'Others';
      const sub = r.subCategory || '—';
      if (!bySection.has(section)) bySection.set(section, new Map());
      const subMap = bySection.get(section)!;
      if (!subMap.has(sub)) subMap.set(sub, []);
      subMap.get(sub)!.push({ r, i });
    });
    return bySection;
  }, [rows]);

  function materialLabel(r: BOQItemRow): string {
    if (r.materialId) {
      const inv = inventory.find(i => i.materialId === r.materialId);
      return inv?.materialName ?? `Material #${r.materialId}`;
    }
    return r.newMaterialName ?? '(unnamed)';
  }

  function currentStock(r: BOQItemRow): number {
    if (!r.materialId) return 0;
    return inventory.find(i => i.materialId === r.materialId)?.availableQuantity ?? 0;
  }

  return (
    <div>
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
          This project is marked Completed — fill in <strong>Actual Qty</strong> per material below. This is what trains the forecasting model on real usage.
        </div>
      )}

      {/* Add from Inventory */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '1rem', marginBottom: '1rem' }}>
        <p style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.25rem' }}>Add from Inventory</p>
        <p style={{ fontSize: '0.68rem', color: '#9ca3af', marginBottom: '0.75rem' }}>Only materials currently in stock — forecasted quantities shown when a forecast has been run.</p>
        <div style={{ maxHeight: 220, overflowY: 'auto', overflowX: 'hidden' }}>
          {inventory.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: '#d1d5db', padding: '0.5rem 0' }}>No in-stock materials available for this project.</p>
          ) : (
            inventory.map(inv => {
              const forecast = forecastByMaterial.get(inv.materialId);
              return (
                <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 4px', borderBottom: '1px solid #f9fafb', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: '0.82rem', fontWeight: 500, color: '#111827' }}>{inv.materialName}</p>
                    <p style={{ fontSize: '0.68rem', color: '#9ca3af' }}>
                      Stock: {inv.availableQuantity.toLocaleString()} {inv.unit}
                      {forecast && <span style={{ color: '#f97316', fontWeight: 600 }}> · Forecasted: {forecast.forecastedQuantity.toLocaleString()} {inv.unit} ({forecast.riskLevel} risk)</span>}
                    </p>
                  </div>
                  {editable && (
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <select
                        value={phaseChoice[inv.materialId] ?? ''}
                        onChange={e => setPhaseChoice(prev => ({ ...prev, [inv.materialId]: e.target.value ? Number(e.target.value) : '' }))}
                        style={{ ...sel, width: 110, padding: '5px 6px', fontSize: '0.72rem' }}
                      >
                        <option value="">Phase…</option>
                        {project.phases.map(ph => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
                      </select>
                      <button onClick={() => addRow(inv.materialId, inv.materialName, inv.unit)} style={{ width: 26, height: 26, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', color: '#f97316', fontSize: '1.1rem', fontWeight: 700 }}>+</button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Bill of Quantities */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1rem', borderBottom: '1px solid #e5e7eb' }}>
          <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>Bill of Quantities</p>
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

        <div style={{ display: 'grid', gridTemplateColumns: columnsTemplate, gap: 4, padding: '0.5rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
          {(isCompleted ? ['MATERIAL', 'UNIT', 'PHASE', 'EST. QTY', 'ACTUAL QTY', 'ALERTS'] : ['MATERIAL', 'UNIT', 'PHASE', 'EST. QTY', 'ALERTS']).map(h => (
            <span key={h} style={{ fontSize: '0.6rem', color: '#9ca3af', fontWeight: 700 }}>{h}</span>
          ))}
        </div>

        <div style={{ maxHeight: 320, overflowY: 'auto', overflowX: 'hidden' }}>
          {rows.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: '#d1d5db', padding: '1rem' }}>No materials added yet.</p>
          ) : (
            Array.from(grouped.entries()).map(([section, subMap]) => (
              <div key={section}>
                <div style={{ padding: '8px 1rem', background: '#eff6ff', borderBottom: '1px solid #dbeafe' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.8rem', color: '#2563eb' }}>{section}</span>
                </div>
                {Array.from(subMap.entries()).map(([sub, entries]) => (
                  <div key={sub}>
                    {sub !== '—' && (
                      <div style={{ padding: '4px 1rem 4px 1.5rem' }}>
                        <span style={{ fontSize: '0.68rem', color: '#9ca3af', fontWeight: 600 }}>{sub}</span>
                      </div>
                    )}
                    {entries.map(({ r, i }) => {
                      const stock = currentStock(r);
                      const toOrder = Math.max(0, r.estimatedQuantity - stock);
                      const needsAlert = toOrder > 0;
                      return (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: columnsTemplate, gap: 4, padding: '8px 1rem', borderBottom: '1px solid #f9fafb', alignItems: 'center' }}>
                          <div>
                            {r.materialId ? (
                              <span style={{ fontSize: '0.78rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{materialLabel(r)}</span>
                            ) : (
                              <input disabled={!editable} value={r.newMaterialName ?? ''} onChange={e => updateRow(i, { newMaterialName: e.target.value })} placeholder="Material name" style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem' }} />
                            )}
                            {editable && (
                              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                                <select value={r.primarySection} onChange={e => updateRow(i, { primarySection: e.target.value })} style={{ ...sel, padding: '2px 4px', fontSize: '0.62rem', width: 'auto' }}>
                                  {PRIMARY_SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <input value={r.subCategory ?? ''} onChange={e => updateRow(i, { subCategory: e.target.value })} placeholder="Sub-category" style={{ ...inp, padding: '2px 4px', fontSize: '0.62rem', width: 90 }} />
                              </div>
                            )}
                          </div>
                          <input disabled={!editable} value={r.unit ?? ''} onChange={e => updateRow(i, { unit: e.target.value })} placeholder="unit" style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem' }} />
                          <select disabled={!editable} value={r.phaseId ?? ''} onChange={e => updateRow(i, { phaseId: e.target.value ? Number(e.target.value) : undefined })} style={{ ...sel, padding: '4px 6px', fontSize: '0.72rem' }}>
                            <option value="">—</option>
                            {project.phases.map(ph => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
                          </select>
                          <input disabled={!editable} type="number" value={r.estimatedQuantity || ''} onChange={e => updateRow(i, { estimatedQuantity: parseFloat(e.target.value) || 0 })} style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem' }} />
                          {isCompleted && (
                            <input
                              disabled={!editable}
                              type="number"
                              value={r.actualQuantity || ''}
                              onChange={e => updateRow(i, { actualQuantity: parseFloat(e.target.value) || 0 })}
                              placeholder="Actual used"
                              style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem', background: '#fff7ed', borderColor: '#fed7aa' }}
                            />
                          )}
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              onClick={() => onNotify('ProcurementOrder', r.materialId, materialLabel(r), toOrder)}
                              title={`Notify procurement — order ${toOrder}`}
                              style={{ width: 24, height: 24, borderRadius: 6, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: needsAlert ? '#fee2e2' : '#f3f4f6' }}
                            >
                              <ShoppingCart style={{ width: 12, height: 12, color: needsAlert ? '#ef4444' : '#9ca3af' }} />
                            </button>
                            <button
                              onClick={() => onNotify('WarehouseCheck', r.materialId, materialLabel(r), r.estimatedQuantity)}
                              title="Notify warehouse to check material"
                              style={{ width: 24, height: 24, borderRadius: 6, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6' }}
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
                    })}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {editable && (
          <button onClick={addBlankRow} style={{ width: '100%', padding: '8px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.78rem', color: '#f97316', fontWeight: 600, borderTop: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <Plus style={{ width: 13, height: 13 }} /> Add Row
          </button>
        )}
      </div>

      {editable && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button onClick={onSave} disabled={saving} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Save Material Plan'}
          </button>
        </div>
      )}
    </div>
  );
}
