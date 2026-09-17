import { loadPrintSettings, PrintSettings } from '../components/PrintSettings';

let lastPrintWindow: Window | null = null;
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

const closePrintWindow = (printWindow: Window | null) => {
  if (!printWindow || printWindow.closed) return;
  try {
    printWindow.close();
  } catch {
    // Popup may already be gone.
  }
};

const openPrintWindow = (): Window | null => {
  closePrintWindow(lastPrintWindow);
  const printWindow = window.open(`about:blank?print=${Date.now()}`, '_blank');
  lastPrintWindow = printWindow;
  return printWindow;
};

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
            @media print {
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
              .print-eject {
                display: block;
                page-break-before: always;
                break-before: page;
                width: 0;
                height: 0;
                margin: 0;
                padding: 0;
                overflow: hidden;
                visibility: hidden;
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
          <div class="print-eject" aria-hidden="true"></div>
          <script>
            (function() {
              var images = document.querySelectorAll('.label-container img');
              var totalImages = images.length;
              var printableWidth = ${printableWidth};
              var printableHeight = ${printableHeight};

              function finalizeLayout() {
                 document.documentElement.style.margin = '0';
                 document.documentElement.style.padding = '0';
                 document.documentElement.style.overflow = 'visible';
                 document.documentElement.style.height = 'auto';
                 document.body.style.margin = '0';
                 document.body.style.padding = '0';
                 document.body.style.overflow = 'visible';
                 document.body.style.height = 'auto';
                 if (totalImages === 1) {
                    document.body.style.display = 'flex';
                    document.body.style.flexDirection = 'column';
                    document.body.style.justifyContent = 'center';
                    document.body.style.alignItems = 'center';
                  } else {
                    document.body.style.display = 'block';
                  }

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

              finalizeLayout();

              var hasPrinted = false;
              function startPrint() {
                if (hasPrinted) return;
                hasPrinted = true;
                window.focus();
                window.print();
              }

              window.addEventListener('afterprint', function() {
                window.close();
              });

              var pending = images.length;
              if (pending === 0) {
                setTimeout(startPrint, 300);
              } else {
                images.forEach(function(img) {
                  if (img.complete && img.naturalWidth > 0) {
                    pending--;
                    if (pending === 0) setTimeout(startPrint, 200);
                    return;
                  }
                  img.onload = function() {
                    pending--;
                    if (pending === 0) setTimeout(startPrint, 200);
                  };
                  img.onerror = function() {
                    pending--;
                    if (pending === 0) setTimeout(startPrint, 200);
                  };
                });
                setTimeout(startPrint, 4000);
              }
            })();
          </script>
        </body>
      </html>
    `);
  printWindow.document.close();
};
