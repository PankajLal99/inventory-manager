import { useQuery } from '@tanstack/react-query';
import { useNavigate, Navigate } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { reportsApi } from '../../lib/api';
import { DateRangePreset, formatNumber, formatDateDDMMYYYY, getDateRangeByPreset } from '../../lib/utils';
import { auth } from '../../lib/auth';
import {
  Package, FileText, ShoppingBag, Calendar,
  DollarSign, CreditCard, Wallet, TrendingUp, TrendingDown, Wrench, Store, Clock,
  BarChart3, Box, RefreshCw, ArrowUp, ArrowDown, Lock, type LucideIcon
} from 'lucide-react';
import DateRangeSelector from '../../components/ui/DateRangeSelector';

const PIN_LENGTH = 6;
const DASHBOARD_PIN = (import.meta.env.VITE_DASHBOARD_PIN as string) || '908070';

type ContributionMethod = 'cash' | 'upi';

type ContributionRow = {
  id: number;
  invoice_id?: number | null;
  invoice_number?: string | null;
  party_name?: string | null;
  customer_name?: string | null;
  amount: number;
  payment_date?: string | null;
  description?: string;
};

type KpiDebugRow = {
  id?: number;
  ref?: string;
  party?: string;
  value?: number;
  date?: string | null;
  source?: string;
  note?: string;
};

type KpiDebugBlock = {
  label?: string;
  formula?: string;
  total?: number;
  rows?: KpiDebugRow[];
};

type KpiStoreRow = {
  store: string;
  value: number;
};

type KpiStoreGroupingBlock = {
  label?: string;
  formula?: string;
  total?: number;
  stores?: KpiStoreRow[];
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(auth.getUser());
  const [datePreset, setDatePreset] = useState<DateRangePreset>('one_day');
  const [dateRange, setDateRange] = useState(() => getDateRangeByPreset('one_day'));
  const [didAutoAlignToLatestDate, setDidAutoAlignToLatestDate] = useState(false);
  const [includeMonthlyProfitRows, setIncludeMonthlyProfitRows] = useState(false);
  const [contributionViewMode, setContributionViewMode] = useState<'tab' | 'both'>('tab');
  const [selectedContributionMethod, setSelectedContributionMethod] = useState<ContributionMethod>('cash');
  const { startDate: dateFrom, endDate: dateTo } = dateRange;

  // 6-digit PIN lock; always locked when entering dashboard (auto-lock when leaving)
  const [unlocked, setUnlocked] = useState(false);
  const [pinDigits, setPinDigits] = useState<string[]>(() => Array(PIN_LENGTH).fill(''));
  const [pinError, setPinError] = useState('');
  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!user) {
      auth.loadUser().then((loadedUser) => {
        setUser(loadedUser);
      });
    }
  }, [user]);

  // Fetch dashboard KPIs (must run unconditionally for Rules of Hooks; enabled only when unlocked)
  const { data: kpisData, isLoading: kpisLoading } = useQuery({
    queryKey: ['dashboard-kpis', dateFrom, dateTo, includeMonthlyProfitRows],
    queryFn: async () => {
      const response = await reportsApi.dashboardKpis({
        date_from: dateFrom,
        date_to: dateTo,
        include_total_stock_rows: 0,
        include_total_stock_value_rows: 0,
        include_monthly_profit_rows: includeMonthlyProfitRows ? 1 : 0,
      });
      return response.data;
    },
    enabled: unlocked,
    retry: false,
  });

  // On initial open, if selected day is ahead of latest invoice date, auto-jump once to latest date.
  useEffect(() => {
    if (didAutoAlignToLatestDate) return;
    const latestInvoiceDate = kpisData?.latest_invoice_date as string | undefined;
    if (!latestInvoiceDate) return;
    if (datePreset !== 'one_day') return;
    if (dateRange.startDate !== dateRange.endDate) return;
    if (dateRange.startDate <= latestInvoiceDate) {
      setDidAutoAlignToLatestDate(true);
      return;
    }

    setDatePreset('custom');
    setDateRange({ startDate: latestInvoiceDate, endDate: latestInvoiceDate });
    setDidAutoAlignToLatestDate(true);
  }, [kpisData, didAutoAlignToLatestDate, datePreset, dateRange.startDate, dateRange.endDate]);

  // Auto-focus first PIN input when lock screen is shown (on mount or when navigating to dashboard)
  useEffect(() => {
    if (!unlocked) {
      const t = setTimeout(() => pinInputRefs.current[0]?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [unlocked]);

  // PIN entry handlers
  const handlePinChange = (index: number, value: string) => {
    if (value.length > 1) {
      const digits = value.replace(/\D/g, '').slice(0, PIN_LENGTH).split('');
      const next = [...pinDigits];
      digits.forEach((d, i) => { if (index + i < PIN_LENGTH) next[index + i] = d; });
      setPinDigits(next);
      setPinError('');
      const nextFocus = Math.min(index + digits.length, PIN_LENGTH - 1);
      pinInputRefs.current[nextFocus]?.focus();
      if (next.every(Boolean)) verifyPin(next.join(''));
      return;
    }
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...pinDigits];
    next[index] = digit;
    setPinDigits(next);
    setPinError('');
    if (digit && index < PIN_LENGTH - 1) pinInputRefs.current[index + 1]?.focus();
    if (next.every(Boolean)) verifyPin(next.join(''));
  };

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !pinDigits[index] && index > 0) {
      pinInputRefs.current[index - 1]?.focus();
      const next = [...pinDigits];
      next[index - 1] = '';
      setPinDigits(next);
    }
  };

  const verifyPin = (pin: string) => {
    if (pin === DASHBOARD_PIN) {
      setUnlocked(true);
      setPinError('');
    } else {
      setPinError('Wrong PIN');
      setPinDigits(Array(PIN_LENGTH).fill(''));
      pinInputRefs.current[0]?.focus();
    }
  };

  // Check if user can access dashboard
  const canAccessDashboard = user?.can_access_dashboard !== false;

  if (user && !canAccessDashboard) {
    return <Navigate to="/" replace />;
  }

  // Show 6-digit PIN screen before dashboard content (auto-locks when user navigates away)
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
            <div className="flex gap-2 justify-center mb-2 flex-wrap max-w-[340px] sm:max-w-[400px]">
              {Array.from({ length: PIN_LENGTH }, (_, i) => (
                <input
                  key={i}
                  ref={(el) => { pinInputRefs.current[i] = el; }}
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  autoFocus={i === 0}
                  value={pinDigits[i]}
                  onChange={(e) => handlePinChange(i, e.target.value)}
                  onKeyDown={(e) => handlePinKeyDown(i, e)}
                  className="w-14 h-14 sm:w-16 sm:h-16 text-center text-lg font-semibold border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 border-gray-300"
                />
              ))}
            </div>
            {pinError && (
              <p className="text-sm text-red-600 font-medium mt-2">{pinError}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Calculate custom month period (10th to 10th)
  const getCustomMonthPeriod = () => {
    const now = new Date();
    const currentDay = now.getDate();

    let startDate: Date;
    let endDate: Date;

    if (currentDay < 10) {
      // Before 10th: use previous month's 10th to current month's 10th
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 10);
      endDate = new Date(now.getFullYear(), now.getMonth(), 10);
    } else {
      // On or after 10th: use current month's 10th to next month's 10th
      startDate = new Date(now.getFullYear(), now.getMonth(), 10);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 10);
    }

    return `${formatDateDDMMYYYY(startDate)} - ${formatDateDDMMYYYY(endDate)}`;
  };

  const kpis = kpisData?.kpis || {};
  const comparisons = kpisData?.comparisons?.yesterday || {};
  const contributionData = kpisData?.cash_online_contributions || {};

  // Calculate percentage changes
  const getChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  const cashChange = getChange(kpis.total_cash || 0, comparisons.total_cash || 0);
  const onlineChange = getChange(kpis.total_online || 0, comparisons.total_online || 0);
  const inhandChange = getChange(kpis.total_inhand || 0, comparisons.total_inhand || 0);
  const profitChange = getChange(kpis.overall_profit || 0, comparisons.overall_profit || 0);
  const kpiDebugRows = kpisData?.kpi_debug_rows || {};
  const kpiStoreGrouping = kpisData?.kpi_store_grouping || {};
  const kpiDebugOrder = [
    'total_cash',
    'total_online',
    'total_expenses',
    'total_inhand',
    'repair_invoice_cash_total',
    'repair_invoice_upi_total',
    'repair_invoice_mixed_total',
    'repair_payment_cash_total',
    'repair_payment_upi_total',
    'repair_payment_mixed_total',
    'repairing_profit',
    'counter_profit',
    'pending_profit',
    'overall_profit',
    'monthly_profit',
    'pending_invoices_total',
    'total_replacement',
    'todays_loss',
    'monthly_loss',
    'total_loss',
  ];

  const formatContributionDate = (dateValue?: string | null) => {
    if (!dateValue) return '-';
    const parsedDate = new Date(dateValue);
    if (Number.isNaN(parsedDate.getTime())) return '-';
    return `${formatDateDDMMYYYY(parsedDate)} ${parsedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const renderKpiDebugBlock = (kpiKey: string) => {
    const block: KpiDebugBlock | undefined = kpiDebugRows?.[kpiKey];
    if (!block) return null;
    const rows = block.rows || [];
    return (
      <div key={kpiKey} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm sm:text-base font-semibold text-gray-900">{block.label || kpiKey}</h3>
            {block.formula ? (
              <p className="text-[11px] sm:text-xs text-gray-500 mt-0.5">Formula: {block.formula}</p>
            ) : null}
          </div>
          <span className="text-xs sm:text-sm font-semibold text-gray-700 bg-gray-100 px-2 py-1 rounded-full">
            Total: {kpiKey === 'total_stock' ? formatNumber(block.total || 0, 0) : `₹${formatNumber(block.total || 0, 2)}`}
          </span>
        </div>
        {kpiKey === 'monthly_profit' && !includeMonthlyProfitRows ? (
          <div className="px-4 py-4">
            <p className="text-sm text-gray-500 mb-3">Monthly Profit rows are loaded on demand.</p>
            <button
              onClick={() => setIncludeMonthlyProfitRows(true)}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Load Monthly Profit Rows
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-500">No rows found for this KPI in selected date range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Ref</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Party</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Value</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Source</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: KpiDebugRow, idx: number) => (
                  <tr key={`${kpiKey}-${row.id ?? idx}`} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2 text-sm text-gray-800 font-medium">{row.ref || '-'}</td>
                    <td className="px-3 py-2 text-sm text-gray-700">{row.party || '-'}</td>
                    <td className="px-3 py-2 text-sm text-gray-900 font-semibold text-right">
                      {kpiKey === 'total_stock' ? formatNumber(row.value || 0, 0) : `₹${formatNumber(row.value || 0, 2)}`}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{formatContributionDate(row.date)}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{row.source || '-'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{row.note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderKpiStoreGroupingBlock = (kpiKey: string) => {
    const block: KpiStoreGroupingBlock | undefined = kpiStoreGrouping?.[kpiKey];
    if (!block) return null;
    const stores = block.stores || [];
    return (
      <div key={`store-${kpiKey}`} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm sm:text-base font-semibold text-gray-900">{block.label || kpiKey}</h3>
            {block.formula ? (
              <p className="text-[11px] sm:text-xs text-gray-500 mt-0.5">Formula: {block.formula}</p>
            ) : null}
          </div>
          <span className="text-xs sm:text-sm font-semibold text-gray-700 bg-gray-100 px-2 py-1 rounded-full">
            Total: {kpiKey === 'total_stock' ? formatNumber(block.total || 0, 0) : `₹${formatNumber(block.total || 0, 2)}`}
          </span>
        </div>
        {kpiKey === 'monthly_profit' && !includeMonthlyProfitRows ? (
          <div className="px-4 py-4">
            <p className="text-sm text-gray-500 mb-3">Monthly Profit store split is loaded on demand.</p>
            <button
              onClick={() => setIncludeMonthlyProfitRows(true)}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Load Monthly Profit Store Split
            </button>
          </div>
        ) : stores.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-500">No store-wise split available for this KPI.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Store</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((row, idx) => (
                  <tr key={`store-row-${kpiKey}-${idx}`} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2 text-sm text-gray-800 font-medium">{row.store || 'Unmapped'}</td>
                    <td className="px-3 py-2 text-sm text-gray-900 font-semibold text-right">
                      {kpiKey === 'total_stock' ? formatNumber(row.value || 0, 0) : `₹${formatNumber(row.value || 0, 2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderContributionTable = (method: ContributionMethod, invoiceOnly = false) => {
    const methodLabel = method === 'cash' ? 'Cash' : 'UPI';
    const methodColors = method === 'cash'
      ? {
          cardBorder: 'border-green-200',
          cardBg: 'bg-green-50',
          activeBtn: 'bg-green-100 border-green-300 text-green-800',
          inactiveBtn: 'bg-white border-gray-200 text-gray-600',
          chip: 'bg-green-100 text-green-700'
        }
      : {
          cardBorder: 'border-blue-200',
          cardBg: 'bg-blue-50',
          activeBtn: 'bg-blue-100 border-blue-300 text-blue-800',
          inactiveBtn: 'bg-white border-gray-200 text-gray-600',
          chip: 'bg-blue-100 text-blue-700'
        };

    const invoicePayments: ContributionRow[] = contributionData?.[method]?.invoice_payments || [];
    const manualPayments: ContributionRow[] = invoiceOnly ? [] : (contributionData?.[method]?.manual_payments || []);
    const totalContributions = [...invoicePayments, ...manualPayments].reduce((sum, row) => sum + (row.amount || 0), 0);

    const renderRow = (row: ContributionRow, rowType: 'invoice' | 'manual') => {
      const displayParty = row.party_name || row.customer_name || 'Walk-in Customer';
      return (
        <tr key={`${rowType}-${row.id}`} className="border-b border-gray-100 last:border-0">
          <td className="px-3 py-2 text-sm text-gray-800 font-medium">{row.invoice_number || '-'}</td>
          <td className="px-3 py-2 text-sm text-gray-700">{displayParty}</td>
          <td className="px-3 py-2 text-sm text-gray-900 font-semibold text-right">₹{formatNumber(row.amount || 0, 2)}</td>
          <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{formatContributionDate(row.payment_date)}</td>
        </tr>
      );
    };

    return (
      <div className={`rounded-xl border ${methodColors.cardBorder} ${methodColors.cardBg} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900">
            {invoiceOnly ? `${methodLabel} (Invoice Payments Only)` : `${methodLabel} Contributions`}
          </h3>
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${methodColors.chip}`}>
            Total: ₹{formatNumber(totalContributions, 2)}
          </span>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-200">
              <p className="text-sm font-semibold text-gray-800">Invoice Payments</p>
            </div>
            {invoicePayments.length === 0 ? (
              <p className="px-3 py-4 text-sm text-gray-500">No invoice payments found for {methodLabel} in this date range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Invoice #</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Party / Customer</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Amount</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoicePayments.map((row) => renderRow(row, 'invoice'))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {!invoiceOnly && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-200">
                <p className="text-sm font-semibold text-gray-800">Manual Payments</p>
              </div>
              {manualPayments.length === 0 ? (
                <p className="px-3 py-4 text-sm text-gray-500">No manual payments found for {methodLabel} in this date range.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Invoice #</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Party / Customer</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Amount</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manualPayments.map((row) => renderRow(row, 'manual'))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderManualPaymentsBlock = () => {
    const cashManual: ContributionRow[] = contributionData?.cash?.manual_payments || [];
    const upiManual: ContributionRow[] = contributionData?.upi?.manual_payments || [];
    const cashTotal = cashManual.reduce((sum, row) => sum + (row.amount || 0), 0);
    const upiTotal = upiManual.reduce((sum, row) => sum + (row.amount || 0), 0);
    const hasAny = cashManual.length > 0 || upiManual.length > 0;

    const renderRow = (row: ContributionRow) => {
      const displayParty = row.party_name || row.customer_name || 'Walk-in Customer';
      return (
        <tr key={`manual-${row.id}`} className="border-b border-gray-100 last:border-0">
          <td className="px-3 py-2 text-sm text-gray-800 font-medium">{row.invoice_number || '-'}</td>
          <td className="px-3 py-2 text-sm text-gray-700">{displayParty}</td>
          <td className="px-3 py-2 text-sm text-gray-900 font-semibold text-right">₹{formatNumber(row.amount || 0, 2)}</td>
          <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{formatContributionDate(row.payment_date)}</td>
        </tr>
      );
    };

    return (
      <div className="bg-white rounded-xl border border-amber-200 bg-amber-50/50 p-4 sm:p-5">
        <div className="mb-4">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Manual Payments</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Payments recorded via Ledger (Payments page). Manual payments (cash and UPI/online) are <strong>not</strong> included in Total Cash or Total
            Online. Cash from manual payments is included only in <strong>Total Inhand</strong>; all manual payments are listed here for reference.
          </p>
        </div>
        {!hasAny ? (
          <p className="text-sm text-gray-500">No manual payments in this date range.</p>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg border border-green-200 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800">Cash</p>
                <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-1 rounded-full">
                  ₹{formatNumber(cashTotal, 2)}
                </span>
              </div>
              {cashManual.length === 0 ? (
                <p className="px-3 py-4 text-sm text-gray-500">No cash manual payments.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Ref</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Party / Customer</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Amount</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                      </tr>
                    </thead>
                    <tbody>{cashManual.map((row) => renderRow(row))}</tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="bg-white rounded-lg border border-blue-200 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800">UPI / Online</p>
                <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-1 rounded-full">
                  ₹{formatNumber(upiTotal, 2)}
                </span>
              </div>
              {upiManual.length === 0 ? (
                <p className="px-3 py-4 text-sm text-gray-500">No UPI manual payments.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Ref</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Party / Customer</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Amount</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                      </tr>
                    </thead>
                    <tbody>{upiManual.map((row) => renderRow(row))}</tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const KpiCard = ({
    title,
    value,
    icon: Icon,
    bgColor,
    iconColor,
    borderColor,
    change,
    yesterdayValue,
    formatValue = (val: number | string) => `₹${formatNumber(val, 0)}`,
    suffix = ''
  }: {
    title: string;
    value: number | string;
    icon: LucideIcon;
    bgColor: string;
    iconColor: string;
    borderColor: string;
    change?: number;
    yesterdayValue?: number;
    formatValue?: (val: number | string) => string;
    suffix?: string;
  }) => {
    const displayValue = typeof value === 'number' ? formatValue(value) : value;
    const isPositive = change !== undefined && change >= 0;

    return (
      <div className={`${bgColor} rounded-xl shadow-sm border ${borderColor} p-4 sm:p-5 transition-transform hover:shadow-md`}>
        <div className="flex items-start justify-between mb-2">
          <div className={`p-2 rounded-lg ${iconColor.replace('text-', 'bg-').replace('-600', '-100')}`}>
            <Icon className={`h-5 w-5 sm:h-6 sm:w-6 ${iconColor}`} />
          </div>
          {change !== undefined && (
            <div className={`flex items-center gap-1 text-xs font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
              {isPositive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
              {Math.abs(change) < 0.1 ? '0' : formatNumber(Math.abs(change), 1)}%
            </div>
          )}
        </div>
        <p className="text-xs sm:text-sm text-gray-600 font-medium mb-1">{title}</p>
        <p className="text-lg sm:text-2xl font-bold text-gray-900 leading-tight">
          {displayValue}{suffix}
        </p>
        {yesterdayValue !== undefined && (
          <p className="text-xs text-gray-500 mt-1">
            Yesterday: {formatValue(yesterdayValue)}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      {/* Header with Date Range */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 px-4 py-4 sm:px-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDateDDMMYYYY(new Date())}
            </p>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <DateRangeSelector
              preset={datePreset}
              value={dateRange}
              onChange={({ preset, range }) => {
                setDidAutoAlignToLatestDate(true);
                setDatePreset(preset);
                setDateRange(range);
              }}
              className="w-full sm:w-[360px]"
            />
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 pt-6 space-y-6">
        {kpisLoading ? (
          <div className="text-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-gray-400" />
            <p className="text-gray-500">Loading dashboard data...</p>
          </div>
        ) : (
          <>
            {/* KPI Grid - 13 Boxes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* 1. Total Cash */}
              <KpiCard
                title="Total Cash"
                value={kpis.total_cash || 0}
                icon={DollarSign}
                bgColor="bg-gradient-to-br from-green-50 to-green-100"
                iconColor="text-green-600"
                borderColor="border-green-200"
                change={cashChange}
                yesterdayValue={comparisons.total_cash}
              />

              {/* 2. Total Online */}
              <KpiCard
                title="Total Online"
                value={kpis.total_online || 0}
                icon={CreditCard}
                bgColor="bg-gradient-to-br from-blue-50 to-blue-100"
                iconColor="text-blue-600"
                borderColor="border-blue-200"
                change={onlineChange}
                yesterdayValue={comparisons.total_online}
              />

              {/* 3. Total Expenses */}
              <KpiCard
                title="Total Expenses"
                value={kpis.total_expenses || 0}
                icon={TrendingUp}
                bgColor="bg-gradient-to-br from-red-50 to-red-100"
                iconColor="text-red-600"
                borderColor="border-red-200"
              />

              {/* 4. Total Inhand */}
              <KpiCard
                title="Total Inhand"
                value={kpis.total_inhand || 0}
                icon={Wallet}
                bgColor="bg-gradient-to-br from-purple-50 to-purple-100"
                iconColor="text-purple-600"
                borderColor="border-purple-200"
                change={inhandChange}
                yesterdayValue={comparisons.total_inhand}
              />

              {/* Repair invoice/payment clarity cards */}
              <KpiCard
                title={`Repair Invoices (Cash) (${kpis.repair_invoice_cash_count || 0})`}
                value={kpis.repair_invoice_cash_total || 0}
                icon={Wrench}
                bgColor="bg-gradient-to-br from-lime-50 to-lime-100"
                iconColor="text-lime-700"
                borderColor="border-lime-200"
              />
              <KpiCard
                title={`Repair Invoices (UPI) (${kpis.repair_invoice_upi_count || 0})`}
                value={kpis.repair_invoice_upi_total || 0}
                icon={Wrench}
                bgColor="bg-gradient-to-br from-sky-50 to-sky-100"
                iconColor="text-sky-700"
                borderColor="border-sky-200"
              />
              <KpiCard
                title={`Repair Invoices (Mixed) (${kpis.repair_invoice_mixed_count || 0})`}
                value={kpis.repair_invoice_mixed_total || 0}
                icon={Wrench}
                bgColor="bg-gradient-to-br from-violet-50 to-violet-100"
                iconColor="text-violet-700"
                borderColor="border-violet-200"
              />
              <KpiCard
                title={`Repair Payments (Cash) (${kpis.repair_payment_cash_count || 0})`}
                value={kpis.repair_payment_cash_total || 0}
                icon={DollarSign}
                bgColor="bg-gradient-to-br from-emerald-50 to-emerald-100"
                iconColor="text-emerald-700"
                borderColor="border-emerald-200"
              />
              <KpiCard
                title={`Repair Payments (UPI) (${kpis.repair_payment_upi_count || 0})`}
                value={kpis.repair_payment_upi_total || 0}
                icon={CreditCard}
                bgColor="bg-gradient-to-br from-cyan-50 to-cyan-100"
                iconColor="text-cyan-700"
                borderColor="border-cyan-200"
              />
              <KpiCard
                title={`Repair Payments (Mixed) (${kpis.repair_payment_mixed_count || 0})`}
                value={kpis.repair_payment_mixed_total || 0}
                icon={CreditCard}
                bgColor="bg-gradient-to-br from-amber-50 to-amber-100"
                iconColor="text-amber-700"
                borderColor="border-amber-200"
              />

              {/* 5. Repairing Profit */}
              <KpiCard
                title="Repairing Profit"
                value={kpis.repairing_profit || 0}
                icon={Wrench}
                bgColor="bg-gradient-to-br from-orange-50 to-orange-100"
                iconColor="text-orange-600"
                borderColor="border-orange-200"
              />

              {/* 6. Counter Profit */}
              <KpiCard
                title="Counter Profit"
                value={kpis.counter_profit || 0}
                icon={Store}
                bgColor="bg-gradient-to-br from-indigo-50 to-indigo-100"
                iconColor="text-indigo-600"
                borderColor="border-indigo-200"
              />

              {/* 7. Pending Profit */}
              <KpiCard
                title="Pending Profit"
                value={kpis.pending_profit || 0}
                icon={Clock}
                bgColor="bg-gradient-to-br from-yellow-50 to-yellow-100"
                iconColor="text-yellow-600"
                borderColor="border-yellow-200"
              />

              {/* 8. Overall Profit */}
              <KpiCard
                title="Overall Profit"
                value={kpis.overall_profit || 0}
                icon={BarChart3}
                bgColor="bg-gradient-to-br from-emerald-50 to-emerald-100"
                iconColor="text-emerald-600"
                borderColor="border-emerald-200"
                change={profitChange}
                yesterdayValue={comparisons.overall_profit}
              />

              {/* 9. Monthly Profit */}
              <KpiCard
                title={`Monthly Profit (${getCustomMonthPeriod()})`}
                value={kpis.monthly_profit || 0}
                icon={Calendar}
                bgColor="bg-gradient-to-br from-cyan-50 to-cyan-100"
                iconColor="text-cyan-600"
                borderColor="border-cyan-200"
              />

              {/* 10. Total Stock */}
              <KpiCard
                title="Total Stock"
                value={kpis.total_stock || 0}
                icon={Box}
                bgColor="bg-gradient-to-br from-slate-50 to-slate-100"
                iconColor="text-slate-600"
                borderColor="border-slate-200"
                formatValue={(val) => String(val)}
                suffix=" units"
              />

              {/* 11. Total Stock Value */}
              <KpiCard
                title="Total Stock Value"
                value={kpis.total_stock_value || 0}
                icon={Package}
                bgColor="bg-gradient-to-br from-teal-50 to-teal-100"
                iconColor="text-teal-600"
                borderColor="border-teal-200"
              />

              {/* 12. Pending Invoices */}
              <KpiCard
                title={`Pending Invoice Amount (${kpis.pending_invoices_count || 0})`}
                value={kpis.pending_invoices_total || 0}
                icon={FileText}
                bgColor="bg-gradient-to-br from-amber-50 to-amber-100"
                iconColor="text-amber-600"
                borderColor="border-amber-200"
              />

              {/* 13. Total Replacement */}
              <KpiCard
                title="Total Replacement"
                value={kpis.total_replacement || 0}
                icon={RefreshCw}
                bgColor="bg-gradient-to-br from-pink-50 to-pink-100"
                iconColor="text-pink-600"
                borderColor="border-pink-200"
              />

              {/* 14. Today's Loss (Manish Traders Loss Loss Loss) */}
              <KpiCard
                title={`Selected Day Loss (${formatDateDDMMYYYY(new Date(dateTo))})`}
                value={kpis.todays_loss || 0}
                icon={TrendingDown}
                bgColor="bg-gradient-to-br from-rose-50 to-rose-100"
                iconColor="text-rose-600"
                borderColor="border-rose-200"
              />

              {/* 15. Monthly Loss (Manish Traders Loss) */}
              <KpiCard
                title={`Monthly Loss (${getCustomMonthPeriod()})`}
                value={kpis.monthly_loss || 0}
                icon={TrendingDown}
                bgColor="bg-gradient-to-br from-red-50 to-red-100"
                iconColor="text-red-600"
                borderColor="border-red-200"
              />

              {/* 16. Total Loss (Manish Traders Loss) */}
              <KpiCard
                title="Total Loss"
                value={kpis.total_loss || 0}
                icon={TrendingDown}
                bgColor="bg-gradient-to-br from-orange-50 to-orange-100"
                iconColor="text-orange-600"
                borderColor="border-orange-200"
              />
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
              <button
                onClick={() => navigate('/pos')}
                className="bg-white border-2 border-blue-200 rounded-xl p-4 sm:p-5 hover:bg-blue-50 hover:border-blue-300 active:scale-95 transition-all touch-manipulation"
              >
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 bg-blue-100 rounded-lg flex items-center justify-center mb-3">
                    <ShoppingBag className="h-6 w-6 sm:h-7 sm:w-7 text-blue-600" />
                  </div>
                  <p className="text-sm sm:text-base font-semibold text-gray-900">POS</p>
                  <p className="text-xs text-gray-500 mt-1">New Sale</p>
                </div>
              </button>

              <button
                onClick={() => navigate('/products')}
                className="bg-white border-2 border-green-200 rounded-xl p-4 sm:p-5 hover:bg-green-50 hover:border-green-300 active:scale-95 transition-all touch-manipulation"
              >
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 bg-green-100 rounded-lg flex items-center justify-center mb-3">
                    <Package className="h-6 w-6 sm:h-7 sm:w-7 text-green-600" />
                  </div>
                  <p className="text-sm sm:text-base font-semibold text-gray-900">Products</p>
                  <p className="text-xs text-gray-500 mt-1">Manage</p>
                </div>
              </button>

              <button
                onClick={() => navigate('/invoices')}
                className="bg-white border-2 border-purple-200 rounded-xl p-4 sm:p-5 hover:bg-purple-50 hover:border-purple-300 active:scale-95 transition-all touch-manipulation sm:col-span-1 col-span-2"
              >
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 bg-purple-100 rounded-lg flex items-center justify-center mb-3">
                    <FileText className="h-6 w-6 sm:h-7 sm:w-7 text-purple-600" />
                  </div>
                  <p className="text-sm sm:text-base font-semibold text-gray-900">Invoices</p>
                  <p className="text-xs text-gray-500 mt-1">View All</p>
                </div>
              </button>
            </div>

            {/* Manual Payments: separate block; only cash from here goes into Total Cash */}
            {renderManualPaymentsBlock()}

            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Cash / UPI Contribution Details (Invoice Payments)</h2>
                  <p className="text-sm text-gray-500">Invoice payments by mode. Manual payments are shown in the Manual Payments block above.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setContributionViewMode('tab')}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                      contributionViewMode === 'tab'
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    Toggle
                  </button>
                  <button
                    onClick={() => setContributionViewMode('both')}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                      contributionViewMode === 'both'
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    Both
                  </button>
                </div>
              </div>

              {contributionViewMode === 'tab' ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedContributionMethod('cash')}
                      className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                        selectedContributionMethod === 'cash'
                          ? 'bg-green-100 border-green-300 text-green-800'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      Cash
                    </button>
                    <button
                      onClick={() => setSelectedContributionMethod('upi')}
                      className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                        selectedContributionMethod === 'upi'
                          ? 'bg-blue-100 border-blue-300 text-blue-800'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      UPI
                    </button>
                  </div>
                  {renderContributionTable(selectedContributionMethod, true)}
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {renderContributionTable('cash', true)}
                  {renderContributionTable('upi', true)}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
              <div className="mb-4">
                <h2 className="text-lg sm:text-xl font-semibold text-gray-900">All KPI Debug Rows</h2>
                <p className="text-sm text-gray-500">Each KPI block shows row-level contributions with total on top-right.</p>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {kpiDebugOrder.map((kpiKey) => renderKpiDebugBlock(kpiKey))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
              <div className="mb-4">
                <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Store-wise KPI Grouping</h2>
                <p className="text-sm text-gray-500">See each KPI contribution split by store.</p>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {kpiDebugOrder.map((kpiKey) => renderKpiStoreGroupingBlock(kpiKey))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
