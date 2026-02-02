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
  const [visibleItemIds, setVisibleItemIds] = useState<Set<number>>(new Set());
  const [itemTags, setItemTags] = useState<Record<number, 'returned' | 'defective' | 'unknown'>>({});

  const formatNumber = (val: any) => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return isNaN(num) ? '0.00' : num.toFixed(2);
  };

  // Helper to load a new invoice
  const loadInvoice = (newInvoice: Invoice, searchBarcode?: string) => {
    setInvoice(newInvoice);
    setSearchError(null);
    setSearchValue('');

    const initialSelected: Record<number, number> = {};
    const initialItemTags: Record<number, 'returned' | 'defective' | 'unknown'> = {};
    const initialVisibleItemIds = new Set<number>();
    const normalizedSearchBarcode = searchBarcode?.toUpperCase();

    newInvoice.items.forEach((item: InvoiceItem) => {
      const itemBarcode = item.barcode_value?.toUpperCase() || '';
      const itemSku = item.product_sku?.toUpperCase() || '';

      initialItemTags[item.id] = 'unknown';

      if (normalizedSearchBarcode && (itemBarcode === normalizedSearchBarcode || itemSku === normalizedSearchBarcode)) {
        initialVisibleItemIds.add(item.id);
        initialSelected[item.id] = Math.min(1, item.available_quantity);
      } else {
        initialSelected[item.id] = 0;
      }
    });

    setSelectedItems(initialSelected);
    setItemTags(initialItemTags);
    setVisibleItemIds(initialVisibleItemIds);
  };

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
          loadInvoice(response.data.invoice, searchValue.trim());
          return response.data;
        }
        return null;
      } catch (error: any) {
        const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to find invoice';
        setSearchError(errorMsg);
        setInvoice(null);
        setVisibleItemIds(new Set());
        return null;
      }
    },
    enabled: false, // Don't auto-fetch, only on button click
    retry: false,
  });

  // Process replacement mutation
  const processReplacementMutation = useMutation({
    mutationFn: async (data: { invoice_id: number; items_to_replace: Array<{ item_id: number; quantity: number; return_tag: string }> }) => {
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

  const handleSearch = async () => {
    if (!searchValue.trim()) {
      setSearchError('Please enter a barcode or SKU');
      return;
    }

    const searchBarcode = searchValue.trim().toUpperCase();

    // If an invoice is already loaded, check if we're adding to it or switching
    if (invoice) {
      // 1. Check if the barcode belongs to an item in the current invoice
      const matchingItems = invoice.items.filter(item =>
        item.barcode_value?.toUpperCase() === searchBarcode ||
        item.product_sku?.toUpperCase() === searchBarcode
      );

      if (matchingItems.length > 0) {
        setVisibleItemIds(prev => {
          const next = new Set(prev);
          matchingItems.forEach(item => next.add(item.id));
          return next;
        });

        // Auto-select matching items if not already
        setSelectedItems(prev => {
          const next = { ...prev };
          matchingItems.forEach(item => {
            if (!next[item.id] || next[item.id] === 0) {
              next[item.id] = Math.min(1, item.available_quantity);
            }
          });
          return next;
        });

        setSearchValue('');
        return;
      }

      // 2. Barcode not in current invoice, see if it belongs to a different invoice
      try {
        const response = await posApi.replacement.findInvoiceByBarcode({
          barcode: searchValue.trim(),
          sku: searchValue.trim(),
        });

        if (response.data?.invoice) {
          const newInvoice = response.data.invoice;

          if (newInvoice.id === invoice.id) {
            loadInvoice(newInvoice, searchValue.trim());
          } else {
            // DIFFERENT INVOICE - WARN USER
            if (window.confirm(`Scanning this barcode will switch to invoice ${newInvoice.invoice_number} and clear current selections. Proceed?`)) {
              loadInvoice(newInvoice, searchValue.trim());
            }
          }
          return;
        }
      } catch (error: any) {
        // Fall through
      }
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

  const handleReturnTagChange = (itemId: number, tag: 'returned' | 'defective' | 'unknown') => {
    setItemTags(prev => ({ ...prev, [itemId]: tag }));
  };

  const handleProcessReplacement = () => {
    if (!invoice) return;

    // Build items_to_replace array
    const items_to_replace: Array<{ item_id: number; quantity: number; return_tag: string }> = [];
    Object.entries(selectedItems).forEach(([itemIdStr, quantity]) => {
      const itemId = parseInt(itemIdStr);
      if (quantity > 0) {
        items_to_replace.push({
          item_id: itemId,
          quantity: quantity,
          return_tag: itemTags[itemId] || 'unknown',
        });
      }
    });

    if (items_to_replace.length === 0) {
      alert('Please select at least one item to replace');
      return;
    }

    // Confirm before processing
    if (!confirm('Are you sure you want to process this replacement?')) {
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
    setItemTags({});
    setSearchError(null);
    setVisibleItemIds(new Set());
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
              <h3 className="font-semibold">Items to Replace</h3>
              <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
                {invoice.items
                  .filter((item) => visibleItemIds.has(item.id))
                  .map((item) => {
                    const isSelected = (selectedItems[item.id] || 0) > 0;
                    const maxQuantity = item.available_quantity;
                    const selectedQuantity = selectedItems[item.id] || 0;

                    return (
                      <div
                        key={item.id}
                        className={`p-3 hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                          }`}
                      >
                        <div className="flex flex-col md:flex-row md:items-center gap-4">
                          {/* Product Info & Checkbox */}
                          <div className="flex-1 flex items-start gap-3 min-w-[200px]">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleItemToggle(item.id)}
                              className="w-4 h-4 text-blue-600 rounded mt-1"
                            />
                            <div className="flex-1">
                              <div className="font-medium text-gray-900 line-clamp-1">{item.product_name}</div>
                              <div className="text-[11px] text-gray-500 mt-0.5 uppercase tracking-wide">
                                SKU: {item.product_sku} | Stock: {item.available_quantity}
                              </div>
                            </div>
                          </div>

                          {/* Inlined Controls (Price, Condition, Qty) */}
                          {isSelected && (
                            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 md:justify-end">
                              {/* Price Column */}
                              <div className="flex flex-col">
                                <span className="text-[10px] text-gray-400 uppercase font-bold">Price</span>
                                <span className="text-sm font-semibold text-gray-700">₹{formatNumber(item.unit_price)}</span>
                              </div>

                              {/* Condition Column */}
                              <div className="flex flex-col">
                                <span className="text-[10px] text-gray-400 uppercase font-bold mb-1">Condition</span>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleReturnTagChange(item.id, 'returned')}
                                    className={`w-5 h-5 rounded-full bg-green-500 border transition-all hover:scale-110 ${itemTags[item.id] === 'returned'
                                      ? 'border-gray-900 ring-2 ring-green-200'
                                      : 'border-transparent opacity-30'
                                      }`}
                                    title="Returned (Good)"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleReturnTagChange(item.id, 'defective')}
                                    className={`w-5 h-5 rounded-full bg-red-500 border transition-all hover:scale-110 ${itemTags[item.id] === 'defective'
                                      ? 'border-gray-900 ring-2 ring-red-200'
                                      : 'border-transparent opacity-30'
                                      }`}
                                    title="Defective"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleReturnTagChange(item.id, 'unknown')}
                                    className={`w-5 h-5 rounded-full bg-yellow-400 border transition-all hover:scale-110 ${itemTags[item.id] === 'unknown'
                                      ? 'border-gray-900 ring-2 ring-yellow-200'
                                      : 'border-transparent opacity-30'
                                      }`}
                                    title="Unknown"
                                  />
                                </div>
                              </div>

                              {/* Quantity Column */}
                              <div className="flex flex-col">
                                <span className="text-[10px] text-gray-400 uppercase font-bold mb-1">Qty</span>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    className="w-7 h-7 flex items-center justify-center border rounded bg-white hover:bg-gray-50 disabled:opacity-50"
                                    onClick={() => selectedQuantity > 0 && handleQuantityChange(item.id, String(selectedQuantity - 1), maxQuantity)}
                                    disabled={selectedQuantity <= 0}
                                  >
                                    <Minus className="h-3 w-3" />
                                  </button>
                                  <input
                                    type="text"
                                    value={selectedQuantity}
                                    onChange={(e) => handleQuantityChange(item.id, e.target.value, maxQuantity)}
                                    onBlur={(e) => {
                                      const val = Math.max(0, Math.min(parseInt(e.target.value) || 0, maxQuantity));
                                      handleQuantityChange(item.id, val.toString(), maxQuantity);
                                    }}
                                    className="w-10 h-7 text-center border-y focus:outline-none text-sm font-medium"
                                  />
                                  <button
                                    className="w-7 h-7 flex items-center justify-center border rounded bg-white hover:bg-gray-50 disabled:opacity-50"
                                    onClick={() => selectedQuantity < maxQuantity && handleQuantityChange(item.id, String(selectedQuantity + 1), maxQuantity)}
                                    disabled={selectedQuantity >= maxQuantity}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </button>
                                </div>
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
