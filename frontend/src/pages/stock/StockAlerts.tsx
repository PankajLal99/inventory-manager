import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Filter,
  Package,
  PackageX,
  RefreshCw,
  ShoppingBag,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { catalogApi, purchasingApi, reportsApi } from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Card from '../../components/ui/Card';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import { formatNumber, toLocalDateString } from '../../lib/utils';

type AlertTab = 'all' | 'sold_out' | 'low';

/** Sentinel value for "No Category / No Brand / No Supplier" filters */
const NONE_FILTER = '__none__';

type StockAlertProduct = {
  product__id: number;
  product__name: string;
  product__sku?: string;
  product__category_id?: number | null;
  product__category?: string;
  product__brand_id?: number | null;
  product__brand?: string;
  product__low_stock_threshold?: number;
  supplier__id?: number | null;
  supplier__name?: string;
  store__name?: string;
  available_quantity: number;
  status: 'sold_out' | 'low';
};

function listFromResponse(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}

function statusLabel(status: StockAlertProduct['status']) {
  return status === 'sold_out' ? 'Sold out' : 'Getting sold out';
}

function isMissingCategory(product: StockAlertProduct) {
  return !product.product__category_id || !product.product__category || product.product__category === 'N/A';
}

function isMissingBrand(product: StockAlertProduct) {
  return !product.product__brand_id || !product.product__brand || product.product__brand === 'N/A';
}

function isMissingSupplier(product: StockAlertProduct) {
  return !product.supplier__id || !product.supplier__name || product.supplier__name === 'N/A';
}

function displayCategory(product: StockAlertProduct) {
  return isMissingCategory(product) ? 'No category' : product.product__category;
}

function displayBrand(product: StockAlertProduct) {
  return isMissingBrand(product) ? 'No brand' : product.product__brand;
}

function displaySupplier(product: StockAlertProduct) {
  return isMissingSupplier(product) ? 'No supplier' : product.supplier__name;
}

function matchesIdOrNone(
  filterValue: string,
  id: number | null | undefined,
  isMissing: boolean,
) {
  if (!filterValue) return true;
  if (filterValue === NONE_FILTER) return isMissing;
  return String(id || '') === filterValue;
}

function buildExportRows(products: StockAlertProduct[]) {
  return products.map((product) => ({
    Status: statusLabel(product.status),
    'Product Name': product.product__name || '-',
    SKU: product.product__sku || '-',
    Category: displayCategory(product),
    Brand: displayBrand(product),
    Supplier: displaySupplier(product),
    Available: Math.round(product.available_quantity || 0),
    'Low Stock Limit': product.product__low_stock_threshold || 0,
  }));
}

export default function StockAlerts() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<AlertTab>('all');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [thresholdMin, setThresholdMin] = useState(0);
  const [thresholdMax, setThresholdMax] = useState(0);
  const [thresholdInitialized, setThresholdInitialized] = useState(false);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['stock-alerts', 'list'],
    queryFn: async () => {
      const response = await reportsApi.stockOrdering();
      return response.data;
    },
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const handleHardRefresh = async () => {
    const response = await reportsApi.stockOrdering({ refresh: true });
    queryClient.setQueryData(['stock-alerts', 'list'], response.data);
    await queryClient.invalidateQueries({ queryKey: ['stock-alerts', 'counts'] });
  };

  const { data: categoriesData } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const response = await catalogApi.categories.list();
      return response.data;
    },
    retry: false,
  });

  const { data: brandsData } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await catalogApi.brands.list();
      return response.data;
    },
    retry: false,
  });

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const response = await purchasingApi.suppliers.list();
      return response.data;
    },
    retry: false,
  });

  const categories = listFromResponse(categoriesData);
  const brands = listFromResponse(brandsData);
  const suppliers = listFromResponse(suppliersData);

  const alerts = useMemo((): StockAlertProduct[] => {
    const soldOut = (data?.out_of_stock || []).map((product: any) => ({
      ...product,
      status: 'sold_out' as const,
    }));
    const low = (data?.low_stock || []).map((product: any) => ({
      ...product,
      status: 'low' as const,
    }));
    return [...soldOut, ...low].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'sold_out' ? -1 : 1;
      return (a.available_quantity || 0) - (b.available_quantity || 0);
    });
  }, [data]);

  const thresholdBounds = useMemo(() => {
    if (alerts.length === 0) return { min: 0, max: 0 };
    const values = alerts.map((p) => p.product__low_stock_threshold || 0);
    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }, [alerts]);

  useEffect(() => {
    if (!thresholdInitialized && alerts.length > 0) {
      setThresholdMin(thresholdBounds.min);
      setThresholdMax(thresholdBounds.max);
      setThresholdInitialized(true);
    }
  }, [alerts.length, thresholdBounds, thresholdInitialized]);

  // Keep slider values inside new data bounds after refresh
  useEffect(() => {
    if (!thresholdInitialized) return;
    setThresholdMin((prev) => Math.max(thresholdBounds.min, Math.min(prev, thresholdBounds.max)));
    setThresholdMax((prev) => Math.max(thresholdBounds.min, Math.min(prev, thresholdBounds.max)));
  }, [thresholdBounds, thresholdInitialized]);

  const productFilteredAlerts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return alerts.filter((product) => {
      if (!matchesIdOrNone(categoryFilter, product.product__category_id, isMissingCategory(product))) {
        return false;
      }
      if (!matchesIdOrNone(brandFilter, product.product__brand_id, isMissingBrand(product))) {
        return false;
      }
      if (!matchesIdOrNone(supplierFilter, product.supplier__id, isMissingSupplier(product))) {
        return false;
      }
      if (thresholdInitialized) {
        const threshold = product.product__low_stock_threshold || 0;
        if (threshold < thresholdMin || threshold > thresholdMax) {
          return false;
        }
      }
      if (query) {
        const haystack = [
          product.product__name,
          product.product__sku,
          displayCategory(product),
          displayBrand(product),
          displaySupplier(product),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [
    alerts,
    search,
    categoryFilter,
    brandFilter,
    supplierFilter,
    thresholdMin,
    thresholdMax,
    thresholdInitialized,
  ]);

  const soldOutCount = productFilteredAlerts.filter((p) => p.status === 'sold_out').length;
  const lowCount = productFilteredAlerts.filter((p) => p.status === 'low').length;
  const totalCount = productFilteredAlerts.length;

  const filteredAlerts = useMemo(() => {
    if (activeTab === 'sold_out') return productFilteredAlerts.filter((p) => p.status === 'sold_out');
    if (activeTab === 'low') return productFilteredAlerts.filter((p) => p.status === 'low');
    return productFilteredAlerts;
  }, [productFilteredAlerts, activeTab]);

  const hasActiveFilters =
    !!search.trim() ||
    !!categoryFilter ||
    !!brandFilter ||
    !!supplierFilter ||
    (thresholdInitialized &&
      (thresholdMin > thresholdBounds.min || thresholdMax < thresholdBounds.max));

  const clearFilters = () => {
    setSearch('');
    setCategoryFilter('');
    setBrandFilter('');
    setSupplierFilter('');
    setThresholdMin(thresholdBounds.min);
    setThresholdMax(thresholdBounds.max);
  };

  const handleThresholdMinChange = (value: number) => {
    setThresholdMin(Math.min(value, thresholdMax));
  };

  const handleThresholdMaxChange = (value: number) => {
    setThresholdMax(Math.max(value, thresholdMin));
  };

  const handleExportExcel = () => {
    if (filteredAlerts.length === 0) return;

    const rows = buildExportRows(filteredAlerts);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products to Order');

    const fileName = `stock_alerts_order_list_${toLocalDateString(new Date())}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  if (isLoading) {
    return <LoadingState message="Loading stock alerts..." />;
  }

  if (error) {
    return (
      <ErrorState
        message="Could not load products near or below their low stock limit."
        onRetry={() => handleHardRefresh()}
      />
    );
  }

  const sliderDisabled = thresholdBounds.max <= thresholdBounds.min;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Alerts"
        subtitle="Products that are sold out or at/below their low stock limit. Restocked items leave this list automatically."
        icon={Bell}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={handleExportExcel}
              disabled={filteredAlerts.length === 0}
              className="flex items-center gap-2"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Export Excel
            </Button>
            <Button
              variant="outline"
              onClick={() => handleHardRefresh()}
              disabled={isFetching}
              className="flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              onClick={() => navigate('/purchases')}
              className="flex items-center gap-2"
            >
              <ShoppingBag className="h-4 w-4" />
              New Purchase
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Needs attention</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{totalCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Sold out</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{soldOutCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Getting sold out</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{lowCount}</p>
        </div>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <Filter className="h-4 w-4 text-gray-500" />
            Filters
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Input
            type="text"
            placeholder="Search products, SKU, supplier..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            icon={<Filter className="h-4 w-4" />}
          >
            <option value="">All Categories</option>
            <option value={NONE_FILTER}>No Category</option>
            {categories.map((cat: any) => (
              <option key={cat.id} value={cat.id.toString()}>
                {cat.name}
              </option>
            ))}
          </Select>
          <Select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            icon={<Filter className="h-4 w-4" />}
          >
            <option value="">All Brands</option>
            <option value={NONE_FILTER}>No Brand</option>
            {brands.map((brand: any) => (
              <option key={brand.id} value={brand.id.toString()}>
                {brand.name}
              </option>
            ))}
          </Select>
          <Select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            icon={<Filter className="h-4 w-4" />}
          >
            <option value="">All Suppliers</option>
            <option value={NONE_FILTER}>No Supplier</option>
            {suppliers.map((supplier: any) => (
              <option key={supplier.id} value={supplier.id.toString()}>
                {supplier.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="mt-5 pt-4 border-t border-gray-100">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <p className="text-sm font-medium text-gray-900">Low Stock Limit</p>
              <p className="text-xs text-gray-500">
                Show products whose threshold is between {thresholdMin} and {thresholdMax}
              </p>
            </div>
            <p className="text-sm font-medium text-gray-700">
              {thresholdMin} – {thresholdMax}
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>Min threshold</span>
                <span>{thresholdMin}</span>
              </div>
              <input
                type="range"
                min={thresholdBounds.min}
                max={thresholdBounds.max}
                step={1}
                value={thresholdMin}
                disabled={sliderDisabled}
                onChange={(e) => handleThresholdMinChange(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 disabled:opacity-50"
                aria-label="Minimum low stock threshold"
              />
            </div>
            <div>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>Max threshold</span>
                <span>{thresholdMax}</span>
              </div>
              <input
                type="range"
                min={thresholdBounds.min}
                max={thresholdBounds.max}
                step={1}
                value={thresholdMax}
                disabled={sliderDisabled}
                onChange={(e) => handleThresholdMaxChange(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 disabled:opacity-50"
                aria-label="Maximum low stock threshold"
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <span>{thresholdBounds.min}</span>
              <span>{thresholdBounds.max}</span>
            </div>
          </div>
        </div>
      </Card>

      <div className="bg-white rounded-xl border border-gray-200 p-2">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'all', label: 'All', count: totalCount },
              { id: 'sold_out', label: 'Sold out', count: soldOutCount },
              { id: 'low', label: 'Getting sold out', count: lowCount },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {tab.label}
              <span
                className={`ml-2 inline-flex min-w-[1.25rem] justify-center rounded-full px-1.5 text-xs ${
                  activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-white text-gray-600'
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {filteredAlerts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200">
          <EmptyState
            icon={Package}
            title="No matching stock alerts"
            message={
              hasActiveFilters
                ? 'No products match the current filters. Try clearing filters or widening the threshold range.'
                : activeTab === 'sold_out'
                  ? 'No products are sold out right now.'
                  : activeTab === 'low'
                    ? 'No products are at or below their low stock limit.'
                    : 'All products with a low stock limit are above threshold. Nice work.'
            }
            action={
              hasActiveFilters ? (
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 text-sm text-gray-600">
            <Download className="h-4 w-4" />
            Export uses the current filters and tab ({filteredAlerts.length} product
            {filteredAlerts.length === 1 ? '' : 's'})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Product
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Brand
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Supplier
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Available
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredAlerts.map((product) => {
                  const available = product.available_quantity || 0;
                  const isSoldOut = product.status === 'sold_out';

                  return (
                    <tr key={`${product.status}-${product.product__id}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {isSoldOut ? (
                          <Badge variant="danger" className="gap-1">
                            <PackageX className="h-3.5 w-3.5" />
                            Sold out
                          </Badge>
                        ) : (
                          <Badge variant="warning" className="gap-1">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Getting sold out
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/products/${product.product__id}`}
                          className="text-sm font-medium text-gray-900 hover:text-blue-600"
                        >
                          {product.product__name}
                        </Link>
                        {product.product__sku && product.product__sku !== 'N/A' && (
                          <p className="text-xs text-gray-500 font-mono mt-0.5">{product.product__sku}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {displayCategory(product)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {displayBrand(product)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {displaySupplier(product)}
                      </td>
                      <td
                        className={`px-4 py-3 text-sm text-right font-semibold ${
                          isSoldOut ? 'text-red-600' : 'text-amber-600'
                        }`}
                      >
                        {formatNumber(available, 0)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => navigate(`/products/${product.product__id}`)}
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                        >
                          View
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
