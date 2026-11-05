import { countUnit, warehouseRequestQuantity, type RowStock } from '@/lib/warehouseStockMatch';

// Sorts a Material Plan's rows into who each should be requested from, so they
// can be sent together: stock goes to the warehouse first, no stock goes to
// Procurement, and anything doubtful waits for a person.

export type BulkGroup = 'warehouse' | 'procurement' | 'afterWarehouse' | 'needsInput' | 'hidden';

export interface BulkRowInput {
  id: number;
  materialId: number;
  name: string;
  areaUnit?: string;
  materialUnit?: string;
  materialQuantity?: number;
  netLeftToOrder?: number;
  remainingRequestable?: number;
  warehouseApproved: boolean;
  warehousePendingQuantity: number;
  onSiteStock: number;
  // undefined: the warehouse list couldn't be loaded.
  stock?: RowStock;
  hasSimilarInStock: boolean;
}

export interface BulkEntry {
  row: BulkRowInput;
  group: BulkGroup;
  // null: only the user can say (the warehouse counts it in another unit).
  quantity: number | null;
  note?: string;
  reason?: 'missing' | 'similar' | 'stockUnknown';
  missing?: string[];
  hiddenBecause?: 'done' | 'waiting';
}

// What a request needs before it can go, in the table's own column names.
export function missingRequestFields(row: { unit?: string; estimatedPurchaseUnit?: string; estimatedPurchaseQuantity?: number }): string[] {
  const missing: string[] = [];
  if (!row.unit?.trim()) missing.push('Area Unit');
  if (!row.estimatedPurchaseUnit?.trim()) missing.push('Material Unit');
  if ((row.estimatedPurchaseQuantity ?? 0) <= 0) missing.push('Material Quantity');
  return missing;
}

export function planBulkRequests(rows: BulkRowInput[]): BulkEntry[] {
  // Each row can only count on what earlier rows and open requests haven't
  // already claimed: the sheet's balance doesn't change until a release is
  // recorded, so 50 pc must not be promised to two rows.
  const available = new Map<string, number>();
  const stillAvailable = (name: string, balance: number) => available.get(name) ?? balance;
  for (const row of rows) {
    if (row.stock?.status !== 'inStock' || row.warehousePendingQuantity <= 0) continue;
    const { item } = row.stock;
    if (countUnit(item.unit) === countUnit(row.materialUnit ?? '')) {
      available.set(item.materialName, stillAvailable(item.materialName, item.balance) - row.warehousePendingQuantity);
    }
  }

  return rows.map((row): BulkEntry => {
    const missing = missingRequestFields({ unit: row.areaUnit, estimatedPurchaseUnit: row.materialUnit, estimatedPurchaseQuantity: row.materialQuantity });
    if (missing.length > 0) return { row, group: 'needsInput', quantity: null, reason: 'missing', missing, note: `Missing: ${missing.join(', ')}` };

    if (row.warehousePendingQuantity > 0) return { row, group: 'hidden', quantity: null, hiddenBecause: 'waiting' };

    const estimate = row.materialQuantity!;
    const needed = Math.min(row.netLeftToOrder ?? estimate, row.remainingRequestable ?? estimate, estimate);
    if (needed <= 0) return { row, group: 'hidden', quantity: null, hiddenBecause: 'done' };

    const toBuy = Math.max(0, needed - row.onSiteStock);
    const procurement = (group: 'procurement' | 'afterWarehouse', note?: string): BulkEntry =>
      toBuy > 0 ? { row, group, quantity: toBuy, note } : { row, group: 'hidden', quantity: null, hiddenBecause: 'done' };

    if (!row.stock) return { row, group: 'needsInput', quantity: null, reason: 'stockUnknown', note: "Couldn't check the warehouse's stock" };

    if (row.stock.status === 'inStock') {
      if (row.warehouseApproved) return procurement('afterWarehouse', 'Warehouse has answered; this is the rest');

      const { item } = row.stock;
      const stockNote = `In warehouse: ${item.balance.toLocaleString()} ${item.unit}`;
      const left = stillAvailable(item.materialName, item.balance);
      if (left <= 0) return procurement('procurement', `${stockNote}, already assigned to other requests`);

      const quantity = warehouseRequestQuantity(row.stock, Math.min(needed, left), row.materialUnit ?? '');
      if (quantity === null) {
        return { row, group: 'warehouse', quantity: null, note: `${stockNote}. This row is in ${row.materialUnit}, so enter the quantity` };
      }
      available.set(item.materialName, left - quantity);
      return { row, group: 'warehouse', quantity, note: quantity < needed ? `${stockNote}. The rest can go to Procurement after approval` : stockNote };
    }

    if (row.stock.status === 'notListed' && !row.stock.confirmed && row.hasSimilarInStock) {
      return { row, group: 'needsInput', quantity: toBuy, reason: 'similar', note: 'A similar item is in the warehouse' };
    }
    return procurement('procurement', row.stock.status === 'noStock' ? 'No stock' : 'Not in inventory');
  });
}
