import { useState } from 'react';
import api from '@/lib/api';
import type { CreatePurchaseOrderRequest, PurchaseOrder } from '@/types/purchaseOrder';

// projectId omitted = all projects (used by the standalone /procurement page).
export function usePurchaseOrders(projectId?: number) {
  const [items, setItems]     = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function fetchItems() {
    setLoading(true);
    try {
      const { data } = await api.get<PurchaseOrder[]>('/purchase-orders', {
        params: projectId ? { projectId } : {},
      });
      setItems(data);
    } catch {
      setError('Failed to load purchase orders.');
    } finally {
      setLoading(false);
    }
  }

  async function createOrder(payload: CreatePurchaseOrderRequest): Promise<PurchaseOrder> {
    const { data } = await api.post<PurchaseOrder>('/purchase-orders', payload);
    setItems(prev => [data, ...prev]);
    return data;
  }

  // boqItemId = null clears an existing link.
  async function linkMaterial(materialId: number, boqItemId: number | null): Promise<void> {
    await api.patch(`/purchase-orders/materials/${materialId}/link`, { boqItemId });
  }

  return { items, loading, error, fetchItems, createOrder, linkMaterial };
}
