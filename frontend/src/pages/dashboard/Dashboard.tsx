import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { reportsApi } from '../../lib/api';
import { DateRangePreset, formatDateDDMMYYYY, formatNumber, getDateRangeByPreset } from '../../lib/utils';
import { auth } from '../../lib/auth';
import { BarChart3, Calendar, ClipboardList, Clock, Coins, CreditCard, DollarSign, Lock, Package, RefreshCw, Store, TrendingDown, Truck, Wallet, Wrench } from 'lucide-react';
import DateRangeSelector from '../../components/ui/DateRangeSelector';

const PIN_LENGTH = 6;
const DASHBOARD_PIN = (import.meta.env.VITE_DASHBOARD_PIN as string) || '908070';

/** When false, the “Manual / POS payments” KPI block is hidden (code kept for later). */
const SHOW_MANUAL_POS_PAYMENTS_SECTION = false;

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

type BreakdownRow = { label: string; amount: number };

function DashboardMetricCard({
  title,
  subtitle,
  icon,
  totalFormatted,
  breakdownRows,
  gradientClass,
  borderClass,
  iconClass,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  totalFormatted: string;
  breakdownRows: BreakdownRow[];
  gradientClass: string;
  borderClass: string;
  iconClass: string;
}) {
  return (
    <div className={`rounded-xl border p-5 ${gradientClass} ${borderClass}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-gray-700">{title}</p>
        <span className={iconClass}>{icon}</span>
      </div>
      {subtitle ? <p className="text-xs text-gray-600 mb-2 leading-snug">{subtitle}</p> : null}
      <p className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums">{totalFormatted}</p>
      <div className="mt-4 pt-3 border-t border-gray-900/10 space-y-1.5 text-xs">
        {breakdownRows.length === 0 ? (
          <p className="text-gray-500">No breakdown rows.</p>
        ) : (
          breakdownRows.map((row) => (
            <div key={row.label} className="flex justify-between gap-2 text-gray-700">
              <span className="text-gray-600 shrink min-w-0">{row.label}</span>
              <span className="font-semibold text-gray-900 tabular-nums shrink-0">₹{formatNumber(row.amount, 2)}</span>
            </div>
          ))
        )}
      </div>
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
    queryKey: ['dashboard-kpis-v13', dateFrom, dateTo],
    queryFn: async () => {
      const response = await reportsApi.dashboardKpis({
        date_from: dateFrom,
        date_to: dateTo,
      });
      return response.data as {
        period?: { from: string; to: string };
        overall_profit_billing_period_window?: { from: string; to: string };
        kpis?: {
          total_cash?: number;
          total_upi?: number;
          total_credit?: number;
          cash_from_invoice_type_cash?: number;
          cash_from_mixed?: number;
          upi_from_invoice_type_upi?: number;
          upi_from_mixed?: number;
          manual_cash_total?: number;
          manual_upi_total?: number;
          cash_breakdown?: {
            retail_counter?: number;
            repair?: number;
            mix_cash?: number;
            manual_cash?: number;
          };
          online_breakdown?: {
            retail_counter?: number;
            repair?: number;
            mix_upi?: number;
            manual_upi?: number;
          };
          total_pending?: number;
          total_pending_yet_to_finalize_purchase?: number;
          pending_invoice_purchase_yet_to_finalize_total?: number;
          pending_invoice_purchase_yet_to_finalize_retail?: number;
          pending_invoice_purchase_yet_to_finalize_wholesale?: number;
          total_expenses?: number;
          total_inhand?: number;
          total_payments?: number;
          pending_invoice_purchase_total?: number;
          pending_invoice_purchase_retail?: number;
          pending_invoice_purchase_wholesale?: number;
          counter_profit?: number;
          repair_profit?: number;
          overall_profit?: number;
          overall_profit_billing_period?: number;
          counter_profit_billing_period?: number;
          repair_profit_billing_period?: number;
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
        total_pending_by_store?: StoreAmountRow[];
        total_pending_yet_to_finalize_by_store?: StoreAmountRow[];
        payments_by_method?: { payment_method: string; amount: number }[];
        pending_purchase_by_store?: StoreAmountRow[];
        pending_purchase_yet_to_finalize_by_store?: StoreAmountRow[];
        counter_profit_by_store?: StoreAmountRow[];
        counter_profit_by_invoice_type?: { invoice_type: string; profit: number }[];
        repair_profit_by_invoice_type?: { invoice_type: string; profit: number }[];
        repair_profit_by_store?: StoreAmountRow[];
        manual_payments?: { name: string; cash_amount: number; upi_amount: number; note: string }[];
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
  const totalPending = Number(kpis.total_pending ?? 0);
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
  const totalPendingByStore: StoreAmountRow[] = Array.isArray(dashboardData?.total_pending_by_store)
    ? dashboardData.total_pending_by_store
    : [];
  const totalPendingYtfByStore: StoreAmountRow[] = Array.isArray(
    dashboardData?.total_pending_yet_to_finalize_by_store,
  )
    ? dashboardData.total_pending_yet_to_finalize_by_store
    : [];
  const pendingPurchaseYtfByStore: StoreAmountRow[] = Array.isArray(
    dashboardData?.pending_purchase_yet_to_finalize_by_store,
  )
    ? dashboardData.pending_purchase_yet_to_finalize_by_store
    : [];
  const counterProfitByStore: StoreAmountRow[] = Array.isArray(dashboardData?.counter_profit_by_store)
    ? dashboardData.counter_profit_by_store
    : [];
  const repairProfitByStore: StoreAmountRow[] = Array.isArray(dashboardData?.repair_profit_by_store)
    ? dashboardData.repair_profit_by_store
    : [];
  const counterProfitByInvoiceType: { invoice_type: string; profit: number }[] = Array.isArray(
    dashboardData?.counter_profit_by_invoice_type,
  )
    ? dashboardData.counter_profit_by_invoice_type
    : [];
  const repairProfitByInvoiceType: { invoice_type: string; profit: number }[] = Array.isArray(
    dashboardData?.repair_profit_by_invoice_type,
  )
    ? dashboardData.repair_profit_by_invoice_type
    : [];
  const manualPayments: { name: string; cash_amount: number; upi_amount: number; note: string }[] = Array.isArray(
    dashboardData?.manual_payments,
  )
    ? dashboardData.manual_payments
    : [];
  const manualCashTotalKpi = Number(kpis.manual_cash_total ?? 0);
  const manualUpiTotalKpi = Number(kpis.manual_upi_total ?? 0);

  const cashBreakdown = kpis.cash_breakdown ?? {};
  const onlineBreakdown = kpis.online_breakdown ?? {};
  const pendingRetail = Number(kpis.pending_invoice_purchase_retail ?? 0);
  const pendingWholesale = Number(kpis.pending_invoice_purchase_wholesale ?? 0);
  const totalPendingYtfPurchase = Number(kpis.total_pending_yet_to_finalize_purchase ?? 0);
  const pendingPurchaseYtfTotal = Number(kpis.pending_invoice_purchase_yet_to_finalize_total ?? 0);
  const pendingPurchaseYtfRetail = Number(kpis.pending_invoice_purchase_yet_to_finalize_retail ?? 0);
  const pendingPurchaseYtfWholesale = Number(kpis.pending_invoice_purchase_yet_to_finalize_wholesale ?? 0);
  const overallProfitBilling = Number(kpis.overall_profit_billing_period ?? 0);
  const counterProfitBilling = Number(kpis.counter_profit_billing_period ?? 0);
  const repairProfitBilling = Number(kpis.repair_profit_billing_period ?? 0);
  const billingWindow = dashboardData?.overall_profit_billing_period_window;

  const counterProfitByTypeRows: BreakdownRow[] = counterProfitByInvoiceType.map((row) => ({
    label: counterInvoiceTypeLabel(row.invoice_type),
    amount: row.profit,
  }));
  const repairProfitByTypeRows: BreakdownRow[] = repairProfitByInvoiceType.map((row) => ({
    label: counterInvoiceTypeLabel(row.invoice_type),
    amount: row.profit,
  }));

  const totalPendingCardRows: BreakdownRow[] = (() => {
    if (
      totalPending <= 0 &&
      totalPendingYtfPurchase <= 0 &&
      totalPendingByStore.length === 0 &&
      totalPendingYtfByStore.length === 0
    ) {
      return [{ label: 'No draft + pending-type invoices in this period', amount: 0 }];
    }
    const rows: BreakdownRow[] = [
      {
        label: 'Yet to finalize (purchase unit × qty, paid = 0)',
        amount: totalPendingYtfPurchase,
      },
    ];
    totalPendingYtfByStore.forEach((r) => {
      rows.push({
        label: `Yet to finalize · ${r.store_name} (${shopTypeLabel(r.shop_type)})`,
        amount: r.amount,
      });
    });
    if (totalPendingByStore.length > 0) {
      totalPendingByStore.forEach((r) => {
        rows.push({
          label: `Invoice total · ${r.store_name} (${shopTypeLabel(r.shop_type)})`,
          amount: r.amount,
        });
      });
    } else if (totalPending > 0) {
      rows.push({ label: 'Invoice total (all stores)', amount: totalPending });
    }
    return rows;
  })();

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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              <DashboardMetricCard
                title="Total cash"
                icon={<DollarSign className="h-5 w-5 text-green-700" />}
                totalFormatted={`₹${formatNumber(totalCash, 2)}`}
                gradientClass="bg-gradient-to-br from-green-50 to-green-100"
                borderClass="border-green-200"
                iconClass=""
                breakdownRows={[
                  { label: 'Retail (counter) — cash invoices', amount: Number(cashBreakdown.retail_counter ?? 0) },
                  { label: 'Repair — cash invoices', amount: Number(cashBreakdown.repair ?? 0) },
                  { label: 'Mix cash (mixed-payment cash legs)', amount: Number(cashBreakdown.mix_cash ?? 0) },
                  { label: 'Manual cash (ledger, no invoice)', amount: Number(cashBreakdown.manual_cash ?? 0) },
                ]}
              />
              <DashboardMetricCard
                title="Total online"
                icon={<CreditCard className="h-5 w-5 text-blue-700" />}
                totalFormatted={`₹${formatNumber(totalUpi, 2)}`}
                gradientClass="bg-gradient-to-br from-blue-50 to-blue-100"
                borderClass="border-blue-200"
                iconClass=""
                breakdownRows={[
                  { label: 'Retail (counter) — UPI invoices', amount: Number(onlineBreakdown.retail_counter ?? 0) },
                  { label: 'Repair — UPI invoices', amount: Number(onlineBreakdown.repair ?? 0) },
                  { label: 'Mix UPI (mixed-payment UPI legs)', amount: Number(onlineBreakdown.mix_upi ?? 0) },
                  { label: 'Manual UPI (ledger, no invoice)', amount: Number(onlineBreakdown.manual_upi ?? 0) },
                ]}
              />
              <DashboardMetricCard
                title="Total pending"
                icon={<Clock className="h-5 w-5 text-orange-800" />}
                totalFormatted={`₹${formatNumber(totalPending, 2)}`}
                gradientClass="bg-gradient-to-br from-orange-50 to-orange-100"
                borderClass="border-orange-200"
                iconClass=""
                breakdownRows={totalPendingCardRows}
              />
              <DashboardMetricCard
                title="Total credit"
                icon={<CreditCard className="h-5 w-5 text-violet-700" />}
                totalFormatted={`₹${formatNumber(totalCredit, 2)}`}
                gradientClass="bg-gradient-to-br from-violet-50 to-violet-100"
                borderClass="border-violet-200"
                iconClass=""
                breakdownRows={
                  creditByStore.length > 0
                    ? creditByStore.map((r) => ({
                        label: `${r.store_name} (${shopTypeLabel(r.shop_type)})`,
                        amount: r.amount,
                      }))
                    : [{ label: 'Σ credit invoices (by shop)', amount: totalCredit }]
                }
              />
              <DashboardMetricCard
                title="Total expense"
                icon={<TrendingDown className="h-5 w-5 text-red-700" />}
                totalFormatted={`₹${formatNumber(totalExpenses, 2)}`}
                gradientClass="bg-gradient-to-br from-red-50 to-red-100"
                borderClass="border-red-200"
                iconClass=""
                breakdownRows={[
                  {
                    label: 'Σ Expenses model (expense_date in range)',
                    amount: totalExpenses,
                  },
                ]}
              />
              <DashboardMetricCard
                title="Total in-hand"
                icon={<Wallet className="h-5 w-5 text-emerald-700" />}
                totalFormatted={`₹${formatNumber(totalInhand, 2)}`}
                gradientClass="bg-gradient-to-br from-emerald-50 to-emerald-100"
                borderClass="border-emerald-200"
                iconClass=""
                breakdownRows={[
                  { label: 'Total cash (this dashboard)', amount: totalCash },
                  { label: 'Total expense', amount: totalExpenses },
                ]}
              />
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-gray-600" />
                Profits
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <DashboardMetricCard
                  title="Counter profit (retail invoice)"
                  icon={<Store className="h-5 w-5 text-indigo-700" />}
                  totalFormatted={`₹${formatNumber(counterProfit, 2)}`}
                  gradientClass="bg-gradient-to-br from-indigo-50 to-indigo-100"
                  borderClass="border-indigo-200"
                  iconClass=""
                  breakdownRows={
                    counterProfitByTypeRows.length > 0
                      ? counterProfitByTypeRows
                      : [{ label: 'No counter profit in this period', amount: 0 }]
                  }
                />
                <DashboardMetricCard
                  title="Repair profit"
                  icon={<Wrench className="h-5 w-5 text-purple-700" />}
                  totalFormatted={`₹${formatNumber(repairProfit, 2)}`}
                  gradientClass="bg-gradient-to-br from-purple-50 to-purple-100"
                  borderClass="border-purple-200"
                  iconClass=""
                  breakdownRows={
                    repairProfitByTypeRows.length > 0
                      ? repairProfitByTypeRows
                      : [{ label: 'No repair profit in this period', amount: 0 }]
                  }
                />
                <DashboardMetricCard
                  title="Overall profit (selected period)"
                  icon={<BarChart3 className="h-5 w-5 text-teal-700" />}
                  totalFormatted={`₹${formatNumber(overallProfit, 2)}`}
                  gradientClass="bg-gradient-to-br from-teal-50 to-teal-100"
                  borderClass="border-teal-200"
                  iconClass=""
                  breakdownRows={[
                    { label: 'Retail (counter)', amount: counterProfit },
                    { label: 'Repair', amount: repairProfit },
                  ]}
                />
                <DashboardMetricCard
                  title="Overall profit (11th → 10th month)"
                  subtitle={
                    billingWindow
                      ? `${formatDateDDMMYYYY(billingWindow.from)} – ${formatDateDDMMYYYY(billingWindow.to)}`
                      : undefined
                  }
                  icon={<Calendar className="h-5 w-5 text-teal-800" />}
                  totalFormatted={`₹${formatNumber(overallProfitBilling, 2)}`}
                  gradientClass="bg-gradient-to-br from-sky-50 to-sky-100"
                  borderClass="border-sky-200"
                  iconClass=""
                  breakdownRows={[
                    { label: 'Retail (counter)', amount: counterProfitBilling },
                    { label: 'Repair', amount: repairProfitBilling },
                  ]}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-5xl mt-4">
                <StoreAmountList
                  title="Counter profit by store"
                  rows={counterProfitByStore}
                  emptyMessage="No counter profit in this period."
                />
                <StoreAmountList
                  title="Repair profit by store"
                  rows={repairProfitByStore}
                  emptyMessage="No repair profit in this period."
                />
              </div>
            </div>

            {SHOW_MANUAL_POS_PAYMENTS_SECTION ? (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Coins className="h-5 w-5 text-gray-600" />
                  Manual / POS payments
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
                  <div className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200 rounded-xl border p-5">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-gray-700">POS payments (all methods)</p>
                      <Coins className="h-5 w-5 text-amber-800" />
                    </div>
                    <p className="text-3xl font-bold text-gray-900">₹{formatNumber(totalPosPayments, 2)}</p>
                    <p className="text-xs text-gray-600 mt-2">Payment rows linked to invoices (period)</p>
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
            ) : null}

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Wallet className="h-5 w-5 text-gray-600" />
                Manual payments (ledger, no invoice)
              </h2>
              <DashboardMetricCard
                title="Manual payments total"
                icon={<Wallet className="h-5 w-5 text-amber-800" />}
                totalFormatted={`₹${formatNumber(manualCashTotalKpi + manualUpiTotalKpi, 2)}`}
                gradientClass="bg-gradient-to-br from-stone-50 to-stone-100"
                borderClass="border-stone-200"
                iconClass=""
                breakdownRows={[
                  { label: 'Cash', amount: manualCashTotalKpi },
                  { label: 'UPI', amount: manualUpiTotalKpi },
                ]}
              />
              <div className="mt-4 bg-white rounded-xl border border-gray-200 overflow-hidden max-w-5xl">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <p className="text-sm font-medium text-gray-700">Detail (name, amounts, note)</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/80">
                        <th className="px-4 py-2.5 font-medium text-gray-700">Name</th>
                        <th className="px-4 py-2.5 font-medium text-gray-700 text-right">Cash</th>
                        <th className="px-4 py-2.5 font-medium text-gray-700 text-right">UPI</th>
                        <th className="px-4 py-2.5 font-medium text-gray-700">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {manualPayments.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-gray-500 text-center">
                            No manual ledger credits in this period.
                          </td>
                        </tr>
                      ) : (
                        manualPayments.map((row, idx) => (
                          <tr key={`${row.name}-${idx}`} className="hover:bg-gray-50/80">
                            <td className="px-4 py-2.5 font-medium text-gray-900">{row.name}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">₹{formatNumber(row.cash_amount, 2)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">₹{formatNumber(row.upi_amount, 2)}</td>
                            <td className="px-4 py-2.5 text-gray-600 max-w-md whitespace-pre-wrap break-words">
                              {row.note || '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-gray-600" />
                Overall pending bill value (purchase cost)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
                <DashboardMetricCard
                  title="Overall pending (at purchase cost)"
                  subtitle="Status pending OR type pending (non-draft). Unpaid lines use purchase unit × qty until finalized."
                  icon={<ClipboardList className="h-5 w-5 text-orange-800" />}
                  totalFormatted={`₹${formatNumber(pendingPurchaseTotal, 2)}`}
                  gradientClass="bg-gradient-to-br from-orange-50 to-orange-100"
                  borderClass="border-orange-200"
                  iconClass=""
                  breakdownRows={[
                    {
                      label: 'Yet to finalize (paid = 0, purchase unit × qty)',
                      amount: pendingPurchaseYtfTotal,
                    },
                    { label: 'Yet to finalize · Retail', amount: pendingPurchaseYtfRetail },
                    { label: 'Yet to finalize · Wholesale', amount: pendingPurchaseYtfWholesale },
                    { label: 'All pending at cost · Retail', amount: pendingRetail },
                    { label: 'All pending at cost · Wholesale', amount: pendingWholesale },
                  ]}
                />
                <div className="min-h-0 space-y-4">
                  <StoreAmountList
                    title="By store (all pending)"
                    rows={pendingPurchaseByStore}
                    emptyMessage="No pending invoice lines in this period."
                  />
                  <StoreAmountList
                    title="Yet to finalize by store (paid = 0)"
                    rows={pendingPurchaseYtfByStore}
                    emptyMessage="No unpaid pending lines in this period."
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
                <DashboardMetricCard
                  title="Total stock value"
                  icon={<Package className="h-5 w-5 text-slate-700" />}
                  totalFormatted={`₹${formatNumber(stockValue, 2)}`}
                  gradientClass="bg-gradient-to-br from-slate-50 to-slate-100"
                  borderClass="border-slate-200"
                  iconClass=""
                  breakdownRows={[
                    { label: 'New + returned barcodes (available)', amount: stockValue },
                  ]}
                />
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
                <DashboardMetricCard
                  title="Defective stock value"
                  subtitle={`${defectiveBarcodeCount} barcode(s) tagged defective`}
                  icon={<Coins className="h-5 w-5 text-orange-800" />}
                  totalFormatted={`₹${formatNumber(defectivePurchaseValue, 2)}`}
                  gradientClass="bg-gradient-to-br from-orange-50 to-orange-100"
                  borderClass="border-orange-200"
                  iconClass=""
                  breakdownRows={[
                    { label: 'Σ purchase unit price (defective barcodes)', amount: defectivePurchaseValue },
                  ]}
                />
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
