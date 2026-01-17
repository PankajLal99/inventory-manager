import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { reportsApi, catalogApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import { 
  BarChart3, 
  TrendingUp,
  Package,
  Coins,
  Calendar,
  Download,
  Store,
  ChevronDown,
} from 'lucide-react';

export default function Reports() {
  const [user, setUser] = useState(auth.getUser());
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  
  useEffect(() => {
    if (!user) {
      auth.loadUser().then((loadedUser) => {
        setUser(loadedUser);
      });
    }
  }, [user]);
  
  // Check if user can access reports
  const canAccessReports = user?.can_access_reports !== false;
  
  if (user && !canAccessReports) {
    return <Navigate to="/" replace />;
  }

  // Fetch stores (already filtered by backend based on user groups)
  const { data: storesResponse } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => {
      const response = await catalogApi.stores.list();
      return response.data;
    },
    retry: false,
  });

  const stores = (() => {
    if (!storesResponse) return [];
    if (Array.isArray(storesResponse.results)) return storesResponse.results;
    if (Array.isArray(storesResponse.data)) return storesResponse.data;
    if (Array.isArray(storesResponse)) return storesResponse;
    return [];
  })();

  // Check if user is Admin (only Admin group gets store selector)
  const isAdmin = user?.is_admin || user?.is_superuser || user?.is_staff || 
    (user?.groups && user.groups.includes('Admin'));

  // Determine the active store:
  // - For Admin: Use selectedStoreId if set, otherwise first active store
  // - For others: Auto-select first active store (filtered by backend)
  const defaultStore = (() => {
    if (isAdmin && selectedStoreId) {
      return stores.find((s: any) => s.id === selectedStoreId) || stores.find((s: any) => s.is_active) || stores[0];
    }
    return stores.find((s: any) => s.is_active) || stores[0];
  })();

  // Update selectedStoreId when stores load and Admin hasn't selected one yet
  useEffect(() => {
    if (isAdmin && !selectedStoreId && stores.length > 0) {
      const firstActiveStore = stores.find((s: any) => s.is_active) || stores[0];
      if (firstActiveStore) {
        setSelectedStoreId(firstActiveStore.id);
      }
    }
  }, [isAdmin, selectedStoreId, stores]);

  // Get current selected store for display
  const currentStore = stores.find((s: any) => s.id === selectedStoreId);
  
  const [dateFrom, setDateFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [year, setYear] = useState(new Date().getFullYear());
  const [activeDateFilter, setActiveDateFilter] = useState<string>('custom');
  const [showStockReports, setShowStockReports] = useState(false);

  // Sales Summary
  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ['sales-summary', dateFrom, dateTo, defaultStore?.id],
    queryFn: async () => {
      const response = await reportsApi.salesSummary({ 
        date_from: dateFrom, 
        date_to: dateTo,
        store: defaultStore?.id || undefined,
      });
      return response.data;
    },
    enabled: !!defaultStore,
    retry: false,
  });

  // Top Products
  const { data: topProductsData, isLoading: productsLoading } = useQuery({
    queryKey: ['top-products', dateFrom, dateTo],
    queryFn: async () => {
      const response = await reportsApi.topProducts({ date_from: dateFrom, date_to: dateTo, limit: 10 });
      return response.data;
    },
    retry: false,
  });

  // Inventory Summary
  const { data: inventoryData, isLoading: inventoryLoading } = useQuery({
    queryKey: ['inventory-summary', defaultStore?.id],
    queryFn: async () => {
      const response = await reportsApi.inventorySummary({ 
        store: defaultStore?.id || undefined,
      });
      return response.data;
    },
    enabled: !!defaultStore,
    retry: false,
  });

  // Revenue Report
  const { data: revenueData, isLoading: revenueLoading } = useQuery({
    queryKey: ['revenue', year],
    queryFn: async () => {
      const response = await reportsApi.revenue({ year });
      return response.data;
    },
    retry: false,
  });

  // Customer Summary
  const { data: customerData, isLoading: customerLoading } = useQuery({
    queryKey: ['customers', dateFrom, dateTo],
    queryFn: async () => {
      const response = await reportsApi.customers({ date_from: dateFrom, date_to: dateTo });
      return response.data;
    },
    retry: false,
  });

  // Stock Ordering Report
  const { data: stockOrderingData, isLoading: stockOrderingLoading } = useQuery({
    queryKey: ['stock-ordering', defaultStore?.id],
    queryFn: async () => {
      const response = await reportsApi.stockOrdering({ 
        store: defaultStore?.id || undefined,
      });
      return response.data;
    },
    enabled: showStockReports && !!defaultStore,
    retry: false,
  });

  // Quick date filter functions
  const setDateFilter = (filter: string) => {
    setActiveDateFilter(filter);
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    switch (filter) {
      case 'today':
        setDateFrom(todayStr);
        setDateTo(todayStr);
        break;
      case 'yesterday':
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        setDateFrom(yesterdayStr);
        setDateTo(yesterdayStr);
        break;
      case 'last_week':
        const lastWeek = new Date(today);
        lastWeek.setDate(lastWeek.getDate() - 7);
        setDateFrom(lastWeek.toISOString().split('T')[0]);
        setDateTo(todayStr);
        break;
      case 'last_month':
        const lastMonth = new Date(today);
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        setDateFrom(lastMonth.toISOString().split('T')[0]);
        setDateTo(todayStr);
        break;
      case 'last_year':
        const lastYear = new Date(today);
        lastYear.setFullYear(lastYear.getFullYear() - 1);
        setDateFrom(lastYear.toISOString().split('T')[0]);
        setDateTo(todayStr);
        break;
      case 'financial_year':
        const currentMonth = today.getMonth();
        const fyStart = currentMonth >= 3 
          ? new Date(today.getFullYear(), 3, 1) // April 1
          : new Date(today.getFullYear() - 1, 3, 1);
        setDateFrom(fyStart.toISOString().split('T')[0]);
        setDateTo(todayStr);
        break;
      default:
        // Custom - don't change dates
        break;
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount);
  };

  const salesSummary = salesData?.summary || salesData || {};
  const topProducts = topProductsData?.products || topProductsData?.results || [];
  const inventorySummary = inventoryData?.summary || inventoryData || {};
  const revenueReport = revenueData || {};
  const customerSummary = customerData || {};

  if (!defaultStore && stores.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <BarChart3 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Reports & Analytics</h2>
          <p className="text-red-600 mb-4">No store available. Please create a store first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 flex-1 w-full sm:w-auto">
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <BarChart3 className="h-8 w-8 text-blue-600" />
              Reports & Analytics
            </h1>
            <p className="text-gray-600 mt-1">Comprehensive business insights and metrics</p>
          </div>
          {/* Store Selector for Admin users */}
          {isAdmin && stores.length > 0 && (
            <div className="w-full sm:w-auto">
              <div className="relative group">
                <div className="flex items-center gap-2 sm:gap-3 bg-white border-2 border-blue-200 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm hover:shadow-md hover:border-blue-400 transition-all duration-200 cursor-pointer">
                  <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                    <div className="flex-shrink-0 p-1.5 bg-blue-50 rounded-lg">
                      <Store className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm sm:text-base font-semibold text-gray-900 truncate block">
                        {currentStore?.name || 'Select Store'}
                      </span>
                    </div>
                    <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400 group-hover:text-blue-600 transition-colors flex-shrink-0" />
                  </div>
                </div>
                <select
                  value={selectedStoreId?.toString() || ''}
                  onChange={(e) => {
                    const storeId = parseInt(e.target.value);
                    setSelectedStoreId(storeId);
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 appearance-none"
                >
                  {stores.map((store: any) => (
                    <option key={store.id} value={store.id.toString()}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>

      {/* Date Range Selector */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        {/* Quick Date Filter Buttons */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setDateFilter('today')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeDateFilter === 'today'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setDateFilter('yesterday')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeDateFilter === 'yesterday'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Yesterday
          </button>
          <button
            onClick={() => setDateFilter('last_week')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeDateFilter === 'last_week'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Last Week
          </button>
          <button
            onClick={() => setDateFilter('last_month')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeDateFilter === 'last_month'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Last Month
          </button>
          <button
            onClick={() => setDateFilter('last_year')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeDateFilter === 'last_year'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Last Year
          </button>
          <button
            onClick={() => setDateFilter('financial_year')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeDateFilter === 'financial_year'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Financial Year
          </button>
          <button
            onClick={() => {
              setActiveDateFilter('custom');
              setDateFilter('custom');
            }}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeDateFilter === 'custom'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Custom Range
          </button>
        </div>
        
        {/* Custom Date Range Inputs */}
        {activeDateFilter === 'custom' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setActiveDateFilter('custom');
                }}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setActiveDateFilter('custom');
                }}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="relative">
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value))}
                placeholder="Year"
                className="w-full pl-4 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        )}
      </div>

      {/* Sales Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Sales</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {salesLoading ? '...' : formatCurrency(salesSummary.total_sales || 0)}
              </p>
            </div>
            <Coins className="h-8 w-8 text-green-600" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Invoices</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {salesLoading ? '...' : salesSummary.total_invoices || 0}
              </p>
            </div>
            <BarChart3 className="h-8 w-8 text-blue-600" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Items Sold</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {salesLoading ? '...' : Math.round(salesSummary.total_items_sold || 0)}
              </p>
            </div>
            <Package className="h-8 w-8 text-purple-600" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Avg Order Value</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {salesLoading ? '...' : formatCurrency(salesSummary.avg_order_value || 0)}
              </p>
            </div>
            <TrendingUp className="h-8 w-8 text-yellow-600" />
          </div>
        </div>
      </div>

      {/* Inventory Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Products</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {inventoryLoading ? '...' : inventorySummary.total_products || 0}
              </p>
            </div>
            <Package className="h-8 w-8 text-blue-600" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Stock</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {inventoryLoading ? '...' : Math.round(inventorySummary.total_quantity || 0)}
              </p>
            </div>
            <Package className="h-8 w-8 text-green-600" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Low Stock</p>
              <p className="text-2xl font-bold text-orange-600 mt-1">
                {inventoryLoading ? '...' : inventorySummary.low_stock_count || 0}
              </p>
            </div>
            <Package className="h-8 w-8 text-orange-600" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Out of Stock</p>
              <p className="text-2xl font-bold text-red-600 mt-1">
                {inventoryLoading ? '...' : inventorySummary.out_of_stock_count || 0}
              </p>
            </div>
            <Package className="h-8 w-8 text-red-600" />
          </div>
        </div>
      </div>

      {/* Top Products */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Top Selling Products</h2>
        {productsLoading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        ) : topProducts.length === 0 ? (
          <p className="text-gray-600 text-center py-8">No products found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quantity Sold</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Revenue</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Orders</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {topProducts.map((product: any, _index: number) => (
                  <tr key={product.product__id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-gray-900">{product.product__name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600 font-mono">{product.product__sku || 'N/A'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-900">{Math.round(product.total_quantity || 0)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-gray-900">
                        {formatCurrency(product.total_revenue || 0)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600">{product.order_count || 0}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Revenue Report */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Revenue Report - {year}</h2>
        {revenueLoading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <div>
            <div className="mb-4">
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(revenueReport.year_total || 0)}
              </p>
              <p className="text-sm text-gray-600">Total Revenue for {year}</p>
            </div>
            {revenueReport.monthly_breakdown && revenueReport.monthly_breakdown.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Month</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Revenue</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Invoices</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg Order</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {revenueReport.monthly_breakdown.map((month: any) => (
                      <tr key={month.month} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-gray-900">
                            {new Date(month.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-gray-900">
                            {formatCurrency(month.total_revenue || 0)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600">{month.invoice_count || 0}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600">
                            {formatCurrency(month.avg_order_value || 0)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-600 text-center py-8">No revenue data available</p>
            )}
          </div>
        )}
      </div>

      {/* Customer Summary */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Top Customers</h2>
        {customerLoading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        ) : customerSummary.top_customers && customerSummary.top_customers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total Spent</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Orders</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {customerSummary.top_customers.map((customer: any) => (
                  <tr key={customer.customer__id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-gray-900">{customer.customer__name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600">{customer.customer__email || 'N/A'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-gray-900">
                        {formatCurrency(customer.total_spent || 0)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600">{customer.order_count || 0}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600">
                        {formatCurrency(customer.avg_order_value || 0)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-600 text-center py-8">No customer data available</p>
        )}
      </div>

      {/* Stock Ordering Reports */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Stock Ordering Reports</h2>
          <button
            onClick={() => setShowStockReports(!showStockReports)}
            className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
          >
            {showStockReports ? 'Hide' : 'Show'} Reports
          </button>
        </div>
        
        {showStockReports && (
          <div className="space-y-6">
            {/* Out of Stock */}
            <div>
              <h3 className="text-lg font-semibold text-red-600 mb-3">Out of Stock Products</h3>
              {stockOrderingLoading ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                </div>
              ) : stockOrderingData?.out_of_stock && stockOrderingData.out_of_stock.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Store</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current Qty</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Threshold</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {stockOrderingData.out_of_stock.map((product: any, _index: number) => (
                        <tr key={_index} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{product.product__name}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 font-mono">{product.product__sku || 'N/A'}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{product.store__name || 'N/A'}</td>
                          <td className="px-4 py-3 text-sm text-red-600 font-medium">
                            {Math.round(product.available_quantity || 0)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{product.product__low_stock_threshold || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-600 text-center py-4">No out of stock products</p>
              )}
            </div>

            {/* Low Stock */}
            <div>
              <h3 className="text-lg font-semibold text-orange-600 mb-3">Low Stock Products</h3>
              {stockOrderingData?.low_stock && stockOrderingData.low_stock.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Store</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current Qty</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Threshold</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {stockOrderingData.low_stock.map((product: any, _index: number) => (
                        <tr key={_index} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{product.product__name}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 font-mono">{product.product__sku || 'N/A'}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{product.store__name || 'N/A'}</td>
                          <td className="px-4 py-3 text-sm text-orange-600 font-medium">
                            {Math.round(product.available_quantity || 0)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{product.product__low_stock_threshold || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-600 text-center py-4">No low stock products</p>
              )}
            </div>

            {/* Products Needing Order */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Products Needing Order</h3>
              {stockOrderingData?.products_needing_order && stockOrderingData.products_needing_order.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Store</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current Qty</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Threshold</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cost Price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {stockOrderingData.products_needing_order.map((product: any, _index: number) => (
                        <tr key={_index} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{product.product__name}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 font-mono">{product.product__sku || 'N/A'}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{product.store__name || 'N/A'}</td>
                          <td className="px-4 py-3 text-sm font-medium">
                            {Math.round(product.available_quantity || 0)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{product.product__low_stock_threshold || 0}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            ₹{parseFloat(product.product__cost_price || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-600 text-center py-4">No products need ordering</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

