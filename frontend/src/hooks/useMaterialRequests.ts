import { useState } from 'react';
import api from '@/lib/api';
import type { MaterialRequest, MaterialRequestCreateRequest } from '@/types/materialRequest';

export function useMaterialRequests() {
  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [loading, setLoading]   = useState(false);

  async function fetchAll() {
    setLoading(true);
    try {
      const { data } = await api.get<MaterialRequest[]>('/material-requests');
      setRequests(data);
    } finally {
      setLoading(false);
    }
  }

  async function createRequest(payload: MaterialRequestCreateRequest): Promise<MaterialRequest> {
    const { data } = await api.post<MaterialRequest>('/material-requests', payload);
    setRequests(prev => [data, ...prev]);
    return data;
  }

  async function approveRequest(id: number) {
    await api.post(`/material-requests/${id}/approve`, {});
    await fetchAll();
  }

  return { requests, loading, fetchAll, createRequest, approveRequest };
}
