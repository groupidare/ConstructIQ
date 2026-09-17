'use client';

import { X } from 'lucide-react';
import NewProjectWizard from './NewProjectWizard';
import type { Project } from '@/types/project';

interface Props {
  onClose: () => void;
  onDone: (project: Project) => void;
}

export default function NewProjectWizardModal({ onClose, onDone }: Props) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 16, width: 820, boxShadow: '0 20px 60px rgba(0,0,0,0.18)', overflow: 'hidden', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '1rem 1.5rem 0' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}>
            <X style={{ width: 20, height: 20 }} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 1.5rem 1.5rem' }}>
          <NewProjectWizard
            onCancel={onClose}
            onSkip={onDone}
            onFinish={onDone}
          />
        </div>
      </div>
    </div>
  );
}
