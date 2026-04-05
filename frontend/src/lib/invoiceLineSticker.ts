/**
 * Normalized sticker value for POS replacement/return APIs when the invoice line may have
 * lost barcode_id but still has barcode_value / sold_barcode_value from the serializer.
 */
export function invoiceLineSticker(item: {
  barcode_full?: string | null;
  barcode_value?: string | null;
  sold_barcode_value?: string | null;
}): string | undefined {
  const raw =
    (item.barcode_full && String(item.barcode_full).trim()) ||
    (item.barcode_value && String(item.barcode_value).trim()) ||
    (item.sold_barcode_value && String(item.sold_barcode_value).trim()) ||
    '';
  return raw ? raw.toUpperCase() : undefined;
}
