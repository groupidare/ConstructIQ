import { useState } from 'react';
import api from '@/lib/api';
import type { ExcessWasteRecord, ExcessWasteCreateRequest, ExcessAnalyticsSummary } from '@/types/excess';

export function useExcess(projectId: number) {
  const [records, setRecords]   = useState<ExcessWasteRecord[]>([]);
  const [summary, setSummary]   = useState<ExcessAnalyticsSummary | null>(null);
  const [loading, setLoading]   = useState(false);

  async function fetchRecords() {
    setLoading(true);
    const { data } = await api.get<ExcessWasteRecord[]>(`/excess-waste/project/${projectId}`);
    setRecords(data);
    setLoading(false);
  }

  async function fetchSummary() {
    const { data } = await api.get<ExcessAnalyticsSummary>(`/excess-waste/summary/${projectId}`);
    setSummary(data);
  }

  async function createRecord(payload: ExcessWasteCreateRequest): Promise<ExcessWasteRecord> {
    const { data } = await api.post<ExcessWasteRecord>('/excess-waste', payload);
    setRecords(prev => [data, ...prev]);
    return data;
  }

  return { records, summary, loading, fetchRecords, fetchSummary, createRecord };
}
