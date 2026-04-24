import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { reportsApi } from '../../lib/api';
import { formatNumber } from '../../lib/utils';

interface Props {
  metric: string;
  metricLabel: string;
  dateFrom: string;
  dateTo: string;
  storeId?: number;
  onClose: () => void;
}

const METRIC_DESCRIPTIONS: Record<string, string> = {
  total_sales: 'Invoices contributing to Total Sales in this period',
  total_invoices: 'All invoices in this period',
  items_sold: 'Invoices with items sold in this period',
  avg_order_value: 'Invoices ordered by value (highest first)',
};

export default function KpiDrillDownModal({ metric, metricLabel, dateFrom, dateTo, storeId, onClose }: Props) {
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data, isLoading } = useQuery({
    queryKey: ['kpi-detail', metric, dateFrom, dateTo, storeId, page],
    queryFn: async () => {
      const res = await reportsApi.kpiDetail({
        metric,
        date_from: dateFrom,
        date_to: dateTo,
        store: storeId,
        page,
        page_size: pageSize,
      });
      return res.data;
    },
    retry: false,
  });

  const invoices = data?.invoices || [];
  const totalCount = data?.total_count || 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      paid: 'bg-green-100 text-green-700',
      partial: 'bg-yellow-100 text-yellow-700',
      credit: 'bg-blue-100 text-blue-700',
      void: 'bg-red-100 text-red-700',
      draft: 'bg-gray-100 text-gray-600',
    };
    return map[s] || 'bg-gray-100 text-gray-600';
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{metricLabel} — Drill Down</h2>
            <p className="text-sm text-gray-500 mt-0.5">{METRIC_DESCRIPTIONS[metric] || ''}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-600">{totalCount} invoice{totalCount !== 1 ? 's' : ''}</span>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-gray-500">No invoices found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase text-xs">Invoice #</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase text-xs">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase text-xs">Customer</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase text-xs">Store</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase text-xs">Type</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase text-xs">Status</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase text-xs">Subtotal</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase text-xs">Discount</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase text-xs">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map((inv: any) => (
                  <tr key={inv.id} className="hover:bg-blue-50/40 transition-colors">
                    <td className="px-4 py-2.5">
                      <a
                        href={`/invoices/${inv.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline font-medium flex items-center gap-1"
                      >
                        {inv.invoice_number}
                        <ExternalLink className="h-3 w-3 opacity-60" />
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {new Date(inv.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                    </td>
                    <td className="px-4 py-2.5 text-gray-800">{inv.customer_name}</td>
                    <td className="px-4 py-2.5 text-gray-600">{inv.store_name}</td>
                    <td className="px-4 py-2.5 capitalize text-gray-600">{inv.invoice_type}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusBadge(inv.status)}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700">₹{formatNumber(inv.subtotal)}</td>
                    <td className="px-4 py-2.5 text-right text-red-600">
                      {inv.discount_amount > 0 ? `-₹${formatNumber(inv.discount_amount)}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">₹{formatNumber(inv.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200">
            <span className="text-sm text-gray-600">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
