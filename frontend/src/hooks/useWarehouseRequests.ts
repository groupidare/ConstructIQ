import { useState } from 'react';
import api from '@/lib/api';
import type { BulkRequestItem, BulkRequestResult, WarehouseRequest, WarehouseRequestCreateRequest } from '@/types/warehouseRequest';

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

  async function createBulk(projectId: number, items: BulkRequestItem[]): Promise<BulkRequestResult[]> {
    const { data } = await api.post<BulkRequestResult[]>('/warehouse-requests/bulk', { projectId, items });
    return data;
  }

  // Each stands alone, so one failing doesn't undo or stop the rest.
  async function approveMany(approvals: { id: number; approvedQuantity: number }[]): Promise<{ id: number; message: string }[]> {
    const failed: { id: number; message: string }[] = [];
    for (const { id, approvedQuantity } of approvals) {
      try {
        await api.post(`/warehouse-requests/${id}/approve`, { approvedQuantity });
      } catch (error) {
        const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
        failed.push({ id, message: message ?? 'Failed to approve.' });
      }
    }
    await fetchAll();
    return failed;
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

  return { requests, loading, fetchAll, createRequest, createBulk, approveRequest, approveMany, rejectRequest, fetchByProject };
}
