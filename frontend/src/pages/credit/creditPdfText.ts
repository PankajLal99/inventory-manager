/**
 * jsPDF Helvetica can't encode emoji. Strip them from text strings and
 * draw the credit ❤ as a real emoji image (browser-rendered canvas PNG),
 * with a vector heart fallback for mobile browsers that blank the canvas emoji.
 */

const HEART_RE = /❤|♥|❤️|\u2764\uFE0F?/g;

let heartPngCache: string | null | undefined;

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

/** Browser-rendered ❤ as PNG data URL for jsPDF.addImage (null if unavailable). */
export function creditHeartEmojiPng(): string | null {
  if (typeof document === 'undefined') return null;
  if (heartPngCache !== undefined) return heartPngCache;
  try {
    const size = 96;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      heartPngCache = null;
      return null;
    }
    ctx.clearRect(0, 0, size, size);
    ctx.font = `${Math.round(size * 0.78)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('❤', size / 2, size / 2 + 2);
    // If the emoji didn't paint (common on some Android WebViews), skip blank PNG
    const sample = ctx.getImageData(Math.floor(size / 2), Math.floor(size / 2), 1, 1).data;
    if (sample[3] < 8) {
      heartPngCache = null;
      return null;
    }
    heartPngCache = canvas.toDataURL('image/png');
    return heartPngCache;
  } catch {
    heartPngCache = null;
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
  setFillColor: (r: number, g: number, b: number) => unknown;
  circle: (x: number, y: number, r: number, style?: string) => unknown;
  triangle: (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    style?: string
  ) => unknown;
};

/** Vector ❤ when canvas emoji isn't available (mobile WebViews). */
function drawVectorHeart(doc: JsPdfLike, x: number, y: number, sizeMm: number) {
  const s = sizeMm;
  doc.setFillColor(220, 38, 38);
  const r = s * 0.28;
  doc.circle(x + s * 0.32, y + s * 0.32, r, 'F');
  doc.circle(x + s * 0.68, y + s * 0.32, r, 'F');
  doc.triangle(
    x + s * 0.08,
    y + s * 0.38,
    x + s * 0.92,
    y + s * 0.38,
    x + s * 0.5,
    y + s * 0.95,
    'F'
  );
}

function placeHeart(doc: JsPdfLike, x: number, y: number, heartMm: number) {
  const png = creditHeartEmojiPng();
  if (png) {
    doc.addImage(png, 'PNG', x, y, heartMm, heartMm);
    return;
  }
  drawVectorHeart(doc, x, y, heartMm);
}

/** Draw ❤ after text at (x, yBaseline) — y is text baseline like doc.text */
export function drawPdfHeartAfterText(
  doc: JsPdfLike,
  text: string,
  x: number,
  yBaseline: number,
  heartMm = 3.2
) {
  const textW = text ? doc.getTextWidth(text) : 0;
  const gap = 0.8;
  const y = yBaseline - heartMm * 0.78;
  placeHeart(doc, x + textW + gap, y, heartMm);
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

  const raw = Array.isArray(data.cell.text) ? data.cell.text.join(' ') : String(data.cell.text || '');
  const label = raw.replace(/\s+$/, '');
  const textW = label ? doc.getTextWidth(label) : 0;
  const heartMm = Math.min(2.8, data.cell.height * 0.7);
  const x = data.cell.x + 1.2 + textW + 0.4;
  const y = data.cell.y + (data.cell.height - heartMm) / 2;
  if (x + heartMm > data.cell.x + data.cell.width - 0.2) return;
  placeHeart(doc, x, y, heartMm);
}

/** Mobile-friendly PDF download (Share sheet on phones, anchor download otherwise). */
export async function downloadPdfDocument(
  doc: { output: (type: 'blob') => Blob },
  fileName: string
): Promise<void> {
  const blob = doc.output('blob');
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };

  const isMobile =
    typeof window !== 'undefined' &&
    (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && window.innerWidth < 900));

  if (
    isMobile &&
    typeof nav.share === 'function' &&
    (!nav.canShare || nav.canShare({ files: [file] }))
  ) {
    try {
      await nav.share({ files: [file], title: fileName });
      return;
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'name' in err &&
        (err as { name: string }).name === 'AbortError'
      ) {
        return;
      }
      // fall through to anchor download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  // iOS Safari: opening in a new tab is more reliable than a silent download
  if (isMobile) a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
}
