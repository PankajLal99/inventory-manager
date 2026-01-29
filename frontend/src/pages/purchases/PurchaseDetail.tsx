import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchasingApi, productsApi } from '../../lib/api';
import { formatNumber } from '../../lib/utils';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import PageHeader from '../../components/ui/PageHeader';
import {
  FileText,
  ArrowLeft,
  User,
  Calendar,
  ShoppingBag,
  Printer,
  Download,
  Building2,
  Phone,
  Mail,
  MapPin,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

export default function PurchaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const purchaseId = parseInt(id || '0');
  const queryClient = useQueryClient();
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [finalizeItems, setFinalizeItems] = useState<Record<number, { quantity: string; unit_price: string }>>({});
  const [generatingLabelsFor, setGeneratingLabelsFor] = useState<number | null>(null);
  const [labelStatuses, setLabelStatuses] = useState<Record<number, { all_generated: boolean; generating: boolean }>>({});

  const { data: purchaseResponse, isLoading, error } = useQuery({
    queryKey: ['purchase', purchaseId],
    queryFn: () => purchasingApi.purchases.get(purchaseId),
    enabled: !!purchaseId,
    retry: false,
  });

  const purchase = purchaseResponse?.data || purchaseResponse;

  // Initialize finalize items when purchase loads
  useEffect(() => {
    if (purchase?.items) {
      const items: Record<number, { quantity: string; unit_price: string }> = {};
      purchase.items.forEach((item: any) => {
        items[item.id] = {
          quantity: item.quantity.toString(),
          unit_price: item.unit_price.toString(),
        };
      });
      setFinalizeItems(items);
    }
  }, [purchase]);

  // Check label status for all products when purchase loads and auto-generate if needed
  useEffect(() => {
    if (purchase?.items) {
      purchase.items.forEach((item: any) => {
        const productId = item.product;
        if (productId && item.product_track_inventory) {
          // Set initial state to checking
          setLabelStatuses(prev => ({
            ...prev,
            [productId]: {
              all_generated: false,
              generating: true
            }
          }));

          // Check label status first, filtered by this purchase
          const purchaseId = purchase?.id ? parseInt(purchase.id) : undefined;
          productsApi.labelsStatus(productId, purchaseId)
            .then((response) => {
              if (response.data) {
                const allGenerated = response.data.all_generated || false;

                if (allGenerated) {
                  // Labels already exist, just update status
                  setLabelStatuses(prev => ({
                    ...prev,
                    [productId]: {
                      all_generated: true,
                      generating: false
                    }
                  }));
                } else {
                  // Labels don't exist, generate them now
                  setLabelStatuses(prev => ({
                    ...prev,
                    [productId]: {
                      all_generated: false,
                      generating: true
                    }
                  }));

                  // Generate labels in background, filtered by this purchase
                  const purchaseId = purchase?.id ? parseInt(purchase.id) : undefined;
                  productsApi.generateLabels(productId, purchaseId)
                    .then((response) => {
                      // Check the response directly - if total_labels > 0, labels were generated
                      const totalLabels = response.data?.total_labels || 0;
                      const allGenerated = totalLabels > 0;

                      setLabelStatuses(prev => ({
                        ...prev,
                        [productId]: {
                          all_generated: allGenerated,
                          generating: false
                        }
                      }));

                      // Optionally verify with status check for extra confirmation
                      productsApi.labelsStatus(productId, purchaseId)
                        .then((statusResponse) => {
                          const nowGenerated = statusResponse.data?.all_generated || false;
                          setLabelStatuses(prev => ({
                            ...prev,
                            [productId]: {
                              all_generated: nowGenerated,
                              generating: false
                            }
                          }));
                        })
                        .catch(() => {
                          // Status check failed, but we already updated based on generateLabels response
                        });
                    })
                    .catch((error) => {
                      // If generation fails, set to not generated but allow manual generation
                      setLabelStatuses(prev => ({
                        ...prev,
                        [productId]: {
                          all_generated: false,
                          generating: false
                        }
                      }));
                      console.log(`Auto - generation of labels for product ${productId} failed: `, error);
                    });
                }
              }
            })
            .catch((error) => {
              // If status check fails, assume labels don't exist and allow manual generation
              setLabelStatuses(prev => ({
                ...prev,
                [productId]: {
                  all_generated: false,
                  generating: false
                }
              }));
              console.log(`Label status check for product ${productId} failed: `, error);
            });
        }
      });
    }
  }, [purchase]);

  // Print labels from batch response
  const printLabelsFromResponse = (responseData: any) => {
    const imageUrls = responseData.labels
      .filter((label: any) => label.image)
      .map((label: any) => label.image);

    if (imageUrls.length === 0) {
      alert('No labels available to print.');
      return;
    }

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
          gap: 3mm;
          background: #f5f5f5;
              }
          .label-container {
            background: white;
          padding: 10px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          display: flex;
          justify-content: center;
          align-items: center;
          width: 50mm;
          height: 25mm;
          margin: 1.5mm;
          border: 1px dashed #ccc;
          box-sizing: border-box;
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
            size: 50mm 25mm;
          margin: 1.5mm 0 0 0;
                }
          * {
            margin: 0;
          padding: 0;
          box-sizing: border-box;
                }
          html {
            margin: 0;
          padding: 0;
          width: 50mm;
          height: 23.5mm;
                }
          body {
            margin: 0;
          padding: 0;
          background: white;
          width: 50mm;
          height: 23.5mm;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
                }
          body.single-label {
            display: flex !important;
          justify-content: center !important;
          align-items: center !important;
                }
          .label-container {
            box-shadow: none;
          border: none !important;
          padding: 2mm 1mm 2mm 1mm;
          margin: 0;
          width: 50mm !important;
          height: 23.5mm !important;
          max-width: 50mm !important;
          max-height: 23.5mm !important;
          min-width: 50mm !important;
          min-height: 23.5mm !important;
          display: flex !important;
          justify-content: center !important;
          align-items: center !important;
          overflow: hidden;
          page-break-inside: avoid;
          break-inside: avoid;
          box-sizing: border-box;
                }
          .label-container:not(:last-child) {
            page-break-after: always;
                }
          .label-container:last-child {
            page-break-after: auto;
                }
          img {
            max - width: 48mm !important;
          max-height: 19.5mm !important;
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
                <img src="${url}" alt="Barcode Label ${index + 1}" onerror="console.error('Failed to load image ${index + 1}');" />
              </div>
            `).join('')}
        <script>
          (function() {
                var images = document.querySelectorAll('img');
          var loadedCount = 0;
          var totalImages = images.length;
          var hasPrinted = false;

          function tryPrint() {
                  if (loadedCount === totalImages && !hasPrinted) {
            hasPrinted = true;

          // Handle single vs multiple labels differently
          if (totalImages === 1) {
            // Single label: center it on one page
            document.documentElement.style.width = '50mm';
          document.documentElement.style.height = '23.5mm';
          document.documentElement.style.margin = '0';
          document.documentElement.style.padding = '0';
          document.documentElement.style.overflow = 'hidden';
          document.body.classList.add('single-label');
          document.body.style.width = '50mm';
          document.body.style.height = '23.5mm';
          document.body.style.margin = '0';
          document.body.style.padding = '0';
          document.body.style.overflow = 'hidden';
          document.body.style.display = 'flex';
          document.body.style.flexDirection = 'column';
          document.body.style.justifyContent = 'center';
          document.body.style.alignItems = 'center';
                    } else {
            // Multiple labels: let them flow naturally with page breaks
            document.body.classList.remove('single-label');
          document.body.style.display = 'block';
          document.body.style.margin = '0';
          document.body.style.padding = '0';
                    }

          // Ensure all containers and images are properly sized
          var containers = document.querySelectorAll('.label-container');
          containers.forEach(function(container, index) {
            container.style.width = '50mm';
          container.style.height = '23.5mm';
          container.style.maxWidth = '50mm';
          container.style.maxHeight = '23.5mm';
          container.style.minWidth = '50mm';
          container.style.minHeight = '23.5mm';
          container.style.margin = '0';
          container.style.padding = '2mm 1mm 2mm 1mm';
          container.style.boxSizing = 'border-box';
          container.style.border = 'none';
          container.style.display = 'flex';
          container.style.justifyContent = 'center';
          container.style.alignItems = 'center';
          // Only add page break if not the last container
          if (index < containers.length - 1) {
            container.style.pageBreakAfter = 'always';
                      } else {
            container.style.pageBreakAfter = 'auto';
                      }
                    });

          images.forEach(function(img) {
                      // Preserve aspect ratio to prevent barcode line distortion
                      // Only calculate if image has loaded dimensions
                      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                        var naturalWidth = img.naturalWidth;
          var naturalHeight = img.naturalHeight;
          var aspectRatio = naturalWidth / naturalHeight;

          // Calculate dimensions that fit within 48mm x 19.5mm while maintaining aspect ratio
          // (25mm page height - 1.5mm top margin - 2mm top padding - 2mm bottom padding = 19.5mm)
          var maxWidth = 48; // mm
          var maxHeight = 19.5; // mm
          var calculatedWidth = maxWidth;
          var calculatedHeight = maxWidth / aspectRatio;

                        // If height exceeds max, scale down based on height
                        if (calculatedHeight > maxHeight) {
            calculatedHeight = maxHeight;
          calculatedWidth = maxHeight * aspectRatio;
                        }

          img.style.maxWidth = calculatedWidth + 'mm';
          img.style.maxHeight = calculatedHeight + 'mm';
                      } else {
            // Fallback if dimensions not available
            img.style.maxWidth = '48mm';
          img.style.maxHeight = '19.5mm';
                      }

          img.style.width = 'auto';
          img.style.height = 'auto';
          img.style.objectFit = 'contain';
          img.style.objectPosition = 'center';
          img.style.display = 'block';
          img.style.margin = '0';
          img.style.padding = '0';
          // Prevent image scaling that distorts barcode lines
          img.style.imageRendering = 'auto';
          img.style.imageRendering = '-webkit-optimize-contrast';
                    });

          // Wait for rendering
          setTimeout(function() {
            window.print();
                    }, 500);
                  }
                }

          if (totalImages === 0) {
            alert('No images found to print.');
          return;
                }

          // Wait for all images to load
          images.forEach(function(img, index) {
            img.style.display = 'block';
          img.style.visibility = 'visible';

          if (img.complete && img.naturalHeight !== 0 && img.naturalWidth !== 0) {
            loadedCount++;
          tryPrint();
                  } else {
            img.onload = function () {
              if (this.naturalWidth > 0 && this.naturalHeight > 0) {
                loadedCount++;
                tryPrint();
              }
            };
          img.onerror = function() {
            console.error('Failed to load image ' + (index + 1));
          loadedCount++;
          tryPrint();
                    };
                  }
                });

          // Fallback timeout
          setTimeout(function() {
                  if (!hasPrinted) {
            hasPrinted = true;
          window.print();
                  }
                }, 5000);
              })();
        </script>
      </body>
    </html>
`);
      printWindow.document.close();
    }
  };

  const generateLabelsMutation = useMutation({
    mutationFn: ({ productId, purchaseId }: { productId: number; purchaseId?: number }) =>
      productsApi.generateLabels(productId, purchaseId),
    onSuccess: (data, { productId }) => {
      setLabelStatuses(prev => ({
        ...prev,
        [productId]: {
          all_generated: true,
          generating: false
        }
      }));
      setGeneratingLabelsFor(null);
      const newlyGenerated = data.data?.newly_generated || 0;
      const total = data.data?.total_labels || 0;
      const alreadyExisted = data.data?.already_existed || (total - newlyGenerated);
      if (newlyGenerated > 0) {
        if (alreadyExisted > 0) {
          alert(`Successfully generated ${newlyGenerated} new label(s).${alreadyExisted} label(s) were already generated.Total: ${total} label(s).`);
        } else {
          alert(`Successfully generated ${newlyGenerated} new label(s).Total: ${total} label(s).`);
        }
      } else {
        alert(`All ${total} label(s) were already generated.`);
      }
    },
    onError: (error: any, { productId }) => {
      setGeneratingLabelsFor(null);
      setLabelStatuses(prev => ({
        ...prev,
        [productId]: {
          all_generated: false,
          generating: false
        }
      }));
      alert(error?.response?.data?.error || 'Failed to generate labels. Please try again.');
    },
  });

  const handlePrintLabels = async (product: any) => {
    try {
      // Fetch existing labels filtered by this purchase (without generating new ones)
      const purchaseId = purchase?.id ? parseInt(purchase.id) : undefined;
      const response = await productsApi.getLabels(product.id, purchaseId);
      if (response.data && response.data.labels && response.data.labels.length > 0) {
        printLabelsFromResponse(response.data);
      } else {
        alert('No labels found for this purchase. Please generate labels first.');
      }
    } catch (error: any) {
      alert(error?.response?.data?.error || 'Failed to print labels. Please try again.');
    }
  };

  const handleGenerateLabels = async (product: any) => {
    setGeneratingLabelsFor(product.id);
    setLabelStatuses(prev => ({
      ...prev,
      [product.id]: { all_generated: false, generating: true }
    }));
    // Pass purchase ID to filter labels by this purchase
    const purchaseId = purchase?.id ? parseInt(purchase.id) : undefined;
    generateLabelsMutation.mutate({ productId: product.id, purchaseId });
  };

  const finalizeMutation = useMutation({
    mutationFn: (data?: any) => purchasingApi.purchases.finalize(purchaseId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase', purchaseId] });
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      setShowFinalizeModal(false);
      alert('Purchase finalized successfully! Inventory has been updated.');
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || error?.response?.data?.message || 'Failed to finalize purchase');
    },
  });

  const handleFinalize = () => {
    if (purchase.status !== 'draft') {
      alert('Can only finalize draft purchases');
      return;
    }
    setShowFinalizeModal(true);
  };

  const handleFinalizeSubmit = () => {
    // Prepare items with adjusted quantities/prices
    const items = purchase.items.map((item: any) => {
      const adjusted = finalizeItems[item.id];
      return {
        id: item.id,
        product: item.product,
        quantity: adjusted ? parseInt(adjusted.quantity) || item.quantity : item.quantity,
        unit_price: adjusted ? parseFloat(adjusted.unit_price) || item.unit_price : item.unit_price,
      };
    });

    finalizeMutation.mutate({ items });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="warning">Draft</Badge>;
      case 'finalized':
        return <Badge variant="success">Finalized</Badge>;
      case 'cancelled':
        return <Badge variant="danger">Cancelled</Badge>;
      default:
        return <Badge variant="default">{status}</Badge>;
    }
  };


  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleExportExcel = () => {
    if (!purchase || !purchase.items) return;

    const data = purchase.items.map((item: any) => ({
      'Product Name': item.product_name || '-',
      'SKU': item.product_sku || '-',
      'Quantity': item.quantity,
      'Unit Price': parseFloat(item.unit_price || 0),
      'Line Total': parseFloat(item.line_total || 0),
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Purchase Items');

    const fileName = `purchase_${purchase.purchase_number || purchase.id}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const handleExportPDF = () => {
    if (!purchase) return;

    const doc = new jsPDF();

    // Add title
    doc.setFontSize(18);
    doc.text('Purchase Order', 14, 20);

    // Purchase details
    doc.setFontSize(10);
    doc.text(`Purchase #: ${purchase.purchase_number || `PUR-${purchase.id}`} `, 14, 35);
    doc.text(`Date: ${formatDate(purchase.purchase_date)} `, 14, 42);
    doc.text(`Supplier: ${purchase.supplier_name || '-'} `, 14, 49);
    if (purchase.bill_number) {
      doc.text(`Bill #: ${purchase.bill_number} `, 14, 56);
    }

    // Prepare table data
    const tableData = (purchase.items || []).map((item: any) => [
      item.product_name || '-',
      item.product_sku || '-',
      item.quantity.toString(),
      `₹${formatNumber(item.unit_price || 0)} `,
      `₹${formatNumber(item.line_total || 0)} `,
    ]);

    (doc as any).autoTable({
      head: [['Product', 'SKU', 'Quantity', 'Unit Price', 'Total']],
      body: tableData,
      startY: purchase.bill_number ? 63 : 56,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [59, 130, 246] },
    });

    // Add total
    const finalY = (doc as any).lastAutoTable.finalY || (purchase.bill_number ? 63 : 56);
    doc.setFontSize(12);
    doc.text(`Total: ₹${formatNumber(purchase.total || 0)}`, 14, finalY + 10);

    const fileName = `purchase_${purchase.purchase_number || purchase.id}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
  };

  const handlePrint = () => {
    if (!purchase) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const printContent = `
  < !DOCTYPE html >
    <html>
      <head>
        <title>Purchase Order ${purchase.purchase_number || purchase.id}</title>
        <style>
          body {font-family: Arial, sans-serif; margin: 20px; }
          h1 {color: #1f2937; margin-bottom: 10px; }
          .info {color: #6b7280; margin-bottom: 20px; }
          table {width: 100%; border-collapse: collapse; margin-top: 20px; }
          th {background-color: #3b82f6; color: white; padding: 12px; text-align: left; }
          td {padding: 10px; border-bottom: 1px solid #e5e7eb; }
          tr:hover {background-color: #f9fafb; }
          .total {font-weight: bold; font-size: 18px; margin-top: 20px; }
          @media print {
            body {margin: 0; }
          .no-print {display: none; }
            }
        </style>
      </head>
      <body>
        <h1>Purchase Order</h1>
        <div class="info">
          <p><strong>Purchase #:</strong> ${purchase.purchase_number || `PUR-${purchase.id}`}</p>
          <p><strong>Date:</strong> ${formatDate(purchase.purchase_date)}</p>
          <p><strong>Supplier:</strong> ${purchase.supplier_name || '-'}</p>
          ${purchase.bill_number ? `<p><strong>Bill #:</strong> ${purchase.bill_number}</p>` : ''}
        </div>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>SKU</th>
              <th>Quantity</th>
              <th>Unit Price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${(purchase.items || []).map((item: any) => `
                <tr>
                  <td>${item.product_name || '-'}</td>
                  <td>${item.product_sku || '-'}</td>
                  <td>${item.quantity}</td>
                  <td>₹{formatNumber(item.unit_price || 0)}</td>
                  <td>₹{formatNumber(item.line_total || 0)}</td>
                </tr>
              `).join('')}
          </tbody>
        </table>
        <div class="total">
          <p>Total: ₹{formatNumber(purchase.total || 0)}</p>
        </div>
      </body>
    </html>
`;

    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.print();
  };

  if (isLoading) {
    return <LoadingState message="Loading purchase details..." />;
  }

  if (error) {
    return (
      <ErrorState
        message="Error loading purchase details. Please try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!purchase) {
    return (
      <ErrorState
        message="Purchase not found"
        onRetry={() => navigate('/purchases')}
      />
    );
  }

  const items = purchase.items || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Purchase ${purchase.purchase_number || `PUR-${purchase.id}`} `}
        subtitle="View purchase order details"
        icon={ShoppingBag}
        action={(
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate('/purchases')}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            {purchase.status === 'draft' && (
              <Button
                variant="primary"
                onClick={handleFinalize}
                className="flex items-center gap-2"
              >
                <CheckCircle className="h-4 w-4" />
                Finalize
              </Button>
            )}
            <Button
              variant="outline"
              onClick={handleExportExcel}
              className="flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Excel
            </Button>
            <Button
              variant="outline"
              onClick={handleExportPDF}
              className="flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              PDF
            </Button>
            <Button
              variant="outline"
              onClick={handlePrint}
              className="flex items-center gap-2"
            >
              <Printer className="h-4 w-4" />
              Print
            </Button>
          </div>
        )}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Purchase Information */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                Purchase Information
              </h2>
              {getStatusBadge(purchase.status || 'draft')}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-500">Purchase Number</label>
                <p className="text-lg font-semibold text-gray-900 mt-1">
                  {purchase.purchase_number || `PUR - ${purchase.id} `}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Purchase Date</label>
                <p className="text-lg font-semibold text-gray-900 mt-1 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  {formatDate(purchase.purchase_date)}
                </p>
              </div>
              {purchase.bill_number && (
                <div>
                  <label className="text-sm font-medium text-gray-500">Bill Number</label>
                  <p className="text-lg font-semibold text-gray-900 mt-1">
                    {purchase.bill_number}
                  </p>
                </div>
              )}
              <div>
                <label className="text-sm font-medium text-gray-500">Total Amount</label>
                <p className="text-2xl font-bold text-blue-600 mt-1">
                  ₹{formatNumber(purchase.total || 0)}
                </p>
              </div>
            </div>
            {purchase.notes && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <label className="text-sm font-medium text-gray-500">Notes</label>
                <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">
                  {purchase.notes}
                </p>
              </div>
            )}
          </Card>

          {/* Purchase Items */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-blue-600" />
                Purchase Items ({items.length})
              </h2>
            </div>
            {items.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No items in this purchase
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table headers={[
                  { label: 'Product', align: 'left' },
                  { label: 'SKU', align: 'left' },
                  { label: 'Quantity', align: 'right' },
                  { label: 'Unit Price', align: 'right' },
                  { label: 'Total', align: 'right' },
                  { label: 'Labels', align: 'center' },
                ]}>
                  {items.map((item: any, index: number) => {
                    const productId = item.product;
                    const trackInventory = item.product_track_inventory;
                    const labelStatus = labelStatuses[productId] || { all_generated: false, generating: false };

                    return (
                      <TableRow key={item.id || index}>
                        <TableCell>
                          <div className="font-medium text-gray-900">
                            {item.product_name || 'Product'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-gray-600 font-mono">
                            {item.product_sku || 'N/A'}
                          </span>
                        </TableCell>
                        <TableCell align="right">
                          <span className="text-gray-900 font-medium">
                            {item.quantity}
                          </span>
                        </TableCell>
                        <TableCell align="right">
                          <span className="text-gray-900">
                            ₹{formatNumber(item.unit_price || 0)}
                          </span>
                        </TableCell>
                        <TableCell align="right">
                          <span className="font-semibold text-gray-900">
                            ₹{formatNumber(item.line_total || 0)}
                          </span>
                        </TableCell>
                        <TableCell align="center">
                          {trackInventory ? (
                            <div className="flex items-center justify-center">
                              {(() => {
                                const status = labelStatus;
                                const isGenerating = generatingLabelsFor === productId || (status?.generating);
                                const allGenerated = status?.all_generated;

                                if (isGenerating) {
                                  return (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled
                                      className="flex items-center gap-1.5"
                                      title="Generating Labels..."
                                    >
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      <span className="hidden sm:inline">Generating...</span>
                                    </Button>
                                  );
                                }

                                if (allGenerated) {
                                  return (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handlePrintLabels({ id: productId })}
                                      className="flex items-center gap-1.5 text-green-700 bg-green-50 border-green-200 hover:bg-green-100 hover:border-green-300"
                                      title="Print Labels"
                                    >
                                      <Printer className="h-3.5 w-3.5" />
                                      <span className="hidden sm:inline">Print Labels</span>
                                    </Button>
                                  );
                                }

                                return (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleGenerateLabels({ id: productId })}
                                    className="flex items-center gap-1.5 text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100 hover:border-blue-300"
                                    title="Generate Labels"
                                  >
                                    <Printer className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">Generate Labels</span>
                                  </Button>
                                );
                              })()}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">N/A</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-gray-50">
                    <TableCell colSpan={5} align="right" className="font-bold text-gray-900">
                      Total:
                    </TableCell>
                    <TableCell align="right" className="font-bold text-xl text-blue-600">
                      ₹{formatNumber(purchase.total || 0)}
                    </TableCell>
                  </TableRow>
                </Table>
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Supplier Information */}
          {purchase.supplier && (
            <Card>
              <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Building2 className="h-5 w-5 text-blue-600" />
                Supplier Information
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-gray-500">Name</label>
                  <p className="text-base font-semibold text-gray-900 mt-1 flex items-center gap-2">
                    <User className="h-4 w-4 text-gray-400" />
                    {purchase.supplier_name || purchase.supplier?.name || '-'}
                  </p>
                </div>
                {purchase.supplier?.code && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Code</label>
                    <p className="text-sm text-gray-700 mt-1">
                      {purchase.supplier.code}
                    </p>
                  </div>
                )}
                {purchase.supplier?.phone && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Phone</label>
                    <p className="text-sm text-gray-700 mt-1 flex items-center gap-2">
                      <Phone className="h-4 w-4 text-gray-400" />
                      {purchase.supplier.phone}
                    </p>
                  </div>
                )}
                {purchase.supplier?.email && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Email</label>
                    <p className="text-sm text-gray-700 mt-1 flex items-center gap-2">
                      <Mail className="h-4 w-4 text-gray-400" />
                      {purchase.supplier.email}
                    </p>
                  </div>
                )}
                {purchase.supplier?.address && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Address</label>
                    <p className="text-sm text-gray-700 mt-1 flex items-start gap-2">
                      <MapPin className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <span className="whitespace-pre-wrap">{purchase.supplier.address}</span>
                    </p>
                  </div>
                )}
                {purchase.supplier?.contact_person && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Contact Person</label>
                    <p className="text-sm text-gray-700 mt-1">
                      {purchase.supplier.contact_person}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Purchase Summary */}
          <Card>
            <h2 className="text-xl font-bold text-gray-900 mb-4">Summary</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Items</span>
                <span className="font-semibold text-gray-900">{items.length}</span>
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-gray-200">
                <span className="text-base font-bold text-gray-900">Total</span>
                <span className="text-2xl font-bold text-blue-600">
                  ₹{formatNumber(purchase.total || 0)}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Finalize Modal */}
      {showFinalizeModal && purchase && (
        <Modal
          isOpen={showFinalizeModal}
          onClose={() => setShowFinalizeModal(false)}
          title="Finalize Purchase"
          size="xl"
        >
          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <strong>Review and adjust quantities/prices before finalizing.</strong> Once finalized, inventory will be updated and the purchase cannot be edited.
              </p>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-4">Purchase Items</h4>
              <div className="border border-gray-300 rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Quantity</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {purchase.items.map((item: any) => {
                      const adjusted = finalizeItems[item.id] || {
                        quantity: item.quantity.toString(),
                        unit_price: item.unit_price.toString(),
                      };
                      const qty = parseInt(adjusted.quantity) || 0;
                      const price = parseFloat(adjusted.unit_price) || 0;
                      const total = qty * price;

                      return (
                        <tr key={item.id}>
                          <td className="px-4 py-3">
                            <div className="text-sm font-medium text-gray-900">{item.product_name || 'Product'}</div>
                            <div className="text-xs text-gray-500">{item.product_sku || 'N/A'}</div>
                          </td>
                          <td className="px-4 py-3">
                            <Input
                              type="number"
                              step="1"
                              min="0"
                              value={adjusted.quantity}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '' || /^\d+$/.test(val)) {
                                  setFinalizeItems({
                                    ...finalizeItems,
                                    [item.id]: { ...adjusted, quantity: val },
                                  });
                                }
                              }}
                              onBlur={(e) => {
                                const val = Math.max(0, parseInt(e.target.value) || 0);
                                setFinalizeItems({
                                  ...finalizeItems,
                                  [item.id]: { ...adjusted, quantity: val.toString() },
                                });
                              }}
                              className="w-24 text-center text-sm"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={adjusted.unit_price}
                              onChange={(e) => {
                                setFinalizeItems({
                                  ...finalizeItems,
                                  [item.id]: { ...adjusted, unit_price: e.target.value },
                                });
                              }}
                              className="w-28 text-right text-sm"
                            />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm font-semibold text-gray-900">
                              ₹{formatNumber(total)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50">
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-right text-sm font-medium text-gray-700">
                        Total:
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-gray-900">
                        ₹{formatNumber(
                          purchase.items.reduce((sum: number, item: any) => {
                            const adjusted = finalizeItems[item.id] || {
                              quantity: item.quantity.toString(),
                              unit_price: item.unit_price.toString(),
                            };
                            const qty = parseInt(adjusted.quantity) || 0;
                            const price = parseFloat(adjusted.unit_price) || 0;
                            return sum + (qty * price);
                          }, 0)
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <Button
                variant="outline"
                onClick={() => setShowFinalizeModal(false)}
                disabled={finalizeMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleFinalizeSubmit}
                disabled={finalizeMutation.isPending}
                className="flex items-center gap-2"
              >
                <CheckCircle className="h-4 w-4" />
                {finalizeMutation.isPending ? 'Finalizing...' : 'Finalize Purchase'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

