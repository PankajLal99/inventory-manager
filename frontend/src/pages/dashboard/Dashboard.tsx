import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { reportsApi } from '../../lib/api';
import { DateRangePreset, formatDateDDMMYYYY, formatNumber, getDateRangeByPreset } from '../../lib/utils';
import { auth } from '../../lib/auth';
import { BarChart3, Calendar, ClipboardList, Coins, CreditCard, DollarSign, Lock, Package, RefreshCw, Store, TrendingDown, Truck, Wallet, Wrench } from 'lucide-react';
import DateRangeSelector from '../../components/ui/DateRangeSelector';

const PIN_LENGTH = 6;
const DASHBOARD_PIN = (import.meta.env.VITE_DASHBOARD_PIN as string) || '908070';

type StoreAmountRow = {
  store_id: number;
  store_name: string;
  shop_type: string;
  amount: number;
};

type CashStoreRow = StoreAmountRow & {
  from_invoice_cash?: number;
  from_mixed_cash?: number;
};

type UpiStoreRow = StoreAmountRow & {
  from_invoice_upi?: number;
  from_mixed_upi?: number;
};

function counterInvoiceTypeLabel(invoiceType: string) {
  const labels: Record<string, string> = {
    cash: 'Cash',
    upi: 'UPI',
    mixed: 'Mixed',
    credit: 'Credit',
  };
  return labels[invoiceType] || invoiceType || '—';
}

function shopTypeLabel(shopType: string) {
  const labels: Record<string, string> = {
    retail: 'Retail',
    wholesale: 'Wholesale',
    repair: 'Repair',
    warehouse: 'Warehouse',
    other: 'Other',
  };
  return labels[shopType] || shopType || '—';
}

function paymentMethodLabel(method: string) {
  const labels: Record<string, string> = {
    cash: 'Cash',
    upi: 'UPI',
    card: 'Card',
    bank_transfer: 'Bank transfer',
    credit: 'Credit',
    refund: 'Refund',
    other: 'Other',
  };
  return labels[method] || method || 'Other';
}

function CounterProfitByInvoiceTypeList({
  rows,
  emptyMessage = 'No counter invoices in this period.',
}: {
  rows: { invoice_type: string; profit: number }[];
  emptyMessage?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <p className="text-sm font-medium text-gray-700">By invoice type</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 p-4">{emptyMessage}</p>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-[min(320px,45vh)] overflow-y-auto">
          {rows.map((row) => (
            <li key={row.invoice_type} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="font-medium text-gray-900">{counterInvoiceTypeLabel(row.invoice_type)}</span>
              <span className="font-semibold text-gray-900 tabular-nums shrink-0">
                ₹{formatNumber(row.profit, 2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StoreAmountList({
  title,
  rows,
  emptyMessage = 'No rows in this period.',
}: {
  title: string;
  rows: StoreAmountRow[];
  emptyMessage?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <p className="text-sm font-medium text-gray-700">{title}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 p-4">{emptyMessage}</p>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-[min(320px,45vh)] overflow-y-auto">
          {rows.map((row) => (
            <li key={row.store_id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{row.store_name}</p>
                <p className="text-gray-500 text-xs mt-0.5">{shopTypeLabel(row.shop_type)}</p>
              </div>
              <p className="font-semibold text-gray-900 tabular-nums shrink-0">₹{formatNumber(row.amount, 2)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CashStoreList({ title, rows }: { title: string; rows: CashStoreRow[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <p className="text-sm font-medium text-gray-700">{title}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 p-4">No cash in this period.</p>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-[min(320px,45vh)] overflow-y-auto">
          {rows.map((row) => (
            <li key={row.store_id} className="px-4 py-2.5 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{row.store_name}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{shopTypeLabel(row.shop_type)}</p>
                </div>
                <p className="font-semibold text-gray-900 tabular-nums shrink-0">₹{formatNumber(row.amount, 2)}</p>
              </div>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                Cash invoices ₹{formatNumber(row.from_invoice_cash ?? 0, 2)}
                <span className="mx-1">·</span>
                From mixed (cash leg) ₹{formatNumber(row.from_mixed_cash ?? 0, 2)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UpiStoreList({ title, rows }: { title: string; rows: UpiStoreRow[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <p className="text-sm font-medium text-gray-700">{title}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 p-4">No UPI in this period.</p>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-[min(320px,45vh)] overflow-y-auto">
          {rows.map((row) => (
            <li key={row.store_id} className="px-4 py-2.5 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{row.store_name}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{shopTypeLabel(row.shop_type)}</p>
                </div>
                <p className="font-semibold text-gray-900 tabular-nums shrink-0">₹{formatNumber(row.amount, 2)}</p>
              </div>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                UPI invoices ₹{formatNumber(row.from_invoice_upi ?? 0, 2)}
                <span className="mx-1">·</span>
                From mixed (UPI leg) ₹{formatNumber(row.from_mixed_upi ?? 0, 2)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [user, setUser] = useState(auth.getUser());
  const [datePreset, setDatePreset] = useState<DateRangePreset>('one_day');
  const [dateRange, setDateRange] = useState(() => getDateRangeByPreset('one_day'));
  const { startDate: dateFrom, endDate: dateTo } = dateRange;

  const [unlocked, setUnlocked] = useState(false);
  const [pinDigits, setPinDigits] = useState<string[]>(() => Array(PIN_LENGTH).fill(''));
  const [pinError, setPinError] = useState('');
  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!user) {
      auth.loadUser().then((loadedUser) => setUser(loadedUser));
    }
  }, [user]);

  useEffect(() => {
    if (!unlocked) {
      const t = setTimeout(() => pinInputRefs.current[0]?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [unlocked]);

  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ['dashboard-kpis-v9', dateFrom, dateTo],
    queryFn: async () => {
      const response = await reportsApi.dashboardKpis({
        date_from: dateFrom,
        date_to: dateTo,
      });
      return response.data as {
        period?: { from: string; to: string };
        kpis?: {
          total_cash?: number;
          total_upi?: number;
          total_credit?: number;
          cash_from_invoice_type_cash?: number;
          cash_from_mixed?: number;
          upi_from_invoice_type_upi?: number;
          upi_from_mixed?: number;
          total_expenses?: number;
          total_inhand?: number;
          total_payments?: number;
          pending_invoice_purchase_total?: number;
          counter_profit?: number;
          repair_profit?: number;
          overall_profit?: number;
          stock_value?: number;
          defective_product_count?: number;
          defective_barcode_count?: number;
          defective_purchase_value?: number;
          defective_move_out_net_loss?: number;
          defective_move_out_net_period?: number;
        };
        cash_by_store?: CashStoreRow[];
        upi_by_store?: UpiStoreRow[];
        credit_by_store?: StoreAmountRow[];
        payments_by_method?: { payment_method: string; amount: number }[];
        pending_purchase_by_store?: StoreAmountRow[];
        counter_profit_by_store?: StoreAmountRow[];
        counter_profit_by_invoice_type?: { invoice_type: string; profit: number }[];
      };
    },
    enabled: unlocked,
    retry: false,
  });

  const clearPin = () => {
    setPinDigits(Array(PIN_LENGTH).fill(''));
    setPinError('');
    pinInputRefs.current[0]?.focus();
  };

  const handlePinChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...pinDigits];
    next[index] = digit;
    setPinDigits(next);
    setPinError('');
    if (digit && index < PIN_LENGTH - 1) pinInputRefs.current[index + 1]?.focus();
    if (next.every(Boolean)) {
      const pin = next.join('');
      if (pin === DASHBOARD_PIN) {
        setUnlocked(true);
      } else {
        setPinError('Wrong PIN');
        clearPin();
      }
    }
  };

  const handlePinKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      clearPin();
    }
  };

  const canAccessDashboard = user?.can_access_dashboard !== false;
  if (user && !canAccessDashboard) return <Navigate to="/" replace />;

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
          <div className="flex flex-col items-center">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-6">
              <Lock className="h-7 w-7 text-gray-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-1">Dashboard locked</h2>
            <p className="text-sm text-gray-500 mb-6">Enter 6-digit PIN</p>
            <div className="flex gap-2 justify-center mb-2">
              {Array.from({ length: PIN_LENGTH }, (_, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    pinInputRefs.current[i] = el;
                  }}
                  type="password"
                  inputMode="numeric"
                  maxLength={1}
                  autoFocus={i === 0}
                  value={pinDigits[i]}
                  onChange={(e) => handlePinChange(i, e.target.value)}
                  onKeyDown={handlePinKeyDown}
                  className="w-14 h-14 text-center text-lg font-semibold border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 border-gray-300"
                />
              ))}
            </div>
            {pinError ? <p className="text-sm text-red-600 font-medium mt-2">{pinError}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  const kpis = dashboardData?.kpis ?? {};
  const totalCash = Number(kpis.total_cash ?? 0);
  const totalUpi = Number(kpis.total_upi ?? 0);
  const totalCredit = Number(kpis.total_credit ?? 0);
  const cashFromMixed = Number(kpis.cash_from_mixed ?? 0);
  const upiFromMixed = Number(kpis.upi_from_mixed ?? 0);
  const totalExpenses = Number(kpis.total_expenses ?? 0);
  const totalInhand = Number(kpis.total_inhand ?? 0);
  const totalPosPayments = Number(kpis.total_payments ?? 0);
  const paymentsByMethod: { payment_method: string; amount: number }[] = Array.isArray(
    dashboardData?.payments_by_method,
  )
    ? dashboardData.payments_by_method
    : [];
  const pendingPurchaseTotal = Number(kpis.pending_invoice_purchase_total ?? 0);
  const pendingPurchaseByStore: StoreAmountRow[] = Array.isArray(dashboardData?.pending_purchase_by_store)
    ? dashboardData.pending_purchase_by_store
    : [];
  const counterProfit = Number(kpis.counter_profit ?? 0);
  const repairProfit = Number(kpis.repair_profit ?? 0);
  const overallProfit = Number(kpis.overall_profit ?? 0);
  const stockValue = Number(kpis.stock_value ?? 0);
  const defectiveProductCount = Number(kpis.defective_product_count ?? 0);
  const defectiveBarcodeCount = Number(kpis.defective_barcode_count ?? 0);
  const defectivePurchaseValue = Number(kpis.defective_purchase_value ?? 0);
  const defectiveMoveOutNetLoss = Number(kpis.defective_move_out_net_loss ?? 0);
  const defectiveMoveOutNetPeriod = Number(kpis.defective_move_out_net_period ?? 0);
  const cashByStore: CashStoreRow[] = Array.isArray(dashboardData?.cash_by_store)
    ? dashboardData.cash_by_store
    : [];
  const upiByStore: UpiStoreRow[] = Array.isArray(dashboardData?.upi_by_store)
    ? dashboardData.upi_by_store
    : [];
  const creditByStore: StoreAmountRow[] = Array.isArray(dashboardData?.credit_by_store)
    ? dashboardData.credit_by_store
    : [];
  const counterProfitByStore: StoreAmountRow[] = Array.isArray(dashboardData?.counter_profit_by_store)
    ? dashboardData.counter_profit_by_store
    : [];
  const counterProfitByInvoiceType: { invoice_type: string; profit: number }[] = Array.isArray(
    dashboardData?.counter_profit_by_invoice_type,
  )
    ? dashboardData.counter_profit_by_invoice_type
    : [];

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 px-4 py-4 sm:px-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {dateFrom === dateTo
                ? formatDateDDMMYYYY(dateFrom)
                : `${formatDateDDMMYYYY(dateFrom)} – ${formatDateDDMMYYYY(dateTo)}`}
            </p>
          </div>
          <DateRangeSelector
            preset={datePreset}
            value={dateRange}
            onChange={({ preset, range }) => {
              setDatePreset(preset);
              setDateRange(range);
            }}
            className="w-full sm:w-[360px]"
          />
        </div>
      </div>

      <div className="px-4 sm:px-6 pt-6 space-y-8">
        {isLoading ? (
          <div className="text-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-gray-400" />
            <p className="text-gray-500">Loading dashboard…</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              <div className="bg-gradient-to-br from-green-50 to-green-100 border-green-200 rounded-xl border p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">Total cash</p>
                  <DollarSign className="h-5 w-5 text-green-700" />
                </div>
                <p className="text-3xl font-bold text-gray-900">₹{formatNumber(totalCash, 2)}</p>
                <p className="text-xs text-gray-600 mt-2 leading-relaxed">
                  Includes mixed: cash leg ₹{formatNumber(cashFromMixed, 2)}
                </p>
              </div>
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200 rounded-xl border p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">Total UPI</p>
                  <CreditCard className="h-5 w-5 text-blue-700" />
                </div>
                <p className="text-3xl font-bold text-gray-900">₹{formatNumber(totalUpi, 2)}</p>
                <p className="text-xs text-gray-600 mt-2 leading-relaxed">
                  Includes mixed: UPI leg ₹{formatNumber(upiFromMixed, 2)}
                </p>
              </div>
              <div className="bg-gradient-to-br from-violet-50 to-violet-100 border-violet-200 rounded-xl border p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">Total credit</p>
                  <CreditCard className="h-5 w-5 text-violet-700" />
                </div>
                <p className="text-3xl font-bold text-gray-900">₹{formatNumber(totalCredit, 2)}</p>
                <p className="text-xs text-gray-600 mt-2">Σ invoice total, type credit</p>
              </div>
              <div className="bg-gradient-to-br from-red-50 to-red-100 border-red-200 rounded-xl border p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">Total expenses</p>
                  <TrendingDown className="h-5 w-5 text-red-700" />
                </div>
                <p className="text-3xl font-bold text-gray-900">₹{formatNumber(totalExpenses, 2)}</p>
                <p className="text-xs text-gray-600 mt-2">Σ expense amount (period)</p>
              </div>
              <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200 rounded-xl border p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">Total inhand</p>
                  <Wallet className="h-5 w-5 text-emerald-700" />
                </div>
                <p className="text-3xl font-bold text-gray-900">₹{formatNumber(totalInhand, 2)}</p>
                <p className="text-xs text-gray-600 mt-2">Total cash − total expenses</p>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-gray-600" />
                Profits
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-5xl">
                <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 border-indigo-200 rounded-xl border p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700">Counter profit</p>
                    <Store className="h-5 w-5 text-indigo-700" />
                  </div>
                  <p className="text-3xl font-bold text-gray-900">₹{formatNumber(counterProfit, 2)}</p>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200 rounded-xl border p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700">Repair profit</p>
                    <Wrench className="h-5 w-5 text-purple-700" />
                  </div>
                  <p className="text-3xl font-bold text-gray-900">₹{formatNumber(repairProfit, 2)}</p>
                </div>
                <div className="bg-gradient-to-br from-teal-50 to-teal-100 border-teal-200 rounded-xl border p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700">Overall profit</p>
                    <BarChart3 className="h-5 w-5 text-teal-700" />
                  </div>
                  <p className="text-3xl font-bold text-gray-900">₹{formatNumber(overallProfit, 2)}</p>
                  <p className="text-xs text-gray-600 mt-2">Counter + repair</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-5xl mt-4">
                <StoreAmountList
                  title="Counter profit by store"
                  rows={counterProfitByStore}
                  emptyMessage="No counter profit in this period."
                />
                <CounterProfitByInvoiceTypeList rows={counterProfitByInvoiceType} />
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Coins className="h-5 w-5 text-gray-600" />
                Manual / POS payments
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
                <div className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200 rounded-xl border p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700">Total (all methods)</p>
                    <Coins className="h-5 w-5 text-amber-800" />
                  </div>
                  <p className="text-3xl font-bold text-gray-900">₹{formatNumber(totalPosPayments, 2)}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <p className="text-sm font-medium text-gray-700">By payment method</p>
                  </div>
                  {paymentsByMethod.length === 0 ? (
                    <p className="text-sm text-gray-500 p-4">No payment rows in this period.</p>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {paymentsByMethod.map((row) => (
                        <li
                          key={row.payment_method}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                        >
                          <span className="font-medium text-gray-800">
                            {paymentMethodLabel(row.payment_method)}
                          </span>
                          <span className="font-semibold text-gray-900 tabular-nums">
                            ₹{formatNumber(row.amount, 2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-gray-600" />
                Pending invoices — purchase cost
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200 rounded-xl border p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700">Total (at purchase cost)</p>
                    <ClipboardList className="h-5 w-5 text-orange-800" />
                  </div>
                  <p className="text-3xl font-bold text-gray-900">₹{formatNumber(pendingPurchaseTotal, 2)}</p>
                </div>
                <div className="min-h-0">
                  <StoreAmountList
                    title="By store"
                    rows={pendingPurchaseByStore}
                    emptyMessage="No pending invoice lines in this period."
                  />
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Package className="h-5 w-5 text-gray-600" />
                Stock and defective
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                <div className="bg-gradient-to-br from-slate-50 to-slate-100 border-slate-200 rounded-xl border p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700">Stock value</p>
                    <Package className="h-5 w-5 text-slate-700" />
                  </div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900">₹{formatNumber(stockValue, 2)}</p>
                  <p className="text-xs text-gray-600 mt-2">New + returned barcodes</p>
                </div>
                <div className="bg-gradient-to-br from-red-50 to-red-100 border-red-200 rounded-xl border p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700">Defective products</p>
                    <Package className="h-5 w-5 text-red-700" />
                  </div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900">{defectiveProductCount}</p>
                  <p className="text-xs text-gray-600 mt-2">Products with ≥1 defective barcode</p>
                </div>
                <div className="bg-gradient-to-br from-rose-50 to-rose-100 border-rose-200 rounded-xl border p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700">Defective units</p>
                    <Package className="h-5 w-5 text-rose-700" />
                  </div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900">{defectiveBarcodeCount}</p>
                  <p className="text-xs text-gray-600 mt-2">Barcodes tagged defective</p>
                </div>
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200 rounded-xl border p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700">Defective purchase value</p>
                    <Coins className="h-5 w-5 text-orange-800" />
                  </div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900">
                    ₹{formatNumber(defectivePurchaseValue, 2)}
                  </p>
                  <p className="text-xs text-gray-600 mt-2">Σ unit price on defective barcodes</p>
                </div>
                <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-200 rounded-xl border p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700">Total loss (move-outs)</p>
                    <TrendingDown className="h-5 w-5 text-yellow-800" />
                  </div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900">
                    ₹{formatNumber(defectiveMoveOutNetLoss, 2)}
                  </p>
                  <p className="text-xs text-gray-600 mt-2">All time: Σ (loss − adjustment)</p>
                </div>
                <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 border-cyan-200 rounded-xl border p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700">Product sent (move-out net, period)</p>
                    <Truck className="h-5 w-5 text-cyan-800" />
                  </div>
                  <p className="text-2xl sm:text-3xl font-bold text-gray-900">
                    ₹{formatNumber(defectiveMoveOutNetPeriod, 2)}
                  </p>
                  <p className="text-xs text-gray-600 mt-2">Move-outs in dashboard date range</p>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Store className="h-5 w-5 text-gray-600" />
                By store
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <CashStoreList title="Cash by store (invoices + mixed legs)" rows={cashByStore} />
                <UpiStoreList title="UPI by store (invoices + mixed legs)" rows={upiByStore} />
              </div>
              <div className="mt-4 max-w-2xl">
                <StoreAmountList
                  title="Credit by store (Σ invoice total, type credit)"
                  rows={creditByStore}
                  emptyMessage="No credit invoices in this period."
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
