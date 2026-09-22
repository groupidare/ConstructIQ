import { useState } from 'react';
import api from '@/lib/api';
import type { WarehouseStockItem, WarehouseStockSyncResult } from '@/types/warehouseStock';

export function useWarehouseStock() {
  const [items, setItems]     = useState<WarehouseStockItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function fetchItems() {
    setLoading(true);
    try {
      const { data } = await api.get<WarehouseStockItem[]>('/warehouse-stock');
      setItems(data);
    } catch {
      setError('Failed to load warehouse stock.');
    } finally {
      setLoading(false);
    }
  }

  async function sync(): Promise<WarehouseStockSyncResult> {
    setSyncing(true);
    try {
      const { data } = await api.post<WarehouseStockSyncResult>('/warehouse-stock/sync');
      setItems(data.items);
      return data;
    } finally {
      setSyncing(false);
    }
  }

  return { items, loading, syncing, error, fetchItems, sync };
}
