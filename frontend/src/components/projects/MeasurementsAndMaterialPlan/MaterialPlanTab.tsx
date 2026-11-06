'use client';

import { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Upload, FileText, Trash2, Plus, ShoppingCart, Package, ExternalLink, X, AlertTriangle, Link2, Send, Map as MapIcon } from 'lucide-react';
import { baselineAlerts, expectedText } from '@/lib/baseline';
import { resolveUploadUrl } from '@/lib/avatar';
import { indexLinks, rowStock, similarInStock, warehouseRequestQuantity, type RowStock } from '@/lib/warehouseStockMatch';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import type { Project, ProjectType } from '@/types/project';
import type { ProjectDocument } from '@/types/document';
import type { InventoryRecord } from '@/types/inventory';
import type { WarehouseStockItem, WarehouseStockLink } from '@/types/warehouseStock';
import type { ForecastedMaterial } from '@/types/forecast';
import type { BOQItem, BOQItemRow } from '@/types/boq';
import { PRIMARY_SECTIONS, PURCHASE_UNITS } from '@/types/boq';
import type { PurchaseOrder, PurchaseOrderMaterial } from '@/types/purchaseOrder';
import { missingRequestFields, type BulkRowInput } from '@/lib/bulkRequestPlan';
import type { BulkRequestItem, BulkRequestResult, WarehouseRequest } from '@/types/warehouseRequest';
import type { SentMaterialRequest } from '@/types/materialRequest';
import BulkRequestDialog, { type BulkSendItem } from './BulkRequestDialog';
import StockLinkDialog from './StockLinkDialog';
import { inp, sel, lbl } from './styles';
import ImportPurchaseOrders from '@/components/projects/ImportPurchaseOrders';
import { sourceOf, sourceTooltip } from '@/lib/blueprintSource';

interface Props {
  project: Project;
  editable: boolean;
  projectType: ProjectType;
  otherTypeSpecify: string;
  inventory: InventoryRecord[];
  // The warehouse's balances — the Inventory page's list. Empty until loaded.
  warehouseStock: WarehouseStockItem[];
  warehouseStockLinks: WarehouseStockLink[];
  onBulkRequest: (kind: 'warehouse' | 'procurement', items: BulkRequestItem[]) => Promise<BulkRequestResult[] | null>;
  onRefreshStock: () => Promise<void>;
  onLoadWarehouseRequests: () => Promise<WarehouseRequest[]>;
  onLoadProcurementRequests: () => Promise<SentMaterialRequest[]>;
  onSaveStockLink: (boqName: string, warehouseMaterialName: string | null) => Promise<boolean>;
  onRemoveStockLink: (boqName: string) => Promise<boolean>;
  forecastedMaterials: ForecastedMaterial[];
  boqDocs: ProjectDocument[];
  uploading: boolean;
  onUploadBoq: (file: File) => void;
  onParseBoq: (documentId: number) => Promise<void>;
  rows: BOQItemRow[];
  boqItems: BOQItem[];
  // Also accepts a React-style updater fn — needed by the historical-estimate
  // auto-suggest effect below, which resolves after a delay and must apply
  // its patch to whatever the rows array is *then*, not the stale snapshot
  // it closed over when the lookup started.
  onRowsChange: (rows: BOQItemRow[] | ((prev: BOQItemRow[]) => BOQItemRow[])) => void;
  // "View Plan": the blueprint beside the Material Plan (see index.tsx); a
  // blueprint-generated row clicked while it's open is shown on it.
  planOpen: boolean;
  planFocus: number | null;
  onViewPlan: () => void;
  onPlanFocus: (index: number) => void;
  // Accepts an explicit rows array so a partial-request split (which computes
  // a freshly-updated array in the same tick) can save it immediately without
  // depending on this row state having propagated up first.
  onSave: (overrideRows?: BOQItemRow[], opts?: { silent?: boolean }) => Promise<void>;
  onDeleteRow: (id: number) => Promise<boolean>;
  saving: boolean;
  onNotify: (kind: 'ProcurementOrder' | 'WarehouseCheck', materialId: number | undefined, materialName: string, quantity: number, unit: string, boqItemId: number | undefined) => Promise<boolean>;
  onRemoveDocument: (documentId: number) => void;
  onRunForecast: () => void;
  forecasting: boolean;
  // Purchase Orders — actuals, paired against the BOQ estimates above.
  purchaseOrders: PurchaseOrder[];
  poDocs: ProjectDocument[];
  uploadingPo: boolean;
  savingPo: boolean;
  onUploadPO: (file: File) => void;
  onParsePO: (documentId: number) => Promise<void>;
  onSavePO: () => void;
  onLinkPoMaterial: (materialId: number, boqItemId: number | null) => void;
  // After POs made outside ConstructIQ are imported — refreshes the PO list.
  onPurchaseOrdersImported: () => void;
  poDraftRows: PurchaseOrderMaterial[];
  onPoDraftRowsChange: (rows: PurchaseOrderMaterial[]) => void;
  poSupplierName: string;
  onPoSupplierNameChange: (v: string) => void;
  poOrderDate: string;
  onPoOrderDateChange: (v: string) => void;
  poExpectedDate: string;
  onPoExpectedDateChange: (v: string) => void;
}

const leftAfter = (estimate: number, covered?: number) => Math.max(0, estimate - (covered ?? 0));

function StockBadge({ stock, onClick }: { stock?: RowStock; onClick?: () => void }) {
  if (!stock) return <span style={{ fontSize: '0.72rem', color: '#d1d5db' }}>—</span>;
  const linked = stock.status !== 'notListed' && stock.linked;
  const { label, title, background, color } =
    stock.status === 'inStock' ? {
      label: `In stock: ${stock.item.balance.toLocaleString()} ${stock.item.unit}`,
      title: `${linked ? 'Linked to ' : ''}${stock.item.materialName} — ${stock.item.balance.toLocaleString()} ${stock.item.unit} in the warehouse. Notify the warehouse first.`,
      background: '#dcfce7', color: '#15803d',
    } : stock.status === 'noStock' ? {
      label: 'No stock',
      title: `${linked ? 'Linked to ' : ''}${stock.item.materialName} — 0 ${stock.item.unit} in the warehouse. Notify Procurement to purchase it.`,
      background: '#fee2e2', color: '#b91c1c',
    } : {
      label: 'Not in inventory',
      title: stock.confirmed
        ? 'Marked as not stocked in the warehouse. Notify Procurement to purchase it.'
        : 'No matching item on the warehouse list. Notify Procurement to purchase it, or link it if it\'s listed under another name.',
      background: '#f3f4f6', color: '#6b7280',
    };
  const style: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.62rem', fontWeight: 700, padding: '3px 7px', borderRadius: 999, width: 'fit-content', maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background, color };
  const content = <>{linked && <Link2 style={{ width: 10, height: 10, flexShrink: 0 }} />}{label}</>;
  return onClick
    ? <button type="button" onClick={onClick} title={`${title} Click to change.`} style={{ ...style, border: 'none', cursor: 'pointer' }}>{content}</button>
    : <span title={title} style={style}>{content}</span>;
}

export default function MaterialPlanTab({
  project, editable, projectType, otherTypeSpecify,
  inventory, warehouseStock, warehouseStockLinks, onBulkRequest, onRefreshStock, onLoadWarehouseRequests, onLoadProcurementRequests, onSaveStockLink, onRemoveStockLink, forecastedMaterials, boqDocs, uploading, onUploadBoq, onParseBoq,
  rows, boqItems, onRowsChange, planOpen, planFocus, onViewPlan, onPlanFocus, onSave, onDeleteRow, saving, onNotify, onRemoveDocument, onRunForecast, forecasting,
  purchaseOrders, poDocs, uploadingPo, savingPo, onUploadPO, onParsePO, onSavePO, onLinkPoMaterial, onPurchaseOrdersImported,
  poDraftRows, onPoDraftRowsChange, poSupplierName, onPoSupplierNameChange,
  poOrderDate, onPoOrderDateChange, poExpectedDate, onPoExpectedDateChange,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const poFileInputRef = useRef<HTMLInputElement>(null);
  const [showImport, setShowImport] = useState(false);
  // PO prices are entered and seen only by the roles that manage POs (the
  // backend also nulls them out for everyone else).
  const role = useAuthStore(s => s.user?.role);
  const canSeePrices = role === 'Admin' || role === 'ProcurementOfficer';
  // Display-only: line/PO totals are derived here and never sent or stored.
  const lineTotal = (m: PurchaseOrderMaterial) => (m.unitPrice != null ? m.quantity * m.unitPrice : null);
  const poTotal = (materials: PurchaseOrderMaterial[]) =>
    materials.some(m => m.unitPrice != null) ? materials.reduce((sum, m) => sum + (lineTotal(m) ?? 0), 0) : null;
  const draftPoTotal = poTotal(poDraftRows);
  const draftGridColumns = canSeePrices
    ? 'minmax(0,1.4fr) minmax(0,0.5fr) minmax(0,0.6fr) minmax(0,0.8fr) minmax(0,0.8fr) auto'
    : 'minmax(0,1.6fr) minmax(0,0.6fr) minmax(0,0.7fr) auto';
  const [parsingPoId, setParsingPoId] = useState<number | null>(null);
  const hasPlan = rows.some(r => sourceOf(r)?.readId != null);
  // Partial-quantity request dialog — clicking a row's Notify Procurement/
  // Warehouse button opens this instead of firing the request immediately,
  // so the user can request less than the full Est. Qty (e.g. only what's
  // actually in stock) and have the leftover spun off into its own row.
  const [requestPrompt, setRequestPrompt] = useState<{
    index: number; kind: 'ProcurementOrder' | 'WarehouseCheck'; max: number; unit: string; materialName: string; stockNote?: string;
  } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [openingBulk, setOpeningBulk] = useState(false);
  const [requestPromptQty, setRequestPromptQty] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);
  // beforePurchase: opened by the cart button; onContinue carries on to its
  // request once the user says the similar item isn't the same material.
  const [linkPrompt, setLinkPrompt] = useState<{ rowName: string; beforePurchase: boolean; onContinue?: () => void } | null>(null);
  const stockLinks = useMemo(() => indexLinks(warehouseStockLinks), [warehouseStockLinks]);
  const isCompleted = project.status === 'Completed';
  const isHistorical = project.isHistorical;
  // Flat structure — same Primary/Sub Primary Section + Material Specification
  // + Unit + Total Qty columns as the historical BOQ table, plus Actual Qty
  // (completed projects), a purchase-unit + Est. Qty pair (procurement
  // prediction, auto-suggested from historical BOQ+PO data), and Alerts
  // (purchase/warehouse request actions, not applicable to historical data).
  // No Phase column.
  // Alerts is a fixed, content-sized width (just enough for its 3 icons)
  // rather than a flexible fr column — a flexible share there left visible
  // dead space between the icons and the row's right edge; Material
  // Specification's own flexible share absorbs whatever that frees up.
  // Historical rows drop Purchase Unit/Est. Qty/Alerts entirely — all three
  // are forward-looking procurement fields (what to order next, requested
  // via the Alerts buttons) that don't apply to a project that already
  // happened; only Actual Qty is a meaningful field to fill in there.
  // A completed project shows three quantity columns instead — the live
  // procurement columns (Purchase Unit, Est. Qty, Alerts) only make sense
  // while there's still something left to order:
  //  - historical: Total Area (BOQ measure) / Material Quantity (what
  //    its PO lines actually bought) / Actual Quantity (typed, purchase unit)
  //  - completed through the app: Material Quantity (delivered) / Estimated
  //    Quantity (the row's own Est. Qty) / Actual Quantity (derived)
  // Every quantity carries its unit, since a row's BOQ measure (sq.m) and
  // its purchase quantities (pcs) are in different units.
  const columnsTemplate = isCompleted
    ? 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.5fr) minmax(0,0.7fr) minmax(0,0.7fr) minmax(0,0.7fr)'
    : 'minmax(0,1.1fr) minmax(0,1.1fr) minmax(0,1.6fr) minmax(0,0.55fr) minmax(0,0.75fr) minmax(0,0.55fr) minmax(0,0.75fr) 112px 96px';
  const [parsingId, setParsingId] = useState<number | null>(null);

  const timeRange = `${formatDate(project.startDate)} – ${formatDate(project.targetEndDate)}`;
  const typeLabel = projectType === 'Others' && otherTypeSpecify ? `Others — ${otherTypeSpecify}` : projectType;

  function updateRow(idx: number, patch: Partial<BOQItemRow>) {
    onRowsChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  // A plan can be saved half-filled, but a row can't be requested with a blank
  // Area Unit, Material Unit or Material Quantity, and Request Materials needs
  // every row filled in. The blanks turn red once a request is refused, and
  // each goes back to normal as soon as it's filled.
  const [showBlanks, setShowBlanks] = useState(false);
  const blankFields = (r: BOQItemRow) => ({
    unit: !r.unit?.trim(),
    purchaseUnit: !r.estimatedPurchaseUnit?.trim(),
    purchaseQty: (r.estimatedPurchaseQuantity ?? 0) <= 0,
  });
  const hasBlank = (r: BOQItemRow) => Object.values(blankFields(r)).some(Boolean);
  const blankStyle = (blank: boolean): React.CSSProperties =>
    showBlanks && blank ? { border: '1px solid #ef4444', background: '#fef2f2' } : {};

  // A saved row is deleted right away, not on the next save: saving only ever
  // adds and updates, so it would otherwise come back on reopening. Other rows'
  // unsaved edits stay on screen. What a row's requests were for can't be undone
  // by this, so those ask first; the requests themselves are kept.
  const [deletingRowId, setDeletingRowId] = useState<number | null>(null);

  async function removeRow(idx: number) {
    const row = rows[idx];
    if (row.id == null) {
      onRowsChange(prev => prev.filter(r => r !== row));
      return;
    }
    const hasRequests = (row.askedQuantity ?? 0) > 0 || (row.approvedQuantity ?? 0) > 0
      || (row.warehousePendingQuantity ?? 0) > 0 || (row.requestedQuantity ?? 0) > 0;
    if (hasRequests && !window.confirm(`"${materialLabel(row)}" already has requests. Delete this row anyway? Its requests stay with the warehouse and Procurement, but will no longer be tied to a row in this plan.`)) return;

    setDeletingRowId(row.id);
    const deleted = await onDeleteRow(row.id);
    setDeletingRowId(null);
    if (deleted) onRowsChange(prev => prev.filter(r => r.id !== row.id));
  }

  // Confirms the partial-quantity dialog: sends the real request for exactly
  // what the user typed, then ADDS it to this row's running requestedQuantity
  // (never overwrites — several partial clicks across Procurement/Warehouse
  // all accumulate against the same original Est. Qty). The row itself is
  // never split or shrunk: its Est. Qty stays the fixed original ask, and it
  // only flips to "Done" once the running total actually reaches it. Saved
  // immediately (not left as a local draft) — the real request behind it
  // already happened for real, so leaving this un-persisted would silently
  // lose the running total the moment this modal is reopened before a
  // manual Save.
  async function handleConfirmRequest() {
    if (!requestPrompt) return;
    const { index, unit } = requestPrompt;
    const qty = parseFloat(requestPromptQty);
    if (!qty || qty <= 0) { toast.error('Enter a quantity greater than zero.'); return; }
    // Any positive quantity goes through: anything past the remaining estimate
    // is an intentional additional request (breakage, design change, buffer)
    // that the backend flags as such rather than rejects.

    const row = rows[index];
    setSubmittingRequest(true);
    try {
      // The backend judges "additional" against the row's saved Est. Qty, so a
      // typed one has to reach it first.
      const saved = boqItems.find(b => b.id === row.id);
      if ((saved?.estimatedPurchaseQuantity !== row.estimatedPurchaseQuantity || saved?.estimatedPurchaseUnit !== row.estimatedPurchaseUnit)) {
        try {
          await onSave(rows, { silent: true });
        } catch {
          return; // already shown; nothing was sent
        }
      }

      const ok = await onNotify(requestPrompt.kind, row.materialId, requestPrompt.materialName, qty, unit, row.id);
      if (!ok) return;

      const totalRequested = (row.requestedQuantity ?? 0) + qty;
      const newRows = rows.slice();
      newRows[index] = { ...row, requestedQuantity: totalRequested };

      onRowsChange(newRows);
      try {
        await onSave(newRows, { silent: true });
        const remainder = (row.estimatedPurchaseQuantity ?? totalRequested) - totalRequested;
        toast.success(remainder > 0
          ? `Requested ${qty.toLocaleString()} ${unit}. ${remainder.toLocaleString()} ${unit} still remaining.`
          : remainder < 0
          ? `Requested ${qty.toLocaleString()} ${unit}. ${(-remainder).toLocaleString()} ${unit} over the estimate.`
          : `Requested ${qty.toLocaleString()} ${unit}. Fully covered.`);
      } catch {
        toast.error('Request sent, but saving the updated Bill of Quantities failed — click Save Material Plan to retry.');
      }
      setRequestPrompt(null);
      setRequestPromptQty('');
    } finally {
      setSubmittingRequest(false);
    }
  }

  function addBlankRow() {
    // Leave primarySection blank rather than silently defaulting to the first
    // option — the user picks it via the same datalist input every row already
    // has, instead of it being pre-filled without any real choice being made.
    onRowsChange([...rows, { primarySection: '', estimatedQuantity: 0 }]);
  }

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files) Array.from(files).forEach(f => onUploadBoq(f));
    e.target.value = '';
  }

  async function handleParseClick(doc: ProjectDocument) {
    setParsingId(doc.id);
    try {
      await onParseBoq(doc.id);
    } finally {
      setParsingId(null);
    }
  }

  function handlePoFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files) Array.from(files).forEach(f => onUploadPO(f));
    e.target.value = '';
  }

  async function handleParsePoClick(doc: ProjectDocument) {
    setParsingPoId(doc.id);
    try {
      await onParsePO(doc.id);
    } finally {
      setParsingPoId(null);
    }
  }

  function updatePoDraftRow(idx: number, patch: Partial<PurchaseOrderMaterial>) {
    onPoDraftRowsChange(poDraftRows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removePoDraftRow(idx: number) {
    onPoDraftRowsChange(poDraftRows.filter((_, i) => i !== idx));
  }

  function addBlankPoDraftRow() {
    onPoDraftRowsChange([...poDraftRows, { name: '', quantity: 0, unit: '' }]);
  }

  // Only real, already-saved BOQ rows (with a DB id) are linkable.
  const linkableBoqRows = rows.filter(r => r.id != null);

  // BOQ (planned) vs. linked PO (actual) reconciliation — only meaningful once
  // a project is Completed and both sides have real, saved data with explicit
  // links between them (see onLinkPoMaterial).
  const reconciliation = useMemo(() => {
    const actualByBoqItemId = new Map<number, number>();
    const unlinked: { po: PurchaseOrder; material: PurchaseOrderMaterial }[] = [];
    purchaseOrders.forEach(po => {
      po.materials.forEach(m => {
        if (m.boqItemId) {
          actualByBoqItemId.set(m.boqItemId, (actualByBoqItemId.get(m.boqItemId) ?? 0) + m.quantity);
        } else {
          unlinked.push({ po, material: m });
        }
      });
    });
    return { actualByBoqItemId, unlinked };
  }, [purchaseOrders]);

  const historicalPurchaseRows = useMemo(
    () => rows.flatMap(row => row.historicalSupply ?? []),
    [rows],
  );

  // Every saved BOQ row (not just the single top one), ranked by what was
  // actually purchased for it — feeds the historical-only "Materials by
  // Demand" list below. Its quantity/unit are the row's purchase-order
  // quantity/unit (EstimatedPurchaseQuantity/Unit, set server-side from its
  // PO lines — e.g. 2,368 pcs), never the BOQ area measure (130 sq.m). Rows
  // with no single-unit PO total have no purchase quantity and sort last.
  const rowsByDemand = useMemo(() => {
    if (!isHistorical) return [];
    const purchaseQty = (r: BOQItemRow) => (r.estimatedPurchaseUnit?.trim() ? (r.estimatedPurchaseQuantity ?? -1) : -1);
    return linkableBoqRows.slice().sort((a, b) => purchaseQty(b) - purchaseQty(a));
  }, [isHistorical, linkableBoqRows]);

  // Totals by unit — rows mix incompatible units (sq.m, pc, l.m, set...), so a
  // single blind sum across all of them would be meaningless. The source
  // file itself has no total row at all; this is purely computed for display.
  const totalsByUnit = useMemo(() => {
    const est = new Map<string, number>();
    const actual = new Map<string, number>();
    rows.forEach(r => {
      const unit = r.unit?.trim() || '—';
      est.set(unit, (est.get(unit) ?? 0) + (r.estimatedQuantity || 0));
      if (isCompleted) actual.set(unit, (actual.get(unit) ?? 0) + (r.actualQuantity || 0));
    });
    return { est, actual };
  }, [rows, isCompleted]);

  // A historical row's "Material Quantity": what was actually bought for it —
  // the sum of its own PO lines when they're all in one unit (pc/pcs/piece/
  // pieces, case and whitespace folded the same way the backend does), in
  // that unit. Same rule BOQService.BulkSaveAsync stores as the row's
  // EstimatedPurchaseQuantity/Unit on save; recomputed here from the lines
  // themselves so a freshly scanned, not-yet-saved row shows it too. Mixed
  // units or no PO lines → null ("—"), and the row stays in its BOQ unit.
  function historicalPurchase(r: BOQItemRow): { quantity: number; unit: string } | null {
    const lines = r.historicalSupply;
    if (!lines) {
      return r.estimatedPurchaseQuantity != null && r.estimatedPurchaseUnit
        ? { quantity: r.estimatedPurchaseQuantity, unit: r.estimatedPurchaseUnit }
        : null;
    }
    const fold = (u?: string) => {
      const lower = (u ?? '').trim().toLowerCase();
      return lower === 'pcs' || lower === 'piece' || lower === 'pieces' ? 'pc' : lower;
    };
    if (lines.length === 0) return null;
    const units = new Set(lines.map(l => fold(l.unit)));
    if (units.size !== 1 || units.has('')) return null;
    const quantity = lines.reduce((sum, l) => sum + Math.round(l.quantity || 0), 0);
    return quantity > 0 ? { quantity, unit: lines[0].unit.trim() } : null;
  }

  // Display-only fallback for a row whose PO lines are in mixed units (e.g.
  // tile in sq.m + adhesive in bags + grout in packs): the row's own material
  // — the PO line whose name shares the most words with the row's
  // specification (first line on a tie) — so "Homogeneous Tile (600mm x
  // 600mm…)" shows the tile's 68 sq.m, matching its PO line. Repeat
  // deliveries of that same material + unit are summed. Never stored;
  // historicalPurchase stays the single-unit rule the backend saves.
  function primaryPurchase(r: BOQItemRow): { quantity: number; unit: string } | null {
    const lines = (r.historicalSupply ?? []).filter(l => l.unit?.trim() && l.quantity > 0);
    if (lines.length === 0) return null;
    // Material words only — sizes and measure words ("20", "mm", "dia",
    // "thick") are shared by unrelated lines and would decide the match.
    const ignored = new Set(['dia', 'thick', 'and', 'with', 'per', 'pcs']);
    const words = (s?: string) => new Set(((s ?? '').toLowerCase().match(/[a-z]{3,}/g) ?? []).filter(w => !ignored.has(w)));
    const spec = words(r.specification || r.newMaterialName);
    const score = (name: string) => [...words(name)].filter(w => spec.has(w)).length;
    const primary = lines.reduce((best, l) => (score(l.materialName) > score(best.materialName) ? l : best));
    const same = (l: typeof primary) =>
      l.materialName.trim().toLowerCase() === primary.materialName.trim().toLowerCase()
      && l.unit.trim().toLowerCase() === primary.unit.trim().toLowerCase();
    const quantity = lines.filter(same).reduce((sum, l) => sum + Math.round(l.quantity), 0);
    return { quantity, unit: primary.unit.trim() };
  }

  // A newly-scanned material has no InventoryRecord yet (that only exists
  // once stock is actually recorded), so inventory alone can't name it —
  // boqItems already carries the real Material.Name resolved server-side.
  const materialNameById = useMemo(() => {
    const map = new Map<number, string>();
    boqItems.forEach(b => map.set(b.materialId, b.materialName));
    inventory.forEach(i => { if (!map.has(i.materialId)) map.set(i.materialId, i.materialName); });
    return map;
  }, [boqItems, inventory]);

  function materialLabel(r: BOQItemRow): string {
    if (r.materialId) {
      // Prefer the resolved catalog name (present once this row has been
      // saved and refetched); until then, the scanned name is the only
      // thing we actually know about this material — show that instead of
      // a meaningless "Material #N".
      return materialNameById.get(r.materialId) ?? r.newMaterialName ?? `Material #${r.materialId}`;
    }
    return r.newMaterialName ?? '(unnamed)';
  }

  function currentStock(r: BOQItemRow): number {
    if (!r.materialId) return 0;
    return inventory.find(i => i.materialId === r.materialId)?.availableQuantity ?? 0;
  }

  // undefined: the list hasn't loaded, or the row has no name yet — nothing to
  // say, and the warehouse-first rule stays on.
  function stockOf(r: BOQItemRow): RowStock | undefined {
    const name = stockName(r);
    return warehouseStock.length > 0 && name.trim() ? rowStock(name, warehouseStock, stockLinks) : undefined;
  }

  // The row's BOQ wording: what links are remembered under. Not the catalog
  // name, since saving can merge a row into a differently-named material.
  function stockName(r: BOQItemRow): string {
    return r.specification || r.newMaterialName || (r.materialId ? materialLabel(r) : '');
  }

  // Requesting everything at once needs the whole plan to say how much of
  // everything and in what.
  const incompleteRows = rows.filter(r => missingRequestFields(r).length > 0).length;
  const incompleteMessage = `${incompleteRows} material${incompleteRows === 1 ? ' is' : 's are'} missing a unit or quantity. Fill in all of them before requesting.`;

  function warnIncompletePlan() {
    setShowBlanks(true);
    toast.error(incompleteMessage);
    // After the render that marks them.
    requestAnimationFrame(() => document.querySelector('[data-blank-row="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  function warnMissingFields(missing: string[]) {
    setShowBlanks(true);
    toast.error(`Fill in the ${missing.join(', ')} on this row before requesting it.`);
  }

  // Saved first so every row has an id to be tracked by, and the server's
  // figures are current (the warehouse may have just approved something).
  async function handleOpenBulk() {
    if (incompleteRows > 0) { warnIncompletePlan(); return; }
    setOpeningBulk(true);
    try {
      await onSave(rows, { silent: true });
      await onRefreshStock();
      setBulkOpen(true);
    } catch {
      // already shown
    } finally {
      setOpeningBulk(false);
    }
  }

  const bulkRows: BulkRowInput[] = !bulkOpen ? [] : rows.filter(r => r.id != null && r.materialId).map(r => ({
    id: r.id!,
    materialId: r.materialId!,
    name: stockName(r) || materialLabel(r),
    areaUnit: r.unit,
    materialUnit: r.estimatedPurchaseUnit,
    materialQuantity: r.estimatedPurchaseQuantity,
    netLeftToOrder: r.estimatedPurchaseQuantity != null ? leftAfter(r.estimatedPurchaseQuantity, r.approvedQuantity) : undefined,
    remainingRequestable: r.estimatedPurchaseQuantity != null ? leftAfter(r.estimatedPurchaseQuantity, r.askedQuantity) : undefined,
    warehouseApproved: !!r.warehouseApproved,
    warehouseRejected: !!r.warehouseRejected,
    warehousePendingQuantity: r.warehousePendingQuantity ?? 0,
    onSiteStock: currentStock(r),
    stock: stockOf(r),
    hasSimilarInStock: similarInStock(stockName(r), warehouseStock).length > 0,
  }));

  // Returns the rows that didn't go, with why; the sent ones are added to their
  // rows' running requested totals, the same as a single request.
  async function handleSendBulk(items: BulkSendItem[]): Promise<Map<number, string> | null> {
    const saved = (id: number) => boqItems.find(b => b.id === id);
    const changed = rows.some(r => r.id != null && (
      saved(r.id)?.estimatedPurchaseQuantity !== r.estimatedPurchaseQuantity
      || saved(r.id)?.estimatedPurchaseUnit !== r.estimatedPurchaseUnit
      || saved(r.id)?.unit !== r.unit));
    if (changed) {
      try {
        await onSave(rows, { silent: true });
      } catch {
        return null; // already shown; nothing was sent
      }
    }

    const toItems = (kind: BulkSendItem['kind']): BulkRequestItem[] => items
      .filter(i => i.kind === kind)
      .map(({ boqItemId, materialId, quantity, unit }) => ({ boqItemId, materialId, quantity, unit }));
    const failures = new Map<number, string>();
    const sent = new Map<number, number>();
    const counts = { warehouse: 0, procurement: 0 };
    for (const kind of ['warehouse', 'procurement'] as const) {
      const batch = toItems(kind);
      if (batch.length === 0) continue;
      const results = await onBulkRequest(kind, batch);
      if (results === null) {
        batch.forEach(i => failures.set(i.boqItemId, 'Not sent. Try again.'));
        continue;
      }
      for (const result of results) {
        if (result.success) {
          counts[kind]++;
          sent.set(result.boqItemId, batch.find(i => i.boqItemId === result.boqItemId)?.quantity ?? 0);
        } else {
          failures.set(result.boqItemId, result.error ?? 'Not sent.');
        }
      }
    }

    if (sent.size > 0) {
      const newRows = rows.map(r => (r.id != null && sent.has(r.id)
        ? { ...r, requestedQuantity: (r.requestedQuantity ?? 0) + sent.get(r.id)! }
        : r));
      onRowsChange(newRows);
      try {
        await onSave(newRows, { silent: true });
      } catch {
        toast.error('Requests sent, but saving the updated Bill of Quantities failed — click Save Material Plan to retry.');
      }
      const parts = [
        counts.warehouse ? `${counts.warehouse} to the warehouse` : '',
        counts.procurement ? `${counts.procurement} to Procurement` : '',
      ].filter(Boolean);
      toast.success(`Sent ${parts.join(' and ')}.`);
    }
    return failures;
  }

  async function handleLinkStock(item: WarehouseStockItem) {
    if (!linkPrompt) return;
    if (!await onSaveStockLink(linkPrompt.rowName, item.materialName)) return;
    toast.success(item.balance > 0
      ? `Linked to ${item.materialName}. Notify the warehouse first.`
      : `Linked to ${item.materialName}. It has no stock, so you can notify Procurement.`);
    setLinkPrompt(null);
  }

  async function handleMarkNotStocked() {
    if (!linkPrompt) return;
    if (!await onSaveStockLink(linkPrompt.rowName, null)) return;
    const { onContinue } = linkPrompt;
    setLinkPrompt(null);
    onContinue?.();
  }

  async function handleRemoveLink() {
    if (!linkPrompt) return;
    if (!await onRemoveStockLink(linkPrompt.rowName)) return;
    setLinkPrompt(null);
  }

  return (
    <div>
      <datalist id="primary-section-options">
        {PRIMARY_SECTIONS.map(s => <option key={s} value={s} />)}
      </datalist>

      {bulkOpen && (
        <BulkRequestDialog
          projectName={project.name}
          rows={bulkRows}
          stockLoaded={warehouseStock.length > 0}
          onResolveSimilar={rowName => setLinkPrompt({ rowName, beforePurchase: true })}
          onSend={handleSendBulk}
          onLoadWarehouseRequests={onLoadWarehouseRequests}
          onLoadProcurementRequests={onLoadProcurementRequests}
          onClose={() => setBulkOpen(false)}
        />
      )}

      {linkPrompt && (
        <StockLinkDialog
          rowName={linkPrompt.rowName}
          stock={rowStock(linkPrompt.rowName, warehouseStock, stockLinks)}
          items={warehouseStock}
          beforePurchase={linkPrompt.beforePurchase}
          onLink={handleLinkStock}
          onNotStocked={handleMarkNotStocked}
          onUnlink={handleRemoveLink}
          onClose={() => setLinkPrompt(null)}
        />
      )}

      {requestPrompt && (
        <div onClick={() => !submittingRequest && setRequestPrompt(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: '1.5rem', width: 380, boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
            <p style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 4 }}>
              {requestPrompt.kind === 'ProcurementOrder' ? 'Notify Procurement' : 'Notify Warehouse'}
            </p>
            <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: requestPrompt.stockNote ? 4 : '1rem' }}>{requestPrompt.materialName}</p>
            {requestPrompt.stockNote && (
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#374151', marginBottom: '1rem' }}>{requestPrompt.stockNote}</p>
            )}
            {requestPrompt.kind === 'ProcurementOrder' ? (
              <>
                <label style={{ ...lbl, fontSize: '0.68rem' }}>Quantity to request</label>
                <p style={{ fontSize: '0.68rem', color: requestPrompt.max > 0 ? '#6b7280' : '#b45309', marginTop: 2 }}>
                  {requestPrompt.max > 0
                    ? `Suggested remaining: ${requestPrompt.max.toLocaleString()} ${requestPrompt.unit}`
                    : 'This row is fully requested. Entering a quantity sends an additional request.'}
                </p>
              </>
            ) : (
              <>
                <label style={{ ...lbl, fontSize: '0.68rem' }}>Quantity to request</label>
                <p style={{ fontSize: '0.68rem', color: requestPrompt.max > 0 ? '#6b7280' : '#b45309', marginTop: 2 }}>
                  {requestPrompt.max > 0
                    ? `This row still needs ${requestPrompt.max.toLocaleString()} ${requestPrompt.unit}`
                    : 'This row is fully requested. Entering a quantity sends an additional request.'}
                </p>
              </>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 4, marginBottom: '1.25rem' }}>
              <input
                type="number"
                autoFocus
                value={requestPromptQty}
                onChange={e => setRequestPromptQty(e.target.value)}
                style={{ ...inp, flex: 1 }}
              />
              <span style={{ ...inp, flex: '0 0 auto', width: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', color: '#6b7280' }}>{requestPrompt.unit}</span>
            </div>
            {requestPrompt.max > 0 && parseFloat(requestPromptQty) > requestPrompt.max && (
              <p style={{ fontSize: '0.68rem', fontWeight: 600, color: '#b45309', marginBottom: 6 }}>
                More than this row still needs, so it will be marked as an additional request.
              </p>
            )}
            <p style={{ fontSize: '0.68rem', color: '#9ca3af', marginBottom: '1rem' }}>
              Requesting less than the full amount keeps the rest on this row, ready for its own request.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setRequestPrompt(null)} disabled={submittingRequest} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleConfirmRequest} disabled={submittingRequest} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', opacity: submittingRequest ? 0.7 : 1 }}>
                {submittingRequest ? 'Sending…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
        <div>
          <label style={lbl}>Project Type</label>
          <input disabled value={typeLabel} style={{ ...inp, background: '#f9fafb', color: '#6b7280' }} />
        </div>
        <div>
          <label style={lbl}>Time Range</label>
          <input disabled value={timeRange} style={{ ...inp, background: '#f9fafb', color: '#6b7280' }} />
        </div>
      </div>

      {isCompleted && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '0.625rem 0.875rem', marginBottom: '1rem', fontSize: '0.72rem', color: '#9a3412' }}>
          {isHistorical
            // Historical backfills have no live Excess/Waste trail to derive
            // usage from (nothing was ever logged against something that
            // already happened) — typing the real figure here is the only
            // genuine source, so this is the one place manual entry is correct.
            ? <>This is a historical project — fill in <strong>Actual Qty</strong> per material below from your real records. This is what trains the forecasting model on real usage.</>
            // Live projects derive this automatically from logged Excess/Waste
            // against each line — no manual entry. A line with nothing ever
            // logged against it shows its estimate instead, marked "inferred"
            // rather than presented as a confirmed figure.
            : <>Actual Qty below is calculated automatically from logged Excess/Waste per material. Rows marked <strong>inferred</strong> have nothing logged yet, so they show the estimate instead of a confirmed figure.</>}
        </div>
      )}

      {/* Forecasted Material Demand — completed, non-historical projects only;
          ongoing projects only get the summary label on the project card, not
          this full breakdown. Historical projects get "Materials by Demand"
          below instead (ranked by real recorded usage, not a forecast — a
          finished historical project has nothing left to forecast). */}
      {isCompleted && !isHistorical && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', marginBottom: '1rem' }}>
          <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid #e5e7eb' }}>
            <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>Forecasted Material Demand</p>
            <p style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: 2 }}>AI-predicted demand from the latest forecast run on this project.</p>
          </div>
          {forecastedMaterials.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: '#d1d5db', padding: '1rem' }}>No forecast has been run yet — click Run Forecast below.</p>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,0.8fr) minmax(0,0.8fr) minmax(0,0.8fr) minmax(0,0.7fr)', gap: 4, padding: '0.5rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                {['MATERIAL', 'FORECASTED QTY', 'CURRENT STOCK', 'SHORTAGE', 'RISK'].map(h => (
                  <span key={h} style={{ fontSize: '0.6rem', color: '#9ca3af', fontWeight: 700 }}>{h}</span>
                ))}
              </div>
              {/* key includes unit, not just materialId — the same material
                  can now appear twice in one forecast (once per distinct
                  unit actually forecasted; see ForecastedMaterial.Unit on
                  the backend), which would otherwise collide on a bare
                  materialId key. */}
              {forecastedMaterials.map(fm => (
                <div key={`${fm.materialId}-${fm.unit}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,0.8fr) minmax(0,0.8fr) minmax(0,0.8fr) minmax(0,0.7fr)', gap: 4, padding: '7px 1rem', borderBottom: '1px solid #f9fafb', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.76rem', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fm.materialName}</span>
                  <span style={{ fontSize: '0.76rem', color: '#374151' }}>{Math.ceil(fm.forecastedQuantity).toLocaleString()} {fm.unit}</span>
                  <span style={{ fontSize: '0.76rem', color: '#6b7280' }}>{Math.ceil(fm.currentStock).toLocaleString()} {fm.unit}</span>
                  <span style={{ fontSize: '0.76rem', color: fm.shortage > 0 ? '#ef4444' : '#6b7280' }}>{fm.shortage > 0 ? Math.ceil(fm.shortage).toLocaleString() : '—'}</span>
                  <span style={{
                    fontSize: '0.62rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, width: 'fit-content',
                    background: fm.riskLevel === 'Critical' ? '#fee2e2' : fm.riskLevel === 'High' ? '#ffedd5' : fm.riskLevel === 'Medium' ? '#fef3c7' : '#dcfce7',
                    color: fm.riskLevel === 'Critical' ? '#b91c1c' : fm.riskLevel === 'High' ? '#c2410c' : fm.riskLevel === 'Medium' ? '#92400e' : '#15803d',
                  }}>{fm.riskLevel}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}


      {/* Bill of Quantities */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1rem', borderBottom: '1px solid #e5e7eb' }}>
          <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>{isHistorical ? 'Bill of Quantities and Purchased Orders Summary' : 'Bill of Quantities'}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {editable && !isCompleted && !isHistorical && rows.length > 0 && (
              <button onClick={handleOpenBulk} disabled={openingBulk} title="Review and send every material's request at once" style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', opacity: openingBulk ? 0.7 : 1 }}>
                <Send style={{ width: 12, height: 12 }} /> {openingBulk ? 'Preparing…' : 'Request Materials'}
              </button>
            )}
            {/* The blueprint the generated rows came from, beside this table. */}
            {hasPlan && (
              <button onClick={onViewPlan} disabled={planOpen}
                title="Open the blueprint beside the Material Plan — click a blueprint row to see it on the plan"
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: planOpen ? '#fff7ed' : '#fff', color: planOpen ? '#c2410c' : '#374151', fontSize: '0.72rem', fontWeight: 600, cursor: planOpen ? 'default' : 'pointer' }}>
                <MapIcon style={{ width: 12, height: 12 }} /> View Plan
              </button>
            )}
            {editable && (
              <button onClick={() => fileInputRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}>
                <Upload style={{ width: 12, height: 12 }} /> {uploading ? 'Uploading…' : 'Upload BOQ'}
              </button>
            )}
          </div>
          <input ref={fileInputRef} type="file" multiple accept=".pdf,.xlsx,.xls,.csv" onChange={handleFilePicked} style={{ display: 'none' }} />
        </div>

        {boqDocs.length > 0 && (
          <div style={{ padding: '0.625rem 1rem', borderBottom: '1px solid #f3f4f6', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {boqDocs.map(doc => (
              <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText style={{ width: 12, height: 12, color: '#9ca3af', flexShrink: 0 }} />
                <a href={resolveUploadUrl(doc.url) ?? "#"} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.fileName}
                </a>
                <ExternalLink style={{ width: 10, height: 10, color: '#9ca3af', flexShrink: 0 }} />
                {editable && (
                  <button onClick={() => handleParseClick(doc)} disabled={parsingId === doc.id} style={{ fontSize: '0.68rem', fontWeight: 600, color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {parsingId === doc.id ? 'Scanning…' : 'Scan & Fill Rows'}
                  </button>
                )}
                {editable && (
                  <button onClick={() => onRemoveDocument(doc.id)} title="Remove file" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2, flexShrink: 0 }}>
                    <X style={{ width: 12, height: 12 }} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {isHistorical && (
          <div style={{ display: 'grid', gap: '1.25rem', padding: '1rem' }}>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1rem', background: '#eff6ff', borderBottom: '1px solid #dbeafe' }}>
                <p style={{ fontWeight: 700, fontSize: '0.82rem', color: '#1d4ed8' }}>Bill of Quantities (BOQ)</p>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 760 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 2fr 0.7fr 1fr', gap: 8, padding: '0.55rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    {['PRIMARY SECTION', 'SUB PRIMARY SECTION', 'MATERIAL SPECIFICATION', 'UNIT', 'TOTAL AREA'].map(h => <span key={h} style={{ fontSize: '0.6rem', color: '#9ca3af', fontWeight: 700 }}>{h}</span>)}
                  </div>
                  {rows.length === 0 ? <p style={{ padding: '1rem', fontSize: '0.78rem', color: '#9ca3af' }}>No BOQ rows extracted yet.</p> : rows.map((row, index) => (
                    <div key={`${row.id ?? 'new'}-${index}`} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 2fr 0.7fr 1fr', gap: 8, padding: '0.7rem 1rem', borderBottom: '1px solid #f3f4f6', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.76rem', color: '#374151' }}>{row.primarySection || '—'}</span>
                      <span style={{ fontSize: '0.76rem', color: '#374151' }}>{row.subCategory || '—'}</span>
                      <span style={{ fontSize: '0.76rem', color: '#111827' }}>{row.specification || materialLabel(row)}</span>
                      <span style={{ fontSize: '0.76rem', color: '#6b7280' }}>{row.unit || '—'}</span>
                      <span style={{ fontSize: '0.76rem', color: '#111827' }}>{row.estimatedQuantity.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1rem', background: '#fff7ed', borderBottom: '1px solid #fed7aa' }}>
                <p style={{ fontWeight: 700, fontSize: '0.82rem', color: '#c2410c' }}>Purchased Order (PO)</p>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 760 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr 0.7fr 1fr 1.8fr', gap: 8, padding: '0.55rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    {['PO NUMBER', 'PO DATE', 'MATERIAL NAME', 'UNIT', 'QUANTITY', 'SUPPLIER'].map(h => <span key={h} style={{ fontSize: '0.6rem', color: '#9ca3af', fontWeight: 700 }}>{h}</span>)}
                  </div>
                  {historicalPurchaseRows.length === 0 ? <p style={{ padding: '1rem', fontSize: '0.78rem', color: '#9ca3af' }}>No purchased-order rows extracted yet.</p> : historicalPurchaseRows.map((row, index) => (
                    <div key={`${row.poNumber ?? 'po'}-${index}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr 0.7fr 1fr 1.8fr', gap: 8, padding: '0.7rem 1rem', borderBottom: '1px solid #f3f4f6', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.76rem', color: '#374151' }}>{row.poNumber || '—'}</span>
                      <span style={{ fontSize: '0.76rem', color: '#6b7280' }}>{row.poDate ? formatDate(row.poDate) : '—'}</span>
                      <span style={{ fontSize: '0.76rem', color: '#111827' }}>{row.materialName}</span>
                      <span style={{ fontSize: '0.76rem', color: '#6b7280' }}>{row.unit || '—'}</span>
                      <span style={{ fontSize: '0.76rem', color: '#111827' }}>{row.quantity.toLocaleString()}</span>
                      <span style={{ fontSize: '0.76rem', color: '#374151' }}>{row.supplierName || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Hidden only while a historical project is still locked (view-only)
            — this is the grid with the actual Actual Qty input (see its
            isCompleted && isHistorical branch below), so hiding it whenever
            isHistorical regardless of the edit toggle (the old rule, from
            when historical projects could never be edited at all) silently
            defeated the very point of toggling Editing back on for one. */}
        <div style={{ display: (isHistorical && !editable) ? 'none' : 'block', overflowX: 'auto' }}>
        <div style={{ minWidth: 1090 }}>
        <div style={{ display: 'grid', gridTemplateColumns: columnsTemplate, gap: 4, padding: '0.5rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
          {(isCompleted
            ? isHistorical
              ? ['PRIMARY SECTION', 'SUB PRIMARY SECTION', 'MATERIAL SPECIFICATION', 'TOTAL AREA', 'MATERIAL QUANTITY', 'ACTUAL QUANTITY']
              : ['PRIMARY SECTION', 'SUB PRIMARY SECTION', 'MATERIAL SPECIFICATION', 'MATERIAL QUANTITY', 'ESTIMATED QUANTITY', 'ACTUAL QUANTITY']
            : ['PRIMARY SECTION', 'SUB PRIMARY SECTION', 'MATERIAL SPECIFICATION', 'AREA UNIT', 'TOTAL AREA', 'MATERIAL UNIT', 'MATERIAL QUANTITY', 'WAREHOUSE STOCK', 'ALERTS']
          ).map((h, idx) => (
            <span key={`${h}-${idx}`} style={{ fontSize: '0.6rem', color: '#9ca3af', fontWeight: 700 }}>{h}</span>
          ))}
        </div>

        {/* scrollbarGutter reserves the scrollbar's own width up front, so
            rows never shift a few pixels narrower than the (never-scrolled)
            header once enough rows appear to need a scrollbar. */}
        <div style={{ maxHeight: 320, overflowY: 'auto', scrollbarGutter: 'stable' }}>
          {rows.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: '#d1d5db', padding: '1rem' }}>No materials added yet.</p>
          ) : (
            rows.map((r, i) => {
              const stock = currentStock(r);
              // Alerts/requests operate on the purchase-container Est. Qty/Unit
              // (the columns actually meant for procurement/inventory action),
              // not the raw BOQ Total Area/Qty measurement (sq.m/l.m/...) —
              // matches what the receiving Inventory/Procurement pages show.
              // Deliberately NOT falling back to r.estimatedQuantity when
              // blank — Est. Qty only exists once Run Forecast has filled it
              // in (or the user set it manually), and until then there is no
              // real purchase target to alert against at all.
              const hasPurchaseEstimate = r.estimatedPurchaseQuantity != null;
              const purchaseQty = r.estimatedPurchaseQuantity ?? 0;
              const purchaseUnit = r.estimatedPurchaseUnit ?? r.unit ?? '';
              // Net Left to Order — this row's Est. Qty, as it stands on screen,
              // minus whatever has actually been APPROVED so far (an approved
              // redistribution transfer, an approved warehouse release, or a
              // purchase order past Pending). A still-Pending request never
              // moves this number — see ProcurementCapCalculator.
              const netLeftToOrder = hasPurchaseEstimate ? leftAfter(purchaseQty, r.approvedQuantity) : 0;
              const toOrder = hasPurchaseEstimate ? Math.max(0, netLeftToOrder - stock) : 0;
              // The real cap Notify Procurement/Warehouse will enforce
              // server-side — unlike netLeftToOrder above, this also
              // subtracts every MaterialRequest already submitted for this
              // material (fulfilled or not), so it can be LOWER even when
              // nothing's been approved yet (e.g. a request for the full
              // amount is already sent and awaiting a PO). Both dialogs below
              // must cap at this, or they invite a quantity the backend then
              // rejects. See ProcurementCapCalculator.GetRemainingRequestableAsync.
              const remainingRequestable = hasPurchaseEstimate ? leftAfter(purchaseQty, r.askedQuantity) : 0;
              // Saved rows only: a request is tracked against its row's id.
              const missingFields = missingRequestFields(r);
              const canRequestBase = editable && !isCompleted && !!r.materialId && r.id != null && missingFields.length === 0;
              // Everything this row needs has been asked for. It stays open for
              // additional requests, but shouldn't read as still needing action.
              const fullyRequested = hasPurchaseEstimate && Math.min(netLeftToOrder, remainingRequestable) <= 0;
              // Warehouse Check comes first when the warehouse has this
              // material: Procurement can't be requested until Warehouse has
              // actually APPROVED a check — merely submitting one isn't enough.
              // With nothing in the warehouse there's nothing to check, so it
              // goes straight to Procurement. Neither can go until the row says
              // how much and in what. Warehouse stays available either
              // way (a material may be listed under a name that didn't match).
              // Neither button is ever disabled just because the estimate's
              // already fully covered — users can still request a buffer amount.
              const stockStatus = stockOf(r);
              const hasNoStock = stockStatus?.status === 'noStock' || stockStatus?.status === 'notListed';
              const stockNote = stockStatus && stockStatus.status !== 'notListed'
                ? `In warehouse: ${stockStatus.item.balance.toLocaleString()} ${stockStatus.item.unit}` : undefined;
              const canRequestWarehouse = canRequestBase;
              const warehouseAnswered = !!r.warehouseApproved || !!r.warehouseRejected;
              const canRequestProcurement = canRequestBase && (hasNoStock || warehouseAnswered);
              // Clickable with fields missing, so the click can say why it won't go.
              const warnOnClick = editable && !isCompleted && missingFields.length > 0;
              const needsAlert = toOrder > 0 && !fullyRequested;
              const suggestWarehouse = canRequestWarehouse && stockStatus?.status === 'inStock' && !warehouseAnswered && !fullyRequested;
              // The subtext only appears once something's actually been
              // approved against this row (net < the full estimate) — never
              // for a still-Pending request, and never with nothing requested.
              const showLeftToOrder = hasPurchaseEstimate && netLeftToOrder < purchaseQty;
              // Additional procurement orders can push the running requested
              // total past the estimate — shown alongside "0 left to order"
              // rather than as a negative balance.
              const overEstimate = hasPurchaseEstimate ? Math.max(0, (r.requestedQuantity ?? 0) - purchaseQty) : 0;
              const blank = blankFields(r);
              return (
                <div key={i}
                  data-blank-row={showBlanks && !isCompleted && hasBlank(r) ? 'true' : undefined}
                  // With the plan open, a blueprint row clicked is shown on it.
                  onClickCapture={() => { if (planOpen && sourceOf(r)?.readId != null) onPlanFocus(i); }}
                  style={{ display: 'grid', gridTemplateColumns: columnsTemplate, gap: 4, padding: '8px 1rem', borderBottom: '1px solid #f9fafb', alignItems: 'center', minHeight: 40,
                    background: showBlanks && !isCompleted && hasBlank(r) ? '#fef2f2' : planOpen && planFocus === i ? '#fff7ed' : undefined, cursor: planOpen && sourceOf(r)?.readId != null ? 'pointer' : undefined }}>
                  {editable ? (
                    <input
                      list="primary-section-options"
                      title="Primary section"
                      value={r.primarySection}
                      onChange={e => updateRow(i, { primarySection: e.target.value })}
                      style={{ ...inp, padding: '4px 6px', fontSize: '0.72rem' }}
                    />
                  ) : (
                    <span style={{ fontSize: '0.76rem', color: '#374151' }}>{r.primarySection || '—'}</span>
                  )}
                  {editable ? (
                    <input
                      title="Sub primary section"
                      value={r.subCategory ?? ''}
                      onChange={e => updateRow(i, { subCategory: e.target.value })}
                      style={{ ...inp, padding: '4px 6px', fontSize: '0.72rem' }}
                    />
                  ) : (
                    <span style={{ fontSize: '0.76rem', color: '#374151' }}>{r.subCategory || '—'}</span>
                  )}
                  {/* A scanned row keeps its own specification/newMaterialName text
                      even once it resolves to a real catalog MaterialId behind the
                      scenes (fuzzy-matched server-side) — show the original BOQ
                      wording, not the catalog's own (possibly differently-worded)
                      name. Only fall back to the catalog name for rows with no
                      scanned text at all (added directly from Stock on Hand). */}
                  {/* A blueprint-generated row says where its finish came from on hover. */}
                  {r.materialId && !r.specification && !r.newMaterialName ? (
                    <span title={sourceTooltip(r)} style={{ fontSize: '0.78rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{materialLabel(r)}</span>
                  ) : (
                    <input disabled={!editable} title={sourceTooltip(r)} value={r.specification || r.newMaterialName || ''}
                      // The field shows the specification when there is one — edit that, not the hidden name.
                      onChange={e => updateRow(i, r.specification ? { specification: e.target.value } : { newMaterialName: e.target.value })}
                      placeholder="Material specification" style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem' }} />
                  )}
                  {!isCompleted && (
                    <input disabled={!editable} value={r.unit ?? ''} onChange={e => updateRow(i, { unit: e.target.value })} placeholder="unit" style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem', ...blankStyle(blank.unit) }} />
                  )}
                  {/* Live (not completed) project: the editable Total Area/Qty
                      input as always (its unit is the UNIT column before it). */}
                  {!isCompleted && (
                    <input disabled={!editable} type="number" value={r.estimatedQuantity || ''} onChange={e => updateRow(i, { estimatedQuantity: parseFloat(e.target.value) || 0 })} style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem' }} />
                  )}
                  {/* Historical row: "Total Area" is the BOQ measurement
                      (e.g. 130 sq.m of wall), still editable; "Material
                      Quantity" is what was actually bought for it (its PO
                      lines' total, e.g. 2,368 pcs) — real recorded data,
                      always read-only, never an AI figure, shown in a box
                      matching the Total Area input beside it. There's no
                      Estimated Quantity column: nothing about a project that
                      already happened is still an estimate. */}
                  {isCompleted && isHistorical && (
                    <input disabled={!editable} type="number" title={r.unit ? `Total area (${r.unit})` : 'Total area'} value={r.estimatedQuantity || ''} onChange={e => updateRow(i, { estimatedQuantity: parseFloat(e.target.value) || 0 })} style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem' }} />
                  )}
                  {isCompleted && isHistorical && (() => {
                    const purchase = historicalPurchase(r);
                    const primary = purchase ? null : primaryPurchase(r);
                    const shown = purchase ?? primary;
                    return (
                      <input
                        type="text"
                        readOnly
                        tabIndex={-1}
                        title={purchase
                          ? 'Total of this row\'s purchase order lines'
                          : primary
                            ? 'This row\'s own material from its purchase order lines (other lines are in different units)'
                            : 'No purchase order lines for this row'}
                        value={shown ? `${shown.quantity.toLocaleString()} ${shown.unit}` : '—'}
                        style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem', background: '#f9fafb', color: shown ? '#111827' : '#9ca3af', cursor: 'default' }}
                      />
                    );
                  })()}
                  {/* Project completed through the app: "Material Quantity" is
                      the real, server-computed delivered total (read-only,
                      never the plan estimate); "Estimated Quantity" is THIS
                      row's own Est. Qty (filled from the AI's per-row
                      prediction on Run Forecast, or set manually) — never a
                      per-material forecast total repeated on every row of
                      that material. Both are in the row's purchase unit. */}
                  {isCompleted && !isHistorical && (
                    <span style={{ fontSize: '0.76rem', color: '#374151' }}>
                      {(r.materialQuantity ?? 0).toLocaleString()} {r.estimatedPurchaseQuantity != null ? (r.estimatedPurchaseUnit ?? r.unit ?? '') : (r.unit ?? '')}
                    </span>
                  )}
                  {isCompleted && !isHistorical && (
                    <span
                      title="This row's Est. Qty — the AI's prediction for it from Run Forecast, unless set manually"
                      style={{ fontSize: '0.76rem', color: r.estimatedPurchaseQuantity != null ? '#374151' : '#d1d5db' }}
                    >
                      {r.estimatedPurchaseQuantity != null
                        ? `${Math.ceil(r.estimatedPurchaseQuantity).toLocaleString()} ${r.estimatedPurchaseUnit ?? r.unit ?? ''}`
                        : '—'}
                    </span>
                  )}
                  {isCompleted && isHistorical && (
                    // The one legitimate manual-entry path — a historical
                    // backfill has no live Excess/Waste trail to derive this
                    // from, so a real human-typed figure is the only genuine
                    // source. See the banner above and BOQItem.IsUsageConfirmed.
                    // Typed in the row's purchase unit (what its PO lines were
                    // bought in — e.g. pcs, not the BOQ's sq.m) when it has
                    // one; the placeholder says which.
                    <input
                      disabled={!editable}
                      type="number"
                      value={r.actualQuantity || ''}
                      onChange={e => updateRow(i, { actualQuantity: parseFloat(e.target.value) || 0 })}
                      placeholder={`Actual used (${(historicalPurchase(r) ?? primaryPurchase(r))?.unit ?? r.unit ?? 'qty'})`}
                      style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem', background: '#fff7ed', borderColor: '#fed7aa' }}
                    />
                  )}
                  {isCompleted && !isHistorical && (
                    // Read-only — auto-derived from logged Excess/Waste
                    // (ExcessWasteService), never hand-typed for a live
                    // project. "inferred" means nothing has been logged
                    // against this line yet, so the figure shown is just the
                    // estimate, not an observed one.
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '4px 6px' }} title={r.isUsageConfirmed ? 'Calculated from logged Excess/Waste' : 'Nothing logged yet for this line — showing the estimate'}>
                      <span style={{ fontSize: '0.76rem', color: '#374151' }}>
                        {r.actualQuantity || 0} {r.estimatedPurchaseQuantity != null ? (r.estimatedPurchaseUnit ?? r.unit ?? '') : (r.unit ?? '')}
                      </span>
                      {!r.isUsageConfirmed && (
                        <span style={{ fontSize: '0.6rem', color: '#b45309', fontStyle: 'italic' }}>inferred</span>
                      )}
                    </div>
                  )}
                  {!isCompleted && <>
                  <select
                    disabled={!editable}
                    value={r.estimatedPurchaseUnit ?? ''}
                    onChange={e => updateRow(i, { estimatedPurchaseUnit: e.target.value || undefined, estimatePurchaseManuallySet: true })}
                    style={{ ...sel, padding: '4px 4px', fontSize: '0.7rem', ...blankStyle(blank.purchaseUnit) }}
                  >
                    <option value="">—</option>
                    {PURCHASE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                  {/* position:relative + the subtext positioned absolute
                      below it keeps this cell's own layout height identical
                      to every other column's — the subtext overlays the
                      row's bottom gap instead of growing the grid row, so
                      showing/hiding it never shifts UNIT/ALERTS in this row
                      or the vertical position of any other row. */}
                  <div style={{ position: 'relative' }}>
                    <input
                      disabled={!editable}
                      type="number"
                      title={expectedText(r) ?? 'Estimated/predicted procurement quantity — auto-suggested from historical data, editable'}
                      value={r.estimatedPurchaseQuantity ?? ''}
                      onChange={e => updateRow(i, { estimatedPurchaseQuantity: e.target.value === '' ? undefined : parseFloat(e.target.value) || 0, estimatePurchaseManuallySet: true })}
                      placeholder="Est. qty"
                      style={{ ...inp, padding: '4px 6px', fontSize: '0.76rem', ...blankStyle(blank.purchaseQty) }}
                    />
                    {(showLeftToOrder || overEstimate > 0 || fullyRequested) && (
                      <p style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2,
                        fontSize: '0.6rem', color: fullyRequested && overEstimate <= 0 ? '#15803d' : '#f97316', fontWeight: 600,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {overEstimate > 0
                          ? `0 left to order · +${overEstimate.toLocaleString()} over estimate`
                          : fullyRequested
                          ? 'Fully requested'
                          : `${netLeftToOrder.toLocaleString()} left to order`}
                      </p>
                    )}
                  </div>
                  {/* Stock only means something against a quantity, so a freshly
                      scanned row shows nothing until Run Forecast (or the user)
                      gives it an Est. Qty. */}
                  <StockBadge stock={(r.estimatedPurchaseQuantity ?? 0) > 0 ? stockStatus : undefined} onClick={editable ? () => setLinkPrompt({ rowName: stockName(r), beforePurchase: false }) : undefined} />
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end', paddingRight: 2 }}>
                    {(() => {
                      // Only the AI-vs-engineering-baseline check is shown;
                      // the missing-properties/unit-setup notes aren't
                      // something the user can act on from this row.
                      const alerts = baselineAlerts(r).filter(a => a.code === 'far_from_expected');
                      if (alerts.length === 0) return null;
                      return (
                        <span
                          title={alerts.map(a => a.text).join('\n')}
                          aria-label={alerts.map(a => a.text).join('; ')}
                          style={{ display: 'flex', alignItems: 'center', color: '#d97706', marginRight: 2 }}
                        >
                          <AlertTriangle style={{ width: 13, height: 13 }} />
                        </span>
                      );
                    })()}
                    {/* Action buttons always stay visible — never swapped for
                        a "Done" badge, even once the estimate is fully
                        covered: Procurement can still take an additional
                        order past it (Warehouse's own cap still applies). */}
                    <button
                      disabled={!canRequestProcurement && !warnOnClick}
                      onClick={() => {
                        if (warnOnClick) { warnMissingFields(missingFields); return; }
                        const openRequest = () => {
                          const cap = Math.max(0, Math.min(toOrder, remainingRequestable));
                          setRequestPrompt({ index: i, kind: 'ProcurementOrder', max: cap, unit: purchaseUnit, materialName: materialLabel(r), stockNote });
                          setRequestPromptQty(cap ? String(cap) : '');
                        };
                        // Buying what the warehouse already has under another
                        // name is the costly mistake, so stop here once — the
                        // answer is remembered for this wording either way.
                        const name = stockName(r);
                        if (stockStatus?.status === 'notListed' && !stockStatus.confirmed && !warehouseAnswered && similarInStock(name, warehouseStock).length > 0) {
                          setLinkPrompt({ rowName: name, beforePurchase: true, onContinue: openRequest });
                          return;
                        }
                        openRequest();
                      }}
                      title={
                        !editable || isCompleted ? undefined
                          : missingFields.length > 0 ? `Fill in the ${missingFields.join(', ')} first`
                          : !r.materialId || r.id == null ? 'Save the Material Plan first'
                          : !canRequestProcurement ? 'Notify the warehouse first — Procurement unlocks once Warehouse answers a check for this material'
                          : toOrder <= 0 || fullyRequested ? 'Fully requested. Click to send Procurement an additional request.'
                          : `Notify procurement — ${Math.min(toOrder, remainingRequestable)} ${purchaseUnit} suggested`
                      }
                      style={{
                        width: 24, height: 24, borderRadius: 6, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: canRequestProcurement || warnOnClick ? 'pointer' : 'not-allowed',
                        opacity: canRequestProcurement ? 1 : 0.4,
                        background: needsAlert && canRequestProcurement ? '#fee2e2' : '#f3f4f6',
                      }}
                    >
                      <ShoppingCart style={{ width: 12, height: 12, color: needsAlert && canRequestProcurement ? '#ef4444' : '#9ca3af' }} />
                    </button>
                    <button
                      disabled={!canRequestWarehouse && !warnOnClick}
                      onClick={() => {
                        if (warnOnClick) { warnMissingFields(missingFields); return; }
                        const cap = Math.max(0, Math.min(netLeftToOrder, remainingRequestable));
                        setRequestPrompt({ index: i, kind: 'WarehouseCheck', max: cap, unit: purchaseUnit, materialName: materialLabel(r), stockNote });
                        setRequestPromptQty(String(warehouseRequestQuantity(stockStatus, cap, purchaseUnit) || ''));
                      }}
                      title={
                        !editable || isCompleted ? undefined
                          : missingFields.length > 0 ? `Fill in the ${missingFields.join(', ')} first`
                          : !r.materialId || r.id == null ? 'Save the Material Plan first'
                          : fullyRequested ? 'Fully requested. Click to send the warehouse an additional request.'
                          : `Notify warehouse to check material — up to ${Math.min(netLeftToOrder, remainingRequestable)} ${purchaseUnit}`
                      }
                      style={{
                        width: 24, height: 24, borderRadius: 6, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: canRequestWarehouse || warnOnClick ? 'pointer' : 'not-allowed',
                        opacity: canRequestWarehouse ? 1 : 0.4,
                        background: suggestWarehouse ? '#dbeafe' : '#f3f4f6',
                      }}
                    >
                      <Package style={{ width: 12, height: 12, color: suggestWarehouse ? '#2563eb' : '#9ca3af' }} />
                    </button>
                    {editable && (
                      <button onClick={() => removeRow(i)} disabled={r.id != null && deletingRowId === r.id} title="Delete this row" aria-label="Delete this row" style={{ width: 24, height: 24, borderRadius: 6, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' }}>
                        <Trash2 style={{ width: 12, height: 12, color: '#d1d5db' }} />
                      </button>
                    )}
                  </div>
                  </>}
                </div>
              );
            })
          )}
        </div>
        </div>
        </div>

        {editable && !isHistorical && (
          <button onClick={addBlankRow} style={{ width: '100%', padding: '8px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.78rem', color: '#f97316', fontWeight: 600, borderTop: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <Plus style={{ width: 13, height: 13 }} /> Add Row
          </button>
        )}

        {rows.length > 0 && !isHistorical && (
          <div style={{ padding: '0.625rem 1rem', borderTop: '1px solid #e5e7eb', background: '#f9fafb' }}>
            <p style={{ fontSize: '0.62rem', fontWeight: 700, color: '#9ca3af', marginBottom: 4 }}>
              TOTAL EST. QTY {isCompleted && '/ ACTUAL QTY'} BY UNIT
              <span style={{ fontWeight: 400, textTransform: 'none' }}> — computed, not from the source file</span>
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem' }}>
              {Array.from(totalsByUnit.est.entries()).map(([unit, sum]) => (
                <span key={unit} style={{ fontSize: '0.76rem', color: '#374151' }}>
                  <strong>{sum.toLocaleString()}</strong> {unit}
                  {isCompleted && <span style={{ color: '#9ca3af' }}> / {(totalsByUnit.actual.get(unit) ?? 0).toLocaleString()} {unit}</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {editable && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '1rem' }}>
          <button onClick={() => { onSave().catch(() => { /* already shown */ }); }} disabled={saving} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save Material Plan'}
          </button>
          <button
            onClick={() => {
              if (rows.length === 0) { toast.error('Add at least one material first.'); return; }
              onRunForecast();
            }}
            disabled={forecasting}
            style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', opacity: forecasting ? 0.7 : 1 }}
          >
            {forecasting ? 'Forecasting…' : '▶ Run Forecast'}
          </button>
        </div>
      )}

      {/* Purchase Orders — actual ordered quantities, paired against the BOQ
          estimates above. Not applicable to historical projects: they're
          backfilled training data, there's nothing real to order. */}
      {!isHistorical && (
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1rem', borderBottom: '1px solid #e5e7eb' }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>Purchase Orders</p>
            <p style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: 2 }}>What was actually ordered — trains the forecasting model once delivered.</p>
          </div>
          {editable && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowImport(true)} title="POs made before this project was added to ConstructIQ"
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: '1px solid #fed7aa', background: '#fff7ed', color: '#c2410c', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <FileText style={{ width: 12, height: 12 }} /> Import existing POs
              </button>
              <button onClick={() => poFileInputRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <Upload style={{ width: 12, height: 12 }} /> {uploadingPo ? 'Uploading…' : 'Upload PO'}
              </button>
            </div>
          )}
          {showImport && (
            <div onClick={() => setShowImport(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem' }}>
              <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: 1100, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <p style={{ fontWeight: 700, fontSize: '1rem', color: '#111827' }}>Import existing purchase orders — {project.name}</p>
                  <button onClick={() => setShowImport(false)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
                    <X style={{ width: 18, height: 18 }} />
                  </button>
                </div>
                <ImportPurchaseOrders projectId={project.id} onImported={onPurchaseOrdersImported} />
              </div>
            </div>
          )}
          <input ref={poFileInputRef} type="file" multiple accept=".pdf,.xlsx,.xls,.csv" onChange={handlePoFilePicked} style={{ display: 'none' }} />
        </div>

        {poDocs.length > 0 && (
          <div style={{ padding: '0.625rem 1rem', borderBottom: '1px solid #f3f4f6', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {poDocs.map(doc => (
              <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText style={{ width: 12, height: 12, color: '#9ca3af', flexShrink: 0 }} />
                <a href={resolveUploadUrl(doc.url) ?? "#"} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.fileName}
                </a>
                <ExternalLink style={{ width: 10, height: 10, color: '#9ca3af', flexShrink: 0 }} />
                {editable && (
                  <button onClick={() => handleParsePoClick(doc)} disabled={parsingPoId === doc.id} style={{ fontSize: '0.68rem', fontWeight: 600, color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {parsingPoId === doc.id ? 'Scanning…' : 'Scan & Fill Rows'}
                  </button>
                )}
                {editable && (
                  <button onClick={() => onRemoveDocument(doc.id)} title="Remove file" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2, flexShrink: 0 }}>
                    <X style={{ width: 12, height: 12 }} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Draft — reviewed rows from a scan (or manually started), not yet saved as a real PO */}
        {editable && (poDraftRows.length > 0 || poSupplierName) && (
          <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid #f3f4f6', background: '#fffbf5' }}>
            <p style={{ fontWeight: 700, fontSize: '0.8rem', color: '#c2410c', marginBottom: '0.625rem' }}>New Purchase Order — review before saving</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr)', gap: 6, marginBottom: '0.75rem' }}>
              <div>
                <label style={{ ...lbl, fontSize: '0.62rem' }}>Supplier</label>
                <input value={poSupplierName} onChange={e => onPoSupplierNameChange(e.target.value)} placeholder="Supplier name" style={{ ...inp, padding: '5px 8px', fontSize: '0.78rem' }} />
              </div>
              <div>
                <label style={{ ...lbl, fontSize: '0.62rem' }}>Order Date</label>
                <input type="date" value={poOrderDate} onChange={e => onPoOrderDateChange(e.target.value)} style={{ ...inp, padding: '5px 8px', fontSize: '0.78rem' }} />
              </div>
              <div>
                <label style={{ ...lbl, fontSize: '0.62rem' }}>Expected Delivery *</label>
                <input type="date" value={poExpectedDate} onChange={e => onPoExpectedDateChange(e.target.value)} style={{ ...inp, padding: '5px 8px', fontSize: '0.78rem' }} />
              </div>
            </div>

            {canSeePrices && poDraftRows.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: draftGridColumns, gap: 6, marginBottom: 4 }}>
                {['Material', 'Unit', 'Qty', 'Unit Price (₱ per unit)', 'Line Total', ''].map(h => (
                  <span key={h} style={{ ...lbl, fontSize: '0.6rem', marginBottom: 0 }}>{h}</span>
                ))}
              </div>
            )}
            {poDraftRows.map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: draftGridColumns, gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <input value={r.name} onChange={e => updatePoDraftRow(i, { name: e.target.value })} placeholder="Material name" style={{ ...inp, padding: '5px 8px', fontSize: '0.76rem' }} />
                <input value={r.unit} onChange={e => updatePoDraftRow(i, { unit: e.target.value })} placeholder="unit" style={{ ...inp, padding: '5px 8px', fontSize: '0.76rem' }} />
                <input type="number" step="1" value={r.quantity || ''} onChange={e => updatePoDraftRow(i, { quantity: Math.round(parseFloat(e.target.value)) || 0 })} placeholder="Qty ordered" style={{ ...inp, padding: '5px 8px', fontSize: '0.76rem' }} />
                {canSeePrices && (
                  <>
                    <input
                      type="number" min="0" step="0.01"
                      value={r.unitPrice ?? ''}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        updatePoDraftRow(i, { unitPrice: Number.isFinite(v) && v >= 0 ? v : null });
                      }}
                      placeholder={`₱ per ${r.unit || 'unit'}`}
                      aria-label={`Unit Price (₱ per ${r.unit || 'unit'})`}
                      title={`Unit Price (₱ per ${r.unit || 'unit'})`}
                      style={{ ...inp, padding: '5px 8px', fontSize: '0.76rem' }}
                    />
                    <span style={{ fontSize: '0.74rem', color: '#374151', textAlign: 'right' }}>
                      {lineTotal(r) != null ? formatCurrency(lineTotal(r)!) : '—'}
                    </span>
                  </>
                )}
                <button onClick={() => removePoDraftRow(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2 }}>
                  <Trash2 style={{ width: 13, height: 13 }} />
                </button>
              </div>
            ))}
            {canSeePrices && draftPoTotal != null && (
              <p style={{ fontSize: '0.76rem', fontWeight: 700, color: '#111827', textAlign: 'right', marginTop: 4 }}>
                PO Total: {formatCurrency(draftPoTotal)}
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
              <button onClick={addBlankPoDraftRow} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: '#f97316', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer' }}>
                <Plus style={{ width: 12, height: 12 }} /> Add Row
              </button>
              <button onClick={onSavePO} disabled={savingPo} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer', opacity: savingPo ? 0.7 : 1 }}>
                {savingPo ? 'Saving…' : 'Save Purchase Order'}
              </button>
            </div>
          </div>
        )}

        {/* Real, saved purchase orders */}
        <div style={{ maxHeight: 320, overflowY: 'auto', overflowX: 'hidden' }}>
          {purchaseOrders.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: '#d1d5db', padding: '1rem' }}>No purchase orders yet.</p>
          ) : (
            purchaseOrders.map(po => (
              <div key={po.id} style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #f9fafb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.8rem', color: '#111827' }}>{po.number} · {po.supplierName}</span>
                  <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: po.status === 'Delivered' ? '#dcfce7' : '#ffedd5', color: po.status === 'Delivered' ? '#15803d' : '#c2410c' }}>
                    {po.status}
                  </span>
                </div>
                <p style={{ fontSize: '0.65rem', color: '#9ca3af', marginBottom: 6 }}>
                  Ordered {formatDate(po.orderDate)} · Expected {formatDate(po.expectedDate)}
                </p>
                {po.materials.map(m => (
                  <div key={m.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,0.8fr) minmax(0,1fr)', gap: 6, alignItems: 'center', padding: '4px 0' }}>
                    <span style={{ fontSize: '0.76rem', color: '#374151' }}>{m.name}</span>
                    <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>
                      {m.quantity} {m.unit}
                      {m.unitPrice != null && ` · ${formatCurrency(m.unitPrice)}/${m.unit} = ${formatCurrency(lineTotal(m)!)}`}
                    </span>
                    {editable ? (
                      <select
                        value={m.boqItemId ?? ''}
                        onChange={e => onLinkPoMaterial(m.id!, e.target.value ? Number(e.target.value) : null)}
                        style={{ ...sel, padding: '3px 5px', fontSize: '0.68rem' }}
                      >
                        <option value="">Link to BOQ line…</option>
                        {linkableBoqRows.map(r => <option key={r.id} value={r.id}>{materialLabel(r)}</option>)}
                      </select>
                    ) : (
                      <span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>{m.boqItemId ? 'Linked' : 'Not linked'}</span>
                    )}
                  </div>
                ))}
                {poTotal(po.materials) != null && (
                  <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151', textAlign: 'right', marginTop: 4 }}>
                    PO Total: {formatCurrency(poTotal(po.materials)!)}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      )}

      {/* Historical projects have no Purchase Orders to reconcile against (that
          section is hidden for them above) — instead, rank the BOQ itself by
          what was purchased for each row, in its purchase-order unit (see
          rowsByDemand). */}
      {isCompleted && isHistorical && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', marginTop: '1.5rem' }}>
          <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid #e5e7eb' }}>
            <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>Materials by Demand</p>
            <p style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: 2 }}>Every material in the uploaded BOQ, ranked by purchased quantity (highest first), in its purchase order unit.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,0.8fr)', gap: 4, padding: '0.5rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            {['MATERIAL', 'QTY', 'UNIT'].map(h => (
              <span key={h} style={{ fontSize: '0.6rem', color: '#9ca3af', fontWeight: 700 }}>{h}</span>
            ))}
          </div>

          {rowsByDemand.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: '#d1d5db', padding: '1rem' }}>Save the Bill of Quantities above first.</p>
          ) : (
            rowsByDemand.map(r => {
              // Purchase-order quantity/unit only — no PO unit means no
              // purchase quantity to show either ("—" / "N/A"), rather than
              // falling back to the BOQ area figure under a misleading unit.
              const purchaseUnit = r.estimatedPurchaseUnit?.trim();
              const qty = purchaseUnit ? r.estimatedPurchaseQuantity : undefined;
              return (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,0.8fr)', gap: 4, padding: '7px 1rem', borderBottom: '1px solid #f9fafb', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.76rem', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{materialLabel(r)}</span>
                  <span style={{ fontSize: '0.76rem', fontWeight: 600, color: qty != null ? '#111827' : '#d1d5db' }}>{qty != null ? qty.toLocaleString() : '—'}</span>
                  <span style={{ fontSize: '0.76rem', color: purchaseUnit ? '#6b7280' : '#d1d5db' }}>{purchaseUnit || 'N/A'}</span>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* BOQ vs. Purchase Order reconciliation — only meaningful once both BOQ
          (planned) and linked PO (actual) data exist for a real Completed
          project. This is what "Data Review & Verification" means: confirm
          the two sides actually line up per material before the row counts
          as real training data. Not shown for historical projects, which have
          no Purchase Orders section at all (see the ranked list above instead). */}
      {isCompleted && !isHistorical && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', marginTop: '1.5rem' }}>
          <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid #e5e7eb' }}>
            <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>BOQ vs. Purchase Order Reconciliation</p>
            <p style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: 2 }}>Planned (BOQ) vs. actual (linked, delivered POs) per material — this pairing is what feeds ML training.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,0.8fr) minmax(0,0.8fr) minmax(0,0.8fr)', gap: 4, padding: '0.5rem 1rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            {['MATERIAL', 'BOQ EST. QTY', 'PO ACTUAL QTY', 'VARIANCE'].map(h => (
              <span key={h} style={{ fontSize: '0.6rem', color: '#9ca3af', fontWeight: 700 }}>{h}</span>
            ))}
          </div>

          {linkableBoqRows.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: '#d1d5db', padding: '1rem' }}>Save the Bill of Quantities above first, then link Purchase Order materials to each line.</p>
          ) : (
            linkableBoqRows.map(r => {
              const actual = reconciliation.actualByBoqItemId.get(r.id!) ?? 0;
              const variance = actual - r.estimatedQuantity;
              return (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,0.8fr) minmax(0,0.8fr) minmax(0,0.8fr)', gap: 4, padding: '7px 1rem', borderBottom: '1px solid #f9fafb', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.76rem', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{materialLabel(r)}</span>
                  <span style={{ fontSize: '0.76rem', color: '#6b7280' }}>{r.estimatedQuantity}</span>
                  <span style={{ fontSize: '0.76rem', color: actual > 0 ? '#111827' : '#d1d5db' }}>{actual > 0 ? actual : '— not linked'}</span>
                  <span style={{ fontSize: '0.76rem', fontWeight: 600, color: variance === 0 ? '#6b7280' : variance > 0 ? '#ef4444' : '#15803d' }}>
                    {actual > 0 ? (variance > 0 ? `+${variance}` : variance) : '—'}
                  </span>
                </div>
              );
            })
          )}

          {reconciliation.unlinked.length > 0 && (
            <div style={{ padding: '0.75rem 1rem', background: '#fffbf5', borderTop: '1px solid #fed7aa' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#c2410c', marginBottom: 4 }}>
                {reconciliation.unlinked.length} PO material(s) not yet linked to a BOQ line — link them above under Purchase Orders so they count toward training.
              </p>
              {reconciliation.unlinked.map(({ po, material }) => (
                <p key={material.id} style={{ fontSize: '0.7rem', color: '#9a3412' }}>
                  {po.number}: {material.name} ({material.quantity} {material.unit})
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
