import api from '@/lib/api';
import type { Phase } from '@/types/project';

export interface AddPhaseRequest {
  projectId: number;
  name: string;
  order?: number;
  startDate: string;
  endDate: string;
}

export function usePhases() {
  async function addPhase(payload: AddPhaseRequest): Promise<Phase> {
    const { data } = await api.post<Phase>('/phases', payload);
    return data;
  }

  async function deletePhase(id: number): Promise<void> {
    await api.delete(`/phases/${id}`);
  }

  return { addPhase, deletePhase };
}
