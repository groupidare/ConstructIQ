'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Zap, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useForecasting } from '@/hooks/useForecasting';
import { useProjects } from '@/hooks/useProjects';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import { Table, Th, Td, Tr } from '@/components/ui/Table';
import type { Project } from '@/types/project';

const riskVariant: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  Low:      'success',
  Medium:   'warning',
  High:     'danger',
  Critical: 'danger',
};

export default function ProjectForecastingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = Number(projectId);
  const { forecasts, loading, fetchForecasts, generateForecast } = useForecasting(pid);
  const { fetchProject } = useProjects();
  const [project, setProject] = useState<Project | null>(null);
  const [generating, setGenerating] = useState(false);
  const [period, setPeriod] = useState<'Weekly' | 'Monthly' | 'PhaseEnd'>('Monthly');

  useEffect(() => {
    fetchForecasts();
    fetchProject(pid).then(setProject);
  }, [pid]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generateForecast({ projectId: pid, period, planningWeeks: 4 });
      toast.success('Forecast generated!');
    } catch {
      toast.error('Failed to generate forecast. Ensure the ML service is running.');
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <Spinner />;

  const latest = forecasts[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Demand Forecasting</h1>
          <p className="text-sm text-gray-500">{project?.name ?? `Project #${pid}`}</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-36" value={period} onChange={e => setPeriod(e.target.value as any)}>
            <option value="Weekly">Weekly</option>
            <option value="Monthly">Monthly</option>
            <option value="PhaseEnd">Phase End</option>
          </select>
          <Button onClick={handleGenerate} loading={generating}>
            <Zap size={14} /> Generate Forecast
          </Button>
        </div>
      </div>

      {latest && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Latest Forecast — {latest.period}</h2>
              {latest.modelAccuracy && (
                <Badge variant="info">Accuracy: {latest.modelAccuracy.toFixed(1)}%</Badge>
              )}
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>Material</Th>
                  <Th>Unit</Th>
                  <Th>Forecasted Qty</Th>
                  <Th>Current Stock</Th>
                  <Th>Shortage</Th>
                  <Th>Reorder Suggestion</Th>
                  <Th>Risk</Th>
                </tr>
              </thead>
              <tbody>
                {latest.forecastedMaterials?.map(m => (
                  <Tr key={m.materialId}>
                    <Td className="font-medium">{m.materialName}</Td>
                    <Td>{m.unit}</Td>
                    <Td>{m.forecastedQuantity.toLocaleString()}</Td>
                    <Td className={m.currentStock < m.forecastedQuantity ? 'text-red-600 font-medium' : ''}>
                      {m.currentStock.toLocaleString()}
                    </Td>
                    <Td className={m.shortage > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>
                      {m.shortage > 0 ? m.shortage.toLocaleString() : '—'}
                    </Td>
                    <Td>{m.reorderSuggestion > 0 ? m.reorderSuggestion.toLocaleString() : '—'}</Td>
                    <Td><Badge variant={riskVariant[m.riskLevel]}>{m.riskLevel}</Badge></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {(!latest.forecastedMaterials || latest.forecastedMaterials.length === 0) && (
              <p className="text-center text-gray-400 py-8 text-sm">No materials in this forecast.</p>
            )}
          </CardBody>
        </Card>
      )}

      {!latest && (
        <div className="text-center py-16 card">
          <p className="text-gray-500">No forecasts yet. Click "Generate Forecast" to run the ML model.</p>
        </div>
      )}

      {forecasts.length > 1 && (
        <Card>
          <CardHeader><h2 className="font-semibold">Forecast History ({forecasts.length})</h2></CardHeader>
          <CardBody className="divide-y">
            {forecasts.slice(1).map((f, i) => (
              <div key={i} className="py-2 flex justify-between text-sm">
                <span className="text-gray-700">{f.period} forecast</span>
                <span className="text-gray-400">{new Date(f.generatedAt).toLocaleString()}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
