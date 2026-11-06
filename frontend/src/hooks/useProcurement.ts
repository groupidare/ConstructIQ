import { useState } from 'react';
import api from '@/lib/api';
import type {
  ProcurementRecommendation, PurchaseRequest, PurchaseRequestCreateRequest,
  RedistributionRecommendation, ExcessRelease,
} from '@/types/procurement';

export function useProcurement(projectId: number) {
  const [recommendations, setRecommendations] = useState<ProcurementRecommendation[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([]);
  const [redistribution, setRedistribution]    = useState<RedistributionRecommendation[]>([]);
  const [excessReleases, setExcessReleases]    = useState<ExcessRelease[]>([]);
  const [loading, setLoading] = useState(false);

  async function fetchRecommendations() {
    setLoading(true);
    const { data } = await api.get<ProcurementRecommendation[]>(`/procurement/recommendations/${projectId}`);
    setRecommendations(data);
    setLoading(false);
  }

  async function generateRecommendations() {
    await api.post(`/procurement/recommendations/generate/${projectId}`, {});
    await fetchRecommendations();
  }

  async function createPurchaseRequest(payload: PurchaseRequestCreateRequest): Promise<PurchaseRequest> {
    const { data } = await api.post<PurchaseRequest>('/procurement/purchase-requests', payload);
    setPurchaseRequests(prev => [...prev, data]);
    return data;
  }

  async function fetchRedistribution() {
    const { data } = await api.get<RedistributionRecommendation[]>('/redistribution');
    setRedistribution(data);
  }

  async function fetchExcessReleases() {
    const { data } = await api.get<ExcessRelease[]>('/redistribution/excess-releases');
    setExcessReleases(data);
  }

  async function approveTransfer(id: number) {
    await api.post(`/redistribution/${id}/approve`, {});
    await fetchRedistribution();
  }

  async function rejectTransfer(id: number) {
    await api.post(`/redistribution/${id}/reject`, {});
    await fetchRedistribution();
  }

  return {
    recommendations, purchaseRequests, redistribution, excessReleases, loading,
    fetchRecommendations, generateRecommendations,
    createPurchaseRequest,
    fetchRedistribution, fetchExcessReleases, approveTransfer, rejectTransfer,
  };
}
