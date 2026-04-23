import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Camera, CameraOff } from 'lucide-react';
import Button from '../../components/ui/Button';
import BarcodeScanner from '../../components/BarcodeScanner';
import { publicCheckoutApi, type PublicCheckoutProduct, type PublicCheckoutStore } from '../../lib/api';

type CartRow = {
  product: PublicCheckoutProduct;
  quantity: number;
};

type SubmitResult = {
  invoice_id: number;
  invoice_number: string;
};

export default function SelfCheckout() {
  const [searchParams] = useSearchParams();
  const retailerCode = useMemo(() => {
    const raw = searchParams.get('retailer') || searchParams.get('code') || '';
    return raw.trim().toLowerCase();
  }, [searchParams]);

  const storeIdFromUrl = useMemo(() => {
    const raw = searchParams.get('store');
    return raw ? Number(raw) : null;
  }, [searchParams]);

  const [loadingStores, setLoadingStores] = useState(false);
  const [stores, setStores] = useState<PublicCheckoutStore[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [retailerName, setRetailerName] = useState('');

  const [showScanner, setShowScanner] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [scanError, setScanError] = useState('');

  const [cart, setCart] = useState<Record<number, CartRow>>({});
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState<SubmitResult | null>(null);
  
  const [sessionTimeLeft, setSessionTimeLeft] = useState<number>(300); // 5 minutes in seconds
  const [isTimeoutWarning, setIsTimeoutWarning] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [pendingInvoiceId, setPendingInvoiceId] = useState<number | null>(null);
  const SESSION_STORAGE_KEY = 'selfcheckout_cart';
  const SESSION_START_KEY = 'selfcheckout_start_time';
  const INVOICE_ID_KEY = 'selfcheckout_invoice_id';
  const ACTIVE_TABS_KEY = 'selfcheckout_active_tabs';
  const TAB_ID_KEY = 'selfcheckout_tab_id';
  const SESSION_DURATION_MS = 5 * 60 * 1000; // 5 minutes
  const TAB_HEARTBEAT_MS = 10000;
  const TAB_STALE_MS = 30000;
  const pendingInvoiceIdRef = useRef<number | null>(null);
  const retailerCodeRef = useRef<string>(retailerCode);

  useEffect(() => {
    pendingInvoiceIdRef.current = pendingInvoiceId;
  }, [pendingInvoiceId]);

  useEffect(() => {
    retailerCodeRef.current = retailerCode;
  }, [retailerCode]);

  useEffect(() => {
    if (!retailerCode) {
      setStores([]);
      setRetailerName('');
      setSelectedStoreId(null);
      return;
    }

    setLoadingStores(true);
    publicCheckoutApi
      .stores(retailerCode)
      .then((response) => {
        const payload = response.data;
        setStores(payload.stores || []);
        setRetailerName(payload.retailer?.name || '');
        
        // Auto-select store from URL param if provided
        if (storeIdFromUrl) {
          const storeExists = (payload.stores || []).some(s => s.id === storeIdFromUrl);
          if (storeExists) {
            setSelectedStoreId(storeIdFromUrl);
          }
        } else if ((payload.stores || []).length === 1) {
          // Only auto-select if exactly one store and no URL param
          setSelectedStoreId(payload.stores[0].id);
        }
      })
      .catch(() => {
        setStores([]);
        setRetailerName('');
      })
      .finally(() => setLoadingStores(false));
  }, [retailerCode, storeIdFromUrl]);

  // Initialize cart from localStorage and check session validity
  useEffect(() => {
    const savedCart = localStorage.getItem(SESSION_STORAGE_KEY);
    const savedStartTime = localStorage.getItem(SESSION_START_KEY);
    const savedInvoiceId = localStorage.getItem(INVOICE_ID_KEY);

    if (savedCart && savedStartTime) {
      const startTime = Number(savedStartTime);
      const now = Date.now();
      const elapsedMs = now - startTime;

      if (elapsedMs < SESSION_DURATION_MS) {
        // Session is still valid - load cart
        try {
          const parsedCart = JSON.parse(savedCart);
          setCart(parsedCart);
          setSessionStartTime(startTime);
          if (savedInvoiceId) {
            setPendingInvoiceId(Number(savedInvoiceId));
          }
          const remainingMs = SESSION_DURATION_MS - elapsedMs;
          setSessionTimeLeft(Math.ceil(remainingMs / 1000));
        } catch (e) {
          // Invalid JSON, ignore
          localStorage.removeItem(SESSION_STORAGE_KEY);
          localStorage.removeItem(SESSION_START_KEY);
          localStorage.removeItem(INVOICE_ID_KEY);
        }
      } else {
        // Session expired - auto-discard pending invoice if exists
        if (savedInvoiceId && retailerCode) {
          publicCheckoutApi.discardPending(retailerCode, Number(savedInvoiceId)).catch(() => {
            // Silently continue if discard fails
          });
        }
        localStorage.removeItem(SESSION_STORAGE_KEY);
        localStorage.removeItem(SESSION_START_KEY);
        localStorage.removeItem(INVOICE_ID_KEY);
        setCart({});
      }
    } else if (savedCart || savedStartTime) {
      // Partial data, clean up
      localStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(SESSION_START_KEY);
      localStorage.removeItem(INVOICE_ID_KEY);
    }

    // Listen for storage changes from other tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === SESSION_STORAGE_KEY) {
        if (e.newValue === null) {
          // Cart was cleared in another tab
          setCart({});
        } else {
          try {
            const newCart = JSON.parse(e.newValue);
            setCart(newCart);
          } catch (e) {
            // Invalid JSON
          }
        }
      }
      if (e.key === SESSION_START_KEY && e.newValue === null) {
        // Session was cleared in another tab
        setCart({});
      }
      if (e.key === INVOICE_ID_KEY) {
        if (e.newValue === null) {
          setPendingInvoiceId(null);
        } else {
          const parsed = Number(e.newValue);
          setPendingInvoiceId(Number.isFinite(parsed) ? parsed : null);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Track active tabs and discard pending invoice only when the last tab is closed.
  useEffect(() => {
    const getTabId = () => {
      const existing = sessionStorage.getItem(TAB_ID_KEY);
      if (existing) return existing;
      const generated = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(TAB_ID_KEY, generated);
      return generated;
    };

    const readTabs = (): Record<string, number> => {
      const raw = localStorage.getItem(ACTIVE_TABS_KEY);
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (_error) {
        return {};
      }
    };

    const pruneStaleTabs = (tabs: Record<string, number>) => {
      const now = Date.now();
      const cleaned: Record<string, number> = {};
      Object.entries(tabs).forEach(([id, lastSeen]) => {
        if (typeof lastSeen === 'number' && now - lastSeen <= TAB_STALE_MS) {
          cleaned[id] = lastSeen;
        }
      });
      return cleaned;
    };

    const writeTabs = (tabs: Record<string, number>) => {
      try {
        localStorage.setItem(ACTIVE_TABS_KEY, JSON.stringify(tabs));
      } catch (_error) {
        // Ignore storage write failures.
      }
    };

    const tabId = getTabId();

    const upsertSelfHeartbeat = () => {
      const tabs = pruneStaleTabs(readTabs());
      tabs[tabId] = Date.now();
      writeTabs(tabs);
    };

    const unregisterSelf = () => {
      const tabs = pruneStaleTabs(readTabs());
      delete tabs[tabId];
      writeTabs(tabs);
      return Object.keys(tabs).length;
    };

    const discardIfLastTab = () => {
      const remainingTabCount = unregisterSelf();
      const invoiceId = pendingInvoiceIdRef.current;
      const code = retailerCodeRef.current;

      if (remainingTabCount === 0 && invoiceId && code) {
        publicCheckoutApi.discardPendingKeepalive(code, invoiceId);
        localStorage.removeItem(SESSION_STORAGE_KEY);
        localStorage.removeItem(SESSION_START_KEY);
        localStorage.removeItem(INVOICE_ID_KEY);
        setPendingInvoiceId(null);
      }
    };

    upsertSelfHeartbeat();
    const heartbeatInterval = window.setInterval(upsertSelfHeartbeat, TAB_HEARTBEAT_MS);
    window.addEventListener('pagehide', discardIfLastTab);

    return () => {
      window.clearInterval(heartbeatInterval);
      window.removeEventListener('pagehide', discardIfLastTab);
      unregisterSelf();
    };
  }, [ACTIVE_TABS_KEY, INVOICE_ID_KEY, SESSION_START_KEY, SESSION_STORAGE_KEY, TAB_HEARTBEAT_MS, TAB_ID_KEY, TAB_STALE_MS]);

  // Session timeout timer: auto-clear cart after 5 minutes of inactivity + localStorage sync
  useEffect(() => {
    const cartIsEmpty = Object.keys(cart).length === 0;
    
    if (cartIsEmpty) {
      setSessionTimeLeft(300); // Reset timer when cart is empty
      setIsTimeoutWarning(false);
      // Clear localStorage when cart becomes empty
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }

    // Save cart to localStorage whenever it changes
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(cart));
    } catch (e) {
      // localStorage might be full, silently continue
      console.warn('Failed to save cart to localStorage');
    }

    // Initialize session start time if not already set
    if (!sessionStartTime) {
      const now = Date.now();
      setSessionStartTime(now);
      try {
        localStorage.setItem(SESSION_START_KEY, String(now));
      } catch (e) {
        console.warn('Failed to save session start time');
      }
    }

    // Start countdown only if cart has items
    const interval = setInterval(() => {
      setSessionTimeLeft((prev) => {
        const newTime = prev - 1;
        
        // Update warning status (show warning when < 60 seconds)
        setIsTimeoutWarning(newTime < 60 && newTime > 0);
        
        // Auto-clear cart when time expires
        if (newTime <= 0) {
          // Auto-discard pending invoice if exists
          if (pendingInvoiceId && retailerCode) {
            publicCheckoutApi.discardPending(retailerCode, pendingInvoiceId).catch(() => {
              // Silently continue if discard fails
            });
          }
          setCart({});
          setSessionTimeLeft(300); // Reset timer
          localStorage.removeItem(SESSION_STORAGE_KEY);
          localStorage.removeItem(SESSION_START_KEY);
          localStorage.removeItem(INVOICE_ID_KEY);
          setPendingInvoiceId(null);
          setSessionStartTime(null);
          return 300;
        }
        
        return newTime;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [cart, sessionStartTime, pendingInvoiceId, retailerCode]);

  const cartRows = useMemo(() => Object.values(cart), [cart]);

  const subtotal = useMemo(() => {
    return cartRows.reduce((sum, row) => {
      const price = Number.parseFloat(row.product.selling_price || '0');
      return sum + price * row.quantity;
    }, 0);
  }, [cartRows]);

  const addToCart = (product: PublicCheckoutProduct) => {
    setCart((prev) => {
      const current = prev[product.id];
      if (!current) {
        return { ...prev, [product.id]: { product, quantity: 1 } };
      }
      return {
        ...prev,
        [product.id]: {
          ...current,
          quantity: current.quantity + 1,
        },
      };
    });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const setItemQty = (productId: number, nextQty: number) => {
    setCart((prev) => {
      const current = prev[productId];
      if (!current) return prev;
      if (nextQty <= 0) {
        const clone = { ...prev };
        delete clone[productId];
        return clone;
      }
      return {
        ...prev,
        [productId]: {
          ...current,
          quantity: nextQty,
        },
      };
    });
  };

  const handleScanProduct = async (code: string) => {
    const scannedCode = code.trim();

    setScanError('');
    setScanMessage('');

    if (!retailerCode) {
      throw new Error('Retailer code is missing in URL.');
    }

    if (!selectedStoreId) {
      throw new Error('Select a store before scanning.');
    }

    const response = await publicCheckoutApi.products(retailerCode, selectedStoreId, scannedCode);
    const matches = response.data.results || [];

    if (matches.length === 0) {
      throw new Error('No product found for this QR/barcode.');
    }

    const product = matches[0];
    addToCart(product);
    setScanMessage(`${product.name} added to cart.`);
    window.setTimeout(() => {
      setScanMessage((current) => (current === `${product.name} added to cart.` ? '' : current));
    }, 2500);
  };

  const handleSubmit = async () => {
    setSubmitError('');

    if (!retailerCode) {
      setSubmitError('Retailer code is missing in URL.');
      return;
    }
    if (!selectedStoreId) {
      setSubmitError('Please select a store first.');
      return;
    }
    if (!customerName.trim()) {
      setSubmitError('Customer name is required.');
      return;
    }
    if (!customerPhone.trim()) {
      setSubmitError('Customer phone is required.');
      return;
    }
    if (cartRows.length === 0) {
      setSubmitError('Please add at least one product.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await publicCheckoutApi.submit({
        retailer: retailerCode,
        store_id: selectedStoreId,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        items: cartRows.map((row) => ({
          product_id: row.product.id,
          quantity: row.quantity,
        })),
      });

      setResult({
        invoice_id: response.data.invoice_id,
        invoice_number: response.data.invoice_number,
      });
      // Save invoice ID for auto-discard if session expires
      setPendingInvoiceId(response.data.invoice_id);
      try {
        localStorage.setItem(INVOICE_ID_KEY, String(response.data.invoice_id));
      } catch (e) {
        console.warn('Failed to save invoice ID');
      }
      setCart({});
      setCustomerName('');
      setCustomerPhone('');
    } catch (error: any) {
      setSubmitError(error?.response?.data?.error || 'Failed to create pending invoice.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!retailerCode) {
    return (
      <div className="min-h-screen bg-slate-100 px-3 py-6 sm:px-4 md:px-6 md:py-8">
        <div className="mx-auto w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6 sm:rounded-xl">
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Self Checkout</h1>
          <p className="mt-3 text-sm text-slate-700">
            This link is incomplete. Please scan the store QR code again.
          </p>
          <p className="mt-2 text-xs text-slate-500">Expected URL format: ?retailer=your_code</p>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-emerald-50 px-3 py-6 sm:px-4 md:px-6 md:py-10">
        <div className="mx-auto w-full max-w-xl rounded-lg border border-emerald-200 bg-white p-4 shadow-sm sm:p-6 sm:rounded-2xl">
          <h1 className="text-xl font-bold text-emerald-900 sm:text-2xl">✓ Request Submitted</h1>
          <p className="mt-3 text-sm text-slate-700">Your pending invoice has been created. Please share these details with the shopkeeper.</p>
          <div className="mt-6 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Invoice ID</p>
              <p className="mt-1 break-all text-lg font-semibold text-slate-900 sm:text-xl">{result.invoice_id}</p>
            </div>
            <div className="border-t border-slate-200 pt-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Invoice Ref</p>
              <p className="mt-1 break-all text-lg font-semibold text-slate-900 sm:text-xl">{result.invoice_number}</p>
            </div>
          </div>
          <Button className="mt-6 w-full h-11 sm:h-10" onClick={() => setResult(null)}>
            Create Another Invoice
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-3 py-4 sm:px-4 md:px-6 md:py-8">
      <div className="mx-auto w-full max-w-7xl">
        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Self Checkout</h1>
          <p className="mt-1 text-xs text-slate-600 sm:text-sm">
            {retailerName ? `${retailerName} - ` : ''}Select store, check prices, add products.
          </p>
        </div>

        {/* Main Grid: Products (top/left) and Cart (bottom/right) */}
        <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
          {/* Products Section */}
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm sm:rounded-xl">
            {/* Store & Camera Controls */}
            <div className="border-b border-slate-200 p-3 sm:p-4 md:p-5">
              {storeIdFromUrl && selectedStoreId ? (
                <div className="mb-3">
                  <p className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700 sm:text-sm">Store</p>
                  <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5">
                    <p className="text-sm font-medium text-emerald-900">
                      {stores.find(s => s.id === selectedStoreId)?.name || `Store #${selectedStoreId}`}
                    </p>
                    <p className="text-xs text-emerald-700 mt-0.5">Pre-selected from QR code</p>
                  </div>
                </div>
              ) : (
                <div className="mb-3">
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-700 sm:text-sm">Select Store</label>
                  <select
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 transition hover:border-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500"
                    value={selectedStoreId ?? ''}
                    onChange={(e) => setSelectedStoreId(e.target.value ? Number(e.target.value) : null)}
                    disabled={loadingStores}
                  >
                    <option value="">{loadingStores ? 'Loading...' : 'Choose store'}</option>
                    {stores.map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-slate-500 sm:text-sm">
                  Scan product QR codes or barcodes to add items to your cart.
                </p>
                <Button
                  type="button"
                  variant={showScanner ? 'secondary' : 'outline'}
                  className="h-11 w-full gap-2 sm:h-10 sm:w-auto"
                  onClick={() => {
                    setShowScanner((current) => !current);
                    setScanError('');
                    setScanMessage('');
                  }}
                  disabled={!selectedStoreId}
                >
                  {showScanner ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                  {showScanner ? 'Close Camera' : 'Scan with Camera'}
                </Button>
              </div>

              {!selectedStoreId ? (
                <p className="mt-2 text-xs text-amber-700">Choose a store first to enable camera scanning.</p>
              ) : null}

              {scanMessage ? (
                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <p className="text-xs text-emerald-700 sm:text-sm">{scanMessage}</p>
                </div>
              ) : null}

              {scanError ? (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-xs text-red-700 sm:text-sm">{scanError}</p>
                </div>
              ) : null}

              {showScanner && selectedStoreId ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                  <BarcodeScanner
                    isOpen={showScanner}
                    continuous={true}
                    onScan={async (barcode) => {
                      try {
                        await handleScanProduct(barcode);
                      } catch (error: any) {
                        setScanError(error?.message || 'Unable to add product from scan.');
                        throw error;
                      }
                    }}
                    onClose={() => {
                      setShowScanner(false);
                    }}
                  />
                </div>
              ) : null}
            </div>

            {/* Products List - Hidden in scan-only mode */}
            <div className="overflow-hidden">
              <div className="p-8 sm:p-10 text-center">
                {!selectedStoreId ? (
                  <p className="text-sm text-slate-500">Select a store to start scanning products.</p>
                ) : (
                  <p className="text-sm text-slate-500">Tap "Scan with Camera" above to add products by scanning their barcodes or QR codes.</p>
                )}
              </div>
            </div>
          </div>

          {/* Cart & Checkout Section */}
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm sm:rounded-xl">
            <div className="border-b border-slate-200 p-3 sm:p-4 md:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 sm:text-lg">Your Cart ({cartRows.length})</h2>
                  {cartRows.length > 0 && (
                    <p className={`text-xs mt-1 font-mono font-semibold ${isTimeoutWarning ? 'text-red-600' : 'text-slate-500'}`}>
                      Session expires in: {formatTime(sessionTimeLeft)}
                    </p>
                  )}
                </div>
                {cartRows.length > 0 && (
                  <button
                    onClick={() => {
                      if (window.confirm('Remove all items from cart and return to stock?')) {
                        setCart({});
                      }
                    }}
                    className="flex-shrink-0 text-xs font-medium text-red-600 hover:text-red-700 hover:underline transition"
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>

            {/* Cart Items */}
            {isTimeoutWarning && cartRows.length > 0 && (
              <div className="border-b border-red-200 bg-red-50 p-3 sm:p-4">
                <p className="text-sm font-semibold text-red-700">
                  ⏰ Hurry! Your session will expire in {formatTime(sessionTimeLeft)}. All items will be returned to stock.
                </p>
              </div>
            )}
            <div className="border-b border-slate-200 p-3 sm:p-4">
              <div className="max-h-40 overflow-y-auto space-y-2.5 md:max-h-52">
                {cartRows.length === 0 && (
                  <p className="py-4 text-center text-sm text-slate-500">Cart is empty</p>
                )}
                {cartRows.map((row) => {
                  const price = Number.parseFloat(row.product.selling_price || '0');
                  return (
                    <div key={row.product.id} className="rounded-lg border border-slate-200 p-2.5 sm:p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900 line-clamp-2">{row.product.name}</p>
                          <p className="text-xs text-slate-600 mt-1">Barcode: <span className="font-mono font-semibold">{row.product.sku || 'N/A'}</span></p>
                        </div>
                        <button
                          onClick={() => {
                            setItemQty(row.product.id, 0);
                          }}
                          className="flex-shrink-0 inline-flex items-center justify-center px-2.5 py-1.5 rounded text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 hover:text-red-700 transition border border-red-200"
                          title="Return item to stock"
                        >
                          Return
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-600">Qty: <span className="font-semibold text-slate-900">{row.quantity}</span></span>
                        <span className="text-sm font-semibold text-slate-900">₹{(price * row.quantity).toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Total */}
            <div className="border-b border-slate-200 p-3 sm:p-4">
              <div className="rounded-lg bg-slate-50 px-3 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-600">Subtotal</span>
                  <span className="text-lg font-bold text-slate-900 sm:text-xl">₹{subtotal.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Customer Details */}
            <div className="p-3 sm:p-4">
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700 sm:text-sm">Name</label>
                  <input
                    type="text"
                    placeholder="Your full name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 transition placeholder:text-slate-400 hover:border-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-700 sm:text-sm">Phone</label>
                  <input
                    type="tel"
                    placeholder="10-digit phone number"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 transition placeholder:text-slate-400 hover:border-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>

              {submitError && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5">
                  <p className="text-xs text-red-700 sm:text-sm">{submitError}</p>
                </div>
              )}

              <Button
                className="mt-4 w-full h-11 text-base font-semibold sm:h-10 sm:text-sm"
                onClick={handleSubmit}
                disabled={submitting || cartRows.length === 0}
              >
                {submitting ? 'Creating...' : 'Create Invoice'}
              </Button>
              <p className="mt-2 text-center text-xs text-slate-500">Final billing is completed by shop staff.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
