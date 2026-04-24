import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { formatNumber } from '../../lib/utils';

interface DailyPoint { date: string; total: number; count: number }

interface Props {
  currentData: DailyPoint[];
  previousData: DailyPoint[];
  currentLabel: string;
  previousLabel: string;
  viewMode?: 'line' | 'bar';
}

const CURRENT_COLOR = '#3b82f6';
const PREV_COLOR = '#94a3b8';

function indexByOffset(data: DailyPoint[], length: number): { index: number; total: number; count: number }[] {
  const result: { index: number; total: number; count: number }[] = [];
  for (let i = 0; i < length; i++) {
    if (i < data.length) {
      result.push({ index: i, total: Number(data[i].total) || 0, count: data[i].count || 0 });
    } else {
      result.push({ index: i, total: 0, count: 0 });
    }
  }
  return result;
}

export default function RevenueChart({ currentData, previousData, currentLabel, previousLabel, viewMode = 'line' }: Props) {
  const length = Math.max(currentData.length, previousData.length);
  const curr = indexByOffset(currentData, length);
  const prev = indexByOffset(previousData, length);

  const merged = curr.map((c, i) => ({
    index: i,
    label: currentData[i]?.date ? new Date(currentData[i].date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : `D${i + 1}`,
    current: c.total,
    previous: prev[i]?.total ?? 0,
  }));

  const fmtY = (v: number) => v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(0)}K` : `₹${v}`;

  const tooltipFmt = (value: number | string | readonly (number | string)[] | undefined | null) => [`₹${formatNumber(value as number | string | undefined | null)}`, ''];

  return (
    <ResponsiveContainer width="100%" height={260}>
      {viewMode === 'bar' ? (
        <BarChart data={merged} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={fmtY} tick={{ fontSize: 11 }} width={56} />
          <Tooltip formatter={tooltipFmt} />
          <Legend />
          <Bar dataKey="current" name={currentLabel} fill={CURRENT_COLOR} radius={[3, 3, 0, 0]} />
          <Bar dataKey="previous" name={previousLabel} fill={PREV_COLOR} radius={[3, 3, 0, 0]} />
        </BarChart>
      ) : (
        <LineChart data={merged} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={fmtY} tick={{ fontSize: 11 }} width={56} />
          <Tooltip formatter={tooltipFmt} />
          <Legend />
          <Line type="monotone" dataKey="current" name={currentLabel} stroke={CURRENT_COLOR} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
          <Line type="monotone" dataKey="previous" name={previousLabel} stroke={PREV_COLOR} strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}
