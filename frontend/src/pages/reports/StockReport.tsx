import { useQuery } from '@tanstack/react-query';
import { useState, useCallback, useEffect } from 'react';
import { reportsApi, catalogApi } from '../../lib/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';
import {
  Package, TrendingUp, TrendingDown, AlertCircle,
  Download, Calendar, Store, ChevronDown, Zap, Layers,
  BarChart2, Filter, Award, ShoppingBag,
} from 'lucide-react';
import { formatNumber, toLocalDateString } from '../../lib/utils';
import { isPosAdminContext } from '../../lib/access';
import { auth, type User } from '../../lib/auth';
import { ExportProgressOverlay, yieldToMain } from './exportProgress';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Primary shop for exports: admin picker, else user's default_store / store. */
function resolvePrimaryStore(
  stores: any[],
  user: User | null,
  selectedStoreId: number | null,
  isAdmin: boolean,
): any | null {
  if (!stores.length) return null;
  if (isAdmin && selectedStoreId) {
    return stores.find((s: any) => s.id === selectedStoreId) ?? null;
  }
  const preferredId = user?.default_store?.id ?? user?.store?.id;
  if (preferredId) {
    return stores.find((s: any) => s.id === preferredId) ?? null;
  }
  return stores.find((s: any) => s.is_active) ?? stores[0] ?? null;
}

type StockExportRow = (string | number)[];

const INV_HEADERS: StockExportRow = [
  '#', 'Status', 'Product', 'SKU', 'Category', 'Brand', 'Store',
  'Qty Available', 'Threshold', 'Cost (Rs.)',
];

function inventoryRowFromApi(p: any, index: number): StockExportRow {
  return [
    index,
    p.status || 'In Stock',
    p.product__name || '',
    p.product__sku || 'N/A',
    p.product__category__name || '—',
    p.product__brand__name || '—',
    p.store__name || '—',
    Math.round(p.available_quantity || 0),
    p.product__low_stock_threshold || 0,
    Number(p.product__cost_price || 0),
  ];
}

async function fetchAllPages(
  fetchPage: (page: number, pageSize: number) => Promise<{
    results: any[];
    has_more?: boolean;
    total_count?: number;
    [key: string]: any;
  }>,
  onProgress: (loaded: number, total: number, meta?: Record<string, any>) => void,
  pageSize = 100,
): Promise<{ rows: any[]; meta: Record<string, any> }> {
  const rows: any[] = [];
  let page = 1;
  let hasMore = true;
  let total = 0;
  let meta: Record<string, any> = {};

  while (hasMore) {
    const data = await fetchPage(page, pageSize);
    if (!data || !Array.isArray(data.results)) {
      throw new Error('Unexpected export response from server');
    }
    const batch = data.results;
    rows.push(...batch);
    if (typeof data.total_count === 'number') total = data.total_count;
    // Summary fields (in_stock_count, etc.) are present on every page.
    meta = { ...meta, ...data };
    hasMore = Boolean(data.has_more) && batch.length > 0;
    page += 1;
    onProgress(rows.length, total, meta);
    await yieldToMain();
    if (page > 500) break;
  }
  return { rows, meta };
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return toLocalDateString(d);
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function fmtShort(v: number) {
  if (v >= 10000000) return `Rs.${(v / 10000000).toFixed(1)}Cr`;
  if (v >= 100000) return `Rs.${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `Rs.${(v / 1000).toFixed(0)}K`;
  return `Rs.${v}`;
}

const CHART_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899'];

const QUICK_FILTERS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last_week', label: '7 Days' },
  { key: 'last_month', label: '30 Days' },
  { key: 'last_year', label: '1 Year' },
  { key: 'custom', label: 'Custom' },
];

type ProductTab = 'sold' | 'fast' | 'slow' | 'out_of_stock' | 'low_stock';

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiTile({
  label, value, sub, icon, color, loading,
}: {
  label: string; value: string; sub?: string;
  icon: React.ReactNode; color: string; loading?: boolean;
}) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm p-5`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg bg-${color}-50`}>{icon}</div>
      </div>
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">
        {loading
          ? <span className="inline-block h-7 w-28 bg-gray-100 rounded animate-pulse" />
          : value}
      </p>
      {sub && !loading && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StockReport() {
  const user = auth.getUser();
  const isAdmin = isPosAdminContext(user);

  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState(() => toLocalDateString(new Date()));
  const [dateTo, setDateTo] = useState(() => toLocalDateString(new Date()));
  const [activeDateFilter, setActiveDateFilter] = useState('today');
  const [activeTab, setActiveTab] = useState<ProductTab>('fast');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [excelExporting, setExcelExporting] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{
    kind: 'excel' | 'pdf';
    percent: number;
    label: string;
  } | null>(null);
  const isExporting = excelExporting || pdfExporting;

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

  const primaryStore = resolvePrimaryStore(stores, user, selectedStoreId, isAdmin);
  const storeId = primaryStore?.id;

  useEffect(() => {
    if (isAdmin && !selectedStoreId && stores.length > 0) {
      const first = stores.find((s: any) => s.is_active) || stores[0];
      if (first) setSelectedStoreId(first.id);
    }
  }, [isAdmin, selectedStoreId, stores]);

  // ── Quick date filter handler ──
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
      default: break;
    }
  }, []);

  // ── Analytics (KPIs) ──
  const { data: analyticsData, isLoading: analyticsLoading } = useQuery({
    queryKey: ['stock-report-analytics', dateFrom, dateTo, storeId],
    queryFn: async () => (await reportsApi.analyticsComparison({
      date_from: dateFrom,
      date_to: dateTo,
      store: storeId || undefined,
    })).data,
    enabled: !!storeId,
    retry: false,
  });

  // ── Sold products ──
  const { data: stockSoldData, isLoading: stockSoldLoading } = useQuery({
    queryKey: ['stock-sold', dateFrom, dateTo, storeId],
    queryFn: async () => (await reportsApi.stockSold({
      date_from: dateFrom,
      date_to: dateTo,
      store: storeId || undefined,
    })).data,
    enabled: !!storeId,
    retry: false,
  });

  // ── Category + Brand (fast/slow) ──
  const { data: catBrandData, isLoading: catBrandLoading } = useQuery({
    queryKey: ['stock-report-catbrand', dateFrom, dateTo, storeId, filterCategory, filterBrand],
    queryFn: async () => (await reportsApi.categoryBrandAnalytics({
      date_from: dateFrom,
      date_to: dateTo,
      store: storeId || undefined,
      category: filterCategory || undefined,
      brand: filterBrand || undefined,
      limit: 20,
    })).data,
    enabled: !!storeId,
    retry: false,
  });

  // ── Stock ordering (out of stock / low stock) ──
  const { data: stockOrderingData, isLoading: stockOrderingLoading } = useQuery({
    queryKey: ['stock-ordering', storeId],
    queryFn: async () => (await reportsApi.stockOrdering({ store: storeId || undefined })).data,
    enabled: !!storeId,
    retry: false,
  });

  // ── Derived data ──
  const curr = analyticsData?.current || {};

  const soldProducts: any[] = (() => {
    if (!stockSoldData) return [];
    if (Array.isArray(stockSoldData.products)) return stockSoldData.products;
    if (Array.isArray(stockSoldData.results)) return stockSoldData.results;
    if (Array.isArray(stockSoldData.data)) return stockSoldData.data;
    if (Array.isArray(stockSoldData)) return stockSoldData;
    return [];
  })();

  const fastSelling: any[] = catBrandData?.fast_selling || [];
  const slowMoving: any[] = catBrandData?.slow_moving || [];
  const topCategories: any[] = catBrandData?.top_categories || [];
  const topBrands: any[] = catBrandData?.top_brands || [];
  const outOfStock: any[] = stockOrderingData?.out_of_stock || [];
  const lowStock: any[] = stockOrderingData?.low_stock || [];

  // Top 10 products by revenue for chart (from fastSelling or soldProducts)
  const chartProducts = [...fastSelling]
    .sort((a, b) => (b.total_revenue || 0) - (a.total_revenue || 0))
    .slice(0, 10);

  // Category pie chart data
  const categoryPieData = topCategories.slice(0, 6).map((c: any, i: number) => ({
    name: c.product__category__name || 'Unknown',
    value: Number(c.total_revenue || 0),
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  // Available filter options
  const availableCategories = topCategories.map((c: any) => ({
    id: c.product__category__id,
    name: c.product__category__name || 'Unknown',
  }));
  const availableBrands = topBrands.map((b: any) => ({
    id: b.product__brand__id,
    name: b.product__brand__name || 'Unknown',
  }));

  // ── Active tab data ──
  const tabData = (() => {
    switch (activeTab) {
      case 'fast': return fastSelling;
      case 'slow': return slowMoving;
      case 'out_of_stock': return outOfStock;
      case 'low_stock': return lowStock;
      default: return soldProducts;
    }
  })();

  const isTabLoading = activeTab === 'sold' ? stockSoldLoading
    : activeTab === 'out_of_stock' || activeTab === 'low_stock' ? stockOrderingLoading
    : catBrandLoading;

  // ── Excel Export (lean paginated APIs) ──
  const handleExportExcel = useCallback(async () => {
    if (!storeId || isExporting) return;
    setExcelExporting(true);
    setExportProgress({ kind: 'excel', percent: 3, label: 'Starting export…' });
    try {
      const xlsxPromise = import('xlsx');

      setExportProgress({ kind: 'excel', percent: 8, label: 'Loading inventory…' });
      const { rows: inventory, meta: invMeta } = await fetchAllPages(
        async (page, pageSize) =>
          (await reportsApi.stockInventoryExport({ store: storeId, page, page_size: pageSize })).data,
        (loaded, total) => {
          const pct = total > 0 ? 8 + (Math.min(loaded, total) / total) * 35 : Math.min(40, 8 + loaded / 20);
          setExportProgress({
            kind: 'excel',
            percent: pct,
            label: total > 0
              ? `Loading inventory ${Math.min(loaded, total)} / ${total}…`
              : `Loading inventory (${loaded})…`,
          });
        },
      );

      setExportProgress({ kind: 'excel', percent: 48, label: 'Loading sold products…' });
      const { rows: sold } = await fetchAllPages(
        async (page, pageSize) =>
          (await reportsApi.stockSoldExport({
            store: storeId,
            date_from: dateFrom,
            date_to: dateTo,
            page,
            page_size: pageSize,
          })).data,
        (loaded, total) => {
          const pct = total > 0 ? 48 + (Math.min(loaded, total) / total) * 30 : Math.min(75, 48 + loaded / 20);
          setExportProgress({
            kind: 'excel',
            percent: pct,
            label: total > 0
              ? `Loading sold products ${Math.min(loaded, total)} / ${total}…`
              : `Loading sold products (${loaded})…`,
          });
        },
      );

      setExportProgress({ kind: 'excel', percent: 82, label: 'Building spreadsheet…' });
      await yieldToMain();
      const XLSX = await xlsxPromise;

      const invRows = inventory.map((p, i) => inventoryRowFromApi(p, i + 1));
      const wb = XLSX.utils.book_new();
      const wsInv = XLSX.utils.aoa_to_sheet([INV_HEADERS, ...invRows]);
      wsInv['!cols'] = [
        { wch: 5 }, { wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 16 }, { wch: 16 },
        { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 12 },
      ];
      XLSX.utils.book_append_sheet(wb, wsInv, 'Stock Inventory');

      const soldHeaders = ['Product', 'SKU', 'Category', 'Brand', 'Qty Sold', 'Revenue (Rs.)', 'Invoices', 'Remaining Stock'];
      const soldRows = sold.map((p: any) => [
        p.product__name || '',
        p.product__sku || 'N/A',
        p.product__category__name || '—',
        p.product__brand__name || '—',
        Math.round(p.total_quantity || 0),
        Number(p.total_revenue || 0),
        p.order_count || 0,
        p.available_quantity != null ? Math.round(p.available_quantity) : '—',
      ]);
      if (soldRows.length > 0) {
        const wsSold = XLSX.utils.aoa_to_sheet([soldHeaders, ...soldRows]);
        wsSold['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 10 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, wsSold, `Sold ${dateFrom} to ${dateTo}`);
      }

      setExportProgress({
        kind: 'excel',
        percent: 95,
        label: `Writing file (${invMeta.in_stock_count ?? '—'} in stock, ${invMeta.out_of_stock_count ?? '—'} out)…`,
      });
      await yieldToMain();
      const storeSlug = (primaryStore?.name || 'store').replace(/\s+/g, '-').slice(0, 24);
      XLSX.writeFile(wb, `stock-report-${storeSlug}-${dateFrom}-to-${dateTo}.xlsx`);
      setExportProgress({ kind: 'excel', percent: 100, label: 'Done' });
      await new Promise((r) => setTimeout(r, 450));
    } catch (err) {
      console.error('Stock Excel export failed', err);
      window.alert(
        'Stock report export failed. The server may be low on memory — try again, or use a single store filter.',
      );
    } finally {
      setExcelExporting(false);
      setExportProgress(null);
    }
  }, [storeId, primaryStore?.name, dateFrom, dateTo, isExporting]);

  // ── PDF Export (lean paginated APIs) ──
  const handleExportPdf = useCallback(async () => {
    if (!storeId || isExporting) return;
    setPdfExporting(true);
    setExportProgress({ kind: 'pdf', percent: 5, label: 'Starting PDF…' });
    try {
      setExportProgress({ kind: 'pdf', percent: 12, label: 'Loading inventory…' });
      const { rows: inventory, meta: invMeta } = await fetchAllPages(
        async (page, pageSize) =>
          (await reportsApi.stockInventoryExport({ store: storeId, page, page_size: pageSize })).data,
        (loaded, total) => {
          const pct = total > 0 ? 12 + (Math.min(loaded, total) / total) * 30 : Math.min(40, 12 + loaded / 20);
          setExportProgress({
            kind: 'pdf',
            percent: pct,
            label: total > 0
              ? `Loading inventory ${Math.min(loaded, total)} / ${total}…`
              : `Loading inventory (${loaded})…`,
          });
        },
      );

      setExportProgress({ kind: 'pdf', percent: 45, label: 'Loading sold products…' });
      const { rows: sold } = await fetchAllPages(
        async (page, pageSize) =>
          (await reportsApi.stockSoldExport({
            store: storeId,
            date_from: dateFrom,
            date_to: dateTo,
            page,
            page_size: pageSize,
          })).data,
        (loaded, total) => {
          const pct = total > 0 ? 45 + (Math.min(loaded, total) / total) * 20 : Math.min(62, 45 + loaded / 20);
          setExportProgress({
            kind: 'pdf',
            percent: pct,
            label: total > 0
              ? `Loading sold products ${Math.min(loaded, total)} / ${total}…`
              : `Loading sold products (${loaded})…`,
          });
        },
      );

      setExportProgress({ kind: 'pdf', percent: 68, label: 'Loading PDF engine…' });
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      setExportProgress({ kind: 'pdf', percent: 78, label: 'Building PDF pages…' });
      await yieldToMain();

      const invRows = inventory.map((p, i) => inventoryRowFromApi(p, i + 1));
      const inCount = Number(invMeta.in_stock_count) || inventory.filter((p) => p.status !== 'Out of Stock').length;
      const oosCount = Number(invMeta.out_of_stock_count) || inventory.filter((p) => p.status === 'Out of Stock').length;

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      let y = 14;

      doc.setFillColor(59, 130, 246);
      doc.rect(0, 0, pageW, 28, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('Stock Report', pageW / 2, 12, { align: 'center' });
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `${primaryStore?.name || 'Store'}  |  Purchased inventory  |  Sales: ${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`,
        pageW / 2, 22, { align: 'center' }
      );
      doc.setTextColor(0, 0, 0);
      y = 36;

      const kpis = [
        { label: 'In Stock', value: String(inCount), color: [16, 185, 129] as [number, number, number] },
        { label: 'Out of Stock', value: String(oosCount), color: [239, 68, 68] as [number, number, number] },
        { label: 'Items Sold', value: String(Math.round(curr.items_sold || 0)), color: [139, 92, 246] as [number, number, number] },
        { label: 'Revenue', value: `Rs.${formatNumber(curr.total_sales || 0)}`, color: [245, 158, 11] as [number, number, number] },
      ];
      const cardW = (pageW - 28) / 4;
      const cardH = 20;
      kpis.forEach((kpi, i) => {
        const x = 14 + i * (cardW + 2);
        doc.setFillColor(...kpi.color);
        doc.roundedRect(x, y, cardW, cardH, 3, 3, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.text(kpi.label, x + cardW / 2, y + 7, { align: 'center' });
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(kpi.value, x + cardW / 2, y + 15, { align: 'center' });
      });
      doc.setTextColor(0, 0, 0);
      y += cardH + 10;

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Purchased products — in stock first, out of stock last', 14, y);
      y += 4;
      autoTable(doc, {
        startY: y,
        head: [['#', 'Status', 'Product', 'SKU', 'Category', 'Qty', 'Store']],
        body: invRows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[7], r[6]]),
        styles: { fontSize: 7 },
        headStyles: { fillColor: [99, 102, 241] },
        didParseCell: (data) => {
          if (data.section !== 'body' || data.column.index !== 1) return;
          const status = String(data.cell.raw || '');
          if (status === 'Out of Stock') {
            data.cell.styles.textColor = [220, 38, 38];
          } else if (status === 'Low Stock') {
            data.cell.styles.textColor = [234, 88, 12];
          }
        },
      });
      y = (doc as any).lastAutoTable.finalY + 8;

      if (sold.length > 0) {
        if (y > 230) { doc.addPage(); y = 14; }
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(`Products sold (${fmtDate(dateFrom)} – ${fmtDate(dateTo)})`, 14, y);
        y += 4;
        autoTable(doc, {
          startY: y,
          head: [['Product', 'SKU', 'Qty Sold', 'Revenue', 'Remaining Stock']],
          body: sold.map((p: any) => [
            p.product__name || '',
            p.product__sku || 'N/A',
            Math.round(p.total_quantity || 0),
            `Rs.${formatNumber(p.total_revenue || 0)}`,
            p.available_quantity != null ? Math.round(p.available_quantity) : '—',
          ]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [59, 130, 246] },
        });
      }

      setExportProgress({ kind: 'pdf', percent: 95, label: 'Saving PDF…' });
      await yieldToMain();
      const storeSlug = (primaryStore?.name || 'store').replace(/\s+/g, '-').slice(0, 24);
      doc.save(`stock-report-${storeSlug}-${dateFrom}-to-${dateTo}.pdf`);
      setExportProgress({ kind: 'pdf', percent: 100, label: 'Done' });
      await new Promise((r) => setTimeout(r, 450));
    } catch (err) {
      console.error('Stock PDF export failed', err);
      window.alert('Stock PDF export failed. Please try again.');
    } finally {
      setPdfExporting(false);
      setExportProgress(null);
    }
  }, [storeId, primaryStore?.name, curr, dateFrom, dateTo, isExporting]);

  // ── Tab columns ──
  const renderTable = () => {
    if (isTabLoading) {
      return (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      );
    }

    if (tabData.length === 0) {
      return <p className="text-center text-gray-400 py-10">No data available</p>;
    }

    if (activeTab === 'out_of_stock') {
      return (
        <table className="w-full text-sm">
          <thead className="bg-red-50">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-red-600 uppercase">#</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-red-600 uppercase">Product</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-red-600 uppercase">SKU</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-red-600 uppercase">Store</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-red-600 uppercase">Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tabData.map((p: any, i: number) => (
              <tr key={i} className="hover:bg-red-50/40">
                <td className="px-3 py-2.5 text-gray-400 text-xs font-mono">{i + 1}</td>
                <td className="px-3 py-2.5 font-medium text-gray-900">{p.product__name}</td>
                <td className="px-3 py-2.5 text-gray-400 font-mono text-xs">{p.product__sku || 'N/A'}</td>
                <td className="px-3 py-2.5 text-gray-500">{p.store__name || '—'}</td>
                <td className="px-3 py-2.5 text-right font-bold text-red-600">{Math.round(p.available_quantity || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (activeTab === 'low_stock') {
      return (
        <table className="w-full text-sm">
          <thead className="bg-orange-50">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-orange-600 uppercase">#</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-orange-600 uppercase">Product</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-orange-600 uppercase">SKU</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-orange-600 uppercase">Store</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-orange-600 uppercase">Qty</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-orange-600 uppercase">Threshold</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tabData.map((p: any, i: number) => (
              <tr key={i} className="hover:bg-orange-50/40">
                <td className="px-3 py-2.5 text-gray-400 text-xs font-mono">{i + 1}</td>
                <td className="px-3 py-2.5 font-medium text-gray-900">{p.product__name}</td>
                <td className="px-3 py-2.5 text-gray-400 font-mono text-xs">{p.product__sku || 'N/A'}</td>
                <td className="px-3 py-2.5 text-gray-500">{p.store__name || '—'}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-orange-600">{Math.round(p.available_quantity || 0)}</td>
                <td className="px-3 py-2.5 text-right text-gray-400">{p.product__low_stock_threshold || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    // All Products Sold – includes remaining stock column
    if (activeTab === 'sold') {
      return (
        <table className="w-full text-sm">
          <thead className="bg-indigo-50">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-indigo-600 uppercase">#</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-indigo-600 uppercase">Product</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-indigo-600 uppercase">Category</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-indigo-600 uppercase">Brand</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-indigo-600 uppercase">Qty Sold</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-indigo-600 uppercase">Revenue</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-indigo-600 uppercase">Invoices</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-indigo-600 uppercase">Remaining Stock</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tabData.map((p: any, i: number) => {
              const remaining = p.available_quantity != null ? p.available_quantity : (p.remaining_stock ?? p.current_stock ?? null);
              return (
                <tr key={p.product__id || i} className="hover:bg-indigo-50/30 transition-colors">
                  <td className="px-3 py-2.5 text-gray-400 text-xs font-mono">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-gray-900">{p.product__name}</span>
                    {p.product__sku && <span className="ml-2 text-xs text-gray-400 font-mono">{p.product__sku}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-gray-500">{p.product__category__name || '—'}</td>
                  <td className="px-3 py-2.5 text-gray-500">{p.product__brand__name || '—'}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-gray-900">{Math.round(p.total_quantity || 0)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-gray-900">₹{formatNumber(p.total_revenue || 0)}</td>
                  <td className="px-3 py-2.5 text-right text-gray-500">{p.order_count || 0}</td>
                  <td className="px-3 py-2.5 text-right">
                    {remaining === null ? (
                      <span className="text-gray-400">—</span>
                    ) : remaining <= 0 ? (
                      <span className="font-bold text-red-600">0</span>
                    ) : remaining <= 5 ? (
                      <span className="font-semibold text-orange-500">{Math.round(remaining)}</span>
                    ) : (
                      <span className="font-semibold text-green-600">{Math.round(remaining)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      );
    }

    // fast / slow – same column structure
    return (
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">#</th>
            <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
            <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
            <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Brand</th>
            <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Qty Sold</th>
            <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Revenue</th>
            <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Invoices</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {tabData.map((p: any, i: number) => (
            <tr key={p.product__id || i} className="hover:bg-blue-50/30 transition-colors">
              <td className="px-3 py-2.5 text-gray-400 text-xs font-mono">{i + 1}</td>
              <td className="px-3 py-2.5">
                <span className="font-medium text-gray-900">{p.product__name}</span>
                {p.product__sku && <span className="ml-2 text-xs text-gray-400 font-mono">{p.product__sku}</span>}
              </td>
              <td className="px-3 py-2.5 text-gray-500">{p.product__category__name || '—'}</td>
              <td className="px-3 py-2.5 text-gray-500">{p.product__brand__name || '—'}</td>
              <td className="px-3 py-2.5 text-right">
                <span className={`font-semibold ${activeTab === 'slow' ? 'text-orange-600' : 'text-gray-900'}`}>
                  {Math.round(p.total_quantity || 0)}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right font-semibold text-gray-900">
                ₹{formatNumber(p.total_revenue || 0)}
              </td>
              <td className="px-3 py-2.5 text-right text-gray-500">{p.order_count || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  // ── Render ──
  return (
    <div className="space-y-6 pb-12">
      <ExportProgressOverlay
        open={isExporting && !!exportProgress}
        title={exportProgress?.kind === 'pdf' ? 'Exporting Stock PDF' : 'Exporting Stock Report'}
        label={exportProgress?.label || 'Working…'}
        percent={exportProgress?.percent ?? 0}
      />

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-xl">
            <Package className="h-7 w-7 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Stock Report</h1>
            <p className="text-sm text-gray-500">Sold products · Fast / Slow movers · Stock alerts</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Store Selector */}
          {isAdmin && stores.length > 0 && (
            <div className="relative">
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm hover:border-indigo-400 transition-colors cursor-pointer">
                <Store className="h-4 w-4 text-indigo-500" />
                <span className="text-sm font-medium text-gray-800 truncate max-w-[140px]">
                  {primaryStore?.name || 'Select Store'}
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
          {/* Export Excel */}
          <button
            onClick={handleExportExcel}
            disabled={isExporting || !storeId}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors shadow-sm disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {excelExporting ? 'Exporting…' : 'Export Excel'}
          </button>
          {/* Export PDF */}
          <button
            onClick={handleExportPdf}
            disabled={isExporting || !storeId}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {pdfExporting ? 'Generating…' : 'Export PDF'}
          </button>
        </div>
      </div>

      {/* ── Date Filter ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {QUICK_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setDateFilter(f.key)}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-lg transition-colors ${activeDateFilter === f.key
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {activeDateFilter === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-400" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setActiveDateFilter('custom'); }}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <span className="text-gray-400">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setActiveDateFilter('custom'); }}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>
        )}
        <p className="text-xs text-gray-400">
          Store: <strong>{primaryStore?.name || '—'}</strong>
          {' · '}
          Sales period: <strong>{fmtDate(dateFrom)}</strong> – <strong>{fmtDate(dateTo)}</strong>
        </p>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label="Total Revenue"
          value={`₹${formatNumber(curr.total_sales || 0)}`}
          icon={<TrendingUp className="h-5 w-5 text-green-600" />}
          color="green"
          loading={analyticsLoading}
        />
        <KpiTile
          label="Total Invoices"
          value={String(curr.total_invoices || 0)}
          icon={<ShoppingBag className="h-5 w-5 text-blue-600" />}
          color="blue"
          loading={analyticsLoading}
        />
        <KpiTile
          label="Units Sold"
          value={String(Math.round(curr.items_sold || 0))}
          icon={<Package className="h-5 w-5 text-indigo-600" />}
          color="indigo"
          loading={analyticsLoading}
        />
        <KpiTile
          label="Avg Order Value"
          value={`₹${formatNumber(curr.avg_order_value || 0)}`}
          icon={<BarChart2 className="h-5 w-5 text-yellow-600" />}
          color="yellow"
          loading={analyticsLoading}
        />
      </div>

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Top Products by Revenue */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-5 w-5 text-yellow-500" />
            <h2 className="text-base font-bold text-gray-900">Top Products by Revenue</h2>
          </div>
          {catBrandLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-indigo-600" />
            </div>
          ) : chartProducts.length === 0 ? (
            <p className="text-center text-gray-400 py-12">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartProducts} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                <XAxis type="number" tickFormatter={fmtShort} tick={{ fontSize: 10 }} />
                <YAxis
                  type="category"
                  dataKey="product__name"
                  tick={{ fontSize: 10 }}
                  width={110}
                  tickFormatter={(v: string) => v?.length > 14 ? v.slice(0, 13) + '…' : v}
                />
                <Tooltip formatter={(v: any) => [`₹${formatNumber(v)}`, 'Revenue']} cursor={{ fill: '#f8fafc' }} />
                <Bar dataKey="total_revenue" radius={[0, 4, 4, 0]} maxBarSize={18}>
                  {chartProducts.map((_: any, i: number) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Category Revenue Breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="h-5 w-5 text-indigo-500" />
            <h2 className="text-base font-bold text-gray-900">Revenue by Category</h2>
          </div>
          {catBrandLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-indigo-600" />
            </div>
          ) : categoryPieData.length === 0 ? (
            <p className="text-center text-gray-400 py-12">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={categoryPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }) => `${name?.slice(0, 10)} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                  fontSize={10}
                >
                  {categoryPieData.map((entry: any, i: number) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: any) => [`₹${formatNumber(v)}`, 'Revenue']} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Product Analysis Tabs ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-indigo-600" />
            <h2 className="text-base font-bold text-gray-900">Product Analysis</h2>
          </div>

          {/* Category + Brand Filters (only for fast/slow tabs — sold uses stockSold endpoint) */}
          {(activeTab === 'fast' || activeTab === 'slow') && (
            <div className="flex gap-2 flex-wrap">
              <div className="relative">
                <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="text-sm pl-7 pr-3 py-1.5 border border-gray-200 rounded-lg appearance-none bg-white focus:ring-2 focus:ring-indigo-500"
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
                  className="text-sm pl-7 pr-3 py-1.5 border border-gray-200 rounded-lg appearance-none bg-white focus:ring-2 focus:ring-indigo-500"
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
          )}
        </div>

        {/* Tab switcher */}
        <div className="flex flex-wrap gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit">
          {[
            { key: 'sold' as ProductTab, label: '📦 All Products' },
            { key: 'fast' as ProductTab, label: '⚡ Fast Selling' },
            { key: 'slow' as ProductTab, label: '🐢 Slow Moving' },
            { key: 'out_of_stock' as ProductTab, label: '🚫 Out of Stock' },
            { key: 'low_stock' as ProductTab, label: '⚠️ Low Stock' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${activeTab === tab.key
                ? 'bg-white shadow-sm text-gray-900'
                : 'text-gray-500 hover:text-gray-700'}`}
            >
              {tab.label}
              {tab.key === 'out_of_stock' && outOfStock.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-red-100 text-red-600 rounded-full">{outOfStock.length}</span>
              )}
              {tab.key === 'low_stock' && lowStock.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-orange-100 text-orange-600 rounded-full">{lowStock.length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          {renderTable()}
        </div>
      </div>

      {/* ── Summary Cards: Low Stock count + Out of Stock count ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-3">
          <div className="p-2 bg-green-50 rounded-lg"><TrendingUp className="h-5 w-5 text-green-600" /></div>
          <div>
            <p className="text-xs text-gray-500">Fast Selling</p>
            <p className="text-xl font-bold text-green-700">{fastSelling.length} products</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-3">
          <div className="p-2 bg-orange-50 rounded-lg"><TrendingDown className="h-5 w-5 text-orange-600" /></div>
          <div>
            <p className="text-xs text-gray-500">Slow Moving</p>
            <p className="text-xl font-bold text-orange-700">{slowMoving.length} products</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-3">
          <div className="p-2 bg-red-50 rounded-lg"><AlertCircle className="h-5 w-5 text-red-600" /></div>
          <div>
            <p className="text-xs text-gray-500">Out of Stock</p>
            <p className="text-xl font-bold text-red-700">{outOfStock.length} items</p>
          </div>
        </div>
      </div>

    </div>
  );
}
