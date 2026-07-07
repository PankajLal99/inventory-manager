import { memo, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { formatNumber } from '../../lib/utils';

interface BarItem { name: string; total_revenue: number; total_quantity: number; order_count: number }

interface Props {
  categories: BarItem[];
  brands: BarItem[];
}

const CAT_COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#ede9fe', '#f5f3ff', '#eef2ff', '#e0e7ff', '#c7d2fe'];
const BRAND_COLORS = ['#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#06b6d4', '#10b981', '#84cc16', '#eab308', '#14b8a6'];

const fmt = (v: number) =>
  v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(0)}K` : `₹${v}`;

const tooltipFmt = (value: number | string | readonly (number | string)[] | undefined | null) =>
  [`₹${formatNumber(value as number | string | undefined | null)}`, 'Revenue'];

const HorizBar = memo(function HorizBar({ data, colors }: { data: BarItem[]; colors: string[] }) {
  const chartData = useMemo(
    () => data.map((item) => ({
      ...item,
      name: item.name.length > 18 ? `${item.name.slice(0, 16)}…` : item.name,
    })),
    [data],
  );

  return (
    <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 36)} debounce={50}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
        <XAxis type="number" tickFormatter={fmt} tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={120} />
        <Tooltip formatter={tooltipFmt} cursor={{ fill: '#f8fafc' }} isAnimationActive={false} />
        <Bar dataKey="total_revenue" radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
          {chartData.map((_entry, index) => (
            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
});

function CategoryBrandChart({ categories, brands }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h3 className="text-base font-semibold text-gray-700 mb-3">Top Categories</h3>
        {categories.length === 0 ? (
          <p className="text-gray-500 text-sm py-8 text-center">No category data</p>
        ) : (
          <HorizBar data={categories} colors={CAT_COLORS} />
        )}
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-700 mb-3">Top Brands</h3>
        {brands.length === 0 ? (
          <p className="text-gray-500 text-sm py-8 text-center">No brand data</p>
        ) : (
          <HorizBar data={brands} colors={BRAND_COLORS} />
        )}
      </div>
    </div>
  );
}

export default memo(CategoryBrandChart);
