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
  { id: 'purchase_price', label: 'Purchase Price', defaultOn: false },
  { id: 'selling_price', label: 'Selling Price', defaultOn: false },
  { id: 'low_stock_threshold', label: 'Low Stock Limit', defaultOn: false },
  { id: 'status', label: 'Status', defaultOn: false },
  { id: 'stock_bifurcation', label: 'Stock by Supplier', defaultOn: false },
  { id: 'price_bifurcation', label: 'Price by Supplier', defaultOn: false },
];

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
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : null;
}

function applyPriceOffset(
  value: string | number | null | undefined,
  priceOffset: number
): number | null {
  const n = parseMoney(value);
  if (n === null) return null;
  return n + (Number.isFinite(priceOffset) && priceOffset > 0 ? priceOffset : 0);
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
  priceOffset = 0
): string {
  const stock = getStockInfo(product);

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
      return formatPdfMoney(applyPriceOffset(product.purchase_price, priceOffset));
    case 'selling_price':
      return formatPdfMoney(applyPriceOffset(product.selling_price, priceOffset));
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
      cells: cols.map((col) => cellValue(product, col.id, tagFilter, productIndex, priceOffset)),
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
  filterLabels = [],
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
  let metaY = 25;
  doc.text(`Generated: ${toLocalDateString(new Date())}`, margin, metaY);

  const tagLabel =
    tagFilter === 'new'
      ? 'All Products'
      : tagFilter.charAt(0).toUpperCase() + tagFilter.slice(1).replace('-', ' ');
  metaY += 5;
  doc.text(`View: ${tagLabel}`, margin, metaY);

  metaY += 5;
  doc.text('Grouped by: Category, then Brand', margin, metaY);

  if (safeOffset > 0) {
    metaY += 5;
    doc.text(`Price adjustment (PDF only): +Rs. ${safeOffset}`, margin, metaY);
  }

  if (filterLabels.length > 0) {
    metaY += 5;
    const filterLine = `Filters: ${filterLabels.join(' | ')}`;
    const wrapped = doc.splitTextToSize(filterLine, pageWidth - margin * 2);
    doc.text(wrapped, margin, metaY);
    metaY += wrapped.length * 4;
  }

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
    head: [cols.map((c) => c.label)],
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
