'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Check } from 'lucide-react';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { useProjects } from '@/hooks/useProjects';
import MeasurementsAndMaterialPlanInline from '@/components/projects/MeasurementsAndMaterialPlan/Inline';
import type { Project } from '@/types/project';
import { PROJECT_TYPES } from '@/types/project';

const schema = z.object({
  name:               z.string().min(2),
  type:               z.enum(['Renovation', 'Commercial', 'Industrial', 'Infrastructure', 'Residential', 'Others']),
  otherTypeSpecify:   z.string().optional(),
  location:           z.string().min(2),
  description:        z.string().optional(),
  startDate:          z.string().min(1),
  endDate:            z.string().min(1),
  assignedContractor: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
  onCancel: () => void;
  onSkip: (project: Project) => void;
  onFinish: (project: Project) => void;
}

// A completed/historical project is entered directly with its actual dates
// and phases already known — unlike a live project, there's no "target" end
// date or phased rollout to plan for. This is what makes it usable as ML
// training data: BOQ (planned) + Purchase Orders (actual) paired against a
// project whose real timeline and outcome are already settled.
export default function AddCompletedProjectWizard({ onCancel, onSkip, onFinish }: Props) {
  const { createProject } = useProjects();
  const [step, setStep] = useState<1 | 2>(1);
  const [project, setProject] = useState<Project | null>(null);

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'Renovation' },
  });

  const type = watch('type');

  async function onSubmit(data: FormData) {
    try {
      const created = await createProject({
        ...data,
        otherTypeSpecify: data.type === 'Others' ? data.otherTypeSpecify : undefined,
        budget: 0,
        targetEndDate: data.endDate,
        status: 'Completed',
        isHistorical: true,
        phases: [],
      });
      toast.success('Historical project created — now enter its Bill of Quantities and Purchase Orders.');
      setProject(created);
      setStep(2);
    } catch {
      toast.error('Failed to create project.');
    }
  }

  if (step === 2 && project) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
          <p className="text-sm text-gray-500">Step 2 of 2 — Files, Bill of Quantities &amp; Purchase Orders (historical data)</p>
        </div>
        <MeasurementsAndMaterialPlanInline project={project} onProjectSaved={setProject} initialTab="measurements" />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => onSkip(project)}>Skip for now</Button>
          <Button onClick={() => onFinish(project)}>
            <Check size={16} /> Finish
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Add Completed Project</h1>
        <p className="text-sm text-gray-500">Step 1 of 2 — Historical project details</p>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader><h2 className="font-semibold">Project Details</h2></CardHeader>
          <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Input label="Project Name *" {...register('name')} error={errors.name?.message} />
            </div>
            <div>
              <label className="label">Project Type *</label>
              <select className="input" {...register('type')}>
                {PROJECT_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            {type === 'Others' && (
              <Input label="Specify Type *" {...register('otherTypeSpecify')} />
            )}
            <Input label="Location *" {...register('location')} error={errors.location?.message} />
            <Input label="Actual Start Date *" type="date" {...register('startDate')} error={errors.startDate?.message} />
            <Input label="Actual Completion Date *" type="date" {...register('endDate')} error={errors.endDate?.message} />
            <Input label="Contractor" {...register('assignedContractor')} />
            <div className="md:col-span-2">
              <label className="label">Description</label>
              <textarea className="input min-h-20" {...register('description')} />
            </div>
          </CardBody>
        </Card>

        <p className="text-sm text-gray-500">
          Bill of Quantities and Purchase Orders are entered in the next step — this is what trains the forecasting model on real usage.
        </p>

        <div className="flex gap-3 justify-end">
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>Next: Bill of Quantities &amp; Purchase Orders</Button>
        </div>
      </form>
    </div>
  );
}
