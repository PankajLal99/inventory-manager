import { loadPrintSettings, PrintSettings } from '../components/PrintSettings';

let lastPrintWindow: Window | null = null;

const appendCacheBust = (url: string): string => {
  if (!/^https?:\/\//i.test(url)) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_cb=${Date.now()}`;
};

const convertImageToDataURL = async (url: string): Promise<string> => {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('Failed to convert image to base64, falling back to URL', e);
    return url;
  }
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
  const labels = (responseData?.labels || []).filter((label: any) => label?.image);
  const rawUrls = labels.map((label: any) => appendCacheBust(label.image));

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

  const imageUrls = await Promise.all(
    rawUrls.map((url: string) => convertImageToDataURL(url))
  );

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
              html {
                margin: 0;
                padding: 0;
              }
              body {
                margin: 0;
                padding: 0;
                background: white;
                display: block;
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
          <script>
            (function() {
              var images = document.querySelectorAll('img');
              var totalImages = images.length;
              var labelWidth = ${labelWidth};
              var labelHeight = ${labelHeight};
              var printableWidth = ${printableWidth};
              var printableHeight = ${printableHeight};

              function finalizeLayout() {
                 if (totalImages === 1) {
                    document.documentElement.style.width = labelWidth + 'mm';
                    document.documentElement.style.height = labelHeight + 'mm';
                    document.documentElement.style.margin = '0';
                    document.documentElement.style.padding = '0';
                    document.documentElement.style.overflow = 'hidden';
                    document.body.style.width = labelWidth + 'mm';
                    document.body.style.height = labelHeight + 'mm';
                    document.body.style.margin = '0';
                    document.body.style.padding = '0';
                    document.body.style.overflow = 'hidden';
                    document.body.style.display = 'flex';
                    document.body.style.justifyContent = 'center';
                    document.body.style.alignItems = 'center';
                  } else {
                    document.body.style.display = 'block';
                    document.body.style.margin = '0';
                    document.body.style.padding = '0';
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

              window.addEventListener('afterprint', function() {
                window.close();
              });

              setTimeout(function() {
                window.focus();
                window.print();
              }, 500);
            })();
          </script>
        </body>
      </html>
    `);
  printWindow.document.close();
};
