import type { WarehouseStockItem, WarehouseStockLink } from '@/types/warehouseStock';

// Which warehouse item a BOQ row is, so its Material Plan row can say whether
// there's stock. The sheet lists what the warehouse counts ("Concrete Hollow
// Block, 100mm, Class A") and a BOQ describes the work ("Concrete Hollow Block
// 4" (100mm), interior partitions"), so names rarely match exactly. A person's
// link decides first; automatic matching only claims the obvious.
//
// Deliberately strict: a wrong match shows stock of a different material. A
// missed one reads "Not in inventory", where the user can link it by hand.

export type RowStock =
  | { status: 'inStock'; item: WarehouseStockItem; linked: boolean }
  | { status: 'noStock'; item: WarehouseStockItem; linked: boolean }
  // confirmed: someone said the warehouse doesn't carry this.
  | { status: 'notListed'; confirmed: boolean };

// Describe a grade, form or packaging rather than what the material is.
const IGNORED_WORDS = new Set([
  'and', 'with', 'for', 'the', 'class', 'grade', 'type', 'thick', 'dia',
  'bag', 'pack', 'roll', 'gallon', 'inch', 'series', 'steel', 'reinforcing', 'copper',
]);

export const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

// Brackets hold where it's used ("(living, dining, kitchen)"), not what it is.
function materialWords(name: string): Set<string> {
  const words = name.toLowerCase().replace(/\([^)]*\)/g, ' ').match(/[a-z]{3,}/g) ?? [];
  return new Set(words.filter(w => !IGNORED_WORDS.has(w)));
}

// The name's main dimension: its first "100mm", "25kg" or '3/4'. Later sizes
// describe something else ("100mm, interior partitions, 10mm bars").
function mainSize(name: string): string | undefined {
  const m = name.toLowerCase().match(/\d+\/\d+|\d+(?:\.\d+)?\s*(?:mm|cm|kg)\b/);
  return m?.[0].replace(/\s+/g, '');
}

function isSameMaterial(rowName: string, itemName: string): boolean {
  const rowWords = materialWords(rowName);
  const itemWords = materialWords(itemName);
  if (itemWords.size === 0 || ![...itemWords].every(w => rowWords.has(w))) return false;
  const size = mainSize(itemName);
  return !size || mainSize(rowName) === size;
}

export function findWarehouseItem(rowName: string, items: WarehouseStockItem[]): WarehouseStockItem | undefined {
  if (!rowName.trim()) return undefined;
  const key = nameKey(rowName);
  const exact = items.find(i => nameKey(i.materialName) === key);
  if (exact) return exact;
  const matches = items.filter(i => isSameMaterial(rowName, i.materialName));
  // Two candidates can't be told apart, so neither is claimed.
  return matches.length === 1 ? matches[0] : undefined;
}

export function indexLinks(links: WarehouseStockLink[]): Map<string, string | null> {
  return new Map(links.map(l => [nameKey(l.boqName), l.warehouseMaterialName]));
}

export function rowStock(rowName: string, items: WarehouseStockItem[], links: Map<string, string | null>): RowStock {
  const key = nameKey(rowName);
  if (links.has(key)) {
    const linkedName = links.get(key);
    if (linkedName == null) return { status: 'notListed', confirmed: true };
    const linked = items.find(i => nameKey(i.materialName) === nameKey(linkedName));
    // Gone from the sheet (renamed or removed): back to matching on its own.
    if (linked) return { status: linked.balance > 0 ? 'inStock' : 'noStock', item: linked, linked: true };
  }
  const item = findWarehouseItem(rowName, items);
  if (!item) return { status: 'notListed', confirmed: false };
  return { status: item.balance > 0 ? 'inStock' : 'noStock', item, linked: false };
}

export const countUnit = (unit: string) => {
  const lower = unit.trim().toLowerCase();
  return lower === 'pcs' || lower === 'piece' || lower === 'pieces' ? 'pc' : lower;
};

// What to pre-fill when asking the warehouse: all it has, up to what's needed.
// null: the row counts in another unit (sq.m against boxes), and the balance
// can't be converted without knowing the material, so the user enters it.
export function warehouseRequestQuantity(stock: RowStock | undefined, needed: number, rowUnit: string): number | null {
  if (stock?.status !== 'inStock') return needed;
  if (countUnit(stock.item.unit) !== countUnit(rowUnit)) return null;
  return Math.min(needed, stock.item.balance);
}

interface Similarity {
  item: WarehouseStockItem;
  shared: number;
  ratio: number;
  sameSize: boolean;
  sizeConflict: boolean;
}

// Sizes only conflict in the same measure: 16mm says nothing against a 40kg bag.
const sizeMeasure = (size: string) => (size.includes('/') ? 'in' : size.replace(/[\d.]/g, ''));

function compare(rowName: string, item: WarehouseStockItem): Similarity {
  const rowWords = materialWords(rowName);
  const itemWords = materialWords(item.materialName);
  const shared = [...itemWords].filter(w => rowWords.has(w)).length;
  const rowSize = mainSize(rowName);
  const itemSize = mainSize(item.materialName);
  const comparable = !!rowSize && !!itemSize && sizeMeasure(rowSize) === sizeMeasure(itemSize);
  return {
    item, shared,
    ratio: itemWords.size ? shared / itemWords.size : 0,
    sameSize: comparable && rowSize === itemSize,
    sizeConflict: comparable && rowSize !== itemSize,
  };
}

// Closest warehouse items, for the user to pick from: a differing size is
// still more useful to see than an unrelated material, so it only costs some rank.
const rank = (s: Similarity) => s.ratio * (s.sizeConflict ? 0.75 : 1);

export function similarItems(rowName: string, items: WarehouseStockItem[], limit = 5): WarehouseStockItem[] {
  return items
    .map(item => compare(rowName, item))
    .filter(s => s.shared > 0)
    .sort((a, b) => rank(b) - rank(a) || b.shared - a.shared || b.item.balance - a.item.balance)
    .slice(0, limit)
    .map(s => s.item);
}

// Worth stopping a purchase for: in stock and plausibly the same material.
// Stricter than similarItems — asked at every cart click, so a loose rule
// ("Cement Plaster" vs "Portland Cement") would soon get clicked past unread.
export function similarInStock(rowName: string, items: WarehouseStockItem[]): WarehouseStockItem[] {
  return items
    .filter(item => item.balance > 0)
    .map(item => compare(rowName, item))
    .filter(s => !s.sizeConflict && s.ratio >= 0.5 && (s.shared >= 2 || s.sameSize))
    .sort((a, b) => b.ratio - a.ratio || b.shared - a.shared)
    .map(s => s.item);
}
