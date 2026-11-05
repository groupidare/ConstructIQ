import { PURCHASE_UNITS, type BOQItemRow } from '@/types/boq';

/** The Material Unit choice a unit label stands for: pcs → pc, sets → set; undefined if it isn't one. */
export function toPurchaseUnitOption(unit: string): string | undefined {
  const lower = unit.trim().toLowerCase();
  const folded = lower === 'pcs' || lower === 'piece' || lower === 'pieces' ? 'pc' : lower;
  return (PURCHASE_UNITS as readonly string[]).find(u => u === folded || `${u}s` === folded || `${u}es` === folded);
}

/** Something has been asked for or approved against this row: its quantity is no longer just a plan. */
export const hasRequests = (row: BOQItemRow) =>
  (row.requestedQuantity ?? 0) > 0 || (row.askedQuantity ?? 0) > 0 || (row.approvedQuantity ?? 0) > 0;

// Area Units that already count what's bought. No historical BOQ row is in
// either, so the forecast has nothing to learn from for them; every other
// Area Unit (sq.m, l.m, bag…) is left to the forecast.
const COUNTED_AS_BOUGHT = new Set(['pc', 'set']);

/** Run Forecast's rule: a BOQ row counted in pieces or sets (7 sets) is bought
 *  exactly as counted, so its Material Unit and Quantity are its Area Unit and
 *  Total Area. Null for any other Area Unit, or a row with no Total Area. */
export function materialFromArea(row: BOQItemRow): { estimatedPurchaseUnit: string; estimatedPurchaseQuantity: number } | null {
  const unit = toPurchaseUnitOption(row.unit ?? '');
  return unit && COUNTED_AS_BOUGHT.has(unit) && row.estimatedQuantity > 0
    ? { estimatedPurchaseUnit: unit, estimatedPurchaseQuantity: row.estimatedQuantity }
    : null;
}
