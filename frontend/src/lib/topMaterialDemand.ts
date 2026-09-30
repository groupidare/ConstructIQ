import type { BOQItem } from "../types/boq";

export interface MaterialDemand {
  material: string;
  estimated: number;
  actual?: number;
  unit: string;
}

// A catalog ID alone is insufficient: imported rows may carry distinct specs.
export function topMaterialDemand(items: BOQItem[], historical: boolean, recordedIds: Set<number>): MaterialDemand[] {
  const groups = new Map<string, MaterialDemand>();
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  for (const item of items) {
    const hasPurchaseEstimate = item.estimatedPurchaseQuantity != null && !!item.estimatedPurchaseUnit?.trim();
    if (!historical && !hasPurchaseEstimate) continue;
    const material = item.specification?.trim() || item.materialName;
    const unit = (hasPurchaseEstimate ? item.estimatedPurchaseUnit! : item.unit).trim();
    const key = JSON.stringify([item.materialId, normalize(material), normalize(unit)]);
    const estimated = hasPurchaseEstimate ? item.estimatedPurchaseQuantity! : item.estimatedQuantity;
    const actual = recordedIds.has(item.id) || item.actualQuantity > 0 ? item.actualQuantity : undefined;
    const group = groups.get(key);
    if (group) {
      group.estimated += estimated;
      // A partial actual total must not look like usage for the whole group.
      group.actual = group.actual === undefined || actual === undefined ? undefined : group.actual + actual;
    } else {
      groups.set(key, { material, unit, estimated, actual });
    }
  }
  return [...groups.values()].sort((a, b) =>
    (historical ? (b.actual ?? b.estimated) - (a.actual ?? a.estimated) : b.estimated - a.estimated)
    || a.material.localeCompare(b.material)
  ).slice(0, 5);
}
