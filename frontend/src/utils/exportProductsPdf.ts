import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getStockInfo, toLocalDateString } from '../lib/utils';

export type ProductExportColumnId =
  | 'sr'
  | 'name'
  | 'brand'
  | 'category'
  | 'sku'
  | 'stock'
  | 'available'
  | 'shop_stock'
  | 'warehouse_stock'
  | 'purchase_price'
  | 'selling_price'
  | 'low_stock_threshold'
  | 'status'
  | 'stock_bifurcation'
  | 'price_bifurcation';

export type ProductExportColumnDef = {
  id: ProductExportColumnId;
  label: string;
  /** PDF table header when different from the popup label. */
  pdfLabel?: string;
  defaultOn: boolean;
};

export const PRODUCT_EXPORT_COLUMNS: ProductExportColumnDef[] = [
  { id: 'sr', label: 'S.No', defaultOn: true },
  { id: 'name', label: 'Name', defaultOn: true },
  { id: 'brand', label: 'Brand', defaultOn: true },
  { id: 'category', label: 'Category', defaultOn: true },
  { id: 'sku', label: 'SKU', defaultOn: false },
  { id: 'stock', label: 'Total Stock', defaultOn: false },
  { id: 'available', label: 'Available', defaultOn: false },
  { id: 'shop_stock', label: 'Shop Stock', defaultOn: false },
  { id: 'warehouse_stock', label: 'Warehouse Stock', defaultOn: false },
  { id: 'purchase_price', label: 'Purchase Price', pdfLabel: 'Price', defaultOn: false },
  { id: 'selling_price', label: 'Selling Price', pdfLabel: 'Price', defaultOn: false },
  { id: 'low_stock_threshold', label: 'Low Stock Limit', defaultOn: false },
  { id: 'status', label: 'Status', defaultOn: false },
  { id: 'stock_bifurcation', label: 'Stock by Supplier', defaultOn: false },
  { id: 'price_bifurcation', label: 'Price by Supplier', defaultOn: false },
];

export function pdfColumnLabel(col: ProductExportColumnDef): string {
  return col.pdfLabel ?? col.label;
}

export function defaultProductExportColumnIds(): ProductExportColumnId[] {
  return PRODUCT_EXPORT_COLUMNS.filter((c) => c.defaultOn).map((c) => c.id);
}

/** jsPDF Helvetica can't reliably render ₹ / emoji — keep printable Latin text */
function sanitizePdfText(value?: string | number | null) {
  return String(value ?? '')
    .replace(/₹/g, 'Rs.')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u2600-\u27BF]/g, '')
    .replace(/[\uFE0E\uFE0F]/g, '')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPdfNumber(value: string | number | null | undefined) {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return '-';
  return String(n);
}

function formatPdfMoney(value: string | number | null | undefined) {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!Number.isFinite(n) || n === 0) return '-';
  return `Rs. ${n.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function parseMoney(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const cleaned =
    typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(cleaned) ? cleaned : null;
}

/** Positive money only — empty / 0 / invalid are treated as missing. */
function parsePositiveMoney(value: string | number | null | undefined): number | null {
  const n = parseMoney(value);
  if (n === null || n <= 0) return null;
  return n;
}

function applyPriceOffset(
  value: string | number | null | undefined,
  priceOffset: number
): number | null {
  const n = parseMoney(value);
  if (n === null) return null;
  return n + (Number.isFinite(priceOffset) && priceOffset > 0 ? priceOffset : 0);
}

export type ResolvedExportPrices = {
  /** From purchase_items.unit_price (via supplier_breakdown / product field). */
  purchasePrice: number | null;
  /** Actual selling from purchase_items.selling_price when > 0. */
  sellingPrice: number | null;
  /** Selling if set, otherwise purchase. */
  effectiveSellingPrice: number | null;
  /** True when selling was empty/0 and purchase was used instead. */
  sellingFellBackToPurchase: boolean;
};

/**
 * Resolve export prices from purchases data.
 * Prefer supplier_breakdown rows (PurchaseItem), then top-level product fields.
 */
export function resolveExportPrices(product: any): ResolvedExportPrices {
  const breakdown = Array.isArray(product?.supplier_breakdown) ? product.supplier_breakdown : [];

  let maxPurchaseFromPurchases = 0;
  let maxSellingFromPurchases = 0;
  for (const row of breakdown) {
    const purchase = parsePositiveMoney(row?.purchase_price_value ?? row?.purchase_price);
    const selling = parsePositiveMoney(row?.selling_price_value);
    if (purchase && purchase > maxPurchaseFromPurchases) maxPurchaseFromPurchases = purchase;
    if (selling && selling > maxSellingFromPurchases) maxSellingFromPurchases = selling;
  }

  const topPurchase = parsePositiveMoney(product?.purchase_price);
  const topSelling = parsePositiveMoney(product?.selling_price);

  // Always prefer purchase-table breakdown when present.
  const purchasePrice =
    maxPurchaseFromPurchases > 0 ? maxPurchaseFromPurchases : topPurchase;

  // When breakdown exists, only trust selling_price_value from purchase rows
  // (top-level selling_price may already be a silent purchase fallback from the API).
  let sellingPrice: number | null = null;
  if (breakdown.length > 0) {
    sellingPrice = maxSellingFromPurchases > 0 ? maxSellingFromPurchases : null;
  } else {
    sellingPrice = topSelling;
  }

  const sellingFellBackToPurchase = sellingPrice === null && purchasePrice !== null;
  const effectiveSellingPrice = sellingPrice ?? purchasePrice;

  return {
    purchasePrice,
    sellingPrice,
    effectiveSellingPrice,
    sellingFellBackToPurchase,
  };
}

function getProductStatus(product: any, tagFilter: string): string {
  if (tagFilter && tagFilter !== 'new') {
    const labels: Record<string, string> = {
      sold: 'Sold',
      unknown: 'Unknown',
      returned: 'Returned',
      defective: 'Defective',
      'in-cart': 'In Cart',
    };
    return labels[tagFilter] || tagFilter;
  }

  const stock = getStockInfo(product);
  const hasBarcodes = Array.isArray(product.barcodes) && product.barcodes.length > 0;
  const hasStock = (stock.available || stock.total || 0) > 0;
  if (!hasBarcodes && !hasStock && !(product.stock_quantity > 0) && !(product.available_quantity > 0)) {
    return 'Not Purchased';
  }
  if (stock.isOutOfStock || product.isOutOfStock) return 'Out of Stock';
  if (stock.isLowStock || product.isLowStock) return 'Low Stock';
  return 'In Stock';
}

function cellValue(
  product: any,
  columnId: ProductExportColumnId,
  tagFilter: string,
  rowIndex = 0,
  priceOffset = 0,
  prices?: ResolvedExportPrices
): string {
  const stock = getStockInfo(product);
  const resolved = prices ?? resolveExportPrices(product);

  switch (columnId) {
    case 'sr':
      return String(rowIndex + 1);
    case 'name':
      return sanitizePdfText(product.name) || '-';
    case 'brand':
      return sanitizePdfText(product.brand_name) || '-';
    case 'category':
      return sanitizePdfText(product.category_name) || '-';
    case 'sku':
      return sanitizePdfText(product.sku) || '-';
    case 'stock':
      return formatPdfNumber(
        typeof product.stock_quantity === 'number' ? product.stock_quantity : stock.total
      );
    case 'available':
      return formatPdfNumber(
        typeof product.available_quantity === 'number' ? product.available_quantity : stock.available
      );
    case 'shop_stock':
      return formatPdfNumber(product.shop_stock);
    case 'warehouse_stock':
      return formatPdfNumber(product.warehouse_stock);
    case 'purchase_price':
      return formatPdfMoney(applyPriceOffset(resolved.purchasePrice, priceOffset));
    case 'selling_price':
      return formatPdfMoney(applyPriceOffset(resolved.effectiveSellingPrice, priceOffset));
    case 'low_stock_threshold':
      return formatPdfNumber(product.low_stock_threshold);
    case 'status':
      return getProductStatus(product, tagFilter);
    case 'stock_bifurcation':
      return sanitizePdfText(product.stock_bifurcation) || '-';
    case 'price_bifurcation':
      return sanitizePdfText(product.price_bifurcation) || '-';
    default:
      return '-';
  }
}

export type SellingPriceFallbackItem = {
  id: string | number | null;
  name: string;
  category: string;
  brand: string;
  /** Purchase price used as selling fallback (before offset). */
  originalPrice: number;
  /** Price after custom PDF offset. */
  updatedPrice: number;
};

export type SellingPriceFallbackGroup = {
  category: string;
  brands: Array<{
    brand: string;
    products: SellingPriceFallbackItem[];
  }>;
};

export type SellingPriceFallbackInfo = {
  count: number;
  groups: SellingPriceFallbackGroup[];
};

function formatPlainMoney(value: number): string {
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Products whose selling price is empty/0 and will use purchase price in the export,
 * grouped by category then brand, with original → updated prices after offset.
 */
export function getSellingPriceFallbackInfo(
  products: any[],
  priceOffset = 0
): SellingPriceFallbackInfo {
  const safeOffset =
    Number.isFinite(priceOffset) && priceOffset > 0 ? Math.floor(priceOffset) : 0;

  const items: SellingPriceFallbackItem[] = [];
  products.forEach((product, index) => {
    const prices = resolveExportPrices(product);
    if (!prices.sellingFellBackToPurchase || prices.purchasePrice === null) return;

    const originalPrice = prices.purchasePrice;
    items.push({
      id: product.id ?? null,
      name: sanitizePdfText(product.name) || `Product #${product.id ?? index + 1}`,
      category: categoryLabel(product),
      brand: brandLabel(product),
      originalPrice,
      updatedPrice: originalPrice + safeOffset,
    });
  });

  items.sort((a, b) => {
    const byCategory = compareText(a.category, b.category);
    if (byCategory !== 0) return byCategory;
    const byBrand = compareText(a.brand, b.brand);
    if (byBrand !== 0) return byBrand;
    return compareText(a.name, b.name);
  });

  const groups: SellingPriceFallbackGroup[] = [];
  for (const item of items) {
    let categoryGroup = groups.find((g) => g.category === item.category);
    if (!categoryGroup) {
      categoryGroup = { category: item.category, brands: [] };
      groups.push(categoryGroup);
    }
    let brandGroup = categoryGroup.brands.find((b) => b.brand === item.brand);
    if (!brandGroup) {
      brandGroup = { brand: item.brand, products: [] };
      categoryGroup.brands.push(brandGroup);
    }
    brandGroup.products.push(item);
  }

  return { count: items.length, groups };
}

export function formatFallbackPriceChange(item: SellingPriceFallbackItem): string {
  return `${formatPlainMoney(item.originalPrice)} → ${formatPlainMoney(item.updatedPrice)}`;
}

function categoryLabel(product: any): string {
  return sanitizePdfText(product.category_name) || 'Uncategorized';
}

function brandLabel(product: any): string {
  return sanitizePdfText(product.brand_name) || 'No Brand';
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/** Sort products by category, then brand, then name. */
export function sortProductsByCategoryThenBrand(products: any[]): any[] {
  return [...products].sort((a, b) => {
    const byCategory = compareText(categoryLabel(a), categoryLabel(b));
    if (byCategory !== 0) return byCategory;
    const byBrand = compareText(brandLabel(a), brandLabel(b));
    if (byBrand !== 0) return byBrand;
    return compareText(sanitizePdfText(a.name) || '', sanitizePdfText(b.name) || '');
  });
}

type PdfBodyRow =
  | { kind: 'category'; label: string }
  | { kind: 'brand'; label: string }
  | { kind: 'product'; cells: string[] };

function buildGroupedBody(
  products: any[],
  cols: ProductExportColumnDef[],
  tagFilter: string,
  priceOffset: number
): PdfBodyRow[] {
  const sorted = sortProductsByCategoryThenBrand(products);
  const rows: PdfBodyRow[] = [];
  let lastCategory = '';
  let lastBrand = '';
  let productIndex = 0;

  sorted.forEach((product) => {
    const category = categoryLabel(product);
    const brand = brandLabel(product);
    const prices = resolveExportPrices(product);

    if (category !== lastCategory) {
      rows.push({ kind: 'category', label: `Category: ${category}` });
      lastCategory = category;
      lastBrand = '';
    }

    if (brand !== lastBrand) {
      rows.push({ kind: 'brand', label: `Brand: ${brand}` });
      lastBrand = brand;
    }

    rows.push({
      kind: 'product',
      cells: cols.map((col) =>
        cellValue(product, col.id, tagFilter, productIndex, priceOffset, prices)
      ),
    });
    productIndex += 1;
  });

  return rows;
}

export type ProductExportSummary = {
  productCount: number;
  categoryCount: number;
  brandCount: number;
};

export function buildProductExportSummary(products: any[]): ProductExportSummary {
  const categories = new Set<string>();
  const brands = new Set<string>();

  products.forEach((p) => {
    const category = String(p.category_name || '').trim();
    const brand = String(p.brand_name || '').trim();
    if (category) categories.add(category.toLowerCase());
    if (brand) brands.add(brand.toLowerCase());
  });

  return {
    productCount: products.length,
    categoryCount: categories.size,
    brandCount: brands.size,
  };
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatProductExportSummary(summary: ProductExportSummary): string {
  return `${pluralize(summary.productCount, 'product')} from ${pluralize(summary.categoryCount, 'category', 'categories')} and ${pluralize(summary.brandCount, 'brand')}`;
}

export type ExportProductsPdfOptions = {
  products: any[];
  columnIds: ProductExportColumnId[];
  tagFilter?: string;
  filterLabels?: string[];
  /** Temporary amount added to purchase/selling price columns in the PDF only. */
  priceOffset?: number;
};

export function exportProductsToPdf({
  products,
  columnIds,
  tagFilter = 'new',
  filterLabels: _filterLabels = [],
  priceOffset = 0,
}: ExportProductsPdfOptions): void {
  const selectedColumns = PRODUCT_EXPORT_COLUMNS.filter((c) => columnIds.includes(c.id));
  const cols = selectedColumns.length
    ? selectedColumns
    : PRODUCT_EXPORT_COLUMNS.filter((c) => c.defaultOn);

  const safeOffset =
    Number.isFinite(priceOffset) && priceOffset > 0 ? Math.floor(priceOffset) : 0;

  const orientation = cols.length > 6 ? 'landscape' : 'portrait';
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  doc.setFontSize(16);
  doc.setTextColor(31, 41, 55);
  doc.text('Products Export', margin, 18);

  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  const metaY = 25;
  doc.text(`Generated: ${toLocalDateString(new Date())}`, margin, metaY);

  const groupedRows = buildGroupedBody(products, cols, tagFilter, safeOffset);

  const body = groupedRows.map((row) => {
    if (row.kind === 'product') return row.cells;
    // Span-style label in first cell; rest empty (styled in didParseCell)
    return [row.label, ...Array(Math.max(cols.length - 1, 0)).fill('')];
  });

  const columnStyles: Record<number, { cellWidth?: number; halign?: 'center' | 'left' | 'right' }> = {};
  cols.forEach((col, idx) => {
    if (col.id === 'sr') {
      columnStyles[idx] = { cellWidth: 12, halign: 'center' };
    }
  });

  autoTable(doc, {
    startY: metaY + 4,
    head: [cols.map((c) => pdfColumnLabel(c))],
    body,
    styles: {
      fontSize: cols.length > 8 ? 7 : 8,
      cellPadding: 2,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: cols.length > 8 ? 7 : 8,
    },
    columnStyles,
    alternateRowStyles: { fillColor: [249, 250, 251] },
    margin: { left: margin, right: margin },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const rowMeta = groupedRows[data.row.index];
      if (!rowMeta || rowMeta.kind === 'product') return;

      if (data.column.index === 0) {
        data.cell.colSpan = cols.length;
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.halign = 'left';
        if (rowMeta.kind === 'category') {
          data.cell.styles.fillColor = [30, 64, 175];
          data.cell.styles.textColor = 255;
          data.cell.styles.fontSize = cols.length > 8 ? 8 : 9;
        } else {
          data.cell.styles.fillColor = [219, 234, 254];
          data.cell.styles.textColor = [30, 64, 175];
          data.cell.styles.fontSize = cols.length > 8 ? 7 : 8;
        }
      } else {
        data.cell.styles.fillColor = rowMeta.kind === 'category' ? [30, 64, 175] : [219, 234, 254];
        data.cell.text = [];
      }
    },
  });

  const summary = buildProductExportSummary(products);
  const summaryText = formatProductExportSummary(summary);
  const finalY = (doc as any).lastAutoTable?.finalY ?? metaY + 10;
  const pageHeight = doc.internal.pageSize.getHeight();
  let summaryY = finalY + 10;

  if (summaryY > pageHeight - 20) {
    doc.addPage();
    summaryY = 20;
  }

  doc.setDrawColor(229, 231, 235);
  doc.line(margin, summaryY - 4, pageWidth - margin, summaryY - 4);
  doc.setFontSize(10);
  doc.setTextColor(31, 41, 55);
  doc.setFont('helvetica', 'bold');
  doc.text('Summary', margin, summaryY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(55, 65, 81);
  doc.text(summaryText, margin, summaryY + 6);

  const safeDate = toLocalDateString(new Date()) || 'export';
  doc.save(`products_export_${safeDate}.pdf`);
}
