'use client';

import type { Project } from '@/types/project';
import { useMeasurementsAndMaterialPlan, TabBar, EditToggle, TabBody } from './Shell';

interface Props {
  project: Project;
  onProjectSaved?: (p: Project) => void;
}

export default function MeasurementsAndMaterialPlanInline({ project, onProjectSaved }: Props) {
  const state = useMeasurementsAndMaterialPlan({ project, initialEditable: true, initialTab: 'measurements', onProjectSaved });

  return (
    <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      <div style={{ padding: '1.25rem 1.5rem 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
          <div>
            <p style={{ fontWeight: 800, fontSize: '1.15rem', color: '#111827' }}>Measurements &amp; Material Plan</p>
            <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 2 }}>{project.name}</p>
          </div>
          <EditToggle editable={state.editable} onToggle={() => state.setEditable(e => !e)} />
        </div>
        <TabBar tab={state.tab} setTab={state.setTab} />
      </div>
      <div style={{ padding: '1.25rem 1.5rem' }}>
        <TabBody project={project} state={state} />
      </div>
    </div>
  );
}
