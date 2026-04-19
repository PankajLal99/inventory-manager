import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { posApi, customersApi } from '../../lib/api';
import { formatNumber, getProductNameColor } from '../../lib/utils';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import BarcodeScanner from '../../components/BarcodeScanner';
import ToastContainer from '../../components/ui/Toast';
import type { Toast } from '../../components/ui/Toast';
import {
  ArrowLeft,
  Camera,
  AlertTriangle,
  Trash2,
  ScanLine,
  Search,
  Barcode,
  Store,
  User,
  FileText,
  X,
  ShoppingCart,
  CheckCircle,
  XCircle,
} from 'lucide-react';

type LookupLine = {
  original_invoice_item_id: number;
  original_invoice_number: string;
  store_id?: number | null;
  store_name?: string | null;
  customer_id: number | null;
  customer_name: string | null;
  product_name: string | null;
  product_sku?: string | null;
  sold_barcode_value?: string | null;
  barcode_short?: string | null;
  barcode_full?: string | null;
  sold_unit_price: string;
  quantity: string;
};

type ReturnTagChoice = 'returned' | 'unknown' | 'defective';

function isValidReturnTag(t: ReturnTagChoice | null | undefined): t is ReturnTagChoice {
  return t === 'returned' || t === 'unknown' || t === 'defective';
}

type BasketRow = LookupLine & {
  /** Normalized value used for the successful lookup (typed or scanned), e.g. short code `FOL-29713`. */
  lookup_input?: string | null;
  /** `null` until the user picks a traffic-light tag (never auto-filled). */
  return_tag: ReturnTagChoice | null;
  /** Per-line accepted credit; PENDING may be empty/0. If &gt; 0, must be &lt; sold unit price. INSTANT must be &gt; 0 and &lt; sold. */
  accepted_return_price: string;
};

type SelectedCustomer = { id: number; name: string; phone?: string | null };

function basketLineQty(r: BasketRow) {
  const q = parseFloat(String(r.quantity));
  return Number.isFinite(q) && q > 0 ? q : 1;
}

function normalizeReplacementBarcode(raw: string, strict: boolean): string {
  let v = raw.trim().toUpperCase();
  if (!strict) {
    v = v.replace(/[\s-]/g, '');
  }
  return v;
}

function codesDiffer(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? '').trim().toUpperCase();
  const y = (b ?? '').trim().toUpperCase();
  return Boolean(x && y && x !== y);
}

function acceptedUnitForLine(row: BasketRow): number {
  const a = parseFloat(String(row.accepted_return_price ?? '').trim());
  return Number.isFinite(a) && a > 0 ? a : 0;
}

export default function ReplacementPOS() {
  const navigate = useNavigate();
  const [selectedCustomer, setSelectedCustomer] = useState<SelectedCustomer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerSearchSelectedIndex, setCustomerSearchSelectedIndex] = useState(-1);
  const [mode, setMode] = useState<'instant' | 'pending'>('pending');
  const [settlementType, setSettlementType] = useState<'cash' | 'upi' | 'mixed' | 'credit'>('cash');
  const [cashAmount, setCashAmount] = useState('');
  const [upiAmount, setUpiAmount] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeStatus, setBarcodeStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [barcodeMessage, setBarcodeMessage] = useState('');
  const [strictStickerMode, setStrictStickerMode] = useState(true);
  const [showScanner, setShowScanner] = useState(false);
  const [basket, setBasket] = useState<BasketRow[]>([]);
  const [ambiguousMatches, setAmbiguousMatches] = useState<LookupLine[] | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [now, setNow] = useState(() => new Date());
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  /** Last barcode / short code sent to lookup (used when resolving ambiguous matches). */
  const lastLookupInputRef = useRef<string>('');

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);
  const removeToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, []);

  const { data: customersResults } = useQuery({
    queryKey: ['customers-search', customerSearch],
    queryFn: async () => {
      const q = customerSearch.trim();
      if (q.length < 2) return [];
      const res = await customersApi.list({ search: q });
      const d = res.data;
      return Array.isArray(d) ? d : d?.results || [];
    },
    enabled: customerSearch.trim().length >= 2,
  });

  const customersList = useMemo(() => (Array.isArray(customersResults) ? customersResults : []), [customersResults]);

  const customerWarning = useMemo(() => {
    const ids = new Set(basket.map((r) => r.customer_id).filter((x) => x != null));
    return ids.size > 1;
  }, [basket]);

  const storeWarning = useMemo(() => {
    const ids = new Set(basket.map((r) => r.store_id).filter((x) => x != null));
    return ids.size > 1;
  }, [basket]);

  const derivedStoreLabel = useMemo(() => {
    if (!basket.length) return null;
    const first = basket[0];
    return first.store_name || (first.store_id != null ? `Store #${first.store_id}` : null);
  }, [basket]);

  const allLinesHaveReturnTag = useMemo(
    () => basket.length > 0 && basket.every((r) => isValidReturnTag(r.return_tag)),
    [basket]
  );

  const totalQty = useMemo(() => basket.reduce((s, r) => s + basketLineQty(r), 0), [basket]);

  const totalAcceptedCredit = useMemo(
    () => basket.reduce((s, r) => s + acceptedUnitForLine(r) * basketLineQty(r), 0),
    [basket]
  );

  const addLineFromLookup = useCallback((line: LookupLine, lookupInput?: string | null) => {
    if (!line?.original_invoice_item_id) {
      showToast('Unexpected lookup response', 'error');
      return;
    }
    const trimmedLookup = lookupInput?.trim() || '';
    let isDuplicate = false;
    setBasket((prev) => {
      if (prev.some((b) => b.original_invoice_item_id === line.original_invoice_item_id)) {
        isDuplicate = true;
        return prev;
      }
      return [
        ...prev,
        {
          ...line,
          lookup_input: trimmedLookup || null,
          return_tag: null,
          accepted_return_price: '',
        },
      ];
    });
    if (isDuplicate) {
      setBarcodeStatus('success');
      setBarcodeMessage('Item already in cart');
      setTimeout(() => {
        setBarcodeStatus('idle');
        setBarcodeMessage('');
      }, 1500);
      return;
    }
    if (line.customer_id) {
      setSelectedCustomer({
        id: line.customer_id,
        name: line.customer_name || `Customer #${line.customer_id}`,
      });
    }
    setAmbiguousMatches(null);
    setBarcodeInput('');
    setBarcodeStatus('success');
    setBarcodeMessage('Added to cart');
    setTimeout(() => {
      setBarcodeStatus('idle');
      setBarcodeMessage('');
    }, 1500);
  }, [showToast]);

  const lookupMutation = useMutation({
    mutationFn: async (barcode: string) => {
      const data = (await posApi.replacement.replacementPos.lookup({ barcode })).data;
      return { data, lookupInput: barcode };
    },
    onSuccess: ({ data, lookupInput }) => {
      lastLookupInputRef.current = lookupInput;
      if (data.ambiguous && Array.isArray(data.matches)) {
        setAmbiguousMatches(data.matches);
        setBarcodeStatus('idle');
        setBarcodeMessage('');
        return;
      }
      const line = data.line as LookupLine;
      addLineFromLookup(line, lookupInput);
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        'Lookup failed';
      setBarcodeStatus('error');
      setBarcodeMessage(String(msg));
      showToast(String(msg), 'error');
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Parameters<typeof posApi.replacement.replacementPos.create>[0]) =>
      (await posApi.replacement.replacementPos.create(payload)).data,
    onSuccess: (inv) => {
      showToast(mode === 'instant' ? 'Return finalized' : 'Draft saved');
      navigate(`/invoices/${inv.id}`);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Create failed';
      showToast(String(msg), 'error');
    },
  });

  const runLookup = useCallback(() => {
    const el = barcodeInputRef.current;
    const raw = (el?.value ?? barcodeInput).trim();
    if (!raw) return;
    const v = normalizeReplacementBarcode(raw, strictStickerMode);
    if (!v) return;
    setBarcodeStatus('idle');
    setBarcodeMessage('');
    lookupMutation.mutate(v);
  }, [barcodeInput, lookupMutation, strictStickerMode]);

  const pickAmbiguous = (line: LookupLine) => {
    addLineFromLookup(line, lastLookupInputRef.current || null);
  };

  const submitCreate = () => {
    if (storeWarning) {
      showToast('All lines must be from the same store. Remove lines from a different sale.', 'error');
      return;
    }
    if (!basket.length) {
      showToast('Add at least one line item', 'error');
      return;
    }
    for (const row of basket) {
      if (!isValidReturnTag(row.return_tag)) {
        showToast(
          'Select a return tag (green / red / yellow) for every line item. Each line needs returned, unknown, or defective.',
          'error',
        );
        return;
      }
    }
    for (const row of basket) {
      const sold = parseFloat(row.sold_unit_price || '0');
      if (!sold || sold <= 0) {
        showToast(`Missing sold unit price for ${row.product_name || 'item'}`, 'error');
        return;
      }
    }
    if (mode === 'instant') {
      for (const row of basket) {
        const acc = parseFloat(String(row.accepted_return_price ?? '').trim());
        if (!Number.isFinite(acc) || acc <= 0) {
          showToast(
            `Instant return: enter accepted price greater than 0 for ${row.product_name || 'item'}`,
            'error',
          );
          return;
        }
      }
    }
    for (const row of basket) {
      const raw = String(row.accepted_return_price ?? '').trim();
      const acc = parseFloat(raw);
      const sold = parseFloat(row.sold_unit_price || '0');
      if (raw !== '' && Number.isFinite(acc) && acc > 0 && acc >= sold) {
        showToast(
          `Accepted price must be less than sold unit price (₹${formatNumber(sold)}) for ${row.product_name || 'item'}`,
          'error',
        );
        return;
      }
    }
    createMutation.mutate({
      customer: selectedCustomer?.id,
      mode,
      settlement_invoice_type: settlementType,
      cash_amount: settlementType === 'mixed' ? cashAmount : undefined,
      upi_amount: settlementType === 'mixed' ? upiAmount : undefined,
      lines: basket.map((b) => {
        const raw = String(b.accepted_return_price ?? '').trim();
        const parsed = parseFloat(raw);
        if (mode === 'pending') {
          const val = raw === '' || !Number.isFinite(parsed) ? '0' : String(parsed);
          return {
            original_invoice_item_id: b.original_invoice_item_id,
            return_tag: b.return_tag as ReturnTagChoice,
            accepted_return_price: val,
          };
        }
        return {
          original_invoice_item_id: b.original_invoice_item_id,
          return_tag: b.return_tag as ReturnTagChoice,
          accepted_return_price: String(parsed),
        };
      }),
    });
  };

  const clearBasket = () => {
    if (!basket.length) return;
    if (window.confirm('Clear all return line items from this list?')) {
      setBasket([]);
    }
  };

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 flex-1 w-full sm:w-auto">
          <Button variant="outline" size="sm" onClick={() => navigate('/replacement')} className="shrink-0">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <ScanLine className="h-7 w-7 sm:h-8 sm:w-8 text-blue-600 shrink-0" />
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Replacement POS</h1>
              <p className="text-sm text-gray-600">
                Store comes from the original sale for each scanned barcode. For every line, choose a return tag (traffic
                lights) before completing. PENDING: accepted (₹) may be empty or 0; if you enter an amount it must be less
                than that line's sold unit price. INSTANT: each line needs an accepted amount greater than 0 and still less
                than sold unit price.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <span
            className="text-sm text-gray-600 tabular-nums whitespace-nowrap"
            title={now.toLocaleString()}
          >
            {now.toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}{' '}
            {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>
      </div>

      {customerWarning && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 text-sm shadow-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <span>
            Line items are linked to different customers. Choose the customer for this return invoice; the server records a
            warning when sources differ.
          </span>
        </div>
      )}

      {storeWarning && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900 text-sm shadow-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <span>
            Cart mixes lines from more than one store. You cannot create one return for this combination — remove items until
            every line is from the same store.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3 sm:space-y-4">
          <div className="bg-white rounded-2xl shadow p-4 sm:p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2.5">
                  <User className="h-4 w-4 inline mr-1.5" />
                  Customer
                  <span className="ml-2 text-xs font-normal text-gray-500">(optional override)</span>
                </label>
                <div className="relative">
                  {selectedCustomer && !customerSearch && (
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex items-center pointer-events-none">
                      <div className="flex items-center gap-1.5 bg-blue-100 text-blue-800 px-2.5 py-1.5 rounded-md border border-blue-300 shadow-sm pointer-events-auto">
                        <User className="h-4 w-4 flex-shrink-0" />
                        <span className="text-sm font-semibold truncate max-w-[140px] sm:max-w-[220px]">
                          {selectedCustomer.name}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setSelectedCustomer(null);
                          }}
                          className="ml-1 p-0.5 rounded hover:bg-blue-200 text-blue-700 hover:text-blue-900 transition-colors flex-shrink-0"
                          title="Remove customer"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                  <Input
                    placeholder={selectedCustomer && !customerSearch ? '' : 'Search customer by name or phone...'}
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setCustomerSearchSelectedIndex(-1);
                      if (e.target.value.trim() && selectedCustomer) {
                        setSelectedCustomer(null);
                      }
                    }}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === 'Enter' && customerSearch.trim()) {
                        e.preventDefault();
                        if (customersList.length > 0 && customerSearchSelectedIndex >= 0) {
                          const c = customersList[customerSearchSelectedIndex];
                          setSelectedCustomer({
                            id: c.id,
                            name: c.name,
                            phone: c.phone,
                          });
                          setCustomerSearch('');
                          setCustomerSearchSelectedIndex(-1);
                        }
                      } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const max = Math.max(0, customersList.length - 1);
                        setCustomerSearchSelectedIndex((prev) => (prev < max ? prev + 1 : prev));
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setCustomerSearchSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
                      } else if (e.key === 'Escape') {
                        setCustomerSearchSelectedIndex(-1);
                        setCustomerSearch('');
                      }
                    }}
                    className={`w-full h-11 text-sm font-medium border-2 rounded-lg transition-all ${
                      selectedCustomer && !customerSearch ? 'pl-[185px] sm:pl-[270px]' : ''
                    }`}
                  />
                  {customerSearch && customersList.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {customersList.map((customer: { id: number; name: string; phone?: string; customer_group_name?: string }, index: number) => {
                        const isSelected = index === customerSearchSelectedIndex;
                        return (
                          <button
                            key={customer.id}
                            type="button"
                            onClick={() => {
                              setSelectedCustomer({
                                id: customer.id,
                                name: customer.name,
                                phone: customer.phone,
                              });
                              setCustomerSearch('');
                              setCustomerSearchSelectedIndex(-1);
                            }}
                            className={`w-full text-left px-4 py-2 border-b last:border-b-0 ${
                              isSelected ? 'bg-blue-100' : 'hover:bg-blue-50'
                            }`}
                            onMouseEnter={() => setCustomerSearchSelectedIndex(index)}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium">{customer.name}</div>
                              {customer.customer_group_name && (
                                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] uppercase tracking-wider rounded font-bold shrink-0">
                                  {customer.customer_group_name}
                                </span>
                              )}
                            </div>
                            {customer.phone && <div className="text-sm text-gray-500">{customer.phone}</div>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2.5">
                  <FileText className="h-4 w-4 inline mr-1.5" />
                  Return mode & settlement
                </label>
                <Select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'instant' | 'pending')}
                  className="w-full h-11 text-sm font-semibold py-2.5 px-3 border-2 rounded-lg hover:border-gray-400 cursor-pointer transition-all"
                >
                  <option value="pending">PENDING — save draft (finalize from invoice)</option>
                  <option value="instant">INSTANT — post to ledger & stock now</option>
                </Select>
                <p className="mt-1.5 text-xs text-gray-500">
                  Pending keeps the return off the ledger until you complete it from the invoice. Instant applies stock and
                  ledger immediately.
                </p>

                {mode === 'instant' && (
                  <div className="mt-3 space-y-3">
                    <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">
                      Settlement type
                    </label>
                    <Select
                      value={settlementType}
                      onChange={(e) => setSettlementType(e.target.value as typeof settlementType)}
                      className="w-full h-11 text-sm font-semibold py-2.5 px-3 border-2 rounded-lg hover:border-gray-400 cursor-pointer transition-all"
                    >
                      <option value="cash">CASH</option>
                      <option value="upi">UPI</option>
                      <option value="credit">CREDIT</option>
                      <option value="mixed">CASH + UPI</option>
                    </Select>
                    <p className="mt-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      Instant finalize writes one <span className="font-semibold">ledger debit</span> on the customer for
                      the return total (store credit balance goes <span className="font-semibold">down</span>). The entry
                      description states settlement as <span className="font-mono">CASH</span>, <span className="font-mono">UPI</span>,{' '}
                      <span className="font-mono">MIXED</span> (cash and UPI amounts on the entry), or{' '}
                      <span className="font-mono">CREDIT</span> (customer account). No new invoice payment rows are added
                      for this settlement (ledger carries it). If a pending return had partial invoice payments, clearing
                      it from the invoice removes those rows so totals stay aligned; you can log or backfill payments
                      separately if needed.
                    </p>
                    {settlementType === 'mixed' && (
                      <div className="space-y-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-blue-900 mb-1">
                          <FileText className="h-3.5 w-3.5" />
                          Split payment amounts
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Cash (₹)</label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={cashAmount}
                              onChange={(e) => {
                                const value = e.target.value;
                                setCashAmount(value);
                                if (value && totalAcceptedCredit > 0) {
                                  const cash = parseFloat(value) || 0;
                                  setUpiAmount(formatNumber(Math.max(0, totalAcceptedCredit - cash), 2, false));
                                }
                              }}
                              className="w-full text-xs h-10 border-2"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">UPI (₹)</label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={upiAmount}
                              onChange={(e) => {
                                const value = e.target.value;
                                setUpiAmount(value);
                                if (value && totalAcceptedCredit > 0) {
                                  const upi = parseFloat(value) || 0;
                                  setCashAmount(formatNumber(Math.max(0, totalAcceptedCredit - upi), 2, false));
                                }
                              }}
                              className="w-full text-xs h-10 border-2"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-3 sm:p-4">
            <div className="relative">
              <input
                ref={barcodeInputRef}
                type="text"
                placeholder="Scan or type sold barcode / sticker…"
                value={barcodeInput}
                autoComplete="off"
                onChange={(e) => {
                  setBarcodeInput(e.target.value);
                  if (showScanner) setShowScanner(false);
                  if (barcodeMessage) {
                    setBarcodeStatus('idle');
                    setBarcodeMessage('');
                  }
                }}
                onInput={(e) => {
                  const target = e.target as HTMLInputElement;
                  if (target.value !== barcodeInput) {
                    setBarcodeInput(target.value);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    runLookup();
                  }
                }}
                className={`block w-full pl-10 pr-28 py-2.5 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-base sm:text-sm ${
                  barcodeStatus === 'error'
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
                  type="button"
                  onClick={() => setStrictStickerMode(!strictStickerMode)}
                  variant="outline"
                  size="sm"
                  className={`whitespace-nowrap transition-all ${
                    strictStickerMode
                      ? '!bg-blue-600 !text-white !border-blue-600 hover:!bg-blue-700 hover:!border-blue-700'
                      : '!bg-white !text-gray-600 !border-gray-300 hover:!bg-gray-50'
                  }`}
                  title={
                    strictStickerMode
                      ? 'Strict sticker match (ON) — spaces/hyphens preserved'
                      : 'Flexible match (OFF) — ignore spaces and hyphens'
                  }
                >
                  <Barcode className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
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
            {barcodeMessage && (
              <div
                className={`flex items-center space-x-2 text-sm mt-2 ${
                  barcodeStatus === 'success' ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {barcodeStatus === 'success' ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                <span>{barcodeMessage}</span>
              </div>
            )}
          </div>

          {ambiguousMatches && ambiguousMatches.length > 0 && (
            <div className="bg-amber-50/80 border border-amber-200 rounded-2xl shadow p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-amber-900 mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Multiple matches — pick the correct line
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {ambiguousMatches.map((m) => (
                  <button
                    key={`${m.original_invoice_item_id}-${m.original_invoice_number}`}
                    type="button"
                    className="w-full text-left border border-amber-200 rounded-lg p-3 bg-white hover:bg-amber-50/80 text-sm shadow-sm transition-colors"
                    onClick={() => pickAmbiguous(m)}
                  >
                    <span className="font-medium text-gray-900">{m.product_name}</span>
                    <div className="text-gray-600 mt-0.5">
                      <span className="font-mono text-xs text-gray-800">
                        {m.sold_barcode_value || m.barcode_short || m.barcode_full || '—'}
                      </span>
                      <span>
                        {' '}
                        — {m.original_invoice_number}
                        {m.store_name ? ` · ${m.store_name}` : ''} (sold ₹{formatNumber(parseFloat(m.sold_unit_price || '0'))})
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              <Button variant="outline" className="mt-3" size="sm" onClick={() => setAmbiguousMatches(null)}>
                Cancel
              </Button>
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Cart Items</h2>
              {basket.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearBasket}
                  className="flex items-center gap-1.5 text-red-600 border-red-300 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Clear all</span>
                </Button>
              )}
            </div>

            {basket.length === 0 ? (
              <div className="text-center py-16">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gray-100 mb-4">
                  <ShoppingCart className="h-10 w-10 text-gray-400" />
                </div>
                <p className="text-lg font-semibold text-gray-600 mb-1">Cart is empty</p>
                <p className="text-sm text-gray-500">Scan sold barcodes to add return line items</p>
              </div>
            ) : (
              <div className="space-y-3">
                {basket.map((row) => {
                  const qty = basketLineQty(row);
                  const unitSold = parseFloat(row.sold_unit_price || '0') || 0;
                  const acceptedRaw = String(row.accepted_return_price ?? '').trim();
                  const acceptedParsed = parseFloat(acceptedRaw);
                  const acceptedTooHigh =
                    acceptedRaw !== '' &&
                    Number.isFinite(acceptedParsed) &&
                    acceptedParsed > 0 &&
                    unitSold > 0 &&
                    acceptedParsed >= unitSold;
                  return (
                    <div
                      key={row.original_invoice_item_id}
                      className="bg-white border border-gray-300 rounded-lg p-3 shadow-sm hover:shadow-md transition-all"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <h3
                            className="font-semibold text-sm text-gray-900 break-words"
                            style={getProductNameColor(row.product_name) ? { color: getProductNameColor(row.product_name) } : undefined}
                          >
                            {row.product_name}
                          </h3>
                          {(row.lookup_input ||
                            row.sold_barcode_value ||
                            row.barcode_short ||
                            row.barcode_full) && (
                            <div className="mt-1 space-y-0.5 text-xs text-gray-600">
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                <Barcode className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                                {row.lookup_input ? (
                                  <>
                                    <span className="text-gray-500">Searched</span>
                                    <span className="font-mono font-semibold text-gray-900">{row.lookup_input}</span>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-gray-500">Sticker</span>
                                    <span className="font-mono font-semibold text-gray-900">
                                      {row.sold_barcode_value || row.barcode_short || row.barcode_full || '—'}
                                    </span>
                                  </>
                                )}
                                {row.lookup_input &&
                                  row.sold_barcode_value &&
                                  codesDiffer(row.lookup_input, row.sold_barcode_value) && (
                                    <>
                                      <span className="text-gray-400">·</span>
                                      <span className="text-gray-500">On invoice</span>
                                      <span className="font-mono text-gray-800">{row.sold_barcode_value}</span>
                                    </>
                                  )}
                              </div>
                            </div>
                          )}
                          <p className="text-xs text-gray-500 mt-0.5">
                            {row.store_name ? (
                              <>
                                <span className="inline-flex items-center gap-0.5 font-medium text-gray-600">
                                  <Store className="h-3 w-3" />
                                  {row.store_name}
                                </span>
                                <span> · </span>
                              </>
                            ) : null}
                            Invoice {row.original_invoice_number} · Sold ₹{formatNumber(parseFloat(row.sold_unit_price || '0'))} · Qty{' '}
                            {formatNumber(qty, 3)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                          <div
                            className={`flex items-center gap-2 shrink-0 rounded-md px-1 py-0.5 -mx-1 ${
                              row.return_tag == null ? 'ring-1 ring-amber-300/80 bg-amber-50/50' : ''
                            }`}
                          >
                            <span className="text-[10px] font-semibold text-gray-500 uppercase whitespace-nowrap">Tag</span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setBasket((prev) =>
                                    prev.map((b) =>
                                      b.original_invoice_item_id === row.original_invoice_item_id
                                        ? { ...b, return_tag: 'returned' }
                                        : b
                                    )
                                  )
                                }
                                className={`w-5 h-5 rounded-full bg-green-500 border-2 transition-all hover:scale-110 ${
                                  row.return_tag === 'returned'
                                    ? 'border-gray-900 scale-110 shadow-sm ring-1 ring-green-200'
                                    : 'border-transparent opacity-30 hover:opacity-60'
                                }`}
                                title="Returned (good condition)"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setBasket((prev) =>
                                    prev.map((b) =>
                                      b.original_invoice_item_id === row.original_invoice_item_id
                                        ? { ...b, return_tag: 'defective' }
                                        : b
                                    )
                                  )
                                }
                                className={`w-5 h-5 rounded-full bg-red-500 border-2 transition-all hover:scale-110 ${
                                  row.return_tag === 'defective'
                                    ? 'border-gray-900 scale-110 shadow-sm ring-1 ring-red-200'
                                    : 'border-transparent opacity-30 hover:opacity-60'
                                }`}
                                title="Defective"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setBasket((prev) =>
                                    prev.map((b) =>
                                      b.original_invoice_item_id === row.original_invoice_item_id
                                        ? { ...b, return_tag: 'unknown' }
                                        : b
                                    )
                                  )
                                }
                                className={`w-5 h-5 rounded-full bg-yellow-400 border-2 transition-all hover:scale-110 ${
                                  row.return_tag === 'unknown'
                                    ? 'border-gray-900 scale-110 shadow-sm ring-1 ring-yellow-200'
                                    : 'border-transparent opacity-30 hover:opacity-60'
                                }`}
                                title="Unknown"
                              />
                              <span
                                className={`text-[10px] font-bold capitalize min-w-[3.75rem] ${
                                  row.return_tag == null ? 'text-amber-800' : 'text-gray-600'
                                }`}
                              >
                                {row.return_tag ?? 'select'}
                              </span>
                            </div>
                          </div>
                          <div className="flex-1 sm:w-32 min-w-[7rem]">
                            <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">
                              Accepted (₹)
                              {mode === 'pending' ? (
                                <span className="font-normal normal-case text-gray-400"> · optional</span>
                              ) : null}
                            </label>
                            <div className="relative">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs font-medium">₹</span>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder={mode === 'pending' ? '0' : ''}
                                title={
                                  mode === 'pending'
                                    ? `Optional; if set and greater than 0, must be less than sold ₹${formatNumber(unitSold)}`
                                    : `Required: greater than 0 and less than sold ₹${formatNumber(unitSold)}`
                                }
                                className={`w-full pl-6 pr-2 py-1.5 text-xs font-semibold border-2 rounded-md h-10 ${
                                  acceptedTooHigh
                                    ? 'bg-red-50 border-red-400 ring-1 ring-red-200'
                                    : mode === 'pending'
                                      ? 'bg-white'
                                      : 'bg-amber-50/40 border-amber-200'
                                }`}
                                value={row.accepted_return_price}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setBasket((prev) =>
                                    prev.map((b) =>
                                      b.original_invoice_item_id === row.original_invoice_item_id
                                        ? { ...b, accepted_return_price: v }
                                        : b
                                    )
                                  );
                                }}
                              />
                            </div>
                            {unitSold > 0 && (
                              <p
                                className={`text-[10px] mt-0.5 leading-tight ${
                                  acceptedTooHigh ? 'text-red-600 font-medium' : 'text-gray-500'
                                }`}
                              >
                                {acceptedTooHigh
                                  ? `Must be less than sold ₹${formatNumber(unitSold)}`
                                  : mode === 'instant'
                                    ? `Less than sold ₹${formatNumber(unitSold)}`
                                    : `If set, less than sold ₹${formatNumber(unitSold)}`}
                              </p>
                            )}
                          </div>
                          <div className="flex items-end gap-2">
                            <div className="px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-md min-w-[4.5rem] text-center">
                              <span className="text-[10px] font-semibold text-gray-500 uppercase block">Sold price</span>
                              <span className="text-xs font-bold text-gray-900">₹{formatNumber(unitSold)}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setBasket((prev) => prev.filter((b) => b.original_invoice_item_id !== row.original_invoice_item_id))
                              }
                              className="p-1.5 rounded-md text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-all mb-0.5"
                              title="Remove line"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-1 space-y-4">
          {showScanner && (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4">
              <BarcodeScanner
                isOpen={showScanner}
                continuous
                onScan={async (code) => {
                  const v = String(code).trim();
                  if (v) {
                    const normalized = normalizeReplacementBarcode(v, strictStickerMode);
                    setBarcodeInput(v);
                    setShowScanner(false);
                    lookupMutation.mutate(normalized);
                  }
                  barcodeInputRef.current?.focus();
                }}
                onClose={() => setShowScanner(false)}
              />
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 lg:sticky lg:top-4">
            <div className="flex items-center gap-2 mb-6 pb-4 border-b border-gray-200">
              <FileText className="h-5 w-5 text-blue-600" />
              <h2 className="text-xl font-bold text-gray-900">Return summary</h2>
            </div>
            <div className="space-y-3 mb-6">
              {derivedStoreLabel && (
                <div className="flex justify-between items-start gap-2 py-2 border-b border-gray-100">
                  <span className="text-sm font-medium text-gray-600 inline-flex items-center gap-1.5 shrink-0">
                    <Store className="h-4 w-4 text-blue-600" />
                    Store
                  </span>
                  <span className="text-sm font-semibold text-gray-900 text-right">{derivedStoreLabel}</span>
                </div>
              )}
              <div className="flex justify-between items-center py-2">
                <span className="text-sm font-medium text-gray-600">Line items</span>
                <span className="text-sm font-semibold text-gray-900">{basket.length}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-sm font-medium text-gray-600">Total quantity</span>
                <span className="text-sm font-semibold text-gray-900">{formatNumber(totalQty, 3)}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-t border-gray-100 pt-3">
                <span className="text-sm font-medium text-gray-600">Accepted credit total</span>
                <span className="text-lg font-bold text-blue-700">₹{formatNumber(totalAcceptedCredit)}</span>
              </div>
              {basket.length > 0 && !allLinesHaveReturnTag && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Choose a return tag for each line (green, red, or yellow) before you can complete this return.
                </p>
              )}
            </div>
            <Button
              variant="primary"
              className="w-full h-11 text-sm font-semibold"
              onClick={submitCreate}
              disabled={createMutation.isPending || !basket.length || storeWarning || !allLinesHaveReturnTag}
            >
              {createMutation.isPending ? 'Working…' : mode === 'instant' ? 'Create & finalize' : 'Create draft'}
            </Button>
            {mode === 'instant' && settlementType === 'mixed' && totalAcceptedCredit > 0 && (
              <p className="mt-2 text-xs text-gray-500 text-center">
                Split should match accepted credit total (₹{formatNumber(totalAcceptedCredit)}).
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
