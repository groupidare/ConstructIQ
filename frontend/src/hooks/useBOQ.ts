import { useState } from 'react';
import api from '@/lib/api';
import type { BOQItem, BOQItemRow } from '@/types/boq';

export function useBOQ(projectId: number) {
  const [items, setItems]     = useState<BOQItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function fetchItems() {
    setLoading(true);
    try {
      const { data } = await api.get<BOQItem[]>(`/boq/project/${projectId}`);
      setItems(data);
    } catch {
      setError('Failed to load bill of quantities.');
    } finally {
      setLoading(false);
    }
  }

  async function saveItems(rows: BOQItemRow[]): Promise<BOQItem[]> {
    const { data } = await api.post<BOQItem[]>('/boq/bulk', { projectId, items: rows });
    setItems(data);
    return data;
  }

  async function deleteItem(id: number) {
    await api.delete(`/boq/${id}`);
    setItems(prev => prev.filter(i => i.id !== id));
  }

  return { items, loading, error, fetchItems, saveItems, deleteItem };
}
