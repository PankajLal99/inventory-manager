import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { reportsApi } from '../../lib/api';
import { DateRangePreset, formatDateDDMMYYYY, formatNumber, getDateRangeByPreset } from '../../lib/utils';
import { auth } from '../../lib/auth';
import { BarChart3, Calendar, CreditCard, DollarSign, Lock, Package, RefreshCw, Store, TrendingUp, Wallet, Wrench } from 'lucide-react';
import DateRangeSelector from '../../components/ui/DateRangeSelector';

const PIN_LENGTH = 6;
const DASHBOARD_PIN = (import.meta.env.VITE_DASHBOARD_PIN as string) || '908070';

type IncomingStoreRow = {
  store_id: number;
  store_name: string;
  shop_type: string;
  invoice_total: number;
};

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

type ShopSplitCardProps = {
  title: string;
  total: number;
  retail: number;
  wholesale: number;
  repair: number;
  /** Omit to hide manual from the footer (e.g. invoice-only rows). */
  manual?: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'green' | 'blue' | 'purple' | 'slate' | 'cyan';
};

function ShopSplitCard({ title, total, retail, wholesale, repair, manual, icon: Icon, tone }: ShopSplitCardProps) {
  const toneClasses =
    tone === 'green'
      ? 'from-green-50 to-green-100 border-green-200 text-green-700'
      : tone === 'blue'
        ? 'from-blue-50 to-blue-100 border-blue-200 text-blue-700'
        : tone === 'purple'
          ? 'from-purple-50 to-purple-100 border-purple-200 text-purple-700'
          : tone === 'slate'
            ? 'from-slate-50 to-slate-100 border-slate-200 text-slate-700'
            : 'from-cyan-50 to-cyan-100 border-cyan-200 text-cyan-700';
  return (
    <div className={`bg-gradient-to-br ${toneClasses} rounded-xl border p-5`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-gray-700">{title}</p>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-3xl font-bold text-gray-900">₹{formatNumber(total, 2)}</p>
      <p className="text-sm text-gray-600 mt-1 leading-relaxed">
        Retail ₹{formatNumber(retail, 2)} / Wholesale ₹{formatNumber(wholesale, 2)} / Repair ₹{formatNumber(repair, 2)}
        {manual !== undefined ? <> / Manual ₹{formatNumber(manual, 2)}</> : null}
      </p>
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

  const { data: kpisData, isLoading } = useQuery({
    queryKey: ['dashboard-kpis-v2', dateFrom, dateTo],
    queryFn: async () => {
      const response = await reportsApi.dashboardKpis({
        date_from: dateFrom,
        date_to: dateTo,
      });
      return response.data;
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

  const kpis = kpisData?.kpis || {};
  const incomingByStore: IncomingStoreRow[] = Array.isArray(kpisData?.incoming_by_store)
    ? kpisData.incoming_by_store
    : [];
  const incomingByShopType = incomingByStore.reduce<Record<string, number>>((acc, row) => {
    const k = row.shop_type || 'other';
    acc[k] = (acc[k] || 0) + Number(row.invoice_total || 0);
    return acc;
  }, {});

  const totalCash = Number(kpis.total_cash || 0);
  const totalOnline = Number(kpis.total_online || 0);
  const retailCash = Number(kpis.retail_cash || 0);
  const wholesaleCash = Number(kpis.wholesale_cash || 0);
  const repairCash = Number(kpis.repair_cash || 0);
  const retailOnline = Number(kpis.retail_online || 0);
  const wholesaleOnline = Number(kpis.wholesale_online || 0);
  const repairOnline = Number(kpis.repair_online || 0);
  const totalMixed = Number(kpis.total_mixed || 0);
  const retailMixed = Number(kpis.retail_mixed || 0);
  const wholesaleMixed = Number(kpis.wholesale_mixed || 0);
  const repairMixed = Number(kpis.repair_mixed || 0);
  const manualCash = Number(kpis.manual_cash || 0);
  const manualOnline = Number(kpis.manual_online || 0);
  const manualMixed = Number(kpis.manual_mixed || 0);
  const totalCredit = Number(kpis.total_credit || 0);
  const collectedTotalCash =
    kpis.collected_total_cash === undefined ? undefined : Number(kpis.collected_total_cash);
  const collectedTotalOnline =
    kpis.collected_total_online === undefined ? undefined : Number(kpis.collected_total_online);
  const collectedTotalMixed =
    kpis.collected_total_mixed === undefined ? undefined : Number(kpis.collected_total_mixed);
  const collectedTotalCreditInvoiced =
    kpis.collected_total_credit === undefined ? undefined : Number(kpis.collected_total_credit);
  const collectedInvoiceGrand =
    kpis.collected_invoice_grand === undefined ? undefined : Number(kpis.collected_invoice_grand);
  const collectedRetailInvoiceTotal =
    kpis.collected_retail_invoice_total === undefined
      ? undefined
      : Number(kpis.collected_retail_invoice_total);
  const collectedWholesaleInvoiceTotal =
    kpis.collected_wholesale_invoice_total === undefined
      ? undefined
      : Number(kpis.collected_wholesale_invoice_total);
  const collectedRepairInvoiceTotal =
    kpis.collected_repair_invoice_total === undefined
      ? undefined
      : Number(kpis.collected_repair_invoice_total);
  const collectedRetailCashInv = Number(kpis.collected_retail_cash ?? 0);
  const collectedWholesaleCashInv = Number(kpis.collected_wholesale_cash ?? 0);
  const collectedRepairCashInv = Number(kpis.collected_repair_cash ?? 0);
  const collectedRetailOnlineInv = Number(kpis.collected_retail_online ?? 0);
  const collectedWholesaleOnlineInv = Number(kpis.collected_wholesale_online ?? 0);
  const collectedRepairOnlineInv = Number(kpis.collected_repair_online ?? 0);
  const collectedRetailMixedInv = Number(kpis.collected_retail_mixed ?? 0);
  const collectedWholesaleMixedInv = Number(kpis.collected_wholesale_mixed ?? 0);
  const collectedRepairMixedInv = Number(kpis.collected_repair_mixed ?? 0);
  const collectedRetailCreditInv = Number(kpis.collected_retail_credit ?? 0);
  const collectedWholesaleCreditInv = Number(kpis.collected_wholesale_credit ?? 0);
  const collectedRepairCreditInv = Number(kpis.collected_repair_credit ?? 0);
  const totalInvoicedShops =
    (collectedRetailInvoiceTotal ?? 0) +
    (collectedWholesaleInvoiceTotal ?? 0) +
    (collectedRepairInvoiceTotal ?? 0);
  const retailCredit = Number(kpis.retail_credit || 0);
  const wholesaleCredit = Number(kpis.wholesale_credit || 0);
  const repairCredit = Number(kpis.repair_credit || 0);
  const manualPaymentTotal = Number(kpis.manual_payment_total || 0);
  const inhandTotal = Number(kpis.inhand_total || 0);
  const repairingProfit = Number(kpis.repairing_profit || 0);
  const counterProfit = Number(kpis.counter_profit || 0);
  const wholesaleProfit = Number(kpis.wholesale_profit || 0);
  const overallProfit = Number(kpis.overall_profit || 0);
  const billPendingTotal = Number(kpis.bill_pending_total || 0);
  const retailBillPending = Number(kpis.retail_bill_pending || 0);
  const wholesaleBillPending = Number(kpis.wholesale_bill_pending || 0);
  const repairBillPending = Number(kpis.repair_bill_pending || 0);
  const pendingProfit = Number(kpis.pending_profit || 0);
  const monthlyProfit = Number(kpis.monthly_profit || 0);
  const monthlyPendingProfit = Number(kpis.monthly_pending_profit || 0);
  const monthlyWindowFrom = kpis.monthly_window_from as string | undefined;
  const monthlyWindowTo = kpis.monthly_window_to as string | undefined;
  const stockValue = Number(kpis.stock_value || 0);
  const totalReplacement = Number(kpis.total_replacement || 0);
  const monthlyTotalReplacement = Number(kpis.monthly_total_replacement || 0);
  const defectiveValue = Number(kpis.defective_value || 0);
  const productSentToDelhi = Number(kpis.product_sent_to_delhi || 0);

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
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

      <div className="px-4 sm:px-6 pt-6">
        {isLoading ? (
          <div className="text-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-gray-400" />
            <p className="text-gray-500">Loading dashboard data...</p>
          </div>
        ) : (
          <div className="space-y-12">
            <section>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Incoming (totals)</h2>
                <p className="text-sm text-gray-500 mt-0.5 max-w-3xl">
                  Invoice <span className="font-medium text-gray-600">total</span> (Σ per invoice) and collections-style
                  splits; per-store totals list every shop. Repair dates follow the repair invoice list. Manual ledger
                  receipts are not tied to a store.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <ShopSplitCard
                  title="Total invoiced (Σ invoice total)"
                  total={collectedInvoiceGrand ?? totalInvoicedShops}
                  retail={collectedRetailInvoiceTotal ?? 0}
                  wholesale={collectedWholesaleInvoiceTotal ?? 0}
                  repair={collectedRepairInvoiceTotal ?? 0}
                  icon={BarChart3}
                  tone="slate"
                />
                <ShopSplitCard
                  title="Cash — invoiced + manual"
                  total={collectedTotalCash ?? collectedRetailCashInv + collectedWholesaleCashInv + collectedRepairCashInv + manualCash}
                  retail={collectedRetailCashInv}
                  wholesale={collectedWholesaleCashInv}
                  repair={collectedRepairCashInv}
                  manual={manualCash}
                  icon={DollarSign}
                  tone="green"
                />
                <ShopSplitCard
                  title="UPI / online — invoiced + manual"
                  total={collectedTotalOnline ?? collectedRetailOnlineInv + collectedWholesaleOnlineInv + collectedRepairOnlineInv + manualOnline}
                  retail={collectedRetailOnlineInv}
                  wholesale={collectedWholesaleOnlineInv}
                  repair={collectedRepairOnlineInv}
                  manual={manualOnline}
                  icon={CreditCard}
                  tone="blue"
                />
                <ShopSplitCard
                  title="Mixed — invoiced + manual"
                  total={collectedTotalMixed ?? collectedRetailMixedInv + collectedWholesaleMixedInv + collectedRepairMixedInv + manualMixed}
                  retail={collectedRetailMixedInv}
                  wholesale={collectedWholesaleMixedInv}
                  repair={collectedRepairMixedInv}
                  manual={manualMixed}
                  icon={CreditCard}
                  tone="purple"
                />
                <ShopSplitCard
                  title="Credit — invoice total"
                  total={collectedTotalCreditInvoiced ?? collectedRetailCreditInv + collectedWholesaleCreditInv + collectedRepairCreditInv}
                  retail={collectedRetailCreditInv}
                  wholesale={collectedWholesaleCreditInv}
                  repair={collectedRepairCreditInv}
                  icon={CreditCard}
                  tone="cyan"
                />
                <div className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200 rounded-xl border p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700">Manual payment (total)</p>
                    <DollarSign className="h-5 w-5 text-amber-700" />
                  </div>
                  <p className="text-3xl font-bold text-gray-900">₹{formatNumber(manualPaymentTotal, 2)}</p>
                  <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                    Cash ₹{formatNumber(manualCash, 2)} / UPI ₹{formatNumber(manualOnline, 2)} / Mixed ₹{formatNumber(manualMixed, 2)}
                  </p>
                </div>
                <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-200 rounded-xl border p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-700">Bill pending (invoice total)</p>
                    <CreditCard className="h-5 w-5 text-yellow-700" />
                  </div>
                  <p className="text-3xl font-bold text-gray-900">₹{formatNumber(billPendingTotal, 2)}</p>
                  <p className="text-sm text-gray-600 mt-1">
                    Retail ₹{formatNumber(retailBillPending, 2)} / Wholesale ₹{formatNumber(wholesaleBillPending, 2)} / Repair ₹{formatNumber(repairBillPending, 2)}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-1 rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">Σ invoice total by shop type</p>
                  <ul className="text-sm text-gray-600 space-y-1.5">
                    {(['retail', 'wholesale', 'repair'] as const).map((t) => (
                      <li key={t} className="flex justify-between gap-2">
                        <span>{shopTypeLabel(t)}</span>
                        <span className="font-semibold text-gray-900 tabular-nums">
                          ₹{formatNumber(incomingByShopType[t] || 0, 2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-gray-400 mt-3">
                    Matches Σ invoice <code className="text-[11px]">total</code> in KPIs (excludes void/draft).
                  </p>
                </div>
                <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <p className="text-sm font-medium text-gray-700">Σ invoice total by store</p>
                  </div>
                  {incomingByStore.length === 0 ? (
                    <p className="text-sm text-gray-500 p-4">No qualifying invoices in this period.</p>
                  ) : (
                    <ul className="divide-y divide-gray-100 max-h-[min(400px,50vh)] overflow-y-auto">
                      {incomingByStore.map((row) => (
                        <li
                          key={row.store_id}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 truncate">{row.store_name}</p>
                            <p className="text-gray-500 text-xs mt-0.5">{shopTypeLabel(row.shop_type)}</p>
                          </div>
                          <p className="font-semibold text-gray-900 tabular-nums shrink-0">
                            ₹{formatNumber(row.invoice_total, 2)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>

            <section>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Profits & operations</h2>
                <p className="text-sm text-gray-500 mt-0.5 max-w-3xl">
                  List-style margin (paid minus cost) matching invoice/repair lists, plus expenses, stock, and other operational
                  KPIs.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <ShopSplitCard
              title="Profit — cash"
              total={totalCash}
              retail={retailCash}
              wholesale={wholesaleCash}
              repair={repairCash}
              manual={manualCash}
              icon={DollarSign}
              tone="green"
            />
            <ShopSplitCard
              title="Profit — UPI / online"
              total={totalOnline}
              retail={retailOnline}
              wholesale={wholesaleOnline}
              repair={repairOnline}
              manual={manualOnline}
              icon={CreditCard}
              tone="blue"
            />
            <ShopSplitCard
              title="Profit — mixed"
              total={totalMixed}
              retail={retailMixed}
              wholesale={wholesaleMixed}
              repair={repairMixed}
              manual={manualMixed}
              icon={CreditCard}
              tone="purple"
            />
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Credit profit</p>
                <CreditCard className="h-5 w-5 text-blue-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(totalCredit, 2)}</p>
              <p className="text-sm text-gray-600 mt-1">
                Retail ₹{formatNumber(retailCredit, 2)} / Wholesale ₹{formatNumber(wholesaleCredit, 2)} / Repair ₹{formatNumber(repairCredit, 2)}
              </p>
            </div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Repairing profit</p>
                <Wrench className="h-5 w-5 text-orange-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(repairingProfit, 2)}</p>
            </div>
            <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 border-indigo-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Counter profit (retail)</p>
                <Store className="h-5 w-5 text-indigo-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(counterProfit, 2)}</p>
            </div>
            <div className="bg-gradient-to-br from-sky-50 to-sky-100 border-sky-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Wholesale profit</p>
                <Package className="h-5 w-5 text-sky-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(wholesaleProfit, 2)}</p>
            </div>
            <div className="bg-gradient-to-br from-red-50 to-red-100 border-red-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Total Expense</p>
                <TrendingUp className="h-5 w-5 text-red-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(Number(kpis.total_expenses || 0), 2)}</p>
            </div>
            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Inhand Total</p>
                <Wallet className="h-5 w-5 text-emerald-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(inhandTotal, 2)}</p>
            </div>
            <div className="bg-gradient-to-br from-teal-50 to-teal-100 border-teal-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Overall profit</p>
                <BarChart3 className="h-5 w-5 text-teal-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(overallProfit, 2)}</p>
              <p className="text-sm text-gray-500 mt-1">
                Retail ₹{formatNumber(counterProfit, 2)} + Wholesale ₹{formatNumber(wholesaleProfit, 2)} + Repair ₹{formatNumber(repairingProfit, 2)}
              </p>
            </div>
            <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 border-cyan-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Pending Profit</p>
                <CreditCard className="h-5 w-5 text-cyan-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(pendingProfit, 2)}</p>
            </div>
            <div className="bg-gradient-to-br from-fuchsia-50 to-fuchsia-100 border-fuchsia-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Monthly Profit</p>
                <BarChart3 className="h-5 w-5 text-fuchsia-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(monthlyProfit, 2)}</p>
              <p className="text-sm text-gray-600 mt-1">
                {monthlyWindowFrom && monthlyWindowTo
                  ? `${formatDateDDMMYYYY(new Date(monthlyWindowFrom))} to ${formatDateDDMMYYYY(new Date(monthlyWindowTo))}`
                  : '11th to 10th window'}
              </p>
              <p className="text-sm text-gray-600 mt-1">(Pending Profit ₹{formatNumber(monthlyPendingProfit, 2)})</p>
            </div>
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 border-slate-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Stock Value</p>
                <Wallet className="h-5 w-5 text-slate-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(stockValue, 2)}</p>
            </div>
            <div className="bg-gradient-to-br from-pink-50 to-pink-100 border-pink-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Total Replacement</p>
                <CreditCard className="h-5 w-5 text-pink-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(totalReplacement, 2)}</p>
            </div>
            <div className="bg-gradient-to-br from-violet-50 to-violet-100 border-violet-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Monthly Total Replacement</p>
                <CreditCard className="h-5 w-5 text-violet-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(monthlyTotalReplacement, 2)}</p>
              <p className="text-sm text-gray-600 mt-1">
                {monthlyWindowFrom && monthlyWindowTo
                  ? `${formatDateDDMMYYYY(new Date(monthlyWindowFrom))} to ${formatDateDDMMYYYY(new Date(monthlyWindowTo))}`
                  : '11th to 10th window'}
              </p>
            </div>
            <div className="bg-gradient-to-br from-rose-50 to-rose-100 border-rose-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Defective Value</p>
                <TrendingUp className="h-5 w-5 text-rose-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(defectiveValue, 2)}</p>
            </div>
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Product Sent to Delhi</p>
                <Store className="h-5 w-5 text-blue-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(productSentToDelhi, 2)}</p>
            </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
