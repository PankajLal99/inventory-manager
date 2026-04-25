import { useQuery } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import { reportsApi, catalogApi } from '../../lib/api';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
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
import { auth } from '../../lib/auth';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  const [dateFrom, setDateFrom] = useState(() => addDays(toLocalDateString(new Date()), -30));
  const [dateTo, setDateTo] = useState(() => toLocalDateString(new Date()));
  const [activeDateFilter, setActiveDateFilter] = useState('last_month');
  const [activeTab, setActiveTab] = useState<ProductTab>('fast');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [excelExporting, setExcelExporting] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);

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

  const currentStore = stores.find((s: any) => s.id === selectedStoreId)
    || stores.find((s: any) => s.is_active)
    || stores[0];

  const storeId = currentStore?.id;

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
    enabled: !!storeId && (activeTab === 'out_of_stock' || activeTab === 'low_stock'),
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

  // ── Excel Export ──
  const handleExportExcel = useCallback(async () => {
    setExcelExporting(true);
    try {
      // Sheet 1: Sold Products
      const soldHeaders = ['Product', 'SKU', 'Category', 'Brand', 'Qty Sold', 'Revenue (Rs.)', 'Invoices'];
      const soldRows = fastSelling.map((p: any) => [
        p.product__name || '',
        p.product__sku || 'N/A',
        p.product__category__name || '—',
        p.product__brand__name || '—',
        Math.round(p.total_quantity || 0),
        Number(p.total_revenue || 0),
        p.order_count || 0,
      ]);

      // Sheet 2: Slow Moving
      const slowHeaders = ['Product', 'SKU', 'Category', 'Brand', 'Qty Sold', 'Revenue (Rs.)', 'Invoices'];
      const slowRows = slowMoving.map((p: any) => [
        p.product__name || '',
        p.product__sku || 'N/A',
        p.product__category__name || '—',
        p.product__brand__name || '—',
        Math.round(p.total_quantity || 0),
        Number(p.total_revenue || 0),
        p.order_count || 0,
      ]);

      // Sheet 3: Out of Stock
      const oosHeaders = ['Product', 'SKU', 'Store', 'Qty Available'];
      const oosRows = outOfStock.map((p: any) => [
        p.product__name || '',
        p.product__sku || 'N/A',
        p.store__name || '—',
        Math.round(p.available_quantity || 0),
      ]);

      // Sheet 4: Low Stock
      const lowHeaders = ['Product', 'SKU', 'Store', 'Qty Available', 'Threshold'];
      const lowRows = lowStock.map((p: any) => [
        p.product__name || '',
        p.product__sku || 'N/A',
        p.store__name || '—',
        Math.round(p.available_quantity || 0),
        p.product__low_stock_threshold || 0,
      ]);

      const wb = XLSX.utils.book_new();

      const ws1 = XLSX.utils.aoa_to_sheet([soldHeaders, ...soldRows]);
      ws1['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, ws1, 'Fast Selling Products');

      const ws2 = XLSX.utils.aoa_to_sheet([slowHeaders, ...slowRows]);
      ws2['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, ws2, 'Slow Moving Products');

      const ws3 = XLSX.utils.aoa_to_sheet([oosHeaders, ...oosRows]);
      ws3['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 20 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws3, 'Out of Stock');

      const ws4 = XLSX.utils.aoa_to_sheet([lowHeaders, ...lowRows]);
      ws4['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 20 }, { wch: 14 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, ws4, 'Low Stock');

      XLSX.writeFile(wb, `stock-report-${dateFrom}-to-${dateTo}.xlsx`);
    } finally {
      setExcelExporting(false);
    }
  }, [fastSelling, slowMoving, outOfStock, lowStock, dateFrom, dateTo]);

  // ── PDF Export ──
  const handleExportPdf = useCallback(async () => {
    setPdfExporting(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      let y = 14;

      // ── Title block ──
      doc.setFillColor(59, 130, 246);
      doc.rect(0, 0, pageW, 28, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('Stock Report', pageW / 2, 12, { align: 'center' });
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `${currentStore?.name || 'All Stores'}  |  ${fmtDate(dateFrom)} to ${fmtDate(dateTo)}`,
        pageW / 2, 22, { align: 'center' }
      );
      doc.setTextColor(0, 0, 0);
      y = 36;

      // ── KPI Cards ──
      const kpis = [
        { label: 'Total Revenue', value: `Rs.${formatNumber(curr.total_sales || 0)}`, color: [16, 185, 129] as [number,number,number] },
        { label: 'Total Invoices', value: String(curr.total_invoices || 0), color: [59, 130, 246] as [number,number,number] },
        { label: 'Items Sold', value: String(Math.round(curr.items_sold || 0)), color: [139, 92, 246] as [number,number,number] },
        { label: 'Avg Order Value', value: `Rs.${formatNumber(curr.avg_order_value || 0)}`, color: [245, 158, 11] as [number,number,number] },
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

      // ── Fast Selling Products ──
      if (fastSelling.length > 0) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Fast Selling Products', 14, y);
        y += 4;
        autoTable(doc, {
          startY: y,
          head: [['Product', 'Category', 'Brand', 'Qty Sold', 'Revenue']],
          body: fastSelling.slice(0, 15).map((p: any) => [
            p.product__name || '',
            p.product__category__name || '—',
            p.product__brand__name || '—',
            Math.round(p.total_quantity || 0),
            `Rs.${formatNumber(p.total_revenue || 0)}`,
          ]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [99, 102, 241] },
        });
        y = (doc as any).lastAutoTable.finalY + 8;
      }

      // ── Slow Moving Products ──
      if (slowMoving.length > 0) {
        if (y > 230) { doc.addPage(); y = 14; }
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Slow Moving Products', 14, y);
        y += 4;
        autoTable(doc, {
          startY: y,
          head: [['Product', 'Category', 'Brand', 'Qty Sold', 'Revenue']],
          body: slowMoving.slice(0, 15).map((p: any) => [
            p.product__name || '',
            p.product__category__name || '—',
            p.product__brand__name || '—',
            Math.round(p.total_quantity || 0),
            `Rs.${formatNumber(p.total_revenue || 0)}`,
          ]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [249, 115, 22] },
        });
        y = (doc as any).lastAutoTable.finalY + 8;
      }

      // ── Out of Stock ──
      if (outOfStock.length > 0) {
        if (y > 230) { doc.addPage(); y = 14; }
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Out of Stock', 14, y);
        y += 4;
        autoTable(doc, {
          startY: y,
          head: [['Product', 'SKU', 'Store', 'Qty']],
          body: outOfStock.slice(0, 20).map((p: any) => [
            p.product__name || '',
            p.product__sku || 'N/A',
            p.store__name || '—',
            Math.round(p.available_quantity || 0),
          ]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [239, 68, 68] },
        });
        y = (doc as any).lastAutoTable.finalY + 8;
      }

      // ── Low Stock ──
      if (lowStock.length > 0) {
        if (y > 230) { doc.addPage(); y = 14; }
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Low Stock Items', 14, y);
        y += 4;
        autoTable(doc, {
          startY: y,
          head: [['Product', 'SKU', 'Store', 'Qty', 'Threshold']],
          body: lowStock.slice(0, 20).map((p: any) => [
            p.product__name || '',
            p.product__sku || 'N/A',
            p.store__name || '—',
            Math.round(p.available_quantity || 0),
            p.product__low_stock_threshold || 0,
          ]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [245, 158, 11] },
        });
      }

      // ── Top Categories ──
      if (topCategories.length > 0) {
        if (y > 230) { doc.addPage(); y = 14; }
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Top Categories', 14, y);
        y += 4;
        autoTable(doc, {
          startY: y,
          head: [['Category', 'Revenue', 'Qty', 'Invoices']],
          body: topCategories.map((c: any) => [
            c.product__category__name || 'Unknown',
            `Rs.${formatNumber(c.total_revenue || 0)}`,
            Math.round(c.total_quantity || 0),
            c.order_count || 0,
          ]),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [16, 185, 129] },
        });
      }

      doc.save(`stock-report-${dateFrom}-to-${dateTo}.pdf`);
    } finally {
      setPdfExporting(false);
    }
  }, [curr, fastSelling, slowMoving, outOfStock, lowStock, topCategories, dateFrom, dateTo, currentStore]);

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
              const remaining = p.available_quantity ?? p.remaining_stock ?? p.current_stock ?? null;
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
          {/* Export Excel */}
          <button
            onClick={handleExportExcel}
            disabled={excelExporting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors shadow-sm disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {excelExporting ? 'Exporting…' : 'Export Excel'}
          </button>
          {/* Export PDF */}
          <button
            onClick={handleExportPdf}
            disabled={pdfExporting}
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
          Showing: <strong>{fmtDate(dateFrom)}</strong> – <strong>{fmtDate(dateTo)}</strong>
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
