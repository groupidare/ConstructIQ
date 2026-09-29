'use client';

import { useRef } from 'react';
import { Upload, FileText, ExternalLink, X } from 'lucide-react';
import { getApiOrigin } from '@/lib/api';
import type { ProjectType } from '@/types/project';
import { PROJECT_TYPES } from '@/types/project';
import type { ProjectDocument } from '@/types/document';
import { inp, sel } from './styles';

interface Props {
  editable: boolean;
  projectType: ProjectType;
  otherTypeSpecify: string;
  onProjectTypeChange: (type: ProjectType, otherSpecify: string) => void;
  onOtherTypeSpecifyBlur: () => void;
  savingProjectType: boolean;
  blueprints: ProjectDocument[];
  uploading: boolean;
  onUploadBlueprint: (file: File) => void;
  onRemoveDocument: (documentId: number) => void;
}

export default function MeasurementsTab({
  editable, projectType, otherTypeSpecify, onProjectTypeChange, onOtherTypeSpecifyBlur, savingProjectType,
  blueprints, uploading, onUploadBlueprint, onRemoveDocument,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onUploadBlueprint(file);
    e.target.value = '';
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
        PROJECT TYPE {savingProjectType && <span style={{ fontWeight: 400, textTransform: 'none' }}>· saving…</span>}
      </p>
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
          onBlur={onOtherTypeSpecifyBlur}
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
        Blueprints are stored here for viewing and reference only — they are not scanned for measurements. Materials are planned in the Material Plan tab via the Bill of Quantities and Purchase Orders.
      </p>
    </div>
  );
}
