import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { posApi, productsApi } from '../../lib/api';
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

interface ReplacementItem {
  item_id: number;
  new_product_id: number | null;
  new_product_name: string;
  quantity: number;
  new_unit_price?: number | null;
  manual_unit_price?: number | null;
}

export default function ReplaceProduct() {
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showInvoiceDropdown, setShowInvoiceDropdown] = useState(false);
  const [replacements, setReplacements] = useState<Record<number, ReplacementItem>>({});
  const [productSearch, setProductSearch] = useState<Record<number, string>>({});
  const [showProductDropdown, setShowProductDropdown] = useState<Record<number, boolean>>({});
  const [debouncedProductSearches, setDebouncedProductSearches] = useState<Record<number, string>>({});
  const [showProductScanner, setShowProductScanner] = useState<Record<number, boolean>>({});
  const [productSearchSelectedIndex, setProductSearchSelectedIndex] = useState<Record<number, number>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Helper function to check if input looks like a barcode
  const looksLikeBarcode = (input: string): boolean => {
    if (!input || input.length < 3) return false;
    // Barcodes are typically alphanumeric, may contain dashes, and are usually longer
    // Product names usually have spaces and are more varied
    const hasSpaces = /\s/.test(input);
    const isMostlyNumeric = /^\d+$/.test(input);
    const hasSpecialChars = /[^a-zA-Z0-9\s-]/.test(input);
    
    // If it has spaces or special chars (except dashes), it's likely a product name
    if (hasSpaces || hasSpecialChars) return false;
    // If it's mostly numeric or alphanumeric without spaces, it's likely a barcode
    return isMostlyNumeric || (!hasSpaces && input.length >= 3);
  };

  // Debounce product searches
  useEffect(() => {
    const timers: Record<number, ReturnType<typeof setTimeout>> = {};
    Object.entries(productSearch).forEach(([itemId, value]) => {
      if (timers[parseInt(itemId)]) {
        clearTimeout(timers[parseInt(itemId)]);
      }
      timers[parseInt(itemId)] = setTimeout(() => {
        setDebouncedProductSearches(prev => ({ ...prev, [itemId]: value }));
      }, 300);
    });
    return () => {
      Object.values(timers).forEach(timer => clearTimeout(timer));
    };
  }, [productSearch]);

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
          
          // Auto-select item if barcode/SKU matches
          const initialReplacements: Record<number, ReplacementItem> = {};
          const initialProductSearch: Record<number, string> = {};
          const searchBarcode = searchValue.trim().toUpperCase();
          
          response.data.invoice.items.forEach((item: InvoiceItem) => {
            const itemBarcode = item.barcode_value?.toUpperCase() || '';
            const itemSku = item.product_sku?.toUpperCase() || '';
            
            // Auto-select item if barcode or SKU matches
            if (itemBarcode === searchBarcode || itemSku === searchBarcode) {
              initialReplacements[item.id] = {
                item_id: item.id,
                new_product_id: null,
                new_product_name: '',
                quantity: Math.min(1, item.available_quantity),
              };
            }
          });
          
          setReplacements(initialReplacements);
          setProductSearch(initialProductSearch);
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

  // Product search - use a single query that updates based on active search
  const [activeProductSearchItemId, setActiveProductSearchItemId] = useState<number | null>(null);
  const activeSearchTerm = activeProductSearchItemId ? debouncedProductSearches[activeProductSearchItemId] : '';
  const trimmedActiveSearch = activeSearchTerm?.trim() || '';
  
  // Barcode check query for replacement product search
  const barcodeCheckQuery = useQuery({
    queryKey: ['barcode-check-replacement', activeProductSearchItemId, trimmedActiveSearch],
    queryFn: async () => {
      if (!trimmedActiveSearch || trimmedActiveSearch.length < 3) return null;
      if (!looksLikeBarcode(trimmedActiveSearch)) return null;
      
      try {
        const response = await productsApi.byBarcode(trimmedActiveSearch, true);
        if (response.data) {
          return { product: response.data, isUnavailable: !response.data.barcode_available };
        }
      } catch (error) {
        return null;
      }
      return null;
    },
    enabled: Boolean(trimmedActiveSearch.length >= 3 && looksLikeBarcode(trimmedActiveSearch) && activeProductSearchItemId !== null),
    retry: false,
  });
  
  const productSearchQuery = useQuery({
    queryKey: ['products-replacement', activeProductSearchItemId, activeSearchTerm],
    queryFn: async () => {
      if (!activeSearchTerm || activeSearchTerm.trim().length < 1) return { results: [] };
      try {
        const response = await productsApi.list({ search: activeSearchTerm.trim(), tag: 'new' });
        return response.data;
      } catch (error) {
        return { results: [] };
      }
    },
    enabled: Boolean(activeSearchTerm && activeSearchTerm.trim().length >= 1 && activeProductSearchItemId !== null && !(looksLikeBarcode(trimmedActiveSearch) && barcodeCheckQuery.data?.product && !barcodeCheckQuery.data?.isUnavailable)),
    retry: false,
  });

  // Process replacement mutation
  const processReplacementMutation = useMutation({
    mutationFn: async (data: { invoice_id: number; replacements: Array<{ invoice_item_id: number; new_product_id: number; store_id?: number; new_unit_price?: number; manual_unit_price?: number }> }) => {
      const results = [];
      for (const replacement of data.replacements) {
        const result = await posApi.replacement.replace({
          invoice_item_id: replacement.invoice_item_id,
          new_product_id: replacement.new_product_id,
          store_id: replacement.store_id || data.invoice_id, // Use invoice store if not provided
          new_unit_price: replacement.new_unit_price,
          manual_unit_price: replacement.manual_unit_price,
        });
        results.push(result.data);
      }
      return { results, invoice_id: data.invoice_id };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      showToast('Product replacement processed successfully', 'success');
      // Navigate to invoice page after successful replacement
      navigate(`/invoices/${data.invoice_id}`);
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to process replacement';
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
    setReplacements({});
    setProductSearch({});
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
    setReplacements(prev => {
      if (prev[itemId]) {
        const newReplacements = { ...prev };
        delete newReplacements[itemId];
        return newReplacements;
      } else {
        return {
          ...prev,
          [itemId]: {
            item_id: itemId,
            new_product_id: null,
            new_product_name: '',
            quantity: 1,
          }
        };
      }
    });
  };

  const handleQuantityChange = (itemId: number, value: string, maxQuantity: number) => {
    if (value === '' || /^\d+$/.test(value)) {
      const intValue = value === '' ? 0 : parseInt(value);
      const clampedValue = Math.max(1, Math.min(intValue, maxQuantity));
      setReplacements(prev => ({
        ...prev,
        [itemId]: {
          ...prev[itemId],
          quantity: clampedValue,
        }
      }));
    }
  };

  const handleProductSelect = (itemId: number, product: any) => {
    // Get price from product (selling_price or purchase_price)
    const productPrice = product.selling_price || product.purchase_price || product.unit_price || 0;
    
    setReplacements(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        new_product_id: product.id,
        new_product_name: product.name,
        new_unit_price: productPrice,
        manual_unit_price: null, // Will be set if user manually adjusts
      }
    }));
    setProductSearch(prev => ({ ...prev, [itemId]: product.name }));
    setShowProductDropdown(prev => ({ ...prev, [itemId]: false }));
  };

  const handlePriceChange = (itemId: number, value: string) => {
    // Allow empty string, 0, or positive numbers
    if (value === '' || value === null || value === undefined) {
      // Clear manual price, use default from product
      setReplacements(prev => ({
        ...prev,
        [itemId]: {
          ...prev[itemId],
          manual_unit_price: undefined, // Will use new_unit_price
        }
      }));
    } else {
      // Only parse if there's actual content
      const trimmedValue = value.trim();
      if (trimmedValue === '' || trimmedValue === '-') {
        // Allow empty or just minus sign while typing
        setReplacements(prev => ({
          ...prev,
          [itemId]: {
            ...prev[itemId],
            manual_unit_price: undefined,
          }
        }));
      } else {
        const priceValue = parseFloat(trimmedValue);
        if (!isNaN(priceValue) && priceValue >= 0) {
          setReplacements(prev => ({
            ...prev,
            [itemId]: {
              ...prev[itemId],
              manual_unit_price: priceValue,
            }
          }));
        }
      }
    }
  };

  const handleProductSearchChange = (itemId: number, value: string) => {
    setProductSearch(prev => ({ ...prev, [itemId]: value }));
    setShowProductDropdown(prev => ({ ...prev, [itemId]: value.trim().length > 0 }));
    setActiveProductSearchItemId(itemId);
    setProductSearchSelectedIndex(prev => ({ ...prev, [itemId]: -1 }));
  };

  const handleProductSearchKeyDown = async (itemId: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    const products = getProductsForItem(itemId);
    const searchValue = productSearch[itemId] || '';
    
    if (e.key === 'Enter') {
      e.preventDefault();
      if (productSearchSelectedIndex[itemId] >= 0 && products.length > 0) {
        const product = products[productSearchSelectedIndex[itemId]];
        if (product) {
          handleProductSelect(itemId, product);
          return;
        }
      }
      
      // If barcode check found a product, select it
      if (barcodeCheckQuery.data?.product && !barcodeCheckQuery.data.isUnavailable && activeProductSearchItemId === itemId) {
        handleProductSelect(itemId, barcodeCheckQuery.data.product);
        return;
      }
      
      // Try barcode lookup
      if (searchValue.trim().length >= 3 && looksLikeBarcode(searchValue.trim())) {
        try {
          const barcodeCheck = await productsApi.byBarcode(searchValue.trim(), true);
          if (barcodeCheck.data && barcodeCheck.data.barcode_available) {
            handleProductSelect(itemId, barcodeCheck.data);
            setProductSearch(prev => ({ ...prev, [itemId]: '' }));
            return;
          }
        } catch (error) {
          // Barcode not found, continue with normal search
        }
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (products.length > 0) {
        setProductSearchSelectedIndex(prev => ({ ...prev, [itemId]: 0 }));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const currentIndex = productSearchSelectedIndex[itemId] || -1;
      if (currentIndex > 0) {
        setProductSearchSelectedIndex(prev => ({ ...prev, [itemId]: currentIndex - 1 }));
      }
    } else if (e.key === 'Escape') {
      setShowProductDropdown(prev => ({ ...prev, [itemId]: false }));
    }
  };

  const handleProcessReplacement = () => {
    if (!invoice) return;

    const replacementsToProcess: Array<{ invoice_item_id: number; new_product_id: number; store_id?: number; new_unit_price?: number; manual_unit_price?: number }> = [];
    
    Object.values(replacements).forEach(replacement => {
      if (replacement.new_product_id && replacement.quantity > 0) {
        const replacementData: any = {
          invoice_item_id: replacement.item_id,
          new_product_id: replacement.new_product_id,
          store_id: invoice.store,
        };
        
        // Only include price if manually set
        if (replacement.manual_unit_price !== null && replacement.manual_unit_price !== undefined) {
          replacementData.manual_unit_price = replacement.manual_unit_price;
        } else if (replacement.new_unit_price) {
          replacementData.new_unit_price = replacement.new_unit_price;
        }
        
        replacementsToProcess.push(replacementData);
      }
    });

    if (replacementsToProcess.length === 0) {
      showToast('Please select at least one item with a replacement product', 'info');
      return;
    }

    if (!confirm('Are you sure you want to process this replacement? Old items will be returned to stock and new items will be added to the invoice.')) {
      return;
    }

    const invoiceId = invoice.id; // Capture invoice ID before mutation

    // Process replacements one by one
    processReplacementMutation.mutate({
      invoice_id: invoiceId,
      replacements: replacementsToProcess,
    });
  };

  const handleReset = () => {
    setSearchValue('');
    setInvoice(null);
    setReplacements({});
    setProductSearch({});
    setSearchError(null);
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  const hasReplacements = Object.values(replacements).some(r => r.new_product_id !== null && r.quantity > 0);

  // Get products for each item
  const getProductsForItem = (itemId: number) => {
    if (activeProductSearchItemId !== itemId) return [];
    
    const productList: any[] = [];
    
    // Add barcode-check product if available (highest priority)
    if (barcodeCheckQuery.data?.product && !barcodeCheckQuery.data.isUnavailable) {
      productList.push(barcodeCheckQuery.data.product);
    }
    
    // Add products from search results
    if (productSearchQuery?.data) {
      const data = productSearchQuery.data;
      const existingIds = new Set(productList.map(p => p.id));
      
      if (Array.isArray(data?.results)) {
        productList.push(...data.results.filter((p: any) => !existingIds.has(p.id)));
      } else if (Array.isArray(data?.data)) {
        productList.push(...data.data.filter((p: any) => !existingIds.has(p.id)));
      } else if (Array.isArray(data)) {
        productList.push(...data.filter((p: any) => !existingIds.has(p.id)));
      }
    }
    
    return productList;
  };

  const handleProductBarcodeScan = (itemId: number, barcode: string) => {
    setProductSearch(prev => ({ ...prev, [itemId]: barcode }));
    setShowProductScanner(prev => ({ ...prev, [itemId]: false }));
    setActiveProductSearchItemId(itemId);
  };

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
        <h1 className="text-2xl font-bold text-gray-900">Replace Product</h1>
      </div>
      
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold mb-2">Product Replacement:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Find the invoice containing items to replace</li>
              <li>Select items and choose replacement products (same or different)</li>
              <li>Old items will be returned to stock, new items will be added to invoice</li>
              <li>Price difference will be adjusted in customer ledger</li>
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
                <h3 className="font-semibold text-gray-900">Select Items to Replace</h3>
                <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
                  {invoice.items.map((item) => {
                    const replacement = replacements[item.id];
                    const isSelected = Boolean(replacement);
                    const maxQuantity = item.available_quantity;
                    const selectedQuantity = replacement?.quantity || 0;
                    const products = getProductsForItem(item.id);
                    const showDropdown = showProductDropdown[item.id] && products.length > 0;

                    return (
                      <div
                        key={item.id}
                        className={`p-3 hover:bg-gray-50 transition-colors ${
                          isSelected ? 'bg-blue-50' : ''
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
                                Current Price: ₹{parseFloat(item.manual_unit_price || item.unit_price || '0').toFixed(2)} per unit
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        {isSelected && (
                          <div className="mt-3 ml-7 space-y-3">
                            {/* Quantity Selection */}
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-700">Quantity:</span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  if (selectedQuantity > 1) {
                                    handleQuantityChange(item.id, String(selectedQuantity - 1), maxQuantity);
                                  }
                                }}
                                disabled={selectedQuantity <= 1}
                              >
                                <Minus className="h-4 w-4" />
                              </Button>
                              <Input
                                type="number"
                                step="1"
                                value={selectedQuantity}
                                onChange={(e) => handleQuantityChange(item.id, e.target.value, maxQuantity)}
                                min={1}
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

                            {/* Product Search */}
                            <div className="relative">
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Replacement Product:
                              </label>
                              <div className="relative">
                                <Input
                                  type="text"
                                  value={productSearch[item.id] || ''}
                                  onChange={(e) => handleProductSearchChange(item.id, e.target.value)}
                                  onKeyDown={(e) => handleProductSearchKeyDown(item.id, e)}
                                  placeholder="Search by name, SKU, or scan barcode..."
                                  className="w-full pr-24"
                                />
                                <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                                  <Button
                                    onClick={() => setShowProductScanner(prev => ({ ...prev, [item.id]: true }))}
                                    variant="outline"
                                    size="sm"
                                    className="whitespace-nowrap"
                                    title="Open camera scanner"
                                  >
                                    <Camera className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                              
                              {/* Barcode Scanner for Product Search */}
                              {showProductScanner[item.id] && (
                                <div className="mt-2 border rounded-lg p-4 bg-gray-50 flex justify-center">
                                  <div className="w-full max-w-sm">
                                    <BarcodeScanner
                                      isOpen={showProductScanner[item.id]}
                                      continuous={true}
                                      onScan={(barcode) => handleProductBarcodeScan(item.id, barcode)}
                                      onClose={() => setShowProductScanner(prev => ({ ...prev, [item.id]: false }))}
                                    />
                                  </div>
                                </div>
                              )}
                              
                              {showDropdown && (
                                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                  {products.length === 0 ? (
                                    <div className="px-4 py-6 text-center text-sm text-gray-500">
                                      No products found
                                    </div>
                                  ) : (
                                    products.map((product: any, index: number) => {
                                      const isSelected = (productSearchSelectedIndex[item.id] || -1) === index;
                                      return (
                                        <button
                                          key={product.id}
                                          type="button"
                                          onClick={() => handleProductSelect(item.id, product)}
                                          className={`w-full text-left px-4 py-3 hover:bg-blue-50 border-b last:border-b-0 transition-colors ${
                                            isSelected ? 'bg-blue-50' : ''
                                          }`}
                                        >
                                          <div className="font-medium text-gray-900">{product.name}</div>
                                          <div className="text-sm text-gray-600 mt-1">
                                            SKU: {product.sku || 'N/A'}
                                          </div>
                                        </button>
                                      );
                                    })
                                  )}
                                </div>
                              )}
                              
                              {/* Barcode status message */}
                              {activeProductSearchItemId === item.id && barcodeCheckQuery.data?.isUnavailable && (
                                <div className="mt-2 text-sm text-red-600 flex items-center gap-1">
                                  <AlertTriangle className="h-4 w-4" />
                                  {barcodeCheckQuery.data.product?.barcode_status_message || 'This barcode is not available'}
                                </div>
                              )}
                              
                              {replacement?.new_product_name && (
                                <>
                                  <div className="mt-2 text-sm text-green-600 flex items-center gap-1">
                                    <Package className="h-4 w-4" />
                                    Selected: {replacement.new_product_name}
                                  </div>
                                  
                                  {/* Price Adjustment */}
                                  <div className="mt-3 space-y-2">
                                    <label className="block text-sm font-medium text-gray-700">
                                      Price Adjustment:
                                    </label>
                                    <div className="grid grid-cols-2 gap-3 text-sm">
                                      <div>
                                        <span className="text-gray-600 block text-xs">Old Price (per unit)</span>
                                        <span className="font-medium">₹{parseFloat(item.manual_unit_price || item.unit_price || '0').toFixed(2)}</span>
                                      </div>
                                      <div>
                                        <span className="text-gray-600 block text-xs">New Price (per unit)</span>
                                        <div className="flex items-center gap-2">
                                          <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={
                                              replacement.manual_unit_price !== null && replacement.manual_unit_price !== undefined
                                                ? replacement.manual_unit_price.toString()
                                                : ''
                                            }
                                            onChange={(e) => {
                                              const val = e.target.value;
                                              // Allow empty string, numbers, or decimal points while typing
                                              if (val === '' || val === null || /^[\d.]*$/.test(val)) {
                                                handlePriceChange(item.id, val);
                                              }
                                            }}
                                            onBlur={(e) => {
                                              // If empty on blur, use default from product
                                              const val = e.target.value.trim();
                                              if (val === '' || val === null || val === '0') {
                                                setReplacements(prev => ({
                                                  ...prev,
                                                  [item.id]: {
                                                    ...prev[item.id],
                                                    manual_unit_price: undefined,
                                                  }
                                                }));
                                              }
                                            }}
                                            placeholder={replacement.new_unit_price 
                                              ? `Default: ₹${replacement.new_unit_price.toFixed(2)}` 
                                              : `Default: ₹${parseFloat(item.manual_unit_price || item.unit_price || '0').toFixed(2)}`}
                                            className="w-full"
                                          />
                                          {replacement.manual_unit_price === null || replacement.manual_unit_price === undefined ? (
                                            <span className="text-xs text-gray-500 mt-1 block">
                                              Leave empty to use default price: ₹{replacement.new_unit_price?.toFixed(2) || parseFloat(item.manual_unit_price || item.unit_price || '0').toFixed(2)}
                                            </span>
                                          ) : (
                                            <span className="text-xs text-gray-400 mt-1 block">
                                              Custom price set (default was ₹{replacement.new_unit_price?.toFixed(2) || parseFloat(item.manual_unit_price || item.unit_price || '0').toFixed(2)})
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    
                                    {/* Price Difference Calculation */}
                                    {replacement.new_product_id && (
                                      <div className="mt-2 p-2 bg-gray-50 rounded border">
                                        <div className="flex justify-between items-center text-sm">
                                          <span className="text-gray-600">Price Difference (Total):</span>
                                          <span className={`font-semibold ${
                                            (() => {
                                              const oldPrice = parseFloat(item.manual_unit_price || item.unit_price || '0');
                                              const newPrice = replacement.manual_unit_price !== null && replacement.manual_unit_price !== undefined
                                                ? replacement.manual_unit_price
                                                : (replacement.new_unit_price || oldPrice);
                                              const diff = (newPrice - oldPrice) * selectedQuantity;
                                              return diff >= 0 ? 'text-green-600' : 'text-red-600';
                                            })()
                                          }`}>
                                            {(() => {
                                              const oldPrice = parseFloat(item.manual_unit_price || item.unit_price || '0');
                                              const newPrice = replacement.manual_unit_price !== null && replacement.manual_unit_price !== undefined
                                                ? replacement.manual_unit_price
                                                : (replacement.new_unit_price || oldPrice);
                                              const diff = (newPrice - oldPrice) * selectedQuantity;
                                              return diff >= 0 ? `+₹${diff.toFixed(2)}` : `₹${diff.toFixed(2)}`;
                                            })()}
                                          </span>
                                        </div>
                                        <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                                          {(() => {
                                            const oldPrice = parseFloat(item.manual_unit_price || item.unit_price || '0');
                                            const newPrice = replacement.manual_unit_price !== null && replacement.manual_unit_price !== undefined
                                              ? replacement.manual_unit_price
                                              : (replacement.new_unit_price || oldPrice);
                                            const diff = newPrice - oldPrice;
                                            const totalDiff = diff * selectedQuantity;
                                            
                                            return (
                                              <>
                                                <div>
                                                  {diff > 0 
                                                    ? `Customer pays ₹${diff.toFixed(2)} more per unit`
                                                    : diff < 0
                                                    ? `Customer gets ₹${Math.abs(diff).toFixed(2)} refund per unit`
                                                    : 'No price difference per unit'}
                                                </div>
                                                {selectedQuantity > 1 && (
                                                  <div className="font-medium">
                                                    Total: {totalDiff >= 0 ? `+₹${totalDiff.toFixed(2)}` : `₹${totalDiff.toFixed(2)}`} for {selectedQuantity} units
                                                  </div>
                                                )}
                                              </>
                                            );
                                          })()}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Summary */}
              {hasReplacements && (
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Package className="h-5 w-5 text-blue-600" />
                    <span className="font-semibold text-blue-900">Replacement Summary</span>
                  </div>
                  <div className="text-sm text-blue-800 space-y-1">
                    <div>Total items to replace: {Object.values(replacements).filter(r => r.new_product_id).length}</div>
                    <div className="mt-2 pt-2 border-t border-blue-300">
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className="h-4 w-4" />
                        <span className="font-semibold">Price Adjustments:</span>
                      </div>
                      {(() => {
                        let totalPriceDiff = 0;
                        Object.values(replacements).forEach(replacement => {
                          if (replacement.new_product_id) {
                            const item = invoice.items.find(i => i.id === replacement.item_id);
                            if (item) {
                              const oldPrice = parseFloat(item.manual_unit_price || item.unit_price || '0');
                              const newPrice = replacement.manual_unit_price !== null && replacement.manual_unit_price !== undefined
                                ? replacement.manual_unit_price
                                : (replacement.new_unit_price || oldPrice);
                              const diff = (newPrice - oldPrice) * replacement.quantity;
                              totalPriceDiff += diff;
                            }
                          }
                        });
                        return (
                          <div className={`font-semibold ${totalPriceDiff >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            Total Adjustment: {totalPriceDiff >= 0 ? `+₹${totalPriceDiff.toFixed(2)}` : `₹${totalPriceDiff.toFixed(2)}`}
                            {totalPriceDiff > 0 && <span className="text-xs font-normal text-gray-600 ml-2">(Customer pays more)</span>}
                            {totalPriceDiff < 0 && <span className="text-xs font-normal text-gray-600 ml-2">(Customer gets refund)</span>}
                            {totalPriceDiff === 0 && <span className="text-xs font-normal text-gray-600 ml-2">(No change)</span>}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 justify-end pt-2 border-t">
                <Button 
                  variant="outline" 
                  onClick={handleReset} 
                  disabled={processReplacementMutation.isPending}
                >
                  Reset
                </Button>
                <Button
                  variant="primary"
                  onClick={handleProcessReplacement}
                  disabled={!hasReplacements || processReplacementMutation.isPending}
                >
                  {processReplacementMutation.isPending ? 'Processing...' : 'Process Replacement'}
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
