'use client';

import { X } from 'lucide-react';
import type { Project } from '@/types/project';
import { useMeasurementsAndMaterialPlan, TabBar, EditToggle, TabBody, type Tab } from './Shell';

interface Props {
  project: Project;
  onClose: () => void;
  initialEditable?: boolean;
  initialTab?: Tab;
  onProjectSaved?: (p: Project) => void;
}

export default function MeasurementsAndMaterialPlan({ project, onClose, initialEditable = true, initialTab = 'measurements', onProjectSaved }: Props) {
  const state = useMeasurementsAndMaterialPlan({ project, initialEditable, initialTab, onProjectSaved });

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: 760, boxShadow: '0 20px 60px rgba(0,0,0,0.18)', overflow: 'hidden', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '1.5rem 1.5rem 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
            <div>
              <p style={{ fontWeight: 800, fontSize: '1.15rem', color: '#111827' }}>Material Plan</p>
              <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 2 }}>{project.name}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <EditToggle editable={state.editable} onToggle={() => state.setEditable(e => !e)} />
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}><X style={{ width: 20, height: 20 }} /></button>
            </div>
          </div>
          <TabBar tab={state.tab} setTab={state.setTab} />
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '1.25rem 1.5rem' }}>
          <TabBody project={project} state={state} />
        </div>
      </div>
    </div>
  );
}
