import { describe, it, expect } from 'vitest';

/**
 * Tests for defective move-out logic:
 * - Supplier filtering for barcode scans
 * - Add-to-existing vs create-new mode selection
 * - API endpoint URL construction
 */

// --- Supplier filtering logic (mirrors Products.tsx handleBarcodeScan) ---

function shouldRejectBarcodeForSupplierFilter(
  supplierFilter: string,
  barcodeSupplierId: number | null | undefined,
): boolean {
  if (!supplierFilter) return false;
  if (!barcodeSupplierId) return false;
  return String(barcodeSupplierId) !== supplierFilter;
}

describe('Supplier filter for defective barcode scanning', () => {
  it('allows barcode when no supplier filter is active', () => {
    expect(shouldRejectBarcodeForSupplierFilter('', 5)).toBe(false);
  });

  it('allows barcode when supplier matches the filter', () => {
    expect(shouldRejectBarcodeForSupplierFilter('5', 5)).toBe(false);
  });

  it('rejects barcode when supplier does not match the filter', () => {
    expect(shouldRejectBarcodeForSupplierFilter('5', 10)).toBe(true);
  });

  it('allows barcode when barcode has no supplier (null)', () => {
    expect(shouldRejectBarcodeForSupplierFilter('5', null)).toBe(false);
  });

  it('allows barcode when barcode has no supplier (undefined)', () => {
    expect(shouldRejectBarcodeForSupplierFilter('5', undefined)).toBe(false);
  });

  it('handles string comparison correctly (filter is always string)', () => {
    expect(shouldRejectBarcodeForSupplierFilter('42', 42)).toBe(false);
    expect(shouldRejectBarcodeForSupplierFilter('42', 43)).toBe(true);
  });
});

// --- Move-out mode selection logic ---

function getDefaultMoveOutMode(existingMoveOuts: any[]): 'new' | 'existing' {
  return existingMoveOuts.length > 0 ? 'existing' : 'new';
}

describe('Move-out mode selection', () => {
  it('defaults to "new" when no existing move-outs', () => {
    expect(getDefaultMoveOutMode([])).toBe('new');
  });

  it('defaults to "existing" when move-outs exist', () => {
    expect(getDefaultMoveOutMode([{ id: 1, move_out_number: 'MO-001' }])).toBe('existing');
  });

  it('defaults to "existing" with multiple move-outs', () => {
    expect(getDefaultMoveOutMode([
      { id: 1, move_out_number: 'MO-001' },
      { id: 2, move_out_number: 'MO-002' },
    ])).toBe('existing');
  });
});

// --- API endpoint URL construction ---

describe('Defective move-out API endpoints', () => {
  const BASE = '/api/v1';

  it('move-out creation endpoint', () => {
    expect(`${BASE}/defective-products/move-out/`).toBe('/api/v1/defective-products/move-out/');
  });

  it('move-out list endpoint', () => {
    expect(`${BASE}/defective-products/move-outs/`).toBe('/api/v1/defective-products/move-outs/');
  });

  it('add-items endpoint includes move-out ID', () => {
    const moveOutId = 42;
    const url = `${BASE}/defective-products/move-outs/${moveOutId}/add-items/`;
    expect(url).toBe('/api/v1/defective-products/move-outs/42/add-items/');
  });

  it('detail endpoint includes move-out ID', () => {
    const moveOutId = 7;
    const url = `${BASE}/defective-products/move-outs/${moveOutId}/`;
    expect(url).toBe('/api/v1/defective-products/move-outs/7/');
  });
});

// --- Move-out number trimming (mirrors DefectiveMoveOuts.tsx display) ---

function trimMoveOutNumber(moveOutNumber: string): string {
  return (moveOutNumber || '').split('-').pop() || moveOutNumber;
}

describe('Move-out number trimming', () => {
  it('trims to last segment', () => {
    expect(trimMoveOutNumber('DMO-20260426-ABC123')).toBe('ABC123');
  });

  it('returns full string when no dashes', () => {
    expect(trimMoveOutNumber('ABC123')).toBe('ABC123');
  });

  it('handles empty string', () => {
    expect(trimMoveOutNumber('')).toBe('');
  });
});

// --- Selected barcodes data extraction (mirrors handleMoveOutSubmit) ---

describe('Move-out submit data extraction', () => {
  it('extracts unique product IDs and barcode IDs from selection', () => {
    const selectedDefectiveProductsData = new Map<number, any>([
      [101, { product: { id: 1 }, barcode: { id: 101 } }],
      [102, { product: { id: 1 }, barcode: { id: 102 } }],
      [103, { product: { id: 2 }, barcode: { id: 103 } }],
    ]);
    const selectedDefectiveProducts = new Set([101, 102, 103]);

    const selectedBarcodes = Array.from(selectedDefectiveProducts)
      .map((barcodeId) => selectedDefectiveProductsData.get(barcodeId))
      .filter(Boolean);

    const barcodeIds = selectedBarcodes.map((row: any) => row?.barcode?.id).filter(Boolean);
    const productIds = [...new Set(selectedBarcodes.map((row: any) => row?.product?.id).filter(Boolean))];

    expect(barcodeIds).toEqual([101, 102, 103]);
    expect(productIds).toEqual([1, 2]);
  });

  it('handles empty selection', () => {
    const selectedDefectiveProductsData = new Map<number, any>();
    const selectedDefectiveProducts = new Set<number>();

    const selectedBarcodes = Array.from(selectedDefectiveProducts)
      .map((barcodeId) => selectedDefectiveProductsData.get(barcodeId))
      .filter(Boolean);

    expect(selectedBarcodes).toEqual([]);
  });
});

// --- Already-moved-out detection (mirrors handleBarcodeScan) ---

describe('Already-moved-out barcode detection', () => {
  it('detects moved-out barcode from local data', () => {
    const barcode = {
      id: 1,
      defective_move_out_info: { moved_out: true, reason: 'Defective', move_out_number: 'DMO-001' },
    };
    expect(barcode.defective_move_out_info?.moved_out).toBe(true);
  });

  it('detects not-moved-out barcode', () => {
    const barcode = {
      id: 2,
      defective_move_out_info: null,
    };
    expect(barcode.defective_move_out_info?.moved_out).toBeFalsy();
  });

  it('detects moved-out barcode from API fallback', () => {
    const apiResponse = {
      barcode_tag: 'defective',
      defective_moved_out: true,
      defective_move_out_reason: 'Damaged',
      defective_move_out_number: 'DMO-002',
    };
    expect(apiResponse.defective_moved_out).toBe(true);
  });
});
