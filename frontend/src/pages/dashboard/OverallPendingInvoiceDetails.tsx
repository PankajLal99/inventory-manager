import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, ClipboardList, RefreshCw } from 'lucide-react';
import { reportsApi } from '../../lib/api';
import { formatDateDDMMYYYY, formatNumber } from '../../lib/utils';

type PendingInvoiceRow = {
  id: number;
  invoice_number: string;
  status: string;
  invoice_type: string;
  created_at: string | null;
  customer_name: string;
  total: number;
  paid_amount: number;
  purchase_cost: number;
};

type PendingStoreGroup = {
  store_id: number;
  store_name: string;
  shop_type: string;
  invoice_count: number;
  total_amount: number;
  paid_amount: number;
  purchase_cost_total: number;
  invoices: PendingInvoiceRow[];
};

export default function OverallPendingInvoiceDetails() {
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['overall-pending-invoice-details'],
    queryFn: async () => {
      const response = await reportsApi.overallPendingInvoiceDetails();
      return response.data as {
        summary: {
          invoice_count: number;
          store_count: number;
          total_amount: number;
          paid_amount: number;
          purchase_cost_total: number;
        };
        stores: PendingStoreGroup[];
      };
    },
  });

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 px-4 py-4 sm:px-6">
        <div>
          <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">Overall Pending Invoice Details</h1>
          <p className="text-sm text-gray-500 mt-1">
            All-time non-repair pending invoices (same base as dashboard KPI).
          </p>
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
            Could not load overall pending details.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
              <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                <p className="text-orange-800">Invoices</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{data?.summary.invoice_count ?? 0}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-slate-700">Stores</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{data?.summary.store_count ?? 0}</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-amber-800">Invoice total</p>
                <p className="text-xl font-bold text-gray-900 mt-1">₹{formatNumber(Number(data?.summary.total_amount ?? 0), 2)}</p>
              </div>
              <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                <p className="text-green-800">Paid amount</p>
                <p className="text-xl font-bold text-gray-900 mt-1">₹{formatNumber(Number(data?.summary.paid_amount ?? 0), 2)}</p>
              </div>
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
                <p className="text-violet-800">Purchase cost</p>
                <p className="text-xl font-bold text-gray-900 mt-1">₹{formatNumber(Number(data?.summary.purchase_cost_total ?? 0), 2)}</p>
              </div>
            </div>

            {(data?.stores ?? []).length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-sm text-gray-500">
                No pending invoices found.
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
                      <p>Total ₹{formatNumber(store.total_amount, 2)} · Paid ₹{formatNumber(store.paid_amount, 2)}</p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/80">
                          <th className="px-4 py-2.5 font-medium text-gray-700">Invoice</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700">Date</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700">Customer</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700">Status</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700 text-right">Total</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700 text-right">Paid</th>
                          <th className="px-4 py-2.5 font-medium text-gray-700 text-right">Purchase Cost</th>
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
                            <td className="px-4 py-2.5">
                              <span className="inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
                                {inv.status || inv.invoice_type}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">₹{formatNumber(inv.total, 2)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">₹{formatNumber(inv.paid_amount, 2)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">₹{formatNumber(inv.purchase_cost, 2)}</td>
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
          <ClipboardList className="h-4 w-4" />
          Values match dashboard pending KPI basis.
        </div>
      </div>
    </div>
  );
}
