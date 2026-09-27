'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import NewProjectWizard from './NewProjectWizard';
import type { Tab } from '@/components/projects/MeasurementsAndMaterialPlan/Shell';
import type { Project } from '@/types/project';

interface Props {
  onClose: () => void;
  onDone: (project: Project) => void;
}

export default function NewProjectWizardModal({ onClose, onDone }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [materialPlanTab, setMaterialPlanTab] = useState<Tab>('measurements');

  // Same sizing rule as the standalone Material Plan modal: step 1's form
  // keeps its own width, but step 2 mirrors Files (compact) vs. Material
  // Plan (full BOQ table) exactly.
  const width = step === 1 ? 820 : materialPlanTab === 'measurements' ? 640 : 1200;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 16, width, maxWidth: '95vw', transition: 'width 0.2s ease', boxShadow: '0 20px 60px rgba(0,0,0,0.18)', overflow: 'hidden', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
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
            onStepChange={setStep}
            onMaterialPlanTabChange={setMaterialPlanTab}
          />
        </div>
      </div>
    </div>
  );
}
