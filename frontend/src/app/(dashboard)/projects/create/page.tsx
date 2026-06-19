'use client';

import { useRouter } from 'next/navigation';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';

const phaseSchema = z.object({
  name:      z.string().min(1),
  order:     z.number().int().min(1),
  startDate: z.string().min(1),
  endDate:   z.string().min(1),
});

const schema = z.object({
  name:               z.string().min(2),
  type:               z.enum(['Residential','Commercial','Industrial','Infrastructure','Mixed']),
  location:           z.string().min(2),
  description:        z.string().optional(),
  budget:             z.number().positive().optional(),
  startDate:          z.string().min(1),
  targetEndDate:      z.string().min(1),
  assignedContractor: z.string().optional(),
  siteEngineerId:     z.number().optional(),
  phases:             z.array(phaseSchema),
});

type FormData = z.infer<typeof schema>;

export default function CreateProjectPage() {
  const router = useRouter();
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { phases: [{ name: 'Foundation', order: 1, startDate: '', endDate: '' }] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'phases' });

  async function onSubmit(data: FormData) {
    try {
      const { data: project } = await api.post('/projects', data);
      toast.success('Project created!');
      router.push(`/projects/${project.id}`);
    } catch {
      toast.error('Failed to create project.');
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Create New Project</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader><h2 className="font-semibold">Project Details</h2></CardHeader>
          <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Input label="Project Name *" {...register('name')} error={errors.name?.message} />
            </div>
            <div>
              <label className="label">Type *</label>
              <select className="input" {...register('type')}>
                {['Residential','Commercial','Industrial','Infrastructure','Mixed'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <Input label="Location *" {...register('location')} error={errors.location?.message} />
            <Input label="Start Date *" type="date" {...register('startDate')} />
            <Input label="Target End Date *" type="date" {...register('targetEndDate')} />
            <Input label="Budget (₱)" type="number" step="0.01" {...register('budget', { valueAsNumber: true })} />
            <Input label="Assigned Contractor" {...register('assignedContractor')} />
            <div className="md:col-span-2">
              <label className="label">Description</label>
              <textarea className="input min-h-20" {...register('description')} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Phases</h2>
              <Button type="button" variant="secondary" size="sm" onClick={() =>
                append({ name: '', order: fields.length + 1, startDate: '', endDate: '' })
              }>
                <Plus size={14} /> Add Phase
              </Button>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            {fields.map((field, idx) => (
              <div key={field.id} className="grid grid-cols-1 md:grid-cols-4 gap-3 p-3 bg-gray-50 rounded-lg">
                <Input label="Phase Name" {...register(`phases.${idx}.name`)} />
                <Input label="Order" type="number" {...register(`phases.${idx}.order`, { valueAsNumber: true })} />
                <Input label="Start Date" type="date" {...register(`phases.${idx}.startDate`)} />
                <div className="flex gap-2 items-end">
                  <Input label="End Date" type="date" {...register(`phases.${idx}.endDate`)} className="flex-1" />
                  {fields.length > 1 && (
                    <button type="button" onClick={() => remove(idx)} className="pb-2 text-red-500 hover:text-red-700">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <div className="flex gap-3 justify-end">
          <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>Create Project</Button>
        </div>
      </form>
    </div>
  );
}
