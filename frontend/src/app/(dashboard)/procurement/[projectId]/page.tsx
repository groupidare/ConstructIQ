'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Zap, ShoppingCart } from 'lucide-react';
import toast from 'react-hot-toast';
import { useProcurement } from '@/hooks/useProcurement';
import { useProjects } from '@/hooks/useProjects';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import { Table, Th, Td, Tr } from '@/components/ui/Table';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { Project } from '@/types/project';

const urgencyVariant: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  Low:      'default',
  Medium:   'info',
  High:     'warning',
  Critical: 'danger',
};

export default function ProjectProcurementPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = Number(projectId);
  const { recommendations, loading, fetchRecommendations, generateRecommendations, createPurchaseRequest } = useProcurement(pid);
  const { fetchProject } = useProjects();
  const [project, setProject] = useState<Project | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetchRecommendations();
    fetchProject(pid).then(setProject);
  }, [pid]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generateRecommendations();
      toast.success('Procurement recommendations updated!');
    } catch {
      toast.error('Failed to generate recommendations.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleCreatePR(rec: typeof recommendations[0]) {
    try {
      await createPurchaseRequest({
        projectId:         pid,
        recommendationId:  rec.id,
        materialId:        rec.materialId,
        requestedQuantity: rec.recommendedQuantity,
        estimatedUnitCost: rec.estimatedCost / Math.max(rec.recommendedQuantity, 1),
        notes:             `Auto-created from recommendation #${rec.id}`,
      });
      toast.success('Purchase request created!');
    } catch {
      toast.error('Failed to create purchase request.');
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Procurement Recommendations</h1>
          <p className="text-sm text-gray-500">{project?.name ?? `Project #${pid}`}</p>
        </div>
        <Button onClick={handleGenerate} loading={generating}>
          <Zap size={14} /> Generate Recommendations
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Reorder Recommendations ({recommendations.length})</h2>
            <p className="text-xs text-gray-500">Calculated using ROP + TSL + Dynamic Lead Time</p>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Material</Th>
                <Th>Current Stock</Th>
                <Th>ROP</Th>
                <Th>TSL</Th>
                <Th>Recommended Qty</Th>
                <Th>Est. Cost</Th>
                <Th>Lead Time</Th>
                <Th>Reorder Date</Th>
                <Th>Urgency</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {recommendations.map(r => (
                <Tr key={r.id}>
                  <Td className="font-medium">{r.materialName}</Td>
                  <Td className={r.currentStock <= r.reorderPoint ? 'text-red-600 font-medium' : ''}>
                    {r.currentStock.toLocaleString()} {r.unit}
                  </Td>
                  <Td className="text-gray-500">{r.reorderPoint.toLocaleString()}</Td>
                  <Td className="text-gray-500">{r.targetStockLevel.toLocaleString()}</Td>
                  <Td className="font-medium">{r.recommendedQuantity.toLocaleString()}</Td>
                  <Td>{formatCurrency(r.estimatedCost)}</Td>
                  <Td>{r.estimatedLeadTimeDays}d</Td>
                  <Td>{r.suggestedReorderDate ? formatDate(r.suggestedReorderDate) : '—'}</Td>
                  <Td><Badge variant={urgencyVariant[r.urgencyLevel]}>{r.urgencyLevel}</Badge></Td>
                  <Td>
                    <Button size="sm" variant="secondary" onClick={() => handleCreatePR(r)}>
                      <ShoppingCart size={12} /> PO
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {recommendations.length === 0 && (
            <p className="text-center text-gray-400 py-10 text-sm">
              No recommendations yet. Generate a forecast first, then click "Generate Recommendations".
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
