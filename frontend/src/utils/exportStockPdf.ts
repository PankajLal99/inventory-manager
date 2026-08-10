import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toLocalDateString } from '../lib/utils';

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

function formatPdfNumber(value: string | number | null | undefined, decimals = 0) {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return '-';
  if (decimals <= 0) return String(Math.round(n));
  return String(Number(n.toFixed(decimals)));
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

type PdfBodyRow =
  | { kind: 'category'; label: string }
  | { kind: 'brand'; label: string }
  | { kind: 'product'; cells: string[] };

type StockExportSummary = {
  productCount: number;
  categoryCount: number;
  brandCount: number;
};

function buildSummary(categories: string[], brands: string[], productCount: number): StockExportSummary {
  return {
    productCount,
    categoryCount: new Set(categories.map((c) => c.toLowerCase())).size,
    brandCount: new Set(brands.map((b) => b.toLowerCase())).size,
  };
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatSummary(summary: StockExportSummary): string {
  return `${pluralize(summary.productCount, 'product')} from ${pluralize(summary.categoryCount, 'category', 'categories')} and ${pluralize(summary.brandCount, 'brand')}`;
}

function renderGroupedPdf(options: {
  title: string;
  fileNamePrefix: string;
  head: string[];
  groupedRows: PdfBodyRow[];
  summary: StockExportSummary;
  metaLines?: string[];
  landscape?: boolean;
  srColumnIndex?: number | null;
}) {
  const {
    title,
    fileNamePrefix,
    head,
    groupedRows,
    summary,
    metaLines = [],
    landscape = false,
    srColumnIndex = 0,
  } = options;

  const doc = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  doc.setFontSize(16);
  doc.setTextColor(31, 41, 55);
  doc.text(title, margin, 18);

  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  let metaY = 25;
  doc.text(`Generated: ${toLocalDateString(new Date())}`, margin, metaY);
  for (const line of metaLines) {
    metaY += 5;
    doc.text(sanitizePdfText(line), margin, metaY);
  }

  const body = groupedRows.map((row) => {
    if (row.kind === 'product') return row.cells;
    return [row.label, ...Array(Math.max(head.length - 1, 0)).fill('')];
  });

  const columnStyles: Record<number, { cellWidth?: number; halign?: 'center' | 'left' | 'right' }> = {};
  if (srColumnIndex != null && srColumnIndex >= 0) {
    columnStyles[srColumnIndex] = { cellWidth: 12, halign: 'center' };
  }

  const fontSize = head.length > 8 ? 7 : 8;

  autoTable(doc, {
    startY: metaY + 4,
    head: [head],
    body,
    styles: {
      fontSize,
      cellPadding: 2,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: 255,
      fontStyle: 'bold',
      fontSize,
    },
    columnStyles,
    alternateRowStyles: { fillColor: [249, 250, 251] },
    margin: { left: margin, right: margin },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const rowMeta = groupedRows[data.row.index];
      if (!rowMeta || rowMeta.kind === 'product') return;

      if (data.column.index === 0) {
        data.cell.colSpan = head.length;
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.halign = 'left';
        if (rowMeta.kind === 'category') {
          data.cell.styles.fillColor = [30, 64, 175];
          data.cell.styles.textColor = 255;
          data.cell.styles.fontSize = fontSize + 1;
        } else {
          data.cell.styles.fillColor = [219, 234, 254];
          data.cell.styles.textColor = [30, 64, 175];
          data.cell.styles.fontSize = fontSize;
        }
      } else {
        data.cell.styles.fillColor = rowMeta.kind === 'category' ? [30, 64, 175] : [219, 234, 254];
        data.cell.text = [];
      }
    },
  });

  const summaryText = formatSummary(summary);
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
  doc.save(`${fileNamePrefix}_${safeDate}.pdf`);
}

// --- Stock Alerts ---

export type StockAlertExportColumnId =
  | 'sr'
  | 'status'
  | 'name'
  | 'sku'
  | 'category'
  | 'brand'
  | 'supplier'
  | 'available'
  | 'low_stock_threshold';

export type StockAlertExportColumnDef = {
  id: StockAlertExportColumnId;
  label: string;
  defaultOn: boolean;
};

export const STOCK_ALERT_EXPORT_COLUMNS: StockAlertExportColumnDef[] = [
  { id: 'sr', label: 'S.No', defaultOn: true },
  { id: 'status', label: 'Status', defaultOn: true },
  { id: 'name', label: 'Product', defaultOn: true },
  { id: 'sku', label: 'SKU', defaultOn: false },
  { id: 'category', label: 'Category', defaultOn: false },
  { id: 'brand', label: 'Brand', defaultOn: false },
  { id: 'supplier', label: 'Supplier', defaultOn: true },
  { id: 'available', label: 'Available', defaultOn: true },
  { id: 'low_stock_threshold', label: 'Low Stock Limit', defaultOn: true },
];

export function defaultStockAlertExportColumnIds(): StockAlertExportColumnId[] {
  return STOCK_ALERT_EXPORT_COLUMNS.filter((c) => c.defaultOn).map((c) => c.id);
}

export type StockAlertExportRow = {
  product__name?: string;
  product__sku?: string;
  product__category?: string;
  product__brand?: string;
  supplier__name?: string;
  available_quantity?: number;
  product__low_stock_threshold?: number;
  status: 'sold_out' | 'low';
};

function alertCategoryLabel(product: StockAlertExportRow): string {
  const raw = sanitizePdfText(product.product__category);
  return !raw || raw === 'N/A' ? 'No category' : raw;
}

function alertBrandLabel(product: StockAlertExportRow): string {
  const raw = sanitizePdfText(product.product__brand);
  return !raw || raw === 'N/A' ? 'No brand' : raw;
}

function alertStatusLabel(status: StockAlertExportRow['status']): string {
  return status === 'sold_out' ? 'Sold out' : 'Getting sold out';
}

function alertSupplierLabel(product: StockAlertExportRow): string {
  const raw = sanitizePdfText(product.supplier__name);
  return !raw || raw === 'N/A' ? 'No supplier' : raw;
}

function alertCellValue(
  product: StockAlertExportRow,
  columnId: StockAlertExportColumnId,
  rowIndex: number
): string {
  switch (columnId) {
    case 'sr':
      return String(rowIndex + 1);
    case 'status':
      return alertStatusLabel(product.status);
    case 'name':
      return sanitizePdfText(product.product__name) || '-';
    case 'sku':
      return sanitizePdfText(product.product__sku) || '-';
    case 'category':
      return alertCategoryLabel(product);
    case 'brand':
      return alertBrandLabel(product);
    case 'supplier':
      return alertSupplierLabel(product);
    case 'available':
      return formatPdfNumber(product.available_quantity, 0);
    case 'low_stock_threshold':
      return formatPdfNumber(product.product__low_stock_threshold, 0);
    default:
      return '-';
  }
}

export function exportStockAlertsToPdf(options: {
  products: StockAlertExportRow[];
  columnIds?: StockAlertExportColumnId[];
  tabLabel?: string;
}): void {
  const { products, tabLabel, columnIds } = options;
  if (!products.length) return;

  const selectedColumns = STOCK_ALERT_EXPORT_COLUMNS.filter((c) =>
    (columnIds?.length ? columnIds : defaultStockAlertExportColumnIds()).includes(c.id)
  );
  const cols = selectedColumns.length
    ? selectedColumns
    : STOCK_ALERT_EXPORT_COLUMNS.filter((c) => c.defaultOn);

  const sorted = [...products].sort((a, b) => {
    const byCategory = compareText(alertCategoryLabel(a), alertCategoryLabel(b));
    if (byCategory !== 0) return byCategory;
    const byBrand = compareText(alertBrandLabel(a), alertBrandLabel(b));
    if (byBrand !== 0) return byBrand;
    return compareText(sanitizePdfText(a.product__name) || '', sanitizePdfText(b.product__name) || '');
  });

  const head = cols.map((c) => c.label);
  const groupedRows: PdfBodyRow[] = [];
  let lastCategory = '';
  let lastBrand = '';
  let productIndex = 0;
  const categories: string[] = [];
  const brands: string[] = [];

  sorted.forEach((product) => {
    const category = alertCategoryLabel(product);
    const brand = alertBrandLabel(product);
    categories.push(category);
    brands.push(brand);

    if (category !== lastCategory) {
      groupedRows.push({ kind: 'category', label: `Category: ${category}` });
      lastCategory = category;
      lastBrand = '';
    }
    if (brand !== lastBrand) {
      groupedRows.push({ kind: 'brand', label: `Brand: ${brand}` });
      lastBrand = brand;
    }

    groupedRows.push({
      kind: 'product',
      cells: cols.map((col) => alertCellValue(product, col.id, productIndex)),
    });
    productIndex += 1;
  });

  const metaLines: string[] = [];
  if (tabLabel) metaLines.push(`View: ${tabLabel}`);

  renderGroupedPdf({
    title: 'Stock Alerts — Products to Order',
    fileNamePrefix: 'stock_alerts_order_list',
    head,
    groupedRows,
    summary: buildSummary(categories, brands, products.length),
    metaLines,
    landscape: cols.length > 6,
    srColumnIndex: cols.findIndex((c) => c.id === 'sr'),
  });
}

// --- Stock Overview ---

export type StockOverviewExportRow = {
  name?: string;
  brand_name?: string;
  category_name?: string;
  warehouse_stock?: number;
  shop_stock?: number;
  available_quantity?: number;
};

function overviewCategoryLabel(product: StockOverviewExportRow): string {
  return sanitizePdfText(product.category_name) || 'Uncategorized';
}

function overviewBrandLabel(product: StockOverviewExportRow): string {
  return sanitizePdfText(product.brand_name) || 'No Brand';
}

export function exportStockOverviewToPdf(options: {
  products: StockOverviewExportRow[];
  filterLabels?: string[];
}): void {
  const { products, filterLabels = [] } = options;
  if (!products.length) return;

  const sorted = [...products].sort((a, b) => {
    const byCategory = compareText(overviewCategoryLabel(a), overviewCategoryLabel(b));
    if (byCategory !== 0) return byCategory;
    const byBrand = compareText(overviewBrandLabel(a), overviewBrandLabel(b));
    if (byBrand !== 0) return byBrand;
    return compareText(sanitizePdfText(a.name) || '', sanitizePdfText(b.name) || '');
  });

  const head = ['S.No', 'Product', 'Warehouse', 'Shop Alloc', 'Available', 'Total'];
  const groupedRows: PdfBodyRow[] = [];
  let lastCategory = '';
  let lastBrand = '';
  let productIndex = 0;
  const categories: string[] = [];
  const brands: string[] = [];

  sorted.forEach((product) => {
    const category = overviewCategoryLabel(product);
    const brand = overviewBrandLabel(product);
    categories.push(category);
    brands.push(brand);

    if (category !== lastCategory) {
      groupedRows.push({ kind: 'category', label: `Category: ${category}` });
      lastCategory = category;
      lastBrand = '';
    }
    if (brand !== lastBrand) {
      groupedRows.push({ kind: 'brand', label: `Brand: ${brand}` });
      lastBrand = brand;
    }

    const warehouse = Number(product.warehouse_stock) || 0;
    const shopAlloc = Number(product.shop_stock) || 0;
    const available = Number(product.available_quantity) || 0;
    const total = warehouse + available;

    groupedRows.push({
      kind: 'product',
      cells: [
        String(productIndex + 1),
        sanitizePdfText(product.name) || '-',
        formatPdfNumber(warehouse, 2),
        formatPdfNumber(shopAlloc, 2),
        formatPdfNumber(available, 2),
        formatPdfNumber(total, 2),
      ],
    });
    productIndex += 1;
  });

  const metaLines = filterLabels.length ? [`Filters: ${filterLabels.join(', ')}`] : [];

  renderGroupedPdf({
    title: 'Stock Overview',
    fileNamePrefix: 'stock_overview',
    head,
    groupedRows,
    summary: buildSummary(categories, brands, products.length),
    metaLines,
    landscape: false,
  });
}
