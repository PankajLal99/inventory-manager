import { formatNumber } from './formatting';
import type { CartItemLike } from '../types';

export function getMinPrice(item: CartItemLike): { minPrice: number; priceType: 'selling price' | 'purchase price' } {
  const sellingPrice =
    item.product_selling_price != null && Number(item.product_selling_price) > 0
      ? Number(item.product_selling_price)
      : null;
  const purchasePrice = Number(item.product_purchase_price ?? 0) || 0;
  if (sellingPrice !== null && sellingPrice > 0) {
    return { minPrice: sellingPrice, priceType: 'selling price' };
  }
  return { minPrice: purchasePrice, priceType: 'purchase price' };
}

export function getPriceValidationError(
  price: number,
  item: CartItemLike,
  invoiceType: string,
): string | null {
  if (invoiceType === 'pending') return null;
  if (item.product_can_go_below_purchase_price) return null;
  const { minPrice, priceType } = getMinPrice(item);
  if (minPrice <= 0 || price >= minPrice) return null;
  return `Price cannot be less than ${priceType} (₹${formatNumber(minPrice)})`;
}

export function getEffectivePrice(item: CartItemLike, editingPrice?: string): number {
  if (editingPrice !== undefined) {
    if (editingPrice === '') return 0;
    const n = parseFloat(editingPrice);
    return Number.isNaN(n) ? 0 : n;
  }
  const raw = item.manual_unit_price;
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
  return Number.isNaN(n) ? 0 : n;
}

export function allItemsHavePrices(
  items: CartItemLike[],
  editingManualPrice: Record<number, string>,
  invoiceType: string,
): boolean {
  if (invoiceType === 'pending' || !items?.length) return true;
  return items.every((item) => getEffectivePrice(item, editingManualPrice[item.id]) > 0);
}
