import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { reportsApi } from '../../lib/api';
import { DateRangePreset, formatDateDDMMYYYY, formatNumber, getDateRangeByPreset } from '../../lib/utils';
import { auth } from '../../lib/auth';
import { BarChart3, Calendar, CreditCard, DollarSign, Lock, RefreshCw, Store, TrendingUp, Wallet, Wrench } from 'lucide-react';
import DateRangeSelector from '../../components/ui/DateRangeSelector';

const PIN_LENGTH = 6;
const DASHBOARD_PIN = (import.meta.env.VITE_DASHBOARD_PIN as string) || '908070';

type BasicCardProps = {
  title: string;
  total: number;
  retail: number;
  repair: number;
  manual: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'green' | 'blue' | 'purple';
};

function BasicKpiCard({ title, total, retail, repair, manual, icon: Icon, tone }: BasicCardProps) {
  const toneClasses =
    tone === 'green'
      ? 'from-green-50 to-green-100 border-green-200 text-green-700'
      : tone === 'blue'
        ? 'from-blue-50 to-blue-100 border-blue-200 text-blue-700'
        : 'from-purple-50 to-purple-100 border-purple-200 text-purple-700';
  return (
    <div className={`bg-gradient-to-br ${toneClasses} rounded-xl border p-5`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-gray-700">{title}</p>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-3xl font-bold text-gray-900">₹{formatNumber(total, 2)}</p>
      <p className="text-sm text-gray-600 mt-1">
        Retail ₹{formatNumber(retail, 2)} / Repair ₹{formatNumber(repair, 2)} / Manual Payment ₹{formatNumber(manual, 2)}
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
        setPinDigits(Array(PIN_LENGTH).fill(''));
        pinInputRefs.current[0]?.focus();
      }
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
  const totalCash = Number(kpis.total_cash || 0);
  const totalOnline = Number(kpis.total_online || 0);
  const retailCash = Number(kpis.retail_cash || 0);
  const repairCash = Number(kpis.repair_cash || 0);
  const retailOnline = Number(kpis.retail_online || 0);
  const repairOnline = Number(kpis.repair_online || 0);
  const totalMixed = Number(kpis.total_mixed || 0);
  const retailMixed = Number(kpis.retail_mixed || 0);
  const repairMixed = Number(kpis.repair_mixed || 0);
  const manualCash = Number(kpis.manual_cash || 0);
  const manualOnline = Number(kpis.manual_online || 0);
  const manualMixed = Number(kpis.manual_mixed || 0);
  const totalCredit = Number(kpis.total_credit || 0);
  const retailCredit = Number(kpis.retail_credit || 0);
  const wholesaleCredit = Number(kpis.wholesale_credit || 0);
  const repairCredit = Number(kpis.repair_credit || 0);
  const manualPaymentTotal = Number(kpis.manual_payment_total || 0);
  const inhandTotal = Number(kpis.inhand_total || 0);
  const repairingProfit = Number(kpis.repairing_profit || 0);
  const counterProfit = Number(kpis.counter_profit || 0);
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
              {formatDateDDMMYYYY(new Date())}
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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <BasicKpiCard
              title="Total Cash"
              total={totalCash}
              retail={retailCash}
              repair={repairCash}
              manual={manualCash}
              icon={DollarSign}
              tone="green"
            />
            <BasicKpiCard
              title="Total Online"
              total={totalOnline}
              retail={retailOnline}
              repair={repairOnline}
              manual={manualOnline}
              icon={CreditCard}
              tone="blue"
            />
            <BasicKpiCard
              title="Total Mixed"
              total={totalMixed}
              retail={retailMixed}
              repair={repairMixed}
              manual={manualMixed}
              icon={CreditCard}
              tone="purple"
            />
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Credit Profit</p>
                <CreditCard className="h-5 w-5 text-blue-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(totalCredit, 2)}</p>
              <p className="text-sm text-gray-600 mt-1">
                Retail ₹{formatNumber(retailCredit, 2)} / Wholesale ₹{formatNumber(wholesaleCredit, 2)} / Repair ₹{formatNumber(repairCredit, 2)}
              </p>
            </div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Repairing Profit</p>
                <Wrench className="h-5 w-5 text-orange-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(repairingProfit, 2)}</p>
            </div>
            <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 border-indigo-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Counter Profit</p>
                <Store className="h-5 w-5 text-indigo-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(counterProfit, 2)}</p>
            </div>
            <div className="bg-gradient-to-br from-red-50 to-red-100 border-red-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Total Expense</p>
                <TrendingUp className="h-5 w-5 text-red-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(Number(kpis.total_expenses || 0), 2)}</p>
            </div>
            <div className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Manual Payment</p>
                <DollarSign className="h-5 w-5 text-amber-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(manualPaymentTotal, 2)}</p>
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
                <p className="text-sm font-medium text-gray-700">Overall Profit</p>
                <BarChart3 className="h-5 w-5 text-teal-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(overallProfit, 2)}</p>
            </div>
            <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-200 rounded-xl border p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Bill Pending</p>
                <CreditCard className="h-5 w-5 text-yellow-700" />
              </div>
              <p className="text-3xl font-bold text-gray-900">₹{formatNumber(billPendingTotal, 2)}</p>
              <p className="text-sm text-gray-600 mt-1">
                Retail ₹{formatNumber(retailBillPending, 2)} / Wholesale ₹{formatNumber(wholesaleBillPending, 2)} / Repair ₹{formatNumber(repairBillPending, 2)}
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
        )}
      </div>
    </div>
  );
}
