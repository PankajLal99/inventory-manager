import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { posApi, productsApi } from '../../lib/api';
import { formatNumber } from '../../lib/utils';
import { getPriceValidationError } from '../pos/priceValidation';
import { parseBarcodesFromInput, looksLikeBarcode } from '../../lib/scanningQueue';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import Input from '../../components/ui/Input';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import Modal from '../../components/ui/Modal';
import { ArrowLeft, Trash2, Plus, Check, Barcode, Search, Package, XCircle, CheckCircle, Sparkles } from 'lucide-react';

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
  const isTypingInPriceInput = useRef(false);
  const cartIdRef = useRef<number | undefined>(cartId);
  cartIdRef.current = cartId;

  // Scanning queue (same as POS): rapid scans or paste go to queue, processed one-by-one
  interface QueueItem {
    id: string;
    code: string;
    status: 'pending' | 'processing' | 'success' | 'error';
    message?: string;
    timestamp: number;
  }
  const [scanQueue, setScanQueue] = useState<QueueItem[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);

  const addToQueue = useCallback((barcodes: string[]) => {
    const newItems: QueueItem[] = barcodes
      .filter(code => code.trim().length > 0)
      .map(code => ({
        id: Math.random().toString(36).substring(7),
        code: code.trim(),
        status: 'pending',
        timestamp: Date.now()
      }));
    setScanQueue(prev => [...prev, ...newItems]);
  }, []);

  // Clear queue items that are done (success/error) after delay
  useEffect(() => {
    const interval = setInterval(() => {
      setScanQueue(prev => {
        const now = Date.now();
        return prev.filter(item =>
          item.status === 'pending' ||
          item.status === 'processing' ||
          (now - item.timestamp < 5000)
        );
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const [itemQuantities, setItemQuantities] = useState<Record<number, string>>({});
  const [itemPrices, setItemPrices] = useState<Record<number, string>>({});
  const [editingPurchasePrice, setEditingPurchasePrice] = useState<Record<number, string>>({});
  const [priceErrors, setPriceErrors] = useState<Record<number, string>>({});
  const [showCustomProductModal, setShowCustomProductModal] = useState(false);
  const [customProductName, setCustomProductName] = useState('');

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
    onSuccess: (_res, variables) => {
      queryClient.invalidateQueries({ queryKey: editCartQueryKey });
      if (variables.data.purchase_price !== undefined) {
        setEditingPurchasePrice((p) => {
          const next = { ...p };
          delete next[variables.itemId];
          return next;
        });
      }
    },
    onError: (e: any) => alert(e?.response?.data?.error || e?.response?.data?.manual_unit_price?.[0] || 'Update failed'),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: number) => posApi.carts.deleteItem(cartId!, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: editCartQueryKey }),
    onError: (e: any) => alert(e?.response?.data?.error || 'Remove failed'),
  });

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

  // Dedicated mutation for queue processing (no alert on error; errors shown in queue UI)
  const processQueueItemMutation = useMutation({
    mutationFn: (data: any) => posApi.carts.addItem(cartId!, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: editCartQueryKey }),
  });

  // Process scanning queue one-by-one (same as POS)
  useEffect(() => {
    if (!cartId) return;

    const processNextItem = async () => {
      if (isProcessingQueue) return;

      const nextItem = scanQueue.find(item => item.status === 'pending');
      if (!nextItem) return;

      setIsProcessingQueue(true);
      setScanQueue(prev => prev.map(item =>
        item.id === nextItem.id ? { ...item, status: 'processing' } : item
      ));

      const barcodeToScan = nextItem.code;
      const currentCartData = queryClient.getQueryData(editCartQueryKey) as any;
      const currentItems = currentCartData?.data?.items ?? currentCartData?.items ?? [];

      const isAlreadyProcessedInQueue = scanQueue.some(item =>
        item.id !== nextItem.id &&
        item.code === barcodeToScan &&
        (item.status === 'success' || item.status === 'processing')
      );
      if (isAlreadyProcessedInQueue) {
        setScanQueue(prev => prev.map(item =>
          item.id === nextItem.id ? { ...item, status: 'error', message: 'Duplicate scan' } : item
        ));
        setIsProcessingQueue(false);
        return;
      }

      try {
        let alreadyInCart = false;
        for (const item of currentItems) {
          const scannedBarcodes = item.scanned_barcodes || [];
          if (scannedBarcodes.some((bc: string) => bc && typeof bc === 'string' && bc.trim() === barcodeToScan)) {
            alreadyInCart = true;
            break;
          }
          if (item.barcode === barcodeToScan) {
            alreadyInCart = true;
            break;
          }
        }
        if (alreadyInCart) {
          setScanQueue(prev => prev.map(item =>
            item.id === nextItem.id ? { ...item, status: 'success', message: 'Already in cart' } : item
          ));
          setIsProcessingQueue(false);
          return;
        }

        const barcodeCheck = await productsApi.byBarcode(barcodeToScan, strictBarcodeMode, true);
        if (!barcodeCheck.data) {
          setScanQueue(prev => prev.map(item =>
            item.id === nextItem.id ? { ...item, status: 'error', message: 'Product not found' } : item
          ));
          setIsProcessingQueue(false);
          return;
        }
        if (barcodeCheck.data.barcode_available === false) {
          const errorMsg = barcodeCheck.data.sold_invoice
            ? `Sold (Inv #${barcodeCheck.data.sold_invoice})`
            : 'Sold / Unavailable';
          setScanQueue(prev => prev.map(item =>
            item.id === nextItem.id ? { ...item, status: 'error', message: errorMsg } : item
          ));
          setIsProcessingQueue(false);
          return;
        }

        const productData = barcodeCheck.data;
        const scannedBarcode = (productData as any).canonical_barcode ?? productData.matched_barcode ?? barcodeToScan;

        await processQueueItemMutation.mutateAsync({
          product: productData.id,
          quantity: 1,
          unit_price: 0,
          manual_unit_price: productData.selling_price ?? 0,
          barcode: scannedBarcode
        });

        const msg = (productData as any).message || 'Added';
        setScanQueue(prev => prev.map(item =>
          item.id === nextItem.id ? { ...item, status: 'success', message: msg } : item
        ));
        // Await refetch so next queue item sees updated cart (consistent with POS)
        await queryClient.refetchQueries({ queryKey: editCartQueryKey });
      } catch (error: any) {
        const errorMsg = error?.response?.data?.error || error?.response?.data?.message || error?.message || 'Failed';
        const isAlreadyInCartError =
          errorMsg?.includes?.('already in another cart') || errorMsg?.includes?.('already been scanned');
        if (isAlreadyInCartError && cartId) {
          try {
            await queryClient.refetchQueries({ queryKey: editCartQueryKey });
            const freshCart = await queryClient.fetchQuery({ queryKey: editCartQueryKey }) as any;
            const freshItems = freshCart?.data?.items ?? freshCart?.items ?? [];
            const isInCurrentCart = freshItems.some(
              (item: any) =>
                (item.scanned_barcodes || []).some((x: string) => x && String(x).trim() === String(barcodeToScan).trim())
            );
            if (isInCurrentCart) {
              setScanQueue(prev => prev.map(item =>
                item.id === nextItem.id ? { ...item, status: 'success', message: 'Already in cart' } : item
              ));
              await queryClient.refetchQueries({ queryKey: editCartQueryKey });
              setIsProcessingQueue(false);
              return;
            }
          } catch (_e) {
            // refetch failed, fall through to show error
          }
        }
        setScanQueue(prev => prev.map(item =>
          item.id === nextItem.id ? { ...item, status: 'error', message: errorMsg } : item
        ));
      } finally {
        setIsProcessingQueue(false);
      }
    };

    processNextItem();
  }, [scanQueue, isProcessingQueue, cartId, queryClient, strictBarcodeMode, editCartQueryKey]);

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
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: editCartQueryKey });
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['pos/carts/overview'] });
      queryClient.invalidateQueries({ queryKey: ['pos/carts'] });
      localStorage.removeItem(`invoice_edit_cart_${invoiceId}`);
      setCartId(undefined);
      navigate(`/invoices/${invoiceId}`);
      // Backend deletes the cart in updateFromCart; clearing local state and cache above ensures no stale cart remains.
    },
    onError: (e: any) => alert(e?.response?.data?.error || 'Apply failed'),
  });

  const handleBack = useCallback(() => {
    const cid = cartIdRef.current;
    if (cid) {
      posApi.carts.delete(cid).then(() => {
        queryClient.invalidateQueries({ queryKey: ['pos/carts/overview'] });
        queryClient.invalidateQueries({ queryKey: ['pos/carts'] });
      }).catch(() => {});
      queryClient.removeQueries({ queryKey: ['edit-cart', cid] });
      localStorage.removeItem(`invoice_edit_cart_${invoiceId}`);
    }
    setCartId(undefined);
    navigate(`/invoices/${invoiceId}`);
  }, [invoiceId, navigate, queryClient]);

  const handleApply = () => {
    const customItemsMissingPP = items.filter((item: any) => {
      if (!item.product_name?.startsWith('Other -')) return false;
      const qty = parseFloat(itemQuantities[item.id] ?? item.quantity) || 0;
      if (qty <= 0) return false;
      const inlineVal = editingPurchasePrice[item.id];
      const purchaseVal = inlineVal !== undefined && inlineVal !== ''
        ? parseFloat(inlineVal)
        : (item.product_purchase_price != null ? parseFloat(String(item.product_purchase_price)) : item.purchase_price != null ? parseFloat(String(item.purchase_price)) : NaN);
      return Number.isNaN(purchaseVal) || purchaseVal <= 0;
    });
    if (customItemsMissingPP.length > 0) {
      const names = customItemsMissingPP.map((i: any) => i.product_name || 'Custom Product').join(', ');
      alert(`Purchase price (cost) is required and must be greater than 0 for: ${names}`);
      return;
    }
    applyMutation.mutate();
  };

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

  const invoiceType = (cart as any)?.invoice_type ?? 'cash';

  const getEffectivePurchaseForValidation = (item: any) => {
    if (item.product_name?.startsWith('Other -')) {
        const inline = editingPurchasePrice[item.id];
        if (inline !== undefined && inline !== '' && !Number.isNaN(parseFloat(inline))) return parseFloat(inline);
      }
    const fromApi = item.product_purchase_price ?? item.purchase_price;
    return parseFloat(fromApi || '0');
  };

  const handlePriceBlur = (item: any) => {
    const raw = itemPrices[item.id] ?? (item.manual_unit_price ?? item.unit_price) ?? '';
    const price = parseFloat(raw);
    if (isNaN(price)) return;
    if (priceErrors[item.id]) return; // Don't save if validation error
    const effectivePurchase = getEffectivePurchaseForValidation(item);
    const itemForValidation = { ...item, product_purchase_price: effectivePurchase };
    const err = getPriceValidationError(price, itemForValidation, invoiceType);
    if (err) {
      setPriceErrors((p) => ({ ...p, [item.id]: err }));
      return;
    }
    setPriceErrors((p) => {
      const next = { ...p };
      delete next[item.id];
      return next;
    });
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
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <h1 className="text-xl font-bold text-gray-900">Edit invoice</h1>
        </div>
        <Button
          variant="primary"
          onClick={handleApply}
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
          {/* Scanning Queue display (same as POS) */}
          {scanQueue.length > 0 && (
            <div className="absolute z-50 left-4 right-4 mb-1 bottom-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-40 overflow-y-auto mb-2">
              <div className="p-2 border-b border-gray-100 bg-gray-50 flex justify-between items-center sticky top-0 z-10">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Scanning Queue</h4>
                <button type="button" onClick={() => setScanQueue([])} className="text-xs text-blue-600 hover:text-blue-800">Clear</button>
              </div>
              <div className="divide-y divide-gray-100">
                {[...scanQueue].reverse().map(item => (
                  <div key={item.id} className="p-2 flex items-center justify-between text-sm hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      {item.status === 'pending' && <span className="w-2 h-2 rounded-full bg-gray-400 animate-pulse" />}
                      {item.status === 'processing' && <Sparkles className="h-4 w-4 text-blue-500 animate-spin" />}
                      {item.status === 'success' && <CheckCircle className="h-4 w-4 text-green-500" />}
                      {item.status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                      <div className="flex flex-col">
                        <span className={`font-mono font-medium ${item.status === 'success' ? 'text-gray-900' : 'text-gray-600'}`}>
                          {item.code}
                        </span>
                        {item.message && (
                          <span className={`text-xs ${item.status === 'error' ? 'text-red-500' : item.status === 'success' ? 'text-green-600' : 'text-gray-400'}`}>
                            {item.message}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                  // Read from DOM on Enter so rapid scanner input isn't lost (same as POS)
                  const inputElement = e.currentTarget as HTMLInputElement;
                  const inputVal = (e.key === 'Enter' ? (inputElement.value || '').trim() : barcodeInput.trim());
                  const searchLower = inputVal.toLowerCase();
                  const showCustomOption = searchLower === 'other' || searchLower === 'custom' || searchLower.startsWith('other ') || searchLower.startsWith('custom ');

                  const productList = (() => {
                    const list: any[] = [];
                    if (_barcodeCheck?.product && !_barcodeCheck?.isUnavailable) list.push(_barcodeCheck.product);
                    if (searchResults?.results) {
                      const ids = new Set(list.map(p => p.id));
                      list.push(...searchResults.results.filter((p: any) => !ids.has(p.id)));
                    }
                    return list;
                  })();
                  const totalOptions = (showCustomOption ? 1 : 0) + productList.length;

                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (!inputVal) return;

                    if (showCustomOption && productSearchSelectedIndex === 0) {
                      setShowCustomProductModal(true);
                      setBarcodeInput('');
                      setProductSearchSelectedIndex(-1);
                      setIsSearchTyped(false);
                      return;
                    }

                    if (looksLikeBarcode(inputVal)) {
                      setIsSearchTyped(false);
                    }

                    if (productSearchSelectedIndex >= 0) {
                      const idx = showCustomOption ? productSearchSelectedIndex - 1 : productSearchSelectedIndex;
                      const product = productList[idx];
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

                    // Queue path for barcode(s): rapid scan or paste (same as POS)
                    if (looksLikeBarcode(inputVal)) {
                      const barcodes = parseBarcodesFromInput(inputVal);
                      if (barcodes.length > 0) {
                        addToQueue(barcodes);
                        setBarcodeInput('');
                        setIsSearchTyped(false);
                        setProductSearchSelectedIndex(-1);
                        if (!isTypingInPriceInput.current) {
                          barcodeInputRef.current?.focus();
                        }
                      }
                      return;
                    }

                    if (inputVal) {
                      // When multiple options exist, require explicit selection to avoid adding wrong product
                      if (productList.length > 1 && productSearchSelectedIndex < 0) {
                        return;
                      }
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
                    if (totalOptions > 0) setProductSearchSelectedIndex(prev => Math.min(prev + 1, totalOptions - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (productSearchSelectedIndex > 0) setProductSearchSelectedIndex(prev => prev - 1);
                    else setProductSearchSelectedIndex(-1);
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
                if (!b) return;
                const lower = b.toLowerCase();
                const isCustomSearch = lower === 'other' || lower === 'custom' || lower.startsWith('other ') || lower.startsWith('custom ');
                if (isCustomSearch) {
                  setShowCustomProductModal(true);
                  setBarcodeInput('');
                  setIsSearchTyped(false);
                  setProductSearchSelectedIndex(-1);
                  return;
                }
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
              }}
              disabled={!barcodeInput.trim() || addItemMutation.isPending}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Search Dropdown */}
          {(() => {
            const searchLower = barcodeInput.trim().toLowerCase();
            const showCustomOption = searchLower === 'other' || searchLower === 'custom' || searchLower.startsWith('other ') || searchLower.startsWith('custom ');
            if (!isSearchTyped || searchedBarcodeStatus?.isUnavailable) return null;
            if (!showCustomOption && !_barcodeCheck?.product && !searchResults) return null;

            const list: any[] = [];
            if (_barcodeCheck?.product && !_barcodeCheck?.isUnavailable) list.push(_barcodeCheck.product);
            if (searchResults) {
              const results = Array.isArray(searchResults.results) ? searchResults.results :
                Array.isArray(searchResults.data) ? searchResults.data :
                  Array.isArray(searchResults) ? searchResults : [];
              const ids = new Set(list.map(p => p.id));
              list.push(...results.filter((p: any) => !ids.has(p.id)));
            }

            if (list.length === 0 && !showCustomOption) {
              return (
                <div className="absolute top-full left-4 right-4 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50">
                  <div className="p-4 text-center text-gray-500 text-sm">No products found</div>
                </div>
              );
            }

            return (
              <div className="absolute top-full left-4 right-4 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-64 overflow-y-auto">
                {showCustomOption && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomProductModal(true);
                      setBarcodeInput('');
                      setProductSearchSelectedIndex(-1);
                      setIsSearchTyped(false);
                    }}
                    onMouseEnter={() => setProductSearchSelectedIndex(0)}
                    className={`w-full text-left px-4 py-3 transition-colors border-b border-gray-100 ${productSearchSelectedIndex === 0 ? 'bg-blue-100 border-l-2 border-l-blue-500' : 'hover:bg-blue-50'}`}
                  >
                    <div className="flex items-center gap-3">
                      <Package className="h-5 w-5 text-blue-600" />
                      <div>
                        <div className="font-medium text-gray-900 text-sm">Add Custom Product (Other)</div>
                        <div className="text-[10px] text-gray-500">Enter a product name not in inventory</div>
                      </div>
                    </div>
                  </button>
                )}
                {list.map((product: any, index: number) => {
                  const adjustedIndex = showCustomOption ? index + 1 : index;
                  const isSelected = adjustedIndex === productSearchSelectedIndex;
                  return (
                    <button
                      key={product.id}
                      className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-blue-50 transition-colors border-b last:border-0 ${isSelected ? 'bg-blue-100 border-l-2 border-l-blue-500' : ''}`}
                      onClick={() => {
                        addItemMutation.mutate({
                          product: product.id,
                          quantity: 1,
                          unit_price: 0,
                          manual_unit_price: product.selling_price ?? 0,
                          barcode: product.matched_barcode || (looksLikeBarcode(barcodeInput.trim()) ? barcodeInput.trim() : undefined)
                        });
                      }}
                      onMouseEnter={() => setProductSearchSelectedIndex(adjustedIndex)}
                    >
                      <div className="flex items-center gap-3">
                        <Package className="h-5 w-5 text-blue-500" />
                        <div>
                          <div className="font-medium text-gray-900 text-sm">{product.name}</div>
                          <div className="text-[10px] text-gray-500 font-mono">SKU: {product.sku}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })()}

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
          <Table headers={['ProductInfo', 'Qty', 'Ref Price', 'Cost (₹)', 'Unit Price (₹)', 'Line total', '']}>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                  No items. Scan barcode to add.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item: any) => {
                const qty = parseFloat(itemQuantities[item.id] ?? item.quantity) || 0;
                const price = parseFloat(itemPrices[item.id] ?? item.manual_unit_price ?? item.unit_price ?? 0) || 0;
                const lineTotal = qty * price;
                const isCustom = item.product_name?.startsWith('Other -');
                const rawPurchaseFromApi = (item.product_purchase_price != null ? parseFloat(String(item.product_purchase_price)) : item.purchase_price != null ? parseFloat(String(item.purchase_price)) : NaN);
                const showCostInput = isCustom; // Only custom products get editable cost; others show ref or —
                const purchaseInputValue = editingPurchasePrice[item.id] ?? (rawPurchaseFromApi > 0 ? String(rawPurchaseFromApi) : '');
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="min-w-[180px] max-w-[320px]">
                        <p className="font-medium text-gray-900">{item.product_name}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {item.scanned_barcodes_display && item.scanned_barcodes_display.length > 0 ? (
                            <span className="text-[10px] text-gray-500 font-mono bg-gray-50 px-1.5 py-0.5 border border-gray-100 rounded break-all">
                              SKU: {item.scanned_barcodes_display.join(', ')}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-400 font-mono italic">No SKU</span>
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
                        onFocus={() => { isTypingInPriceInput.current = true; }}
                        onBlur={() => { isTypingInPriceInput.current = false; handleQuantityBlur(item); }}
                        className="w-16"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {item.product_selling_price != null && parseFloat(String(item.product_selling_price)) > 0 && (
                          <span className="text-sm font-semibold text-blue-600">Sell: ₹{formatNumber(item.product_selling_price)}</span>
                        )}
                        {(item.product_purchase_price != null || item.purchase_price != null) && (
                          <span className="text-xs text-gray-600">Cost: ₹{formatNumber(item.product_purchase_price ?? item.purchase_price ?? 0)}</span>
                        )}
                        {(!item.product_selling_price || parseFloat(String(item.product_selling_price)) <= 0) && item.product_purchase_price == null && item.purchase_price == null && (
                          <span className="text-sm font-semibold text-blue-600">₹0</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {showCostInput ? (
                        <div className="flex items-center gap-1 w-24">
                          <span className="text-xs text-gray-500">₹</span>
                          <Input
                            type="number"
                            min={0}
                            step={0.01}
                            placeholder="0"
                            value={purchaseInputValue}
                            onChange={(e) => setEditingPurchasePrice((p) => ({ ...p, [item.id]: e.target.value }))}
                            onFocus={() => { isTypingInPriceInput.current = true; }}
                            onBlur={() => {
                              isTypingInPriceInput.current = false;
                              const raw = editingPurchasePrice[item.id] ?? purchaseInputValue;
                              const num = parseFloat(raw);
                              if (raw === '' || raw === undefined) {
                                setEditingPurchasePrice((p) => ({ ...p, [item.id]: '' }));
                                return;
                              }
                              if (!Number.isNaN(num) && num >= 0) {
                                updateItemMutation.mutate({
                                  itemId: item.id,
                                  data: {
                                    purchase_price: num > 0 ? num : null,
                                    ...(isCustom && num > 0 ? { unit_price: num } : {}),
                                  },
                                });
                              }
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                            className="w-20 text-sm"
                          />
                        </div>
                      ) : (
                        <span className="text-sm text-gray-600">{!Number.isNaN(rawPurchaseFromApi) && rawPurchaseFromApi > 0 ? `₹${formatNumber(rawPurchaseFromApi)}` : '—'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={itemPrices[item.id] ?? (item.manual_unit_price ?? item.unit_price) ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setItemPrices((p) => ({ ...p, [item.id]: v }));
                            const priceNum = parseFloat(v);
                            if (v !== '' && !Number.isNaN(priceNum) && priceNum > 0 && invoiceType !== 'pending') {
                              const effectivePurchase = getEffectivePurchaseForValidation(item);
                              const itemForVal = { ...item, product_purchase_price: effectivePurchase };
                              const err = getPriceValidationError(priceNum, itemForVal, invoiceType);
                              if (err) setPriceErrors((p) => ({ ...p, [item.id]: err }));
                              else setPriceErrors((p) => { const n = { ...p }; delete n[item.id]; return n; });
                            } else {
                              setPriceErrors((p) => { const n = { ...p }; delete n[item.id]; return n; });
                            }
                          }}
                          onFocus={() => { isTypingInPriceInput.current = true; setItemPrices((p) => ({ ...p, [item.id]: itemPrices[item.id] ?? (item.manual_unit_price ?? item.unit_price) ?? '' })); }}
                          onBlur={() => { isTypingInPriceInput.current = false; handlePriceBlur(item); }}
                          className={`w-28 ${priceErrors[item.id] ? 'border-red-500' : ''}`}
                        />
                        {priceErrors[item.id] && <div className="text-xs text-red-600 mt-0.5">{priceErrors[item.id]}</div>}
                      </div>
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

      {/* Custom Product Modal */}
      <Modal
        isOpen={showCustomProductModal}
        onClose={() => {
          setShowCustomProductModal(false);
          setCustomProductName('');
        }}
        title="Add Custom Product"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Product Name <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              placeholder="Enter product name"
              value={customProductName}
              onChange={(e) => setCustomProductName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customProductName.trim()) {
                  addItemMutation.mutate(
                    { custom_product_name: customProductName.trim(), quantity: 1, unit_price: 0 },
                    { onSuccess: () => { setShowCustomProductModal(false); setCustomProductName(''); } }
                  );
                }
              }}
            />
            <p className="mt-1 text-xs text-gray-500">
              Saved as &quot;Other - {customProductName || '[name]'}&quot;. Enter cost (purchase price) in the cart row after adding.
            </p>
          </div>
          <div className="flex gap-3 pt-2">
            <Button
              onClick={() => {
                if (!customProductName.trim()) {
                  alert('Product name is required');
                  return;
                }
                addItemMutation.mutate(
                  { custom_product_name: customProductName.trim(), quantity: 1, unit_price: 0 },
                  { onSuccess: () => { setShowCustomProductModal(false); setCustomProductName(''); } }
                );
              }}
              disabled={addItemMutation.isPending || !customProductName.trim()}
              className="flex-1"
            >
              {addItemMutation.isPending ? 'Adding...' : 'Add to Cart'}
            </Button>
            <Button
              variant="outline"
              onClick={() => { setShowCustomProductModal(false); setCustomProductName(''); }}
              disabled={addItemMutation.isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
