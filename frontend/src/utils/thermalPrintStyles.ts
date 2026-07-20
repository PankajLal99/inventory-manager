export interface ThermalPrintSettings {
  /** Thermal roll width in mm (58, 80, 101.6 for 4") */
  paperWidthMm: number;
  /** Page margin on all sides in mm */
  pageMarginMm: number;
  /** Inner content padding in px */
  contentPaddingPx: number;
  fontFamily: string;
  fontSizeBody: number;
  fontSizeHeader: number;
  fontSizeSmall: number;
  fontSizeTable: number;
  fontSizeTotal: number;
  fontSizeFooter: number;
  /** Max characters for item names on thermal receipts */
  itemNameMaxChars: number;

  /** Receipt header — shop / business name */
  shopName: string;
  shopNameBold: boolean;
  shopNameFontSize: number;
  /** Empty string uses global fontFamily */
  shopNameFontFamily: string;

  addressLine1: string;
  addressLine2: string;
  subHeaderLine1: string;
  subHeaderLine2: string;
  subHeadersBold: boolean;
  subHeaderFontSize: number;
  subHeaderFontFamily: string;

  documentTitle: string;
  documentTitleBold: boolean;
  documentTitleFontFamily: string;

  showInvoiceStore: boolean;
  showCustomer: boolean;

  footerMessage: string;
  footerBold: boolean;
  footerFontFamily: string;
}

export const THERMAL_PAPER_PRESETS: { label: string; widthMm: number; note?: string }[] = [
  { label: '79 mm (7.9 cm) — your roll', widthMm: 79, note: 'Standard near-80mm thermal roll' },
  { label: '80 mm (3")', widthMm: 80, note: 'Same class as 7.9 cm rolls' },
  { label: '58 mm (2")', widthMm: 58 },
  { label: '101.6 mm (4")', widthMm: 101.6 },
];

/** Recommended layout for 7.9 cm / 79 mm × 54 gsm rolls (common POS thermal paper). */
export const THERMAL_79MM_ROLL_SETTINGS: Partial<ThermalPrintSettings> = {
  paperWidthMm: 79,
  pageMarginMm: 2,
  contentPaddingPx: 3,
  fontSizeBody: 9,
  fontSizeHeader: 13,
  fontSizeSmall: 8,
  fontSizeTable: 9,
  fontSizeTotal: 10,
  fontSizeFooter: 7,
  shopNameFontSize: 14,
  subHeaderFontSize: 8,
  itemNameMaxChars: 0,
};

export const THERMAL_ROLL_SPEC_GUIDE = [
  { spec: '7.9 cm', meaning: 'Paper width — the only size that affects print layout', action: 'Set Paper Width to 79 mm' },
  { spec: '45 cm (or 45 m)', meaning: 'Roll length — how much paper is on the spool', action: 'Ignore for settings' },
  { spec: '54 gsm', meaning: 'Paper thickness / weight', action: 'Ignore for settings' },
  { spec: '1.3 cm', meaning: 'Usually the cardboard core diameter in the middle of the roll', action: 'Ignore for settings' },
] as const;

export const THERMAL_FONT_OPTIONS = [
  { label: 'Courier New', value: 'Courier New' },
  { label: 'Monospace', value: 'monospace' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Helvetica', value: 'Helvetica' },
  { label: 'Lucida Console', value: 'Lucida Console' },
  { label: 'Times New Roman', value: 'Times New Roman' },
];

export const DEFAULT_THERMAL_PRINT_SETTINGS: ThermalPrintSettings = {
  paperWidthMm: 79,
  pageMarginMm: 2,
  contentPaddingPx: 3,
  fontFamily: 'Courier New',
  fontSizeBody: 9,
  fontSizeHeader: 13,
  fontSizeSmall: 8,
  fontSizeTable: 9,
  fontSizeTotal: 10,
  fontSizeFooter: 7,
  itemNameMaxChars: 0,

  shopName: 'MANISH TRADERS',
  shopNameBold: true,
  shopNameFontSize: 14,
  shopNameFontFamily: '',

  addressLine1: '',
  addressLine2: '',
  subHeaderLine1: '',
  subHeaderLine2: '',
  subHeadersBold: false,
  subHeaderFontSize: 8,
  subHeaderFontFamily: '',

  documentTitle: 'INVOICE',
  documentTitleBold: true,
  documentTitleFontFamily: '',

  showInvoiceStore: true,
  showCustomer: true,

  footerMessage: 'Thank you for your business!',
  footerBold: false,
  footerFontFamily: '',
};

const STORAGE_KEY = 'thermal_print_settings';

export const loadThermalPrintSettings = (): ThermalPrintSettings => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_THERMAL_PRINT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (error) {
    console.warn('Failed to load thermal print settings:', error);
  }
  return DEFAULT_THERMAL_PRINT_SETTINGS;
};

export const saveThermalPrintSettings = (settings: ThermalPrintSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Failed to save thermal print settings:', error);
  }
};

function mmToIn(mm: number): number {
  return mm / 25.4;
}

export function escapeThermalHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function resolveThermalFont(preferred: string, fallback: string): string {
  const family = preferred.trim() || fallback;
  return family === 'monospace' ? 'monospace' : `'${family}', monospace`;
}

export function truncateThermalItemName(name: string, settings?: ThermalPrintSettings): string {
  const max = settings?.itemNameMaxChars ?? DEFAULT_THERMAL_PRINT_SETTINGS.itemNameMaxChars;
  if (max <= 0) return name;
  return name.substring(0, max);
}

export function formatThermalItemName(name: string, settings?: ThermalPrintSettings): string {
  return escapeThermalHtml(truncateThermalItemName(name, settings));
}

export const THERMAL_ITEMS_TABLE_HEAD_HTML = `
            <thead>
              <tr>
                <th class="col-item">Item</th>
                <th class="col-qty text-right">Qty</th>
                <th class="col-price text-right">Price</th>
                <th class="col-total text-right">Total</th>
              </tr>
            </thead>`;

export interface ThermalReceiptMeta {
  invoiceNumber?: string;
  invoiceId?: string | number;
  createdAt?: string;
  storeName?: string;
  customerName?: string;
  formatDate?: (dateString: string) => string;
}

export function buildThermalReceiptHeaderHtml(
  settings: ThermalPrintSettings,
  meta: ThermalReceiptMeta,
): string {
  const shopFont = resolveThermalFont(settings.shopNameFontFamily, settings.fontFamily);
  const subFont = resolveThermalFont(settings.subHeaderFontFamily, settings.fontFamily);
  const titleFont = resolveThermalFont(settings.documentTitleFontFamily, settings.fontFamily);

  const shopStyle = `font-family:${shopFont};font-size:${settings.shopNameFontSize}px;font-weight:${settings.shopNameBold ? 'bold' : 'normal'};margin-bottom:2px;line-height:1.2;`;
  const subStyle = `font-family:${subFont};font-size:${settings.subHeaderFontSize}px;font-weight:${settings.subHeadersBold ? 'bold' : 'normal'};margin:1px 0;line-height:1.25;`;
  const titleStyle = `font-family:${titleFont};font-size:${settings.fontSizeHeader}px;font-weight:${settings.documentTitleBold ? 'bold' : 'normal'};margin-bottom:3px;`;

  const brandingLines: string[] = [];
  if (settings.shopName.trim()) {
    brandingLines.push(`<div class="shop-name" style="${shopStyle}">${escapeThermalHtml(settings.shopName)}</div>`);
  }
  for (const line of [settings.addressLine1, settings.addressLine2, settings.subHeaderLine1, settings.subHeaderLine2]) {
    if (line.trim()) {
      brandingLines.push(`<div class="sub-header" style="${subStyle}">${escapeThermalHtml(line)}</div>`);
    }
  }

  const invoiceLabel = meta.invoiceNumber || (meta.invoiceId != null ? `#${meta.invoiceId}` : '');
  const dateStr =
    meta.createdAt && meta.formatDate ? meta.formatDate(meta.createdAt) : '';

  const infoRows: string[] = [];
  if (settings.showInvoiceStore) {
    infoRows.push(
      `<div class="info-row"><strong>Store:</strong> ${escapeThermalHtml(meta.storeName || '-')}</div>`,
    );
  }
  if (settings.showCustomer) {
    infoRows.push(
      `<div class="info-row"><strong>Customer:</strong> ${escapeThermalHtml(meta.customerName || 'Walk-in Customer')}</div>`,
    );
  }

  return `
          <div class="header">
            ${brandingLines.join('\n            ')}
            <h1 style="${titleStyle}">${escapeThermalHtml(settings.documentTitle)}</h1>
            ${invoiceLabel ? `<p>${escapeThermalHtml(invoiceLabel)}</p>` : ''}
            ${dateStr ? `<p>${escapeThermalHtml(dateStr)}</p>` : ''}
          </div>
          ${infoRows.length > 0 ? `<div class="info">${infoRows.join('')}</div>` : ''}`;
}

export function buildThermalReceiptFooterHtml(settings: ThermalPrintSettings): string {
  if (!settings.footerMessage.trim()) return '';
  const footerFont = resolveThermalFont(settings.footerFontFamily, settings.fontFamily);
  const style = `font-family:${footerFont};font-weight:${settings.footerBold ? 'bold' : 'normal'};`;
  return `
          <div class="footer">
            <p style="${style}">${escapeThermalHtml(settings.footerMessage)}</p>
          </div>`;
}

export function buildThermalPrintCss(
  settings: ThermalPrintSettings = loadThermalPrintSettings(),
  options: { includeWatermark?: boolean } = {},
): string {
  const paperWidthIn = mmToIn(settings.paperWidthMm);
  const fontStack = resolveThermalFont(settings.fontFamily, settings.fontFamily);

  const watermarkBlock = options.includeWatermark
    ? `
            body { position: relative; }
            .watermark {
              position: absolute;
              top: 50%;
              left: 0;
              right: 0;
              transform: translateY(-50%) rotate(-45deg);
              font-size: 60px;
              font-weight: bold;
              color: rgba(0, 0, 0, 0.08);
              z-index: 0;
              pointer-events: none;
              white-space: nowrap;
              text-transform: uppercase;
              letter-spacing: 5px;
              text-align: center;
            }
            body > :not(.watermark) { position: relative; z-index: 1; }`
    : '';

  const watermarkPrintBlock = options.includeWatermark
    ? `
            .watermark {
              position: absolute;
              top: 50%;
              left: 0;
              right: 0;
              transform: translateY(-50%) rotate(-45deg);
              print-color-adjust: exact;
              -webkit-print-color-adjust: exact;
            }`
    : '';

  const paperWidthMm = settings.paperWidthMm;

  return `
            * { margin: 0; padding: 0; box-sizing: border-box; }
            html {
              height: auto;
              min-height: 0;
              overflow: visible;
            }
            @page {
              size: ${paperWidthMm}mm auto;
              margin: 0;
            }
            body {
              font-family: ${fontStack};
              font-size: ${settings.fontSizeBody}px;
              width: ${paperWidthIn}in;
              max-width: ${paperWidthIn}in;
              min-height: 0;
              height: auto;
              overflow: visible;
              margin: 0;
              padding: ${settings.pageMarginMm}mm ${settings.contentPaddingPx}px;
              color: #000;
            }
            .header {
              text-align: center;
              margin-bottom: 8px;
              border-bottom: 1px dashed #000;
              padding-bottom: 5px;
            }
            .header h1 { margin-bottom: 3px; }
            .header p { font-size: ${settings.fontSizeSmall}px; margin: 1px 0; }
            .shop-name { text-transform: uppercase; letter-spacing: 0.5px; }
            .sub-header { color: #000; }
            .info { margin-bottom: 6px; font-size: ${settings.fontSizeSmall}px; }
            .info-row { margin: 2px 0; }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 6px;
              font-size: ${settings.fontSizeTable}px;
              table-layout: fixed;
            }
            table.items-table {
              width: 100%;
              font-weight: 900;
            }
            table.items-table thead th {
              padding: 3px 1px;
              text-align: left;
              border-bottom: 1px dashed #000;
              font-weight: 900;
              -webkit-text-stroke: 0.2px #000;
            }
            table.items-table tbody td {
              padding: 2px 1px;
              border-bottom: 1px dotted #ccc;
              vertical-align: top;
              font-weight: 900;
              line-height: 1.2;
              -webkit-text-stroke: 0.2px #000;
              word-wrap: break-word;
              overflow-wrap: anywhere;
            }
            table.items-table .col-item {
              width: 44%;
              max-width: 44%;
            }
            table.items-table .col-qty {
              width: 9%;
              white-space: nowrap;
            }
            table.items-table .col-price {
              width: 23%;
              white-space: nowrap;
            }
            table.items-table .col-total {
              width: 24%;
              white-space: nowrap;
            }
            table.items-table tr.sub-row td {
              font-weight: normal;
              font-size: ${settings.fontSizeSmall}px;
              -webkit-text-stroke: 0;
              padding-top: 0;
              padding-bottom: 4px;
              line-height: 1.25;
            }
            th { padding: 3px 2px; text-align: left; border-bottom: 1px dashed #000; font-weight: bold; }
            td {
              padding: 2px;
              border-bottom: 1px dotted #ccc;
              vertical-align: top;
              word-wrap: break-word;
              overflow-wrap: anywhere;
            }
            .text-right { text-align: right; }
            .text-center { text-align: center; }
            .summary { margin-top: 6px; border-top: 1px dashed #000; padding-top: 4px; }
            .summary-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: ${settings.fontSizeSmall}px; }
            .summary-total { border-top: 1px solid #000; margin-top: 4px; padding-top: 4px; font-weight: bold; font-size: ${settings.fontSizeTotal}px; }
            .footer { margin-top: 8px; padding-top: 4px; border-top: 1px dashed #000; text-align: center; font-size: ${settings.fontSizeFooter}px; }
            ${watermarkBlock}
            @media print {
              @page {
                size: ${paperWidthMm}mm auto;
                margin: 0;
              }
              html, body {
                width: ${paperWidthIn}in !important;
                max-width: ${paperWidthIn}in !important;
                height: auto !important;
                min-height: 0 !important;
                max-height: none !important;
                overflow: visible !important;
              }
              body {
                margin: 0 !important;
                padding: ${settings.pageMarginMm}mm ${settings.contentPaddingPx}px !important;
              }
              .no-print { display: none; }
              table.items-table tbody td,
              table.items-table thead th {
                font-weight: 900 !important;
                -webkit-text-stroke: 0.2px #000;
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
              }
              table.items-table tr.sub-row td {
                font-weight: normal !important;
                -webkit-text-stroke: 0;
              }
              table {
                page-break-inside: auto;
                break-inside: auto;
              }
              tr {
                page-break-inside: auto;
                break-inside: auto;
              }
              ${watermarkPrintBlock}
            }`;
}

const THERMAL_TEST_PRODUCTS = [
  { name: 'Sample Product A', qty: 2, unitPrice: 250, lineTotal: 500 },
  { name: 'USB Cable Type-C 1m', qty: 1, unitPrice: 199, lineTotal: 199 },
  { name: 'Very Long Product Name For Width Test', qty: 3, unitPrice: 150, lineTotal: 450 },
] as const;

function formatThermalAmount(amount: number): string {
  return amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function buildThermalTestPrintHtml(settings: ThermalPrintSettings): string {
  const now = new Date();
  const formatDate = (date: Date) =>
    date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const subtotal = THERMAL_TEST_PRODUCTS.reduce((sum, item) => sum + item.lineTotal, 0);
  const itemRows = THERMAL_TEST_PRODUCTS.map(
    (item) => `
                <tr>
                  <td class="col-item">${escapeThermalHtml(truncateThermalItemName(item.name, settings))}</td>
                  <td class="col-qty text-right">${item.qty}</td>
                  <td class="col-price text-right">₹${formatThermalAmount(item.unitPrice)}</td>
                  <td class="col-total text-right">₹${formatThermalAmount(item.lineTotal)}</td>
                </tr>`,
  ).join('');

  return `<!DOCTYPE html>
      <html>
        <head>
          <title>Thermal Test Print</title>
          <meta charset="UTF-8">
          <style>${buildThermalPrintCss(settings)}</style>
        </head>
        <body>
          ${buildThermalReceiptHeaderHtml(settings, {
            invoiceNumber: 'TEST-PRINT-001',
            createdAt: now.toISOString(),
            storeName: 'Test Store',
            customerName: 'Test Customer',
            formatDate: () => formatDate(now),
          })}
          <table class="items-table">
            ${THERMAL_ITEMS_TABLE_HEAD_HTML}
            <tbody>${itemRows}
            </tbody>
          </table>
          <div class="summary">
            <div class="summary-row">
              <span>Subtotal:</span>
              <span>₹${formatThermalAmount(subtotal)}</span>
            </div>
            <div class="summary-row summary-total">
              <span>TOTAL:</span>
              <span>₹${formatThermalAmount(subtotal)}</span>
            </div>
          </div>
          ${buildThermalReceiptFooterHtml(settings)}
        </body>
      </html>`;
}

export function printThermalHtml(html: string): boolean {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to print the test receipt');
    return false;
  }

  printWindow.document.write(html);
  printWindow.document.close();

  const triggerPrint = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        printWindow.print();
      });
    });
  };

  const schedulePrint = () => {
    const doc = printWindow.document;
    if (doc.fonts?.ready) {
      doc.fonts.ready.then(triggerPrint).catch(triggerPrint);
      return;
    }
    setTimeout(triggerPrint, 300);
  };

  if (printWindow.document.readyState === 'complete') {
    schedulePrint();
  } else {
    printWindow.onload = schedulePrint;
  }

  return true;
}

export function printThermalTestReceipt(settings: ThermalPrintSettings): boolean {
  return printThermalHtml(buildThermalTestPrintHtml(settings));
}

