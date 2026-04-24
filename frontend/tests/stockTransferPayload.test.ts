import { describe, it, expect } from 'vitest';
import { buildStockTransferCreatePayload } from '../src/lib/stockTransferPayload';

describe('buildStockTransferCreatePayload', () => {
  it('builds store-to-store body with items', () => {
    const body = buildStockTransferCreatePayload({
      source: { kind: 'store', id: 10 },
      destination: { kind: 'store', id: 20 },
      notes: 'restock',
      items: [
        { productId: 5, quantity: '3', selectedBarcodes: [] },
        { productId: 6, quantity: '1.5', selectedBarcodes: ['BC001', 'BC002'] },
      ],
    });
    expect(body).toEqual({
      notes: 'restock',
      from_store: 10,
      to_store: 20,
      items: [
        { product: 5, quantity: '3', selected_barcodes: [] },
        { product: 6, quantity: '1.5', selected_barcodes: ['BC001', 'BC002'] },
      ],
    });
    expect(body).not.toHaveProperty('from_warehouse');
    expect(body).not.toHaveProperty('to_warehouse');
  });

  it('builds warehouse-to-store body', () => {
    const body = buildStockTransferCreatePayload({
      source: { kind: 'warehouse', id: 3 },
      destination: { kind: 'store', id: 7 },
      items: [{ productId: 1, quantity: '2', selectedBarcodes: [] }],
    });
    expect(body.from_warehouse).toBe(3);
    expect(body.to_store).toBe(7);
    expect(body.notes).toBe('');
  });

  it('trims notes', () => {
    const body = buildStockTransferCreatePayload({
      source: { kind: 'store', id: 1 },
      destination: { kind: 'warehouse', id: 2 },
      notes: '  hi  ',
      items: [{ productId: 1, quantity: '1', selectedBarcodes: [] }],
    });
    expect(body.notes).toBe('hi');
    expect(body.to_warehouse).toBe(2);
  });
});
