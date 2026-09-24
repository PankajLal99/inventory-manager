/**
 * jsPDF Helvetica can't encode emoji. Strip them from text strings and
 * draw the credit ❤ as a real emoji image (browser-rendered canvas PNG).
 */

const HEART_RE = /❤|♥|❤️|\u2764\uFE0F?/g;

let heartPngCache: string | null = null;

export function nameHasCreditHeart(value?: string | null): boolean {
  return /❤|♥|❤️|\u2764\uFE0F?/.test(String(value ?? ''));
}

/** Printable Latin text for jsPDF — hearts/emoji removed (draw heart separately). */
export function sanitizePdfText(value?: string | null) {
  return String(value ?? '')
    .replace(HEART_RE, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u2600-\u27BF]/g, '')
    .replace(/[\uFE0E\uFE0F]/g, '')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Browser-rendered ❤ as PNG data URL for jsPDF.addImage */
export function creditHeartEmojiPng(): string | null {
  if (typeof document === 'undefined') return null;
  if (heartPngCache) return heartPngCache;
  try {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, size, size);
    ctx.font = `${Math.round(size * 0.85)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('❤', size / 2, size / 2 + 2);
    heartPngCache = canvas.toDataURL('image/png');
    return heartPngCache;
  } catch {
    return null;
  }
}

type JsPdfLike = {
  getTextWidth: (text: string) => number;
  addImage: (
    imageData: string,
    format: string,
    x: number,
    y: number,
    w: number,
    h: number
  ) => unknown;
};

/** Draw ❤ after text at (x, yBaseline) — y is text baseline like doc.text */
export function drawPdfHeartAfterText(
  doc: JsPdfLike,
  text: string,
  x: number,
  yBaseline: number,
  heartMm = 3.2
) {
  const png = creditHeartEmojiPng();
  if (!png) return;
  const textW = text ? doc.getTextWidth(text) : 0;
  const gap = 0.8;
  const y = yBaseline - heartMm * 0.78;
  doc.addImage(png, 'PNG', x + textW + gap, y, heartMm, heartMm);
}

type AutoTableCellHookData = {
  section: string;
  column: { index: number };
  row: { index: number };
  cell: { x: number; y: number; width: number; height: number; text: string | string[] };
};

/**
 * autoTable didDrawCell: paint ❤ after customer name when that row had a heart.
 * `customerColIndex` — column with the name; `heartFlags[rowIndex]` — whether to draw.
 */
export function pdfHeartDidDrawCell(
  doc: JsPdfLike,
  data: AutoTableCellHookData,
  customerColIndex: number,
  heartFlags: boolean[]
) {
  if (data.section !== 'body' || data.column.index !== customerColIndex) return;
  if (!heartFlags[data.row.index]) return;
  const png = creditHeartEmojiPng();
  if (!png) return;

  const raw = Array.isArray(data.cell.text) ? data.cell.text.join(' ') : String(data.cell.text || '');
  // Width of name without trailing spacer spaces reserved for the emoji
  const label = raw.replace(/\s+$/, '');
  const textW = label ? doc.getTextWidth(label) : 0;
  const heartMm = Math.min(3.2, data.cell.height * 0.75);
  const x = data.cell.x + 1.5 + textW + 0.5;
  const y = data.cell.y + (data.cell.height - heartMm) / 2;
  if (x + heartMm > data.cell.x + data.cell.width - 0.3) return;
  doc.addImage(png, 'PNG', x, y, heartMm, heartMm);
}
