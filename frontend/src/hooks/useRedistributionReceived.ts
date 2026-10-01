import { useState } from 'react';
import api from '@/lib/api';
import type { ReceivedRedistribution } from '@/types/procurement';

// How much of each material a project has received via approved
// redistribution — subtracted from Estimated Qty when capping how much more
// can be requested via Notify Procurement/Warehouse (see MaterialPlanTab).
export function useRedistributionReceived(projectId: number) {
  const [receivedByMaterial, setReceivedByMaterial] = useState<Record<number, number>>({});

  async function fetchReceived() {
    const { data } = await api.get<ReceivedRedistribution[]>(`/redistribution/received/${projectId}`);
    setReceivedByMaterial(Object.fromEntries(data.map(d => [d.materialId, d.totalQuantity])));
  }

  return { receivedByMaterial, fetchReceived };
}
