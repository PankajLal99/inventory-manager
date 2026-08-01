import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useGuardedAsync } from '../../hooks/useGuardedAsync';
import {
  Search,
  Undo2,
  Trash2,
  User,
  X,
  Package,
} from 'lucide-react';
import CreditPOSModeToggle from './CreditPOSModeToggle';
import {
  copyDocumentThenQueueLedgerImage,
  copyPngBlobToClipboard,
  finishDocumentPartsAndQueueLedger,
} from './creditDocumentClipboard';
import { catalogApi, creditApi } from '../../lib/api';
import { amountForInput, formatNumber } from '../../lib/utils';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import ToastContainer from '../../components/ui/Toast';
import type { Toast } from '../../components/ui/Toast';

/** Tab cycle: Product Search → Qty → Price → Delete → Product Search */
const CREDIT_RETURN_TAB_ATTR = 'data-credit-pos-tab';

function getCreditReturnTabFields(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[${CREDIT_RETURN_TAB_ATTR}]`)).filter(
    (el) => {
      if (el.getAttribute('aria-disabled') === 'true') return false;
      if ((el as HTMLButtonElement).disabled) return false;
      if ((el as HTMLInputElement).disabled) return false;
      return true;
    }
  );
}

function focusCreditReturnTabField(
  root: HTMLElement | null,
  current: HTMLElement | null,
  reverse: boolean
) {
  if (!root) return;
  const fields = getCreditReturnTabFields(root);
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

function focusLastReturnQty(root: HTMLElement | null) {
  if (!root) return;
  const qtys = Array.from(
    root.querySelectorAll<HTMLElement>(`[${CREDIT_RETURN_TAB_ATTR}="qty"]`)
  ).filter((el) => !(el as HTMLInputElement).disabled);
  const last = qtys[qtys.length - 1];
  if (last) {
    last.focus();
    if (last instanceof HTMLInputElement) last.select?.();
  } else {
    root.querySelector<HTMLElement>(`[${CREDIT_RETURN_TAB_ATTR}="search"]`)?.focus();
  }
}

type MergedCustomer = {
  id: number;
  name: string;
  phone?: string | null;
  source: 'credit' | 'parties';
  credit_customer_id?: number | null;
  parties_customer_id?: number | null;
  balance?: string | number;
};

type SelectedCustomer = {
  credit_customer_id: number;
  name: string;
  phone?: string | null;
  balance?: string | number;
};

type MergedProduct = {
  id: number;
  name: string;
  sku?: string | null;
  source: 'credit' | 'catalog';
  credit_product_id?: number | null;
  catalog_product_id?: number | null;
  unit_price?: string | number | null;
};

type BasketRow = {
  key: string;
  product_name: string;
  catalog_product_id?: number | null;
  credit_product_id?: number | null;
  quantity: number;
  unit_price: number;
};

function num(v: string | number | undefined | null) {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

function productKey(p: MergedProduct) {
  if (p.source === 'credit') return `credit-${p.credit_product_id || p.id}`;
  return `catalog-${p.catalog_product_id || p.id}`;
}

export default function POSCreditReturn() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const productInputRef = useRef<HTMLInputElement>(null);
  const posWorkflowRef = useRef<HTMLDivElement>(null);
  const documentSnapshotFrameRef = useRef<HTMLIFrameElement>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);

  const [customerSearch, setCustomerSearch] = useState('');
  const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState('');
  const [customerIndex, setCustomerIndex] = useState(-1);
  const [selectedCustomer, setSelectedCustomer] = useState<SelectedCustomer | null>(null);

  const [productSearch, setProductSearch] = useState('');
  const [debouncedProductSearch, setDebouncedProductSearch] = useState('');
  const [productIndex, setProductIndex] = useState(-1);
  const [basket, setBasket] = useState<BasketRow[]>([]);
  const [editingQty, setEditingQty] = useState<Record<string, string>>({});
  const [editingPrice, setEditingPrice] = useState<Record<string, string>>({});
  const { runGuarded, isSubmitting: isSubmittingReturn } = useGuardedAsync();
  const [postReturnCopy, setPostReturnCopy] = useState<{
    customerId: number;
    returnNumber: string;
    remainingParts: Blob[];
    totalParts: number;
    nextPart: number;
    ledgerBlob: Blob;
  } | null>(null);
  const [copyingPostReturnPart, setCopyingPostReturnPart] = useState(false);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);
  const removeToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedCustomerSearch(customerSearch), 300);
    return () => window.clearTimeout(t);
  }, [customerSearch]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedProductSearch(productSearch), 300);
    return () => window.clearTimeout(t);
  }, [productSearch]);

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

  const { data: customerResults = [], isFetching: isCustomerSearching } = useQuery({
    queryKey: ['credit-customer-search', debouncedCustomerSearch],
    queryFn: async () => {
      const q = debouncedCustomerSearch.trim();
      if (q.length < 1) return [];
      const res = await creditApi.customers.search({ search: q });
      return res.data || [];
    },
    enabled: debouncedCustomerSearch.trim().length >= 1 && !selectedCustomer,
  });

  const { data: productResults = [], isFetching: searchingProducts } = useQuery({
    queryKey: ['credit-product-search', debouncedProductSearch],
    queryFn: async () => {
      const q = debouncedProductSearch.trim();
      if (q.length < 1) return [];
      const res = await creditApi.products.search({ search: q });
      return res.data || [];
    },
    enabled: !!selectedCustomer && debouncedProductSearch.trim().length >= 1,
  });

  const customersList = (customerResults as MergedCustomer[]) || [];
  const productsList = (productResults as MergedProduct[]) || [];

  const basketTotal = useMemo(
    () => basket.reduce((sum, row) => sum + row.quantity * row.unit_price, 0),
    [basket]
  );

  const basketLineCount = basket.length;

  const basketTotalQty = useMemo(() => {
    return basket.reduce((sum, row) => {
      const qtyRaw =
        editingQty[row.key] !== undefined ? editingQty[row.key] : String(row.quantity ?? '');
      const qty = parseFloat(String(qtyRaw).trim());
      if (!Number.isFinite(qty) || qty <= 0) return sum;
      return sum + Math.round(qty);
    }, 0);
  }, [basket, editingQty]);

  const selectCustomer = async (c: MergedCustomer) => {
    try {
      const ensurePayload: any = {};
      if (c.source === 'credit') {
        ensurePayload.credit_customer_id = c.credit_customer_id || c.id;
      } else {
        ensurePayload.parties_customer_id = c.parties_customer_id || c.id;
      }
      const res = await creditApi.customers.ensure(ensurePayload);
      const data = res.data;
      setSelectedCustomer({
        credit_customer_id: data.id,
        name: data.name,
        phone: data.phone,
        balance: data.balance,
      });
      setCustomerSearch('');
      setCustomerIndex(-1);
      setBasket([]);
      setProductSearch('');
      setTimeout(() => productInputRef.current?.focus(), 50);
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to select customer', 'error');
    }
  };

  const clearCustomer = () => {
    setSelectedCustomer(null);
    setBasket([]);
    setProductSearch('');
  };

  const addProduct = (product: MergedProduct) => {
    const key = productKey(product);
    const defaultPrice = num(product.unit_price);
    setBasket((prev) => {
      const existing = prev.find((r) => r.key === key);
      if (existing) {
        return prev.map((r) =>
          r.key === key ? { ...r, quantity: r.quantity + 1 } : r
        );
      }
      return [
        ...prev,
        {
          key,
          product_name: product.name,
          catalog_product_id:
            product.source === 'catalog'
              ? product.catalog_product_id || product.id
              : product.catalog_product_id || null,
          credit_product_id:
            product.source === 'credit'
              ? product.credit_product_id || product.id
              : product.credit_product_id || null,
          quantity: 1,
          unit_price: defaultPrice,
        },
      ];
    });
    setProductSearch('');
    setProductIndex(-1);
    window.setTimeout(() => focusLastReturnQty(posWorkflowRef.current), 40);
  };

  const handlePosWorkflowKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const target = e.target as HTMLElement | null;
    if (!target?.closest?.(`[${CREDIT_RETURN_TAB_ATTR}]`)) return;
    e.preventDefault();
    focusCreditReturnTabField(posWorkflowRef.current, target, e.shiftKey);
  };

  const setQty = (key: string, raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      setEditingQty((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    if (!/^\d+$/.test(trimmed)) {
      showToast('Quantity must be a whole number', 'error');
      setEditingQty((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    const qty = parseInt(trimmed, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      showToast('Quantity must be greater than 0', 'error');
      setEditingQty((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    setBasket((prev) => prev.map((r) => (r.key === key ? { ...r, quantity: qty } : r)));
    setEditingQty((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const setPrice = (key: string, raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      setEditingPrice((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    const price = parseFloat(trimmed);
    if (!Number.isFinite(price) || price < 0) {
      showToast('Price cannot be negative', 'error');
      setEditingPrice((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    setBasket((prev) =>
      prev.map((r) => (r.key === key ? { ...r, unit_price: price } : r))
    );
    setEditingPrice((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const removeRow = (key: string) => {
    setBasket((prev) => prev.filter((r) => r.key !== key));
    setEditingQty((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setEditingPrice((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = () => {
    if (isSubmittingReturn) return;
    runGuarded(async () => {
    if (!selectedCustomer) {
      showToast('Select a customer first', 'error');
      return;
    }
    if (!defaultStore?.id) {
      showToast('No store configured for credit POS', 'error');
      return;
    }
    if (!basket.length) {
      showToast('Add at least one return line', 'error');
      return;
    }
    for (const row of basket) {
      if (!Number.isInteger(row.quantity) || row.quantity <= 0) {
        showToast(`Invalid qty for ${row.product_name}`, 'error');
        return;
      }
      if (row.unit_price < 0) {
        showToast(`Invalid price for ${row.product_name}`, 'error');
        return;
      }
    }

      const res = await creditApi.returns.create({
        store: defaultStore.id,
        credit_customer_id: selectedCustomer.credit_customer_id,
        items: basket.map((r) => ({
          product_name: r.product_name,
          catalog_product_id: r.catalog_product_id || undefined,
          credit_product_id: r.credit_product_id || undefined,
          quantity: r.quantity,
          unit_price: r.unit_price,
        })),
      });
      const ret = res.data;
      const creditCustomerId =
        ret.customer || selectedCustomer.credit_customer_id || null;
      const customerName = ret.customer_name || selectedCustomer.name;
      const customerPhone = ret.customer_phone || selectedCustomer.phone;

      // Clear basket immediately after save — don't wait on clipboard / image work.
      setBasket([]);
      setEditingQty({});
      setEditingPrice({});
      setProductSearch('');
      queryClient.invalidateQueries({ queryKey: ['credit-returns'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-customers'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-statement'] });

      const iframe = documentSnapshotFrameRef.current;
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
            {
              variant: 'return',
              invoice_number: ret.return_number,
              customer_name: customerName,
              customer_phone: customerPhone,
              created_at: ret.created_at,
              total: Math.abs(parseFloat(String(ret.total ?? 0)) || 0),
              items: (ret.items || []).map((item: any) => ({
                product_name: item.product_name,
                quantity: Math.abs(Math.round(parseFloat(String(item.quantity ?? 0)) || 0)),
                unit_price: Math.abs(parseFloat(String(item.unit_price ?? 0)) || 0),
                line_total: Math.abs(parseFloat(String(item.line_total ?? 0)) || 0),
              })),
            },
            statementRes.data
          );
          clipboardCopied = copyResult.ok;
          remainingDocParts = copyResult.remainingDocumentParts;
          documentPartCount = copyResult.documentPartCount;
          ledgerBlob = copyResult.ledgerBlob;
        } catch (copyErr) {
          console.error('Return + ledger clipboard copy failed:', copyErr);
        }
      }

      if (
        clipboardCopied &&
        remainingDocParts.length > 0 &&
        creditCustomerId &&
        ledgerBlob
      ) {
        setPostReturnCopy({
          customerId: creditCustomerId,
          returnNumber: ret.return_number,
          remainingParts: remainingDocParts,
          totalParts: documentPartCount,
          nextPart: 2,
          ledgerBlob,
        });
        showToast(
          `Return ${ret.return_number} page 1 of ${documentPartCount} copied — paste it, then copy the next page`,
          'success'
        );
        return;
      }

      if (clipboardCopied) {
        showToast(
          `Return ${ret.return_number} copied (1/2) — paste it, then copy ledger (2/2)`,
          'success'
        );
      } else {
        showToast(
          iframe
            ? `Return ${ret.return_number} created (clipboard copy unavailable)`
            : `Credit return ${ret.return_number} created`,
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
      showToast(err?.response?.data?.detail || 'Return failed', 'error');
    });
  };

  const copyNextPostReturnPart = useCallback(async () => {
    if (!postReturnCopy || copyingPostReturnPart) return;
    setCopyingPostReturnPart(true);
    try {
      const remaining = [...postReturnCopy.remainingParts];
      const blob = remaining.shift();
      if (!blob) {
        setPostReturnCopy(null);
        return;
      }
      if (!(await copyPngBlobToClipboard(blob))) {
        showToast('Could not copy return image', 'error');
        return;
      }
      const partNum = postReturnCopy.nextPart;
      if (remaining.length > 0) {
        setPostReturnCopy({
          ...postReturnCopy,
          remainingParts: remaining,
          nextPart: partNum + 1,
        });
        showToast(
          `Return page ${partNum} of ${postReturnCopy.totalParts} copied — paste it, then copy the next page`,
          'success'
        );
        return;
      }

      finishDocumentPartsAndQueueLedger(postReturnCopy.ledgerBlob);
      const { customerId, returnNumber, totalParts } = postReturnCopy;
      setPostReturnCopy(null);
      showToast(
        `Return ${returnNumber} page ${partNum} of ${totalParts} copied — redirecting to copy ledger`,
        'success'
      );
      navigate(`/credit-ledger/${customerId}?copy_ledger=1`);
    } finally {
      setCopyingPostReturnPart(false);
    }
  }, [postReturnCopy, copyingPostReturnPart, navigate, showToast]);

  return (
    <div className="space-y-4">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {postReturnCopy ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-sm text-amber-950">
            <span className="font-semibold">
              Return {postReturnCopy.returnNumber} page {postReturnCopy.nextPart - 1} of{' '}
              {postReturnCopy.totalParts}
            </span>{' '}
            is on your clipboard. Paste it, then copy page {postReturnCopy.nextPart} of{' '}
            {postReturnCopy.totalParts} before going to the ledger.
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                finishDocumentPartsAndQueueLedger(postReturnCopy.ledgerBlob);
                const { customerId } = postReturnCopy;
                setPostReturnCopy(null);
                navigate(`/credit-ledger/${customerId}?copy_ledger=1`);
              }}
            >
              Skip to ledger
            </Button>
            <Button
              size="sm"
              className="bg-amber-600 hover:bg-amber-700"
              disabled={copyingPostReturnPart}
              onClick={() => void copyNextPostReturnPart()}
            >
              {copyingPostReturnPart
                ? 'Copying…'
                : `Copy page ${postReturnCopy.nextPart}/${postReturnCopy.totalParts}`}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Undo2 className="h-5 w-5 text-amber-600" />
            POS Credit Return
          </h1>
          <p className="text-sm text-gray-500">
            Return any products for this customer. Qty and price are editable; this credits their
            ledger balance.
          </p>
        </div>
        <div className="flex justify-center">
          <CreditPOSModeToggle mode="return" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div
          ref={posWorkflowRef}
          className="lg:col-span-2 space-y-4"
          onKeyDown={handlePosWorkflowKeyDown}
          data-credit-pos-workflow
        >
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <User className="h-4 w-4" />
              Customer
            </label>
            {selectedCustomer ? (
              <div className="flex items-start justify-between gap-2 bg-amber-50 border border-amber-100 rounded-md p-3">
                <div>
                  <div className="font-medium text-gray-900">{selectedCustomer.name}</div>
                  {selectedCustomer.phone ? (
                    <div className="text-xs text-gray-500">{selectedCustomer.phone}</div>
                  ) : null}
                  <div className="text-xs text-amber-700 mt-1">
                    Balance: ₹{formatNumber(num(selectedCustomer.balance))}
                  </div>
                </div>
                <button type="button" className="text-gray-400 hover:text-gray-600" onClick={clearCustomer}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  placeholder="Search customer…"
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setCustomerIndex(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setCustomerIndex((i) => Math.min(i + 1, customersList.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setCustomerIndex((i) => Math.max(i - 1, 0));
                    } else if (e.key === 'Enter' && customersList.length > 0) {
                      e.preventDefault();
                      const idx = customerIndex >= 0 ? customerIndex : 0;
                      selectCustomer(customersList[idx]);
                    }
                  }}
                />
                {customerSearch.trim() && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-56 overflow-auto">
                    {isCustomerSearching || customerSearch.trim() !== debouncedCustomerSearch.trim() ? (
                      <div className="px-3 py-2 text-sm text-gray-400">Searching…</div>
                    ) : customersList.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-400">No customers found</div>
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
                          <div className="flex justify-between">
                            <span>{c.name}</span>
                            <span className="text-xs uppercase text-gray-400">{c.source}</span>
                          </div>
                          {c.phone ? <div className="text-xs text-gray-400">{c.phone}</div> : null}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <Package className="h-4 w-4" />
              Products
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                ref={productInputRef}
                data-credit-pos-tab="search"
                className="pl-9"
                placeholder={
                  selectedCustomer ? 'Search any product…' : 'Select a customer first'
                }
                disabled={!selectedCustomer}
                value={productSearch}
                onChange={(e) => {
                  setProductSearch(e.target.value);
                  setProductIndex(0);
                }}
                onKeyDown={(e) => {
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
              {selectedCustomer && productSearch.trim() ? (
                <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-56 overflow-auto">
                  {searchingProducts || productSearch.trim() !== debouncedProductSearch.trim() ? (
                    <div className="px-3 py-2 text-sm text-gray-400">Searching…</div>
                  ) : productsList.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-400">No products found</div>
                  ) : (
                    productsList.map((p, idx) => (
                      <button
                        key={productKey(p)}
                        type="button"
                        tabIndex={-1}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-amber-50 ${
                          idx === productIndex ? 'bg-amber-50' : ''
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addProduct(p);
                        }}
                      >
                        <div className="flex justify-between gap-2">
                          <span className="font-medium text-gray-900">{p.name}</span>
                          <span className="text-xs text-gray-500 shrink-0">
                            ₹{formatNumber(num(p.unit_price))}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 flex justify-between">
                          <span>{p.sku || '—'}</span>
                          <span className="uppercase">{p.source}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {basket.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">
                Select a customer, then search any product to return.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                <div className="hidden sm:grid grid-cols-[2.5rem_1fr_7rem_7rem_7rem_2.5rem] gap-2 px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50">
                  <div className="text-center">#</div>
                  <div>Product</div>
                  <div className="text-right">Qty</div>
                  <div className="text-right">Price</div>
                  <div className="text-right">Total</div>
                  <div />
                </div>
                {basket.map((row, index) => {
                  const lineTotal = row.quantity * row.unit_price;
                  return (
                    <div
                      key={row.key}
                      className="grid grid-cols-1 sm:grid-cols-[2.5rem_1fr_7rem_7rem_7rem_2.5rem] gap-2 px-4 py-3 items-center"
                    >
                      <div className="text-center text-sm font-semibold text-gray-500 tabular-nums">
                        {index + 1}
                      </div>
                      <div className="font-medium text-gray-900 text-sm">{row.product_name}</div>
                      <Input
                        type="text"
                        inputMode="numeric"
                        data-credit-pos-tab="qty"
                        className="h-9 text-right"
                        value={
                          editingQty[row.key] !== undefined
                            ? editingQty[row.key]
                            : String(row.quantity)
                        }
                        onFocus={(e) => {
                          // Only clear placeholder zeros — keep real qty when tabbing in
                          if (!Number.isFinite(row.quantity) || row.quantity <= 0) {
                            setEditingQty((prev) => ({ ...prev, [row.key]: '' }));
                          } else {
                            e.currentTarget.select();
                          }
                        }}
                        onChange={(e) =>
                          setEditingQty((prev) => ({
                            ...prev,
                            [row.key]: e.target.value.replace(/\D/g, ''),
                          }))
                        }
                        onBlur={(e) => setQty(row.key, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            focusCreditReturnTabField(
                              posWorkflowRef.current,
                              e.currentTarget,
                              false
                            );
                          }
                        }}
                        aria-label="Quantity"
                      />
                      <Input
                        type="text"
                        inputMode="decimal"
                        data-credit-pos-tab="price"
                        className="h-9 text-right"
                        value={
                          editingPrice[row.key] !== undefined
                            ? editingPrice[row.key]
                            : amountForInput(row.unit_price)
                        }
                        onFocus={(e) => {
                          // Only clear placeholder zeros — keep real prices when tabbing in
                          if (!Number.isFinite(row.unit_price) || row.unit_price <= 0) {
                            setEditingPrice((prev) => ({ ...prev, [row.key]: '' }));
                          } else {
                            e.currentTarget.select();
                          }
                        }}
                        onChange={(e) =>
                          setEditingPrice((prev) => ({ ...prev, [row.key]: e.target.value }))
                        }
                        onBlur={(e) => setPrice(row.key, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            focusCreditReturnTabField(
                              posWorkflowRef.current,
                              e.currentTarget,
                              false
                            );
                          }
                        }}
                        aria-label="Unit price"
                      />
                      <div className="text-right text-sm font-semibold text-gray-900">
                        ₹{formatNumber(lineTotal)}
                      </div>
                      <button
                        type="button"
                        data-credit-pos-tab="delete"
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded justify-self-end focus:outline-none focus:ring-2 focus:ring-red-300"
                        onClick={() => removeRow(row.key)}
                        title="Remove"
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
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Line items</span>
              <span className="font-medium tabular-nums">{basketLineCount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total qty</span>
              <span className="font-medium tabular-nums">{formatNumber(basketTotalQty)} Pcs.</span>
            </div>
            <div className="flex justify-between text-base font-semibold border-t border-gray-100 pt-3">
              <span>Return total</span>
              <span className="text-amber-700">₹{formatNumber(basketTotal)}</span>
            </div>
            <p className="text-xs text-gray-500">
              Any product can be returned. Edit qty and price freely — this reduces the
              customer&apos;s credit balance.
            </p>
            <Button
              className="w-full bg-amber-600 hover:bg-amber-700"
              disabled={isSubmittingReturn || !basket.length || !selectedCustomer}
              loading={isSubmittingReturn}
              onClick={handleSubmit}
            >
              {isSubmittingReturn ? 'Submitting…' : 'Complete Return'}
            </Button>
          </div>
        </div>
      </div>

      <iframe
        ref={documentSnapshotFrameRef}
        title="credit-return-snapshot"
        className="fixed left-[-10000px] top-0 w-[794px] h-auto min-h-[1px] opacity-0 pointer-events-none border-0"
        aria-hidden="true"
      />
    </div>
  );
}
