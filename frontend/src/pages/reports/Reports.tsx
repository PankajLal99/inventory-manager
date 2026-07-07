import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { reportsApi, catalogApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import { isPosAdminContext } from '../../lib/access';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Package,
  Coins,
  Calendar,
  Download,
  Store,
  ChevronDown,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Zap,
  Layers,
  Award,
  Users,
  Filter,
  SlidersHorizontal,
  AlertCircle,
  BarChart2,
} from 'lucide-react';
import { formatNumber, toLocalDateString } from '../../lib/utils';
import KpiDrillDownModal from './KpiDrillDownModal';
import { ExportProgressOverlay, yieldToMain } from './exportProgress';

// Recharts is heavy — load chart chunks only when data is ready to render.
const RevenueChart = lazy(() => import('./RevenueChart'));
const StoreComparisonPanel = lazy(() => import('./StoreComparisonPanel'));
const CategoryBrandChart = lazy(() => import('./CategoryBrandChart'));

function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div
      className="w-full rounded-lg bg-gray-50 animate-pulse border border-gray-100"
      style={{ height }}
      aria-hidden
    />
  );
}

/** Invoice list items expose line_total + tax_bifurcation (not tax_percent / tax_is_inclusive). */
function salesExportLineTotal(item: {
  line_total?: string | number | null;
  quantity?: string | number | null;
  manual_unit_price?: string | number | null;
  unit_price?: string | number | null;
  discount_amount?: string | number | null;
  tax_amount?: string | number | null;
  tax_bifurcation?: { is_inclusive?: boolean } | null;
}): number {
  if (item.line_total != null && item.line_total !== '') {
    const n = parseFloat(String(item.line_total));
    if (!Number.isNaN(n)) return n;
  }
  const qty = parseFloat(String(item.quantity ?? 1)) || 1;
  const unit = parseFloat(String(item.manual_unit_price ?? item.unit_price ?? 0)) || 0;
  const discount = parseFloat(String(item.discount_amount ?? 0)) || 0;
  const tax = parseFloat(String(item.tax_amount ?? 0)) || 0;
  const gross = qty * unit - discount;
  return item.tax_bifurcation?.is_inclusive === true ? gross : gross + tax;
}

function salesExportTaxPercent(item: {
  tax_bifurcation?: { rate?: number } | null;
}): number {
  const rate = item.tax_bifurcation?.rate;
  return rate != null && !Number.isNaN(Number(rate)) ? Number(rate) : 0;
}

function salesExportTaxInclusiveLabel(item: {
  tax_bifurcation?: { is_inclusive?: boolean } | null;
}): string {
  return item.tax_bifurcation?.is_inclusive === true ? 'Inclusive' : 'Exclusive';
}

const QUERY_STALE_MS = 60_000;
const DATE_DEBOUNCE_MS = 350;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return toLocalDateString(d);
}

function shiftMonths(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + n);
  return toLocalDateString(d);
}

function shiftYears(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + n);
  return toLocalDateString(d);
}

function daysBetween(a: string, b: string): number {
  return Math.round(Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

/** Auto-compute comparison period based on active filter */
function computeComparePeriod(dateFrom: string, dateTo: string, filter: string): { from: string; to: string; label: string } {
  switch (filter) {
    case 'today':
      return { from: addDays(dateFrom, -1), to: addDays(dateTo, -1), label: 'Previous Day' };
    case 'yesterday':
      return { from: addDays(dateFrom, -1), to: addDays(dateTo, -1), label: '2 Days Ago' };
    case 'last_week':
      return { from: addDays(dateFrom, -7), to: addDays(dateTo, -7), label: 'Previous Week' };
    case 'last_month':
      return { from: shiftMonths(dateFrom, -1), to: shiftMonths(dateTo, -1), label: 'Previous Month' };
    case 'last_year':
      return { from: shiftYears(dateFrom, -1), to: shiftYears(dateTo, -1), label: 'Previous Year' };
    case 'financial_year':
      return { from: shiftYears(dateFrom, -1), to: shiftYears(dateTo, -1), label: 'Previous FY' };
    default: {
      const delta = daysBetween(dateFrom, dateTo) + 1;
      const cTo = addDays(dateFrom, -1);
      const cFrom = addDays(cTo, -(delta - 1));
      return { from: cFrom, to: cTo, label: 'Previous Period' };
    }
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PctBadge({ pct }: { pct: number | null }) {
  if (pct === null || pct === undefined) return <span className="text-xs text-gray-400">—</span>;
  const isPos = pct > 0;
  const isNeg = pct < 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ${isPos ? 'bg-green-100 text-green-700' : isNeg ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
      {isPos ? <ArrowUpRight className="h-3 w-3" /> : isNeg ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  prevValue?: string;
  pct: number | null;
  icon: React.ReactNode;
  color: string;
  metric: string;
  onClick: (metric: string, label: string) => void;
  loading?: boolean;
}

function KpiCard({ label, value, prevValue, pct, icon, color, metric, onClick, loading }: KpiCardProps) {
  return (
    <button
      onClick={() => onClick(metric, label)}
      className={`bg-white rounded-xl shadow-sm border border-gray-200 p-5 text-left hover:shadow-md hover:border-${color}-300 transition-all duration-200 group w-full`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg bg-${color}-50`}>{icon}</div>
        <PctBadge pct={pct} />
      </div>
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">
        {loading ? <span className="inline-block h-7 w-24 bg-gray-100 rounded animate-pulse" /> : value}
      </p>
      {prevValue && !loading && (
        <p className="text-xs text-gray-400 mt-1">vs {prevValue}</p>
      )}
      <p className="text-xs text-blue-500 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">Click to drill down →</p>
    </button>
  );
}

function SectionHeader({ title, subtitle, icon }: { title: string; subtitle?: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="p-2 bg-gray-50 rounded-lg">{icon}</div>
      <div>
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Reports() {
  const [user, setUser] = useState(auth.getUser());
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) auth.loadUser().then(setUser);
  }, [user]);

  const canAccessReports = user?.can_access_reports !== false;
  if (user && !canAccessReports) return <Navigate to="/" replace />;

  // ── Stores ──
  const { data: storesResponse } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => (await catalogApi.stores.list()).data,
    retry: false,
  });

  const stores: any[] = (() => {
    if (!storesResponse) return [];
    if (Array.isArray(storesResponse.results)) return storesResponse.results;
    if (Array.isArray(storesResponse.data)) return storesResponse.data;
    if (Array.isArray(storesResponse)) return storesResponse;
    return [];
  })();

  const isAdmin = isPosAdminContext(user);

  const defaultStore = (() => {
    if (isAdmin && selectedStoreId) {
      return stores.find((s: any) => s.id === selectedStoreId) || stores.find((s: any) => s.is_active) || stores[0];
    }
    return stores.find((s: any) => s.is_active) || stores[0];
  })();

  useEffect(() => {
    if (isAdmin && !selectedStoreId && stores.length > 0) {
      const first = stores.find((s: any) => s.is_active) || stores[0];
      if (first) setSelectedStoreId(first.id);
    }
  }, [isAdmin, selectedStoreId, stores]);

  const currentStore = stores.find((s: any) => s.id === selectedStoreId);

  // ── Date state ──
  const [dateFrom, setDateFrom] = useState(() => toLocalDateString(new Date()));
  const [dateTo, setDateTo] = useState(() => toLocalDateString(new Date()));
  const [activeDateFilter, setActiveDateFilter] = useState<string>('today');

  // ── Comparison period ──
  const [comparisonMode, setComparisonMode] = useState<'auto' | 'custom'>('auto');
  const [customCompareFrom, setCustomCompareFrom] = useState('');
  const [customCompareTo, setCustomCompareTo] = useState('');
  const [showComparePanel, setShowComparePanel] = useState(false);

  const autoCompare = computeComparePeriod(dateFrom, dateTo, activeDateFilter);
  const compareFrom = comparisonMode === 'custom' && customCompareFrom ? customCompareFrom : autoCompare.from;
  const compareTo = comparisonMode === 'custom' && customCompareTo ? customCompareTo : autoCompare.to;
  const compareLabel = comparisonMode === 'custom' ? 'Custom Comparison' : autoCompare.label;

  // Debounce date-driven queries so rapid filter changes don't stampede the API.
  const [queryDates, setQueryDates] = useState({
    dateFrom,
    dateTo,
    compareFrom,
    compareTo,
  });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQueryDates({ dateFrom, dateTo, compareFrom, compareTo });
    }, DATE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [dateFrom, dateTo, compareFrom, compareTo]);

  const qFrom = queryDates.dateFrom;
  const qTo = queryDates.dateTo;
  const qCompareFrom = queryDates.compareFrom;
  const qCompareTo = queryDates.compareTo;

  // ── Chart / insight state ──
  const [chartViewMode, setChartViewMode] = useState<'line' | 'bar'>('line');
  const [productTab, setProductTab] = useState<'fast' | 'slow' | 'top'>('top');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterBrand, setFilterBrand] = useState<string>('');
  const [showStockOrdering, setShowStockOrdering] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());

  // ── Drill-down ──
  const [drillDown, setDrillDown] = useState<{ metric: string; label: string } | null>(null);

  const openDrillDown = useCallback((metric: string, label: string) => {
    setDrillDown({ metric, label });
  }, []);

  // ── Quick date filters ──
  const setDateFilter = useCallback((filter: string) => {
    setActiveDateFilter(filter);
    const today = new Date();
    const todayStr = toLocalDateString(today);

    switch (filter) {
      case 'today':
        setDateFrom(todayStr); setDateTo(todayStr); break;
      case 'yesterday': {
        const y = addDays(todayStr, -1);
        setDateFrom(y); setDateTo(y); break;
      }
      case 'last_week':
        setDateFrom(addDays(todayStr, -7)); setDateTo(todayStr); break;
      case 'last_month':
        setDateFrom(addDays(todayStr, -30)); setDateTo(todayStr); break;
      case 'last_year':
        setDateFrom(addDays(todayStr, -365)); setDateTo(todayStr); break;
      case 'financial_year': {
        const m = today.getMonth();
        const fyStart = m >= 3
          ? new Date(today.getFullYear(), 3, 1)
          : new Date(today.getFullYear() - 1, 3, 1);
        setDateFrom(toLocalDateString(fyStart)); setDateTo(todayStr); break;
      }
      default: break;
    }
    if (comparisonMode === 'auto') {
      setCustomCompareFrom('');
      setCustomCompareTo('');
    }
  }, [comparisonMode]);

  // ── API Queries (debounced dates; cached to avoid redundant work) ──

  // 1. Analytics Comparison (KPIs + % change + daily chart + store comparison)
  const { data: analyticsData, isLoading: analyticsLoading, isFetching: analyticsFetching } = useQuery({
    queryKey: ['analytics-comparison', qFrom, qTo, qCompareFrom, qCompareTo, defaultStore?.id],
    queryFn: async () => (await reportsApi.analyticsComparison({
      date_from: qFrom,
      date_to: qTo,
      compare_from: qCompareFrom,
      compare_to: qCompareTo,
      store: defaultStore?.id || undefined,
    })).data,
    enabled: !!defaultStore,
    retry: false,
    staleTime: QUERY_STALE_MS,
    placeholderData: keepPreviousData,
  });

  // 2. Category + Brand analytics (with optional filters)
  const { data: catBrandData, isLoading: catBrandLoading, isFetching: catBrandFetching } = useQuery({
    queryKey: ['cat-brand', qFrom, qTo, defaultStore?.id, filterCategory, filterBrand],
    queryFn: async () => (await reportsApi.categoryBrandAnalytics({
      date_from: qFrom,
      date_to: qTo,
      store: defaultStore?.id || undefined,
      category: filterCategory || undefined,
      brand: filterBrand || undefined,
      limit: 10,
    })).data,
    enabled: !!defaultStore,
    retry: false,
    staleTime: QUERY_STALE_MS,
    placeholderData: keepPreviousData,
  });

  // 3. Inventory summary
  const { data: inventoryData, isLoading: inventoryLoading } = useQuery({
    queryKey: ['inventory-summary', defaultStore?.id],
    queryFn: async () => (await reportsApi.inventorySummary({ store: defaultStore?.id || undefined })).data,
    enabled: !!defaultStore,
    retry: false,
    staleTime: QUERY_STALE_MS,
  });

  // 4. Customer summary
  const { data: customerData, isLoading: customerLoading } = useQuery({
    queryKey: ['customers', qFrom, qTo],
    queryFn: async () => (await reportsApi.customers({ date_from: qFrom, date_to: qTo })).data,
    retry: false,
    staleTime: QUERY_STALE_MS,
    placeholderData: keepPreviousData,
  });

  // 5. Stock ordering (lazy)
  const { data: stockOrderingData, isLoading: stockOrderingLoading } = useQuery({
    queryKey: ['stock-ordering', defaultStore?.id],
    queryFn: async () => (await reportsApi.stockOrdering({ store: defaultStore?.id || undefined })).data,
    enabled: showStockOrdering && !!defaultStore,
    retry: false,
    staleTime: QUERY_STALE_MS,
  });

  // 6. Annual revenue
  const { data: revenueData, isLoading: revenueLoading } = useQuery({
    queryKey: ['revenue', year],
    queryFn: async () => (await reportsApi.revenue({ year })).data,
    retry: false,
    staleTime: QUERY_STALE_MS,
    placeholderData: keepPreviousData,
  });

  // ── Derived data ──
  const curr = analyticsData?.current || {};
  const prev = analyticsData?.previous || {};
  const pctChange = analyticsData?.pct_change || {};
  const dailyCurrent: any[] = analyticsData?.daily_current ?? [];
  const dailyPrevious: any[] = analyticsData?.daily_previous ?? [];

  const topCategories: any[] = catBrandData?.top_categories ?? [];
  const topBrands: any[] = catBrandData?.top_brands ?? [];
  const fastSelling: any[] = catBrandData?.fast_selling ?? [];
  const slowMoving: any[] = catBrandData?.slow_moving ?? [];

  const inventorySummary = inventoryData?.summary || inventoryData || {};
  const topCustomers: any[] = customerData?.top_customers ?? [];

  // Prefetch chart chunks while KPIs/API load so recharts is ready when data arrives.
  useEffect(() => {
    void import('./RevenueChart');
    void import('./CategoryBrandChart');
    void import('./StoreComparisonPanel');
  }, []);

  const chartCurrentData = useMemo(
    () => (analyticsData?.daily_current ?? []).map((d: any) => ({
      date: d.date,
      total: Number(d.total || 0),
      count: d.count || 0,
    })),
    [analyticsData?.daily_current],
  );
  const chartPreviousData = useMemo(
    () => (analyticsData?.daily_previous ?? []).map((d: any) => ({
      date: d.date,
      total: Number(d.total || 0),
      count: d.count || 0,
    })),
    [analyticsData?.daily_previous],
  );
  const storeComparisonData = useMemo(
    () => analyticsData?.store_comparison ?? [],
    [analyticsData?.store_comparison],
  );
  const revenueChartLabel = useMemo(
    () => `${fmtDate(qFrom)} – ${fmtDate(qTo)}`,
    [qFrom, qTo],
  );
  const productRows = useMemo(() => {
    const fast = catBrandData?.fast_selling ?? [];
    const slow = catBrandData?.slow_moving ?? [];
    if (productTab === 'fast') return fast;
    if (productTab === 'slow') return slow;
    return [...fast].sort((a: any, b: any) => (b.total_revenue || 0) - (a.total_revenue || 0));
  }, [productTab, catBrandData?.fast_selling, catBrandData?.slow_moving]);
  const categoryChartData = useMemo(
    () => (catBrandData?.top_categories ?? []).map((c: any) => ({
      name: c.product__category__name || 'Unknown',
      total_revenue: Number(c.total_revenue || 0),
      total_quantity: Number(c.total_quantity || 0),
      order_count: c.order_count || 0,
    })),
    [catBrandData?.top_categories],
  );
  const brandChartData = useMemo(
    () => (catBrandData?.top_brands ?? []).map((b: any) => ({
      name: b.product__brand__name || 'Unknown',
      total_revenue: Number(b.total_revenue || 0),
      total_quantity: Number(b.total_quantity || 0),
      order_count: b.order_count || 0,
    })),
    [catBrandData?.top_brands],
  );

  // Derive available filter options from data
  const availableCategories = useMemo(
    () => (catBrandData?.top_categories ?? []).map((c: any) => ({
      id: c.product__category__id,
      name: c.product__category__name || 'Unknown',
    })),
    [catBrandData?.top_categories],
  );
  const availableBrands = useMemo(
    () => (catBrandData?.top_brands ?? []).map((b: any) => ({
      id: b.product__brand__id,
      name: b.product__brand__name || 'Unknown',
    })),
    [catBrandData?.top_brands],
  );

  const queriesRefreshing = analyticsFetching || catBrandFetching;

  // ── Export progress (shared overlay) ──
  const [exportProgress, setExportProgress] = useState<{
    kind: 'excel' | 'pdf';
    percent: number;
    label: string;
  } | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [excelExporting, setExcelExporting] = useState(false);
  const isExporting = pdfExporting || excelExporting;

  // ── PDF Export (lazy-load jspdf; uses already-fetched report data) ──
  const handleExportPdf = useCallback(async () => {
    if (pdfExporting || excelExporting) return;
    setPdfExporting(true);
    setExportProgress({ kind: 'pdf', percent: 8, label: 'Preparing PDF…' });
    try {
      await yieldToMain();
      setExportProgress({ kind: 'pdf', percent: 25, label: 'Loading PDF engine…' });
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      setExportProgress({ kind: 'pdf', percent: 45, label: 'Building report pages…' });
      await yieldToMain();

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      let y = 0;

      doc.setFillColor(59, 130, 246);
      doc.rect(0, 0, pageW, 30, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('Reports & Analytics', pageW / 2, 13, { align: 'center' });
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `${currentStore?.name || 'All Stores'}  |  ${fmtDate(dateFrom)} to ${fmtDate(dateTo)}`,
        pageW / 2, 21, { align: 'center' }
      );
      doc.text(`Compared with ${compareLabel}: ${fmtDate(compareFrom)} to ${fmtDate(compareTo)}`, pageW / 2, 27, { align: 'center' });
      doc.setTextColor(0, 0, 0);
      y = 38;

      const kpiCards = [
        {
          label: 'Total Sales',
          curr: `Rs.${formatNumber(curr.total_sales || 0)}`,
          prev: `Rs.${formatNumber(prev.total_sales || 0)}`,
          pct: pctChange.total_sales,
          rgb: [16, 185, 129] as [number, number, number],
        },
        {
          label: 'Total Invoices',
          curr: String(curr.total_invoices || 0),
          prev: String(prev.total_invoices || 0),
          pct: pctChange.total_invoices,
          rgb: [59, 130, 246] as [number, number, number],
        },
        {
          label: 'Items Sold',
          curr: String(Math.round(curr.items_sold || 0)),
          prev: String(Math.round(prev.items_sold || 0)),
          pct: pctChange.items_sold,
          rgb: [139, 92, 246] as [number, number, number],
        },
        {
          label: 'Avg Order Value',
          curr: `Rs.${formatNumber(curr.avg_order_value || 0)}`,
          prev: `Rs.${formatNumber(prev.avg_order_value || 0)}`,
          pct: pctChange.avg_order_value,
          rgb: [245, 158, 11] as [number, number, number],
        },
      ];

      const cardW = (pageW - 28) / 4;
      const cardH = 26;
      kpiCards.forEach((k, i) => {
        const x = 14 + i * (cardW + 2);
        doc.setFillColor(...k.rgb);
        doc.roundedRect(x, y, cardW, cardH, 3, 3, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.text(k.label, x + cardW / 2, y + 7, { align: 'center' });
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(k.curr, x + cardW / 2, y + 15, { align: 'center' });
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'normal');
        const pctStr = k.pct != null
          ? `${k.pct > 0 ? '+' : ''}${Number(k.pct).toFixed(1)}%`
          : '';
        doc.text(`vs ${k.prev}  ${pctStr}`, x + cardW / 2, y + 22, { align: 'center' });
      });
      doc.setTextColor(0, 0, 0);
      y += cardH + 10;

      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('KPI Summary', 14, y);
      y += 4;
      autoTable(doc, {
        startY: y,
        head: [['Metric', 'Current Period', 'Comparison Period', '% Change']],
        body: [
          ['Total Sales', `Rs.${formatNumber(curr.total_sales || 0)}`, `Rs.${formatNumber(prev.total_sales || 0)}`, pctChange.total_sales != null ? `${pctChange.total_sales > 0 ? '+' : ''}${Number(pctChange.total_sales).toFixed(1)}%` : '-'],
          ['Total Invoices', String(curr.total_invoices || 0), String(prev.total_invoices || 0), pctChange.total_invoices != null ? `${pctChange.total_invoices > 0 ? '+' : ''}${Number(pctChange.total_invoices).toFixed(1)}%` : '-'],
          ['Items Sold', String(Math.round(curr.items_sold || 0)), String(Math.round(prev.items_sold || 0)), pctChange.items_sold != null ? `${pctChange.items_sold > 0 ? '+' : ''}${Number(pctChange.items_sold).toFixed(1)}%` : '-'],
          ['Avg Order Value', `Rs.${formatNumber(curr.avg_order_value || 0)}`, `Rs.${formatNumber(prev.avg_order_value || 0)}`, pctChange.avg_order_value != null ? `${pctChange.avg_order_value > 0 ? '+' : ''}${Number(pctChange.avg_order_value).toFixed(1)}%` : '-'],
        ],
        styles: { fontSize: 9 },
        headStyles: { fillColor: [59, 130, 246] },
        columnStyles: {
          3: { halign: 'center' },
        },
      });
      y = (doc as any).lastAutoTable.finalY + 10;

      const topProds = (productTab === 'fast' ? fastSelling : productTab === 'slow' ? slowMoving : fastSelling);
      if (topProds.length > 0) {
        if (y > 230) { doc.addPage(); y = 14; }
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Top Products', 14, y);
        y += 4;
        autoTable(doc, {
          startY: y,
          head: [['Product', 'SKU', 'Category', 'Brand', 'Qty Sold', 'Revenue']],
          body: topProds.slice(0, 15).map((p: any) => [
            p.product__name || '',
            p.product__sku || 'N/A',
            p.product__category__name || '-',
            p.product__brand__name || '-',
            Math.round(p.total_quantity || 0),
            `Rs.${formatNumber(p.total_revenue || 0)}`,
          ]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [99, 102, 241] },
        });
        y = (doc as any).lastAutoTable.finalY + 10;
      }

      if (topCategories.length > 0) {
        if (y > 230) { doc.addPage(); y = 14; }
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Top Categories', 14, y);
        y += 4;
        autoTable(doc, {
          startY: y,
          head: [['Category', 'Revenue', 'Qty Sold', 'Orders']],
          body: topCategories.map((c: any) => [
            c.product__category__name || 'Unknown',
            `Rs.${formatNumber(c.total_revenue || 0)}`,
            Math.round(c.total_quantity || 0),
            c.order_count || 0,
          ]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [245, 158, 11] },
        });
        y = (doc as any).lastAutoTable.finalY + 10;
      }

      if (topBrands.length > 0) {
        if (y > 230) { doc.addPage(); y = 14; }
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Top Brands', 14, y);
        y += 4;
        autoTable(doc, {
          startY: y,
          head: [['Brand', 'Revenue', 'Qty Sold', 'Orders']],
          body: topBrands.map((b: any) => [
            b.product__brand__name || 'Unknown',
            `Rs.${formatNumber(b.total_revenue || 0)}`,
            Math.round(b.total_quantity || 0),
            b.order_count || 0,
          ]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [16, 185, 129] },
        });
      }

      setExportProgress({ kind: 'pdf', percent: 90, label: 'Saving PDF…' });
      await yieldToMain();
      doc.save(`report-${dateFrom}-to-${dateTo}.pdf`);
      setExportProgress({ kind: 'pdf', percent: 100, label: 'Done' });
      await new Promise((r) => setTimeout(r, 450));
    } catch (err) {
      console.error('PDF export failed', err);
      window.alert('PDF export failed. Please try again.');
    } finally {
      setPdfExporting(false);
      setExportProgress(null);
    }
  }, [pdfExporting, excelExporting, curr, prev, pctChange, fastSelling, slowMoving, topCategories, topBrands, compareLabel, compareFrom, compareTo, dateFrom, dateTo, currentStore, productTab]);

  // ── Sales Report Excel (lean paginated API — avoids full invoice list OOM) ──
  const handleExportSalesExcel = useCallback(async () => {
    if (excelExporting || pdfExporting || !defaultStore?.id) return;
    setExcelExporting(true);
    setExportProgress({ kind: 'excel', percent: 3, label: 'Starting export…' });
    try {
      const xlsxPromise = import('xlsx');
      const invoices: any[] = [];
      const pageSize = 100;
      let page = 1;
      let hasMore = true;
      let totalCount = 0;

      while (hasMore) {
        const res = await reportsApi.salesExport({
          date_from: dateFrom,
          date_to: dateTo,
          page,
          page_size: pageSize,
          store: defaultStore.id,
        });
        if (!res.data || !Array.isArray(res.data.results)) {
          throw new Error('Unexpected export response from server');
        }
        const batch: any[] = res.data.results;
        if (typeof res.data.total_count === 'number') totalCount = res.data.total_count;
        invoices.push(...batch);
        hasMore = Boolean(res.data.has_more) && batch.length > 0;
        page += 1;

        // Fetch phase occupies 0–72% so the bar moves steadily while pages load.
        let fetchPct: number;
        if (totalCount > 0) {
          fetchPct = 3 + (Math.min(invoices.length, totalCount) / totalCount) * 69;
        } else {
          fetchPct = Math.min(60, 3 + page * 4);
        }
        setExportProgress({
          kind: 'excel',
          percent: fetchPct,
          label:
            totalCount > 0
              ? `Loading invoices ${Math.min(invoices.length, totalCount)} / ${totalCount}…`
              : `Loading invoices (${invoices.length})…`,
        });
        await yieldToMain();
        // Safety cap against infinite loops if API misbehaves.
        if (page > 500) break;
      }

      setExportProgress({ kind: 'excel', percent: 75, label: 'Building spreadsheet rows…' });
      await yieldToMain();
      const XLSX = await xlsxPromise;

      type Row = (string | number)[];
      const zeroAcc = () => ({ tax: 0, total: 0, cash: 0, upi: 0, card: 0, pending: 0, grand: 0 });
      type Acc = ReturnType<typeof zeroAcc>;

      const addToAcc = (acc: Acc, row: Row) => {
        acc.tax += Number(row[7]) || 0;
        acc.total += Number(row[8]) || 0;
        acc.cash += Number(row[9]) || 0;
        acc.upi += Number(row[10]) || 0;
        acc.card += Number(row[11]) || 0;
        acc.pending += Number(row[12]) || 0;
        acc.grand += Number(row[13]) || 0;
      };

      const subtotalRow = (label: string, acc: Acc): Row => [
        label, '', '', '', '', '', '',
        acc.tax, acc.total, acc.cash, acc.upi, acc.card, acc.pending, acc.grand,
        '', '',
      ];

      type DayGroup = { dateLabel: string; rows: Row[] };
      const dayMap = new Map<string, DayGroup>();
      const CHUNK = 50;
      const invTotalCount = invoices.length || 1;

      for (let i = 0; i < invoices.length; i += 1) {
        if (i > 0 && i % CHUNK === 0) {
          const buildPct = 75 + ((i / invTotalCount) * 15);
          setExportProgress({
            kind: 'excel',
            percent: buildPct,
            label: `Building rows ${i} / ${invoices.length}…`,
          });
          await yieldToMain();
        }

        const inv = invoices[i];
        const dateObj = inv.created_at ? new Date(inv.created_at) : null;
        const dateKey = dateObj ? dateObj.toISOString().slice(0, 10) : 'Unknown';
        const dateLabel = dateObj
          ? dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
          : 'Unknown';

        let group = dayMap.get(dateKey);
        if (!group) {
          group = { dateLabel, rows: [] };
          dayMap.set(dateKey, group);
        }

        let cashTotal = 0;
        let upiTotal = 0;
        let cardTotal = 0;
        const payments: any[] = inv.payments ?? [];
        for (let p = 0; p < payments.length; p += 1) {
          const amount = parseFloat(payments[p].amount || 0) || 0;
          const method = payments[p].payment_method;
          if (method === 'cash') cashTotal += amount;
          else if (method === 'upi') upiTotal += amount;
          else if (method === 'card') cardTotal += amount;
        }
        const pendingTotal = parseFloat(inv.due_amount || 0) || 0;
        const grandTotal = cashTotal + upiTotal + cardTotal + pendingTotal;
        const invTotal = parseFloat(inv.total || 0) || 0;
        const invoiceNo = inv.invoice_number ?? '';
        const customerName = inv.customer_name ?? '';
        const items: any[] = inv.items ?? [];

        if (items.length === 0) {
          group.rows.push([
            dateLabel, invoiceNo, customerName,
            '', '', '', '', parseFloat(inv.tax_amount || 0) || 0, invTotal,
            cashTotal, upiTotal, cardTotal, pendingTotal, grandTotal,
            '', '',
          ]);
        } else {
          const groupedItems = new Map<string, {
            productName: string;
            taxPercent: number;
            taxMode: string;
            qty: number;
            taxTotal: number;
            lineTotal: number;
          }>();

          for (let j = 0; j < items.length; j += 1) {
            const item = items[j];
            const productName = item.product_name ?? '';
            const taxPercent = salesExportTaxPercent(item);
            const taxMode = salesExportTaxInclusiveLabel(item);
            const key = `${productName}__${taxPercent}__${taxMode}`;
            const existing = groupedItems.get(key);
            if (existing) {
              existing.qty += parseFloat(item.quantity || 0) || 0;
              existing.taxTotal += parseFloat(item.tax_amount || 0) || 0;
              existing.lineTotal += salesExportLineTotal(item);
            } else {
              groupedItems.set(key, {
                productName,
                taxPercent,
                taxMode,
                qty: parseFloat(item.quantity || 0) || 0,
                taxTotal: parseFloat(item.tax_amount || 0) || 0,
                lineTotal: salesExportLineTotal(item),
              });
            }
          }

          let idx = 0;
          for (const row of groupedItems.values()) {
            const isFirstItemRow = idx === 0;
            group.rows.push([
              dateLabel,
              invoiceNo,
              customerName,
              row.productName,
              row.taxPercent,
              row.taxMode,
              row.qty,
              row.taxTotal,
              row.lineTotal,
              isFirstItemRow ? cashTotal : '',
              isFirstItemRow ? upiTotal : '',
              isFirstItemRow ? cardTotal : '',
              isFirstItemRow ? pendingTotal : '',
              isFirstItemRow ? grandTotal : '',
              '',
              '',
            ]);
            idx += 1;
          }
        }
      }

      const isMultiDay = dayMap.size > 1;
      const allRows: Row[] = [];
      const grandAcc = zeroAcc();
      const sortedDays = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b));

      for (const [, group] of sortedDays) {
        allRows.push(...group.rows);
        if (isMultiDay) {
          const dayAcc = zeroAcc();
          for (const r of group.rows) addToAcc(dayAcc, r);
          allRows.push(subtotalRow(`Day Total – ${group.dateLabel}`, dayAcc));
          allRows.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
        }
        for (const r of group.rows) addToAcc(grandAcc, r);
      }
      allRows.push(subtotalRow('GRAND TOTAL', grandAcc));

      const headers: Row = [
        'Invoice Date',
        'Invoice No.',
        'Customer Name',
        'Product',
        'Tax %',
        'Inclusive or Exclusive',
        'Qty',
        'Tax',
        'Total',
        'Cash Amount Total',
        'UPI Total',
        'Card Total',
        'Pending Total',
        'Total (Cash+UPI+Card+Pending)',
        'Deposit Money in Bank',
        'Deposit Date',
      ];

      setExportProgress({ kind: 'excel', percent: 92, label: 'Writing Excel file…' });
      await yieldToMain();
      const ws = XLSX.utils.aoa_to_sheet([headers, ...allRows]);
      ws['!cols'] = [
        { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 30 },
        { wch: 8 }, { wch: 18 }, { wch: 8 }, { wch: 12 }, { wch: 14 },
        { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 16 },
        { wch: 26 }, { wch: 24 }, { wch: 16 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sales Report');
      setExportProgress({ kind: 'excel', percent: 98, label: 'Downloading…' });
      await yieldToMain();
      XLSX.writeFile(wb, `sales-report-${dateFrom}-to-${dateTo}.xlsx`);
      setExportProgress({ kind: 'excel', percent: 100, label: 'Done' });
      await new Promise((r) => setTimeout(r, 450));
    } catch (err) {
      console.error('Excel export failed', err);
      window.alert(
        'Sales report export failed. The server may be low on memory — try a shorter date range, then retry.',
      );
    } finally {
      setExcelExporting(false);
      setExportProgress(null);
    }
  }, [excelExporting, pdfExporting, dateFrom, dateTo, defaultStore]);

  // ── Guards ──
  if (!defaultStore && stores.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <BarChart3 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Reports & Analytics</h2>
          <p className="text-red-600">No store available. Please create a store first.</p>
        </div>
      </div>
    );
  }

  const QUICK_FILTERS = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'last_week', label: '7 Days' },
    { key: 'last_month', label: '30 Days' },
    { key: 'last_year', label: '1 Year' },
    { key: 'financial_year', label: 'FY' },
    { key: 'custom', label: 'Custom' },
  ];

  // ── Render ──
  return (
    <div className="space-y-6 pb-12" ref={reportRef}>
      <ExportProgressOverlay
        open={isExporting && !!exportProgress}
        title={exportProgress?.kind === 'pdf' ? 'Exporting PDF' : 'Exporting Sales Report'}
        label={exportProgress?.label || 'Working…'}
        percent={exportProgress?.percent ?? 0}
      />

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-xl">
            <BarChart3 className="h-7 w-7 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
            <p className="text-sm text-gray-500">Comparative insights · Product intelligence · Store performance</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Store Selector */}
          {isAdmin && stores.length > 0 && (
            <div className="relative">
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm hover:border-blue-400 transition-colors cursor-pointer">
                <Store className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium text-gray-800 truncate max-w-[140px]">
                  {currentStore?.name || 'Select Store'}
                </span>
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </div>
              <select
                value={selectedStoreId?.toString() || ''}
                onChange={(e) => setSelectedStoreId(parseInt(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              >
                {stores.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
          {/* Stock Report link */}
          <Link
            to="/stock-report"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors shadow-sm"
          >
            <Package className="h-4 w-4" />
            Stock Report
          </Link>
          {/* Export PDF */}
          <button
            onClick={handleExportPdf}
            disabled={isExporting || analyticsLoading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {pdfExporting ? 'Exporting…' : 'Export PDF'}
          </button>
          {/* Sales Report Excel */}
          <button
            onClick={handleExportSalesExcel}
            disabled={isExporting || !defaultStore?.id}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors shadow-sm disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {excelExporting ? 'Exporting…' : 'Sales Report (Excel)'}
          </button>
        </div>
      </div>

      {/* ── Date Range & Comparison ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-3">
        {/* Quick filters */}
        <div className="flex flex-wrap gap-2">
          {QUICK_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setDateFilter(f.key)}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-lg transition-colors ${activeDateFilter === f.key
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
            >
              {f.label}
            </button>
          ))}
          <button
            onClick={() => setShowComparePanel(v => !v)}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Compare
          </button>
        </div>

        {/* Custom date range */}
        {activeDateFilter === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-400" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setActiveDateFilter('custom'); }}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="text-gray-400">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setActiveDateFilter('custom'); }}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        )}

        {/* Comparison panel */}
        {showComparePanel && (
          <div className="pt-3 border-t border-gray-100 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-gray-700">Comparison:</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setComparisonMode('auto')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${comparisonMode === 'auto' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  Auto ({autoCompare.label})
                </button>
                <button
                  onClick={() => setComparisonMode('custom')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${comparisonMode === 'custom' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  Custom Range
                </button>
              </div>
              <span className="text-xs text-gray-500 ml-auto">
                vs <strong>{fmtDate(compareFrom)}</strong> – <strong>{fmtDate(compareTo)}</strong>
              </span>
            </div>
            {comparisonMode === 'custom' && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-400" />
                <input
                  type="date"
                  value={customCompareFrom}
                  onChange={(e) => setCustomCompareFrom(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-gray-400">→</span>
                <input
                  type="date"
                  value={customCompareTo}
                  onChange={(e) => setCustomCompareTo(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── KPI Cards ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-700">Key Performance Indicators</h2>
          <span className="text-xs text-gray-400">
            {fmtDate(qFrom)} – {fmtDate(qTo)} vs {compareLabel}
            {queriesRefreshing && !analyticsLoading && (
              <span className="ml-2 text-blue-500">Updating…</span>
            )}
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Total Sales"
            value={`₹${formatNumber(curr.total_sales || 0)}`}
            prevValue={`₹${formatNumber(prev.total_sales || 0)}`}
            pct={pctChange.total_sales ?? null}
            icon={<Coins className="h-5 w-5 text-green-600" />}
            color="green"
            metric="total_sales"
            onClick={openDrillDown}
            loading={analyticsLoading}
          />
          <KpiCard
            label="Total Invoices"
            value={String(curr.total_invoices || 0)}
            prevValue={String(prev.total_invoices || 0)}
            pct={pctChange.total_invoices ?? null}
            icon={<BarChart3 className="h-5 w-5 text-blue-600" />}
            color="blue"
            metric="total_invoices"
            onClick={openDrillDown}
            loading={analyticsLoading}
          />
          <KpiCard
            label="Items Sold"
            value={String(Math.round(curr.items_sold || 0))}
            prevValue={String(Math.round(prev.items_sold || 0))}
            pct={pctChange.items_sold ?? null}
            icon={<Package className="h-5 w-5 text-purple-600" />}
            color="purple"
            metric="items_sold"
            onClick={openDrillDown}
            loading={analyticsLoading}
          />
          <KpiCard
            label="Avg Order Value"
            value={`₹${formatNumber(curr.avg_order_value || 0)}`}
            prevValue={`₹${formatNumber(prev.avg_order_value || 0)}`}
            pct={pctChange.avg_order_value ?? null}
            icon={<TrendingUp className="h-5 w-5 text-yellow-600" />}
            color="yellow"
            metric="avg_order_value"
            onClick={openDrillDown}
            loading={analyticsLoading}
          />
        </div>
      </div>

      {/* ── Inventory KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Products', value: inventorySummary.total_products || 0, icon: <Package className="h-5 w-5 text-blue-500" />, cls: 'text-blue-600' },
          { label: 'Total Stock Units', value: Math.round(inventorySummary.total_quantity || 0), icon: <Layers className="h-5 w-5 text-indigo-500" />, cls: 'text-indigo-600' },
          { label: 'Low Stock Items', value: inventorySummary.low_stock_count || 0, icon: <AlertCircle className="h-5 w-5 text-orange-500" />, cls: 'text-orange-600' },
          { label: 'Out of Stock', value: inventorySummary.out_of_stock_count || 0, icon: <AlertCircle className="h-5 w-5 text-red-500" />, cls: 'text-red-600' },
        ].map(({ label, value, icon, cls }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-3">
            <div className="p-2 bg-gray-50 rounded-lg">{icon}</div>
            <div>
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`text-xl font-bold ${cls}`}>
                {inventoryLoading ? <span className="inline-block h-6 w-12 bg-gray-100 rounded animate-pulse" /> : value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Revenue Trend Chart ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <SectionHeader
            title="Revenue Trend"
            subtitle={`${fmtDate(dateFrom)} – ${fmtDate(dateTo)} vs ${compareLabel}`}
            icon={<TrendingUp className="h-5 w-5 text-blue-600" />}
          />
          <div className="flex gap-1 ml-auto">
            <button
              onClick={() => setChartViewMode('line')}
              className={`p-2 rounded-lg transition-colors ${chartViewMode === 'line' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              title="Line Chart"
            >
              <TrendingUp className="h-4 w-4" />
            </button>
            <button
              onClick={() => setChartViewMode('bar')}
              className={`p-2 rounded-lg transition-colors ${chartViewMode === 'bar' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              title="Bar Chart"
            >
              <BarChart2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        {analyticsLoading ? (
          <ChartSkeleton height={260} />
        ) : dailyCurrent.length === 0 && dailyPrevious.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-gray-400">No data for this period</div>
        ) : (
          <Suspense fallback={<ChartSkeleton height={260} />}>
            <RevenueChart
              currentData={chartCurrentData}
              previousData={chartPreviousData}
              currentLabel={revenueChartLabel}
              previousLabel={compareLabel}
              viewMode={chartViewMode}
            />
          </Suspense>
        )}
      </div>

      {/* ── Store Comparison (shown only if multi-store retailer) ── */}
      {storeComparisonData.length >= 2 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <SectionHeader
            title="Store Comparison"
            subtitle="Compare performance across your stores for the selected period"
            icon={<Store className="h-5 w-5 text-blue-600" />}
          />
          <Suspense fallback={<ChartSkeleton height={220} />}>
            <StoreComparisonPanel stores={storeComparisonData} />
          </Suspense>
        </div>
      )}

      {/* ── Product Intelligence ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <SectionHeader
            title="Product Intelligence"
            subtitle="Fast sellers, slow movers & top revenue products"
            icon={<Zap className="h-5 w-5 text-yellow-500" />}
          />
          {/* Category + Brand Filters */}
          <div className="flex gap-2 flex-wrap">
            <div className="relative">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="text-sm pl-7 pr-3 py-1.5 border border-gray-200 rounded-lg appearance-none bg-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Categories</option>
                {availableCategories.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="relative">
              <Award className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <select
                value={filterBrand}
                onChange={(e) => setFilterBrand(e.target.value)}
                className="text-sm pl-7 pr-3 py-1.5 border border-gray-200 rounded-lg appearance-none bg-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Brands</option>
                {availableBrands.map((b: any) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            {(filterCategory || filterBrand) && (
              <button
                onClick={() => { setFilterCategory(''); setFilterBrand(''); }}
                className="px-2 py-1.5 text-xs text-gray-500 hover:text-red-500 border border-gray-200 rounded-lg transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
          {[
            { key: 'top' as const, label: '🏆 Top Revenue', color: 'indigo' },
            { key: 'fast' as const, label: '⚡ Fast Selling', color: 'green' },
            { key: 'slow' as const, label: '🐢 Slow Moving', color: 'orange' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setProductTab(tab.key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${productTab === tab.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {catBrandLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-600" />
          </div>
        ) : productRows.length === 0 ? (
          <p className="text-center text-gray-400 py-8">No product data for this period</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Brand</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Revenue</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Orders</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {productRows.map((p: any, i: number) => (
                  <tr key={p.product__id || i} className="hover:bg-blue-50/40 transition-colors">
                    <td className="px-3 py-2.5 text-gray-400 font-mono text-xs">{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-gray-900">{p.product__name}</span>
                      {p.product__sku && <span className="ml-2 text-xs text-gray-400 font-mono">{p.product__sku}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{p.product__category__name || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{p.product__brand__name || '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`font-semibold ${productTab === 'slow' ? 'text-orange-600' : 'text-gray-900'}`}>
                        {Math.round(p.total_quantity || 0)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-gray-900">₹{formatNumber(p.total_revenue || 0)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{p.order_count || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Category & Brand Analytics ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <SectionHeader
          title="Category & Brand Performance"
          subtitle="Revenue breakdown by product category and brand"
          icon={<Layers className="h-5 w-5 text-indigo-600" />}
        />
        {catBrandLoading ? (
          <ChartSkeleton height={200} />
        ) : (topCategories.length === 0 && topBrands.length === 0) ? (
          <p className="text-center text-gray-400 py-8">No category/brand data for this period</p>
        ) : (
          <Suspense fallback={<ChartSkeleton height={200} />}>
            <CategoryBrandChart
              categories={categoryChartData}
              brands={brandChartData}
            />
          </Suspense>
        )}
      </div>

      {/* ── Top Customers ── */}
      {topCustomers.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <SectionHeader
            title="Top Customers"
            subtitle={`${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`}
            icon={<Users className="h-5 w-5 text-blue-600" />}
          />
          {customerLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Total Spent</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Orders</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Avg Order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {topCustomers.map((c: any) => (
                    <tr key={c.customer__id} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 font-medium text-gray-900">{c.customer__name}</td>
                      <td className="px-3 py-2.5 text-gray-500">{c.customer__email || '—'}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-gray-900">₹{formatNumber(c.total_spent || 0)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{c.order_count || 0}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">₹{formatNumber(c.avg_order_value || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Annual Revenue ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <SectionHeader
            title="Annual Revenue"
            subtitle="Monthly breakdown"
            icon={<BarChart3 className="h-5 w-5 text-green-600" />}
          />
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-24 focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {revenueLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-green-600" />
          </div>
        ) : revenueData?.monthly_breakdown?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Month</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Revenue</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Invoices</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Avg Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {revenueData.monthly_breakdown.map((m: any) => (
                  <tr key={m.month} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5 font-medium text-gray-900">
                      {new Date(m.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-gray-900">₹{formatNumber(m.total_revenue || 0)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{m.invoice_count || 0}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">₹{formatNumber(m.avg_order_value || 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                <tr>
                  <td className="px-3 py-2.5 font-bold text-gray-900">Total {year}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-green-700">₹{formatNumber(revenueData.year_total || 0)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="text-center text-gray-400 py-8">No data for {year}</p>
        )}
      </div>

      {/* ── Stock Ordering (lazy) ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-center justify-between">
          <SectionHeader
            title="Inventory Alerts"
            subtitle="Out of stock & low stock ordering view"
            icon={<AlertCircle className="h-5 w-5 text-orange-500" />}
          />
          <button
            onClick={() => setShowStockOrdering(v => !v)}
            className="px-3 py-1.5 text-sm font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
          >
            {showStockOrdering ? 'Hide' : 'Show Alerts'}
          </button>
        </div>

        {showStockOrdering && (
          <div className="mt-4 space-y-6">
            {stockOrderingLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-orange-500" />
              </div>
            ) : (
              <>
                {/* Out of Stock */}
                {stockOrderingData?.out_of_stock?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-red-600 mb-2 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" /> Out of Stock ({stockOrderingData.out_of_stock.length})
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-red-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-red-600 uppercase">Product</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-red-600 uppercase">SKU</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-red-600 uppercase">Store</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-red-600 uppercase">Qty</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-red-50">
                          {stockOrderingData.out_of_stock.map((p: any, i: number) => (
                            <tr key={i} className="hover:bg-red-50/50">
                              <td className="px-3 py-2 font-medium text-gray-900">{p.product__name}</td>
                              <td className="px-3 py-2 text-gray-500 font-mono text-xs">{p.product__sku || 'N/A'}</td>
                              <td className="px-3 py-2 text-gray-500">{p.store__name || '—'}</td>
                              <td className="px-3 py-2 text-right text-red-600 font-bold">{Math.round(p.available_quantity || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {/* Low Stock */}
                {stockOrderingData?.low_stock?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-orange-600 mb-2 flex items-center gap-2">
                      <TrendingDown className="h-4 w-4" /> Low Stock ({stockOrderingData.low_stock.length})
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-orange-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-orange-600 uppercase">Product</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-orange-600 uppercase">SKU</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-orange-600 uppercase">Store</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-orange-600 uppercase">Qty</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-orange-600 uppercase">Threshold</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-orange-50">
                          {stockOrderingData.low_stock.map((p: any, i: number) => (
                            <tr key={i} className="hover:bg-orange-50/50">
                              <td className="px-3 py-2 font-medium text-gray-900">{p.product__name}</td>
                              <td className="px-3 py-2 text-gray-500 font-mono text-xs">{p.product__sku || 'N/A'}</td>
                              <td className="px-3 py-2 text-gray-500">{p.store__name || '—'}</td>
                              <td className="px-3 py-2 text-right text-orange-600 font-semibold">{Math.round(p.available_quantity || 0)}</td>
                              <td className="px-3 py-2 text-right text-gray-500">{p.product__low_stock_threshold || 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {!stockOrderingData?.out_of_stock?.length && !stockOrderingData?.low_stock?.length && (
                  <p className="text-center text-green-600 py-4 font-medium">✓ All stock levels are healthy</p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── KPI Drill-down Modal ── */}
      {drillDown && (
        <KpiDrillDownModal
          metric={drillDown.metric}
          metricLabel={drillDown.label}
          dateFrom={dateFrom}
          dateTo={dateTo}
          storeId={defaultStore?.id}
          onClose={() => setDrillDown(null)}
        />
      )}
    </div>
  );
}
