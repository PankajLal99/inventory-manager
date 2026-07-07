import { memo, useMemo } from 'react';
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
/** Cap SVG points so year/FY ranges stay responsive. */
const MAX_CHART_POINTS = 60;

const fmtY = (v: number) =>
  v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(0)}K` : `₹${v}`;

const tooltipFmt = (value: number | string | readonly (number | string)[] | undefined | null) =>
  [`₹${formatNumber(value as number | string | undefined | null)}`, ''];

function downsample(data: DailyPoint[], maxPoints: number): DailyPoint[] {
  if (data.length <= maxPoints) return data;
  const bucketSize = Math.ceil(data.length / maxPoints);
  const result: DailyPoint[] = [];
  for (let i = 0; i < data.length; i += bucketSize) {
    const end = Math.min(i + bucketSize, data.length);
    let total = 0;
    let count = 0;
    for (let j = i; j < end; j += 1) {
      total += Number(data[j].total) || 0;
      count += data[j].count || 0;
    }
    result.push({ date: data[i].date, total, count });
  }
  return result;
}

function buildMerged(
  currentData: DailyPoint[],
  previousData: DailyPoint[],
): { index: number; label: string; current: number; previous: number }[] {
  const length = Math.max(currentData.length, previousData.length);
  if (length === 0) return [];

  const maxLen = Math.max(currentData.length, previousData.length);
  const curr = maxLen > MAX_CHART_POINTS ? downsample(currentData, MAX_CHART_POINTS) : currentData;
  const prev = maxLen > MAX_CHART_POINTS ? downsample(previousData, MAX_CHART_POINTS) : previousData;
  const n = Math.max(curr.length, prev.length);
  const merged: { index: number; label: string; current: number; previous: number }[] = [];

  for (let i = 0; i < n; i += 1) {
    const date = curr[i]?.date;
    merged.push({
      index: i,
      label: date
        ? new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
        : `D${i + 1}`,
      current: Number(curr[i]?.total) || 0,
      previous: Number(prev[i]?.total) || 0,
    });
  }
  return merged;
}

function RevenueChart({ currentData, previousData, currentLabel, previousLabel, viewMode = 'line' }: Props) {
  const merged = useMemo(
    () => buildMerged(currentData, previousData),
    [currentData, previousData],
  );

  const sharedAxis = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
      <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
      <YAxis tickFormatter={fmtY} tick={{ fontSize: 11 }} width={56} />
      <Tooltip formatter={tooltipFmt} isAnimationActive={false} />
      <Legend />
    </>
  );

  return (
    <ResponsiveContainer width="100%" height={260} debounce={50}>
      {viewMode === 'bar' ? (
        <BarChart data={merged} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          {sharedAxis}
          <Bar dataKey="current" name={currentLabel} fill={CURRENT_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="previous" name={previousLabel} fill={PREV_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      ) : (
        <LineChart data={merged} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          {sharedAxis}
          <Line
            type="monotone"
            dataKey="current"
            name={currentLabel}
            stroke={CURRENT_COLOR}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="previous"
            name={previousLabel}
            stroke={PREV_COLOR}
            strokeWidth={1.5}
            strokeDasharray="5 5"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}

export default memo(RevenueChart);
