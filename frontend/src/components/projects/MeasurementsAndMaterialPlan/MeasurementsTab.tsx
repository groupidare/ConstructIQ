'use client';

import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Upload, FileText, Trash2, Plus, ExternalLink, Sparkles, X } from 'lucide-react';
import { getApiOrigin } from '@/lib/api';
import type { Project, ProjectType, Phase } from '@/types/project';
import { PROJECT_TYPES } from '@/types/project';
import type { ProjectDocument } from '@/types/document';
import type { ElementType, MeasurementRow } from '@/types/measurement';
import { ELEMENT_TYPES } from '@/types/measurement';
import { inp, sel, lbl } from './styles';

interface Props {
  project: Project;
  editable: boolean;
  projectType: ProjectType;
  otherTypeSpecify: string;
  onProjectTypeChange: (type: ProjectType, otherSpecify: string) => void;
  blueprints: ProjectDocument[];
  uploading: boolean;
  onUploadBlueprint: (file: File) => void;
  rows: MeasurementRow[];
  onRowsChange: (rows: MeasurementRow[]) => void;
  onSave: () => void;
  saving: boolean;
  onRunForecast: () => void;
  forecasting: boolean;
  onAddPhase: (name: string) => void;
  onRemoveDocument: (documentId: number) => void;
}

function volumeAndArea(row: MeasurementRow) {
  if (row.elementType === 'Wall') {
    return {
      area: row.lengthM * row.heightM,
      volume: row.lengthM * row.heightM * row.thicknessM,
    };
  }
  return {
    area: row.lengthM * row.widthM,
    volume: row.lengthM * row.widthM * row.thicknessM,
  };
}

export default function MeasurementsTab({
  project, editable, projectType, otherTypeSpecify, onProjectTypeChange,
  blueprints, uploading, onUploadBlueprint,
  rows, onRowsChange, onSave, saving, onRunForecast, forecasting, onAddPhase, onRemoveDocument,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addRow(phaseId: number) {
    onRowsChange([
      ...rows,
      { phaseId, elementType: 'Wall', lengthM: 0, widthM: 0, heightM: 0, thicknessM: 0.10, concreteMixRatio: '1:2:4', wasteAllowancePct: 12 },
    ]);
  }

  function updateRow(idx: number, patch: Partial<MeasurementRow>) {
    onRowsChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeRow(idx: number) {
    onRowsChange(rows.filter((_, i) => i !== idx));
  }

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onUploadBlueprint(file);
    e.target.value = '';
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.6fr)', gap: '1.25rem' }}>
      {/* ── Left column: Project Type + blueprint upload/preview ── */}
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>PROJECT TYPE</p>
        <select
          disabled={!editable}
          value={projectType}
          onChange={e => onProjectTypeChange(e.target.value as ProjectType, otherTypeSpecify)}
          style={{ ...sel, marginBottom: projectType === 'Others' ? 8 : 16 }}
        >
          {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {projectType === 'Others' && (
          <input
            disabled={!editable}
            value={otherTypeSpecify}
            onChange={e => onProjectTypeChange(projectType, e.target.value)}
            placeholder="Specify project type"
            style={{ ...inp, marginBottom: 16 }}
          />
        )}

        <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>BLUEPRINT / PDF</p>
        {editable && (
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{ border: '2px dashed #e5e7eb', borderRadius: 10, padding: '1.1rem', textAlign: 'center', marginBottom: '0.75rem', cursor: 'pointer', background: '#fafafa' }}
          >
            <input ref={fileInputRef} type="file" accept=".pdf,.dwg,.png,.jpg,.jpeg" onChange={handleFilePicked} style={{ display: 'none' }} />
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.5rem' }}>
              <Upload style={{ width: 16, height: 16, color: '#f97316' }} />
            </div>
            <p style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151' }}>{uploading ? 'Uploading…' : 'Upload Blueprint'}</p>
            <p style={{ fontSize: '0.68rem', color: '#9ca3af', marginTop: 2 }}>PDF, DWG, PNG, JPG — max 25 MB</p>
          </div>
        )}

        {blueprints.length === 0 ? (
          <p style={{ fontSize: '0.72rem', color: '#d1d5db', padding: '0.5rem 0' }}>No blueprint uploaded yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: '1rem' }}>
            {blueprints.map(doc => (
              <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <a
                  href={`${getApiOrigin()}${doc.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', textDecoration: 'none', flex: 1, minWidth: 0 }}
                >
                  <FileText style={{ width: 14, height: 14, color: '#f97316', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.78rem', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{doc.fileName}</span>
                  <ExternalLink style={{ width: 12, height: 12, color: '#9ca3af', flexShrink: 0 }} />
                </a>
                {editable && (
                  <button
                    onClick={() => onRemoveDocument(doc.id)}
                    title="Remove file"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '8px 10px', flexShrink: 0 }}
                  >
                    <X style={{ width: 13, height: 13 }} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <p style={{ fontSize: '0.68rem', color: '#9ca3af', lineHeight: 1.4 }}>
          Uploading scans the PDF for dimension callouts (OCR is used automatically for scanned/image pages) and pre-fills rows below — always review and correct them, since scanning can misread a drawing.
        </p>
      </div>

      {/* ── Right column: per-phase measurement rows ── */}
      <div style={{ minWidth: 0 }}>
        <UnassignedMeasurements project={project} editable={editable} rows={rows} onUpdate={updateRow} onRemove={removeRow} />

        {project.phases.length === 0 && (
          <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            This project has no phases yet — add one to start recording measurements.
          </p>
        )}
        {project.phases.map(phase => (
          <PhaseMeasurements
            key={phase.id}
            phase={phase}
            project={project}
            editable={editable}
            rows={rows}
            onAdd={() => addRow(phase.id)}
            onUpdate={updateRow}
            onRemove={removeRow}
          />
        ))}

        {editable && <AddPhaseForm onAdd={onAddPhase} />}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '1rem' }}>
          {editable && (
            <button onClick={onSave} disabled={saving} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save Measurements'}
            </button>
          )}
          <button
            onClick={() => {
              if (rows.length === 0) { toast.error('Enter at least one measurement first.'); return; }
              onRunForecast();
            }}
            disabled={forecasting}
            style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', opacity: forecasting ? 0.7 : 1 }}
          >
            {forecasting ? 'Forecasting…' : '▶ Run Forecast'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddPhaseForm({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: '0.5rem' }}>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="New phase name (e.g. Foundation)"
        style={{ ...inp, flex: 1, padding: '7px 10px', fontSize: '0.8rem' }}
      />
      <button
        onClick={() => { onAdd(name); setName(''); }}
        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px', borderRadius: 8, border: '1px solid #fed7aa', background: '#fff7ed', color: '#f97316', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        <Plus style={{ width: 13, height: 13 }} /> Add Phase
      </button>
    </div>
  );
}

function ScanBadge({ row }: { row: MeasurementRow }) {
  if (!row.autoScanned) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.62rem', fontWeight: 600, padding: '2px 7px', borderRadius: 999, background: row.ocrUsed ? '#fef3c7' : '#dbeafe', color: row.ocrUsed ? '#b45309' : '#1d4ed8', whiteSpace: 'nowrap' }}>
      <Sparkles style={{ width: 9, height: 9 }} /> {row.ocrUsed ? 'OCR scan' : 'Auto-scanned'}{row.sourcePage ? ` · p.${row.sourcePage}` : ''}
    </span>
  );
}

function MeasurementRowFields({ row, editable, onUpdate, onRemove, phaseSelect }: {
  row: MeasurementRow;
  editable: boolean;
  onUpdate: (patch: Partial<MeasurementRow>) => void;
  onRemove: () => void;
  phaseSelect?: React.ReactNode;
}) {
  const { area, volume } = volumeAndArea(row);
  return (
    <div style={{ background: row.autoScanned ? '#fffbf5' : '#f9fafb', border: row.autoScanned ? '1px solid #fed7aa' : 'none', borderRadius: 8, padding: '0.625rem 0.75rem', marginBottom: 6 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select disabled={!editable} value={row.elementType} onChange={e => onUpdate({ elementType: e.target.value as ElementType })} style={{ ...sel, width: 110, padding: '5px 8px', fontSize: '0.78rem' }}>
          {ELEMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {phaseSelect}
        <input disabled={!editable} value={row.areaLabel ?? ''} onChange={e => onUpdate({ areaLabel: e.target.value })} placeholder="Label (e.g. Grid A1-A5)" style={{ ...inp, flex: 1, minWidth: 100, padding: '5px 8px', fontSize: '0.78rem' }} />
        <ScanBadge row={row} />
        {editable && (
          <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2 }}>
            <Trash2 style={{ width: 13, height: 13 }} />
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6, marginBottom: 6 }}>
        <DimInput disabled={!editable} label="Length (m)" value={row.lengthM} onChange={v => onUpdate({ lengthM: v })} />
        <DimInput disabled={!editable} label="Width (m)" value={row.widthM} onChange={v => onUpdate({ widthM: v })} />
        <DimInput disabled={!editable} label="Height (m)" value={row.heightM} onChange={v => onUpdate({ heightM: v })} />
        <DimInput disabled={!editable} label="Thickness (m)" value={row.thicknessM} onChange={v => onUpdate({ thicknessM: v })} />
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: '0.72rem', color: '#6b7280' }}>
        <span>Area: <strong style={{ color: '#111827' }}>{area.toFixed(2)} m²</strong></span>
        <span>Volume: <strong style={{ color: '#111827' }}>{volume.toFixed(3)} m³</strong></span>
      </div>
    </div>
  );
}

function UnassignedMeasurements({ project, editable, rows, onUpdate, onRemove }: {
  project: Project;
  editable: boolean;
  rows: MeasurementRow[];
  onUpdate: (idx: number, patch: Partial<MeasurementRow>) => void;
  onRemove: (idx: number) => void;
}) {
  const unassigned = rows.map((r, i) => ({ r, i })).filter(({ r }) => !r.phaseId);
  if (unassigned.length === 0) return null;

  return (
    <div style={{ border: '1px solid #fed7aa', background: '#fffbf5', borderRadius: 10, padding: '0.875rem', marginBottom: '0.75rem' }}>
      <p style={{ fontWeight: 700, fontSize: '0.85rem', color: '#c2410c', marginBottom: '0.5rem' }}>
        Auto-scanned — needs a phase ({unassigned.length})
      </p>
      {unassigned.map(({ r, i }) => (
        <MeasurementRowFields
          key={i}
          row={r}
          editable={editable}
          onUpdate={patch => onUpdate(i, patch)}
          onRemove={() => onRemove(i)}
          phaseSelect={
            <select
              disabled={!editable}
              value=""
              onChange={e => onUpdate(i, { phaseId: e.target.value ? Number(e.target.value) : undefined })}
              style={{ ...sel, width: 120, padding: '5px 8px', fontSize: '0.78rem', borderColor: '#f97316' }}
            >
              <option value="">Assign phase…</option>
              {project.phases.map(ph => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
            </select>
          }
        />
      ))}
    </div>
  );
}

function PhaseMeasurements({ phase, project, editable, rows, onAdd, onUpdate, onRemove }: {
  phase: Phase;
  project: Project;
  editable: boolean;
  rows: MeasurementRow[];
  onAdd: () => void;
  onUpdate: (idx: number, patch: Partial<MeasurementRow>) => void;
  onRemove: (idx: number) => void;
}) {
  const phaseRows = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.phaseId === phase.id);

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '0.875rem', marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' }}>
        <p style={{ fontWeight: 700, fontSize: '0.85rem', color: '#111827' }}>{phase.name}</p>
        {editable && (
          <button onClick={onAdd} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 999, border: '1px solid #fed7aa', background: '#fff7ed', color: '#f97316', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer' }}>
            <Plus style={{ width: 11, height: 11 }} /> Add Element
          </button>
        )}
      </div>

      {phaseRows.length === 0 ? (
        <p style={{ fontSize: '0.72rem', color: '#d1d5db' }}>No elements recorded.</p>
      ) : (
        phaseRows.map(({ r, i }) => (
          <MeasurementRowFields
            key={i}
            row={r}
            editable={editable}
            onUpdate={patch => onUpdate(i, patch)}
            onRemove={() => onRemove(i)}
            phaseSelect={
              project.phases.length > 1 ? (
                <select
                  disabled={!editable}
                  value={r.phaseId ?? ''}
                  onChange={e => onUpdate(i, { phaseId: e.target.value ? Number(e.target.value) : undefined })}
                  style={{ ...sel, width: 110, padding: '5px 8px', fontSize: '0.72rem' }}
                >
                  {project.phases.map(ph => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
                </select>
              ) : undefined
            }
          />
        ))
      )}
    </div>
  );
}

function DimInput({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <div>
      <label style={{ ...lbl, fontSize: '0.62rem' }}>{label}</label>
      <input
        disabled={disabled}
        type="number"
        step="0.01"
        value={value || ''}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        style={{ ...inp, padding: '5px 8px', fontSize: '0.78rem' }}
      />
    </div>
  );
}
