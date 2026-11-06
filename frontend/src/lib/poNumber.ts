// The number a PO is known by: an imported PO shows the number printed on
// the paper PO ("PO 0002098") — its IMP-0xx system number stays internal.
export function displayPoNumber(po: { number: string; isImported?: boolean; originalPoNumber?: string | null }): string {
  const original = po.originalPoNumber?.trim();
  if (!po.isImported || !original) return po.number;
  return /^p\.?\s*o\b/i.test(original) ? original : `PO ${original}`;
}
