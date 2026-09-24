import { useState } from 'react';
import api from '@/lib/api';
import type {
  MaterialRequest, ProjectWithRequests, SuggestedSupplier,
  CreateMaterialRequestPayload, GeneratePOsFromRequestsPayload, GeneratedPOsResult,
} from '@/types/materialRequest';

export function useMaterialRequests() {
  const [projectsWithPending, setProjectsWithPending] = useState<ProjectWithRequests[]>([]);
  const [loading, setLoading] = useState(false);

  async function createRequest(payload: CreateMaterialRequestPayload): Promise<void> {
    await api.post('/material-requests', payload);
  }

  async function fetchProjectsWithPending() {
    setLoading(true);
    try {
      const { data } = await api.get<ProjectWithRequests[]>('/material-requests/projects-with-pending');
      setProjectsWithPending(data);
    } finally {
      setLoading(false);
    }
  }

  async function fetchForProject(projectId: number): Promise<MaterialRequest[]> {
    const { data } = await api.get<MaterialRequest[]>(`/material-requests/project/${projectId}`);
    return data;
  }

  async function fetchSuggestedSuppliers(materialId: number): Promise<SuggestedSupplier[]> {
    const { data } = await api.get<SuggestedSupplier[]>(`/material-requests/suggested-suppliers/${materialId}`);
    return data;
  }

  async function generatePOs(payload: GeneratePOsFromRequestsPayload): Promise<GeneratedPOsResult> {
    const { data } = await api.post<GeneratedPOsResult>('/material-requests/generate-pos', payload);
    return data;
  }

  return {
    projectsWithPending, loading,
    createRequest, fetchProjectsWithPending, fetchForProject, fetchSuggestedSuppliers, generatePOs,
  };
}
