import { useState } from 'react';
import api from '@/lib/api';
import type {
  ProcurementRecommendation, PurchaseRequest, PurchaseRequestCreateRequest,
  RedistributionRecommendation, RedistributeFromExcessRequest, RedistributionTargetSuggestion,
} from '@/types/procurement';

export function useProcurement(projectId: number) {
  const [recommendations, setRecommendations] = useState<ProcurementRecommendation[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([]);
  const [redistribution, setRedistribution]    = useState<RedistributionRecommendation[]>([]);
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

  async function generateRedistribution() {
    await api.post('/redistribution/generate', {});
    await fetchRedistribution();
  }

  async function approveTransfer(id: number) {
    await api.post(`/redistribution/${id}/approve`, {});
    await fetchRedistribution();
  }

  async function redistributeFromExcess(payload: RedistributeFromExcessRequest): Promise<RedistributionRecommendation> {
    const { data } = await api.post<RedistributionRecommendation>('/redistribution/from-excess', payload);
    await fetchRedistribution();
    return data;
  }

  async function suggestTargets(excessWasteRecordId: number): Promise<RedistributionTargetSuggestion[]> {
    const { data } = await api.get<RedistributionTargetSuggestion[]>(`/redistribution/suggest-targets/${excessWasteRecordId}`);
    return data;
  }

  return {
    recommendations, purchaseRequests, redistribution, loading,
    fetchRecommendations, generateRecommendations,
    createPurchaseRequest,
    fetchRedistribution, generateRedistribution, approveTransfer, redistributeFromExcess, suggestTargets,
  };
}
