'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Check } from 'lucide-react';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { useAuthStore } from '@/store/authStore';
import { useProjects } from '@/hooks/useProjects';
import { useSiteEngineers } from '@/hooks/useSiteEngineers';
import MeasurementsAndMaterialPlanInline from '@/components/projects/MeasurementsAndMaterialPlan/Inline';
import type { Tab } from '@/components/projects/MeasurementsAndMaterialPlan/Shell';
import type { Project } from '@/types/project';
import { PROJECT_TYPES } from '@/types/project';

const schema = z.object({
  name:               z.string().min(2),
  type:               z.enum(['Renovation', 'Commercial', 'Industrial', 'Infrastructure', 'Residential', 'Others']),
  otherTypeSpecify:   z.string().optional(),
  location:           z.string().min(2),
  description:        z.string().optional(),
  startDate:          z.string().min(1),
  targetEndDate:      z.string().min(1),
  siteEngineerId:     z.union([z.number(), z.nan()]).optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
  onCancel: () => void;
  onSkip: (project: Project) => void;
  onFinish: (project: Project) => void;
  // Lets a modal host size itself around the current step/tab, matching the
  // standalone Material Plan modal's own dynamic-width behavior.
  onStepChange?: (step: 1 | 2) => void;
  onMaterialPlanTabChange?: (tab: Tab) => void;
  onMaterialPlanEditableChange?: (editable: boolean) => void;
}

export default function NewProjectWizard({ onCancel, onSkip, onFinish, onStepChange, onMaterialPlanTabChange, onMaterialPlanEditableChange }: Props) {
  const { createProject } = useProjects();
  const { siteEngineers } = useSiteEngineers();
  const { user } = useAuthStore();
  const isSiteEngineer = user?.role === 'SiteEngineer';
  const [step, setStep] = useState<1 | 2>(1);
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => { onStepChange?.(step); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'Renovation' },
  });

  const type = watch('type');

  // A SiteEngineer creating a project always ends up as its assigned
  // engineer/PIC — the backend forces this regardless of what's picked here
  // (ProjectService.CreateAsync), so the dropdown pre-selects and locks to
  // their own name instead of showing a pickable list that wouldn't actually
  // take effect. Waits for the list to actually contain their own entry
  // (rather than firing on mount) so it doesn't race the async fetch.
  useEffect(() => {
    if (isSiteEngineer && user && siteEngineers.some(e => e.id === user.id)) {
      setValue('siteEngineerId', user.id);
    }
  }, [isSiteEngineer, user, siteEngineers, setValue]);

  async function onSubmit(data: FormData) {
    try {
      const created = await createProject({
        ...data,
        otherTypeSpecify: data.type === 'Others' ? data.otherTypeSpecify : undefined,
        siteEngineerId: data.siteEngineerId != null && !Number.isNaN(data.siteEngineerId) ? data.siteEngineerId : undefined,
        budget: 0,
        phases: [],
      });
      toast.success('Project created — now add measurements & material plan.');
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
          <p className="text-sm text-gray-500">Step 2 of 2 — Material Plan</p>
        </div>
        <MeasurementsAndMaterialPlanInline project={project} onProjectSaved={setProject} bare onTabChange={onMaterialPlanTabChange} onEditableChange={onMaterialPlanEditableChange} />
        {/* Sticky, not part of normal scroll flow — the Material Plan tab's
            BOQ table can run much longer than the modal's visible height, and
            these buttons need to stay reachable without scrolling past it. */}
        <div className="flex justify-end gap-3 sticky bottom-0 bg-white pt-3 pb-1">
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
        <h1 className="text-2xl font-bold text-gray-900">Create New Project</h1>
        <p className="text-sm text-gray-500">Step 1 of 2 — Project details</p>
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
            <Input label="Start Date *" type="date" {...register('startDate')} />
            <Input label="Target End Date *" type="date" {...register('targetEndDate')} />
            <div>
              <label className="label">Assign Engineer/PIC</label>
              <select
                className="input"
                {...register('siteEngineerId', { valueAsNumber: true })}
                defaultValue=""
                disabled={isSiteEngineer}
                title={isSiteEngineer ? "You're automatically assigned as this project's engineer/PIC" : undefined}
              >
                <option value="">— Unassigned —</option>
                {siteEngineers.map(e => (
                  <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="label">Description</label>
              <textarea className="input min-h-20" {...register('description')} />
            </div>
          </CardBody>
        </Card>

        <p className="text-sm text-gray-500">
          Phases are added in the next step, alongside measurements and the material plan.
        </p>

        <div className="flex gap-3 justify-end">
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>Next: Material Plan</Button>
        </div>
      </form>
    </div>
  );
}
