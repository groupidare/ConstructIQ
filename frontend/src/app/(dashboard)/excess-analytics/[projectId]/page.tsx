'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Plus, Recycle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useExcess } from '@/hooks/useExcess';
import { useProjects } from '@/hooks/useProjects';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import { Table, Th, Td, Tr } from '@/components/ui/Table';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { Project } from '@/types/project';
import type { ExcessWasteRecord, ExcessWasteCreateRequest } from '@/types/excess';
import RedistributeModal from '@/components/excess/RedistributeModal';

export default function ExcessAnalyticsProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = Number(projectId);
  const { records, summary, loading, fetchRecords, fetchSummary, createRecord } = useExcess(pid);
  const { fetchProject } = useProjects();
  const [project, setProject] = useState<Project | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<ExcessWasteCreateRequest>({
    projectId: pid, phaseId: undefined, materialId: 0,
    excessType: 'Unused', quantity: 0, unitCost: 0, isReusable: false, notes: '',
  });

  const [redistributeTarget, setRedistributeTarget] = useState<ExcessWasteRecord | null>(null);

  useEffect(() => {
    fetchRecords();
    fetchSummary();
    fetchProject(pid).then(setProject);
  }, [pid]);

  async function handleCreate() {
    setSubmitting(true);
    try {
      await createRecord(form);
      toast.success('Record added!');
      await fetchSummary();
      setShowModal(false);
    } catch {
      toast.error('Failed to save record.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Excess / Waste Analytics</h1>
          <p className="text-sm text-gray-500">{project?.name ?? `Project #${pid}`}</p>
        </div>
        <Button onClick={() => setShowModal(true)}><Plus size={14} /> Record Excess</Button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Excess Cost',    value: formatCurrency(summary.totalExcessCost) },
            { label: 'Total Excess Qty',     value: summary.totalExcessQuantity.toLocaleString() },
            { label: 'Reusable Value',       value: formatCurrency(summary.reusableValue) },
            { label: 'Materials Affected',   value: summary.excessByMaterial?.length ?? 0 },
          ].map(({ label, value }) => (
            <Card key={label}>
              <CardBody className="text-center py-4">
                <p className="text-2xl font-bold text-gray-900">{value}</p>
                <p className="text-xs text-gray-500 mt-1">{label}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader><h2 className="font-semibold">Records ({records.length})</h2></CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Material</Th>
                <Th>Type</Th>
                <Th>Quantity</Th>
                <Th>Unit Cost</Th>
                <Th>Total Cost</Th>
                <Th>Excess %</Th>
                <Th>Reusable</Th>
                <Th>Phase</Th>
                <Th>Recorded</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <Tr key={r.id}>
                  <Td className="font-medium">{r.materialName}</Td>
                  <Td><Badge variant={r.excessType === 'Damaged' ? 'danger' : 'warning'}>{r.excessType}</Badge></Td>
                  <Td>{r.quantity.toLocaleString()} {r.unit}</Td>
                  <Td>{formatCurrency(r.unitCost)}</Td>
                  <Td className="font-medium text-red-600">{formatCurrency(r.totalCost)}</Td>
                  <Td>{r.excessPercent.toFixed(1)}%</Td>
                  <Td><Badge variant={r.isReusable ? 'success' : 'default'}>{r.isReusable ? 'Yes' : 'No'}</Badge></Td>
                  <Td>{r.phaseName || '—'}</Td>
                  <Td className="text-xs text-gray-400">{formatDate(r.recordedAt)}</Td>
                  <Td>
                    {r.isReusable ? (
                      <Button size="sm" variant="secondary" onClick={() => setRedistributeTarget(r)}>
                        <Recycle size={12} /> Redistribute
                      </Button>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {records.length === 0 && (
            <p className="text-center text-gray-400 py-10 text-sm">No excess records yet.</p>
          )}
        </CardBody>
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Record Excess / Waste">
        <div className="space-y-4">
          <div>
            <label className="label">Material ID</label>
            <input className="input" type="number" onChange={e => setForm(f => ({ ...f, materialId: +e.target.value }))} />
          </div>
          <div>
            <label className="label">Excess Type</label>
            <select className="input" onChange={e => setForm(f => ({ ...f, excessType: e.target.value as any }))}>
              {['Unused','Damaged','Expired','Overordered'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Quantity</label>
              <input className="input" type="number" step="0.01" onChange={e => setForm(f => ({ ...f, quantity: +e.target.value }))} />
            </div>
            <div>
              <label className="label">Unit Cost (₱)</label>
              <input className="input" type="number" step="0.01" onChange={e => setForm(f => ({ ...f, unitCost: +e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="reusable" onChange={e => setForm(f => ({ ...f, isReusable: e.target.checked }))} />
            <label htmlFor="reusable" className="text-sm text-gray-700">Is Reusable</label>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input" onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button loading={submitting} onClick={handleCreate}>Save</Button>
          </div>
        </div>
      </Modal>

      {redistributeTarget && (
        <RedistributeModal
          record={{
            id: redistributeTarget.id,
            materialName: redistributeTarget.materialName,
            quantity: redistributeTarget.quantity,
            unit: redistributeTarget.unit,
            projectId: pid,
            projectName: project?.name ?? `Project #${pid}`,
          }}
          onClose={() => setRedistributeTarget(null)}
          onSuccess={fetchRecords}
        />
      )}
    </div>
  );
}
