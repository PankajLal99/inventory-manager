import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { posApi } from '../../lib/api';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { Search, AlertTriangle, Package, Plus, Minus } from 'lucide-react';

interface ReplacementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface InvoiceItem {
  id: number;
  product: number;
  product_name: string;
  product_sku: string;
  product_track_inventory: boolean;
  quantity: string;
  available_quantity: number;
  unit_price: string;
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
}

export default function ReplacementModal({ isOpen, onClose, onSuccess }: ReplacementModalProps) {
  const [searchValue, setSearchValue] = useState('');
  const [selectedItems, setSelectedItems] = useState<Record<number, number>>({}); // item_id -> quantity to replace
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Find invoice by barcode/SKU
  const findInvoiceQuery = useQuery({
    queryKey: ['find-invoice', searchValue],
    queryFn: async () => {
      if (!searchValue.trim()) return null;
      try {
        const response = await posApi.replacement.findInvoiceByBarcode({
          barcode: searchValue.trim(),
          sku: searchValue.trim(),
        });
        if (response.data?.invoice) {
          setInvoice(response.data.invoice);
          setSearchError(null);
          // Initialize selected items with 0 quantity
          const initialSelected: Record<number, number> = {};
          response.data.invoice.items.forEach((item: InvoiceItem) => {
            initialSelected[item.id] = 0;
          });
          setSelectedItems(initialSelected);
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
    enabled: false, // Don't auto-fetch, only on button click
    retry: false,
  });

  // Process replacement mutation
  const processReplacementMutation = useMutation({
    mutationFn: async (data: { invoice_id: number; items_to_replace: Array<{ item_id: number; quantity: number }> }) => {
      return await posApi.replacement.processReplacement(data.invoice_id, {
        items_to_replace: data.items_to_replace,
      });
    },
    onSuccess: () => {
      onSuccess?.();
      handleClose();
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to process replacement';
      alert(errorMsg);
    },
  });

  const handleSearch = () => {
    if (!searchValue.trim()) {
      setSearchError('Please enter a barcode or SKU');
      return;
    }
    findInvoiceQuery.refetch();
  };

  const handleItemToggle = (itemId: number) => {
    setSelectedItems(prev => {
      const current = prev[itemId] || 0;
      if (current === 0) {
        // Select item with quantity 1
        return { ...prev, [itemId]: 1 };
      } else {
        // Deselect item
        return { ...prev, [itemId]: 0 };
      }
    });
  };

  const handleQuantityChange = (itemId: number, value: string, maxQuantity: number) => {
    // Only allow positive integers
    if (value === '' || /^\d+$/.test(value)) {
      const intValue = value === '' ? 0 : parseInt(value);
      const clampedValue = Math.max(0, Math.min(intValue, maxQuantity));
      setSelectedItems((prev) => ({
        ...prev,
        [itemId]: clampedValue,
      }));
    }
  };

  const handleProcessReplacement = () => {
    if (!invoice) return;

    // Build items_to_replace array
    const items_to_replace: Array<{ item_id: number; quantity: number }> = [];
    Object.entries(selectedItems).forEach(([itemId, quantity]) => {
      if (quantity > 0) {
        items_to_replace.push({
          item_id: parseInt(itemId),
          quantity: quantity,
        });
      }
    });

    if (items_to_replace.length === 0) {
      alert('Please select at least one item to replace');
      return;
    }

    // Confirm before processing
    if (!confirm('Are you sure you want to process this replacement? Items will be marked as "unknown".')) {
      return;
    }

    processReplacementMutation.mutate({
      invoice_id: invoice.id,
      items_to_replace,
    });
  };

  const handleClose = () => {
    setSearchValue('');
    setInvoice(null);
    setSelectedItems({});
    setSearchError(null);
    onClose();
  };

  const hasSelectedItems = Object.values(selectedItems).some(qty => qty > 0);
  const totalItemsToReplace = Object.values(selectedItems).reduce((sum, qty) => sum + qty, 0);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Process Replacement" size="lg">
      <div className="space-y-6">
        {/* Search Section */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Search by Barcode or SKU
          </label>
          <div className="flex gap-2">
            <Input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearch();
                }
              }}
              placeholder="Enter barcode or SKU"
              className="flex-1"
            />
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

        {/* Invoice Details */}
        {invoice && (
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="font-semibold text-lg mb-2">Invoice Details</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-600">Invoice Number:</span>
                  <span className="ml-2 font-medium">{invoice.invoice_number}</span>
                </div>
                <div>
                  <span className="text-gray-600">Customer:</span>
                  <span className="ml-2 font-medium">{invoice.customer_name || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-gray-600">Store:</span>
                  <span className="ml-2 font-medium">{invoice.store_name || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-gray-600">Date:</span>
                  <span className="ml-2 font-medium">
                    {new Date(invoice.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Invoice Items */}
            <div className="space-y-2">
              <h3 className="font-semibold">Select Items to Replace</h3>
              <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
                {invoice.items.map((item) => {
                  const isSelected = (selectedItems[item.id] || 0) > 0;
                  const maxQuantity = item.available_quantity;
                  const selectedQuantity = selectedItems[item.id] || 0;

                  return (
                    <div
                      key={item.id}
                      className={`p-4 hover:bg-gray-50 transition-colors ${
                        isSelected ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleItemToggle(item.id)}
                              className="w-4 h-4 text-blue-600 rounded"
                            />
                            <div>
                              <div className="font-medium">{item.product_name}</div>
                              <div className="text-sm text-gray-600">
                                SKU: {item.product_sku}
                                {item.barcode_value && ` | Barcode: ${item.barcode_value}`}
                              </div>
                              <div className="text-sm text-gray-500 mt-1">
                                Sold: {item.quantity} | Available for replacement: {item.available_quantity}
                              </div>
                            </div>
                          </div>
                        </div>
                        {isSelected && (
                          <div className="flex items-center gap-2 ml-4">
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
                                // Ensure value is a positive integer on blur
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
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary */}
            {hasSelectedItems && (
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Package className="h-5 w-5 text-blue-600" />
                  <span className="font-semibold">Replacement Summary</span>
                </div>
                <div className="text-sm">
                  <div>Total items selected: {Object.values(selectedItems).filter(qty => qty > 0).length}</div>
                  <div>Total quantity to replace: {totalItemsToReplace}</div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-4 border-t">
              <Button variant="outline" onClick={handleClose} disabled={processReplacementMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleProcessReplacement}
                disabled={!hasSelectedItems || processReplacementMutation.isPending}
              >
                {processReplacementMutation.isPending ? 'Processing...' : 'Process Replacement'}
              </Button>
            </div>
          </div>
        )}

        {!invoice && !findInvoiceQuery.isFetching && !searchError && (
          <div className="text-center py-8 text-gray-500">
            <Search className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>Enter a barcode or SKU to find the invoice</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

