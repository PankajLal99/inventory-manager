import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { posApi } from '../../lib/api';
import { formatNumber } from '../../lib/utils';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import BarcodeScanner from '../../components/BarcodeScanner';
import Card from '../../components/ui/Card';
import ToastContainer from '../../components/ui/Toast';
import type { Toast } from '../../components/ui/Toast';
import { Search, Camera, AlertTriangle, Package, Plus, Minus, FileText, ArrowLeft, DollarSign } from 'lucide-react';

interface InvoiceItem {
  id: number;
  product: number;
  product_name: string;
  product_sku: string;
  product_track_inventory: boolean;
  quantity: string;
  available_quantity: number;
  unit_price: string;
  manual_unit_price?: string | null;
  line_total: string;
  barcode_id?: number;
  barcode_value?: string;
}

interface Invoice {
  id: number;
  invoice_number: string;
  customer_name?: string;
  store_name?: string;
  created_at: string;
  items: InvoiceItem[];
  total: string;
  store?: number;
}

export default function ReturnToStock() {
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');
  const [selectedItems, setSelectedItems] = useState<Record<number, number>>({}); // item_id -> quantity to return
  const [itemTags, setItemTags] = useState<Record<number, 'returned' | 'defective' | 'unknown'>>({}); // item_id -> return status
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showInvoiceDropdown, setShowInvoiceDropdown] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Toast helper function
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Search invoices by partial invoice number
  const searchInvoicesQuery = useQuery({
    queryKey: ['search-invoices', searchValue],
    queryFn: async () => {
      if (!searchValue.trim() || searchValue.trim().length < 2) return { invoices: [] };
      try {
        const response = await posApi.replacement.searchInvoices(searchValue.trim());
        return response.data;
      } catch (error) {
        return { invoices: [] };
      }
    },
    enabled: searchValue.trim().length >= 2,
    retry: false,
  });

  // Find invoice by barcode/SKU or invoice number
  const findInvoiceQuery = useQuery({
    queryKey: ['find-invoice', searchValue],
    queryFn: async () => {
      if (!searchValue.trim()) return null;
      try {
        const isInvoiceNumber = /^[A-Z0-9-]+$/i.test(searchValue.trim()) && searchValue.trim().length >= 3;

        const response = await posApi.replacement.findInvoiceByBarcode({
          barcode: isInvoiceNumber ? undefined : searchValue.trim(),
          sku: isInvoiceNumber ? undefined : searchValue.trim(),
          invoice_number: isInvoiceNumber ? searchValue.trim() : undefined,
        });
        if (response.data?.invoice) {
          setInvoice(response.data.invoice);
          setSearchError(null);
          const initialSelected: Record<number, number> = {};
          const searchBarcode = searchValue.trim().toUpperCase();

          response.data.invoice.items.forEach((item: InvoiceItem) => {
            const itemBarcode = item.barcode_value?.toUpperCase() || '';
            const itemSku = item.product_sku?.toUpperCase() || '';

            if (itemBarcode === searchBarcode || itemSku === searchBarcode) {
              initialSelected[item.id] = Math.min(1, item.available_quantity);
            } else {
              initialSelected[item.id] = 0;
            }
          });
          setSelectedItems(initialSelected);

          const initialTags: Record<number, 'returned' | 'defective' | 'unknown'> = {};
          response.data.invoice.items.forEach((item: InvoiceItem) => {
            initialTags[item.id] = 'unknown';
          });
          setItemTags(initialTags);

          return response.data;
        }
        return null;
      } catch (error: any) {
        const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to find invoice';
        setSearchError(errorMsg);
        setInvoice(null);
        return null;
      }
    },
    enabled: false,
    retry: false,
  });

  // Process return mutation
  const processReturnMutation = useMutation({
    mutationFn: async (data: { invoice_item_id: number; quantity: number; store_id?: number; return_tag?: string }) => {
      return await posApi.replacement.return(data);
    },
    onSuccess: () => {
      // Don't navigate here since we process multiple items - navigation happens in handleProcessReturn
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to process return';
      showToast(errorMsg, 'error');
    },
  });

  const handleSearch = () => {
    if (!searchValue.trim()) {
      setSearchError('Please enter a barcode, SKU, or invoice number');
      return;
    }
    setShowInvoiceDropdown(false);
    findInvoiceQuery.refetch();
  };

  const handleInvoiceSelect = async (selectedInvoice: Invoice) => {
    setSearchValue(selectedInvoice.invoice_number);
    setShowInvoiceDropdown(false);
    setInvoice(selectedInvoice);
    setSearchError(null);

    const initialSelected: Record<number, number> = {};
    selectedInvoice.items.forEach((item: InvoiceItem) => {
      initialSelected[item.id] = 0;
    });
    setSelectedItems(initialSelected);

    const initialTags: Record<number, 'returned' | 'defective' | 'unknown'> = {};
    selectedInvoice.items.forEach((item: InvoiceItem) => {
      initialTags[item.id] = 'unknown';
    });
    setItemTags(initialTags);
  };

  const handleBarcodeScan = (barcode: string) => {
    setSearchValue(barcode);
    setShowScanner(false);
    setTimeout(() => {
      if (barcode.trim()) {
        findInvoiceQuery.refetch();
      }
    }, 100);
  };

  const handleItemToggle = (itemId: number) => {
    setSelectedItems(prev => {
      const current = prev[itemId] || 0;
      if (current === 0) {
        return { ...prev, [itemId]: 1 };
      } else {
        return { ...prev, [itemId]: 0 };
      }
    });

    // Ensure tag is initialized
    setItemTags(prev => {
      if (!prev[itemId]) {
        return { ...prev, [itemId]: 'unknown' };
      }
      return prev;
    });
  };

  const handleReturnTagChange = (itemId: number, tag: 'returned' | 'defective' | 'unknown') => {
    setItemTags(prev => ({
      ...prev,
      [itemId]: tag,
    }));
  };

  const handleQuantityChange = (itemId: number, value: string, maxQuantity: number) => {
    if (value === '' || /^\d+$/.test(value)) {
      const intValue = value === '' ? 0 : parseInt(value);
      const clampedValue = Math.max(0, Math.min(intValue, maxQuantity));
      setSelectedItems((prev) => ({
        ...prev,
        [itemId]: clampedValue,
      }));
    }
  };

  const handleProcessReturn = async () => {
    if (!invoice) return;

    const itemsToReturn: Array<{ invoice_item_id: number; quantity: number; store_id?: number; return_tag: string }> = [];
    Object.entries(selectedItems).forEach(([itemIdStr, quantity]) => {
      const quantityNum = Number(quantity);
      if (quantityNum > 0) {
        const itemId = parseInt(itemIdStr);
        itemsToReturn.push({
          invoice_item_id: itemId,
          quantity: quantityNum,
          store_id: invoice.store,
          return_tag: itemTags[itemId] || 'unknown',
        });
      }
    });

    if (itemsToReturn.length === 0) {
      showToast('Please select at least one item to return', 'info');
      return;
    }

    if (!confirm('Are you sure you want to return these items to stock? Items will be removed from invoice and added back to inventory.')) {
      return;
    }

    const invoiceId = invoice.id; // Capture invoice ID before processing

    // Process returns one by one
    try {
      for (const item of itemsToReturn) {
        await processReturnMutation.mutateAsync(item);
      }
      // Navigate after all items are processed
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      showToast('Items returned to stock successfully', 'success');
      navigate(`/invoices/${invoiceId}`);
    } catch (error) {
      // Error handling is done in onError callback
    }
  };

  const handleReset = () => {
    setSearchValue('');
    setInvoice(null);
    setSelectedItems({});
    setItemTags({});
    setSearchError(null);
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  const hasSelectedItems = Object.values(selectedItems).some(qty => qty > 0);
  const totalItemsToReturn = Object.values(selectedItems).reduce((sum, qty) => sum + Number(qty), 0);

  // Calculate estimated refund amount
  const estimatedRefundAmount = invoice ? Object.entries(selectedItems).reduce((sum, [itemId, quantity]) => {
    const quantityNum = Number(quantity);
    if (quantityNum > 0) {
      const item = invoice.items.find(i => i.id === parseInt(itemId));
      if (item) {
        const lineTotal = parseFloat(item.line_total) || 0;
        const itemQuantity = parseFloat(item.quantity) || 1;
        // Use line_total / quantity for accurate per-unit price (accounts for discounts/taxes)
        const pricePerUnit = itemQuantity > 0 ? lineTotal / itemQuantity : parseFloat(item.manual_unit_price || item.unit_price || '0');
        return sum + (pricePerUnit * quantityNum);
      }
    }
    return sum;
  }, 0) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          onClick={() => navigate('/replacement')}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <h1 className="text-2xl font-bold text-gray-900">Return to Stock</h1>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold mb-2">Return to Stock:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Find the invoice containing items to return</li>
              <li>Select items and quantities to return</li>
              <li>Items will be removed from invoice and added back to inventory</li>
              <li>Customer will receive a refund (credit entry in ledger)</li>
            </ul>
          </div>
        </div>
      </div>

      <Card>
        <div className="space-y-4">
          {/* Search Section */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Search by Barcode or SKU
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  value={searchValue}
                  onChange={(e) => {
                    setSearchValue(e.target.value);
                    setShowInvoiceDropdown(e.target.value.trim().length >= 2);
                    setSearchError(null);
                  }}
                  onFocus={() => {
                    if (searchValue.trim().length >= 2) {
                      setShowInvoiceDropdown(true);
                    }
                  }}
                  onBlur={() => {
                    setTimeout(() => setShowInvoiceDropdown(false), 200);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSearch();
                    } else if (e.key === 'Escape') {
                      setShowInvoiceDropdown(false);
                    }
                  }}
                  placeholder="Enter barcode, SKU, or invoice number"
                  className="pl-10 pr-24"
                />
                {/* Invoice Search Dropdown */}
                {showInvoiceDropdown && searchInvoicesQuery.data?.invoices && searchInvoicesQuery.data.invoices.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {searchInvoicesQuery.data.invoices.map((inv: Invoice) => (
                      <button
                        key={inv.id}
                        type="button"
                        onClick={() => handleInvoiceSelect(inv)}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b last:border-b-0 transition-colors"
                      >
                        <div className="font-medium text-gray-900">{inv.invoice_number}</div>
                        <div className="text-sm text-gray-600 mt-1">
                          {inv.customer_name || 'N/A'} • {inv.store_name || 'N/A'} • {new Date(inv.created_at).toLocaleDateString()}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                  <Button
                    onClick={() => setShowScanner(true)}
                    variant="outline"
                    size="sm"
                    className="whitespace-nowrap"
                    title="Open camera scanner"
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <Button
                onClick={handleSearch}
                disabled={findInvoiceQuery.isFetching}
                variant="primary"
              >
                <Search className="h-4 w-4 mr-2" />
                Search
              </Button>
            </div>
            {searchError && (
              <div className="text-sm text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                {searchError}
              </div>
            )}
          </div>

          {/* QR Code Scanner */}
          {showScanner && (
            <div className="border rounded-lg p-4 bg-gray-50 flex justify-center">
              <div className="w-full max-w-sm">
                <BarcodeScanner
                  isOpen={showScanner}
                  continuous={true}
                  onScan={handleBarcodeScan}
                  onClose={() => setShowScanner(false)}
                />
              </div>
            </div>
          )}

          {/* Invoice Details */}
          {invoice && (
            <div className="space-y-4 border-t pt-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="h-5 w-5 text-gray-600" />
                  <h3 className="font-semibold text-lg">Invoice Details</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-gray-600 block text-xs">Invoice Number</span>
                    <span className="font-medium">{invoice.invoice_number}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 block text-xs">Customer</span>
                    <span className="font-medium">{invoice.customer_name || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 block text-xs">Store</span>
                    <span className="font-medium">{invoice.store_name || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 block text-xs">Date</span>
                    <span className="font-medium">
                      {new Date(invoice.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Invoice Items */}
              <div className="space-y-2">
                <h3 className="font-semibold text-gray-900">Select Items to Return</h3>
                <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
                  {invoice.items.map((item) => {
                    const isSelected = (selectedItems[item.id] || 0) > 0;
                    const maxQuantity = item.available_quantity;
                    const selectedQuantity = selectedItems[item.id] || 0;

                    return (
                      <div
                        key={item.id}
                        className={`p-3 hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50' : ''
                          }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleItemToggle(item.id)}
                              className="w-4 h-4 text-blue-600 rounded mt-1"
                            />
                            <div className="flex-1">
                              <div className="font-medium text-gray-900">{item.product_name}</div>
                              <div className="text-sm text-gray-600 mt-1">
                                SKU: {item.product_sku}
                                {item.barcode_value && ` | Barcode: ${item.barcode_value}`}
                              </div>
                              <div className="text-sm text-gray-500 mt-1">
                                Sold: {item.quantity} | Available: {item.available_quantity}
                              </div>
                              <div className="text-sm text-gray-600 mt-1">
                                Price: ₹{formatNumber(item.manual_unit_price || item.unit_price || 0)} per unit
                              </div>
                            </div>
                          </div>
                          {isSelected && (
                            <div className="flex flex-col items-end gap-3">
                              {/* Return Condition (Traffic Signals) */}
                              <div className="flex items-center gap-2 mb-1">
                                <button
                                  type="button"
                                  onClick={() => handleReturnTagChange(item.id, 'returned')}
                                  className={`w-5 h-5 rounded-full bg-green-500 border-2 transition-all hover:scale-110 ${itemTags[item.id] === 'returned'
                                    ? 'border-gray-900 scale-110 shadow-sm ring-1 ring-green-200'
                                    : 'border-transparent opacity-30 hover:opacity-60'
                                    }`}
                                  title="Returned (Good condition)"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleReturnTagChange(item.id, 'defective')}
                                  className={`w-5 h-5 rounded-full bg-red-500 border-2 transition-all hover:scale-110 ${itemTags[item.id] === 'defective'
                                    ? 'border-gray-900 scale-110 shadow-sm ring-1 ring-red-200'
                                    : 'border-transparent opacity-30 hover:opacity-60'
                                    }`}
                                  title="Defective"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleReturnTagChange(item.id, 'unknown')}
                                  className={`w-5 h-5 rounded-full bg-yellow-400 border-2 transition-all hover:scale-110 ${itemTags[item.id] === 'unknown'
                                    ? 'border-gray-900 scale-110 shadow-sm ring-1 ring-yellow-200'
                                    : 'border-transparent opacity-30 hover:opacity-60'
                                    }`}
                                  title="Unknown (Default)"
                                />
                                <span className="text-[10px] font-bold text-gray-500 capitalize min-w-[50px]">
                                  {itemTags[item.id] || 'unknown'}
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    if (selectedQuantity > 0) {
                                      handleQuantityChange(item.id, String(selectedQuantity - 1), maxQuantity);
                                    }
                                  }}
                                  disabled={selectedQuantity <= 0}
                                >
                                  <Minus className="h-4 w-4" />
                                </Button>
                                <Input
                                  type="number"
                                  step="1"
                                  value={selectedQuantity}
                                  onChange={(e) => handleQuantityChange(item.id, e.target.value, maxQuantity)}
                                  onBlur={(e) => {
                                    const val = Math.max(0, Math.min(parseInt(e.target.value) || 0, maxQuantity));
                                    handleQuantityChange(item.id, val.toString(), maxQuantity);
                                  }}
                                  min={0}
                                  max={maxQuantity}
                                  className="w-20 text-center"
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    if (selectedQuantity < maxQuantity) {
                                      handleQuantityChange(item.id, String(selectedQuantity + 1), maxQuantity);
                                    }
                                  }}
                                  disabled={selectedQuantity >= maxQuantity}
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              </div>
                              {/* Refund amount for this item */}
                              <div className="text-xs text-green-600 font-medium">
                                Refund: ₹{(() => {
                                  const effectivePrice = parseFloat(item.manual_unit_price || item.unit_price || '0');
                                  const lineTotal = parseFloat(item.line_total || '0');
                                  const itemQuantity = parseFloat(item.quantity) || 1;
                                  // Use line_total / quantity for accurate per-unit price (accounts for discounts/taxes)
                                  const pricePerUnit = itemQuantity > 0 ? lineTotal / itemQuantity : effectivePrice;
                                  return formatNumber(pricePerUnit * selectedQuantity);
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Summary */}
              {hasSelectedItems && (
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Package className="h-5 w-5 text-blue-600" />
                    <span className="font-semibold text-blue-900">Return Summary</span>
                  </div>
                  <div className="text-sm text-blue-800 space-y-1">
                    <div>Total items selected: {Object.values(selectedItems).filter(qty => qty > 0).length}</div>
                    <div>Total quantity to return: {totalItemsToReturn}</div>
                    <div className="mt-2 pt-2 border-t border-blue-300">
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className="h-4 w-4" />
                        <span className="font-semibold">Estimated Refund Amount:</span>
                      </div>
                      <div className="font-semibold text-green-700">
                        ₹{formatNumber(estimatedRefundAmount)}
                        <span className="text-xs font-normal text-gray-600 ml-2">(Credit entry will be created in customer ledger)</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 justify-end pt-2 border-t">
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={processReturnMutation.isPending}
                >
                  Reset
                </Button>
                <Button
                  variant="primary"
                  onClick={handleProcessReturn}
                  disabled={!hasSelectedItems || processReturnMutation.isPending}
                >
                  {processReturnMutation.isPending ? 'Processing...' : 'Return to Stock'}
                </Button>
              </div>
            </div>
          )}

          {!invoice && !findInvoiceQuery.isFetching && !searchError && (
            <div className="text-center py-12 text-gray-500 border-t pt-8">
              <Search className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-600">Enter a barcode, SKU, or invoice number to find the invoice</p>
              <p className="text-sm text-gray-500 mt-2">Or use the camera icon to scan a QR code</p>
            </div>
          )}
        </div>
      </Card>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
