import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  User,
  UserPlus,
  Package,
  X,
  CheckCircle,
  Sparkles,
  Lock,
  LockOpen,
  Camera,
  Trash,
} from 'lucide-react';
import { catalogApi, creditApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import { amountForInput, dateStringWithCurrentTimeISO, formatNumber, toLocalDateString } from '../../lib/utils';
import { useGuardedAsync } from '../../hooks/useGuardedAsync';
import {
  addCreditCartTab,
  getActiveCreditTabId,
  getUserCreditTabs,
  loadUserCreditCarts,
  removeCreditCartTab,
  saveUserCreditCarts,
  setActiveCreditTab,
  updateCreditCartTab,
  type CreditCartTab,
} from '../../lib/creditCartStorage';
import CreditPOSModeToggle from './CreditPOSModeToggle';
import {
  buildCreditDocumentSnapshotBlobs,
  copyCreditDocumentImageToClipboard,
  copyDocumentThenQueueLedgerImage,
  copyPngBlobToClipboard,
  finishDocumentPartsAndQueueLedger,
  creditDocumentRowsPerPage,
} from './creditDocumentClipboard';
import { useInvoiceExportSplit } from '../invoices/invoiceExportSettings';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import ToastContainer from '../../components/ui/Toast';
import type { Toast } from '../../components/ui/Toast';

type MergedCustomer = {
  id: number;
  name: string;
  phone?: string | null;
  source: 'credit' | 'parties';
  credit_customer_id?: number | null;
  parties_customer_id?: number | null;
  balance?: string | number;
};

type MergedProduct = {
  id: number;
  name: string;
  sku?: string | null;
  source: 'catalog' | 'credit';
  catalog_product_id?: number | null;
  credit_product_id?: number | null;
};

type SelectedCustomer = {
  credit_customer_id?: number | null;
  parties_customer_id?: number | null;
  name: string;
  phone?: string | null;
  balance?: string | number;
  source: 'credit' | 'parties';
};

type LocalLockChange = { at: number; locked: boolean };

function mergeCartLocked(...sources: (boolean | undefined | null)[]): boolean {
  return sources.some((v) => v === true);
}

function syncCartLocked(
  backend?: boolean | null,
  stored?: boolean,
  state?: boolean,
  recentLocal?: LocalLockChange | null
): boolean {
  const recentMs = recentLocal ? Date.now() - recentLocal.at : Infinity;
  const recentActive = recentLocal != null && recentMs < 30000;

  if (recentActive && recentLocal!.locked === false) return false;
  if (backend === true) return true;
  const localLocked = mergeCartLocked(stored, state);
  if (recentActive && recentLocal!.locked === true && localLocked) return true;
  if (backend === false) return false;
  return localLocked;
}

/** Tab cycle: Product Search → Qty → Price → Delete → Product Search */
const CREDIT_POS_TAB_ATTR = 'data-credit-pos-tab';
const CREDIT_POS_INVOICE_DATE_KEY = 'credit-pos-invoice-date';

function loadPersistedCreditInvoiceDate(): string {
  try {
    const raw = localStorage.getItem(CREDIT_POS_INVOICE_DATE_KEY);
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  } catch {
    /* ignore */
  }
  return toLocalDateString(new Date());
}

function persistCreditInvoiceDate(date: string) {
  try {
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      localStorage.setItem(CREDIT_POS_INVOICE_DATE_KEY, date);
    }
  } catch {
    /* ignore */
  }
}

function getCreditPosTabFields(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[${CREDIT_POS_TAB_ATTR}]`)).filter(
    (el) => {
      if (el.getAttribute('aria-disabled') === 'true') return false;
      if ((el as HTMLButtonElement).disabled) return false;
      if ((el as HTMLInputElement).disabled) return false;
      return true;
    }
  );
}

function focusCreditPosTabField(
  root: HTMLElement | null,
  current: HTMLElement | null,
  reverse: boolean
) {
  if (!root) return;
  const fields = getCreditPosTabFields(root);
  if (fields.length === 0) return;
  if (!current) {
    fields[0]?.focus();
    return;
  }
  const idx = fields.indexOf(current);
  if (idx < 0) {
    fields[0]?.focus();
    return;
  }
  const nextIdx = reverse
    ? (idx - 1 + fields.length) % fields.length
    : (idx + 1) % fields.length;
  fields[nextIdx]?.focus();
  if (fields[nextIdx] instanceof HTMLInputElement) {
    fields[nextIdx].select?.();
  }
}

function focusLastCartQty(root: HTMLElement | null) {
  if (!root) return;
  const qtys = Array.from(
    root.querySelectorAll<HTMLElement>(`[${CREDIT_POS_TAB_ATTR}="qty"]`)
  ).filter((el) => !(el as HTMLInputElement).disabled);
  const last = qtys[qtys.length - 1];
  if (last) {
    last.focus();
    if (last instanceof HTMLInputElement) last.select?.();
  } else {
    root.querySelector<HTMLElement>(`[${CREDIT_POS_TAB_ATTR}="search"]`)?.focus();
  }
}

/** Prefer in-progress edit draft over server value so line totals update as you type. */
function effectiveCartQty(
  item: { id: number; quantity?: string | number | null },
  editingQty: Record<number, string>
): number {
  const raw =
    editingQty[item.id] !== undefined ? editingQty[item.id] : String(item.quantity ?? '');
  const qty = parseFloat(String(raw).trim());
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Math.round(qty);
}

function effectiveCartPrice(
  item: { id: number; unit_price?: string | number | null },
  editingPrice: Record<number, string>
): number {
  const raw =
    editingPrice[item.id] !== undefined ? editingPrice[item.id] : String(item.unit_price ?? '');
  const price = parseFloat(String(raw).trim());
  if (!Number.isFinite(price) || price < 0) return 0;
  return price;
}

function effectiveLineTotal(
  item: { id: number; quantity?: string | number | null; unit_price?: string | number | null },
  editingQty: Record<number, string>,
  editingPrice: Record<number, string>
): number {
  return effectiveCartQty(item, editingQty) * effectiveCartPrice(item, editingPrice);
}

export default function POSCredit() {
  const exportSplit = useInvoiceExportSplit();
  const photoRowsPerPage = creditDocumentRowsPerPage(exportSplit);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const productInputRef = useRef<HTMLInputElement>(null);
  const posWorkflowRef = useRef<HTMLDivElement>(null);
  const draftSnapshotFrameRef = useRef<HTMLIFrameElement>(null);
  const cartTabsRef = useRef<CreditCartTab[]>([]);
  const lockChangeAtRef = useRef<Map<number, LocalLockChange>>(new Map());
  /** Prevents in-flight sync from resurrecting a cart that just checked out. */
  const recentlyCompletedCartIdsRef = useRef<Map<number, number>>(new Map());
  const snapshotPartsQueueRef = useRef<Blob[]>([]);
  const snapshotPartsTotalRef = useRef(0);
  const isCreatingCartRef = useRef(false);

  const markCartRecentlyCompleted = useCallback((id: number) => {
    recentlyCompletedCartIdsRef.current.set(id, Date.now());
  }, []);

  const isRecentlyCompletedCart = useCallback((id: number) => {
    const at = recentlyCompletedCartIdsRef.current.get(id);
    if (at == null) return false;
    if (Date.now() - at > 60000) {
      recentlyCompletedCartIdsRef.current.delete(id);
      return false;
    }
    return true;
  }, []);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [username, setUsername] = useState<string | null>(null);
  const [cartId, setCartId] = useState<number | null>(null);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [cartTabs, setCartTabs] = useState<CreditCartTab[]>([]);
  const [isDeletingCart, setIsDeletingCart] = useState(false);
  const [snapshotClipboardProgress, setSnapshotClipboardProgress] = useState<{
    total: number;
    nextPart: number;
  } | null>(null);
  /** After checkout: remaining multi-page invoice images before redirecting to ledger. */
  const [postCheckoutCopy, setPostCheckoutCopy] = useState<{
    customerId: number;
    invoiceNumber: string;
    remainingParts: Blob[];
    totalParts: number;
    nextPart: number;
    ledgerBlob: Blob;
  } | null>(null);
  const [copyingPostCheckoutPart, setCopyingPostCheckoutPart] = useState(false);

  const [productSearch, setProductSearch] = useState('');
  const [debouncedProductSearch, setDebouncedProductSearch] = useState('');
  const [productIndex, setProductIndex] = useState(-1);

  const [customerSearch, setCustomerSearch] = useState('');
  const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState('');
  const [customerIndex, setCustomerIndex] = useState(-1);
  const [selectedCustomer, setSelectedCustomer] = useState<SelectedCustomer | null>(null);

  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' });

  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [newProductName, setNewProductName] = useState('');

  const { runGuarded, isSubmitting: isCheckingOut } = useGuardedAsync();
  const [invoiceDate, setInvoiceDate] = useState(loadPersistedCreditInvoiceDate);
  /** Local draft values while editing cart lines (cleared on focus for easy re-entry). */
  const [editingQty, setEditingQty] = useState<Record<number, string>>({});
  const [editingPrice, setEditingPrice] = useState<Record<number, string>>({});
  /** Enter commits explicitly; skip the blur that follows focus move to avoid double PATCH. */
  const skipQtyBlurRef = useRef<Set<number>>(new Set());
  const skipPriceBlurRef = useRef<Set<number>>(new Set());

  const isCustomInvoiceDate = useMemo(
    () => invoiceDate !== toLocalDateString(new Date()),
    [invoiceDate]
  );

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);
  const removeToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  useEffect(() => {
    const u = auth.getUser();
    setUsername(u?.username || null);
  }, []);

  useEffect(() => {
    cartTabsRef.current = cartTabs;
  }, [cartTabs]);

  const { data: stores = [] } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => {
      const res = await catalogApi.stores.list();
      const d = res.data;
      return Array.isArray(d) ? d : d?.results || [];
    },
  });

  const filteredStores = useMemo(() => {
    const list = Array.isArray(stores) ? stores : [];
    return list.filter((s: any) => s.is_active !== false);
  }, [stores]);

  const defaultStore = useMemo(() => filteredStores[0], [filteredStores]);

  const activeTab = cartTabs.find((t) => t.id === cartId);
  const isCartLocked = !!activeTab?.locked;

  const { data: cart, refetch: refetchCart } = useQuery({
    queryKey: ['credit-cart', cartId],
    queryFn: async () => {
      if (!cartId) return null;
      if (isRecentlyCompletedCart(cartId)) return null;
      try {
        const res = await creditApi.carts.get(cartId);
        const data = res.data;
        // Never show a checked-out / cancelled cart as the active POS basket
        if (data?.status && data.status !== 'active') return null;
        if (data?.id && isRecentlyCompletedCart(data.id)) return null;
        return data;
      } catch {
        // 404 for completed carts, network errors, etc.
        return null;
      }
    },
    enabled: !!cartId && !isDeletingCart,
  });

  const loadCartsFromStorage = useCallback(() => {
    if (!username) return;
    const userCarts = loadUserCreditCarts(username);
    if (userCarts) {
      setCartTabs(userCarts.tabs);
      if (userCarts.activeTabId) {
        setActiveTabId(userCarts.activeTabId);
        setCartId(userCarts.activeTabId);
      }
    }
  }, [username]);

  const syncCartsWithBackend = useCallback(
    async (preserveActiveTabId?: number) => {
      if (!username || !defaultStore?.id) return;
      try {
        const backendResponse = await creditApi.carts.getAllActive({ store: defaultStore.id });
        const backendCarts = Array.isArray(backendResponse.data)
          ? backendResponse.data
          : backendResponse.data?.results || [];

        const localCarts = loadUserCreditCarts(username);
        const localTabs = localCarts?.tabs || [];
        const currentStoreId = defaultStore.id;
        const mergedTabs: CreditCartTab[] = [];
        const processedIds = new Set<number>();

        for (const cartRow of backendCarts) {
          const cartStoreId = cartRow.store || currentStoreId;
          if (
            cartRow.status === 'active' &&
            cartStoreId === currentStoreId &&
            !isRecentlyCompletedCart(cartRow.id)
          ) {
            const localTab = localTabs.find((t) => t.id === cartRow.id);
            const stateTab = cartTabsRef.current.find((t) => t.id === cartRow.id);
            mergedTabs.push({
              id: cartRow.id,
              cartNumber: cartRow.cart_number || `CCART-${cartRow.id}`,
              storeId: cartStoreId,
              customerId: cartRow.customer || null,
              customerName: cartRow.customer_name || null,
              itemCount: cartRow.items?.length || 0,
              createdAt: cartRow.created_at || new Date().toISOString(),
              updatedAt: cartRow.updated_at || new Date().toISOString(),
              locked: syncCartLocked(
                cartRow.locked,
                localTab?.locked,
                stateTab?.locked,
                lockChangeAtRef.current.get(cartRow.id) ?? null
              ),
            });
            processedIds.add(cartRow.id);
          }
        }

        for (const localTab of localTabs) {
          if (
            processedIds.has(localTab.id) ||
            localTab.storeId !== currentStoreId ||
            isRecentlyCompletedCart(localTab.id)
          ) {
            continue;
          }
          try {
            const cartResponse = await creditApi.carts.get(localTab.id);
            if (cartResponse.data?.status === 'active') {
              const c = cartResponse.data;
              if ((c.store || currentStoreId) === currentStoreId) {
                const stateTab = cartTabsRef.current.find((t) => t.id === c.id);
                mergedTabs.push({
                  id: c.id,
                  cartNumber: c.cart_number || `CCART-${c.id}`,
                  storeId: c.store || currentStoreId,
                  customerId: c.customer || null,
                  customerName: c.customer_name || null,
                  itemCount: c.items?.length || 0,
                  createdAt: c.created_at || new Date().toISOString(),
                  updatedAt: c.updated_at || new Date().toISOString(),
                  locked: syncCartLocked(
                    c.locked,
                    localTab.locked,
                    stateTab?.locked,
                    lockChangeAtRef.current.get(c.id) ?? null
                  ),
                });
              }
            }
          } catch {
            // cart gone
          }
        }

        mergedTabs.sort((a, b) => {
          const aTime = new Date(a.createdAt || 0).getTime();
          const bTime = new Date(b.createdAt || 0).getTime();
          if (aTime !== bTime) return aTime - bTime;
          return a.id - b.id;
        });

        let activeId: number | null = null;
        if (preserveActiveTabId && mergedTabs.some((t) => t.id === preserveActiveTabId)) {
          activeId = preserveActiveTabId;
        } else if (
          localCarts?.activeTabId &&
          mergedTabs.some((t) => t.id === localCarts.activeTabId)
        ) {
          activeId = localCarts.activeTabId;
        } else if (mergedTabs.length > 0) {
          activeId = mergedTabs[mergedTabs.length - 1].id;
        }

        saveUserCreditCarts({ username, tabs: mergedTabs, activeTabId: activeId });
        setCartTabs(mergedTabs);
        setActiveTabId(activeId);
        setCartId(activeId);

        if (mergedTabs.length === 0 && !isCreatingCartRef.current) {
          createCartMutation.mutate();
        }
      } catch (err) {
        console.error('Failed to sync credit carts', err);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [username, defaultStore?.id, isRecentlyCompletedCart]
  );

  const createCartMutation = useMutation({
    mutationFn: async () => {
      if (!defaultStore) throw new Error('No store available');
      isCreatingCartRef.current = true;
      const res = await creditApi.carts.create({ store: defaultStore.id });
      return res.data;
    },
    onSuccess: (data) => {
      isCreatingCartRef.current = false;
      if (!username || !data) return;
      const cartTab: CreditCartTab = {
        id: data.id,
        cartNumber: data.cart_number || `CCART-${data.id}`,
        storeId: data.store || defaultStore!.id,
        customerId: data.customer || null,
        customerName: data.customer_name || null,
        itemCount: data.items?.length || 0,
        createdAt: data.created_at || new Date().toISOString(),
        updatedAt: data.updated_at || new Date().toISOString(),
        locked: false,
      };
      addCreditCartTab(username, cartTab);
      setActiveCreditTab(username, data.id);
      const tabs = getUserCreditTabs(username);
      tabs.sort((a, b) => {
        const aTime = new Date(a.createdAt || 0).getTime();
        const bTime = new Date(b.createdAt || 0).getTime();
        if (aTime !== bTime) return aTime - bTime;
        return a.id - b.id;
      });
      setCartTabs(tabs);
      setCartId(data.id);
      setActiveTabId(data.id);
      setSelectedCustomer(null);
      // Avoid immediate sync after checkout — it can race and briefly reattach
      // the just-completed cart while its DB status is still flushing to clients.
      window.setTimeout(() => {
        syncCartsWithBackend(data.id).catch(() => undefined);
      }, 500);
    },
    onError: (err: any) => {
      isCreatingCartRef.current = false;
      showToast(err?.response?.data?.detail || 'Failed to create cart', 'error');
    },
  });

  const lockCartMutation = useMutation({
    mutationFn: ({ cartId: id, locked }: { cartId: number; locked: boolean }) =>
      creditApi.carts.update(id, { locked }),
    onMutate: ({ cartId: id, locked }) => {
      if (!username) return;
      const previousTabs = cartTabsRef.current;
      const previousLocal = loadUserCreditCarts(username);
      lockChangeAtRef.current.set(id, { at: Date.now(), locked });
      updateCreditCartTab(username, id, { locked });
      setCartTabs((prev) => prev.map((t) => (t.id === id ? { ...t, locked } : t)));
      return { previousTabs, previousLocal };
    },
    onSuccess: (_, { cartId: id, locked }) => {
      if (username) {
        updateCreditCartTab(username, id, { locked });
        setCartTabs((prev) => prev.map((t) => (t.id === id ? { ...t, locked } : t)));
      }
      queryClient.invalidateQueries({ queryKey: ['credit-cart', id] });
      showToast(locked ? 'Cart locked. Open a new cart to add items.' : 'Cart unlocked', 'success');
    },
    onError: (err: any, { cartId: id }, context) => {
      lockChangeAtRef.current.delete(id);
      if (context?.previousTabs) setCartTabs(context.previousTabs);
      if (context?.previousLocal && username) saveUserCreditCarts(context.previousLocal);
      showToast(err?.response?.data?.detail || 'Failed to update lock', 'error');
    },
  });

  useEffect(() => {
    if (username) loadCartsFromStorage();
  }, [username, loadCartsFromStorage]);

  useEffect(() => {
    if (!defaultStore?.id || !username) return;
    syncCartsWithBackend();
    const syncInterval = setInterval(() => syncCartsWithBackend(), 30000);
    return () => clearInterval(syncInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultStore?.id, username]);

  useEffect(() => {
    if (!cartId || !username || typeof cart?.locked !== 'boolean') return;
    if (lockCartMutation.isPending) return;
    const backendLocked = cart.locked;
    const currentTab = cartTabsRef.current.find((t) => t.id === cartId);
    if (currentTab?.locked === backendLocked) return;
    const recentLocalChange = lockChangeAtRef.current.get(cartId);
    if (
      recentLocalChange &&
      Date.now() - recentLocalChange.at < 8000 &&
      backendLocked !== currentTab?.locked
    ) {
      return;
    }
    updateCreditCartTab(username, cartId, { locked: backendLocked });
    setCartTabs((prev) => prev.map((t) => (t.id === cartId ? { ...t, locked: backendLocked } : t)));
  }, [cartId, username, cart?.locked, lockCartMutation.isPending]);

  // Keep localStorage tab metadata in sync with active cart
  useEffect(() => {
    if (!cart || !username || !cartId) return;
    if (isRecentlyCompletedCart(cartId)) return;
    if (cart.status && cart.status !== 'active') return;
    const cartTab: CreditCartTab = {
      id: cart.id,
      cartNumber: cart.cart_number || `CCART-${cart.id}`,
      storeId: cart.store || defaultStore?.id || 0,
      customerId: cart.customer || null,
      customerName: cart.customer_name || null,
      itemCount: cart.items?.length || 0,
      createdAt: cart.created_at || new Date().toISOString(),
      updatedAt: cart.updated_at || new Date().toISOString(),
    };
    addCreditCartTab(username, cartTab);
    const tabs = getUserCreditTabs(username);
    const currentTabs = cartTabsRef.current;
    const mergedTabs = tabs.map((t) => {
      const fromState = currentTabs.find((s) => s.id === t.id);
      const backendLocked =
        t.id === cartId && typeof cart.locked === 'boolean' ? cart.locked : undefined;
      const locked = syncCartLocked(
        backendLocked,
        t.locked,
        fromState?.locked,
        lockChangeAtRef.current.get(t.id) ?? null
      );
      return locked === t.locked ? t : { ...t, locked };
    });
    mergedTabs.sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      if (aTime !== bTime) return aTime - bTime;
      return a.id - b.id;
    });
    setCartTabs(mergedTabs);
    saveUserCreditCarts({
      username,
      tabs: mergedTabs,
      activeTabId: activeTabId ?? getActiveCreditTabId(username),
    });

    if (cart.customer_name) {
      setSelectedCustomer((prev) => {
        if (prev && prev.name === cart.customer_name) return prev;
        return {
          name: cart.customer_name,
          phone: null,
          source: 'credit',
          credit_customer_id: cart.customer,
          balance: undefined,
        };
      });
    } else if (!cart.customer) {
      setSelectedCustomer(null);
    }
  }, [cart, username, cartId, defaultStore?.id, activeTabId, isRecentlyCompletedCart]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedProductSearch(productSearch), 300);
    return () => window.clearTimeout(t);
  }, [productSearch]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedCustomerSearch(customerSearch), 300);
    return () => window.clearTimeout(t);
  }, [customerSearch]);

  const { data: productResults = [], isFetching: isProductSearching } = useQuery({
    queryKey: ['credit-product-search', debouncedProductSearch],
    queryFn: async () => {
      const q = debouncedProductSearch.trim();
      if (q.length < 1) return [];
      const res = await creditApi.products.search({ search: q });
      return res.data || [];
    },
    enabled: debouncedProductSearch.trim().length >= 1,
  });

  const { data: customerResults = [], isFetching: isCustomerSearching } = useQuery({
    queryKey: ['credit-customer-search', debouncedCustomerSearch],
    queryFn: async () => {
      const q = debouncedCustomerSearch.trim();
      if (q.length < 1) return [];
      const res = await creditApi.customers.search({ search: q });
      return res.data || [];
    },
    enabled: debouncedCustomerSearch.trim().length >= 1,
  });

  const cartItems = useMemo(() => {
    if (!cart || !cartId) return [];
    if (cart.id != null && cart.id !== cartId) return [];
    if (cart.status && cart.status !== 'active') return [];
    if (isRecentlyCompletedCart(cartId)) return [];
    return cart.items || [];
  }, [cart, cartId, isRecentlyCompletedCart]);
  const cartTotal = useMemo(() => {
    return cartItems.reduce(
      (sum: number, item: any) => sum + effectiveLineTotal(item, editingQty, editingPrice),
      0
    );
  }, [cartItems, editingQty, editingPrice]);

  const cartLineCount = cartItems.length;

  const cartTotalQty = useMemo(() => {
    return cartItems.reduce(
      (sum: number, item: any) => sum + effectiveCartQty(item, editingQty),
      0
    );
  }, [cartItems, editingQty]);

  const cartLinesReady = useMemo(() => {
    if (!cartItems.length) return false;
    return cartItems.every((i: any) => {
      const qty = effectiveCartQty(i, editingQty);
      const price = effectiveCartPrice(i, editingPrice);
      return qty > 0 && price > 0;
    });
  }, [cartItems, editingQty, editingPrice]);

  const canCheckout =
    !!selectedCustomer && cartLinesReady && !isCartLocked && !isCheckingOut;

  const handleNewSale = () => {
    if (!defaultStore) {
      showToast('No store configured for credit POS', 'error');
      return;
    }
    createCartMutation.mutate();
  };

  const deleteCartOptimistic = useCallback(
    async (cartIdToDelete: number) => {
      if (!username) return;
      const currentTabs = getUserCreditTabs(username);
      if (currentTabs.length <= 1) {
        showToast('Cannot delete the last cart. At least one cart must always exist.', 'error');
        return;
      }
      const tab = currentTabs.find((t) => t.id === cartIdToDelete);
      if (tab?.locked) {
        showToast('Unlock the cart before closing it.', 'info');
        return;
      }

      setIsDeletingCart(true);
      queryClient.removeQueries({ queryKey: ['credit-cart', cartIdToDelete] });
      const newActiveTabId = removeCreditCartTab(username, cartIdToDelete);
      loadCartsFromStorage();

      if (newActiveTabId) {
        setCartId(newActiveTabId);
        setActiveTabId(newActiveTabId);
      } else {
        const remaining = getUserCreditTabs(username);
        if (remaining.length > 0) {
          setCartId(remaining[0].id);
          setActiveTabId(remaining[0].id);
          setActiveCreditTab(username, remaining[0].id);
        }
      }

      try {
        await creditApi.carts.delete(cartIdToDelete);
      } catch (err: any) {
        showToast(err?.response?.data?.detail || 'Failed to delete cart on server', 'error');
        syncCartsWithBackend();
      } finally {
        setIsDeletingCart(false);
      }
    },
    [username, queryClient, loadCartsFromStorage, showToast, syncCartsWithBackend]
  );

  const handleTabSwitch = (tabId: number) => {
    setActiveTabId(tabId);
    setCartId(tabId);
    if (username) setActiveCreditTab(username, tabId);
    setProductSearch('');
    setEditingQty({});
    setEditingPrice({});
  };

  const handleTabClose = async (e: React.MouseEvent, tabId: number) => {
    e.stopPropagation();
    const tab = cartTabs.find((t) => t.id === tabId);
    if (tab?.locked) {
      showToast('Unlock the cart before closing it.', 'info');
      return;
    }
    if (cartTabs.length <= 1) {
      showToast('Cannot delete the last cart. At least one cart must always exist.', 'error');
      return;
    }
    const itemCount =
      tabId === cartId ? cartItems.length : tab?.itemCount || 0;
    if (itemCount > 0 && !window.confirm(`Close this cart with ${itemCount} item(s)?`)) {
      return;
    }
    await deleteCartOptimistic(tabId);
  };

  const handleDeleteCurrentCart = async () => {
    if (!cartId) return;
    if (isCartLocked) {
      showToast('Unlock the cart to delete it.', 'info');
      return;
    }
    if (cartTabs.length <= 1) {
      showToast('Cannot delete the last cart. At least one cart must always exist.', 'error');
      return;
    }
    if (cartItems.length > 0 && !window.confirm('Delete current cart and all its items?')) {
      return;
    }
    await deleteCartOptimistic(cartId);
  };

  const getTabDisplayName = (tab: CreditCartTab, index: number): string => {
    const customerName = tab.customerName || (tab.id === cartId ? cart?.customer_name : null);
    if (customerName) {
      const short = customerName.length > 20 ? `${customerName.slice(0, 20)}…` : customerName;
      return `${short} (CREDIT)`;
    }
    return `CREDIT #${index + 1}`;
  };

  const addProduct = async (product: MergedProduct) => {
    if (isCartLocked) {
      showToast('Cart is locked. Open a new cart to add items.', 'info');
      return;
    }
    let id = cartId;
    if (!id) {
      if (!defaultStore?.id) {
        showToast('No store configured for credit POS', 'error');
        return;
      }
      try {
        const res = await creditApi.carts.create({ store: defaultStore.id });
        id = res.data.id;
        if (username) {
          addCreditCartTab(username, {
            id: res.data.id,
            cartNumber: res.data.cart_number || `CCART-${res.data.id}`,
            storeId: res.data.store || defaultStore.id,
            customerId: res.data.customer || null,
            customerName: res.data.customer_name || null,
            itemCount: 0,
            createdAt: res.data.created_at || new Date().toISOString(),
            updatedAt: res.data.updated_at || new Date().toISOString(),
          });
        }
        setCartId(id);
        setActiveTabId(id);
      } catch (err: any) {
        showToast(err?.response?.data?.detail || 'Failed to create cart', 'error');
        return;
      }
    }
    if (id == null) return;
    try {
      const payload: any = {
        quantity: 0,
        unit_price: 0,
        product_name: product.name,
      };
      if (product.source === 'catalog') {
        payload.catalog_product_id = product.catalog_product_id || product.id;
      } else {
        payload.credit_product_id = product.credit_product_id || product.id;
      }
      await creditApi.carts.addItem(id, payload);
      await refetchCart();
      setProductSearch('');
      setProductIndex(-1);
      // After add: land on Qty of the new line (Tab cycle: Search → Qty → Price → Delete → Search)
      window.setTimeout(() => focusLastCartQty(posWorkflowRef.current), 40);
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to add item', 'error');
    }
  };

  const handlePosWorkflowKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const target = e.target as HTMLElement | null;
    if (!target?.closest?.(`[${CREDIT_POS_TAB_ATTR}]`)) return;
    e.preventDefault();
    focusCreditPosTabField(posWorkflowRef.current, target, e.shiftKey);
  };

  const patchCartItemCache = useCallback(
    (itemId: number, updated: Record<string, unknown>) => {
      if (!cartId) return;
      queryClient.setQueryData(['credit-cart', cartId], (old: any) => {
        if (!old?.items) return old;
        return {
          ...old,
          items: old.items.map((i: any) => (i.id === itemId ? { ...i, ...updated } : i)),
        };
      });
    },
    [cartId, queryClient]
  );

  const updateItemPrice = async (itemId: number, unitPrice: string) => {
    if (!cartId || isCartLocked) return;
    const trimmed = unitPrice.trim();
    if (trimmed === '') {
      // Empty = not entered → persist 0 so checkout can reject
      try {
        const res = await creditApi.carts.updateItem(cartId, itemId, { unit_price: 0 });
        if (res.data) patchCartItemCache(itemId, res.data);
        setEditingPrice((prev) => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
      } catch (err: any) {
        showToast(err?.response?.data?.detail || 'Failed to update price', 'error');
      }
      return;
    }
    const price = parseFloat(trimmed);
    if (!Number.isFinite(price) || price < 0) {
      showToast('Enter a valid price', 'error');
      setEditingPrice((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      return;
    }
    try {
      const res = await creditApi.carts.updateItem(cartId, itemId, { unit_price: price });
      // Apply PATCH body before clearing draft — avoids a flash of stale ₹0 line total
      if (res.data) patchCartItemCache(itemId, res.data);
      setEditingPrice((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to update price', 'error');
    }
  };

  const updateItemQty = async (itemId: number, quantity: string) => {
    if (!cartId || isCartLocked) return;
    const trimmed = quantity.trim();
    if (trimmed === '') {
      // Empty = not entered → persist 0 so checkout can reject
      try {
        const res = await creditApi.carts.updateItem(cartId, itemId, { quantity: 0 });
        if (res.data) patchCartItemCache(itemId, res.data);
        setEditingQty((prev) => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
      } catch (err: any) {
        showToast(err?.response?.data?.detail || 'Failed to update quantity', 'error');
      }
      return;
    }
    // Whole units only (same as POS +/- qty) — decimals break returns / returnable counts.
    if (!/^\d+$/.test(trimmed)) {
      showToast('Quantity must be a whole number', 'error');
      setEditingQty((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      return;
    }
    const qty = parseInt(trimmed, 10);
    if (!Number.isFinite(qty) || qty < 0) {
      showToast('Enter a valid quantity', 'error');
      setEditingQty((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      return;
    }
    try {
      const res = await creditApi.carts.updateItem(cartId, itemId, { quantity: qty });
      if (res.data) patchCartItemCache(itemId, res.data);
      setEditingQty((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to update quantity', 'error');
    }
  };

  const removeItem = async (itemId: number) => {
    if (!cartId || isCartLocked) return;
    try {
      await creditApi.carts.deleteItem(cartId, itemId);
      await refetchCart();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to remove item', 'error');
    }
  };

  const selectCustomer = async (c: MergedCustomer) => {
    if (isCartLocked) {
      showToast('Cart is locked. Unlock to change customer.', 'info');
      return;
    }
    const selected: SelectedCustomer = {
      name: c.name,
      phone: c.phone,
      source: c.source,
      balance: c.balance,
      credit_customer_id: c.source === 'credit' ? (c.credit_customer_id || c.id) : null,
      parties_customer_id: c.source === 'parties' ? (c.parties_customer_id || c.id) : c.parties_customer_id,
    };
    setSelectedCustomer(selected);
    setCustomerSearch('');
    setCustomerIndex(-1);

    if (cartId) {
      try {
        const payload: any = {};
        if (selected.credit_customer_id) payload.credit_customer_id = selected.credit_customer_id;
        else if (selected.parties_customer_id) payload.parties_customer_id = selected.parties_customer_id;
        await creditApi.carts.update(cartId, payload);
        await refetchCart();
      } catch (err: any) {
        showToast(err?.response?.data?.detail || 'Failed to attach customer', 'error');
      }
    }
  };

  const clearCustomer = async () => {
    if (isCartLocked) return;
    setSelectedCustomer(null);
    if (cartId) {
      try {
        await creditApi.carts.update(cartId, { customer: null });
        await refetchCart();
      } catch (err: any) {
        showToast(err?.response?.data?.detail || 'Failed to clear customer', 'error');
      }
    }
  };

  const createCustomerMutation = useMutation({
    mutationFn: async () => {
      const res = await creditApi.customers.create({
        name: newCustomer.name.trim(),
        phone: newCustomer.phone.trim() || null,
      });
      return res.data;
    },
    onSuccess: async (data) => {
      setShowCreateCustomer(false);
      setNewCustomer({ name: '', phone: '' });
      await selectCustomer({
        id: data.id,
        name: data.name,
        phone: data.phone,
        source: 'credit',
        credit_customer_id: data.id,
        balance: data.balance,
      });
      showToast('Credit customer created');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.detail || 'Failed to create customer', 'error');
    },
  });

  const createProductMutation = useMutation({
    mutationFn: async () => {
      const res = await creditApi.products.create({
        name: newProductName.trim(),
      });
      return res.data;
    },
    onSuccess: async (data) => {
      setShowCreateProduct(false);
      setNewProductName('');
      await addProduct({
        id: data.id,
        name: data.name,
        source: 'credit',
        credit_product_id: data.id,
      });
      showToast('Credit product created & added');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.detail || 'Failed to create product', 'error');
    },
  });

  const closeCartAfterCheckout = useCallback(
    (completedCartId: number) => {
      markCartRecentlyCompleted(completedCartId);
      setIsDeletingCart(true);

      // Wipe cached basket immediately so items can't flash / stay on screen
      queryClient.setQueryData(['credit-cart', completedCartId], null);
      queryClient.removeQueries({ queryKey: ['credit-cart', completedCartId] });

      setEditingQty({});
      setEditingPrice({});
      setProductSearch('');
      setCustomerSearch('');
      setSelectedCustomer(null);
      snapshotPartsQueueRef.current = [];
      snapshotPartsTotalRef.current = 0;
      setSnapshotClipboardProgress(null);

      if (username) {
        const newActive = removeCreditCartTab(username, completedCartId);
        const remaining = getUserCreditTabs(username).filter(
          (t) => t.id !== completedCartId && !isRecentlyCompletedCart(t.id)
        );
        saveUserCreditCarts({
          username,
          tabs: remaining,
          activeTabId:
            newActive && newActive !== completedCartId && !isRecentlyCompletedCart(newActive)
              ? newActive
              : remaining.length
                ? remaining[remaining.length - 1].id
                : null,
        });
        setCartTabs(remaining);

        const nextId =
          newActive && newActive !== completedCartId && !isRecentlyCompletedCart(newActive)
            ? newActive
            : remaining.length
              ? remaining[remaining.length - 1].id
              : null;

        if (nextId) {
          setCartId(nextId);
          setActiveTabId(nextId);
          setActiveCreditTab(username, nextId);
          window.setTimeout(() => setIsDeletingCart(false), 0);
        } else {
          setCartId(null);
          setActiveTabId(null);
          createCartMutation.mutate(undefined, {
            onSettled: () => setIsDeletingCart(false),
          });
        }
      } else {
        setCartId(null);
        setActiveTabId(null);
        window.setTimeout(() => setIsDeletingCart(false), 0);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [username, queryClient, markCartRecentlyCompleted, isRecentlyCompletedCart]
  );

  const handleCheckout = () => {
    if (isCheckingOut) return;
    runGuarded(async () => {
    if (!cartId) return;
    if (isCartLocked) {
      showToast('Unlock the cart before checkout.', 'info');
      return;
    }
    if (!selectedCustomer) {
      showToast('Select a customer first', 'error');
      return;
    }
    if (!cartItems.length) {
      showToast('Cart is empty', 'error');
      return;
    }
    const invalidLine = cartItems.find((i: any) => {
      const qtyRaw =
        editingQty[i.id] !== undefined ? editingQty[i.id] : String(i.quantity ?? '');
      const priceRaw =
        editingPrice[i.id] !== undefined ? editingPrice[i.id] : String(i.unit_price ?? '');
      const qty = parseFloat(String(qtyRaw).trim());
      const price = parseFloat(String(priceRaw).trim());
      return !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0;
    });
    if (invalidLine) {
      showToast('Every item needs quantity > 0 and selling price > 0', 'error');
      return;
    }
    if (!invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) {
      showToast('Select a valid invoice date', 'error');
      return;
    }

      const checkoutCartId = cartId;
      const payload: any = {
        created_at: dateStringWithCurrentTimeISO(invoiceDate),
      };
      if (selectedCustomer.credit_customer_id) {
        payload.credit_customer_id = selectedCustomer.credit_customer_id;
      } else if (selectedCustomer.parties_customer_id) {
        payload.parties_customer_id = selectedCustomer.parties_customer_id;
      }
      const res = await creditApi.carts.checkout(checkoutCartId, payload);
      const invoice = res.data;
      const creditCustomerId =
        invoice.customer || selectedCustomer.credit_customer_id || null;

      // Close the cart immediately after save — don't wait on clipboard / image work.
      closeCartAfterCheckout(checkoutCartId);
      // Do NOT invalidate ['credit-cart'] here — that refetches the just-closed cart
      // while its observer is still mounted and can put items back on screen.
      queryClient.invalidateQueries({ queryKey: ['credit-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-customers'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-statement'] });

      const documentInput = {
        invoice_number: invoice.invoice_number,
        customer_name: invoice.customer_name,
        customer_phone: invoice.customer_phone,
        created_at: invoice.created_at,
        subtotal: invoice.subtotal,
        total: invoice.total,
        customer_balance: invoice.customer_balance,
        status: invoice.status,
        items: invoice.items || [],
      };

      const iframe = draftSnapshotFrameRef.current;
      let clipboardCopied = false;
      let remainingDocParts: Blob[] = [];
      let documentPartCount = 1;
      let ledgerBlob: Blob | null = null;

      if (iframe && creditCustomerId) {
        try {
          const statementRes = await creditApi.ledger.statement({
            customer: creditCustomerId,
          });
          const copyResult = await copyDocumentThenQueueLedgerImage(
            iframe,
            documentInput,
            statementRes.data
          );
          clipboardCopied = copyResult.ok;
          remainingDocParts = copyResult.remainingDocumentParts;
          documentPartCount = copyResult.documentPartCount;
          ledgerBlob = copyResult.ledgerBlob;
        } catch (copyErr) {
          console.error('Invoice + ledger clipboard copy failed:', copyErr);
        }
      } else if (iframe) {
        try {
          const copyResult = await copyCreditDocumentImageToClipboard(iframe, documentInput);
          clipboardCopied = copyResult.ok;
          remainingDocParts = copyResult.remainingParts;
          documentPartCount = copyResult.partCount;
        } catch (copyErr) {
          console.error('Invoice clipboard copy failed:', copyErr);
        }
      }

      // Multi-page invoice: copy remaining pages here, then redirect to ledger.
      if (
        clipboardCopied &&
        remainingDocParts.length > 0 &&
        creditCustomerId &&
        ledgerBlob
      ) {
        setPostCheckoutCopy({
          customerId: creditCustomerId,
          invoiceNumber: invoice.invoice_number,
          remainingParts: remainingDocParts,
          totalParts: documentPartCount,
          nextPart: 2,
          ledgerBlob,
        });
        showToast(
          `Invoice ${invoice.invoice_number} page 1 of ${documentPartCount} copied — paste it, then copy the next page`,
          'success'
        );
        return;
      }

      if (clipboardCopied) {
        showToast(
          documentPartCount > 1
            ? `Invoice ${invoice.invoice_number} page 1 of ${documentPartCount} copied`
            : `Invoice ${invoice.invoice_number} copied (1/2) — paste it, then copy ledger (2/2)`,
          'success'
        );
      } else {
        showToast(
          iframe
            ? `Invoice ${invoice.invoice_number} created (clipboard copy unavailable — use Photo on invoice page)`
            : `Credit invoice ${invoice.invoice_number} created`,
          'success'
        );
      }

      if (creditCustomerId) {
        navigate(
          clipboardCopied
            ? `/credit-ledger/${creditCustomerId}?copy_ledger=1`
            : `/credit-ledger/${creditCustomerId}`
        );
      }
    }).catch((err: any) => {
      showToast(err?.response?.data?.detail || 'Checkout failed', 'error');
    });
  };

  const copyNextPostCheckoutPart = useCallback(async () => {
    if (!postCheckoutCopy || copyingPostCheckoutPart) return;
    setCopyingPostCheckoutPart(true);
    try {
      const remaining = [...postCheckoutCopy.remainingParts];
      const blob = remaining.shift();
      if (!blob) {
        setPostCheckoutCopy(null);
        return;
      }
      if (!(await copyPngBlobToClipboard(blob))) {
        showToast('Could not copy invoice image', 'error');
        return;
      }
      const partNum = postCheckoutCopy.nextPart;
      if (remaining.length > 0) {
        setPostCheckoutCopy({
          ...postCheckoutCopy,
          remainingParts: remaining,
          nextPart: partNum + 1,
        });
        showToast(
          `Invoice page ${partNum} of ${postCheckoutCopy.totalParts} copied — paste it, then copy the next page`,
          'success'
        );
        return;
      }

      finishDocumentPartsAndQueueLedger(postCheckoutCopy.ledgerBlob);
      const { customerId, invoiceNumber, totalParts } = postCheckoutCopy;
      setPostCheckoutCopy(null);
      showToast(
        `Invoice ${invoiceNumber} page ${partNum} of ${totalParts} copied — redirecting to copy ledger`,
        'success'
      );
      navigate(`/credit-ledger/${customerId}?copy_ledger=1`);
    } finally {
      setCopyingPostCheckoutPart(false);
    }
  }, [postCheckoutCopy, copyingPostCheckoutPart, navigate, showToast]);

  const snapshotExpectedParts = useMemo(() => {
    const itemCount = cartItems.length;
    if (itemCount === 0) return 1;
    return Math.ceil(itemCount / photoRowsPerPage);
  }, [cartItems.length, photoRowsPerPage]);

  useEffect(() => {
    snapshotPartsQueueRef.current = [];
    snapshotPartsTotalRef.current = 0;
    if (snapshotExpectedParts > 1) {
      setSnapshotClipboardProgress({ total: snapshotExpectedParts, nextPart: 1 });
    } else {
      setSnapshotClipboardProgress(null);
    }
  }, [cartId, cartItems.length, snapshotExpectedParts]);

  const snapshotButtonBadge =
    snapshotClipboardProgress && snapshotClipboardProgress.total > 1
      ? `${snapshotClipboardProgress.nextPart}/${snapshotClipboardProgress.total}`
      : null;

  const copyDraftSnapshotToClipboard = useCallback(async () => {
    if (!cartItems.length) {
      showToast('Cart is empty', 'info');
      return;
    }
    const iframe = draftSnapshotFrameRef.current;
    if (!iframe) {
      showToast('Snapshot preview not ready. Please refresh and try again.', 'error');
      return;
    }

    try {
      const pending = snapshotPartsQueueRef.current;
      if (pending.length > 0) {
        const blob = pending.shift()!;
        const totalParts = snapshotPartsTotalRef.current;
        const partNum = totalParts - pending.length;
        if (!(await copyPngBlobToClipboard(blob))) {
          pending.unshift(blob);
          showToast('Image clipboard not supported in this browser.', 'error');
          return;
        }
        if (pending.length > 0) {
          setSnapshotClipboardProgress({ total: totalParts, nextPart: partNum + 1 });
          showToast(
            `Image ${partNum} of ${totalParts} copied. Tap Cart Snapshot again for image ${partNum + 1}.`,
            'success'
          );
        } else {
          snapshotPartsTotalRef.current = 0;
          setSnapshotClipboardProgress(null);
          showToast(`Image ${partNum} of ${totalParts} copied.`, 'success');
        }
        return;
      }

      const invoiceNo = cart?.cart_number || (cartId ? `DRAFT-${cartId}` : 'DRAFT');
      const customerName = selectedCustomer?.name || cart?.customer_name || 'Walk-in Customer';
      const customerPhone = selectedCustomer?.phone || null;
      const createdAt = new Date().toISOString();
      const closingBalance =
        selectedCustomer?.balance != null
          ? (parseFloat(String(selectedCustomer.balance)) || 0) + cartTotal
          : null;

      const blobs = await buildCreditDocumentSnapshotBlobs(
        iframe,
        {
          invoice_number: invoiceNo,
          customer_name: customerName,
          customer_phone: customerPhone,
          created_at: createdAt,
          subtotal: cartTotal,
          total: cartTotal,
          customer_balance: closingBalance,
          items: cartItems.map((item: any) => ({
            product_name: item.product_name || item.product_display_name || 'Item',
            quantity: Math.round(parseFloat(String(item.quantity ?? '0')) || 0),
            unit_price: parseFloat(String(item.unit_price ?? '0')) || 0,
            line_total: parseFloat(String(item.line_total ?? '0')) || 0,
          })),
        },
        exportSplit
      );

      if (!(await copyPngBlobToClipboard(blobs[0]))) {
        showToast('Image clipboard not supported in this browser.', 'error');
        return;
      }

      if (blobs.length > 1) {
        snapshotPartsQueueRef.current = blobs.slice(1);
        snapshotPartsTotalRef.current = blobs.length;
        setSnapshotClipboardProgress({ total: blobs.length, nextPart: 2 });
        showToast(
          `Image 1 of ${blobs.length} copied. Tap Cart Snapshot again for image 2.`,
          'success'
        );
      } else {
        setSnapshotClipboardProgress(null);
        showToast('Cart snapshot copied to clipboard.', 'success');
      }
    } catch (e: any) {
      snapshotPartsQueueRef.current = [];
      snapshotPartsTotalRef.current = 0;
      showToast(e?.message || 'Failed to copy snapshot', 'error');
    }
  }, [
    cart?.cart_number,
    cart?.customer_name,
    cart?.store_name,
    cartId,
    cartItems,
    cartTotal,
    defaultStore?.name,
    selectedCustomer?.name,
    selectedCustomer?.phone,
    selectedCustomer?.balance,
    showToast,
    exportSplit,
  ]);

  const productsList = (productResults as MergedProduct[]) || [];
  const customersList = (customerResults as MergedCustomer[]) || [];

  const activeCustomerName =
    selectedCustomer?.name || cart?.customer_name || null;
  const activeCustomerPhone = selectedCustomer?.phone || null;
  const activeCustomerBalance = selectedCustomer?.balance;
  const customerInitial = activeCustomerName
    ? activeCustomerName.trim().charAt(0).toUpperCase()
    : null;

  return (
    <div className="space-y-4">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {postCheckoutCopy ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-sm text-amber-950">
            <span className="font-semibold">
              Invoice {postCheckoutCopy.invoiceNumber} page {postCheckoutCopy.nextPart - 1} of{' '}
              {postCheckoutCopy.totalParts}
            </span>{' '}
            is on your clipboard. Paste it in WhatsApp, then copy page{' '}
            {postCheckoutCopy.nextPart} of {postCheckoutCopy.totalParts} before going to the ledger.
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                finishDocumentPartsAndQueueLedger(postCheckoutCopy.ledgerBlob);
                const { customerId } = postCheckoutCopy;
                setPostCheckoutCopy(null);
                navigate(`/credit-ledger/${customerId}?copy_ledger=1`);
              }}
            >
              Skip to ledger
            </Button>
            <Button
              size="sm"
              className="bg-amber-600 hover:bg-amber-700"
              disabled={copyingPostCheckoutPart}
              onClick={() => void copyNextPostCheckoutPart()}
            >
              {copyingPostCheckoutPart
                ? 'Copying…'
                : `Copy page ${postCheckoutCopy.nextPart}/${postCheckoutCopy.totalParts}`}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-amber-600" />
              POS Credit
            </h1>
            <p className="text-sm text-gray-500">
              Products by name only — enter qty and price on each line.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {cartId && (
              <Button
                variant="outline"
                onClick={handleDeleteCurrentCart}
                disabled={isDeletingCart || cartTabs.length <= 1 || isCartLocked}
                className="flex items-center gap-1.5 text-red-600 border-red-300 hover:bg-red-50 text-sm"
                title={
                  isCartLocked
                    ? 'Unlock the cart to delete it.'
                    : cartTabs.length <= 1
                      ? 'Cannot delete the last cart.'
                      : 'Delete current cart'
                }
              >
                <Trash className="h-4 w-4" />
                <span className="hidden sm:inline">Delete Cart</span>
              </Button>
            )}
            <Button
              variant="primary"
              onClick={handleNewSale}
              disabled={createCartMutation.isPending}
              className="flex items-center gap-1.5 text-sm"
            >
              <Sparkles className="h-4 w-4" />
              <span className="hidden sm:inline">New Sale</span>
              <span className="sm:hidden">New</span>
            </Button>
          </div>
        </div>
        <div className="flex justify-center">
          <CreditPOSModeToggle mode="sale" />
        </div>

        {/* Customer search / selected customer — top of POS */}
        <div
          className={`rounded-xl border px-4 py-3 transition-all ${
            activeCustomerName
              ? 'bg-amber-50 border-amber-200 shadow-sm'
              : 'bg-white border-stone-200'
          }`}
        >
          {activeCustomerName ? (
            <div className="flex items-center gap-3 sm:gap-4">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold shadow-sm bg-amber-600 text-white ring-2 ring-amber-200"
                aria-hidden
              >
                {customerInitial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800/80">
                  Customer
                </p>
                <p className="text-lg sm:text-xl font-bold text-stone-900 truncate leading-tight mt-0.5">
                  {activeCustomerName}
                </p>
                {(activeCustomerPhone || activeCustomerBalance != null) && (
                  <p className="text-xs text-stone-500 mt-1 truncate">
                    {activeCustomerPhone}
                    {activeCustomerPhone && activeCustomerBalance != null && (
                      <span className="mx-1.5 text-stone-300">·</span>
                    )}
                    {activeCustomerBalance != null && (
                      <span className="font-semibold text-amber-800">
                        Balance ₹{formatNumber(parseFloat(String(activeCustomerBalance || 0)))}
                      </span>
                    )}
                    {selectedCustomer?.source ? (
                      <span className="ml-2 uppercase text-stone-400">{selectedCustomer.source}</span>
                    ) : null}
                  </p>
                )}
              </div>
              {activeCustomerBalance != null ? (
                <div className="hidden sm:flex shrink-0 flex-col items-end rounded-lg bg-amber-600 px-3.5 py-2 text-white shadow-sm">
                  <span className="text-[10px] font-semibold uppercase tracking-wide opacity-90">
                    Ledger
                  </span>
                  <span className="text-base font-bold tabular-nums leading-tight">
                    ₹{formatNumber(parseFloat(String(activeCustomerBalance || 0)))}
                  </span>
                </div>
              ) : null}
              <button
                type="button"
                className="shrink-0 p-2 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-amber-100/80 disabled:opacity-40"
                disabled={isCartLocked}
                onClick={clearCustomer}
                title="Clear customer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-400 border border-stone-200"
                  aria-hidden
                >
                  <User className="h-5 w-5" />
                </div>
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400 pointer-events-none" />
                  <Input
                    className={`pl-9 ${isCartLocked ? 'opacity-60 cursor-not-allowed bg-gray-50' : ''}`}
                    placeholder={
                      isCartLocked
                        ? 'Cart locked — unlock to select customer'
                        : 'Search credit + shop customers…'
                    }
                    value={customerSearch}
                    disabled={isCartLocked}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setCustomerIndex(0);
                    }}
                    onKeyDown={(e) => {
                      if (isCartLocked) return;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setCustomerIndex((i) => Math.min(i + 1, customersList.length - 1));
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setCustomerIndex((i) => Math.max(i - 1, 0));
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        if (customersList.length > 0) {
                          const idx = customerIndex >= 0 ? customerIndex : 0;
                          selectCustomer(customersList[idx]);
                        } else if (customerSearch.trim()) {
                          setNewCustomer({ name: customerSearch.trim(), phone: '' });
                          setShowCreateCustomer(true);
                        }
                      }
                    }}
                  />
                  {customerSearch.trim() && !isCartLocked && (
                    <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto">
                      {isCustomerSearching ||
                      customerSearch.trim() !== debouncedCustomerSearch.trim() ? (
                        <div className="px-3 py-2 text-sm text-gray-400">Searching…</div>
                      ) : customersList.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-400">
                          No customers found — press Enter to create “{customerSearch.trim()}”
                        </div>
                      ) : (
                        customersList.map((c, idx) => (
                          <button
                            key={`${c.source}-${c.id}`}
                            type="button"
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-amber-50 ${
                              idx === customerIndex ? 'bg-amber-50' : ''
                            }`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectCustomer(c);
                            }}
                          >
                            <div className="flex justify-between gap-2">
                              <span className="font-medium text-gray-900 truncate">{c.name}</span>
                              <span className="text-xs uppercase text-gray-400 shrink-0">{c.source}</span>
                            </div>
                            <div className="flex justify-between gap-2 text-xs text-gray-400 mt-0.5">
                              <span>{c.phone || '—'}</span>
                              <span className="text-amber-700 font-medium">
                                ₹{formatNumber(parseFloat(String(c.balance || 0)))}
                              </span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isCartLocked}
                className="shrink-0 self-stretch sm:self-auto"
                onClick={() => {
                  setNewCustomer({ name: customerSearch.trim() || '', phone: '' });
                  setShowCreateCustomer(true);
                }}
              >
                <UserPlus className="h-4 w-4 mr-1" />
                New
              </Button>
            </div>
          )}
        </div>
      </div>

      {cartTabs.length > 0 && (
        <div className="bg-white rounded-lg shadow border border-gray-200 flex items-start gap-2 p-2">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1 flex-1">
            {cartTabs.map((tab, index) => {
              const isActive = tab.id === activeTabId;
              const itemCount = isActive
                ? cartItems.length || tab.itemCount || 0
                : tab.itemCount || 0;
              const hasItems = itemCount > 0;
              const displayName = getTabDisplayName(tab, index);
              return (
                <div
                  key={tab.id}
                  onClick={() => handleTabSwitch(tab.id)}
                  className={`
                    flex items-center gap-0.5 sm:gap-2 px-1.5 sm:px-3 py-2 rounded-md cursor-pointer transition-all
                    w-full min-w-0 relative h-10
                    ${
                      isActive
                        ? 'bg-amber-600 text-white shadow-md ring-2 ring-amber-400'
                        : hasItems
                          ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-2 border-amber-300'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-2 border-gray-300'
                    }
                  `}
                  title={tab.cartNumber}
                >
                  <ShoppingCart
                    className={`h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0 ${hasItems && !isActive ? 'text-amber-600' : ''}`}
                  />
                  {tab.locked && <Lock className="h-3 w-3 flex-shrink-0 opacity-80" />}
                  <span className="text-[10px] sm:text-sm font-medium truncate flex-1" title={displayName}>
                    {displayName}
                  </span>
                  {hasItems && (
                    <span
                      className={`
                      flex items-center justify-center min-w-[18px] sm:min-w-[24px] h-4 sm:h-5 px-1 rounded-md text-[10px] sm:text-xs font-bold flex-shrink-0
                      ${isActive ? 'bg-white text-amber-600' : 'bg-amber-500 text-white'}
                    `}
                    >
                      {itemCount}
                    </span>
                  )}
                  {cartTabs.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => handleTabClose(e, tab.id)}
                      disabled={!!tab.locked}
                      className={`ml-0.5 p-0.5 rounded flex-shrink-0 ${
                        tab.locked
                          ? 'opacity-50 cursor-not-allowed'
                          : isActive
                            ? 'hover:bg-white/20'
                            : 'hover:bg-gray-300'
                      }`}
                      title={tab.locked ? 'Unlock to close' : 'Close tab'}
                    >
                      <X className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handleNewSale}
            disabled={createCartMutation.isPending}
            className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-md bg-amber-600 text-white hover:bg-amber-700 shadow-md flex-shrink-0"
            title="New Sale"
          >
            <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div
          ref={posWorkflowRef}
          className="lg:col-span-2 space-y-4"
          onKeyDown={handlePosWorkflowKeyDown}
          data-credit-pos-workflow
        >
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Package className="h-4 w-4" />
                Products
              </label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                tabIndex={-1}
                disabled={isCartLocked}
                onClick={() => {
                  setNewProductName(productSearch.trim() || '');
                  setShowCreateProduct(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1" />
                New credit product
              </Button>
            </div>
            {isCartLocked && (
              <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <Lock className="h-4 w-4" />
                <span>Cart is locked. Open a new cart from the tabs above to add items.</span>
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                ref={productInputRef}
                data-credit-pos-tab="search"
                className={`pl-9 ${isCartLocked ? 'opacity-60 cursor-not-allowed bg-gray-50' : ''}`}
                placeholder={
                  isCartLocked
                    ? 'Cart locked — open a new cart to add items'
                    : 'Search products by name…'
                }
                value={productSearch}
                disabled={isCartLocked}
                onChange={(e) => {
                  setProductSearch(e.target.value);
                  setProductIndex(0);
                }}
                onKeyDown={(e) => {
                  if (isCartLocked) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setProductIndex((i) => Math.min(i + 1, productsList.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setProductIndex((i) => Math.max(i - 1, 0));
                  } else if (e.key === 'Enter' && productsList.length > 0) {
                    e.preventDefault();
                    const idx = productIndex >= 0 ? productIndex : 0;
                    addProduct(productsList[idx]);
                  }
                }}
              />
              {productSearch.trim() && !isCartLocked && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-auto">
                  {isProductSearching || productSearch.trim() !== debouncedProductSearch.trim() ? (
                    <div className="px-3 py-2 text-sm text-gray-400">Searching…</div>
                  ) : productsList.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-400">
                      No products found for “{debouncedProductSearch.trim()}”
                    </div>
                  ) : (
                    productsList.map((p, idx) => (
                      <button
                        key={`${p.source}-${p.id}`}
                        type="button"
                        tabIndex={-1}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-amber-50 flex justify-between gap-2 ${
                          idx === productIndex ? 'bg-amber-50' : ''
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addProduct(p);
                        }}
                      >
                        <span>
                          {p.name}
                          {p.sku ? <span className="text-gray-400 ml-2">{p.sku}</span> : null}
                        </span>
                        <span className="text-xs uppercase text-gray-400">{p.source}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <h2 className="font-medium text-gray-900">Cart</h2>
                {isCartLocked && (
                  <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                    Locked
                  </span>
                )}
                <span className="text-sm text-gray-500">{cartItems.length} item(s)</span>
              </div>
              <div className="flex items-center gap-2">
                {cartId &&
                  (isCartLocked ? (
                    <Button
                      variant="outline"
                      size="sm"
                      tabIndex={-1}
                      onClick={() => lockCartMutation.mutate({ cartId, locked: false })}
                      disabled={lockCartMutation.isPending}
                      className="flex items-center gap-1.5 text-amber-600 border-amber-300 hover:bg-amber-50"
                    >
                      <LockOpen className="h-4 w-4" />
                      <span className="hidden sm:inline">Unlock</span>
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      tabIndex={-1}
                      onClick={() => lockCartMutation.mutate({ cartId, locked: true })}
                      disabled={lockCartMutation.isPending}
                      className="flex items-center gap-1.5 text-gray-600 border-gray-300 hover:bg-gray-50"
                      title="Lock cart (freeze edits; you can open a new cart)"
                    >
                      <Lock className="h-4 w-4" />
                      <span className="hidden sm:inline">Lock</span>
                    </Button>
                  ))}
                <Button
                  variant="outline"
                  size="sm"
                  tabIndex={-1}
                  onClick={copyDraftSnapshotToClipboard}
                  disabled={!cartItems.length}
                  className="relative flex items-center gap-1.5 text-gray-700 border-gray-300 hover:bg-gray-50"
                  title="Copy cart snapshot to clipboard"
                >
                  <Camera className="h-4 w-4" />
                  <span className="hidden sm:inline">Cart Snapshot</span>
                  <span className="sm:hidden">Snapshot</span>
                  {snapshotButtonBadge && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[1.35rem] h-[1.1rem] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none flex items-center justify-center tabular-nums">
                      {snapshotButtonBadge}
                    </span>
                  )}
                </Button>
              </div>
            </div>
            {cartItems.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                Search and add products. Enter qty and price on each line.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                <div className="px-3 py-2 text-xs text-gray-400 flex flex-wrap gap-3 bg-gray-50">
                  <div className="w-8 text-center">#</div>
                  <div className="flex-1 min-w-[140px]">Product</div>
                  <div className="w-24">Qty</div>
                  <div className="w-28">Price</div>
                  <div className="w-24 text-right">Line total</div>
                  <div className="w-8" />
                </div>
                {cartItems.map((item: any, index: number) => {
                  const lineTotal = effectiveLineTotal(item, editingQty, editingPrice);
                  return (
                  <div key={item.id} className="p-3 flex flex-wrap items-center gap-3">
                    <div className="w-8 text-center text-sm font-semibold text-gray-500 tabular-nums">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-[140px]">
                      <div className="font-medium text-gray-900 text-sm">
                        {item.product_name || item.product_display_name}
                      </div>
                      <div className="text-xs text-gray-400">
                        {item.product ? 'catalog' : 'credit'}
                      </div>
                    </div>
                    <div className="w-24">
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        data-credit-pos-tab="qty"
                        value={
                          editingQty[item.id] ??
                          (() => {
                            const n = parseFloat(String(item.quantity ?? '0'));
                            if (!Number.isFinite(n) || n <= 0) return '';
                            // Whole units only — never paint a wrong rounded qty for bad legacy decimals
                            return Number.isInteger(n) ? String(n) : String(Math.trunc(n) || '');
                          })()
                        }
                        disabled={isCartLocked}
                        onFocus={(e) => {
                          if (isCartLocked) return;
                          const n = parseFloat(String(item.quantity ?? '0'));
                          // Only clear placeholder zeros — keep real qty values when tabbing in
                          if (!Number.isFinite(n) || n <= 0) {
                            setEditingQty((prev) => ({ ...prev, [item.id]: '' }));
                          } else {
                            e.currentTarget.select();
                          }
                        }}
                        onChange={(e) => {
                          if (isCartLocked) return;
                          // Digits only while typing
                          const digits = e.target.value.replace(/\D/g, '');
                          setEditingQty((prev) => ({ ...prev, [item.id]: digits }));
                        }}
                        onBlur={(e) => {
                          if (skipQtyBlurRef.current.has(item.id)) {
                            skipQtyBlurRef.current.delete(item.id);
                            return;
                          }
                          void updateItemQty(item.id, e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const value = e.currentTarget.value;
                            skipQtyBlurRef.current.add(item.id);
                            void updateItemQty(item.id, value);
                            focusCreditPosTabField(
                              posWorkflowRef.current,
                              e.currentTarget,
                              false
                            );
                          }
                        }}
                        className="text-sm"
                        placeholder="Qty"
                        aria-label="Quantity"
                      />
                    </div>
                    <div className="w-28">
                      <Input
                        type="text"
                        inputMode="decimal"
                        data-credit-pos-tab="price"
                        value={
                          editingPrice[item.id] ??
                          (() => {
                            const n = parseFloat(String(item.unit_price ?? '0'));
                            if (!Number.isFinite(n) || n <= 0) return '';
                            return amountForInput(item.unit_price);
                          })()
                        }
                        disabled={isCartLocked}
                        onFocus={(e) => {
                          if (isCartLocked) return;
                          const n = parseFloat(String(item.unit_price ?? '0'));
                          // Only clear placeholder zeros — keep real prices when tabbing in
                          if (!Number.isFinite(n) || n <= 0) {
                            setEditingPrice((prev) => ({ ...prev, [item.id]: '' }));
                          } else {
                            e.currentTarget.select();
                          }
                        }}
                        onChange={(e) => {
                          if (isCartLocked) return;
                          setEditingPrice((prev) => ({ ...prev, [item.id]: e.target.value }));
                        }}
                        onBlur={(e) => {
                          if (skipPriceBlurRef.current.has(item.id)) {
                            skipPriceBlurRef.current.delete(item.id);
                            return;
                          }
                          void updateItemPrice(item.id, e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const value = e.currentTarget.value;
                            skipPriceBlurRef.current.add(item.id);
                            void updateItemPrice(item.id, value);
                            focusCreditPosTabField(
                              posWorkflowRef.current,
                              e.currentTarget,
                              false
                            );
                          }
                        }}
                        className="text-sm"
                        placeholder="Price"
                        aria-label="Unit price"
                      />
                    </div>
                    <div className="w-24 text-right text-sm font-medium tabular-nums">
                      ₹{formatNumber(lineTotal)}
                    </div>
                    <button
                      type="button"
                      data-credit-pos-tab="delete"
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-red-300"
                      disabled={isCartLocked}
                      onClick={() => removeItem(item.id)}
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                Invoice Date
                {isCustomInvoiceDate && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
                    Custom date
                  </span>
                )}
              </label>
              <Input
                type="date"
                value={invoiceDate}
                onChange={(e) => {
                  const next = e.target.value;
                  setInvoiceDate(next);
                  persistCreditInvoiceDate(next);
                }}
                className={`w-full h-11 text-sm font-medium border-2 rounded-lg ${
                  isCustomInvoiceDate ? 'border-amber-400 bg-amber-50/50' : ''
                }`}
                disabled={isCartLocked}
              />
              <p className="mt-1 text-xs text-gray-500">
                {isCustomInvoiceDate
                  ? 'Saved for next invoices too (including after refresh).'
                  : 'Time stays current; only the invoice date changes.'}
              </p>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Line items</span>
              <span className="font-medium tabular-nums">{cartLineCount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total qty</span>
              <span className="font-medium tabular-nums">{formatNumber(cartTotalQty)} Pcs.</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span className="font-medium">₹{formatNumber(cartTotal)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <span>Credit total</span>
              <span className="text-amber-700">₹{formatNumber(cartTotal)}</span>
            </div>
            <Button
              type="button"
              className="w-full"
              disabled={!canCheckout}
              loading={isCheckingOut}
              onClick={handleCheckout}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {isCheckingOut ? 'Creating…' : 'Checkout (Credit)'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => navigate('/credit-invoices')}
            >
              View credit invoices
            </Button>
          </div>
        </div>
      </div>

      <Modal
        isOpen={showCreateCustomer}
        onClose={() => setShowCreateCustomer(false)}
        title="New credit customer"
      >
        <div className="space-y-3">
          <Input
            label="Name"
            value={newCustomer.name}
            onChange={(e) => setNewCustomer((s) => ({ ...s, name: e.target.value }))}
          />
          <Input
            label="Phone (optional)"
            value={newCustomer.phone}
            onChange={(e) => setNewCustomer((s) => ({ ...s, phone: e.target.value }))}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreateCustomer(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newCustomer.name.trim() || createCustomerMutation.isPending}
              onClick={() => createCustomerMutation.mutate()}
            >
              Create
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showCreateProduct}
        onClose={() => setShowCreateProduct(false)}
        title="New credit product"
      >
        <div className="space-y-3">
          <Input
            label="Name"
            value={newProductName}
            onChange={(e) => setNewProductName(e.target.value)}
          />
          <p className="text-xs text-gray-500">
            Name only — set qty and price on the cart line after adding. Not saved to the main catalog.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreateProduct(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newProductName.trim() || createProductMutation.isPending}
              onClick={() => createProductMutation.mutate()}
            >
              Create & add
            </Button>
          </div>
        </div>
      </Modal>

      <iframe
        ref={draftSnapshotFrameRef}
        title="credit-draft-snapshot"
        className="fixed left-[-10000px] top-0 w-[794px] h-auto min-h-[1px] opacity-0 pointer-events-none border-0"
        aria-hidden="true"
      />
    </div>
  );
}
