import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useRef, useEffect, useMemo } from 'react';
import { posApi, productsApi } from '../../lib/api';
import { formatNumber } from '../../lib/utils';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import Input from '../../components/ui/Input';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import { ArrowLeft, Trash2, Plus, Check, Barcode, Search, Package, XCircle } from 'lucide-react';

export default function InvoiceEdit() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invoiceId = parseInt(id || '0');
  const cartIdFromLocation = (location.state as { cartId?: number })?.cartId;
  const [cartId, setCartId] = useState<number | undefined>(cartIdFromLocation);

  // Initialize cartId from localStorage if not in state
  useEffect(() => {
    if (!cartId) {
      const saved = localStorage.getItem(`invoice_edit_cart_${invoiceId}`);
      if (saved) {
        setCartId(parseInt(saved));
      }
    }
  }, [cartId, invoiceId]);

  const [barcodeInput, setBarcodeInput] = useState('');
  const [debouncedBarcodeInput, setDebouncedBarcodeInput] = useState('');
  const [isSearchTyped, setIsSearchTyped] = useState(false);
  const [productSearchSelectedIndex, setProductSearchSelectedIndex] = useState(-1);
  const [strictBarcodeMode, setStrictBarcodeMode] = useState(false); // Default to flexible search for Invoice Edit
  const [barcodeStatus, setBarcodeStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [barcodeMessage, setBarcodeMessage] = useState('');
  const [searchedBarcodeStatus, setSearchedBarcodeStatus] = useState<{
    isUnavailable: boolean;
    tag?: string;
    status?: string;
    message: string;
    barcode: string;
  } | null>(null);

  const barcodeInputRef = useRef<HTMLInputElement | null>(null);

  const [itemQuantities, setItemQuantities] = useState<Record<number, string>>({});
  const [itemPrices, setItemPrices] = useState<Record<number, string>>({});

  // Debounce barcode input for search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedBarcodeInput(barcodeInput);
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [barcodeInput]);

  // Use 'edit-cart' query key to isolate from POS cart cache and avoid cross-contamination
  const editCartQueryKey = ['edit-cart', cartId] as const;
  const { data: cartData, isLoading: cartLoading, error: cartError } = useQuery({
    queryKey: editCartQueryKey,
    queryFn: () => posApi.carts.get(cartId!),
    enabled: !!cartId,
    retry: false,
  });

  // Sync cartId to localStorage to handle refreshes
  useEffect(() => {
    if (cartId) {
      localStorage.setItem(`invoice_edit_cart_${invoiceId}`, cartId.toString());
    }
  }, [cartId, invoiceId]);

  const cart = cartData?.data;
  const items = cart?.items ?? [];

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: number; data: any }) =>
      posApi.carts.updateItem(cartId!, itemId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: editCartQueryKey }),
    onError: (e: any) => alert(e?.response?.data?.error || e?.response?.data?.manual_unit_price?.[0] || 'Update failed'),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: number) => posApi.carts.deleteItem(cartId!, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: editCartQueryKey }),
    onError: (e: any) => alert(e?.response?.data?.error || 'Remove failed'),
  });

  const looksLikeBarcode = (input: string): boolean => {
    if (!input || input.length < 3) return false;
    const barcodePattern = /^[A-Za-z0-9\-_]+$/;
    return barcodePattern.test(input) && (input.length >= 4 || input.includes('-') || input.includes('_'));
  };

  const trimmedBarcodeInput = useMemo(() => debouncedBarcodeInput.trim(), [debouncedBarcodeInput]);

  const { data: _barcodeCheck } = useQuery({
    queryKey: ['barcode-check', trimmedBarcodeInput],
    queryFn: async () => {
      if (!trimmedBarcodeInput || trimmedBarcodeInput.length < 3 || !looksLikeBarcode(trimmedBarcodeInput)) {
        return null;
      }
      try {
        const response = await productsApi.byBarcode(trimmedBarcodeInput, strictBarcodeMode);
        if (response.data) {
          const barcodeTag = response.data.barcode_tag;
          const barcodeAvailable = response.data.barcode_available;

          if (barcodeTag && !barcodeAvailable) {
            const statusMessage = response.data.barcode_status_message ||
              response.data.barcode_status ||
              'This item is not available for sale.';

            setSearchedBarcodeStatus({
              isUnavailable: true,
              tag: barcodeTag,
              status: response.data.barcode_status,
              message: statusMessage,
              barcode: response.data.matched_barcode || trimmedBarcodeInput,
            });
            return { isUnavailable: true, tag: barcodeTag, product: response.data };
          } else {
            setSearchedBarcodeStatus(null);
            return { isUnavailable: false, product: response.data };
          }
        }
      } catch (error: any) {
        setSearchedBarcodeStatus(null);
        return null;
      }
      return null;
    },
    enabled: trimmedBarcodeInput.length >= 3 && looksLikeBarcode(trimmedBarcodeInput),
    retry: false,
    gcTime: 0,
    staleTime: 0,
  });

  const { data: searchResults } = useQuery({
    queryKey: ['products-search', debouncedBarcodeInput],
    queryFn: async () => {
      const response = await productsApi.list({ search: debouncedBarcodeInput });
      return response.data;
    },
    enabled: debouncedBarcodeInput.trim().length >= 2 && !strictBarcodeMode && !searchedBarcodeStatus?.isUnavailable,
    retry: false,
  });

  const addItemMutation = useMutation({
    mutationFn: async (data: any) => {
      // Ensure we have a product field
      if (!data.product && !data.custom_product_name) {
        throw new Error('Product info is required');
      }
      return posApi.carts.addItem(cartId!, data);
    },
    onMutate: () => {
      // Clear barcode input immediately when add starts so user can scan next item right away
      setBarcodeInput('');
      setIsSearchTyped(false);
      setProductSearchSelectedIndex(-1);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: editCartQueryKey });
      setBarcodeStatus('idle');
      setBarcodeMessage('');
    },
    onError: (e: any) => {
      const errorMsg = e?.response?.data?.error || e?.message || 'Add failed';
      alert(errorMsg);
      setBarcodeStatus('error');
      setBarcodeMessage(errorMsg);
    },
  });

  const handleBarcodeScan = async (barcode: string) => {
    const val = barcode.trim();
    if (!val) return;

    setBarcodeStatus('loading');
    setBarcodeMessage('Checking...');

    try {
      const res = await productsApi.byBarcode(val, strictBarcodeMode);
      if (res.data) {
        if (res.data.barcode_available === false) {
          alert(res.data.barcode_status_message || 'Item not available');
          setBarcodeStatus('error');
          return;
        }

        addItemMutation.mutate({
          product: res.data.id,
          quantity: 1,
          unit_price: 0,
          manual_unit_price: res.data.selling_price ?? 0,
          barcode: res.data.matched_barcode || val
        });
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Product not found';
      alert(msg);
      setBarcodeStatus('error');
    }
  };

  const applyMutation = useMutation({
    mutationFn: () => posApi.invoices.updateFromCart(invoiceId, cartId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      navigate(`/invoices/${invoiceId}`);
    },
    onError: (e: any) => alert(e?.response?.data?.error || 'Apply failed'),
  });

  const handleQuantityBlur = (item: any) => {
    const raw = itemQuantities[item.id] ?? item.quantity;
    const qty = Math.max(0, parseFloat(raw) || 0);
    if (qty === 0) {
      if (window.confirm('Remove this line?')) deleteItemMutation.mutate(item.id);
      return;
    }
    if (qty !== parseFloat(item.quantity)) {
      updateItemMutation.mutate({ itemId: item.id, data: { quantity: qty } });
    }
  };

  const handlePriceBlur = (item: any) => {
    const raw = itemPrices[item.id] ?? (item.manual_unit_price ?? item.unit_price) ?? '';
    const price = parseFloat(raw);
    if (isNaN(price)) return;
    const current = parseFloat(item.manual_unit_price ?? item.unit_price ?? 0);
    if (Math.abs(price - current) > 0.001) {
      updateItemMutation.mutate({ itemId: item.id, data: { manual_unit_price: price } });
    }
  };

  if (!cartId) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <ErrorState message="Edit session missing. Start edit from the invoice detail page." onRetry={() => navigate(`/invoices/${invoiceId}`)} />
      </div>
    );
  }

  if (cartLoading || !cart) {
    return <LoadingState message="Loading edit cart..." />;
  }

  if (cartError) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <ErrorState message="Failed to load edit cart" onRetry={() => navigate(`/invoices/${invoiceId}`)} />
      </div>
    );
  }

  const total = items.reduce((sum: number, item: any) => {
    const qty = parseFloat(itemQuantities[item.id] ?? item.quantity) || 0;
    const price = parseFloat(itemPrices[item.id] ?? item.manual_unit_price ?? item.unit_price ?? 0) || 0;
    return sum + qty * price;
  }, 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => navigate(`/invoices/${invoiceId}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <h1 className="text-xl font-bold text-gray-900">Edit invoice</h1>
        </div>
        <Button
          variant="primary"
          onClick={() => applyMutation.mutate()}
          disabled={applyMutation.isPending || items.length === 0}
        >
          <Check className="h-4 w-4 mr-2" />
          {applyMutation.isPending ? 'Applying...' : 'Apply to invoice'}
        </Button>
      </div>

      <Card>
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-2 items-center">
          <span className="text-sm text-gray-600">Cart:</span>
          <span className="font-mono text-sm">{cart.cart_number}</span>
          <span className="text-sm text-gray-500">• Add/change items, then Apply.</span>
        </div>
        <div className="p-4 relative">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none">
                <Search className="h-4 w-4 text-gray-400" />
              </div>
              <Input
                ref={barcodeInputRef}
                placeholder="Search products by name, SKU, or barcode..."
                value={barcodeInput}
                onChange={(e) => {
                  setBarcodeInput(e.target.value);
                  setIsSearchTyped(e.target.value.trim().length > 0);
                  setProductSearchSelectedIndex(-1);
                  if (searchedBarcodeStatus) setSearchedBarcodeStatus(null);
                }}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const inputVal = barcodeInput.trim();
                    if (!inputVal) return;

                    // Clear typed status if it's a barcode
                    if (looksLikeBarcode(inputVal)) {
                      setIsSearchTyped(false);
                    }

                    // If a product is selected in dropdown
                    if (productSearchSelectedIndex >= 0) {
                      const productList = (() => {
                        const list: any[] = [];
                        if (_barcodeCheck?.product && !_barcodeCheck?.isUnavailable) list.push(_barcodeCheck.product);
                        if (searchResults?.results) {
                          const ids = new Set(list.map(p => p.id));
                          list.push(...searchResults.results.filter((p: any) => !ids.has(p.id)));
                        }
                        return list;
                      })();

                      const product = productList[productSearchSelectedIndex];
                      if (product) {
                        addItemMutation.mutate({
                          product: product.id,
                          quantity: 1,
                          unit_price: 0,
                          manual_unit_price: product.selling_price ?? 0,
                          barcode: product.matched_barcode || (looksLikeBarcode(inputVal) ? inputVal : undefined)
                        });
                        return;
                      }
                    }

                    // Flexible handling for Enter key
                    if (looksLikeBarcode(inputVal)) {
                      handleBarcodeScan(inputVal);
                    } else if (inputVal) {
                      // If it's not a barcode but there are search results, pick the first one
                      const firstProduct = _barcodeCheck?.product || (searchResults?.results?.[0]);
                      if (firstProduct) {
                        addItemMutation.mutate({
                          product: firstProduct.id,
                          quantity: 1,
                          unit_price: 0,
                          manual_unit_price: firstProduct.selling_price ?? 0,
                        });
                      }
                    }
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setProductSearchSelectedIndex(prev => prev + 1);
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setProductSearchSelectedIndex(prev => Math.max(-1, prev - 1));
                  } else if (e.key === 'Escape') {
                    setBarcodeInput('');
                    setIsSearchTyped(false);
                    setProductSearchSelectedIndex(-1);
                  }
                }}
                className={`pl-10 pr-12 ${barcodeStatus === 'error' ? 'border-red-500' : ''}`}
              />
              {barcodeMessage && (
                <div className={`absolute top-0 right-12 h-full flex items-center px-2 z-10 pointer-events-none`}>
                  <span className={`text-[10px] font-bold uppercase ${barcodeStatus === 'success' ? 'text-green-600' :
                    barcodeStatus === 'error' ? 'text-red-600' : 'text-blue-600'
                    }`}>
                    {barcodeStatus === 'loading' && <span className="animate-pulse mr-1">...</span>}
                    {barcodeMessage}
                  </span>
                </div>
              )}
              <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10">
                <Button
                  onClick={() => setStrictBarcodeMode(!strictBarcodeMode)}
                  variant="outline"
                  size="sm"
                  className={`h-8 w-8 p-0 ${strictBarcodeMode ? 'bg-blue-600 text-white' : ''}`}
                  title={strictBarcodeMode ? "Strict barcode matching (ON)" : "Flexible search (OFF)"}
                >
                  <Barcode className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Button
              variant="primary"
              onClick={() => {
                const b = barcodeInput.trim();
                if (b) {
                  if (looksLikeBarcode(b)) {
                    handleBarcodeScan(b);
                  } else {
                    const firstProduct = _barcodeCheck?.product || (searchResults?.results?.[0]);
                    if (firstProduct) {
                      addItemMutation.mutate({
                        product: firstProduct.id,
                        quantity: 1,
                        unit_price: 0,
                        manual_unit_price: firstProduct.selling_price ?? 0,
                      });
                    }
                  }
                }
              }}
              disabled={!barcodeInput.trim() || addItemMutation.isPending}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Search Dropdown */}
          {isSearchTyped && !searchedBarcodeStatus?.isUnavailable && (
            <div className="absolute top-full left-4 right-4 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-64 overflow-y-auto">
              {(() => {
                const list: any[] = [];
                if (_barcodeCheck?.product && !_barcodeCheck?.isUnavailable) list.push(_barcodeCheck.product);
                if (searchResults) {
                  const results = Array.isArray(searchResults.results) ? searchResults.results :
                    Array.isArray(searchResults.data) ? searchResults.data :
                      Array.isArray(searchResults) ? searchResults : [];
                  const ids = new Set(list.map(p => p.id));
                  list.push(...results.filter((p: any) => !ids.has(p.id)));
                }

                if (list.length === 0) {
                  return <div className="p-4 text-center text-gray-500 text-sm">No products found</div>;
                }

                return list.map((product: any, index: number) => (
                  <button
                    key={product.id}
                    className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-blue-50 transition-colors border-b last:border-0 ${index === productSearchSelectedIndex ? 'bg-blue-100' : ''}`}
                    onClick={() => {
                      addItemMutation.mutate({
                        product: product.id,
                        quantity: 1,
                        unit_price: 0,
                        manual_unit_price: product.selling_price ?? 0,
                        barcode: product.matched_barcode || (looksLikeBarcode(barcodeInput.trim()) ? barcodeInput.trim() : undefined)
                      });
                    }}
                    onMouseEnter={() => setProductSearchSelectedIndex(index)}
                  >
                    <div className="flex items-center gap-3">
                      <Package className="h-5 w-5 text-blue-500" />
                      <div>
                        <div className="font-medium text-gray-900 text-sm">{product.name}</div>
                        <div className="text-[10px] text-gray-500 font-mono">SKU: {product.sku}</div>
                      </div>
                    </div>
                  </button>
                ));
              })()}
            </div>
          )}

          {/* Error Message for Unavailable Barcode */}
          {searchedBarcodeStatus?.isUnavailable && (
            <div className="absolute top-full left-4 right-4 mt-1 bg-red-50 border border-red-200 rounded-lg p-3 shadow-xl z-50">
              <div className="flex items-start gap-2">
                <XCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium text-red-900">Item Not Available</div>
                  <div className="text-xs text-red-700">{searchedBarcodeStatus.message}</div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <Table headers={['ProductInfo', 'Qty', 'Sell Price', 'Unit Price (₹)', 'Line total', '']}>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                  No items. Scan barcode to add.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item: any) => {
                const qty = parseFloat(itemQuantities[item.id] ?? item.quantity) || 0;
                const price = parseFloat(itemPrices[item.id] ?? item.manual_unit_price ?? item.unit_price ?? 0) || 0;
                const lineTotal = qty * price;
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="min-w-[180px] max-w-[320px]">
                        <p className="font-medium text-gray-900">{item.product_name}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {item.scanned_barcodes && item.scanned_barcodes.length > 0 ? (
                            <span className="text-[10px] text-gray-500 font-mono bg-gray-50 px-1.5 py-0.5 border border-gray-100 rounded break-all">
                              BC: {item.scanned_barcodes.join(', ')}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-400 font-mono italic">No barcode</span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={itemQuantities[item.id] ?? item.quantity}
                        onChange={(e) => setItemQuantities((p) => ({ ...p, [item.id]: e.target.value }))}
                        onBlur={() => handleQuantityBlur(item)}
                        className="w-16"
                      />
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-semibold text-blue-600">₹{formatNumber(item.product_selling_price || item.product_purchase_price)}</span>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={itemPrices[item.id] ?? (item.manual_unit_price ?? item.unit_price) ?? ''}
                        onChange={(e) => setItemPrices((p) => ({ ...p, [item.id]: e.target.value }))}
                        onFocus={() => setItemPrices((p) => ({ ...p, [item.id]: '' }))}
                        onBlur={() => handlePriceBlur(item)}
                        className="w-28"
                      />
                    </TableCell>
                    <TableCell className="font-medium">₹{formatNumber(lineTotal)}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.confirm('Remove line?') && deleteItemMutation.mutate(item.id)}
                        disabled={deleteItemMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </Table>
        </div>
        {items.length > 0 && (
          <div className="p-4 border-t border-gray-100 flex justify-end">
            <span className="text-lg font-bold text-gray-900">Total: ₹{formatNumber(total)}</span>
          </div>
        )}
      </Card>
    </div>
  );
}
