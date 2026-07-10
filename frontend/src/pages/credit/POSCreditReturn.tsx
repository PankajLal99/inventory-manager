import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Undo2,
  Trash2,
  User,
  X,
  CheckCircle,
  Package,
} from 'lucide-react';
import CreditPOSModeToggle from './CreditPOSModeToggle';
import { catalogApi, creditApi } from '../../lib/api';
import { formatNumber } from '../../lib/utils';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
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

type SelectedCustomer = {
  credit_customer_id: number;
  name: string;
  phone?: string | null;
  balance?: string | number;
};

type SoldLine = {
  invoice_item_id: number;
  invoice_id: number;
  invoice_number: string;
  product_name: string;
  sold_unit_price: string | number;
  sold_quantity: string | number;
  returned_quantity: string | number;
  returnable_quantity: string | number;
  sold_at?: string;
};

type BasketRow = SoldLine & {
  quantity: number;
};

function num(v: string | number | undefined | null) {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

export default function POSCreditReturn() {
  const navigate = useNavigate();
  const productInputRef = useRef<HTMLInputElement>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);

  const [customerSearch, setCustomerSearch] = useState('');
  const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState('');
  const [customerIndex, setCustomerIndex] = useState(-1);
  const [selectedCustomer, setSelectedCustomer] = useState<SelectedCustomer | null>(null);

  const [productSearch, setProductSearch] = useState('');
  const [debouncedProductSearch, setDebouncedProductSearch] = useState('');
  const [productIndex, setProductIndex] = useState(-1);
  const [basket, setBasket] = useState<BasketRow[]>([]);
  const [editingReturnQty, setEditingReturnQty] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);
  const removeToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedCustomerSearch(customerSearch), 300);
    return () => window.clearTimeout(t);
  }, [customerSearch]);

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

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedProductSearch(productSearch), 300);
    return () => window.clearTimeout(t);
  }, [productSearch]);

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

  const { data: soldResults = [], isFetching: searchingSold } = useQuery({
    queryKey: ['credit-sold-products', selectedCustomer?.credit_customer_id, debouncedProductSearch],
    queryFn: async () => {
      if (!selectedCustomer?.credit_customer_id) return [];
      const q = debouncedProductSearch.trim();
      if (q.length < 1) return [];
      const res = await creditApi.returns.soldProducts({
        credit_customer_id: selectedCustomer.credit_customer_id,
        search: q,
      });
      return res.data || [];
    },
    enabled: !!selectedCustomer?.credit_customer_id && debouncedProductSearch.trim().length >= 1,
  });

  const customersList = (customerResults as MergedCustomer[]) || [];
  const soldList = (soldResults as SoldLine[]) || [];

  const basketTotal = useMemo(
    () => basket.reduce((sum, row) => sum + row.quantity * num(row.sold_unit_price), 0),
    [basket]
  );

  const qtyAlreadyInBasket = (invoiceItemId: number) =>
    basket
      .filter((r) => r.invoice_item_id === invoiceItemId)
      .reduce((s, r) => s + r.quantity, 0);

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

  const addSoldLine = (line: SoldLine) => {
    const maxQty = Math.floor(num(line.returnable_quantity));
    const already = qtyAlreadyInBasket(line.invoice_item_id);
    if (already >= maxQty) {
      showToast(
        `Already returning max ${maxQty} for ${line.product_name} (${line.invoice_number})`,
        'error'
      );
      return;
    }
    setBasket((prev) => {
      const existing = prev.find((r) => r.invoice_item_id === line.invoice_item_id);
      if (existing) {
        return prev.map((r) =>
          r.invoice_item_id === line.invoice_item_id
            ? { ...r, quantity: Math.min(r.quantity + 1, maxQty) }
            : r
        );
      }
      return [...prev, { ...line, quantity: 1 }];
    });
    setProductSearch('');
    setProductIndex(-1);
    productInputRef.current?.focus();
  };

  const setQty = (invoiceItemId: number, raw: string) => {
    const line = basket.find((r) => r.invoice_item_id === invoiceItemId);
    if (!line) return;
    const trimmed = raw.trim();
    if (trimmed === '') {
      setEditingReturnQty((prev) => {
        const next = { ...prev };
        delete next[invoiceItemId];
        return next;
      });
      return;
    }
    if (!/^\d+$/.test(trimmed)) {
      showToast('Quantity must be a whole number', 'error');
      setEditingReturnQty((prev) => {
        const next = { ...prev };
        delete next[invoiceItemId];
        return next;
      });
      return;
    }
    const maxQty = Math.floor(num(line.returnable_quantity));
    let qty = parseInt(trimmed, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      showToast('Quantity must be greater than 0', 'error');
      setEditingReturnQty((prev) => {
        const next = { ...prev };
        delete next[invoiceItemId];
        return next;
      });
      return;
    }
    if (qty > maxQty) {
      showToast(`Max returnable qty is ${maxQty} (sold on ${line.invoice_number})`, 'error');
      qty = maxQty;
    }
    setBasket((prev) =>
      prev.map((r) => (r.invoice_item_id === invoiceItemId ? { ...r, quantity: qty } : r))
    );
    setEditingReturnQty((prev) => {
      const next = { ...prev };
      delete next[invoiceItemId];
      return next;
    });
  };

  const removeRow = (invoiceItemId: number) => {
    setBasket((prev) => prev.filter((r) => r.invoice_item_id !== invoiceItemId));
  };

  const handleSubmit = async () => {
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
      const maxQty = Math.floor(num(row.returnable_quantity));
      if (!Number.isInteger(row.quantity) || row.quantity <= 0 || row.quantity > maxQty) {
        showToast(`Invalid qty for ${row.product_name} (max ${maxQty})`, 'error');
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await creditApi.returns.create({
        store: defaultStore.id,
        credit_customer_id: selectedCustomer.credit_customer_id,
        items: basket.map((r) => ({
          invoice_item_id: r.invoice_item_id,
          quantity: r.quantity,
        })),
      });
      const ret = res.data;
      showToast(`Credit return ${ret.return_number} created`);
      setBasket([]);
      navigate(`/credit-ledger/${selectedCustomer.credit_customer_id}`);
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Return failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <div className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Undo2 className="h-5 w-5 text-amber-600" />
            POS Credit Return
          </h1>
          <p className="text-sm text-gray-500">
            Return products from this customer&apos;s credit invoices at the sold price. Qty cannot exceed what was sold.
          </p>
        </div>
        <div className="flex justify-center">
          <CreditPOSModeToggle mode="return" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
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
              Sold products (this customer)
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                ref={productInputRef}
                className="pl-9"
                placeholder={
                  selectedCustomer
                    ? 'Search product sold on their credit invoices…'
                    : 'Select a customer first'
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
                    setProductIndex((i) => Math.min(i + 1, soldList.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setProductIndex((i) => Math.max(i - 1, 0));
                  } else if (e.key === 'Enter' && soldList.length > 0) {
                    e.preventDefault();
                    const idx = productIndex >= 0 ? productIndex : 0;
                    addSoldLine(soldList[idx]);
                  }
                }}
              />
              {selectedCustomer && productSearch.trim() && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-72 overflow-auto">
                  {searchingSold || productSearch.trim() !== debouncedProductSearch.trim() ? (
                    <div className="px-3 py-2 text-sm text-gray-400">Searching…</div>
                  ) : soldList.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-400">
                      No matching sold products with remaining qty for this customer.
                    </div>
                  ) : (
                    soldList.map((line, idx) => (
                      <button
                        key={line.invoice_item_id}
                        type="button"
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-amber-50 ${
                          idx === productIndex ? 'bg-amber-50' : ''
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addSoldLine(line);
                        }}
                      >
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">{line.product_name}</span>
                          <span className="text-amber-700">
                            ₹{formatNumber(num(line.sold_unit_price))}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 flex flex-wrap gap-x-3">
                          <span>{line.invoice_number}</span>
                          <span>
                            Returnable {formatNumber(num(line.returnable_quantity))} / sold{' '}
                            {formatNumber(num(line.sold_quantity))}
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-medium text-gray-900">Return basket</h2>
              <span className="text-sm text-gray-500">{basket.length} line(s)</span>
            </div>
            {basket.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                Select a customer, then search products from their credit invoices.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                <div className="px-3 py-2 text-xs text-gray-400 flex flex-wrap gap-3 bg-gray-50">
                  <div className="flex-1 min-w-[140px]">Product / invoice</div>
                  <div className="w-24">Qty</div>
                  <div className="w-28">Sold price</div>
                  <div className="w-24 text-right">Credit</div>
                  <div className="w-8" />
                </div>
                {basket.map((row) => {
                  const maxQty = Math.floor(num(row.returnable_quantity));
                  const lineTotal = row.quantity * num(row.sold_unit_price);
                  return (
                    <div key={row.invoice_item_id} className="p-3 flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-[140px]">
                        <div className="font-medium text-gray-900 text-sm">{row.product_name}</div>
                        <div className="text-xs text-gray-400">
                          {row.invoice_number} · max {maxQty}
                        </div>
                      </div>
                      <div className="w-24">
                        <Input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={
                            editingReturnQty[row.invoice_item_id] ?? String(row.quantity)
                          }
                          onFocus={() =>
                            setEditingReturnQty((prev) => ({
                              ...prev,
                              [row.invoice_item_id]: '',
                            }))
                          }
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, '');
                            setEditingReturnQty((prev) => ({
                              ...prev,
                              [row.invoice_item_id]: digits,
                            }));
                          }}
                          onBlur={(e) => setQty(row.invoice_item_id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          }}
                          className="text-sm"
                          placeholder="Qty"
                          aria-label="Return quantity"
                        />
                      </div>
                      <div className="w-28 text-sm text-gray-700">
                        ₹{formatNumber(num(row.sold_unit_price))}
                      </div>
                      <div className="w-24 text-right text-sm font-medium">
                        ₹{formatNumber(lineTotal)}
                      </div>
                      <button
                        type="button"
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                        onClick={() => removeRow(row.invoice_item_id)}
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
              <span className="text-gray-500">Return credit</span>
              <span className="font-semibold text-amber-700">₹{formatNumber(basketTotal)}</span>
            </div>
            <p className="text-xs text-gray-500">
              Price is locked to what was sold on the credit invoice. This reduces the customer&apos;s credit balance.
            </p>
            <Button
              type="button"
              className="w-full"
              disabled={submitting || !basket.length || !selectedCustomer}
              onClick={handleSubmit}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {submitting ? 'Submitting…' : 'Complete return'}
            </Button>
            <Button type="button" variant="secondary" className="w-full" onClick={() => navigate('/pos-credit')}>
              Back to POS Credit
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
