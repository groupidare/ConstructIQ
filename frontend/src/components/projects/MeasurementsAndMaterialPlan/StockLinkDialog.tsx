'use client';

import { useMemo, useState } from 'react';
import { nameKey, similarInStock, similarItems, type RowStock } from '@/lib/warehouseStockMatch';
import type { WarehouseStockItem } from '@/types/warehouseStock';
import { inp } from './styles';

interface Props {
  rowName: string;
  stock: RowStock;
  items: WarehouseStockItem[];
  // Opened by the cart button: a similar item is in stock, so ask before buying.
  beforePurchase: boolean;
  onLink: (item: WarehouseStockItem) => Promise<void>;
  onNotStocked: () => Promise<void>;
  onUnlink: () => Promise<void>;
  onClose: () => void;
}

const MAX_SEARCH_RESULTS = 8;

export default function StockLinkDialog({ rowName, stock, items, beforePurchase, onLink, onNotStocked, onUnlink, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<WarehouseStockItem | null>(null);
  const [busy, setBusy] = useState(false);

  const suggestions = useMemo(
    () => (beforePurchase ? similarInStock(rowName, items) : similarItems(rowName, items)),
    [beforePurchase, rowName, items],
  );
  const results = useMemo(() => {
    const words = nameKey(query).split(' ').filter(Boolean);
    if (words.length === 0) return suggestions;
    return items.filter(i => words.every(w => i.materialName.toLowerCase().includes(w))).slice(0, MAX_SEARCH_RESULTS);
  }, [query, suggestions, items]);

  const canUnlink = stock.status === 'notListed' ? stock.confirmed : stock.linked;
  const linkedName = stock.status !== 'notListed' && stock.linked ? stock.item.materialName : null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={() => !busy && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: '1.5rem', width: 460, maxWidth: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
        <p style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 4 }}>
          {beforePurchase ? 'Is this the same material?' : 'Link to inventory item'}
        </p>
        <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.75rem' }}>{rowName}</p>
        <p style={{ fontSize: '0.72rem', color: '#374151', marginBottom: '0.75rem' }}>
          {beforePurchase
            ? 'A similar item is in the warehouse. If it\'s the same material, link it so it can be checked before purchasing.'
            : 'Pick the warehouse item this material really is. It\'s remembered for this wording in every project.'}
        </p>
        {linkedName && (
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#374151', marginBottom: '0.75rem' }}>Linked to: {linkedName}</p>
        )}

        <input
          autoFocus
          value={query}
          onChange={e => { setQuery(e.target.value); setSelected(null); }}
          placeholder="Search inventory"
          style={{ ...inp, marginBottom: 8 }}
        />
        <p style={{ fontSize: '0.62rem', fontWeight: 700, color: '#9ca3af', marginBottom: 4 }}>
          {query.trim() ? 'RESULTS' : 'POSSIBLE MATCHES'}
        </p>
        <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: '1rem' }}>
          {results.length === 0 ? (
            <p style={{ fontSize: '0.75rem', color: '#9ca3af', padding: '0.75rem' }}>
              {query.trim() ? 'No inventory item matches that search.' : 'No similar items. Search the inventory above.'}
            </p>
          ) : results.map(item => (
            <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', background: selected?.id === item.id ? '#fff7ed' : '#fff' }}>
              <input type="radio" name="stock-link-item" checked={selected?.id === item.id} onChange={() => setSelected(item)} />
              <span style={{ flex: 1, fontSize: '0.76rem', color: '#111827' }}>{item.materialName}</span>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap', color: item.balance > 0 ? '#15803d' : '#b91c1c' }}>
                {item.balance.toLocaleString()} {item.unit}
              </span>
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {canUnlink && (
            <button onClick={() => run(onUnlink)} disabled={busy} style={{ marginRight: 'auto', padding: 0, border: 'none', background: 'none', color: '#6b7280', fontSize: '0.72rem', fontWeight: 600, textDecoration: 'underline', cursor: 'pointer' }}>
              Remove link
            </button>
          )}
          <button onClick={onClose} disabled={busy} style={{ marginLeft: canUnlink ? 0 : 'auto', padding: '8px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={() => run(onNotStocked)} disabled={busy} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
            {beforePurchase ? 'Not the same, continue' : 'Not stocked, purchase it'}
          </button>
          <button onClick={() => selected && run(() => onLink(selected))} disabled={busy || !selected} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', fontSize: '0.78rem', fontWeight: 700, cursor: selected && !busy ? 'pointer' : 'not-allowed', opacity: selected && !busy ? 1 : 0.5 }}>
            Link
          </button>
        </div>
      </div>
    </div>
  );
}
