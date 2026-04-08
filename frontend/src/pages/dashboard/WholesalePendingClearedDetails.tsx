import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Calendar, RefreshCw, TrendingUp } from 'lucide-react';
import { reportsApi } from '../../lib/api';
import { formatDateDDMMYYYY, formatNumber } from '../../lib/utils';
import { usePersistedListDateRange } from '../../lib/listDateRangePersistence';
import DateRangeSelector from '../../components/ui/DateRangeSelector';

type ClearedInvoiceRow = {
  id: number;
  invoice_number: string;
  created_at: string | null;
  pending_cleared_at: string | null;
  customer_name: string;
  status: string;
  selling_total: number;
  purchase_cost: number;
  profit: number;
};

type ClearedStoreGroup = {
  store_id: number;
  store_name: string;
  shop_type: string;
  invoice_count: number;
  selling_total: number;
  purchase_cost_total: number;
  profit_total: number;
  invoices: ClearedInvoiceRow[];
};

export default function WholesalePendingClearedDetails() {
  const { datePreset, dateFrom, dateTo, setListDateRange } = usePersistedListDateRange();
  const dateRange = { startDate: dateFrom, endDate: dateTo };

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['wholesale-pending-cleared-details', dateFrom, dateTo],
    queryFn: async () => {
      const response = await reportsApi.wholesalePendingClearedDetails({
        date_from: dateFrom,
        date_to: dateTo,
      });
      return response.data as {
        period: { from: string; to: string };
        billing_window: { from: string; to: string };
        summary: {
          invoice_count: number;
          store_count: number;
          selling_total: number;
          purchase_cost_total: number;
          profit_total: number;
        };
        stores: ClearedStoreGroup[];
      };
    },
  });

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 px-4 py-4 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </Link>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">Wholesale Pending Cleared Details</h1>
            <p className="text-sm text-gray-500 mt-1">
              Uses billing window containing selected range end date (11th → 10th).
            </p>
          </div>
          <DateRangeSelector
            preset={datePreset}
            value={dateRange}
            onChange={setListDateRange}
            className="w-full sm:w-[360px]"
          />
        </div>
      </div>

      <div className="px-4 sm:px-6 pt-6 space-y-4">
        {isLoading || isFetching ? (
          <div className="text-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-gray-400" />
            <p className="text-gray-500">Loading details...</p>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Could not load wholesale pending-cleared details.
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Billing window:{' '}
              {data?.billing_window
                ? `${formatDateDDMMYYYY(data.billing_window.from)} – ${formatDateDDMMYYYY(data.billing_window.to)}`
                : '—'}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-emerald-800">Invoices</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{data?.summary.invoice_count ?? 0}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-slate-700">Stores</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{data?.summary.store_count ?? 0}</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-amber-800">Selling total</p>
                <p className="text-xl font-bold text-gray-900 mt-1">₹{formatNumber(Number(data?.summary.selling_total ?? 0), 2)}</p>
              </div>
              <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                <p className="text-orange-800">Purchase cost</p>
                <p className="text-xl font-bold text-gray-900 mt-1">₹{formatNumber(Number(data?.summary.purchase_cost_total ?? 0), 2)}</p>
              </div>
              <div className="rounded-xl border border-teal-200 bg-teal-50 p-4">
                <p className="text-teal-800">Profit</p>
                <p className="text-xl font-bold text-gray-900 mt-1">₹{formatNumber(Number(data?.summary.profit_total ?? 0), 2)}</p>
              </div>
            </div>

            {(data?.stores ?? []).length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-sm text-gray-500">
                No wholesale pending clearances found in this billing window.
              </div>
            ) : (
              (data?.stores ?? []).map((store) => (
                <div key={store.store_id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-gray-900">{store.store_name}</p>
                      <p className="text-xs text-gray-500 capitalize">{store.shop_type || 'other'}</p>
                    </div>
                    <div className="text-right text-xs text-gray-600">
                      <p>{store.invoice_count} invoice(s)</p>
                      <p>Selling ₹{formatNumber(store.selling_total, 2)} · Purchase ₹{formatNumber(store.purchase_cost_total, 2)}</p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/80">
                          <th className="px-4 py-2.5 font-medium text-gray-700">Invoice</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700">Created</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700">Cleared At</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700">Customer</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700 text-right">Selling</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700 text-right">Purchase</th>
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
                            <td className="px-4 py-2.5 text-gray-700">
                              {inv.pending_cleared_at ? formatDateDDMMYYYY(inv.pending_cleared_at.slice(0, 10)) : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-gray-700">{inv.customer_name || 'Walk-in'}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">₹{formatNumber(inv.selling_total, 2)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">₹{formatNumber(inv.purchase_cost, 2)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">₹{formatNumber(inv.profit, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
      <div className="px-4 sm:px-6 mt-6">
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-500 flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Values use same wholesale pending-cleared logic as dashboard KPI.
        </div>
      </div>
    </div>
  );
}
