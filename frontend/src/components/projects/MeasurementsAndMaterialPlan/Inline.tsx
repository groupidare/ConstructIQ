'use client';

import { useEffect } from 'react';
import type { Project } from '@/types/project';
import { useMeasurementsAndMaterialPlan, TabBar, EditToggle, TabBody, type Tab } from './Shell';

interface Props {
  project: Project;
  onProjectSaved?: (p: Project) => void;
  initialTab?: Tab;
  // Lets a host that already provides its own card chrome (e.g. the project
  // creation wizard modals, which size and frame themselves around this)
  // skip this component's own background/border/shadow — avoids a card
  // nested inside a card.
  bare?: boolean;
  onTabChange?: (tab: Tab) => void;
  onEditableChange?: (editable: boolean) => void;
}

export default function MeasurementsAndMaterialPlanInline({ project, onProjectSaved, initialTab = 'measurements', bare = false, onTabChange, onEditableChange }: Props) {
  const state = useMeasurementsAndMaterialPlan({ project, initialEditable: true, initialTab, onProjectSaved });

  useEffect(() => { onTabChange?.(state.tab); }, [state.tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onEditableChange?.(state.editable); }, [state.editable]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={bare ? undefined : { background: '#fff', borderRadius: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      <div style={{ padding: bare ? '0' : '1.25rem 1.5rem 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
          <div>
            <p style={{ fontWeight: 800, fontSize: '1.15rem', color: '#111827' }}>Material Plan</p>
            <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 2 }}>{project.name}</p>
          </div>
          <EditToggle editable={state.editable} onToggle={() => state.setEditable(e => !e)} />
        </div>
        <TabBar tab={state.tab} setTab={state.setTab} />
      </div>
      <div style={{ padding: bare ? '1.25rem 0 0' : '1.25rem 1.5rem' }}>
        <TabBody project={project} state={state} />
      </div>
    </div>
  );
}
