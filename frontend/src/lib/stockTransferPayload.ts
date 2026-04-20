/**
 * Build JSON body for POST /stock-transfers/ (matches DRF StockTransferCreateSerializer).
 */

export type TransferEndpointKind = 'store' | 'warehouse';

export type StockTransferLineInput = {
  productId: number;
  quantity: string;
  selectedBarcodes: string[];
};

export type BuildStockTransferCreateInput = {
  source: { kind: TransferEndpointKind; id: number };
  destination: { kind: TransferEndpointKind; id: number };
  notes?: string;
  items: StockTransferLineInput[];
};

export function buildStockTransferCreatePayload(input: BuildStockTransferCreateInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    notes: input.notes?.trim() ?? '',
    items: input.items.map((row) => ({
      product: row.productId,
      quantity: String(row.quantity).trim(),
      selected_barcodes: row.selectedBarcodes,
    })),
  };

  if (input.source.kind === 'store') {
    body.from_store = input.source.id;
  } else {
    body.from_warehouse = input.source.id;
  }

  if (input.destination.kind === 'store') {
    body.to_store = input.destination.id;
  } else {
    body.to_warehouse = input.destination.id;
  }

  return body;
}
