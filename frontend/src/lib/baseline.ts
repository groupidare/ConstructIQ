import type { RowBaseline } from '@/types/boq';

// Live version of the server's BaselineCalculator.Alerts, so the Alerts
// column follows an Est. Qty the user is still editing. Why a row has no
// baseline at all (baselineReason) always comes from the server.
const PURCHASE_UNIT_ALIASES: Record<string, string> = {
  pc: 'pc', pcs: 'pc', piece: 'pc', pieces: 'pc',
  sht: 'sheet', sheet: 'sheet', sheets: 'sheet',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  bag: 'bag', bags: 'bag', box: 'box', boxes: 'box',
  set: 'set', sets: 'set', roll: 'roll', rolls: 'roll',
  pail: 'pail', pails: 'pail', can: 'can', cans: 'can',
  'sq.m': 'sq.m', sqm: 'sq.m', m2: 'sq.m', 'cu.m': 'cu.m', m3: 'cu.m', 'l.m': 'l.m', lm: 'l.m', m: 'l.m',
};

export const unitKey = (unit?: string | null) => {
  const u = (unit ?? '').trim().toLowerCase();
  return PURCHASE_UNIT_ALIASES[u] ?? u;
};

export const FAR_FROM_EXPECTED_TOLERANCE = 0.25;

export interface BaselineAlert { code: string; text: string }

export function baselineAlerts(row: RowBaseline & { estimatedPurchaseQuantity?: number; estimatedPurchaseUnit?: string }): BaselineAlert[] {
  switch (row.baselineReason) {
    case 'no properties':
      return [{ code: 'missing_properties', text: 'Missing material properties — no engineering baseline' }];
    case 'unit mismatch':
      return [{ code: 'unit_mismatch', text: "The material's properties don't fit this row's unit" }];
    case 'needs thickness/volume':
      return [{ code: 'needs_volume', text: 'Needs a thickness or volume (this row is in sq.m)' }];
  }
  const baseline = row.baselineQuantity ?? 0;
  const est = row.estimatedPurchaseQuantity ?? 0;
  if (row.baselineReason || baseline <= 0 || est <= 0) return [];
  if (row.estimatedPurchaseUnit && unitKey(row.estimatedPurchaseUnit) !== unitKey(row.baselineUnit))
    return [{ code: 'unit_mismatch', text: `Est. Qty is in ${row.estimatedPurchaseUnit}, the baseline in ${row.baselineUnit}` }];
  const deviation = Math.abs(est - baseline) / baseline;
  return deviation > FAR_FROM_EXPECTED_TOLERANCE
    ? [{ code: 'far_from_expected', text: `Far from expected — ${Math.round(deviation * 100)}% ${est > baseline ? 'above' : 'below'} the ≈${row.baselinePurchaseQuantity} ${row.baselineUnit} baseline` }]
    : [];
}

// "Expected ≈ 247 sheet (708.5 m² ÷ 2.88 m²/sheet)" — the Est. Qty tooltip.
export function expectedText(row: RowBaseline): string | null {
  if (row.baselinePurchaseQuantity == null || !row.baselineFormula) return null;
  return `Expected ≈ ${row.baselinePurchaseQuantity.toLocaleString()} ${row.baselineUnit ?? ''} (${row.baselineFormula})`;
}
