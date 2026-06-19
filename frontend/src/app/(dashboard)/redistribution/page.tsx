'use client';

import { useEffect, useState } from 'react';
import { Zap, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useProcurement } from '@/hooks/useProcurement';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import { Table, Th, Td, Tr } from '@/components/ui/Table';
import { formatCurrency } from '@/lib/utils';

export default function RedistributionPage() {
  const { redistribution, loading, fetchRedistribution, generateRedistribution, approveTransfer } = useProcurement(0);
  const [generating, setGenerating] = useState(false);

  useEffect(() => { fetchRedistribution(); }, []);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generateRedistribution();
      toast.success('Redistribution recommendations updated!');
    } catch {
      toast.error('Failed to generate redistribution recommendations.');
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Material Redistribution</h1>
          <p className="text-sm text-gray-500 mt-1">Transfer excess materials between projects to reduce waste and new procurement costs.</p>
        </div>
        <Button onClick={handleGenerate} loading={generating}>
          <Zap size={14} /> Find Matches
        </Button>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Redistribution Opportunities ({redistribution.length})</h2>
        </CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Material</Th>
                <Th>From Project</Th>
                <Th>To Project</Th>
                <Th>Qty to Transfer</Th>
                <Th>Est. Savings</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {redistribution.map(r => (
                <Tr key={r.id}>
                  <Td className="font-medium">{r.materialName}</Td>
                  <Td>{r.sourceProjectName}</Td>
                  <Td>{r.targetProjectName}</Td>
                  <Td>{r.transferQuantity.toLocaleString()} {r.unit}</Td>
                  <Td className="text-green-600 font-medium">{formatCurrency(r.estimatedSavings)}</Td>
                  <Td><Badge variant={r.status === 'Approved' ? 'success' : 'info'}>{r.status}</Badge></Td>
                  <Td>
                    {r.status !== 'Approved' && (
                      <Button size="sm" variant="secondary" onClick={() => approveTransfer(r.id)}>
                        <CheckCircle size={12} /> Approve
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {redistribution.length === 0 && (
            <p className="text-center text-gray-400 py-10 text-sm">
              No redistribution opportunities found. Click "Find Matches" to run the rule-based engine.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
