import { useState } from 'react';
import api from '@/lib/api';
import { nameKey } from '@/lib/warehouseStockMatch';
import type { WarehouseStockItem, WarehouseStockLink, WarehouseStockSyncResult } from '@/types/warehouseStock';

export function useWarehouseStock() {
  const [items, setItems]     = useState<WarehouseStockItem[]>([]);
  const [links, setLinks]     = useState<WarehouseStockLink[]>([]);
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

  // Balances fresh enough to decide on: refreshed from the sheet if stale.
  async function fetchCurrent() {
    setLoading(true);
    try {
      const { data } = await api.get<WarehouseStockItem[]>('/warehouse-stock/current');
      setItems(data);
    } catch {
      setError('Failed to load warehouse stock.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchLinks() {
    try {
      const { data } = await api.get<WarehouseStockLink[]>('/warehouse-stock/links');
      setLinks(data);
    } catch {
      setError('Failed to load inventory links.');
    }
  }

  const withoutLink = (list: WarehouseStockLink[], boqName: string) =>
    list.filter(l => nameKey(l.boqName) !== nameKey(boqName));

  // warehouseMaterialName null: the warehouse doesn't carry this material.
  async function saveLink(projectId: number, boqName: string, warehouseMaterialName: string | null) {
    const { data } = await api.put<WarehouseStockLink>('/warehouse-stock/links', { projectId, boqName, warehouseMaterialName });
    setLinks(prev => [...withoutLink(prev, boqName), data]);
  }

  async function removeLink(projectId: number, boqName: string) {
    await api.delete('/warehouse-stock/links', { params: { projectId, boqName } });
    setLinks(prev => withoutLink(prev, boqName));
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

  return { items, links, loading, syncing, error, fetchItems, fetchCurrent, fetchLinks, saveLink, removeLink, sync };
}
