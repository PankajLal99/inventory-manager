import { loadPrintSettings, PrintSettings } from '../components/PrintSettings';

// Helper to convert URL to Base64
const convertImageToDataURL = async (url: string): Promise<string> => {
  try {
    const response = await fetch(url);
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

export const printLabelsFromResponse = async (responseData: any) => {
  const rawUrls = responseData.labels
    .filter((label: any) => label.image)
    .map((label: any) => label.image);

  if (rawUrls.length === 0) {
    alert('No labels available to print.');
    return;
  }

  // Load print settings
  const settings: PrintSettings = loadPrintSettings();
  const pageMargin = settings.pageMargin;
  const labelWidth = settings.labelWidth;
  const labelHeight = settings.labelHeight;
  const gapBetweenLabels = settings.gapBetweenLabels;
  
  // Calculate printable area (label size minus margins)
  const printableWidth = labelWidth - (pageMargin * 2);
  const printableHeight = labelHeight - (pageMargin * 2);

  // Convert all images to Base64 before opening the window
  const imageUrls = await Promise.all(
    rawUrls.map((url: string) => convertImageToDataURL(url))
  );

  // Open print preview in one tab with all labels
  const printWindow = window.open('', '_blank');
  if (printWindow) {
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
                box-sizing: border-box;
                position: relative;
              }
              .label-container:not(:last-child) {
                page-break-after: always;
              }
              .label-container:last-child {
                page-break-after: auto;
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
          ${imageUrls.map((url: string, index: number) => `
            <div class="label-container">
              <img src="${url}" alt="Barcode Label ${index + 1}" />
            </div>
          `).join('')}
          <script>
            (function() {
              // Images are already base64, so they should be loaded instantly.
              // We just need to handle the layout logic.
              
              var images = document.querySelectorAll('img');
              var totalImages = images.length;
              
              // Use settings from parent scope
              var pageMargin = ${pageMargin};
              var labelWidth = ${labelWidth};
              var labelHeight = ${labelHeight};
              var printableWidth = ${printableWidth};
              var printableHeight = ${printableHeight};
              
              function finalizeLayout() {
                 // Account for margins
                 // Effective printable area
                 var printableWidth = ${printableWidth}; // labelWidth - (pageMargin * 2)
                 var printableHeight = ${printableHeight}; // labelHeight - (pageMargin * 2)
                 
                 if (totalImages === 1) {
                    // Single label centering
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
                  
                  // Style containers - use printable area size and ensure vertical centering
                  var containers = document.querySelectorAll('.label-container');
                  containers.forEach(function(container, index) {
                    container.style.width = printableWidth + 'mm';
                    container.style.height = printableHeight + 'mm';
                    container.style.maxWidth = printableWidth + 'mm';
                    container.style.maxHeight = printableHeight + 'mm';
                    container.style.minWidth = printableWidth + 'mm';
                    container.style.minHeight = printableHeight + 'mm';
                    container.style.margin = '0';
                    container.style.padding = '0';
                    container.style.boxSizing = 'border-box';
                    // Ensure flexbox centering is maintained
                    container.style.display = 'flex';
                    container.style.justifyContent = 'center';
                    container.style.alignItems = 'center';
                    if (index < containers.length - 1) {
                      container.style.pageBreakAfter = 'always';
                    } else {
                      container.style.pageBreakAfter = 'auto';
                    }
                  });
                  
                  // Style images - use printable area size and ensure proper centering
                  images.forEach(function(img) {
                    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                      var naturalWidth = img.naturalWidth;
                      var naturalHeight = img.naturalHeight;
                      var aspectRatio = naturalWidth / naturalHeight;
                      
                      var maxWidth = printableWidth; // Account for margins
                      var maxHeight = printableHeight; // Account for margins
                      
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
                    img.style.margin = 'auto'; // Use auto for centering within flex container
                    img.style.padding = '0';
                    img.style.verticalAlign = 'middle'; // Additional vertical alignment
                  });
              }

              // Run layout immediately - base64 images are parsed synchronously or very fast
              finalizeLayout();

              // Brief timeout to ensure rendering pipeline is clear, then print
              setTimeout(function() {
                window.print();
              }, 500);
            })();
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }
};

