import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Calendar } from 'lucide-react';
import { formatNumber } from '../../lib/utils';

type BreakdownRow = {
  label: string;
  amount: number;
};

type MetricDetailsState = {
  title: string;
  subtitle?: string;
  totalFormatted: string;
  breakdownRows: BreakdownRow[];
  periodLabel?: string;
  valueType?: 'currency' | 'number';
};

export default function DashboardMetricDetails() {
  const location = useLocation();
  const state = (location.state ?? null) as MetricDetailsState | null;

  if (!state || !state.title || !Array.isArray(state.breakdownRows)) {
    return (
      <div className="min-h-screen bg-gray-50 pb-8">
        <div className="bg-white border-b border-gray-200 sticky top-0 z-10 px-4 py-4 sm:px-6">
          <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">Metric details</h1>
        </div>
        <div className="px-4 sm:px-6 pt-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Details are only available when opened from a dashboard card arrow.
          </div>
        </div>
      </div>
    );
  }

  const isCurrency = state.valueType !== 'number';
  const totalFromRows = state.breakdownRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 px-4 py-4 sm:px-6">
        <div>
          <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">{state.title}</h1>
          {state.subtitle ? <p className="text-sm text-gray-500 mt-1">{state.subtitle}</p> : null}
          {state.periodLabel ? (
            <p className="text-xs text-gray-500 mt-2 inline-flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {state.periodLabel}
            </p>
          ) : null}
        </div>
      </div>

      <div className="px-4 sm:px-6 pt-6 space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500">Card total</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{state.totalFormatted}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <p className="text-sm font-medium text-gray-700">Contributing rows</p>
          </div>
          {state.breakdownRows.length === 0 ? (
            <p className="text-sm text-gray-500 p-4">No contributing rows.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/80">
                    <th className="px-4 py-2.5 font-medium text-gray-700">Row</th>
                    <th className="px-4 py-2.5 font-medium text-gray-700 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {state.breakdownRows.map((row) => (
                    <tr key={row.label} className="hover:bg-gray-50/80">
                      <td className="px-4 py-2.5 text-gray-700">{row.label}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                        {isCurrency ? `₹${formatNumber(row.amount, 2)}` : formatNumber(row.amount, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                    <td className="px-4 py-2.5 text-gray-900">Total of listed rows</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                      {isCurrency ? `₹${formatNumber(totalFromRows, 2)}` : formatNumber(totalFromRows, 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
