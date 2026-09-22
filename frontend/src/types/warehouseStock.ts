export interface WarehouseStockItem {
  id: number;
  materialName: string;
  unit: string;
  balance: number;
  syncedAt: string;
}

export interface WarehouseStockSyncResult {
  itemCount: number;
  syncedAt: string;
  items: WarehouseStockItem[];
}
