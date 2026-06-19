import { useState } from 'react';
import api from '@/lib/api';
import type { InventoryRecord, MovementCreateRequest } from '@/types/inventory';

export function useInventory(projectId: number) {
  const [inventory, setInventory] = useState<InventoryRecord[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function fetchInventory() {
    setLoading(true);
    try {
      const { data } = await api.get<InventoryRecord[]>(`/inventory/project/${projectId}`);
      setInventory(data);
    } catch {
      setError('Failed to load inventory.');
    } finally {
      setLoading(false);
    }
  }

  async function recordMovement(payload: MovementCreateRequest) {
    await api.post('/inventory/movement', payload);
    await fetchInventory();
  }

  return { inventory, loading, error, fetchInventory, recordMovement };
}
