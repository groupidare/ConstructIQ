'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Plus, RefreshCw } from 'lucide-react';
import { useInventory } from '@/hooks/useInventory';
import { useProjects } from '@/hooks/useProjects';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import { Table, Th, Td, Tr } from '@/components/ui/Table';
import { formatDate } from '@/lib/utils';
import type { Project } from '@/types/project';
import type { MovementCreateRequest } from '@/types/inventory';

const stockVariant: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  Normal:     'success',
  LowStock:   'warning',
  OutOfStock: 'danger',
  Overstock:  'info',
};

export default function ProjectInventoryPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = Number(projectId);
  const { inventory, loading, fetchInventory, recordMovement } = useInventory(pid);
  const { fetchProject } = useProjects();
  const [project, setProject] = useState<Project | null>(null);
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<MovementCreateRequest>({
    projectId: pid, materialId: 0, movementType: 'Received', quantity: 0, notes: '',
  });

  useEffect(() => {
    fetchInventory();
    fetchProject(pid).then(setProject);
  }, [pid]);

  async function handleMovement() {
    setSubmitting(true);
    try {
      await recordMovement(form);
      setShowMovementModal(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500">{project?.name ?? `Project #${pid}`}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => fetchInventory()}><RefreshCw size={14} /> Refresh</Button>
          <Button onClick={() => setShowMovementModal(true)}><Plus size={14} /> Record Movement</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Stock Levels ({inventory.length} materials)</h2>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Material</Th>
                <Th>Unit</Th>
                <Th>Available</Th>
                <Th>Used</Th>
                <Th>Wasted</Th>
                <Th>Excess</Th>
                <Th>ROP</Th>
                <Th>TSL</Th>
                <Th>Status</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {inventory.map(r => (
                <Tr key={r.id}>
                  <Td>
                    <div>
                      <p className="font-medium">{r.materialName}</p>
                      {r.specification && <p className="text-xs text-gray-400">{r.specification}</p>}
                    </div>
                  </Td>
                  <Td>{r.unit}</Td>
                  <Td className="font-medium">{r.availableQuantity.toLocaleString()}</Td>
                  <Td>{r.usedQuantity.toLocaleString()}</Td>
                  <Td className={r.wastedQuantity > 0 ? 'text-red-600' : ''}>{r.wastedQuantity.toLocaleString()}</Td>
                  <Td className={r.excessQuantity > 0 ? 'text-yellow-600' : ''}>{r.excessQuantity.toLocaleString()}</Td>
                  <Td className="text-gray-500">{r.reorderPoint.toLocaleString()}</Td>
                  <Td className="text-gray-500">{r.targetStockLevel.toLocaleString()}</Td>
                  <Td><Badge variant={stockVariant[r.stockStatus] ?? 'default'}>{r.stockStatus}</Badge></Td>
                  <Td className="text-gray-400 text-xs">{formatDate(r.lastUpdated)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {inventory.length === 0 && (
            <p className="text-center text-gray-400 py-10 text-sm">No inventory records yet. Record the first movement to get started.</p>
          )}
        </CardBody>
      </Card>

      <Modal open={showMovementModal} onClose={() => setShowMovementModal(false)} title="Record Material Movement">
        <div className="space-y-4">
          <div>
            <label className="label">Material ID</label>
            <input className="input" type="number" value={form.materialId || ''}
              onChange={e => setForm(f => ({ ...f, materialId: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="label">Movement Type</label>
            <select className="input" value={form.movementType}
              onChange={e => setForm(f => ({ ...f, movementType: e.target.value as any }))}>
              {['Received','Released','Returned','Wasted','Transferred'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Quantity</label>
            <input className="input" type="number" step="0.01" value={form.quantity || ''}
              onChange={e => setForm(f => ({ ...f, quantity: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input" value={form.notes ?? ''}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowMovementModal(false)}>Cancel</Button>
            <Button loading={submitting} onClick={handleMovement}>Save Movement</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
