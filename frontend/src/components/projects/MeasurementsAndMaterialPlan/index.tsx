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
  // Historical projects are seeded/backfilled training data — reopening one
  // from the Projects list must never start editable, and (with the toggle
  // hidden below) there's no way to flip it back on from here. This is
  // narrower than forcing it in the shared hook itself: AddCompletedProjectWizard
  // reuses this same hook via Inline.tsx for a historical project's OWN initial
  // data-entry step, right after creation, which still needs to be editable.
  const state = useMeasurementsAndMaterialPlan({ project, initialEditable: project.isHistorical ? false : initialEditable, initialTab, onProjectSaved });

  // Files only has a narrow single-column layout — a fixed wide modal leaves
  // a large empty gap on the right. Material Plan's BOQ table needs the
  // extra width to show every column without horizontal scrolling — except
  // in View Only mode, where the ALERTS column and its action buttons don't
  // render at all (see MaterialPlanTab), so the same wide width would just
  // leave that same empty gap again.
  const modalWidth = state.tab === 'measurements' ? 640 : state.editable ? 1200 : 900;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: modalWidth, maxWidth: '95vw', transition: 'width 0.2s ease', boxShadow: '0 20px 60px rgba(0,0,0,0.18)', overflow: 'hidden', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '1.5rem 1.5rem 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
            <div>
              <p style={{ fontWeight: 800, fontSize: '1.15rem', color: '#111827' }}>Material Plan</p>
              <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 2 }}>{project.name}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Defaults to locked on open either way (see initialEditable
                  above) — historical projects just get a "Historical" label
                  alongside the same toggle, instead of a dead end with no way
                  back into editing at all. Needed for going back to backfill
                  Actual Qty that was missed during the original scan/creation
                  step — the whole point of a historical project existing. */}
              {project.isHistorical && (
                <span style={{ padding: '6px 12px', borderRadius: 999, background: '#f3f4f6', color: '#6b7280', fontSize: '0.72rem', fontWeight: 600 }}>
                  Historical
                </span>
              )}
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
