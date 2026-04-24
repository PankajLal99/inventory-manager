import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
} from 'recharts';
import { formatNumber } from '../../lib/utils';

interface StoreMetric {
  store_id: number;
  store_name: string;
  total_sales: number;
  total_invoices: number;
  items_sold: number;
  avg_order_value: number;
}

interface Props {
  stores: StoreMetric[];
}

const STORE_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4'];

export default function StoreComparisonPanel({ stores }: Props) {
  if (!stores || stores.length < 2) return null;

  // Normalize for radar: each metric as % of max across stores
  const metrics: Array<keyof Omit<StoreMetric, 'store_id' | 'store_name'>> = [
    'total_sales', 'total_invoices', 'items_sold', 'avg_order_value',
  ];
  const metricLabels: Record<string, string> = {
    total_sales: 'Revenue',
    total_invoices: 'Orders',
    items_sold: 'Items Sold',
    avg_order_value: 'Avg Order',
  };

  const maxVal: Record<string, number> = {};
  metrics.forEach(m => {
    maxVal[m] = Math.max(...stores.map(s => s[m] || 0)) || 1;
  });

  const radarData = metrics.map(m => {
    const row: Record<string, any> = { metric: metricLabels[m] };
    stores.forEach(s => {
      row[s.store_name] = Math.round(((s[m] || 0) / maxVal[m]) * 100);
    });
    return row;
  });

  // Bar chart data
  const barData = stores.map(s => ({
    name: s.store_name.length > 14 ? s.store_name.slice(0, 12) + '…' : s.store_name,
    Revenue: s.total_sales,
    Orders: s.total_invoices,
  }));

  return (
    <div>
      {/* Summary table */}
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase text-xs">Store</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500 uppercase text-xs">Revenue</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500 uppercase text-xs">Orders</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500 uppercase text-xs">Items Sold</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500 uppercase text-xs">Avg Order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {stores.map((s, i) => (
              <tr key={s.store_id} className="hover:bg-gray-50">
                <td className="px-3 py-2.5 font-medium" style={{ color: STORE_COLORS[i % STORE_COLORS.length] }}>
                  {s.store_name}
                </td>
                <td className="px-3 py-2.5 text-right text-gray-800 font-semibold">₹{formatNumber(s.total_sales)}</td>
                <td className="px-3 py-2.5 text-right text-gray-700">{s.total_invoices}</td>
                <td className="px-3 py-2.5 text-right text-gray-700">{Math.round(s.items_sold)}</td>
                <td className="px-3 py-2.5 text-right text-gray-700">₹{formatNumber(s.avg_order_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Bar */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase mb-3">Revenue by Store</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={barData} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={v => v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : `₹${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11 }} width={52} />
              <Tooltip formatter={(v) => [`₹${formatNumber(v as number | string | undefined | null)}`, '']} />
              <Bar dataKey="Revenue" radius={[4, 4, 0, 0]} maxBarSize={40}>
                {barData.map((_e, i) => <Cell key={i} fill={STORE_COLORS[i % STORE_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Radar */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase mb-3">Relative Comparison (%)</p>
          <ResponsiveContainer width="100%" height={180}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
              {stores.map((s, i) => (
                <Radar
                  key={s.store_id}
                  name={s.store_name}
                  dataKey={s.store_name}
                  stroke={STORE_COLORS[i % STORE_COLORS.length]}
                  fill={STORE_COLORS[i % STORE_COLORS.length]}
                  fillOpacity={0.15}
                />
              ))}
              <Legend />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
