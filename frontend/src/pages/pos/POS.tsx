import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { posApi, productsApi, catalogApi, customersApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import {
  loadUserCarts,
  saveUserCarts,
  addCartTab,
  updateCartTab,
  removeCartTab,
  setActiveTab,
  getUserTabs,
  getUsernameFromToken,
  type CartTab,
  type UserCarts
} from '../../lib/cartStorage';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Modal from '../../components/ui/Modal';
import BarcodeScanner from '../../components/BarcodeScanner';
import ToastContainer from '../../components/ui/Toast';
import type { Toast } from '../../components/ui/Toast';
import { ShoppingCart, Search, Plus, Minus, Trash2, Barcode, CheckCircle, XCircle, Camera, AlertTriangle, User, FileText, ChevronDown, ChevronUp, Sparkles, UserPlus, X, Trash, Store, Edit, Wrench, Phone, Package, DollarSign } from 'lucide-react';
import ProductForm from '../products/ProductForm';
import RepairModal from './RepairModal';

export default function POS() {
  const [username, setUsername] = useState<string | null>(null);
  const [cartTabs, setCartTabs] = useState<CartTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [cartId, setCartId] = useState<number | null>(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [debouncedBarcodeInput, setDebouncedBarcodeInput] = useState('');
  const [barcodeStatus, setBarcodeStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [barcodeMessage, setBarcodeMessage] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [strictBarcodeMode, setStrictBarcodeMode] = useState(true); // Default to strict mode
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [invoiceType, setInvoiceType] = useState<'cash' | 'upi' | 'pending' | 'mixed'>('cash');
  const [cashAmount, setCashAmount] = useState<string>('');
  const [upiAmount, setUpiAmount] = useState<string>('');
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [isSearchTyped, setIsSearchTyped] = useState(false);
  const [showCreateCustomerModal, setShowCreateCustomerModal] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [productSearchSelectedIndex, setProductSearchSelectedIndex] = useState(-1);
  const [customerSearchSelectedIndex, setCustomerSearchSelectedIndex] = useState(-1);
  const [editingManualPrice, setEditingManualPrice] = useState<Record<number, string>>({});
  // const [showManualPriceInput] = useState<Record<number, boolean>>({});
  const [expandedBarcodes, setExpandedBarcodes] = useState<Record<number, boolean>>({});
  const [priceErrors, setPriceErrors] = useState<Record<number, string>>({});
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null); // For Admin users
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState<number | undefined>();
  const [showRepairModal, setShowRepairModal] = useState(false);
  const [repairContactNo, setRepairContactNo] = useState('');
  const [repairModelName, setRepairModelName] = useState('');
  const [repairBookingAmount, setRepairBookingAmount] = useState('');
  const [showCustomProductModal, setShowCustomProductModal] = useState(false);
  const [customProductName, setCustomProductName] = useState('');
  // Barcode Queue Types and State
  interface QueueItem {
    id: string;
    code: string;
    status: 'pending' | 'processing' | 'success' | 'error';
    message?: string;
    timestamp: number;
  }

  const [scanQueue, setScanQueue] = useState<QueueItem[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const priceInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const isTypingInPriceInput = useRef(false);
  const processingBarcodesRef = useRef<Set<string>>(new Set());

  // Helper to add item to queue
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
        // Keep pending/processing items, and recent completed items (< 5 seconds old)
        return prev.filter(item =>
          item.status === 'pending' ||
          item.status === 'processing' ||
          (now - item.timestamp < 5000)
        );
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Debounce barcode input for search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedBarcodeInput(barcodeInput);
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [barcodeInput]);

  const queryClient = useQueryClient();

  // Get user info to check if Admin
  const [user, setUser] = useState<any>(null);

  // Toast helper function
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Get username helper
  const getCurrentUsername = useCallback((): string | null => {
    if (username) return username;
    const user = auth.getUser();
    if (user?.username) {
      setUsername(user.username);
      return user.username;
    }
    // Try to get from token as fallback
    const tokenUsername = getUsernameFromToken();
    if (tokenUsername) {
      setUsername(tokenUsername);
      return tokenUsername;
    }
    return null;
  }, [username]);

  // Load carts from localStorage
  const loadCartsFromStorage = useCallback(() => {
    const currentUsername = getCurrentUsername();
    if (!currentUsername) return;

    const userCarts = loadUserCarts(currentUsername);
    if (userCarts) {
      setCartTabs(userCarts.tabs);
      if (userCarts.activeTabId) {
        setActiveTabId(userCarts.activeTabId);
        setCartId(userCarts.activeTabId);
      }
    }
  }, [getCurrentUsername]);

  // Fetch stores
  const { data: storesResponse } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => {
      const response = await catalogApi.stores.list();
      // axios response structure: {data: {...}, status, headers, ...}
      // We need to return response.data which contains {count, results: [...]}
      return response.data;
    },
    retry: false,
  });

  // Handle different response formats for stores
  // API returns paginated: {count, next, previous, results: [...]}
  // After queryFn returns response.data, storesResponse = {count, next, previous, results: [...]}
  const stores = (() => {
    if (!storesResponse) return [];
    if (Array.isArray(storesResponse.results)) return storesResponse.results;
    if (Array.isArray(storesResponse.data)) return storesResponse.data;
    if (Array.isArray(storesResponse)) return storesResponse;
    return [];
  })();

  // Check if user is Admin (only Admin group gets store selector)
  // RetailAdmin, WholesaleAdmin, Retail, Wholesale, Repair → auto-select based on shop_type
  const isAdmin = user?.is_admin || user?.is_superuser || user?.is_staff ||
    (user?.groups && user.groups.includes('Admin'));

  // Check if user is in Retail group or RetailAdmin (both get store selector)
  const isRetailGroup = user?.groups && (user.groups.includes('Retail') || user.groups.includes('RetailAdmin'));

  // Check if user is in Wholesale or WholesaleAdmin group (invoice type should be 'pending' only)
  const isWholesaleGroup = user?.groups && (user.groups.includes('Wholesale') || user.groups.includes('WholesaleAdmin'));

  // Filter stores based on user group
  // - Admin: All stores
  // - Retail/RetailAdmin group: Only retail and repair shop types (backend already filters, but we filter here too for consistency)
  // - Others: All stores (backend already filters)
  const filteredStores = (() => {
    if (isRetailGroup && !isAdmin) {
      // Retail/RetailAdmin group users see only retail and repair stores (lowercase as per backend)
      return stores.filter((s: any) =>
        s.is_active && (s.shop_type === 'retail' || s.shop_type === 'repair')
      );
    }
    // Admin and others see all stores
    return stores;
  })();

  // Determine the active store:
  // - For Admin/Retail: Use selectedStoreId if set, otherwise first active store
  // - For others: Auto-select first active store (filtered by backend)
  // Memoize to prevent unnecessary recalculations and reduce re-renders
  const defaultStore = useMemo(() => {
    if ((isAdmin || isRetailGroup) && selectedStoreId) {
      // Admin/Retail has selected a store
      return filteredStores.find((s: any) => s.id === selectedStoreId) ||
        filteredStores.find((s: any) => s.is_active) ||
        filteredStores[0];
    }
    // Auto-select first active store (for non-admin/retail, backend already filtered)
    return filteredStores.find((s: any) => s.is_active) || filteredStores[0];
  }, [isAdmin, isRetailGroup, selectedStoreId, filteredStores]);

  // Update selectedStoreId when stores load and Admin/Retail hasn't selected one yet
  useEffect(() => {
    if ((isAdmin || isRetailGroup) && !selectedStoreId && filteredStores.length > 0) {
      const firstActiveStore = filteredStores.find((s: any) => s.is_active) || filteredStores[0];
      if (firstActiveStore) {
        setSelectedStoreId(firstActiveStore.id);
      }
    }
  }, [isAdmin, isRetailGroup, selectedStoreId, filteredStores]);


  // Track if this is the initial mount to avoid clearing carts on first load
  const isInitialMount = useRef(true);
  // Track if we're creating a cart to prevent duplicate creation
  const isCreatingCartRef = useRef(false);
  // Track the last store ID to prevent duplicate cart creation on same store
  const lastStoreIdRef = useRef<number | null>(null);

  // Track if we're deleting a cart to prevent queries during deletion
  const [isDeletingCart, setIsDeletingCart] = useState(false);

  const { data: cart } = useQuery({
    queryKey: ['cart', cartId],
    queryFn: async () => {
      try {
        return await posApi.carts.get(cartId!);
      } catch (error: any) {
        // If cart is not found (404), it might have been deleted
        // Return null to prevent error from propagating
        if (error?.response?.status === 404) {
          return null;
        }
        throw error;
      }
    },
    enabled: !!cartId && !isDeletingCart,
    retry: false,
    // Don't refetch if the query was removed (cart deleted)
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Refetch cart once if any items have product_purchase_price as 0 (might be cached old data)
  // This ensures we get the correct purchase price from the updated serializer
  const hasRefetchedForZeroPrice = useRef(false);
  useEffect(() => {
    if (cart?.data?.items && cartId && !hasRefetchedForZeroPrice.current) {
      const hasItemsWithZeroPrice = cart.data.items.some((item: any) =>
        (item.product_purchase_price === 0 || item.product_purchase_price === null || item.product_purchase_price === undefined) &&
        item.product && // Only refetch if product exists (legitimate case)
        !item.product_track_inventory // Only for non-tracked products (tracked should always have barcode)
      );
      if (hasItemsWithZeroPrice) {
        hasRefetchedForZeroPrice.current = true;
        // Refetch cart to get updated purchase prices from serializer
        queryClient.invalidateQueries({ queryKey: ['cart', cartId] });
      }
    }
  }, [cart?.data?.items, cartId, queryClient]);

  // State to track if searched barcode is unavailable
  const [searchedBarcodeStatus, setSearchedBarcodeStatus] = useState<{
    isUnavailable: boolean;
    tag?: string;
    status?: string;
    message: string;
    barcode: string;
  } | null>(null);

  // Helper function to check if barcode is already in cart
  // Create a memoized set of all barcodes in cart for fast lookup
  const cartBarcodesSet = useMemo(() => {
    const barcodes = new Set<string>();
    if (cart?.data?.items && Array.isArray(cart.data.items)) {
      for (const item of cart.data.items) {
        const scannedBarcodes = item.scanned_barcodes || [];
        scannedBarcodes.forEach((bc: string) => {
          if (bc && typeof bc === 'string') {
            barcodes.add(bc.trim());
          }
        });
      }
    }
    return barcodes;
  }, [cart?.data?.items]);

  // Check if the search input is a barcode/SKU and if it's sold
  // Create a stable key for the cart barcodes to include in query key
  const cartBarcodesKey = useMemo(() => {
    return Array.from(cartBarcodesSet).sort().join(',');
  }, [cartBarcodesSet]);

  // Compute if query should be enabled (reactive to barcodeInput and cart changes)
  // This must check synchronously if barcode is in cart to prevent API calls
  const trimmedBarcodeInput = useMemo(() => debouncedBarcodeInput.trim(), [debouncedBarcodeInput]);
  const shouldCheckBarcode = useMemo(() => {
    // Don't run query if scanner is active (scanner handles barcode scanning directly)
    if (showScanner) return false;

    // Don't run query if barcode input is too short
    if (trimmedBarcodeInput.length < 3) return false;

    // Don't run query if cart data is not loaded yet (wait for cart to load first)
    // This prevents queries from running before we can check if barcode is in cart
    if (!cart?.data) return false;

    // UI-level check: Disable query if barcode is already in cart
    // This check happens synchronously before any API call
    if (cart.data.items && Array.isArray(cart.data.items)) {
      for (const item of cart.data.items) {
        const scannedBarcodes = item.scanned_barcodes || [];
        if (scannedBarcodes.some((bc: string) => bc && typeof bc === 'string' && bc.trim() === trimmedBarcodeInput)) {
          // Barcode found in cart - disable query completely
          return false;
        }
      }
    }

    return true;
  }, [trimmedBarcodeInput, cart?.data, showScanner]);

  // Cancel any in-flight barcode check queries when barcode is detected in cart
  // This runs whenever cart items or barcode input changes
  useEffect(() => {
    if (trimmedBarcodeInput.length >= 3 && cart?.data?.items && Array.isArray(cart.data.items)) {
      let barcodeFound = false;
      for (const item of cart.data.items) {
        const scannedBarcodes = item.scanned_barcodes || [];
        if (scannedBarcodes.some((bc: string) => bc && typeof bc === 'string' && bc.trim() === trimmedBarcodeInput)) {
          // Barcode is in cart - cancel any in-flight queries for this barcode immediately
          queryClient.cancelQueries({ queryKey: ['barcode-check', trimmedBarcodeInput] });
          // Also remove the query from cache to prevent it from running
          queryClient.removeQueries({ queryKey: ['barcode-check', trimmedBarcodeInput] });
          barcodeFound = true;
          break;
        }
      }

      // If barcode is found in cart, clear the input to prevent further queries
      if (barcodeFound && barcodeInput.trim() === trimmedBarcodeInput) {
        setBarcodeInput('');
        setBarcodeStatus('success');
        setBarcodeMessage('Item already in cart');
        setTimeout(() => {
          setBarcodeStatus('idle');
          setBarcodeMessage('');
        }, 1500);
      }
    }
  }, [trimmedBarcodeInput, cart?.data?.items, queryClient, barcodeInput]);

  // Helper function to detect if input looks like a barcode (vs product name)
  // Barcodes typically: alphanumeric, may have dashes/underscores, specific length patterns
  // Supports both old format (e.g., FRAM-20240101-0001) and new category-based format (e.g., HOU-56789)
  const looksLikeBarcode = (input: string): boolean => {
    if (!input || input.length < 3) return false;
    // If it contains only alphanumeric, dashes, underscores, and is reasonably long, likely a barcode
    const barcodePattern = /^[A-Za-z0-9\-_]+$/;
    // Barcodes are usually at least 4 characters and often have patterns like dashes
    // New category-based format: PREFIX-NUMBER (e.g., HOU-56789, FRA-0001)
    // Old format: BASE-DATE-SERIAL (e.g., FRAM-20240101-0001)
    return barcodePattern.test(input) && (input.length >= 4 || input.includes('-') || input.includes('_'));
  };

  const { data: _barcodeCheck } = useQuery({
    queryKey: ['barcode-check', trimmedBarcodeInput, cartBarcodesKey],
    queryFn: async () => {
      if (!trimmedBarcodeInput || trimmedBarcodeInput.length < 3) {
        return null;
      }

      // Skip barcode lookup for reserved keywords (barcode tags)
      const reservedKeywords = ['new', 'sold', 'returned', 'defective', 'unknown'];
      if (reservedKeywords.includes(trimmedBarcodeInput.toLowerCase())) {
        return null;
      }

      // Only check barcode if input looks like a barcode (not a product name)
      // This prevents unnecessary barcode checks when user is typing product names
      if (!looksLikeBarcode(trimmedBarcodeInput)) {
        return null; // Let product search handle it
      }

      // UI-LEVEL CHECK: Check if this barcode is already in the cart - skip API call if found
      // This is a synchronous check that happens BEFORE any API call
      if (cart?.data?.items && Array.isArray(cart.data.items)) {
        for (const item of cart.data.items) {
          const scannedBarcodes = item.scanned_barcodes || [];
          if (scannedBarcodes.some((bc: string) => bc && typeof bc === 'string' && bc.trim() === trimmedBarcodeInput)) {
            // Barcode already in cart - skip API call completely
            // Clear any unavailable status since it's already in cart
            setSearchedBarcodeStatus(null);
            return { isInCart: true, product: null };
          }
        }
      }

      try {
        // For typed input that looks like a barcode, check if it's an actual barcode
        // Use barcode_only=true to only search in Barcode table, not Product SKU
        const response = await productsApi.byBarcode(trimmedBarcodeInput, strictBarcodeMode);
        if (response.data) {
          // Check barcode tag status
          const barcodeTag = response.data.barcode_tag;
          const barcodeAvailable = response.data.barcode_available;

          if (barcodeTag && !barcodeAvailable) {
            // Barcode found but not available - show status message
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
          } else if (barcodeTag && barcodeAvailable) {
            // Barcode found and available (tag='new')
            setSearchedBarcodeStatus(null);
            return { isUnavailable: false, product: response.data };
          } else {
            // No barcode tag info - product found but no specific barcode match
            setSearchedBarcodeStatus(null);
            return { isUnavailable: false, product: response.data };
          }
        }
      } catch (error: any) {
        // Not a barcode or not found - that's okay, will search by name
        setSearchedBarcodeStatus(null);
        return null;
      }
      return null;
    },
    enabled: shouldCheckBarcode,
    retry: false,
    // Prevent automatic refetches that might bypass the enabled condition
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Don't cache results to prevent stale data issues
    gcTime: 0,
    staleTime: 0,
  });

  const { data: products } = useQuery({
    queryKey: ['products', debouncedBarcodeInput],
    queryFn: async () => {
      const params: any = { search: debouncedBarcodeInput };
      const response = await productsApi.list(params);
      return response.data;
    },
    // Disable product search when:
    // 1. Scanner is active
    // 2. Barcode is unavailable (sold/defective)
    // 3. Input looks like a barcode AND barcode check found a match (prioritize barcode over name search)
    // 4. Strict barcode mode is ON (only search barcodes, not product names)
    enabled: debouncedBarcodeInput.trim().length > 0
      && !searchedBarcodeStatus?.isUnavailable
      && !showScanner
      && !strictBarcodeMode // Disable product search in strict mode
      && !(looksLikeBarcode(debouncedBarcodeInput.trim()) && _barcodeCheck?.product && !_barcodeCheck?.isUnavailable),
    retry: false,
  });

  const { data: customersResponse } = useQuery({
    queryKey: ['customers', customerSearch.trim()],
    queryFn: async () => {
      const response = await customersApi.list({ search: customerSearch.trim() });
      return response.data;
    },
    enabled: customerSearch.trim().length > 0,
    retry: false,
  });

  // ------- QUEUE PROCESSING LOGIC -------

  // Create a separate mutation wrapper that returns a promise we can await
  const processItemMutation = useMutation({
    mutationFn: (data: any) => ensureCartAndAddItem(data),
    // We don't use global onSuccess/onError here because we need per-item handling
  });

  // Process the queue
  useEffect(() => {
    const processNextItem = async () => {
      // If already processing or no pending items, stop
      if (isProcessingQueue) return;

      const nextItem = scanQueue.find(item => item.status === 'pending');
      if (!nextItem) return;

      setIsProcessingQueue(true);

      // Mark as processing
      setScanQueue(prev => prev.map(item =>
        item.id === nextItem.id ? { ...item, status: 'processing' } : item
      ));

      const barcodeToScan = nextItem.code;

      // Use queryClient to get the LATEST cart data directly from cache
      // The 'cart' closure variable might be stale during rapid processing
      const currentCartData = queryClient.getQueryData(['cart', cartId]) as any;
      const currentItems = currentCartData?.data?.items || [];

      // Check against current processing/success items in queue to prevent race conditions within the queue itself
      // If we have another item with same code in queue that is already 'success' or 'processing', we should wait or skip?
      // Actually, if 'success' is in queue, it means we handled it.
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
        // UI-LEVEL CHECK: Check if barcode is already in cart items (using FRESH data)
        let alreadyInCart = false;
        // Check both raw scan and potential variations (though raw scan is most important first)
        for (const item of currentItems) {
          const scannedBarcodes = item.scanned_barcodes || [];
          if (scannedBarcodes.some((bc: string) => bc && typeof bc === 'string' && bc.trim() === barcodeToScan)) {
            alreadyInCart = true;
            break;
          }
          // Also check if the matched_barcode matches (will be done after API lookup too, but good to check here)
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

        // Check product existence and availability via API
        // Use barcode_only=true to strictly match barcodes
        let productData = null;
        let scannedBarcode = barcodeToScan;

        try {
          const barcodeCheck = await productsApi.byBarcode(barcodeToScan, strictBarcodeMode);
          if (barcodeCheck.data) {
            if (barcodeCheck.data.barcode_available === false) {
              const errorMsg = barcodeCheck.data.sold_invoice
                ? `Sold (Inv #${barcodeCheck.data.sold_invoice})`
                : `Sold / Unavailable`;

              setScanQueue(prev => prev.map(item =>
                item.id === nextItem.id ? { ...item, status: 'error', message: errorMsg } : item
              ));
              setIsProcessingQueue(false);
              return;
            }
            productData = barcodeCheck.data;
            scannedBarcode = barcodeCheck.data.matched_barcode || barcodeToScan;
          }
        } catch (err: any) {
          // Not found as strict barcode
          // Verify if it is really not found or some other error
          const errorMsg = err?.response?.data?.message || err?.message || 'Product not found';
          setScanQueue(prev => prev.map(item =>
            item.id === nextItem.id ? { ...item, status: 'error', message: errorMsg } : item
          ));
          setIsProcessingQueue(false);
          return;
        }

        if (!productData) {
          setScanQueue(prev => prev.map(item =>
            item.id === nextItem.id ? { ...item, status: 'error', message: 'Product not found' } : item
          ));
          setIsProcessingQueue(false);
          return;
        }



        // Add to cart
        // IMPORTANT: Pass the scannedBarcode to ensure backend uses THIS specific barcode
        // and doesn't auto-assign a new one if it's a serialized product
        const result = await processItemMutation.mutateAsync({
          product: productData.id,
          quantity: 1,
          unit_price: 0,
          barcode: scannedBarcode
        });

        const msg = result?.data?.message || 'Added';

        setScanQueue(prev => prev.map(item =>
          item.id === nextItem.id ? { ...item, status: 'success', message: msg } : item
        ));

        // Refetch cart to ensure next item sees correct state
        // We do this via the global mutation onSuccess usually, but here manually awaiting
        await queryClient.invalidateQueries({ queryKey: ['cart', cartId] });

      } catch (error: any) {
        const errorMsg = error?.response?.data?.message || error?.message || 'Failed';
        setScanQueue(prev => prev.map(item =>
          item.id === nextItem.id ? { ...item, status: 'error', message: errorMsg } : item
        ));
      } finally {
        setIsProcessingQueue(false);
      }
    };

    processNextItem();
  }, [scanQueue, isProcessingQueue, cartId, queryClient, strictBarcodeMode]); // Added strictBarcodeMode dependency

  // Initialize username and load carts on mount
  useEffect(() => {
    const initUser = async () => {
      try {
        await auth.loadUser();
        const loadedUser = auth.getUser();
        setUser(loadedUser);
        if (loadedUser?.username) {
          setUsername(loadedUser.username);
        } else {
          const tokenUsername = getUsernameFromToken();
          if (tokenUsername) {
            setUsername(tokenUsername);
          }
        }
      } catch (e) {
        // User not loaded, will try again
      }
    };
    initUser();
  }, []);

  // Auto-set invoice type to 'pending' for Wholesale and WholesaleAdmin users
  useEffect(() => {
    if (isWholesaleGroup && invoiceType !== 'pending') {
      setInvoiceType('pending');
    }
  }, [isWholesaleGroup, invoiceType]);


  // Helper function to convert backend invoice type to frontend invoice type
  // Backend now supports 'cash', 'upi', 'pending', and 'mixed' directly
  const backendToFrontendInvoiceType = (backendType: string): 'cash' | 'upi' | 'pending' | 'mixed' => {
    if (backendType === 'pending') return 'pending';
    if (backendType === 'upi') return 'upi';
    if (backendType === 'mixed') return 'mixed';
    // Default to 'cash' for 'cash' or any other value (backward compatibility)
    return 'cash';
  };

  // Helper function to convert frontend invoice type to backend invoice type
  // Backend now supports 'cash', 'upi', 'pending', and 'mixed' directly - no conversion needed
  const frontendToBackendInvoiceType = (frontendType: 'cash' | 'upi' | 'pending' | 'mixed'): 'cash' | 'upi' | 'pending' | 'mixed' => {
    return frontendType; // Direct mapping - no conversion needed
  };

  // Sync carts with backend - this is the main sync function
  const syncCartsWithBackend = useCallback(async (preserveActiveTabId?: number) => {
    if (!username || !defaultStore) return;

    try {
      // Use provided activeTabId or current state - this preserves newly created carts
      const currentActiveTabId = preserveActiveTabId !== undefined ? preserveActiveTabId : activeTabId;

      // Determine the current store ID to filter carts by
      // Use selectedStoreId if available (for Admin/Retail users), otherwise use defaultStore
      const currentStoreId = (isAdmin || isRetailGroup) && selectedStoreId ? selectedStoreId : defaultStore.id;

      // Fetch all active carts from backend
      const backendResponse = await posApi.carts.getAllActive();
      const backendCarts = Array.isArray(backendResponse.data)
        ? backendResponse.data
        : backendResponse.data?.results || [];

      // Get carts from localStorage
      const localCarts = loadUserCarts(username);
      const localTabs = localCarts?.tabs || [];

      // Create a map of backend carts by ID (for potential future use)
      // const backendCartMap = new Map(
      //   backendCarts.map((cart: any) => [cart.id, cart])
      // );

      // Create a map of local tabs by ID (for potential future use)
      // const localTabMap = new Map(
      //   localTabs.map((tab: CartTab) => [tab.id, tab])
      // );

      // Merge strategy: backend is source of truth
      // 1. Add/update tabs from backend - FILTER BY CURRENT STORE
      const mergedTabs: CartTab[] = [];
      const processedIds = new Set<number>();

      // First, add all backend carts (source of truth) - ONLY FOR CURRENT STORE
      for (const cart of backendCarts) {
        // Only include carts that match the current store selection
        const cartStoreId = cart.store || defaultStore.id;
        if (cart.status === 'active' && cartStoreId === currentStoreId) {
          const cartTab: CartTab = {
            id: cart.id,
            cartNumber: cart.cart_number || `CART-${cart.id}`,
            storeId: cart.store || defaultStore.id,
            customerId: cart.customer || null,
            customerName: cart.customer_name || null,
            invoiceType: backendToFrontendInvoiceType(cart.invoice_type || 'cash'),
            itemCount: cart.items?.length || 0,
            createdAt: cart.created_at || new Date().toISOString(),
            updatedAt: cart.updated_at || new Date().toISOString(),
          };
          mergedTabs.push(cartTab);
          processedIds.add(cart.id);
        }
      }

      // 2. Keep local tabs that don't exist in backend but verify they still exist - FILTER BY CURRENT STORE
      for (const localTab of localTabs) {
        // Only process local tabs that match the current store
        if (localTab.storeId !== currentStoreId) {
          continue; // Skip tabs from other stores
        }

        if (!processedIds.has(localTab.id)) {
          try {
            // Verify cart still exists in backend
            const cartResponse = await posApi.carts.get(localTab.id);
            if (cartResponse.data && cartResponse.data.status === 'active') {
              const cart = cartResponse.data;
              const cartStoreId = cart.store || defaultStore.id;

              // Only add if cart matches current store
              if (cartStoreId === currentStoreId) {
                const cartTab: CartTab = {
                  id: cart.id,
                  cartNumber: cart.cart_number || `CART-${cart.id}`,
                  storeId: cart.store || defaultStore.id,
                  customerId: cart.customer || null,
                  customerName: cart.customer_name || null,
                  invoiceType: backendToFrontendInvoiceType(cart.invoice_type || 'cash'),
                  itemCount: cart.items?.length || 0,
                  createdAt: cart.created_at || new Date().toISOString(),
                  updatedAt: cart.updated_at || new Date().toISOString(),
                };
                mergedTabs.push(cartTab);
                processedIds.add(localTab.id);
              }
            }
            // If cart doesn't exist or is not active, skip it
          } catch (e: any) {
            // Cart doesn't exist in backend (404) or other error, skip it silently
            // This is expected when carts are deleted
            if (e?.response?.status !== 404) {
              console.warn(`Error checking cart ${localTab.id}:`, e);
            }
          }
        }
      }

      // 3. Sort tabs by oldest first (by updatedAt, then createdAt) - Chrome style: left to right = oldest to newest
      mergedTabs.sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt).getTime();
        return aTime - bTime; // Ascending order (oldest first, newest last)
      });

      // 4. Save merged tabs to localStorage
      // Preserve current activeTabId if it exists in merged tabs, otherwise use last tab (newest)
      let activeTabIdToUse: number | null = null;

      // Priority: 1. Current activeTabId (preserve newly created cart), 2. localStorage activeTabId, 3. Last tab (newest)
      if (currentActiveTabId && mergedTabs.some(tab => tab.id === currentActiveTabId)) {
        // Preserve the currently active tab (especially important for newly created carts)
        activeTabIdToUse = currentActiveTabId;
      } else if (localCarts?.activeTabId && mergedTabs.some(tab => tab.id === localCarts.activeTabId)) {
        // Check localStorage activeTabId
        activeTabIdToUse = localCarts.activeTabId;
      } else if (mergedTabs.length > 0) {
        // Use last tab (newest) - Chrome style: newest tabs appear on the right
        activeTabIdToUse = mergedTabs[mergedTabs.length - 1].id;
      }

      const userCarts: UserCarts = {
        username,
        tabs: mergedTabs,
        activeTabId: activeTabIdToUse,
      };

      saveUserCarts(userCarts);
      setCartTabs(mergedTabs);

      // 5. Set active cart - only update if we don't already have the correct one set
      // This prevents overriding a newly created cart that's already active
      // IMPORTANT: Only set active cart if it matches the current store
      if (activeTabIdToUse) {
        const activeTab = mergedTabs.find(tab => tab.id === activeTabIdToUse);
        // Only set active cart if it matches current store
        if (activeTab && activeTab.storeId === currentStoreId) {
          // Only update if it's different from current, or if cartId is null
          if (cartId !== activeTabIdToUse || !cartId) {
            setCartId(activeTabIdToUse);
            setActiveTabId(activeTabIdToUse);
          }
        } else {
          // Active cart doesn't match current store - clear it
          // A new cart will be created by the useEffect that watches for empty carts
          setCartId(null);
          setActiveTabId(null);
        }
      } else {
        // No carts - will be handled by useEffect that watches for empty carts
        // Clear cart state if no matching carts found
        if (cartId) {
          setCartId(null);
          setActiveTabId(null);
        }
      }
    } catch (error) {
      console.error('Error syncing carts with backend:', error);
      // Fallback to localStorage only
      loadCartsFromStorage();
    }
  }, [username, defaultStore, loadCartsFromStorage, activeTabId, cartId, isAdmin, isRetailGroup, selectedStoreId]);

  // Load carts from localStorage when username is available
  useEffect(() => {
    if (username) {
      loadCartsFromStorage();
    }
  }, [username, loadCartsFromStorage]);

  // Sync with backend on mount and when store/username is available
  // Note: We don't include syncCartsWithBackend in dependencies to avoid recreating interval on every selectedStoreId change
  // Instead, we use the latest version via closure
  useEffect(() => {
    if (!defaultStore || !username) return;

    // Sync with backend (backend is source of truth)
    syncCartsWithBackend();

    // Also sync periodically (every 30 seconds) to catch changes from other tabs/devices
    const syncInterval = setInterval(() => {
      syncCartsWithBackend();
    }, 30000);

    return () => clearInterval(syncInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultStore?.id, username]); // Only depend on store ID and username, not the entire defaultStore object

  const createCartMutation = useMutation({
    mutationFn: () => {
      if (!defaultStore) {
        throw new Error('No store available. Please create a store first.');
      }
      const cartData: any = { store: defaultStore.id };
      return posApi.carts.create(cartData);
    },
    onSuccess: async (data) => {
      const newCartId = data.data.id;

      // Update invoiceType state from cart
      const cartInvoiceType = backendToFrontendInvoiceType(data.data.invoice_type || 'cash');
      setInvoiceType(cartInvoiceType);

      // Save to localStorage FIRST
      if (username && data.data) {
        const cartTab: CartTab = {
          id: data.data.id,
          cartNumber: data.data.cart_number || `CART-${data.data.id}`,
          storeId: data.data.store || defaultStore.id,
          customerId: data.data.customer || null,
          customerName: data.data.customer_name || null,
          invoiceType: cartInvoiceType,
          itemCount: data.data.items?.length || 0,
          createdAt: data.data.created_at || new Date().toISOString(),
          updatedAt: data.data.updated_at || new Date().toISOString(),
        };
        addCartTab(username, cartTab);

        // Set as active tab in localStorage BEFORE syncing
        setActiveTab(username, newCartId);

        // Reload and sort tabs (oldest first) - Chrome style: left to right = oldest to newest
        const tabs = getUserTabs(username);
        tabs.sort((a, b) => {
          const aTime = new Date(a.updatedAt || a.createdAt).getTime();
          const bTime = new Date(b.updatedAt || b.createdAt).getTime();
          return aTime - bTime; // Ascending order (oldest first, newest last)
        });
        setCartTabs(tabs);
      }

      // Set as active cart in state (this ensures UI updates immediately)
      setCartId(newCartId);
      setActiveTabId(newCartId);

      // Sync with backend in background (don't await - let it happen async)
      // Pass the newCartId explicitly to ensure it's preserved as active
      syncCartsWithBackend(newCartId).catch(() => {
        // Silently handle sync errors - cart is already set as active
      });
    },
    onError: (_error: any) => {
      // Don't show alert for auto-creation, only for manual creation
    },
  });

  // Sync carts when Admin switches stores (but not on initial mount)
  // Note: Cart clearing is handled in the onChange handler, this just triggers cart creation
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      lastStoreIdRef.current = selectedStoreId;
      return;
    }

    // Only create cart if:
    // 1. Store actually changed (not same store)
    // 2. No cart exists
    // 3. Not already creating a cart
    // 4. Mutation is not pending
    const storeChanged = selectedStoreId !== null && selectedStoreId !== lastStoreIdRef.current;

    if (storeChanged && (isAdmin || isRetailGroup) && selectedStoreId && defaultStore?.id && username && !cartId && !isCreatingCartRef.current && !createCartMutation.isPending) {
      lastStoreIdRef.current = selectedStoreId;
      isCreatingCartRef.current = true;
      createCartMutation.mutate(undefined, {
        onSettled: () => {
          // Reset flag after mutation completes (success or error)
          isCreatingCartRef.current = false;
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreId, isAdmin, isRetailGroup, defaultStore?.id, username, cartId]); // Only trigger when selectedStoreId changes (not on mount)

  // Helper function to ensure cart exists before adding items
  const ensureCartAndAddItem = useCallback(async (itemData: any) => {
    let currentCartId = cartId;
    let cartWasCreated = false;

    // If no cart exists, create one first
    if (!currentCartId) {
      if (!defaultStore) {
        throw new Error('No store available. Please create a store first.');
      }
      try {
        const cartData: any = { store: defaultStore.id };
        const cartResponse = await posApi.carts.create(cartData);
        currentCartId = cartResponse.data.id;
        cartWasCreated = true;

        // Update invoiceType state from cart
        const cartInvoiceType = backendToFrontendInvoiceType(cartResponse.data.invoice_type || 'cash');
        setInvoiceType(cartInvoiceType);

        // Update state immediately
        setCartId(currentCartId);
        setActiveTabId(currentCartId);

        // Save to localStorage
        if (username && cartResponse.data && currentCartId) {
          const cartTab: CartTab = {
            id: cartResponse.data.id,
            cartNumber: cartResponse.data.cart_number || `CART-${cartResponse.data.id}`,
            storeId: cartResponse.data.store || defaultStore.id,
            customerId: cartResponse.data.customer || null,
            customerName: cartResponse.data.customer_name || null,
            invoiceType: cartInvoiceType,
            itemCount: cartResponse.data.items?.length || 0,
            createdAt: cartResponse.data.created_at || new Date().toISOString(),
            updatedAt: cartResponse.data.updated_at || new Date().toISOString(),
          };
          addCartTab(username, cartTab);
          setActiveTab(username, currentCartId);
        }
      } catch (error: any) {
        const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to create cart';
        throw new Error(errorMsg);
      }
    }

    // Now add the item to the cart (currentCartId is guaranteed to be non-null here)
    if (!currentCartId) {
      throw new Error('Cart ID is required to add items');
    }

    const response = await posApi.carts.addItem(currentCartId, itemData);

    // Attach cartId to response for use in onSuccess callback
    if (cartWasCreated) {
      response.data = { ...response.data, _cart_id: currentCartId };
    }

    return response;
  }, [cartId, defaultStore, username, backendToFrontendInvoiceType]);

  const addItemMutation = useMutation({
    mutationFn: (data: any) => ensureCartAndAddItem(data),
    onSuccess: async (response: any) => {
      // Get current cartId (may have been created during mutation)
      const currentCartId = response?.data?._cart_id || cartId;
      if (currentCartId) {
        await queryClient.invalidateQueries({ queryKey: ['cart', currentCartId] });
      }
      // Invalidate and refetch products query to refresh product list and show updated availability
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.refetchQueries({ queryKey: ['products'] });

      // Backend is already updated, localStorage will sync via useEffect hook

      const message = response?.data?.message || '';

      // Check if backend indicates quantity was updated (item already existed)
      if (message.includes('quantity updated') || message.includes('Item quantity updated')) {
        setBarcodeInput('');
        setIsSearchTyped(false);
        setBarcodeStatus('success');
        setBarcodeMessage('Quantity updated');
        setTimeout(() => {
          setBarcodeStatus('idle');
          setBarcodeMessage('');
          // Only refocus if user is not editing a price or typing in price input
          if (barcodeInputRef.current && Object.keys(editingManualPrice).length === 0 && !isTypingInPriceInput.current) {
            // Check if any price input is currently focused
            const activeElement = document.activeElement;
            const isPriceInputFocused = activeElement && activeElement.tagName === 'INPUT' &&
              (activeElement as HTMLInputElement).type === 'number';

            if (!isPriceInputFocused) {
              barcodeInputRef.current.focus();
            }
          }
        }, 1500);
      } else {
        setBarcodeInput('');
        setIsSearchTyped(false);
        setBarcodeStatus('success');
        setBarcodeMessage(message || 'Product added to cart');
        setTimeout(() => {
          setBarcodeStatus('idle');
          setBarcodeMessage('');
          // Only refocus if user is not editing a price or typing in price input
          if (barcodeInputRef.current && Object.keys(editingManualPrice).length === 0 && !isTypingInPriceInput.current) {
            // Check if any price input is currently focused
            const activeElement = document.activeElement;
            const isPriceInputFocused = activeElement && activeElement.tagName === 'INPUT' &&
              (activeElement as HTMLInputElement).type === 'number';

            if (!isPriceInputFocused) {
              barcodeInputRef.current.focus();
            }
          }
        }, 1500);
      }
    },
    onError: (error: any) => {
      const errorMessage = error?.response?.data?.message || error?.response?.data?.error || 'Failed to add product to cart';
      setBarcodeStatus('error');
      setBarcodeMessage(errorMessage);
      // Show error longer for sold items
      const timeoutDuration = errorMessage.includes('already been sold') || errorMessage.includes('not available') ? 5000 : 2000;
      setTimeout(() => {
        setBarcodeStatus('idle');
        setBarcodeMessage('');
        // Only refocus if user is not editing a price or typing in price input
        if (barcodeInputRef.current && Object.keys(editingManualPrice).length === 0 && !isTypingInPriceInput.current) {
          // Check if any price input is currently focused
          const activeElement = document.activeElement;
          const isPriceInputFocused = activeElement && activeElement.tagName === 'INPUT' &&
            (activeElement as HTMLInputElement).type === 'number';

          if (!isPriceInputFocused) {
            barcodeInputRef.current.focus();
          }
        }
      }, timeoutDuration);
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: number; data: any }) =>
      posApi.carts.updateItem(cartId!, itemId, data),
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['cart', cartId] });
      // Invalidate and refetch products query to refresh product list and show updated availability
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.refetchQueries({ queryKey: ['products'] });

      // Backend is already updated, localStorage will sync via useEffect hook

      // Clear price error and editing state if update was successful (backend validated and accepted the price)
      if (variables.data.manual_unit_price !== undefined) {
        const newErrors = { ...priceErrors };
        delete newErrors[variables.itemId];
        setPriceErrors(newErrors);

        // Clear editing state after successful save
        setEditingManualPrice((prev) => {
          const newEditingPrices = { ...prev };
          delete newEditingPrices[variables.itemId];
          return newEditingPrices;
        });
      }
    },
    onError: (error: any, variables) => {
      // Extract error message from response - check multiple possible locations
      let errorMessage = 'Unable to update item';

      // Check error response structure
      if (error?.response?.data) {
        const errorData = error.response.data;
        // Try different possible error message fields (Django REST Framework format)
        errorMessage = errorData.message ||
          errorData.error ||
          errorData.detail ||
          (typeof errorData === 'string' ? errorData : errorMessage);

        // If it's a selling price validation error, show it in-place
        // Check for price validation errors in multiple ways
        const isPriceValidationError = (
          (errorData.purchase_price && errorData.sale_price) ||
          errorMessage.toLowerCase().includes('price') ||
          errorMessage.toLowerCase().includes('purchase') ||
          errorMessage.toLowerCase().includes('selling price') ||
          errorMessage.toLowerCase().includes('cannot be less')
        ) && variables.data.manual_unit_price !== undefined;

        if (isPriceValidationError) {
          const purchasePrice = errorData.purchase_price ? parseFloat(errorData.purchase_price || '0') : 0;
          setPriceErrors({
            ...priceErrors,
            [variables.itemId]: errorMessage || `Price cannot be less than purchase price (₹${purchasePrice.toFixed(2)})`
          });
          // Keep editing state so user can see the error and fix it
          // Don't clear editingManualPrice - let user see what they entered
          return; // Don't show toast for price validation errors, they're shown in-place
        }
      } else if (error?.message) {
        errorMessage = error.message;
      }

      // Show toast for other errors (not price validation)
      showToast(errorMessage, 'error');
    },
  });

  const updateCartMutation = useMutation({
    mutationFn: (data: any) => posApi.carts.update(cartId!, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cart', cartId] });

      // Backend is already updated, localStorage will sync via useEffect hook
    },
  });


  const deleteItemMutation = useMutation({
    mutationFn: (itemId: number) => posApi.carts.deleteItem(cartId!, itemId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cart', cartId] });
      // Invalidate products query to refresh product list and show updated availability
      await queryClient.invalidateQueries({ queryKey: ['products'] });

      // Backend is already updated, localStorage will sync via useEffect hook
    },
    onError: (_error) => {
    },
  });

  // Clear all items from cart and customer
  const clearAllItemsMutation = useMutation({
    mutationFn: async () => {
      const promises: Promise<any>[] = [];

      // Delete all items if there are any
      if (cart?.data?.items && Array.isArray(cart.data.items) && cart.data.items.length > 0) {
        const deletePromises = cart.data.items.map((item: any) =>
          posApi.carts.deleteItem(cartId!, item.id)
        );
        promises.push(...deletePromises);
      }

      // Clear customer from cart if there is one
      if (cart?.data?.customer) {
        promises.push(posApi.carts.update(cartId!, { customer: null }));
      }

      await Promise.all(promises);
    },
    onSuccess: async () => {
      // Clear customer from local state
      setSelectedCustomer(null);
      setCustomerSearch('');

      await queryClient.invalidateQueries({ queryKey: ['cart', cartId] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      showToast('Cart cleared', 'success');
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to clear cart';
      showToast(errorMsg, 'error');
    },
  });

  // Optimistic cart deletion - immediate localStorage update, background backend sync
  const deleteCartOptimistic = useCallback(async (cartIdToDelete: number, showNotification: boolean = false) => {
    if (!username) return;

    // Get current tabs before deletion to check if this is the last one
    const currentTabs = getUserTabs(username);
    if (currentTabs.length <= 1) {
      // This should not happen due to checks in handleTabClose/handleDeleteCurrentCart,
      // but add safety check here too
      showToast('Cannot delete the last cart. At least one cart must always exist.', 'error');
      return;
    }

    // Check if cart has items (for notification)
    const hasItems = cart?.data?.items && cart?.data.items.length > 0 && cartId === cartIdToDelete;

    // OPTIMISTIC UPDATE: Remove from localStorage immediately
    setIsDeletingCart(true);

    // Remove the cart query from cache immediately
    queryClient.removeQueries({ queryKey: ['cart', cartIdToDelete] });

    // Remove from localStorage immediately
    const newActiveTabId = removeCartTab(username, cartIdToDelete);

    // Reload tabs from storage to get updated list
    loadCartsFromStorage();

    // Switch to next cart - there should always be at least one tab remaining
    if (newActiveTabId) {
      // Switch to the new active tab
      setCartId(newActiveTabId);
      setActiveTabId(newActiveTabId);
    } else {
      // Fallback: Get remaining tabs and switch to the first one
      const remainingTabs = getUserTabs(username);
      if (remainingTabs.length > 0) {
        const firstTab = remainingTabs[0];
        setCartId(firstTab.id);
        setActiveTabId(firstTab.id);
        setActiveTab(username, firstTab.id);
      } else {
        // This should never happen, but create a new cart as fallback
        setSelectedCustomer(null);
        setBarcodeInput('');
        if (defaultStore && username) {
          try {
            const cartData: any = { store: defaultStore.id };
            setInvoiceType('cash');
            const data = await posApi.carts.create(cartData);
            const newCartId = data.data.id;
            if (username && data.data) {
              const cartTab: CartTab = {
                id: data.data.id,
                cartNumber: data.data.cart_number || `CART-${data.data.id}`,
                storeId: data.data.store || defaultStore.id,
                customerId: data.data.customer || null,
                customerName: data.data.customer_name || null,
                invoiceType: backendToFrontendInvoiceType(data.data.invoice_type || 'cash'),
                itemCount: data.data.items?.length || 0,
                createdAt: data.data.created_at || new Date().toISOString(),
                updatedAt: data.data.updated_at || new Date().toISOString(),
              };
              addCartTab(username, cartTab);
              setActiveTab(username, newCartId);
              setCartId(newCartId);
              setActiveTabId(newCartId);
              const tabs = getUserTabs(username);
              tabs.sort((a, b) => {
                const aTime = new Date(a.updatedAt || a.createdAt).getTime();
                const bTime = new Date(b.updatedAt || b.createdAt).getTime();
                return aTime - bTime; // Ascending order (oldest first, newest last) - Chrome style
              });
              setCartTabs(tabs);
            }
          } catch (error) {
            console.error('Failed to create fallback cart:', error);
            // Still continue - user can create a new cart manually
          }
        }
      }
    }

    setIsDeletingCart(false);

    // Show notification ONLY if cart has items
    if (showNotification && hasItems) {
      showToast('Cart deleted', 'success');
    }

    // BACKGROUND: Delete from backend (fire and forget, no blocking)
    posApi.carts.delete(cartIdToDelete)
      .then(() => {
        // Success - sync with backend to ensure consistency
        queryClient.invalidateQueries({ queryKey: ['pos/carts'] });
        // Invalidate products query to refresh product list (SKUs are released back to inventory)
        queryClient.invalidateQueries({ queryKey: ['products'] });
        syncCartsWithBackend().catch(() => {
          // Silently handle sync errors
        });
      })
      .catch((error: any) => {
        // Handle errors silently in background
        // If 404, cart was already deleted - that's fine
        // If other error, we'll sync on next page load
        if (error?.response?.status !== 404) {
          console.warn('Background cart deletion failed:', error);
        }
        // Still sync to clean up any inconsistencies
        syncCartsWithBackend().catch(() => {
          // Silently handle sync errors
        });
      });
  }, [username, cartId, cart?.data?.items, defaultStore, queryClient, syncCartsWithBackend, loadCartsFromStorage, removeCartTab, cartTabs.length]);

  const createCustomerMutation = useMutation({
    mutationFn: (data: { name: string; phone?: string }) => customersApi.create(data),
    onSuccess: (data) => {
      const newCustomer = data.data;
      setSelectedCustomer(newCustomer);
      setCustomerSearch('');
      setNewCustomerName('');
      setNewCustomerPhone('');
      setShowCreateCustomerModal(false);
      updateCartMutation.mutate({ customer: newCustomer.id });
      showToast('Customer created successfully', 'success');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.name?.[0] || 'Failed to create customer';
      showToast(errorMsg, 'error');
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: (data: any) => posApi.carts.checkout(cartId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pos/invoices'] });

      // Close repair modal if open and reset repair fields
      setShowRepairModal(false);
      setRepairContactNo('');
      setRepairModelName('');
      setRepairBookingAmount('');

      // Remove cart tab after successful checkout
      if (username && cartId) {
        const newActiveTabId = removeCartTab(username, cartId);
        loadCartsFromStorage();

        if (newActiveTabId) {
          setCartId(newActiveTabId);
          setActiveTabId(newActiveTabId);
        } else {
          setCartId(null);
          setActiveTabId(null);
          setSelectedCustomer(null);
          setInvoiceType('cash');
          setCashAmount('');
          setUpiAmount('');
          setBarcodeInput('');
          // Create new cart automatically after checkout if no other tabs
          if (defaultStore) {
            createCartMutation.mutate();
          }
        }
      } else {
        setCartId(null);
        setActiveTabId(null);
        setSelectedCustomer(null);
        setInvoiceType('cash');
        setBarcodeInput('');
        // Create new cart automatically after checkout
        if (defaultStore) {
          createCartMutation.mutate();
        }
      }

      alert('Checkout successful!');
    },
    onError: (error: any) => {
      // Don't close repair modal on error so user can retry
      alert(error?.response?.data?.message || 'Checkout failed. Please try again.');
    },
  });

  // Auto-save cart state to localStorage whenever cart data changes
  // Backend is already updated via mutations, this just syncs localStorage
  useEffect(() => {
    if (cart?.data && username && cartId) {
      const cartTab: CartTab = {
        id: cart.data.id,
        cartNumber: cart.data.cart_number || `CART-${cart.data.id}`,
        storeId: cart.data.store || defaultStore?.id || 0,
        customerId: cart.data.customer || null,
        customerName: cart.data.customer_name || null,
        invoiceType: backendToFrontendInvoiceType(cart.data.invoice_type || 'sale'),
        itemCount: cart.data.items?.length || 0,
        createdAt: cart.data.created_at || new Date().toISOString(),
        updatedAt: cart.data.updated_at || new Date().toISOString(),
      };
      addCartTab(username, cartTab);
      const tabs = getUserTabs(username);

      // Sort tabs by oldest first - Chrome style: left to right = oldest to newest
      tabs.sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt).getTime();
        return aTime - bTime; // Ascending order (oldest first, newest last)
      });

      setCartTabs(tabs);

      // Note: Backend is already updated via the mutations (addItem, updateItem, etc.)
      // This just ensures localStorage stays in sync
    }
  }, [cart?.data, username, cartId, defaultStore]);

  // Generate smart tab name - short and memorable
  const getTabDisplayName = (tab: CartTab, _index: number, _allTabs: CartTab[]): string => {
    const maxLength = 20; // Maximum characters for tab name

    // Get invoice type abbreviation (all caps)
    const invoiceTypeAbbr: Record<string, string> = {
      'cash': 'CASH',
      'upi': 'UPI',
      'pending': 'PENDING',
      'mixed': 'MIXED'
    };
    const typeAbbr = invoiceTypeAbbr[tab.invoiceType] || 'CART';

    // Use customer name if available (from tab or active cart data)
    const customerName = tab.customerName || (tab.id === cartId ? cart?.data?.customer_name : null);
    if (customerName) {
      const shortName = customerName.length > 12
        ? customerName.substring(0, 12) + '...'
        : customerName;
      const name = `${shortName} (${typeAbbr})`;
      return name.length > maxLength ? name.substring(0, maxLength - 3) + '...' : name;
    }

    // Use sequential number based on position (1-indexed)
    const tabNumber = _index + 1;
    const name = `${typeAbbr} #${tabNumber}`;

    // Truncate if needed (shouldn't be needed with this format, but just in case)
    return name.length > maxLength ? name.substring(0, maxLength - 3) + '...' : name;
  };

  // Handle tab switching
  const handleTabSwitch = (tabId: number) => {
    setActiveTabId(tabId);
    setCartId(tabId);
    if (username) {
      setActiveTab(username, tabId);
    }
    setBarcodeInput('');
  };

  // Handle tab close - optimistic deletion
  const handleTabClose = (e: React.MouseEvent, tabId: number) => {
    e.stopPropagation();
    if (!username) return;

    // Prevent deletion if this is the last cart tab
    if (cartTabs.length <= 1) {
      showToast('Cannot delete the last cart. At least one cart must always exist.', 'error');
      return;
    }

    // Check if this is the active cart and has items
    const isActiveCart = tabId === cartId;
    const hasItems = isActiveCart && cart?.data?.items && cart?.data.items.length > 0;

    // Confirm deletion ONLY if cart has items
    if (hasItems) {
      if (!window.confirm('This cart has items. Are you sure you want to delete it?')) {
        return;
      }
    }

    // Optimistic deletion - immediate localStorage update, background backend sync
    deleteCartOptimistic(tabId, hasItems);
  };

  // Handle delete current cart button - optimistic deletion
  const handleDeleteCurrentCart = () => {
    if (!cartId || !username) return;

    // Prevent deletion if this is the last cart tab
    if (cartTabs.length <= 1) {
      showToast('Cannot delete the last cart. At least one cart must always exist.', 'error');
      return;
    }

    const hasItems = cart?.data?.items && cart?.data.items.length > 0;

    // Confirm deletion ONLY if cart has items
    if (hasItems) {
      if (!window.confirm('This cart has items. Are you sure you want to delete it?')) {
        return;
      }
    }

    // Optimistic deletion - immediate localStorage update, background backend sync
    deleteCartOptimistic(cartId, hasItems);
  };

  // Handle new cart tab creation
  const handleNewSale = () => {
    if (cartId && cart?.data?.items && cart.data.items.length > 0) {
      if (!window.confirm('Start a new sale? Your current cart will be saved and you can continue it later.')) {
        return;
      }
    }
    // Create new cart automatically (will be added as new tab)
    if (defaultStore) {
      createCartMutation.mutate();
    }
  };

  const handleUpdateQuantity = (item: any, delta: number, e?: React.MouseEvent) => {
    // Prevent double-clicks and event propagation
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Prevent multiple simultaneous mutations
    if (updateItemMutation.isPending) {
      return;
    }

    if (delta > 0) {
      // Increment quantity
      updateItemMutation.mutate(
        {
          itemId: item.id,
          data: { action: 'increment' },
        },
        {
          onError: (error: any) => {
            let errorMessage = 'Unable to update item quantity';

            if (error?.response?.data) {
              const errorData = error.response.data;
              errorMessage = errorData.message ||
                errorData.error ||
                errorData.detail ||
                (typeof errorData === 'string' ? errorData : errorMessage);
            } else if (error?.message) {
              errorMessage = error.message;
            }

            showToast(errorMessage, 'error');
          },
        }
      );
    } else {
      // Decrement quantity
      updateItemMutation.mutate({
        itemId: item.id,
        data: { action: 'decrement' },
      });
    }
  };

  const handleCheckout = () => {
    if (!cart?.data?.items || cart.data.items.length === 0) {
      alert('Cart is empty');
      return;
    }

    // Check if current store is a Repair shop (lowercase as per backend)
    const isRepairShop = defaultStore?.shop_type === 'repair';

    // For repair shops, validate repair data regardless of invoice type
    if (isRepairShop) {
      if (!repairContactNo.trim() || !repairModelName.trim()) {
        // Show modal if repair data not entered
        setShowRepairModal(true);
        return;
      }
    }

    let finalInvoiceType = invoiceType;

    // Validate split payments for mixed type
    if (finalInvoiceType === 'mixed') {
      const total = calculateTotal();
      const cash = parseFloat(cashAmount) || 0;
      const upi = parseFloat(upiAmount) || 0;

      if (!cashAmount || !upiAmount || cash <= 0 || upi <= 0) {
        alert('Please enter both cash and UPI amounts for split payment');
        return;
      }

      if (Math.abs((cash + upi) - total) > 0.01) { // Allow small floating point differences
        alert(`Split payment amounts (₹${(cash + upi).toFixed(2)}) do not match invoice total (₹${total.toFixed(2)})`);
        return;
      }
    }

    const checkoutData: any = {
      invoice_type: frontendToBackendInvoiceType(finalInvoiceType),
      customer: selectedCustomer?.id || null,
    };

    // Add repair data if it's a repair shop (regardless of invoice type)
    if (isRepairShop) {
      checkoutData.repair_contact_no = repairContactNo;
      checkoutData.repair_model_name = repairModelName;
      checkoutData.repair_booking_amount = repairBookingAmount || null;
    }

    // Add split payment amounts for mixed type
    if (finalInvoiceType === 'mixed') {
      checkoutData.cash_amount = parseFloat(cashAmount);
      checkoutData.upi_amount = parseFloat(upiAmount);
    }

    checkoutMutation.mutate(checkoutData);
  };

  const handleRepairCheckout = (repairData: {
    repair_contact_no: string;
    repair_model_name: string;
    repair_booking_amount: string;
  }) => {
    // Store repair data in state
    setRepairContactNo(repairData.repair_contact_no);
    setRepairModelName(repairData.repair_model_name);
    setRepairBookingAmount(repairData.repair_booking_amount);
    setShowRepairModal(false);
  };


  const generateThermalInvoiceHTML = (invoice: any) => {
    const formatCurrency = (amount: string | number) => {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
      }).format(parseFloat(String(amount || '0')));
    };

    const formatDate = (dateString: string) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invoice ${invoice.invoice_number || invoice.id}</title>
          <meta charset="UTF-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            @page { size: 4in auto; margin: 0.1in; }
            body { 
              font-family: 'Courier New', monospace; 
              font-size: 10px;
              width: 4in;
              max-width: 4in;
              padding: 5px;
              color: #000;
            }
            .header { 
              text-align: center; 
              margin-bottom: 8px; 
              border-bottom: 1px dashed #000; 
              padding-bottom: 5px; 
            }
            .header h1 { font-size: 14px; margin-bottom: 3px; font-weight: bold; }
            .header p { font-size: 9px; margin: 1px 0; }
            .info { margin-bottom: 6px; font-size: 9px; }
            .info-row { margin: 2px 0; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 9px; }
            th { padding: 3px 2px; text-align: left; border-bottom: 1px dashed #000; font-weight: bold; }
            td { padding: 2px; border-bottom: 1px dotted #ccc; }
            .text-right { text-align: right; }
            .text-center { text-align: center; }
            .summary { margin-top: 6px; border-top: 1px dashed #000; padding-top: 4px; }
            .summary-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 9px; }
            .summary-total { border-top: 1px solid #000; margin-top: 4px; padding-top: 4px; font-weight: bold; font-size: 11px; }
            .footer { margin-top: 8px; padding-top: 4px; border-top: 1px dashed #000; text-align: center; font-size: 8px; }
            @media print {
              body { padding: 0; margin: 0; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>INVOICE</h1>
            <p>${invoice.invoice_number || `#${invoice.id}`}</p>
            <p>${formatDate(invoice.created_at)}</p>
          </div>
          <div class="info">
            <div class="info-row"><strong>Store:</strong> ${invoice.store_name || '-'}</div>
            <div class="info-row"><strong>Customer:</strong> ${invoice.customer_name || 'Walk-in Customer'}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th class="text-right">Qty</th>
                <th class="text-right">Price</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${invoice.items && Array.isArray(invoice.items) ? invoice.items.map((item: any) => `
                <tr>
                  <td>${(item.product_name || '-').substring(0, 20)}</td>
                  <td class="text-right">${item.quantity}</td>
                  <td class="text-right">${formatCurrency(item.manual_unit_price || item.unit_price || '0')}</td>
                  <td class="text-right">${formatCurrency(item.line_total || '0')}</td>
                </tr>
              `).join('') : '<tr><td colspan="4">No items</td></tr>'}
            </tbody>
          </table>
          <div class="summary">
            <div class="summary-row">
              <span>Subtotal:</span>
              <span>${formatCurrency(invoice.subtotal || '0')}</span>
            </div>
            ${parseFloat(invoice.discount_amount || '0') > 0 ? `
            <div class="summary-row">
              <span>Discount:</span>
              <span>-${formatCurrency(invoice.discount_amount || '0')}</span>
            </div>
            ` : ''}
            ${parseFloat(invoice.tax_amount || '0') > 0 ? `
            <div class="summary-row">
              <span>Tax:</span>
              <span>${formatCurrency(invoice.tax_amount || '0')}</span>
            </div>
            ` : ''}
            <div class="summary-row summary-total">
              <span>TOTAL:</span>
              <span>${formatCurrency(invoice.total || '0')}</span>
            </div>
            ${parseFloat(invoice.paid_amount || '0') > 0 ? `
            <div class="summary-row">
              <span>Paid:</span>
              <span>${formatCurrency(invoice.paid_amount || '0')}</span>
            </div>
            ` : ''}
            ${parseFloat(invoice.due_amount || '0') > 0 ? `
            <div class="summary-row">
              <span>Due:</span>
              <span>${formatCurrency(invoice.due_amount || '0')}</span>
            </div>
            ` : ''}
          </div>
          <div class="footer">
            <p>Thank you for your business!</p>
          </div>
        </body>
      </html>
    `;
  };

  const checkoutAndPrintThermalMutation = useMutation({
    mutationFn: (data: any) => posApi.carts.checkout(cartId!, data),
    onSuccess: async (response: any) => {
      // Get invoice ID from response
      const invoiceId = response?.data?.id || response?.id;

      if (!invoiceId) {
        alert('Failed to get invoice ID from checkout response');
        return;
      }

      try {
        // Fetch full invoice data
        const invoiceResponse = await posApi.invoices.get(invoiceId);
        const invoiceData = invoiceResponse?.data || invoiceResponse;

        // Generate thermal print HTML
        const thermalHTML = generateThermalInvoiceHTML(invoiceData);

        // Open print window
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          alert('Please allow popups to print invoice');
          return;
        }

        printWindow.document.write(thermalHTML);
        printWindow.document.close();

        // Wait for content to load, then trigger print
        printWindow.onload = () => {
          setTimeout(() => {
            printWindow.print();
          }, 250);
        };

        // Also handle the normal checkout success logic
        queryClient.invalidateQueries({ queryKey: ['pos/invoices'] });

        // Remove cart tab after successful checkout
        if (username && cartId) {
          const newActiveTabId = removeCartTab(username, cartId);
          loadCartsFromStorage();

          if (newActiveTabId) {
            setCartId(newActiveTabId);
            setActiveTabId(newActiveTabId);
          } else {
            setCartId(null);
            setActiveTabId(null);
            setSelectedCustomer(null);
            setInvoiceType('cash');
            setBarcodeInput('');
            // Create new cart automatically after checkout if no other tabs
            if (defaultStore) {
              createCartMutation.mutate();
            }
          }
        }
      } catch (error: any) {
        alert('Failed to fetch invoice for printing: ' + (error?.message || 'Unknown error'));
      }
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to checkout invoice';
      alert(errorMsg);
    },
  });

  const handleCheckoutAndPrintThermal = () => {
    if (!cart?.data?.items || cart.data.items.length === 0) {
      alert('Cart is empty');
      return;
    }

    // Validate split payments for mixed type
    if (invoiceType === 'mixed') {
      const total = calculateTotal();
      const cash = parseFloat(cashAmount) || 0;
      const upi = parseFloat(upiAmount) || 0;

      if (!cashAmount || !upiAmount || cash <= 0 || upi <= 0) {
        alert('Please enter both cash and UPI amounts for split payment');
        return;
      }

      if (Math.abs((cash + upi) - total) > 0.01) { // Allow small floating point differences
        alert(`Split payment amounts (₹${(cash + upi).toFixed(2)}) do not match invoice total (₹${total.toFixed(2)})`);
        return;
      }
    }

    const checkoutData: any = {
      invoice_type: frontendToBackendInvoiceType(invoiceType),
      customer: selectedCustomer?.id || null,
    };

    // Add split payment amounts for mixed type
    if (invoiceType === 'mixed') {
      checkoutData.cash_amount = parseFloat(cashAmount);
      checkoutData.upi_amount = parseFloat(upiAmount);
    }

    checkoutAndPrintThermalMutation.mutate(checkoutData);
  };

  const handleBarcodeScan = async (barcode: string) => {
    if (!barcode || !barcode.trim()) return;

    const trimmedBarcode = barcode.trim();

    // Check if currently processing this barcode to prevent race conditions
    if (processingBarcodesRef.current.has(trimmedBarcode)) {
      return Promise.resolve();
    }

    // FIRST: UI-level check - Check if this barcode is already in the cart BEFORE any API call
    // This must happen synchronously, before any async operations
    if (cart?.data?.items && Array.isArray(cart.data.items)) {
      for (const item of cart.data.items) {
        const scannedBarcodes = item.scanned_barcodes || [];
        // Direct synchronous check - no function calls, no async
        if (scannedBarcodes.some((bc: string) => bc && typeof bc === 'string' && bc.trim() === trimmedBarcode)) {
          // Barcode already in cart - show message and return immediately
          // NO API CALL - this is pure UI-level check
          setBarcodeInput('');
          setIsSearchTyped(false);
          setBarcodeStatus('success');
          setBarcodeMessage('Item already in cart');
          setTimeout(() => {
            setBarcodeStatus('idle');
            setBarcodeMessage('');
          }, 1500);
          return Promise.resolve();
        }
      }
    }

    // Only proceed if barcode is NOT in cart


    // Mark barcode as processing
    processingBarcodesRef.current.add(trimmedBarcode);

    try {
      // Barcode not found in cart - proceed with API call to get product info
      // handleBarcodeScan is ONLY called for scanned barcodes (camera or typed barcode)
      // Always use barcode_only=true to only search in Barcode table, not Product SKU
      let product = null;
      let matchedBarcode: string | null = null;
      let isActualBarcode = false;

      try {
        // Use barcode_only=true to only search in Barcode table, not Product SKU
        // This ensures we only find actual barcodes, not product SKUs
        const barcodeResponse = await productsApi.byBarcode(trimmedBarcode, strictBarcodeMode);
        if (barcodeResponse.data) {
          product = barcodeResponse.data;
          // Check if the API returned a matched_barcode field
          matchedBarcode = product.matched_barcode || trimmedBarcode;
          isActualBarcode = true;  // This is an actual barcode from barcode table

          // Check if the barcode is available (not sold)
          // Use trimmedBarcode (the exact scanned barcode) in error messages
          if (product.barcode_available === false) {
            const errorMsg = product.sold_invoice
              ? `This item (SKU: ${trimmedBarcode}) has already been sold and is assigned to invoice ${product.sold_invoice}. It is not available in inventory.`
              : `This item (SKU: ${trimmedBarcode}) has already been sold and is not available in inventory.`;
            throw new Error(errorMsg);
          }
        }
      } catch (barcodeError: any) {
        // Check if it's an error about sold item
        if (barcodeError?.message && (
          barcodeError.message.includes('already been sold') ||
          barcodeError.message.includes('not available in inventory')
        )) {
          // Re-throw the sold error
          throw barcodeError;
        }

        // If barcode lookup fails with 404, the barcode doesn't exist
        // Don't fall back to product name search - scanned barcodes must be actual barcodes
        if (barcodeError?.response?.status === 404) {
          throw new Error(`Barcode "${trimmedBarcode}" not found. Please ensure the barcode is correct or scan again.`);
        } else {
          // If it's not a 404, re-throw the error
          throw barcodeError;
        }
      }

      if (!product || !product.id) {
        throw new Error(`Barcode "${trimmedBarcode}" not found. Please ensure the barcode is correct or scan again.`);
      }

      // Double-check: if we have a matched barcode and it's not available, throw error
      if (isActualBarcode && matchedBarcode && product.barcode_available === false) {
        const errorMsg = product.sold_invoice
          ? `This item (SKU: ${matchedBarcode}) has already been sold and is assigned to invoice ${product.sold_invoice}. It is not available in inventory.`
          : `This item (SKU: ${matchedBarcode}) has already been sold and is not available in inventory.`;
        throw new Error(errorMsg);
      }

      // Additional validation: Check if product is in stock and purchase is finalized
      // Custom products (with "Other -" prefix) are always available - skip stock check
      const isCustomProduct = product.name && product.name.startsWith('Other -');

      if (!isCustomProduct) {
        // For tracked products: Check if stock_quantity > 0 (stock only exists for finalized purchases)
        // For non-tracked products: Check if stock_quantity > 0 (stock only exists for finalized purchases)
        const trackInventory = product.track_inventory !== false; // Default to true if not specified
        const stockQuantity = product.stock_quantity || 0;
        const availableQuantity = product.available_quantity || 0;

        // Check stock availability
        if (trackInventory) {
          // For tracked products, check if there are available barcodes (stock_quantity > 0)
          // Stock quantity is only updated when purchase is finalized
          if (stockQuantity <= 0 && availableQuantity <= 0) {
            throw new Error(`Product "${product.name}" is not in stock. The purchase order may not be finalized yet, or the product has not been purchased.`);
          }
        } else {
          // For non-tracked products, check stock_quantity
          // Stock quantity is only updated when purchase is finalized
          if (stockQuantity <= 0) {
            throw new Error(`Product "${product.name}" is not in stock. The purchase order may not be finalized yet, or the product has not been purchased.`);
          }
        }
      }

      // Do NOT auto-populate price - it must be entered manually
      // Use a promise-based approach for the mutation
      // If we found a barcode match, use that exact barcode
      // Otherwise, let backend find an available barcode automatically
      return new Promise<void>((resolve, reject) => {
        const mutationData: any = {
          product: product.id,
          quantity: 1,
          unit_price: 0, // Price must be entered manually, start with 0
        };

        // Always use the exact scanned barcode - what the user scanned should be what gets added
        // The backend will validate that this barcode exists and belongs to the product
        mutationData.barcode = trimmedBarcode;

        addItemMutation.mutate(
          mutationData,
          {
            onSuccess: () => {
              resolve();
            },
            onError: (error: any) => {
              const errorMsg = error?.response?.data?.message || error?.response?.data?.error || 'Failed to add product to cart';
              // Also show error in UI
              setBarcodeStatus('error');
              setBarcodeMessage(errorMsg);
              const timeoutDuration = errorMsg.includes('already been sold') || errorMsg.includes('not available') ? 5000 : 2000;
              setTimeout(() => {
                setBarcodeStatus('idle');
                setBarcodeMessage('');
              }, timeoutDuration);
              reject(new Error(errorMsg));
            },
            onSettled: () => {
              // Remove from processing set when mutation settles (success or error)
              processingBarcodesRef.current.delete(trimmedBarcode);
            }
          }
        );
      });
    } catch (error) {
      // Ensure we clean up if something throws synchronously
      processingBarcodesRef.current.delete(trimmedBarcode);
      throw error;
    }
  };

  // Track if user is currently editing a price to prevent auto-focus
  const isEditingPrice = Object.keys(editingManualPrice).length > 0;

  // Auto-focus barcode input when cart is created (but not when editing prices or typing)
  useEffect(() => {
    if (cartId && barcodeInputRef.current && !isEditingPrice && !isTypingInPriceInput.current) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        // Double-check that user is not typing in price input
        if (barcodeInputRef.current && !isEditingPrice && !isTypingInPriceInput.current) {
          // Check if any price input is currently focused
          const activeElement = document.activeElement;
          const isPriceInputFocused = activeElement && activeElement.tagName === 'INPUT' &&
            (activeElement as HTMLInputElement).type === 'number' &&
            activeElement.closest('[class*="price"]') !== null;

          if (!isPriceInputFocused) {
            barcodeInputRef.current.focus();
          }
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [cartId, isEditingPrice]);

  // Sync invoice_type and customer from cart when it loads
  useEffect(() => {
    if (cart?.data) {
      if (cart.data.invoice_type) {
        const newType = backendToFrontendInvoiceType(cart.data.invoice_type);
        setInvoiceType(newType);
        // Clear split amounts if not mixed type
        if (newType !== 'mixed') {
          setCashAmount('');
          setUpiAmount('');
        }
      }
      if (cart.data.customer) {
        // If customer is just an ID, construct customer object from cart data
        if (typeof cart.data.customer === 'number' || typeof cart.data.customer === 'string') {
          if (cart.data.customer_name) {
            setSelectedCustomer({
              id: cart.data.customer,
              name: cart.data.customer_name,
              phone: cart.data.customer_phone || null,
            });
          } else {
            // Customer ID exists but no name - clear selection to avoid showing just ID
            setSelectedCustomer(null);
          }
        } else if (cart.data.customer && typeof cart.data.customer === 'object' && cart.data.customer.name) {
          // Customer is already an object with name
          setSelectedCustomer(cart.data.customer);
        } else if (!cart.data.customer_name) {
          // No customer name available, clear selection
          setSelectedCustomer(null);
        }
      } else {
        // No customer in cart, clear selection
        setSelectedCustomer(null);
      }

      // Update tab state when cart loads
      if (username && cart.data.id) {
        updateCartTab(username, cart.data.id, {
          customerId: cart.data.customer || null,
          customerName: cart.data.customer_name || null,
          invoiceType: backendToFrontendInvoiceType(cart.data.invoice_type || 'cash'),
        });
        loadCartsFromStorage();
      }
    }
  }, [cart?.data, username, loadCartsFromStorage]);

  // Clear price errors when invoice type changes to pending
  useEffect(() => {
    if (invoiceType === 'pending') {
      setPriceErrors({});
    }
  }, [invoiceType]);

  // Auto-set invoice type to 'pending' when repair shop is selected
  // Only apply when store changes, not when cart loads (cart invoice_type takes precedence)
  useEffect(() => {
    // Skip if we have a cart with invoice_type already set (cart data takes precedence)
    if (cart?.data?.invoice_type) {
      return;
    }

    if (defaultStore?.shop_type === 'repair') {
      // Only change if not already pending (to avoid unnecessary updates)
      if (invoiceType !== 'pending') {
        setInvoiceType('pending');
      }
    } else if (defaultStore?.shop_type !== 'repair' && invoiceType === 'pending') {
      // If switching from repair to non-repair shop, reset to 'cash' if currently 'pending'
      // But only if we don't have a cart (cart invoice_type takes precedence)
      if (!cartId || !cart?.data) {
        setInvoiceType('cash');
      }
    }
  }, [defaultStore?.shop_type, invoiceType, cartId, cart?.data?.invoice_type]);

  const calculateTotal = () => {
    if (!cart?.data?.items || !Array.isArray(cart.data.items)) return 0;
    return cart.data.items.reduce((sum: number, item: any) => {
      const quantity = parseInt(item.quantity || '0') || 0;
      // Use editingManualPrice if user is typing, otherwise use saved price
      const editingPrice = editingManualPrice[item.id];
      const price = editingPrice !== undefined && editingPrice !== ''
        ? (parseFloat(editingPrice) || 0)
        : (parseFloat(item.manual_unit_price) || parseFloat(item.unit_price) || 0);
      const discount = parseFloat(item.discount_amount || 0);
      return sum + (quantity * price - discount);
    }, 0);
  };

  const calculateTotalQuantity = () => {
    if (!cart?.data?.items || !Array.isArray(cart.data.items)) return 0;
    return cart.data.items.reduce((sum: number, item: any) => {
      const quantity = parseInt(item.quantity || '0') || 0;
      return sum + quantity;
    }, 0);
  };

  // Check if all items have prices (for Cash/UPI/Mixed invoices only)
  const allItemsHavePrices = () => {
    if (invoiceType === 'pending') return true; // No price requirement for pending invoices
    if (!cart?.data?.items || !Array.isArray(cart.data.items) || cart.data.items.length === 0) return false;

    return cart.data.items.every((item: any) => {
      // Check if user is currently editing this item's price
      const editingPrice = editingManualPrice[item.id];
      // Use editing price if available, otherwise use saved price
      const effectivePrice = editingPrice !== undefined && editingPrice !== ''
        ? (parseFloat(editingPrice) || 0)
        : (parseFloat(item.manual_unit_price) || parseFloat(item.unit_price) || 0);
      return effectivePrice > 0;
    });
  };

  // Check if some items have zero prices (for pending invoices warning)
  const someItemsHaveZeroPrices = () => {
    if (invoiceType !== 'pending') return false; // Only relevant for pending invoices
    if (!cart?.data?.items || !Array.isArray(cart.data.items) || cart.data.items.length === 0) return false;

    const itemsWithZeroPrice = cart.data.items.filter((item: any) => {
      // Check if user is currently editing this item's price
      const editingPrice = editingManualPrice[item.id];
      // Use editing price if available, otherwise use saved price
      const effectivePrice = editingPrice !== undefined && editingPrice !== ''
        ? (parseFloat(editingPrice) || 0)
        : (parseFloat(item.manual_unit_price) || parseFloat(item.unit_price) || 0);
      return effectivePrice === 0;
    });

    // Return true if some items have zero price AND some items have non-zero price
    const itemsWithPrice = cart.data.items.filter((item: any) => {
      const editingPrice = editingManualPrice[item.id];
      const effectivePrice = editingPrice !== undefined && editingPrice !== ''
        ? (parseFloat(editingPrice) || 0)
        : (parseFloat(item.manual_unit_price) || parseFloat(item.unit_price) || 0);
      return effectivePrice > 0;
    });

    return itemsWithZeroPrice.length > 0 && itemsWithPrice.length > 0;
  };

  // Check if there are any price validation errors
  const hasPriceErrors = () => {
    return Object.keys(priceErrors).length > 0;
  };

  // Show loading while creating cart or if no store
  if (!defaultStore) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <ShoppingCart className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Point of Sale</h2>
          <p className="text-red-600 mb-4">No store available. Please create a store first.</p>
          <p className="text-sm text-gray-500">Stores can be created from the Stores management page.</p>
        </div>
      </div>
    );
  }

  // Show loading while cart is being created or loaded
  if (!cartId && (createCartMutation.isPending || !stores.length)) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <ShoppingCart className="h-16 w-16 text-gray-400 mx-auto mb-4 animate-pulse" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Loading...</h2>
          <p className="text-sm text-gray-500">Setting up your cart...</p>
        </div>
      </div>
    );
  }

  // Get current selected store for display
  const currentStore = filteredStores.find((s: any) => s.id === selectedStoreId);

  return (
    <div className="space-y-6">
      {/* Header with Store Selector (Admin), New Sale and Delete Cart buttons */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 flex-1 w-full sm:w-auto">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Point of Sale</h1>
          {/* Store Selector for Admin and Retail group users - Improved UI */}
          {(isAdmin || isRetailGroup) && filteredStores.length > 0 && (
            <div className="w-full sm:w-auto">
              <div className="relative group">
                <div className="flex items-center gap-2 sm:gap-3 bg-white border-2 border-blue-200 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm hover:shadow-md hover:border-blue-400 transition-all duration-200 cursor-pointer">
                  <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                    <div className="flex-shrink-0 p-1.5 bg-blue-50 rounded-lg">
                      <Store className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm sm:text-base font-semibold text-gray-900 truncate block">
                        {currentStore?.name || 'Select Store'}
                      </span>
                    </div>
                    <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400 group-hover:text-blue-600 transition-colors flex-shrink-0" />
                  </div>
                </div>
                <select
                  value={selectedStoreId?.toString() || ''}
                  onChange={async (e) => {
                    const storeId = parseInt(e.target.value);

                    // Prevent switching to the same store
                    if (storeId === selectedStoreId) {
                      return;
                    }

                    // Find the selected store to check its shop_type
                    const selectedStore = filteredStores.find((s: any) => s.id === storeId);

                    // If repair shop is selected, automatically set invoice type to 'pending'
                    if (selectedStore && selectedStore.shop_type === 'repair') {
                      setInvoiceType('pending');
                    } else if (selectedStore && selectedStore.shop_type !== 'repair' && invoiceType === 'pending') {
                      // If switching from repair to non-repair shop, reset to 'cash' if currently 'pending'
                      setInvoiceType('cash');
                    }

                    // Clear current cart when switching stores (cart is tied to a specific store)
                    // This ensures the cart's store matches the selected store
                    if (cartId && username) {
                      try {
                        // Delete current cart from backend
                        await posApi.carts.delete(cartId);
                        // Invalidate cart query to clear cached data
                        queryClient.invalidateQueries({ queryKey: ['cart', cartId] });
                        queryClient.removeQueries({ queryKey: ['cart', cartId] });
                        // Remove from localStorage
                        removeCartTab(username, cartId);
                        loadCartsFromStorage();
                        // Clear cart state
                        setCartId(null);
                        setActiveTabId(null);
                        setSelectedCustomer(null);
                        setBarcodeInput('');
                      } catch (error) {
                        console.error('Failed to delete cart when switching stores:', error);
                        // Even if deletion fails, clear the cart state and queries
                        queryClient.invalidateQueries({ queryKey: ['cart', cartId] });
                        queryClient.removeQueries({ queryKey: ['cart', cartId] });
                        setCartId(null);
                        setActiveTabId(null);
                      }
                    }

                    // Update selected store - new cart will be created via useEffect
                    // The useEffect at line 746 will handle cart creation
                    // The useEffect at line 672 will handle syncing (it watches defaultStore.id which changes when selectedStoreId changes)
                    setSelectedStoreId(storeId);
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 appearance-none"
                >
                  {filteredStores.map((store: any) => (
                    <option key={store.id} value={store.id.toString()}>
                      {store.name} {store.shop_type ? `(${store.shop_type})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Mobile: Stack buttons, Desktop: Horizontal */}
          <div className="flex items-center gap-2 flex-1 sm:flex-initial">
            {cartId && (
              <Button
                variant="outline"
                onClick={handleDeleteCurrentCart}
                disabled={isDeletingCart || !cartId || cartTabs.length <= 1}
                className="flex items-center gap-1.5 sm:gap-2 text-red-600 border-red-300 hover:bg-red-50 text-xs sm:text-sm"
                title={cartTabs.length <= 1 ? 'Cannot delete the last cart. At least one cart must always exist.' : 'Delete current cart'}
              >
                <Trash className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Delete Cart</span>
                <span className="sm:hidden">Delete</span>
              </Button>
            )}
            <Button
              variant="primary"
              onClick={handleNewSale}
              disabled={createCartMutation.isPending}
              className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm"
            >
              <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">New Sale</span>
              <span className="sm:hidden">New</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Cart Tabs */}
      {cartTabs.length > 0 && (
        <div className="bg-white rounded-lg shadow border border-gray-200 flex items-center gap-2 p-2">
          <div className="flex items-center gap-1 overflow-x-auto flex-1 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
            {cartTabs.map((tab, index) => {
              const isActive = tab.id === activeTabId;
              // Use itemCount from tab (for all tabs) or from active cart (for active tab, more accurate)
              const itemCount = isActive
                ? (cart?.data?.items?.length || tab.itemCount || 0)
                : (tab.itemCount || 0);
              const hasItems = itemCount > 0;
              const displayName = getTabDisplayName(tab, index, cartTabs);

              return (
                <div
                  key={tab.id}
                  onClick={() => handleTabSwitch(tab.id)}
                  className={`
                    flex items-center gap-0.5 sm:gap-2 px-1.5 sm:px-4 py-2 rounded-md cursor-pointer transition-all duration-200
                    min-w-[60px] sm:min-w-[120px] max-w-[80px] sm:max-w-[200px] flex-shrink-0 relative h-10
                    ${isActive
                      ? 'bg-blue-600 text-white shadow-md ring-2 ring-blue-400'
                      : hasItems
                        ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-2 border-blue-300'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-2 border-gray-300'
                    }
                  `}
                  title={tab.cartNumber} // Show full cart number on hover
                >
                  <ShoppingCart className={`h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0 ${hasItems && !isActive ? 'text-blue-600' : ''}`} />
                  <span className="text-[10px] sm:text-sm font-medium truncate flex-1" title={displayName}>
                    {displayName}
                  </span>
                  {hasItems && (
                    <span className={`
                      flex items-center justify-center min-w-[18px] sm:min-w-[24px] h-4 sm:h-5 px-1 sm:px-1.5 rounded-md text-[10px] sm:text-xs font-bold
                      transition-all duration-200 transform hover:scale-110 flex-shrink-0
                      ${isActive
                        ? 'bg-white text-blue-600 shadow-lg ring-2 ring-blue-300'
                        : 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg ring-2 ring-blue-300'
                      }
                    `}>
                      {itemCount}
                    </span>
                  )}
                  {!hasItems && (
                    <span className="w-4 sm:w-6 flex-shrink-0" aria-hidden="true"></span>
                  )}
                  {/* Only show close button if there's more than one tab */}
                  {cartTabs.length > 1 && (
                    <button
                      onClick={(e) => handleTabClose(e, tab.id)}
                      className={`
                        ml-0.5 sm:ml-1 p-0.5 rounded hover:bg-opacity-20 transition-colors flex-shrink-0
                        ${isActive ? 'hover:bg-white' : 'hover:bg-gray-300'}
                      `}
                      title="Close tab"
                    >
                      <X className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                    </button>
                  )}
                  {cartTabs.length === 1 && (
                    <span className="w-4 sm:w-6 flex-shrink-0" aria-hidden="true"></span>
                  )}
                </div>
              );
            })}
          </div>
          {/* + button - outside the scrollable area */}
          <button
            onClick={handleNewSale}
            disabled={createCartMutation.isPending}
            className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-md hover:shadow-lg flex-shrink-0"
            title="New Sale"
          >
            <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3 sm:space-y-4">
          {/* Customer and Invoice Type - Side by Side */}
          <div className="bg-white rounded-2xl shadow p-4 sm:p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
              {/* Customer Selector */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2.5">
                  <User className="h-4 w-4 inline mr-1.5" />
                  Customer
                </label>
                <div className="relative">
                  {/* Show selected customer as chip inside input when not searching */}
                  {selectedCustomer && !customerSearch && (
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex items-center pointer-events-none">
                      <div className="flex items-center gap-1.5 bg-blue-100 text-blue-800 px-2.5 py-1.5 rounded-md border border-blue-300 shadow-sm pointer-events-auto">
                        <User className="h-4 w-4 flex-shrink-0" />
                        <span className="text-sm font-semibold truncate max-w-[140px] sm:max-w-[220px]">
                          {selectedCustomer.name || `Customer #${selectedCustomer.id}`}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setSelectedCustomer(null);
                            updateCartMutation.mutate({ customer: null });
                          }}
                          className="ml-1 p-0.5 rounded hover:bg-blue-200 text-blue-700 hover:text-blue-900 transition-colors flex-shrink-0"
                          title="Remove customer"
                          type="button"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                  <Input
                    placeholder={selectedCustomer && !customerSearch ? "" : "Search customer by name or phone..."}
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setCustomerSearchSelectedIndex(-1);
                      // Clear selected customer when user starts typing
                      if (e.target.value.trim() && selectedCustomer) {
                        setSelectedCustomer(null);
                        updateCartMutation.mutate({ customer: null });
                      }
                    }}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === 'Enter' && customerSearch.trim()) {
                        e.preventDefault();
                        if (customersResponse) {
                          const customers = (() => {
                            if (Array.isArray(customersResponse.results)) return customersResponse.results;
                            if (Array.isArray(customersResponse.data)) return customersResponse.data;
                            if (Array.isArray(customersResponse)) return customersResponse;
                            return [];
                          })();
                          if (customers.length > 0 && customerSearchSelectedIndex >= 0 && customerSearchSelectedIndex < customers.length) {
                            // Select highlighted customer
                            const customer = customers[customerSearchSelectedIndex];
                            setSelectedCustomer(customer);
                            setCustomerSearch('');
                            setCustomerSearchSelectedIndex(-1);
                            updateCartMutation.mutate({ customer: customer.id });
                          } else if (customers.length === 0) {
                            // Create new customer
                            setNewCustomerName(customerSearch.trim());
                            setShowCreateCustomerModal(true);
                          }
                        }
                      } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        if (customersResponse) {
                          const customers = (() => {
                            if (Array.isArray(customersResponse.results)) return customersResponse.results;
                            if (Array.isArray(customersResponse.data)) return customersResponse.data;
                            if (Array.isArray(customersResponse)) return customersResponse;
                            return [];
                          })();
                          const maxIndex = customers.length > 0 ? customers.length - 1 : 0;
                          setCustomerSearchSelectedIndex(prev => prev < maxIndex ? prev + 1 : prev);
                        }
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setCustomerSearchSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
                      } else if (e.key === 'Escape') {
                        setCustomerSearchSelectedIndex(-1);
                        setCustomerSearch('');
                      }
                    }}
                    className={`w-full h-11 text-sm font-medium border-2 rounded-lg transition-all ${selectedCustomer && !customerSearch
                      ? 'pl-[155px] sm:pl-[240px]'
                      : ''
                      }`}
                  />
                  {customerSearch && customersResponse && (() => {
                    const customers = (() => {
                      if (Array.isArray(customersResponse.results)) return customersResponse.results;
                      if (Array.isArray(customersResponse.data)) return customersResponse.data;
                      if (Array.isArray(customersResponse)) return customersResponse;
                      return [];
                    })();
                    if (customers.length > 0) {
                      return (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {customers.map((customer: any, index: number) => {
                            const isSelected = index === customerSearchSelectedIndex;
                            return (
                              <button
                                key={customer.id}
                                onClick={() => {
                                  setSelectedCustomer(customer);
                                  setCustomerSearch('');
                                  setCustomerSearchSelectedIndex(-1);
                                  updateCartMutation.mutate({ customer: customer.id });
                                }}
                                className={`w-full text-left px-4 py-2 border-b last:border-b-0 ${isSelected ? 'bg-blue-100' : 'hover:bg-blue-50'
                                  }`}
                                onMouseEnter={() => setCustomerSearchSelectedIndex(index)}
                              >
                                <div className="font-medium">{customer.name}</div>
                                {customer.phone && (
                                  <div className="text-sm text-gray-500">{customer.phone}</div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    } else {
                      // Show "Create New Customer" option when no results found
                      const isCreateSelected = customerSearchSelectedIndex === 0;
                      return (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
                          <button
                            onClick={() => {
                              // Pre-fill name if search looks like a name
                              setNewCustomerName(customerSearch.trim());
                              setShowCreateCustomerModal(true);
                              setCustomerSearchSelectedIndex(-1);
                            }}
                            className={`w-full text-left px-4 py-3 border-b last:border-b-0 flex items-center gap-2 text-blue-600 ${isCreateSelected ? 'bg-blue-100' : 'hover:bg-blue-50'
                              }`}
                            onMouseEnter={() => setCustomerSearchSelectedIndex(0)}
                          >
                            <UserPlus className="h-4 w-4" />
                            <div>
                              <div className="font-medium">Create New Customer</div>
                              <div className="text-sm text-gray-500">"{customerSearch}"</div>
                            </div>
                          </button>
                        </div>
                      );
                    }
                  })()}
                </div>
              </div>

              {/* Invoice Type Selector */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2.5">
                  <FileText className="h-4 w-4 inline mr-1.5" />
                  Invoice Type
                  {defaultStore?.shop_type === 'repair' && (
                    <span className="ml-2 text-xs text-blue-600 font-normal">
                      (Repair shop - use PENDING for repair invoices)
                    </span>
                  )}
                  {isWholesaleGroup && (
                    <span className="ml-2 text-xs text-orange-600 font-normal">
                      (Wholesale - PENDING invoices only)
                    </span>
                  )}
                </label>
                <Select
                  value={invoiceType}
                  onChange={(e) => {
                    const newType = e.target.value as 'cash' | 'upi' | 'pending' | 'mixed';
                    setInvoiceType(newType);
                    // Clear split amounts when switching away from mixed
                    if (newType !== 'mixed') {
                      setCashAmount('');
                      setUpiAmount('');
                    }
                    updateCartMutation.mutate({ invoice_type: frontendToBackendInvoiceType(newType) });
                  }}
                  className="w-full h-11 text-sm font-semibold py-2.5 px-3 border-2 rounded-lg hover:border-gray-400 cursor-pointer transition-all"
                  disabled={isWholesaleGroup}
                >
                  <option value="cash">CASH</option>
                  <option value="upi">UPI</option>
                  <option value="mixed">CASH + UPI</option>
                  <option value="pending">PENDING</option>
                </Select>
                {defaultStore?.shop_type === 'repair' && (
                  <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-3">
                      <Wrench className="h-4 w-4 text-blue-600" />
                      <span className="text-sm font-semibold text-blue-900">Repair Information</span>
                    </div>

                    {/* Contact Number */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                        <Phone className="h-3.5 w-3.5 inline mr-1" />
                        Contact Number <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="tel"
                        placeholder="Enter contact number"
                        value={repairContactNo}
                        onChange={(e) => setRepairContactNo(e.target.value)}
                        className="w-full text-sm"
                      />
                    </div>

                    {/* Model Name */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                        <Package className="h-3.5 w-3.5 inline mr-1" />
                        Model Name <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="text"
                        placeholder="Enter device model name"
                        value={repairModelName}
                        onChange={(e) => setRepairModelName(e.target.value)}
                        className="w-full text-sm"
                      />
                    </div>

                    {/* Booking Amount */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                        <DollarSign className="h-3.5 w-3.5 inline mr-1" />
                        Booking Amount
                      </label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={repairBookingAmount}
                        onChange={(e) => setRepairBookingAmount(e.target.value)}
                        className="w-full text-sm"
                      />
                      <p className="text-xs text-gray-500 mt-1">Optional: Enter the booking amount received</p>
                    </div>
                  </div>
                )}
                {/* Split Payment Inputs for Mixed Type */}
                {invoiceType === 'mixed' && (
                  <div className="mt-3 space-y-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-blue-900 mb-2">
                      <FileText className="h-3.5 w-3.5" />
                      Split Payment Amounts
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Cash Amount (₹)</label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={cashAmount}
                          onChange={(e) => {
                            const value = e.target.value;
                            setCashAmount(value);
                            // Auto-calculate UPI amount if total is known
                            if (cart?.data && value) {
                              const total = calculateTotal();
                              const cash = parseFloat(value) || 0;
                              const remaining = Math.max(0, total - cash);
                              setUpiAmount(remaining.toFixed(2));
                            }
                          }}
                          className="w-full text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">UPI Amount (₹)</label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={upiAmount}
                          onChange={(e) => {
                            const value = e.target.value;
                            setUpiAmount(value);
                            // Auto-calculate Cash amount if total is known
                            if (cart?.data && value) {
                              const total = calculateTotal();
                              const upi = parseFloat(value) || 0;
                              const remaining = Math.max(0, total - upi);
                              setCashAmount(remaining.toFixed(2));
                            }
                          }}
                          className="w-full text-xs"
                        />
                      </div>
                    </div>
                    {cart?.data && cashAmount && upiAmount && (
                      <div className="text-xs mt-2">
                        <span className="text-gray-600">Total: </span>
                        <span className={`font-semibold ${(parseFloat(cashAmount) + parseFloat(upiAmount)).toFixed(2) === calculateTotal().toFixed(2) ? 'text-green-600' : 'text-red-600'}`}>
                          ₹{(parseFloat(cashAmount) + parseFloat(upiAmount)).toFixed(2)}
                        </span>
                        <span className="text-gray-600"> / Invoice Total: ₹{calculateTotal().toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Product Search Field */}
          <div className="bg-white rounded-2xl shadow p-3 sm:p-4">
            <div>
              {isSearchTyped && !showScanner && (
                <div className="flex items-center space-x-2 text-xs mb-2 text-amber-600">
                  <AlertTriangle className="h-4 w-4" />
                  <span>KINDLY USE BARCODE OR USE CORRECT SKU</span>
                </div>
              )}
              <div className="relative">
                <input
                  ref={barcodeInputRef}
                  type="text"
                  placeholder="Search products by name, SKU, or scan QR code..."
                  value={barcodeInput}
                  autoComplete="off"
                  onChange={(e) => {
                    const newValue = e.target.value;
                    const trimmedValue = newValue.trim();

                    // Don't clear input in onChange - let physical scanners finish typing
                    // We'll check and clear in onKeyDown after Enter is pressed

                    // Close camera scanner if user starts typing/searching
                    if (showScanner) {
                      setShowScanner(false);
                    }

                    setBarcodeInput(newValue);
                    setIsSearchTyped(trimmedValue.length > 0);
                    setProductSearchSelectedIndex(-1); // Reset selection when typing
                    // Clear sold status when user types
                    if (searchedBarcodeStatus) {
                      setSearchedBarcodeStatus(null);
                    }
                  }}
                  onInput={(e) => {
                    // Handle physical barcode scanner input
                    // Physical scanners often send data very fast, this ensures we capture it
                    // Always update from DOM to ensure we have the latest value
                    const target = e.target as HTMLInputElement;
                    const currentValue = target.value;
                    // Update state if different to ensure React state is in sync
                    if (currentValue !== barcodeInput) {
                      setBarcodeInput(currentValue);
                      setIsSearchTyped(currentValue.trim().length > 0);
                    }
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();

                      // CRITICAL: Get value directly from DOM element, not from state
                      // Physical scanners type faster than React state updates, so we must read from DOM
                      const inputElement = e.currentTarget as HTMLInputElement;
                      const barcodeToScan = (inputElement.value || '').trim();

                      // If barcode is empty, don't process
                      if (!barcodeToScan) {
                        return;
                      }

                      // UI-LEVEL CHECK: If the barcode is already in cart, clear and show message
                      if (cart?.data?.items && Array.isArray(cart.data.items)) {
                        for (const item of cart.data.items) {
                          const scannedBarcodes = item.scanned_barcodes || [];
                          if (scannedBarcodes.some((bc: string) => bc && typeof bc === 'string' && bc.trim() === barcodeToScan)) {
                            // Barcode already in cart - clear input and show message
                            setBarcodeInput('');
                            setIsSearchTyped(false);
                            setProductSearchSelectedIndex(-1);
                            setBarcodeStatus('success');
                            setBarcodeMessage('Item already in cart');
                            setTimeout(() => {
                              setBarcodeStatus('idle');
                              setBarcodeMessage('');
                            }, 1500);
                            return; // Don't proceed with scanning
                          }
                        }
                      }

                      // Check if custom option is selected
                      const searchLower = debouncedBarcodeInput.trim().toLowerCase();
                      const showCustomOption = searchLower === 'other' || searchLower === 'custom' || searchLower.startsWith('other ') || searchLower.startsWith('custom ');

                      if (productSearchSelectedIndex === 0 && showCustomOption) {
                        e.preventDefault();
                        setShowCustomProductModal(true);
                        setBarcodeInput('');
                        setProductSearchSelectedIndex(-1);
                        return;
                      }

                      // If a product is selected in dropdown, select it instead of scanning
                      if (productSearchSelectedIndex >= 0 && products) {
                        const productList = (() => {
                          if (Array.isArray(products?.results)) return products.results;
                          if (Array.isArray(products?.data)) return products.data;
                          if (Array.isArray(products)) return products;
                          return [];
                        })();
                        // Adjust index if custom option is shown
                        const actualIndex = showCustomOption ? productSearchSelectedIndex - 1 : productSearchSelectedIndex;
                        if (productList[actualIndex]) {
                          // Select the highlighted product
                          const product = productList[actualIndex];
                          const searchValue = barcodeToScan;

                          // Handle product selection (same logic as button onClick)
                          const handleProductSelect = async () => {
                            // Check stock availability before adding
                            // Custom products (with "Other -" prefix) are always available
                            const isCustomProduct = product.name && product.name.startsWith('Other -');
                            const trackInventory = product.track_inventory !== false;
                            const stockQuantity = product.stock_quantity || 0;
                            const availableQuantity = product.available_quantity || 0;

                            // Skip stock check for custom products
                            if (!isCustomProduct) {
                              if (trackInventory) {
                                if (stockQuantity <= 0 && availableQuantity <= 0) {
                                  const errorMsg = `Product "${product.name}" is not in stock. The purchase order may not be finalized yet, or the product has not been purchased.`;
                                  setBarcodeStatus('error');
                                  setBarcodeMessage(errorMsg);
                                  setTimeout(() => {
                                    setBarcodeStatus('idle');
                                    setBarcodeMessage('');
                                  }, 5000);
                                  return;
                                }
                              } else {
                                if (stockQuantity <= 0) {
                                  const errorMsg = `Product "${product.name}" is not in stock. The purchase order may not be finalized yet, or the product has not been purchased.`;
                                  setBarcodeStatus('error');
                                  setBarcodeMessage(errorMsg);
                                  setTimeout(() => {
                                    setBarcodeStatus('idle');
                                    setBarcodeMessage('');
                                  }, 5000);
                                  return;
                                }
                              }
                            }

                            if (searchValue && searchValue.length >= 3) {
                              // UI-LEVEL CHECK: Check if barcode is already in cart BEFORE API call
                              if (cart?.data?.items && Array.isArray(cart.data.items)) {
                                for (const item of cart.data.items) {
                                  const scannedBarcodes = item.scanned_barcodes || [];
                                  if (scannedBarcodes.some((bc: string) => bc && typeof bc === 'string' && bc.trim() === searchValue)) {
                                    // Barcode already in cart - show message and return
                                    setBarcodeInput('');
                                    setProductSearchSelectedIndex(-1);
                                    setBarcodeStatus('success');
                                    setBarcodeMessage('Item already in cart');
                                    setTimeout(() => {
                                      setBarcodeStatus('idle');
                                      setBarcodeMessage('');
                                    }, 1500);
                                    return;
                                  }
                                }
                              }

                              try {
                                // Use barcode_only=true to only search in Barcode table, not Product SKU
                                const barcodeCheck = await productsApi.byBarcode(searchValue, strictBarcodeMode);
                                if (barcodeCheck.data) {
                                  if (barcodeCheck.data.barcode_available === false) {
                                    const errorMsg = barcodeCheck.data.sold_invoice
                                      ? `This item (SKU: ${barcodeCheck.data.matched_barcode || searchValue}) has already been sold and is assigned to invoice ${barcodeCheck.data.sold_invoice}. It is not available in inventory.`
                                      : `This item (SKU: ${barcodeCheck.data.matched_barcode || searchValue}) has already been sold and is not available in inventory.`;
                                    setBarcodeStatus('error');
                                    setBarcodeMessage(errorMsg);
                                    setTimeout(() => {
                                      setBarcodeStatus('idle');
                                      setBarcodeMessage('');
                                    }, 5000);
                                    return;
                                  }
                                  addItemMutation.mutate({
                                    product: product.id,
                                    quantity: 1,
                                    unit_price: 0, // Price must be entered manually
                                    barcode: barcodeCheck.data.matched_barcode || searchValue,
                                  });
                                  setBarcodeInput('');
                                  setProductSearchSelectedIndex(-1);
                                  return;
                                }
                              } catch (error: any) {
                                if (error?.response?.data?.barcode_available === false ||
                                  error?.message?.includes('already been sold')) {
                                  const errorMsg = error?.response?.data?.sold_invoice
                                    ? `This item (SKU: ${searchValue}) has already been sold and is assigned to invoice ${error.response.data.sold_invoice}. It is not available in inventory.`
                                    : `This item (SKU: ${searchValue}) has already been sold and is not available in inventory.`;
                                  setBarcodeStatus('error');
                                  setBarcodeMessage(errorMsg);
                                  setTimeout(() => {
                                    setBarcodeStatus('idle');
                                    setBarcodeMessage('');
                                  }, 5000);
                                  return;
                                }
                              }
                            }
                            // Default: add product without barcode (backend will pick available one)
                            addItemMutation.mutate({
                              product: product.id,
                              quantity: 1,
                              unit_price: 0, // Price must be entered manually
                            });
                            setBarcodeInput('');
                            setProductSearchSelectedIndex(-1);
                          };

                          handleProductSelect();
                          return; // Don't proceed with handleBarcodeScan
                        }
                      }
                      // Queue Implementation for rapid scanning
                      // Split input by newlines or pipes (common descriptors) in case multiple scans were pasted or buffered
                      const barcodes = barcodeToScan.split(/[\n|]+/).map(s => s.trim()).filter(Boolean);

                      if (barcodes.length > 0) {
                        addToQueue(barcodes);
                        setBarcodeInput('');
                        setIsSearchTyped(false);
                        setProductSearchSelectedIndex(-1);
                      }
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      const searchLower = debouncedBarcodeInput.trim().toLowerCase();
                      const showCustomOption = searchLower === 'other' || searchLower === 'custom' || searchLower.startsWith('other ') || searchLower.startsWith('custom ');

                      if (products && !searchedBarcodeStatus?.isUnavailable) {
                        const productList = (() => {
                          if (Array.isArray(products?.results)) return products.results;
                          if (Array.isArray(products?.data)) return products.data;
                          if (Array.isArray(products)) return products;
                          return [];
                        })();

                        // If custom option is shown and we're at -1, go to 0 (custom option)
                        if (showCustomOption && productSearchSelectedIndex === -1) {
                          setProductSearchSelectedIndex(0);
                          return;
                        }

                        if (productList.length > 0) {
                          // Find next available (in-stock) product
                          const findNextAvailable = (startIndex: number) => {
                            const start = showCustomOption ? Math.max(0, startIndex) : startIndex;
                            for (let i = start + 1; i < (showCustomOption ? productList.length + 1 : productList.length); i++) {
                              if (showCustomOption && i === 0) return 0; // Custom option
                              const p = productList[showCustomOption ? i - 1 : i];
                              // Custom products (with "Other -" prefix) are always available
                              const isCustomProduct = p.name && p.name.startsWith('Other -');
                              const trackInv = p.track_inventory !== false;
                              const stockQty = p.stock_quantity || 0;
                              const availQty = p.available_quantity || 0;
                              const isAvailable = isCustomProduct
                                ? true // Custom products are always available
                                : trackInv
                                  ? (stockQty > 0 || availQty > 0)
                                  : (stockQty > 0);
                              if (isAvailable) return showCustomOption ? i : i;
                            }
                            return startIndex; // Stay on current if no available products found
                          };
                          setProductSearchSelectedIndex(prev => findNextAvailable(prev));
                        } else if (showCustomOption && productSearchSelectedIndex === -1) {
                          setProductSearchSelectedIndex(0);
                        }
                      } else if (showCustomOption && productSearchSelectedIndex === -1) {
                        setProductSearchSelectedIndex(0);
                      }
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      const searchLower = debouncedBarcodeInput.trim().toLowerCase();
                      const showCustomOption = searchLower === 'other' || searchLower === 'custom' || searchLower.startsWith('other ') || searchLower.startsWith('custom ');

                      if (products && !searchedBarcodeStatus?.isUnavailable) {
                        const productList = (() => {
                          if (Array.isArray(products?.results)) return products.results;
                          if (Array.isArray(products?.data)) return products.data;
                          if (Array.isArray(products)) return products;
                          return [];
                        })();

                        // If at custom option (index 0), go to -1
                        if (showCustomOption && productSearchSelectedIndex === 0) {
                          setProductSearchSelectedIndex(-1);
                          return;
                        }

                        // Find previous available (in-stock) product
                        const findPrevAvailable = (startIndex: number) => {
                          const start = showCustomOption ? Math.max(1, startIndex) : startIndex;
                          for (let i = start - 1; i >= (showCustomOption ? 0 : -1); i--) {
                            if (showCustomOption && i === 0) return 0; // Custom option
                            if (i < 0) return -1;
                            const p = productList[showCustomOption ? i - 1 : i];
                            // Custom products (with "Other -" prefix) are always available
                            const isCustomProduct = p.name && p.name.startsWith('Other -');
                            const trackInv = p.track_inventory !== false;
                            const stockQty = p.stock_quantity || 0;
                            const availQty = p.available_quantity || 0;
                            const isAvailable = isCustomProduct
                              ? true // Custom products are always available
                              : trackInv
                                ? (stockQty > 0 || availQty > 0)
                                : (stockQty > 0);
                            if (isAvailable) return showCustomOption ? i : i;
                          }
                          return showCustomOption ? 0 : -1; // Go to custom option or -1
                        };
                        setProductSearchSelectedIndex(prev => findPrevAvailable(prev));
                      } else {
                        const searchLower = debouncedBarcodeInput.trim().toLowerCase();
                        const showCustomOption = searchLower === 'other' || searchLower === 'custom' || searchLower.startsWith('other ') || searchLower.startsWith('custom ');
                        if (showCustomOption && productSearchSelectedIndex > 0) {
                          setProductSearchSelectedIndex(prev => prev - 1);
                        } else if (showCustomOption && productSearchSelectedIndex === 0) {
                          setProductSearchSelectedIndex(-1);
                        } else {
                          setProductSearchSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
                        }
                      }
                    } else if (e.key === 'Escape') {
                      setProductSearchSelectedIndex(-1);
                      setBarcodeInput('');
                    } else if (e.key === 'Enter' && productSearchSelectedIndex === 0) {
                      // Handle Enter key on custom option
                      const searchLower = debouncedBarcodeInput.trim().toLowerCase();
                      const showCustomOption = searchLower === 'other' || searchLower === 'custom' || searchLower.startsWith('other ') || searchLower.startsWith('custom ');
                      if (showCustomOption) {
                        e.preventDefault();
                        setShowCustomProductModal(true);
                        setBarcodeInput('');
                        setProductSearchSelectedIndex(-1);
                      }
                    }
                  }}
                  className={`block w-full pl-10 pr-28 py-2.5 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${barcodeStatus === 'error'
                    ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                    : barcodeStatus === 'success'
                      ? 'border-green-500 focus:border-green-500 focus:ring-green-500'
                      : 'border-gray-300'
                    }`}
                />
                <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none">
                  <Search className="h-5 w-5 text-gray-400" />
                </div>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex gap-1">
                  <Button
                    onClick={() => setStrictBarcodeMode(!strictBarcodeMode)}
                    variant="outline"
                    size="sm"
                    className={`whitespace-nowrap transition-all ${strictBarcodeMode
                      ? '!bg-blue-600 !text-white !border-blue-600 hover:!bg-blue-700 hover:!border-blue-700'
                      : '!bg-white !text-gray-600 !border-gray-300 hover:!bg-gray-50'
                      }`}
                    title={strictBarcodeMode ? "Strict barcode matching (ON)" : "Flexible search (OFF)"}
                  >
                    <Barcode className="h-4 w-4" />
                  </Button>
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
                {/* Queue Display */}
                {scanQueue.length > 0 && (
                  <div className="absolute z-50 w-full mb-1 bottom-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-40 overflow-y-auto mb-2">
                    <div className="p-2 border-b border-gray-100 bg-gray-50 flex justify-between items-center sticky top-0 z-10">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Scanning Queue</h4>
                      <button onClick={() => setScanQueue([])} className="text-xs text-blue-600 hover:text-blue-800">Clear</button>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {[...scanQueue].reverse().map(item => (
                        <div key={item.id} className="p-2 flex items-center justify-between text-sm hover:bg-gray-50">
                          <div className="flex items-center gap-3">
                            {item.status === 'pending' && <span className="w-2 h-2 rounded-full bg-gray-400 animate-pulse"></span>}
                            {item.status === 'processing' && <Sparkles className="h-4 w-4 text-blue-500 animate-spin" />}
                            {item.status === 'success' && <CheckCircle className="h-4 w-4 text-green-500" />}
                            {item.status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                            <div className="flex flex-col">
                              <span className={`font-mono font-medium ${item.status === 'success' ? 'text-gray-900' : 'text-gray-600'}`}>
                                {item.code}
                              </span>
                              {item.message && (
                                <span className={`text-xs ${item.status === 'error' ? 'text-red-500' :
                                  item.status === 'success' ? 'text-green-600' : 'text-gray-400'
                                  }`}>
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

                {/* Search Results Dropdown */}
                {(() => {
                  if (!barcodeInput.trim()) return null;

                  // Show status message if searched barcode is unavailable
                  if (searchedBarcodeStatus?.isUnavailable) {
                    const tag = searchedBarcodeStatus.tag || 'unknown';
                    // Different styling based on tag
                    const getTagStyles = (tag: string) => {
                      switch (tag) {
                        case 'sold':
                          return {
                            border: 'border-red-200',
                            bg: 'bg-red-50',
                            iconColor: 'text-red-600',
                            titleColor: 'text-red-900',
                            textColor: 'text-red-700'
                          };
                        case 'returned':
                          return {
                            border: 'border-blue-200',
                            bg: 'bg-blue-50',
                            iconColor: 'text-blue-600',
                            titleColor: 'text-blue-900',
                            textColor: 'text-blue-700'
                          };
                        case 'unknown':
                          return {
                            border: 'border-yellow-200',
                            bg: 'bg-yellow-50',
                            iconColor: 'text-yellow-600',
                            titleColor: 'text-yellow-900',
                            textColor: 'text-yellow-700'
                          };
                        case 'defective':
                          return {
                            border: 'border-orange-200',
                            bg: 'bg-orange-50',
                            iconColor: 'text-orange-600',
                            titleColor: 'text-orange-900',
                            textColor: 'text-orange-700'
                          };
                        default:
                          return {
                            border: 'border-gray-200',
                            bg: 'bg-gray-50',
                            iconColor: 'text-gray-600',
                            titleColor: 'text-gray-900',
                            textColor: 'text-gray-700'
                          };
                      }
                    };

                    const styles = getTagStyles(tag);
                    const getTagTitle = (tag: string) => {
                      switch (tag) {
                        case 'sold': return 'Item Sold';
                        case 'returned': return 'Item Returned';
                        case 'unknown': return 'Item Under Processing';
                        case 'defective': return 'Item Defective';
                        default: return 'Item Not Available';
                      }
                    };

                    return (
                      <div className={`absolute top-full left-0 mt-2 border ${styles.border} rounded-lg ${styles.bg} shadow-xl z-20 w-full`}>
                        <div className="px-4 py-4">
                          <div className="flex items-start gap-3">
                            <XCircle className={`h-5 w-5 ${styles.iconColor} flex-shrink-0 mt-0.5`} />
                            <div className="flex-1">
                              <p className={`text-sm font-medium ${styles.titleColor}`}>{getTagTitle(tag)}</p>
                              <p className={`text-xs ${styles.textColor} mt-1`}>{searchedBarcodeStatus.message}</p>
                              {searchedBarcodeStatus.barcode && (
                                <p className={`text-xs ${styles.textColor} mt-1 opacity-75`}>
                                  SKU: {searchedBarcodeStatus.barcode}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // Include barcode-check product if available and not unavailable
                  const barcodeCheckProduct = _barcodeCheck?.product && !_barcodeCheck?.isUnavailable
                    ? _barcodeCheck.product
                    : null;

                  if (!products && !barcodeCheckProduct) return null;

                  const productList = (() => {
                    const list: any[] = [];

                    // First, add barcode-check product if available (highest priority)
                    if (barcodeCheckProduct) {
                      list.push(barcodeCheckProduct);
                    }

                    // Then add products from search results
                    if (products) {
                      if (Array.isArray(products?.results)) {
                        // Filter out duplicate if barcode-check product is already in results
                        const existingIds = new Set(list.map(p => p.id));
                        list.push(...products.results.filter((p: any) => !existingIds.has(p.id)));
                      } else if (Array.isArray(products?.data)) {
                        const existingIds = new Set(list.map(p => p.id));
                        list.push(...products.data.filter((p: any) => !existingIds.has(p.id)));
                      } else if (Array.isArray(products)) {
                        const existingIds = new Set(list.map(p => p.id));
                        list.push(...products.filter((p: any) => !existingIds.has(p.id)));
                      }
                    }

                    return list;
                  })();

                  // Check if search input matches "other" or "custom" to show custom product option
                  const searchLower = debouncedBarcodeInput.trim().toLowerCase();
                  const showCustomOption = searchLower === 'other' || searchLower === 'custom' || searchLower.startsWith('other ') || searchLower.startsWith('custom ');

                  if (productList.length === 0 && !showCustomOption) {
                    return (
                      <div className="absolute top-full left-0 mt-2 border border-gray-200 rounded-lg bg-white shadow-xl z-20 w-full">
                        <div className="px-4 py-6 text-center text-sm text-gray-500">
                          No products found
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="absolute top-full left-0 mt-2 border border-gray-200 rounded-lg bg-white shadow-xl z-20 w-full overflow-hidden">
                      <div className="max-h-64 overflow-y-auto">
                        {/* Custom Product Option */}
                        {showCustomOption && (
                          <button
                            onClick={() => {
                              setShowCustomProductModal(true);
                              setBarcodeInput('');
                              setProductSearchSelectedIndex(-1);
                            }}
                            className={`w-full text-left px-4 py-3 transition-colors border-b border-gray-100 group ${productSearchSelectedIndex === 0
                              ? 'bg-blue-100 hover:bg-blue-100'
                              : 'hover:bg-blue-50 active:bg-blue-100'
                              }`}
                            onMouseEnter={() => {
                              setProductSearchSelectedIndex(0);
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 group-hover:text-blue-900 flex items-center gap-2">
                                  <Package className="h-4 w-4 text-blue-600" />
                                  Add Custom Product (Other)
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                  Enter a product name that's not in inventory
                                </div>
                              </div>
                            </div>
                          </button>
                        )}
                        {productList.map((product: any, index: number) => {
                          // Adjust index for custom option
                          const adjustedIndex = showCustomOption ? index + 1 : index;
                          const isSelected = adjustedIndex === productSearchSelectedIndex;
                          // Check if product is available
                          // Custom products (with "Other -" prefix) are always available
                          const isCustomProduct = product.name && product.name.startsWith('Other -');
                          const trackInventory = product.track_inventory !== false;
                          const stockQuantity = product.stock_quantity || 0;
                          const availableQuantity = product.available_quantity || 0;
                          const isOutOfStock = isCustomProduct
                            ? false // Custom products are always available
                            : trackInventory
                              ? (stockQuantity <= 0 && availableQuantity <= 0)
                              : (stockQuantity <= 0);

                          return (
                            <button
                              key={product.id}
                              onClick={async () => {
                                // Check stock availability before adding
                                if (isOutOfStock) {
                                  const errorMsg = `Product "${product.name}" is not in stock. The purchase order may not be finalized yet, or the product has not been purchased.`;
                                  setBarcodeStatus('error');
                                  setBarcodeMessage(errorMsg);
                                  setTimeout(() => {
                                    setBarcodeStatus('idle');
                                    setBarcodeMessage('');
                                  }, 5000);
                                  return; // Don't add to cart
                                }

                                const searchValue = barcodeInput.trim();

                                // If search input looks like a barcode/SKU (not just product name), check if it's sold
                                if (searchValue && searchValue.length >= 3) {
                                  // UI-LEVEL CHECK: Check if barcode is already in cart BEFORE API call
                                  if (cart?.data?.items && Array.isArray(cart.data.items)) {
                                    for (const item of cart.data.items) {
                                      const scannedBarcodes = item.scanned_barcodes || [];
                                      if (scannedBarcodes.some((bc: string) => bc && typeof bc === 'string' && bc.trim() === searchValue)) {
                                        // Barcode already in cart - show message and return
                                        setBarcodeInput('');
                                        setProductSearchSelectedIndex(-1);
                                        setBarcodeStatus('success');
                                        setBarcodeMessage('Item already in cart');
                                        setTimeout(() => {
                                          setBarcodeStatus('idle');
                                          setBarcodeMessage('');
                                        }, 1500);
                                        return; // Don't add to cart
                                      }
                                    }
                                  }

                                  try {
                                    // Try to check if it's a barcode that's sold
                                    // Use barcode_only=true to only search in Barcode table, not Product SKU
                                    const barcodeCheck = await productsApi.byBarcode(searchValue, strictBarcodeMode);
                                    if (barcodeCheck.data) {
                                      // If it's a barcode and it's sold, show error and prevent adding
                                      if (barcodeCheck.data.barcode_available === false) {
                                        const errorMsg = barcodeCheck.data.sold_invoice
                                          ? `This item (SKU: ${barcodeCheck.data.matched_barcode || searchValue}) has already been sold and is assigned to invoice ${barcodeCheck.data.sold_invoice}. It is not available in inventory.`
                                          : `This item (SKU: ${barcodeCheck.data.matched_barcode || searchValue}) has already been sold and is not available in inventory.`;
                                        setBarcodeStatus('error');
                                        setBarcodeMessage(errorMsg);
                                        setTimeout(() => {
                                          setBarcodeStatus('idle');
                                          setBarcodeMessage('');
                                        }, 5000);
                                        return; // Don't add to cart
                                      }
                                      // If barcode is available, use it
                                      addItemMutation.mutate({
                                        product: product.id,
                                        quantity: 1,
                                        unit_price: 0, // Price must be entered manually
                                        barcode: barcodeCheck.data.matched_barcode || searchValue,
                                      });
                                      setBarcodeInput('');
                                      return;
                                    }
                                  } catch (error: any) {
                                    // If barcode check fails (404), it's not a barcode, proceed with name search
                                    // But if it's a sold error, show it
                                    if (error?.response?.data?.barcode_available === false ||
                                      error?.message?.includes('already been sold')) {
                                      const errorMsg = error?.response?.data?.sold_invoice
                                        ? `This item (SKU: ${searchValue}) has already been sold and is assigned to invoice ${error.response.data.sold_invoice}. It is not available in inventory.`
                                        : `This item (SKU: ${searchValue}) has already been sold and is not available in inventory.`;
                                      setBarcodeStatus('error');
                                      setBarcodeMessage(errorMsg);
                                      setTimeout(() => {
                                        setBarcodeStatus('idle');
                                        setBarcodeMessage('');
                                      }, 5000);
                                      return; // Don't add to cart
                                    }
                                    // If it's a 404, it's not a barcode, continue with name search below
                                  }
                                }

                                // When clicking from search dropdown, it's a name search
                                // Don't check for barcode - let backend pick random available SKU
                                addItemMutation.mutate({
                                  product: product.id,
                                  quantity: 1,
                                  unit_price: 0, // Price must be entered manually
                                  // Don't pass barcode - backend will find available barcode automatically
                                });
                                setBarcodeInput('');
                                setProductSearchSelectedIndex(-1);
                              }}
                              className={`w-full text-left px-4 py-3 transition-colors border-b border-gray-100 last:border-b-0 group ${isOutOfStock
                                ? 'bg-gray-50 cursor-not-allowed opacity-60'
                                : isSelected
                                  ? 'bg-blue-100 hover:bg-blue-100'
                                  : 'hover:bg-blue-50 active:bg-blue-100'
                                }`}
                              onMouseEnter={() => !isOutOfStock && setProductSearchSelectedIndex(adjustedIndex)}
                              disabled={isOutOfStock}
                              title={isOutOfStock ? 'Product is out of stock or purchase not finalized' : undefined}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className={`font-medium truncate flex items-center gap-2 ${isOutOfStock
                                    ? 'text-gray-500'
                                    : 'text-gray-900 group-hover:text-blue-900'
                                    }`}>
                                    {product.name}
                                    {isOutOfStock && (
                                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className={`text-xs ${isOutOfStock ? 'text-gray-400' : 'text-gray-500'
                                      }`}>
                                      {product.brand_name ? `Brand: ${product.brand_name} • ` : ''}
                                      {(() => {
                                        // If product came from barcode-check query, use the matched_barcode
                                        if (product.matched_barcode) {
                                          return `Barcode: ${product.matched_barcode}`;
                                        }

                                        // Otherwise, show barcode that matches search input, or first available barcode
                                        const searchValue = barcodeInput.trim().toUpperCase();
                                        const barcodes = product.barcodes || [];

                                        // Try to find barcode that matches search input
                                        let displayBarcode = null;
                                        if (searchValue && barcodes.length > 0) {
                                          // First try to find by short_code match
                                          const matchingShortCode = barcodes.find((b: any) =>
                                            b.short_code &&
                                            (b.short_code.toUpperCase().includes(searchValue) ||
                                              searchValue.includes(b.short_code.toUpperCase()))
                                          );
                                          if (matchingShortCode) {
                                            displayBarcode = matchingShortCode.short_code || matchingShortCode.barcode;
                                          } else {
                                            // Try to find by full barcode match
                                            const matchingBarcode = barcodes.find((b: any) =>
                                              b.barcode && b.barcode.toUpperCase().includes(searchValue)
                                            );
                                            if (matchingBarcode) {
                                              displayBarcode = matchingBarcode.short_code || matchingBarcode.barcode;
                                            }
                                          }
                                        }

                                        // If no match found, show first available barcode's short_code or barcode
                                        if (!displayBarcode && barcodes.length > 0) {
                                          const firstBarcode = barcodes[0];
                                          displayBarcode = firstBarcode.short_code || firstBarcode.barcode;
                                        }

                                        return displayBarcode ? `Barcode: ${displayBarcode}` : (product.sku ? `SKU: ${product.sku}` : '');
                                      })()}
                                    </span>
                                    {isOutOfStock && (
                                      <span className="text-xs text-amber-600 font-medium">
                                        • Out of Stock
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {isOutOfStock ? (
                                  <XCircle className="h-4 w-4 text-gray-400 flex-shrink-0 ml-3" />
                                ) : (
                                  <Plus className="h-4 w-4 text-gray-400 group-hover:text-blue-600 transition-colors flex-shrink-0 ml-3" />
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
              {barcodeMessage && (
                <div className={`flex items-center space-x-2 text-sm mt-2 ${barcodeStatus === 'success' ? 'text-green-600' : 'text-red-600'
                  }`}>
                  {barcodeStatus === 'success' ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  <span>{barcodeMessage}</span>
                </div>
              )}
            </div>

          </div>

          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Cart Items</h2>
              {(cart?.data?.items && Array.isArray(cart.data.items) && cart.data.items.length > 0) || selectedCustomer ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const hasItems = cart?.data?.items && Array.isArray(cart.data.items) && cart.data.items.length > 0;
                    const hasCustomer = !!selectedCustomer;
                    let confirmMessage = 'Are you sure you want to clear ';
                    if (hasItems && hasCustomer) {
                      confirmMessage += 'all items and customer from this cart?';
                    } else if (hasItems) {
                      confirmMessage += 'all items from this cart?';
                    } else if (hasCustomer) {
                      confirmMessage += 'customer from this cart?';
                    }

                    if (window.confirm(confirmMessage)) {
                      clearAllItemsMutation.mutate();
                    }
                  }}
                  disabled={clearAllItemsMutation.isPending || deleteItemMutation.isPending}
                  className="flex items-center gap-1.5 text-red-600 border-red-300 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {clearAllItemsMutation.isPending ? 'Clearing...' : 'Clear All'}
                  </span>
                </Button>
              ) : null}
            </div>
            {cart?.data?.items && Array.isArray(cart.data.items) && cart.data.items.length > 0 ? (
              <div className="space-y-3">
                {cart.data.items.map((item: any) => {
                  // Use editingManualPrice if user is typing, otherwise use saved price
                  const editingPrice = editingManualPrice[item.id];
                  const effectivePrice = editingPrice !== undefined && editingPrice !== ''
                    ? parseFloat(editingPrice) || 0
                    : (parseFloat(item.manual_unit_price) || parseFloat(item.unit_price) || 0);
                  const scannedBarcodes = item.scanned_barcodes || [];
                  const hasBarcodes = scannedBarcodes.length > 0;
                  const isBarcodesExpanded = expandedBarcodes[item.id] || false;
                  const lineTotal = effectivePrice * (parseInt(item.quantity || '0') || 0);
                  return (
                    <div key={item.id} className="bg-white border border-gray-300 rounded-lg p-3 shadow-sm hover:shadow-md transition-all">
                      {/* Mobile: Product name on top, then 2 rows for controls */}
                      {/* Desktop: Everything in one row */}
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        {/* Product Name - Full width on mobile, flex-1 on desktop */}
                        <div className="flex-1 min-w-0 sm:order-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-sm text-gray-900 break-words" title={item.product_brand_name ? `${item.product_name} - ${item.product_brand_name}` : item.product_name}>
                              {item.product_brand_name ? `${item.product_name} - ${item.product_brand_name}` : item.product_name}
                            </h3>
                            {/* Edit Product Button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingProductId(item.product);
                                setShowProductForm(true);
                              }}
                              className="p-1 text-gray-400 hover:text-blue-600 rounded-full hover:bg-gray-100 transition-colors flex-shrink-0"
                              title="Edit Product"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </button>
                            {/* Show barcode count if available - inline */}
                            {hasBarcodes && (
                              <button
                                onClick={() => setExpandedBarcodes({ ...expandedBarcodes, [item.id]: !isBarcodesExpanded })}
                                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 hover:bg-blue-100 transition-colors flex-shrink-0"
                                title={isBarcodesExpanded ? 'Hide barcodes' : 'Show barcodes'}
                              >
                                <Barcode className="h-3 w-3" />
                                <span>{scannedBarcodes.length}</span>
                                {isBarcodesExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Row 1 on Mobile: Quantity Controls */}
                        {/* Desktop: In same row */}
                        <div className="flex-shrink-0 sm:order-2">
                          {item.product_track_inventory === false ? (
                            <div className="flex items-center gap-0.5 bg-gray-50 rounded-md border border-gray-300">
                              <button
                                onClick={(e) => handleUpdateQuantity(item, -1, e)}
                                disabled={updateItemMutation.isPending || deleteItemMutation.isPending}
                                className="p-1.5 rounded-l-md text-gray-600 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                title="Decrease quantity"
                                type="button"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <div className="min-w-[2.5rem] px-2 py-1 text-center text-xs font-semibold text-gray-900 bg-white border-x border-gray-300">
                                {item.quantity}
                              </div>
                              <button
                                onClick={(e) => handleUpdateQuantity(item, 1, e)}
                                disabled={updateItemMutation.isPending}
                                className="p-1.5 rounded-r-md text-gray-600 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                title="Increase quantity"
                                type="button"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="px-2 py-1 bg-gray-100 rounded-md border border-gray-300">
                              <span className="text-xs font-semibold text-gray-700">Qty: {item.quantity}</span>
                            </div>
                          )}
                        </div>

                        {/* Row 2 on Mobile: Price, Total, Delete */}
                        {/* Desktop: In same row */}
                        <div className="flex items-center gap-2 sm:gap-3 flex-1 sm:flex-initial sm:order-3">
                          {/* Price Input */}
                          <div className="flex-shrink-0 flex-1 sm:flex-initial sm:w-28">
                            <div className="relative">
                              <div className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs font-medium">₹</div>
                              <Input
                                ref={(el) => {
                                  priceInputRefs.current[item.id] = el;
                                }}
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                value={editingManualPrice[item.id] ?? (item.manual_unit_price?.toString() || (item.unit_price && parseFloat(item.unit_price) > 0 ? item.unit_price.toString() : '') || '')}
                                onChange={(e) => {
                                  // Mark that user is typing in price input
                                  isTypingInPriceInput.current = true;

                                  const value = e.target.value;
                                  setEditingManualPrice({ ...editingManualPrice, [item.id]: value });

                                  // Validate selling price or purchase price for Cash/UPI/Mixed invoices only (if can_go_below_purchase_price is false)
                                  if (value && (invoiceType === 'cash' || invoiceType === 'upi' || invoiceType === 'mixed')) {
                                    const price = parseFloat(value);
                                    if (!isNaN(price) && price > 0) {
                                      // Check selling_price first, then fall back to purchase_price
                                      const sellingPrice = item.product_selling_price && item.product_selling_price > 0
                                        ? parseFloat(item.product_selling_price)
                                        : null;
                                      // Ensure we have a valid purchase price - if it's 0 or undefined, it might be cached
                                      let purchasePrice = parseFloat(item.product_purchase_price || '0');
                                      // Use selling_price if available and > 0, otherwise use purchase_price
                                      const minPrice = sellingPrice !== null && sellingPrice > 0 ? sellingPrice : purchasePrice;
                                      const canGoBelow = item.product_can_go_below_purchase_price || false;

                                      // Validate if canGoBelow is false
                                      // Note: If minPrice is 0, we can't validate on frontend, but backend will catch it
                                      if (!canGoBelow) {
                                        if (minPrice > 0 && price < minPrice) {
                                          // Price is below minimum - show error
                                          const priceType = sellingPrice !== null && sellingPrice > 0 ? 'selling price' : 'purchase price';
                                          setPriceErrors({
                                            ...priceErrors,
                                            [item.id]: `Price cannot be less than ${priceType} (₹${minPrice.toFixed(2)})`
                                          });
                                        } else if (minPrice === 0) {
                                          // Purchase price not available - clear error but backend will validate
                                          // Don't show error here as it might be cached data, backend will handle it
                                          const newErrors = { ...priceErrors };
                                          delete newErrors[item.id];
                                          setPriceErrors(newErrors);
                                        } else {
                                          // Price is valid - clear any errors
                                          const newErrors = { ...priceErrors };
                                          delete newErrors[item.id];
                                          setPriceErrors(newErrors);
                                        }
                                      } else {
                                        // canGoBelow is true - clear errors
                                        const newErrors = { ...priceErrors };
                                        delete newErrors[item.id];
                                        setPriceErrors(newErrors);
                                      }
                                    } else {
                                      // Invalid price or 0 - clear errors
                                      const newErrors = { ...priceErrors };
                                      delete newErrors[item.id];
                                      setPriceErrors(newErrors);
                                    }
                                  } else {
                                    // Clear errors for pending invoices or empty value
                                    const newErrors = { ...priceErrors };
                                    delete newErrors[item.id];
                                    setPriceErrors(newErrors);
                                  }
                                }}
                                onBlur={() => {
                                  // Reset typing flag after a short delay to allow state updates
                                  setTimeout(() => {
                                    isTypingInPriceInput.current = false;
                                  }, 100);

                                  const value = editingManualPrice[item.id];
                                  if (value !== undefined) {
                                    const price = parseFloat(value);
                                    if (!isNaN(price) && price > 0) {
                                      // Validate before saving (only for Cash/UPI/Mixed invoices)
                                      // Also check if there's already a price error set
                                      if (priceErrors[item.id]) {
                                        // Don't save if there's a validation error - clear editing state to revert
                                        const newEditingPrices = { ...editingManualPrice };
                                        delete newEditingPrices[item.id];
                                        setEditingManualPrice(newEditingPrices);
                                        return;
                                      }

                                      if (invoiceType === 'cash' || invoiceType === 'upi' || invoiceType === 'mixed') {
                                        // Check selling_price first, then fall back to purchase_price
                                        const sellingPrice = item.product_selling_price && item.product_selling_price > 0
                                          ? parseFloat(item.product_selling_price)
                                          : null;
                                        // Ensure we have a valid purchase price - if it's 0 or undefined, it might be cached
                                        let purchasePrice = parseFloat(item.product_purchase_price || '0');
                                        // Use selling_price if available and > 0, otherwise use purchase_price
                                        const minPrice = sellingPrice !== null && sellingPrice > 0 ? sellingPrice : purchasePrice;
                                        const canGoBelow = item.product_can_go_below_purchase_price || false;

                                        // Validate if canGoBelow is false
                                        if (!canGoBelow) {
                                          if (minPrice > 0 && price < minPrice) {
                                            // Price is below minimum - show error and don't save
                                            const priceType = sellingPrice !== null && sellingPrice > 0 ? 'selling price' : 'purchase price';
                                            setPriceErrors({
                                              ...priceErrors,
                                              [item.id]: `Price cannot be less than ${priceType} (₹${minPrice.toFixed(2)})`
                                            });
                                            // Don't save if validation fails - clear editing state to revert to saved value
                                            const newEditingPrices = { ...editingManualPrice };
                                            delete newEditingPrices[item.id];
                                            setEditingManualPrice(newEditingPrices);
                                            return;
                                          }
                                          // If minPrice is 0, we can't validate on frontend, but backend will catch it
                                          // Proceed with save and let backend validate
                                        }
                                      }
                                      // Save price for all invoice types (including pending)
                                      // Backend will validate even if frontend couldn't (e.g., when minPrice is 0)
                                      updateItemMutation.mutate({
                                        itemId: item.id,
                                        data: { manual_unit_price: price },
                                      });
                                      // Note: Editing state will be cleared in onSuccess handler of the mutation
                                      // If mutation fails, editing state is kept so user can see the error
                                    } else if (value === '' || price === 0) {
                                      // Clear price if empty or 0
                                      updateItemMutation.mutate({
                                        itemId: item.id,
                                        data: { manual_unit_price: null },
                                      });
                                      // Clear editing state
                                      const newEditingPrices = { ...editingManualPrice };
                                      delete newEditingPrices[item.id];
                                      setEditingManualPrice(newEditingPrices);
                                    }
                                  }
                                }}
                                onKeyPress={(e) => {
                                  if (e.key === 'Enter') {
                                    e.currentTarget.blur();
                                  }
                                }}
                                onFocus={(e) => {
                                  // Mark that user is focusing on price input
                                  isTypingInPriceInput.current = true;
                                  // Prevent auto-focus to barcode input when user clicks on price input
                                  e.stopPropagation();
                                }}
                                onKeyDown={() => {
                                  // Mark that user is typing in price input
                                  isTypingInPriceInput.current = true;
                                }}
                                className={`w-full pl-6 pr-2 py-1.5 text-xs font-semibold border rounded-md transition-all ${priceErrors[item.id]
                                  ? 'border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-200 bg-red-50'
                                  : 'border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white'
                                  }`}
                              />
                            </div>
                            {priceErrors[item.id] && (
                              <div className="mt-1 text-xs text-red-600 font-medium break-words whitespace-normal" title={priceErrors[item.id]}>
                                {priceErrors[item.id]}
                              </div>
                            )}
                          </div>

                          {/* Line Total */}
                          <div className="flex-shrink-0 text-right sm:w-24">
                            {invoiceType !== 'pending' || effectivePrice > 0 ? (
                              <div className="px-2 py-1.5 bg-blue-50 border border-blue-200 rounded-md">
                                <span className="text-xs font-bold text-blue-700">
                                  ₹{lineTotal.toFixed(2)}
                                </span>
                              </div>
                            ) : (
                              <div className="px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-md">
                                <span className="text-xs font-medium text-gray-400">—</span>
                              </div>
                            )}
                          </div>

                          {/* Delete Button */}
                          <div className="flex-shrink-0">
                            <button
                              onClick={() => deleteItemMutation.mutate(item.id)}
                              disabled={deleteItemMutation.isPending}
                              className="p-1.5 rounded-md text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 hover:border-red-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                              title="Remove item"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Scanned Barcodes Section - Expandable below the row */}
                      {hasBarcodes && isBarcodesExpanded && (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <div className="flex flex-wrap gap-2">
                            {scannedBarcodes.map((barcode: string, idx: number) => (
                              <div key={idx} className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-md px-2 py-1">
                                <Barcode className="h-3 w-3 text-blue-600" />
                                <span className="font-mono text-xs font-semibold text-gray-800">{barcode}</span>
                                <button
                                  onClick={() => {
                                    if (cartId) {
                                      posApi.carts.removeSku(cartId, item.id, barcode)
                                        .then(() => {
                                          queryClient.invalidateQueries({ queryKey: ['cart', cartId] });
                                          queryClient.invalidateQueries({ queryKey: ['products'] });
                                          queryClient.refetchQueries({ queryKey: ['products'] });
                                        })
                                        .catch((error: any) => {
                                          const errorMessage = error?.response?.data?.error || error?.response?.data?.message || 'Failed to remove SKU';
                                          showToast(errorMessage, 'error');
                                        });
                                    }
                                  }}
                                  className="p-0.5 rounded hover:bg-red-100 text-red-500 hover:text-red-700 transition-colors"
                                  title="Remove SKU"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-16">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gray-100 mb-4">
                  <ShoppingCart className="h-10 w-10 text-gray-400" />
                </div>
                <p className="text-lg font-semibold text-gray-600 mb-1">Cart is empty</p>
                <p className="text-sm text-gray-500">Add products to get started</p>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-1 space-y-4">
          {/* QR Code Scanner */}
          {showScanner && (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4">
              <BarcodeScanner
                isOpen={showScanner}
                continuous={true}
                onScan={async (barcode) => {
                  try {
                    await handleBarcodeScan(barcode);
                  } catch (error: any) {
                    // Error is already handled in handleBarcodeScan, but ensure it's displayed
                    const errorMsg = error?.message || error?.response?.data?.message || error?.response?.data?.error || 'Failed to process barcode scan';
                    setBarcodeStatus('error');
                    setBarcodeMessage(errorMsg);
                    const timeoutDuration = errorMsg.includes('already been sold') || errorMsg.includes('not available') || errorMsg.includes('not in stock') ? 5000 : 3000;
                    setTimeout(() => {
                      setBarcodeStatus('idle');
                      setBarcodeMessage('');
                    }, timeoutDuration);
                  }
                }}
                onClose={() => setShowScanner(false)}
              />
            </div>
          )}

          {/* Order Summary */}
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 sticky top-4">
            <div className="flex items-center gap-2 mb-6 pb-4 border-b border-gray-200">
              <FileText className="h-5 w-5 text-blue-600" />
              <h2 className="text-xl font-bold text-gray-900">Order Summary</h2>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex justify-between items-center py-2">
                <span className="text-sm font-medium text-gray-600">Total Quantity</span>
                <span className="text-sm font-semibold text-gray-900">{calculateTotalQuantity()}</span>
              </div>
              {invoiceType === 'pending' ? (
                // For pending invoices, show calculated total if some items have prices
                <>
                  {someItemsHaveZeroPrices() && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-xs font-medium text-amber-800">
                            Warning: Some items have zero price. Invoice will be saved with partial pricing.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm font-medium text-gray-600">Subtotal</span>
                    <span className="text-sm font-semibold text-gray-900">₹{calculateTotal().toFixed(2)}</span>
                  </div>
                  <div className="border-t-2 border-gray-200 pt-3 mt-3 flex justify-between items-center">
                    <span className="text-base font-bold text-gray-900">Total</span>
                    <span className="text-xl font-bold text-blue-600">₹{calculateTotal().toFixed(2)}</span>
                  </div>
                </>
              ) : (
                // For other invoice types, show calculated totals
                <>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm font-medium text-gray-600">Subtotal</span>
                    <span className="text-sm font-semibold text-gray-900">₹{calculateTotal().toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm font-medium text-gray-600">Tax</span>
                    <span className="text-sm font-semibold text-gray-900">₹0.00</span>
                  </div>
                  <div className="border-t-2 border-gray-200 pt-3 mt-3 flex justify-between items-center">
                    <span className="text-base font-bold text-gray-900">Total</span>
                    <span className="text-xl font-bold text-blue-600">₹{calculateTotal().toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>

            <div className="space-y-3">
              <Button
                className="w-full mb-2 shadow-md hover:shadow-lg transition-shadow"
                size="lg"
                onClick={handleCheckout}
                disabled={
                  checkoutMutation.isPending ||
                  !cart?.data?.items ||
                  cart.data.items.length === 0 ||
                  (invoiceType !== 'pending' && (!allItemsHavePrices() || hasPriceErrors())) ||
                  (invoiceType === 'mixed' && (!cashAmount || !upiAmount || parseFloat(cashAmount) <= 0 || parseFloat(upiAmount) <= 0))
                }
                title={
                  invoiceType === 'mixed' && (!cashAmount || !upiAmount || parseFloat(cashAmount) <= 0 || parseFloat(upiAmount) <= 0)
                    ? 'Please enter both cash and UPI amounts'
                    : invoiceType !== 'pending' && !allItemsHavePrices()
                      ? 'Please enter prices for all items'
                      : hasPriceErrors()
                        ? 'Please fix price validation errors'
                        : undefined
                }
              >
                {checkoutMutation.isPending ? 'Processing...' : 'Complete Order'}
              </Button>
              <Button
                className="w-full shadow-md hover:shadow-lg transition-shadow"
                size="lg"
                variant="outline"
                onClick={handleCheckoutAndPrintThermal}
                disabled={
                  checkoutAndPrintThermalMutation.isPending ||
                  !cart?.data?.items ||
                  cart.data.items.length === 0 ||
                  (invoiceType !== 'pending' && (!allItemsHavePrices() || hasPriceErrors())) ||
                  (invoiceType === 'mixed' && (!cashAmount || !upiAmount || parseFloat(cashAmount) <= 0 || parseFloat(upiAmount) <= 0))
                }
                title={
                  invoiceType === 'mixed' && (!cashAmount || !upiAmount || parseFloat(cashAmount) <= 0 || parseFloat(upiAmount) <= 0)
                    ? 'Please enter both cash and UPI amounts'
                    : invoiceType !== 'pending' && !allItemsHavePrices()
                      ? 'Please enter prices for all items'
                      : hasPriceErrors()
                        ? 'Please fix price validation errors'
                        : undefined
                }
              >
                {checkoutAndPrintThermalMutation.isPending ? 'Processing...' : 'Complete Order and Print Thermal'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Repair Modal */}
      <RepairModal
        isOpen={showRepairModal}
        onClose={() => setShowRepairModal(false)}
        onCheckout={handleRepairCheckout}
        customerName={selectedCustomer?.name || ''}
        isLoading={checkoutMutation.isPending}
      />

      {/* Create Customer Modal */}
      <Modal
        isOpen={showCreateCustomerModal}
        onClose={() => {
          setShowCreateCustomerModal(false);
          setNewCustomerName('');
          setNewCustomerPhone('');
        }}
        title="Create New Customer"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              placeholder="Enter customer name"
              value={newCustomerName}
              onChange={(e) => setNewCustomerName(e.target.value)}
              autoFocus
              onKeyPress={(e) => {
                if (e.key === 'Enter' && newCustomerName.trim()) {
                  createCustomerMutation.mutate({
                    name: newCustomerName.trim(),
                    phone: newCustomerPhone.trim() || undefined,
                  });
                }
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone Number
            </label>
            <Input
              type="tel"
              placeholder="Enter phone number (optional)"
              value={newCustomerPhone}
              onChange={(e) => setNewCustomerPhone(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && newCustomerName.trim()) {
                  createCustomerMutation.mutate({
                    name: newCustomerName.trim(),
                    phone: newCustomerPhone.trim() || undefined,
                  });
                }
              }}
            />
          </div>
          <div className="flex gap-3 pt-2">
            <Button
              onClick={() => {
                if (!newCustomerName.trim()) {
                  showToast('Customer name is required', 'error');
                  return;
                }
                createCustomerMutation.mutate({
                  name: newCustomerName.trim(),
                  phone: newCustomerPhone.trim() || undefined,
                });
              }}
              disabled={createCustomerMutation.isPending || !newCustomerName.trim()}
              className="flex-1"
            >
              {createCustomerMutation.isPending ? 'Creating...' : 'Create Customer'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateCustomerModal(false);
                setNewCustomerName('');
                setNewCustomerPhone('');
              }}
              disabled={createCustomerMutation.isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

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
              onKeyPress={(e) => {
                if (e.key === 'Enter' && customProductName.trim()) {
                  // Add custom product to cart
                  addItemMutation.mutate({
                    custom_product_name: customProductName.trim(),
                    quantity: 1,
                    unit_price: 0, // Price must be entered manually
                  });
                  setShowCustomProductModal(false);
                  setCustomProductName('');
                }
              }}
            />
            <p className="mt-1 text-xs text-gray-500">
              This product will be saved as "Other - {customProductName || '[name]'}" and won't require inventory tracking.
            </p>
          </div>
          <div className="flex gap-3 pt-2">
            <Button
              onClick={() => {
                if (!customProductName.trim()) {
                  showToast('Product name is required', 'error');
                  return;
                }
                // Add custom product to cart
                addItemMutation.mutate({
                  custom_product_name: customProductName.trim(),
                  quantity: 1,
                  unit_price: 0, // Price must be entered manually
                });
                setShowCustomProductModal(false);
                setCustomProductName('');
              }}
              disabled={addItemMutation.isPending || !customProductName.trim()}
              className="flex-1"
            >
              {addItemMutation.isPending ? 'Adding...' : 'Add to Cart'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowCustomProductModal(false);
                setCustomProductName('');
              }}
              disabled={addItemMutation.isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Product Edit Modal */}
      {showProductForm && (
        <ProductForm
          productId={editingProductId}
          onClose={() => {
            setShowProductForm(false);
            setEditingProductId(undefined);
          }}
          onProductCreated={(_product) => {
            // When product is created or updated, invalidate cart query to refresh product data
            // The cart serializer reads product attributes directly from the database, so refreshing
            // the cart will ensure cart items use the latest product data
            if (cartId) {
              queryClient.invalidateQueries({ queryKey: ['cart', cartId] });
            }
            // Also invalidate products query
            queryClient.invalidateQueries({ queryKey: ['products'] });
            setShowProductForm(false);
            setEditingProductId(undefined);
          }}
        />
      )}
    </div>
  );
}

