import { useState } from 'react';
import api from '@/lib/api';
import type { Measurement, MeasurementRow } from '@/types/measurement';

export function useMeasurements(projectId: number) {
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);

  async function fetchMeasurements() {
    setLoading(true);
    try {
      const { data } = await api.get<Measurement[]>(`/measurements/project/${projectId}`);
      setMeasurements(data);
    } catch {
      setError('Failed to load measurements.');
    } finally {
      setLoading(false);
    }
  }

  async function saveMeasurements(items: MeasurementRow[]): Promise<Measurement[]> {
    const { data } = await api.post<Measurement[]>('/measurements/bulk', { projectId, items });
    setMeasurements(data);
    return data;
  }

  return { measurements, loading, error, fetchMeasurements, saveMeasurements };
}
