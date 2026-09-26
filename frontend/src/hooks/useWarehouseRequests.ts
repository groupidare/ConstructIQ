import { useState } from 'react';
import api from '@/lib/api';
import type { WarehouseRequest, WarehouseRequestCreateRequest } from '@/types/warehouseRequest';

export function useWarehouseRequests() {
  const [requests, setRequests] = useState<WarehouseRequest[]>([]);
  const [loading, setLoading]   = useState(false);

  async function fetchAll() {
    setLoading(true);
    try {
      const { data } = await api.get<WarehouseRequest[]>('/warehouse-requests');
      setRequests(data);
    } finally {
      setLoading(false);
    }
  }

  async function createRequest(payload: WarehouseRequestCreateRequest): Promise<WarehouseRequest> {
    const { data } = await api.post<WarehouseRequest>('/warehouse-requests', payload);
    setRequests(prev => [data, ...prev]);
    return data;
  }

  async function approveRequest(id: number, approvedQuantity: number) {
    await api.post(`/warehouse-requests/${id}/approve`, { approvedQuantity });
    await fetchAll();
  }

  async function rejectRequest(id: number) {
    await api.post(`/warehouse-requests/${id}/reject`, {});
    await fetchAll();
  }

  async function fetchByProject(projectId: number): Promise<WarehouseRequest[]> {
    const { data } = await api.get<WarehouseRequest[]>(`/warehouse-requests/project/${projectId}`);
    return data;
  }

  return { requests, loading, fetchAll, createRequest, approveRequest, rejectRequest, fetchByProject };
}
