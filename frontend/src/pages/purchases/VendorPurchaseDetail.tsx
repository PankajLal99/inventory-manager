import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchasingApi, productsApi } from '../../lib/api';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import Badge from '../../components/ui/Badge';
import {
  FileText,
  ArrowLeft,
  Calendar,
  ShoppingBag,
  Printer,
  XCircle,
  Loader2,
} from 'lucide-react';
import { printLabelsFromResponse } from '../../utils/printBarcodes';

export default function VendorPurchaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const supplierId = searchParams.get('supplier');
  const purchaseId = parseInt(id || '0');
  const queryClient = useQueryClient();
  const [generatingLabelsFor, setGeneratingLabelsFor] = useState<number | null>(null);
  const [labelStatuses, setLabelStatuses] = useState<Record<number, { all_generated: boolean; generating: boolean }>>({});
  const [printingAllLabels, setPrintingAllLabels] = useState(false);

  const { data: purchaseResponse, isLoading, error } = useQuery({
    queryKey: ['vendor-purchase', purchaseId, supplierId],
    queryFn: () => purchasingApi.vendorPurchases.get(supplierId!, purchaseId),
    enabled: !!purchaseId && !!supplierId,
    retry: false,
  });

  const purchase = purchaseResponse?.data || purchaseResponse;

  // Check label status and auto-generate labels for all products when purchase loads
  useEffect(() => {
    if (purchase?.items) {
      purchase.items.forEach((item: any) => {
        const productId = item.product;
        if (productId && item.product_track_inventory) {
          // Set initial state to generating while we check
          setLabelStatuses(prev => ({
            ...prev,
            [productId]: {
              all_generated: false,
              generating: true
            }
          }));

          // Check label status first
          productsApi.labelsStatus(productId)
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

                  // Generate labels in background
                  productsApi.generateLabels(productId)
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
                      // But don't wait for it - update UI immediately based on response
                      productsApi.labelsStatus(productId)
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
                          // Keep the state as is
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
                      console.log(`Auto-generation of labels for product ${productId} failed:`, error);
                    });
                }
              }
            })
            .catch((error) => {
              // If status check fails, assume labels don't exist and allow manual generation
              // Don't auto-generate on error - let user click the button
              setLabelStatuses(prev => ({
                ...prev,
                [productId]: {
                  all_generated: false,
                  generating: false
                }
              }));
              console.error(`Label status check for product ${productId} failed:`, error);
            });
        }
      });
    }
  }, [purchase]);

  const formatCurrency = (amount: number | string) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(parseFloat(String(amount || '0')));
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
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
          alert(`Successfully generated ${newlyGenerated} new label(s). ${alreadyExisted} label(s) were already generated. Total: ${total} label(s).`);
        } else {
          alert(`Successfully generated ${newlyGenerated} new label(s). Total: ${total} label(s).`);
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
      const errorMessage = error?.response?.data?.error || error?.message || 'Failed to generate labels. Please try again.';
      console.error('Label generation error:', error);
      alert(errorMessage);
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

  const handlePrintAllLabels = async () => {
    if (!purchase?.items) return;

    const trackableItems = purchase.items.filter((item: any) => item.product_track_inventory);
    if (trackableItems.length === 0) {
      alert('No products with inventory tracking found in this purchase.');
      return;
    }

    setPrintingAllLabels(true);

    try {
      // Collect all labels from all products
      const allLabels: any[] = [];
      const productIds = trackableItems.map((item: any) => item.product);

      // Generate/fetch labels for all products, filtered by this purchase
      const purchaseId = purchase?.id ? parseInt(purchase.id) : undefined;
      const labelPromises = productIds.map(async (productId: number) => {
        try {
          // Use getLabels to fetch existing labels filtered by purchase
          const response = await productsApi.getLabels(productId, purchaseId);
          if (response.data?.labels) {
            return response.data.labels;
          }
          return [];
        } catch (error) {
          console.error(`Failed to get labels for product ${productId}:`, error);
          return [];
        }
      });

      const labelResults = await Promise.allSettled(labelPromises);

      // Collect all labels
      labelResults.forEach((result) => {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          allLabels.push(...result.value);
        }
      });

      if (allLabels.length === 0) {
        alert('No labels found. Please generate labels first.');
        setPrintingAllLabels(false);
        return;
      }

      // Print all labels
      printLabelsFromResponse({ labels: allLabels });
    } catch (error: any) {
      const errorMessage = error?.response?.data?.error || error?.message || 'Failed to print all labels. Please try again.';
      console.error('Print all labels error:', error);
      alert(errorMessage);
    } finally {
      setPrintingAllLabels(false);
    }
  };

  const cancelMutation = useMutation({
    mutationFn: () => purchasingApi.vendorPurchases.cancel(supplierId!, purchaseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-purchase', purchaseId, supplierId] });
      queryClient.invalidateQueries({ queryKey: ['vendor-purchases', supplierId] });
      navigate(`/vendor-purchases?supplier=${supplierId}`);
    },
    onError: (error: any) => {
      alert(error?.response?.data?.message || 'Failed to cancel purchase');
    },
  });

  const handleCancel = () => {
    if (confirm('Are you sure you want to cancel this purchase?')) {
      cancelMutation.mutate();
    }
  };

  if (!supplierId) {
    return (
      <ErrorState
        message="Supplier ID is required"
        onRetry={() => window.location.reload()}
      />
    );
  }

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
        onRetry={() => navigate(`/vendor-purchases?supplier=${supplierId}`)}
      />
    );
  }

  const items = purchase.items || [];
  const isDraft = purchase.status === 'draft';
  const trackableItems = items.filter((item: any) => item.product_track_inventory);
  const readyToPrintCount = trackableItems.filter((item: any) => {
    const status = labelStatuses[item.product];
    return status?.all_generated === true;
  }).length;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => navigate(`/vendor-purchases?supplier=${supplierId}`)}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            {trackableItems.length > 0 && (
              <div className="text-sm text-gray-600 mr-2">
                {readyToPrintCount} of {trackableItems.length} products ready to print
              </div>
            )}
            {isDraft && (
              <Button
                variant="danger"
                onClick={handleCancel}
                disabled={cancelMutation.isPending}
                className="flex items-center gap-2"
              >
                <XCircle className="h-4 w-4" />
                {cancelMutation.isPending ? 'Cancelling...' : 'Cancel Purchase'}
              </Button>
            )}
          </div>
        </div>

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
                {purchase.purchase_number || `PUR-${purchase.id}`}
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
                {formatCurrency(purchase.total || 0)}
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
            {items.some((item: any) => item.product_track_inventory) && (
              <Button
                onClick={handlePrintAllLabels}
                disabled={printingAllLabels}
                variant="outline"
                className="flex items-center gap-2"
              >
                {printingAllLabels ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Printing...
                  </>
                ) : (
                  <>
                    <Printer className="h-4 w-4" />
                    Print All Labels
                  </>
                )}
              </Button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No items in this purchase
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item: any, index: number) => {
                const productId = item.product;
                const trackInventory = item.product_track_inventory;
                const status = labelStatuses[productId];
                const isGenerating = generatingLabelsFor === productId || (status?.generating);
                const allGenerated = status?.all_generated;

                // If status is not yet checked, show generating state
                const statusUnknown = trackInventory && status === undefined;

                return (
                  <div key={item.id || index} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 text-lg">
                          {item.product_name || 'Product'}
                        </h3>
                        <p className="text-sm text-gray-600 font-mono mt-1">
                          SKU: {item.product_sku || 'N/A'}
                        </p>
                        <div className="mt-2 flex items-center gap-4 text-sm">
                          <span className="text-gray-600">
                            Quantity: <span className="font-semibold text-gray-900">{item.quantity}</span>
                          </span>
                          <span className="text-gray-600">
                            Unit Price: <span className="font-semibold text-gray-900">{formatCurrency(item.unit_price || 0)}</span>
                          </span>
                          <span className="text-gray-600">
                            Total: <span className="font-semibold text-gray-900">{formatCurrency(item.line_total || 0)}</span>
                          </span>
                        </div>
                      </div>
                      {trackInventory && (
                        <div className="flex items-center gap-2">
                          {statusUnknown || isGenerating ? (
                            <Button
                              disabled
                              variant="outline"
                              size="sm"
                              className="flex items-center gap-2"
                            >
                              <Loader2 className="h-4 w-4 animate-spin" />
                              {statusUnknown ? 'Checking...' : 'Generating...'}
                            </Button>
                          ) : allGenerated ? (
                            <Button
                              onClick={() => handlePrintLabels({ id: productId })}
                              variant="outline"
                              size="sm"
                              className="flex items-center gap-2"
                            >
                              <Printer className="h-4 w-4" />
                              Print Labels
                            </Button>
                          ) : (
                            <Button
                              onClick={() => handleGenerateLabels({ id: productId })}
                              variant="outline"
                              size="sm"
                              className="flex items-center gap-2"
                            >
                              <Printer className="h-4 w-4" />
                              Generate Labels
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

