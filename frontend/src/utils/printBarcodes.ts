import { loadPrintSettings, PrintSettings } from '../components/PrintSettings';

let printJobSeq = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const appendCacheBust = (url: string): string => {
  if (!/^https?:\/\//i.test(url)) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_cb=${Date.now()}`;
};

const blobToDataURL = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const imageLooksValid = async (blob: Blob): Promise<boolean> => {
  if (blob.size < 32) return false;
  const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
  const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const type = (blob.type || '').toLowerCase();
  return isPng || isJpeg || type.startsWith('image/');
};

const decodeImage = (src: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0) resolve(src);
      else reject(new Error('empty image'));
    };
    img.onerror = () => reject(new Error('invalid image'));
    img.src = src;
  });

const convertImageToDataURL = async (url: string): Promise<string> => {
  if (url.startsWith('data:image')) {
    await decodeImage(url);
    return url;
  }

  const delays = [0, 400, 800, 1200, 2000];
  for (const delay of delays) {
    if (delay) await sleep(delay);
    const attemptUrl = appendCacheBust(url);
    try {
      const response = await fetch(attemptUrl, { cache: 'no-store' });
      if (response.ok) {
        const blob = await response.blob();
        if (await imageLooksValid(blob)) {
          const dataUrl = await blobToDataURL(blob);
          await decodeImage(dataUrl);
          return dataUrl;
        }
      }
    } catch {
      // CORS can block fetch even when the PNG is ready; fall through to <img> decode.
    }
    try {
      await decodeImage(attemptUrl);
      return attemptUrl;
    } catch {
      // Retry until the queued Azure PNG actually exists.
    }
  }

  throw new Error('Label image is not ready yet. Please try printing again in a moment.');
};

// Each job gets its own tab and is left open, so a previous preview is never
// closed out from under the user before they have printed it.
const openPrintWindow = (): Window | null =>
  window.open(`about:blank?print=${Date.now()}`, '_blank');

export const printLabelsFromResponse = async (responseData: any) => {
  const jobId = ++printJobSeq;
  const labels = (responseData?.labels || []).filter((label: any) => label?.image);
  const rawUrls = labels.map((label: any) => label.image);

  if (rawUrls.length === 0) {
    alert('No labels available to print.');
    return;
  }

  const settings: PrintSettings = loadPrintSettings();
  const pageMargin = settings.pageMargin;
  const labelWidth = settings.labelWidth;
  const labelHeight = settings.labelHeight;
  const gapBetweenLabels = settings.gapBetweenLabels;
  const ejectLastLabel = settings.ejectLastLabel !== false;

  const printableWidth = labelWidth - (pageMargin * 2);
  const printableHeight = labelHeight - (pageMargin * 2);

  let imageUrls: string[];
  try {
    imageUrls = await Promise.all(
      rawUrls.map((url: string) => convertImageToDataURL(url))
    );
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Label image is not ready yet. Please try printing again in a moment.';
    alert(message);
    throw error;
  }
  if (jobId !== printJobSeq) return;

  const normalizedTags = labels.map((label: any) => String(label?.barcode_tag || label?.tag || 'new').toLowerCase());
  const isBlockedTag = (tag: string) => tag === 'sold' || tag === 'defective';

  const printWindow = openPrintWindow();
  if (!printWindow) {
    alert('Please allow popups to print labels.');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Print Labels - ${imageUrls.length} label(s)</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              padding: 20px;
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: ${gapBetweenLabels}mm;
              background: #f5f5f5;
            }
            .label-container {
              background: white;
              padding: 10px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              display: flex;
              justify-content: center;
              align-items: center;
              width: ${labelWidth}mm;
              height: ${labelHeight}mm;
              margin: ${gapBetweenLabels / 2}mm;
              border: 1px dashed #ccc;
              box-sizing: border-box;
              overflow: hidden;
              position: relative;
            }
            .label-container.fresh {
              border: 2px solid #16a34a;
              background: #f0fdf4;
            }
            .label-container.blocked {
              border: 2px solid #dc2626;
              background: #fef2f2;
            }
            .status-pill {
              position: absolute;
              top: 6px;
              right: 6px;
              padding: 1px 6px;
              border-radius: 999px;
              font-size: 10px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.02em;
            }
            .status-pill.fresh {
              color: #166534;
              background: #dcfce7;
            }
            .status-pill.blocked {
              color: #991b1b;
              background: #fee2e2;
            }
            img {
              display: block;
              width: auto;
              height: auto;
              max-width: 100%;
              max-height: 100vh;
              object-fit: contain;
            }
            .print-eject {
              display: none;
            }
            .print-toolbar {
              display: flex;
              align-items: center;
              justify-content: center;
              flex-wrap: wrap;
              gap: 12px;
              padding: 10px 16px;
              background: #fff;
              border: 1px solid #e5e7eb;
              border-radius: 8px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.08);
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 13px;
              color: #374151;
            }
            .print-toolbar button {
              padding: 6px 16px;
              border: 0;
              border-radius: 6px;
              background: #2563eb;
              color: #fff;
              font-size: 13px;
              font-weight: 600;
              cursor: pointer;
            }
            .print-toolbar button:hover {
              background: #1d4ed8;
            }
            @media print {
              .print-toolbar {
                display: none !important;
              }
              @page {
                size: ${labelWidth}mm ${labelHeight}mm;
                margin-top: ${pageMargin}mm;
                margin-right: ${pageMargin}mm;
                margin-bottom: ${pageMargin}mm;
                margin-left: ${pageMargin}mm;
                padding: 0;
              }
              * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
              }
              html, body {
                margin: 0;
                padding: 0;
                overflow: visible;
                height: auto;
              }
              body {
                background: white;
                display: block;
              }
              /* A real, full-size page so the printer ejects the last barcode
                 instead of holding it until the next job. Hidden with white ink,
                 because a zero-height or visibility:hidden box generates no page. */
              .print-eject {
                display: block;
                page-break-before: always;
                break-before: page;
                width: ${printableWidth}mm;
                height: ${printableHeight}mm;
                min-height: ${printableHeight}mm;
                margin: 0;
                padding: 0;
                overflow: hidden;
                color: #fff;
                background: #fff;
              }
              .label-container {
                box-shadow: none;
                border: none !important;
                background: transparent !important;
                padding: 0;
                margin: 0;
                width: ${printableWidth}mm;
                height: ${printableHeight}mm;
                max-width: ${printableWidth}mm;
                max-height: ${printableHeight}mm;
                min-width: ${printableWidth}mm;
                min-height: ${printableHeight}mm;
                display: flex !important;
                justify-content: center !important;
                align-items: center !important;
                overflow: hidden;
                page-break-inside: avoid;
                break-inside: avoid;
                page-break-after: always;
                break-after: page;
                box-sizing: border-box;
                position: relative;
              }
              .status-pill {
                display: none;
              }
              /* Force consistent styling for print - account for margins */
              img {
                max-width: ${printableWidth}mm !important;
                max-height: ${printableHeight}mm !important;
                width: auto !important;
                height: auto !important;
                object-fit: contain !important;
                object-position: center !important;
                display: block !important;
                margin: 0 !important;
                padding: 0 !important;
                image-rendering: -webkit-optimize-contrast;
                image-rendering: crisp-edges;
                image-rendering: pixelated;
              }
            }
          </style>
        </head>
        <body>
          <div class="print-toolbar">
            <span>${imageUrls.length} label(s) ready. Press Ctrl+P (Cmd+P on Mac) when you want to print.</span>
            <button id="print-now" type="button">Print</button>
          </div>
          ${imageUrls.map((url: string, index: number) => {
            const tag = normalizedTags[index] || 'new';
            const isBlocked = isBlockedTag(tag);
            const rowClass = isBlocked ? 'blocked' : 'fresh';
            const statusText = isBlocked ? tag : 'fresh';
            return `
            <div class="label-container ${rowClass}">
              <span class="status-pill ${rowClass}">${statusText}</span>
              <img src="${url}" alt="Barcode Label ${index + 1}" />
            </div>
          `;
          }).join('')}
          ${ejectLastLabel ? '<div class="print-eject" aria-hidden="true">&nbsp;</div>' : ''}
          <script>
            (function() {
              var images = document.querySelectorAll('.label-container img');
              var printableWidth = ${printableWidth};
              var printableHeight = ${printableHeight};

              function applyPrintLayout() {
                 document.documentElement.style.margin = '0';
                 document.documentElement.style.padding = '0';
                 document.documentElement.style.overflow = 'visible';
                 document.documentElement.style.height = 'auto';
                 document.body.style.margin = '0';
                 document.body.style.padding = '0';
                 document.body.style.overflow = 'visible';
                 document.body.style.height = 'auto';
                 // Block layout only: Chrome ignores forced page breaks on flex
                 // items, which would drop the trailing eject page.
                 document.body.style.display = 'block';

                  var containers = document.querySelectorAll('.label-container');
                  containers.forEach(function(container) {
                    container.style.width = printableWidth + 'mm';
                    container.style.height = printableHeight + 'mm';
                    container.style.maxWidth = printableWidth + 'mm';
                    container.style.maxHeight = printableHeight + 'mm';
                    container.style.minWidth = printableWidth + 'mm';
                    container.style.minHeight = printableHeight + 'mm';
                    container.style.margin = '0';
                    container.style.padding = '0';
                    container.style.boxSizing = 'border-box';
                    container.style.display = 'flex';
                    container.style.justifyContent = 'center';
                    container.style.alignItems = 'center';
                    // Always break after every label, including the last one, so
                    // thermal printers eject the final sticker instead of holding it.
                    container.style.pageBreakAfter = 'always';
                    container.style.breakAfter = 'page';
                  });

                  images.forEach(function(img) {
                    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                      var naturalWidth = img.naturalWidth;
                      var naturalHeight = img.naturalHeight;
                      var aspectRatio = naturalWidth / naturalHeight;

                      var maxWidth = printableWidth;
                      var maxHeight = printableHeight;

                      var calculatedWidth = maxWidth;
                      var calculatedHeight = maxWidth / aspectRatio;

                      if (calculatedHeight > maxHeight) {
                        calculatedHeight = maxHeight;
                        calculatedWidth = maxHeight * aspectRatio;
                      }

                      img.style.maxWidth = calculatedWidth + 'mm';
                      img.style.maxHeight = calculatedHeight + 'mm';
                    } else {
                      img.style.maxWidth = printableWidth + 'mm';
                      img.style.maxHeight = printableHeight + 'mm';
                    }

                    img.style.width = 'auto';
                    img.style.height = 'auto';
                    img.style.objectFit = 'contain';
                    img.style.objectPosition = 'center';
                    img.style.display = 'block';
                    img.style.margin = 'auto';
                    img.style.padding = '0';
                    img.style.verticalAlign = 'middle';
                  });
              }

              // Print geometry is applied only when a print actually starts, so the
              // tab keeps its readable on-screen preview. By then the images have
              // decoded, so their real aspect ratio is used for sizing.
              // This tab never opens the print dialog and never closes itself.
              window.addEventListener('beforeprint', applyPrintLayout);

              if (window.matchMedia) {
                var printMedia = window.matchMedia('print');
                var onMediaChange = function(event) {
                  if (event.matches) applyPrintLayout();
                };
                if (printMedia.addEventListener) {
                  printMedia.addEventListener('change', onMediaChange);
                } else if (printMedia.addListener) {
                  printMedia.addListener(onMediaChange);
                }
              }

              var printButton = document.getElementById('print-now');
              if (printButton) {
                printButton.addEventListener('click', function() {
                  applyPrintLayout();
                  window.print();
                });
              }
            })();
          </script>
        </body>
      </html>
    `);
  printWindow.document.close();
  try {
    printWindow.focus();
  } catch {
    // Focus can be refused by the browser; the tab is still open.
  }
};
