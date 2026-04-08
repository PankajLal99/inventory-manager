import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Calendar, ChevronDown, ChevronRight, Coins, CreditCard, Receipt, RefreshCw, Wallet } from 'lucide-react';
import { reportsApi } from '../../lib/api';
import { formatDateDDMMYYYY, formatNumber, toLocalDateString } from '../../lib/utils';

type InvoiceRow = {
  id: number;
  invoice_number: string;
  invoice_type: string;
  status: string;
  created_at: string | null;
  customer_name: string;
  total: number;
  paid_amount: number;
  profit: number;
  cash_amount: number;
  online_amount: number;
  source: 'counter' | 'repair';
};

type StoreGroup = {
  store_id: number;
  store_name: string;
  shop_type: string;
  invoice_count: number;
  profit_total: number;
  cash_total: number;
  online_total: number;
  invoices: InvoiceRow[];
};

const toMonthInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function currentBillingMonthLabel(): string {
  const now = new Date();
  if (now.getDate() >= 11) return toMonthInput(now);
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return toMonthInput(prev);
}

function formatBillingMonthLabel(yyyyMm: string): string {
  // yyyyMm expected like "2026-04"
  const d = new Date(`${yyyyMm}-01T12:00:00`);
  if (Number.isNaN(d.getTime())) return yyyyMm;
  return d.toLocaleString('en-IN', { month: 'short', year: 'numeric' });
}

function isDateWithinRange(date: string, from?: string, to?: string): boolean {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function dateDiffInDaysInclusive(from: string, to: string): number {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / ONE_DAY_MS) + 1;
}

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateIso;
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function OverallProfitBillingDetails() {
  const [billingMonth, setBillingMonth] = useState(currentBillingMonthLabel);
  const [collapsedStoreIds, setCollapsedStoreIds] = useState<Set<number>>(() => new Set());

  const params = useMemo(
    () => ({
      billing_month_from: billingMonth,
      billing_month_to: billingMonth,
    }),
    [billingMonth],
  );

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['overall-profit-billing-details', billingMonth],
    queryFn: async () => {
      const response = await reportsApi.overallProfitBillingPeriodDetails(params);
      return response.data as {
        billing_window: { from: string; to: string };
        summary: {
          counter_profit: number;
          repair_profit: number;
          overall_profit: number;
          cash_total: number;
          online_total: number;
          expenses_total: number;
          invoice_count: number;
          store_count: number;
        };
        stores: StoreGroup[];
      };
    },
  });

  useEffect(() => {
    // Reset to expanded when the dataset changes (new billing month).
    setCollapsedStoreIds(new Set());
  }, [billingMonth]);

  const dayWiseProfitRows = useMemo(() => {
    const stores = data?.stores ?? [];
    const rangeFrom = data?.billing_window?.from;
    const rangeTo = data?.billing_window?.to;
    const byDate = new Map<string, { date: string; repairProfit: number; retailProfit: number; isHoliday: boolean; holidayLabel: string | null }>();
    stores.forEach((store) => {
      (store.invoices ?? []).forEach((inv) => {
        if (!inv.created_at) return;
        const date = inv.created_at.slice(0, 10);
        if (!isDateWithinRange(date, rangeFrom, rangeTo)) return;
        const existing = byDate.get(date) ?? { date, repairProfit: 0, retailProfit: 0, isHoliday: false, holidayLabel: null };
        if (inv.source === 'repair') {
          existing.repairProfit += Number(inv.profit || 0);
        } else {
          existing.retailProfit += Number(inv.profit || 0);
        }
        byDate.set(date, existing);
      });
    });

    // Ensure every day in the billing window is shown (including no-activity days).
    if (rangeFrom && rangeTo) {
      const totalDays = dateDiffInDaysInclusive(rangeFrom, rangeTo);
      const todayIso = addDaysIso(toLocalDateString(new Date()), 0);
      for (let i = 0; i < totalDays; i += 1) {
        const dayIso = addDaysIso(rangeFrom, i);
        if (byDate.has(dayIso)) continue;
        const day = new Date(`${dayIso}T12:00:00`);
        const isSunday = day.getDay() === 0;
        const isFuture = dayIso > todayIso;
        byDate.set(dayIso, {
          date: dayIso,
          repairProfit: 0,
          retailProfit: 0,
          // Mark only past/today zero-activity days as holiday.
          // Future dates in the current billing window are not holidays yet.
          isHoliday: !isFuture,
          holidayLabel: !isFuture ? (isSunday ? 'Sunday' : 'Holiday') : null,
        });
      }
    }

    // Keep day-wise table in chronological order by date.
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [data?.stores, data?.billing_window?.from, data?.billing_window?.to]);

  const dayWiseProfitTotals = useMemo(
    () =>
      dayWiseProfitRows.reduce(
        (acc, row) => {
          acc.repairProfit += row.repairProfit;
          acc.retailProfit += row.retailProfit;
          return acc;
        },
        { repairProfit: 0, retailProfit: 0 },
      ),
    [dayWiseProfitRows],
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </Link>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">
              Overall Profit Details · {formatBillingMonthLabel(billingMonth)} (11th to 10th)
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Invoices grouped by shop used in monthly overall profit KPI.
            </p>
          </div>
          <div className="w-full sm:w-auto min-w-[220px]">
            <label className="text-xs text-gray-600">
              Billing month
              <input
                type="month"
                value={billingMonth}
                onChange={(e) => setBillingMonth(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm"
              />
            </label>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 pt-6 space-y-4">
        {isLoading || isFetching ? (
          <div className="text-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-gray-400" />
            <p className="text-gray-500">Loading details…</p>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Could not load overall profit details.
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <h2 className="text-sm font-semibold text-gray-900">Day-wise Profit (Repair vs Retail)</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/80">
                      <th className="px-4 py-2.5 font-medium text-gray-700">Date</th>
                      <th className="px-4 py-2.5 font-medium text-gray-700 text-right">Repair Profit</th>
                      <th className="px-4 py-2.5 font-medium text-gray-700 text-right">Retail Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {dayWiseProfitRows.length === 0 ? (
                      <tr>
                        <td className="px-4 py-3 text-gray-500" colSpan={3}>No day-wise profit data available.</td>
                      </tr>
                    ) : (
                      dayWiseProfitRows.map((row) => (
                        <tr key={row.date} className="hover:bg-gray-50/80">
                          <td className="px-4 py-2.5 text-gray-700">
                            <div className="flex items-center gap-2">
                              <span>{formatDateDDMMYYYY(row.date)}</span>
                              {row.isHoliday ? (
                                <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                                  {row.holidayLabel || 'Holiday'}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">₹{formatNumber(row.repairProfit, 2)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">₹{formatNumber(row.retailProfit, 2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {dayWiseProfitRows.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                        <td className="px-4 py-2.5 text-gray-900">Total</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                          ₹{formatNumber(dayWiseProfitTotals.repairProfit, 2)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                          ₹{formatNumber(dayWiseProfitTotals.retailProfit, 2)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-sm text-gray-600 flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {data?.billing_window
                  ? `${formatDateDDMMYYYY(data.billing_window.from)} – ${formatDateDDMMYYYY(data.billing_window.to)}`
                  : '—'}
              </p>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3 text-sm">
                <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-emerald-800">Overall profit</p>
                    <Wallet className="h-4 w-4 text-emerald-800" />
                  </div>
                  <p className="font-bold text-xl text-gray-900">₹{formatNumber(Number(data?.summary.overall_profit ?? 0), 2)}</p>
                </div>
                <div className="rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50 to-teal-100 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-teal-800">Counter profit</p>
                    <Coins className="h-4 w-4 text-teal-800" />
                  </div>
                  <p className="font-bold text-xl text-gray-900">₹{formatNumber(Number(data?.summary.counter_profit ?? 0), 2)}</p>
                </div>
                <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-violet-100 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-violet-800">Repair profit</p>
                    <Coins className="h-4 w-4 text-violet-800" />
                  </div>
                  <p className="font-bold text-xl text-gray-900">₹{formatNumber(Number(data?.summary.repair_profit ?? 0), 2)}</p>
                </div>
                <div className="rounded-xl border border-green-200 bg-gradient-to-br from-green-50 to-green-100 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-green-800">Cash</p>
                    <Wallet className="h-4 w-4 text-green-800" />
                  </div>
                  <p className="font-bold text-xl text-gray-900">₹{formatNumber(Number(data?.summary.cash_total ?? 0), 2)}</p>
                </div>
                <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-blue-800">Online</p>
                    <CreditCard className="h-4 w-4 text-blue-800" />
                  </div>
                  <p className="font-bold text-xl text-gray-900">₹{formatNumber(Number(data?.summary.online_total ?? 0), 2)}</p>
                </div>
                <div className="rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50 to-rose-100 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-rose-800">Expenses</p>
                    <Receipt className="h-4 w-4 text-rose-800" />
                  </div>
                  <p className="font-bold text-xl text-gray-900">₹{formatNumber(Number(data?.summary.expenses_total ?? 0), 2)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-slate-700">Stores</p>
                    <span className="text-slate-700 text-base font-bold">#</span>
                  </div>
                  <p className="font-bold text-xl text-gray-900">{data?.summary.store_count ?? 0}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-gray-700">Invoices</p>
                    <span className="text-gray-700 text-base font-bold">#</span>
                  </div>
                  <p className="font-bold text-xl text-gray-900">{data?.summary.invoice_count ?? 0}</p>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                Profit shown above matches dashboard monthly profit logic and is not reduced by expenses.
              </p>
            </div>

            {(data?.stores ?? []).length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-sm text-gray-500">
                No invoices found in this billing month range.
              </div>
            ) : (
              (data?.stores ?? []).map((store) => (
                (() => {
                  const isCollapsed = collapsedStoreIds.has(store.store_id);
                  const toggle = () => {
                    setCollapsedStoreIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(store.store_id)) next.delete(store.store_id);
                      else next.add(store.store_id);
                      return next;
                    });
                  };
                  return (
                <div key={store.store_id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <button
                        type="button"
                        onClick={toggle}
                        className="inline-flex items-center gap-1.5 font-semibold text-gray-900 hover:text-gray-950"
                        aria-expanded={!isCollapsed}
                        aria-controls={`store-${store.store_id}-invoices`}
                        title={isCollapsed ? 'Expand' : 'Collapse'}
                      >
                        {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        <span>{store.store_name}</span>
                      </button>
                      <p className="text-xs text-gray-500 capitalize">{store.shop_type || 'other'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">{store.invoice_count} invoice(s)</p>
                      <p className="text-xs text-gray-500">
                        Cash ₹{formatNumber(store.cash_total, 2)} · Online ₹{formatNumber(store.online_total, 2)}
                      </p>
                      <p className="text-sm font-semibold text-gray-900">Profit: ₹{formatNumber(store.profit_total, 2)}</p>
                    </div>
                  </div>
                  {isCollapsed ? null : (
                  <div id={`store-${store.store_id}-invoices`} className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/80">
                          <th className="px-4 py-2.5 font-medium text-gray-700">Invoice</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700">Date</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700">Customer</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700">Source</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700 text-right">Cash</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700 text-right">Online</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700 text-right">Total</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700 text-right">Profit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {store.invoices.map((inv) => (
                          <tr key={inv.id} className="hover:bg-gray-50/80">
                            <td className="px-4 py-2.5">
                              <Link to={`/invoices/${inv.id}`} className="font-medium text-blue-600 hover:text-blue-700">
                                {inv.invoice_number}
                              </Link>
                            </td>
                            <td className="px-4 py-2.5 text-gray-700">
                              {inv.created_at ? formatDateDDMMYYYY(inv.created_at.slice(0, 10)) : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-gray-700">{inv.customer_name || 'Walk-in'}</td>
                            <td className="px-4 py-2.5 text-gray-700 capitalize">{inv.source}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">₹{formatNumber(inv.cash_amount, 2)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">₹{formatNumber(inv.online_amount, 2)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">₹{formatNumber(inv.total, 2)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">₹{formatNumber(inv.profit, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  )}
                </div>
                  );
                })()
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
