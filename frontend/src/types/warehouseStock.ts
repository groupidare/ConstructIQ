export interface WarehouseStockItem {
  id: number;
  materialName: string;
  unit: string;
  balance: number;
  syncedAt: string;
}

// A person's answer to which warehouse item a BOQ wording really is.
export interface WarehouseStockLink {
  boqName: string;
  // null: the warehouse doesn't carry it.
  warehouseMaterialName: string | null;
}

export interface WarehouseStockSyncResult {
  itemCount: number;
  syncedAt: string;
  items: WarehouseStockItem[];
}
