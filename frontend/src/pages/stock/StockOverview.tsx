import { useEffect, useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Boxes, ChevronDown, ChevronRight, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { productsApi } from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import Pagination from '../../components/ui/Pagination';
import { formatNumber, sortSupplierBreakdownByDateDesc } from '../../lib/utils';
import ProductName from '../../components/ProductName';
import { exportStockOverviewToPdf } from '../../utils/exportStockPdf';

export default function StockOverview() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const EXPAND_ALL_KEY = 'stock_overview_expand_all';

  const initialSearch = searchParams.get('q') || '';
  const initialPage = Number(searchParams.get('page') || '1') || 1;
  const initialWhGtZero = searchParams.get('wh_gt_zero') === '1' || searchParams.get('wh_gt_zero') === 'true';

  const [search, setSearch] = useState(initialSearch);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [warehouseQtyGtZero, setWarehouseQtyGtZero] = useState(initialWhGtZero);
  const [expandAll, setExpandAll] = useState(() => localStorage.getItem(EXPAND_ALL_KEY) === 'true');
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});
  const [exporting, setExporting] = useState(false);

  // Keep URL in sync (shareable, back/forward friendly)
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (search.trim()) params.set('q', search.trim());
    else params.delete('q');
    params.set('page', String(currentPage));
    if (warehouseQtyGtZero) params.set('wh_gt_zero', '1');
    else params.delete('wh_gt_zero');
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, currentPage, warehouseQtyGtZero]);

  // Sync state with URL (back/forward + manual edits)
  useEffect(() => {
    const urlQ = searchParams.get('q') || '';
    const urlPage = Number(searchParams.get('page') || '1') || 1;
    const urlWhGtZero = searchParams.get('wh_gt_zero') === '1' || searchParams.get('wh_gt_zero') === 'true';
    if (urlQ !== search) setSearch(urlQ);
    if (urlPage !== currentPage) setCurrentPage(urlPage);
    if (urlWhGtZero !== warehouseQtyGtZero) setWarehouseQtyGtZero(urlWhGtZero);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Reset page when search or warehouse filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [search, warehouseQtyGtZero]);

  // Remember expand/collapse all preference
  useEffect(() => {
    localStorage.setItem(EXPAND_ALL_KEY, expandAll ? 'true' : 'false');
  }, [expandAll]);

  const queryParams = useMemo(() => {
    const params: any = {
      tag: 'new',
      exclude_other_custom: 'true',
      page: currentPage,
      limit: 50,
    };
    if (search.trim()) {
      params.search = search.trim();
      params.search_mode = 'name_only';
    }
    if (warehouseQtyGtZero) {
      params.warehouse_qty_gt_zero = 'true';
    }
    return params;
  }, [search, currentPage, warehouseQtyGtZero]);

  const listBaseParams = useMemo(() => {
    const params: any = {
      tag: 'new',
      exclude_other_custom: 'true',
      limit: 100,
    };
    if (search.trim()) {
      params.search = search.trim();
      params.search_mode = 'name_only';
    }
    if (warehouseQtyGtZero) {
      params.warehouse_qty_gt_zero = 'true';
    }
    return params;
  }, [search, warehouseQtyGtZero]);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['stock-overview', queryParams],
    queryFn: async () => {
      const response = await productsApi.list(queryParams);
      return response.data;
    },
    retry: false,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const products = (() => {
    if (!data) return [];
    if (Array.isArray((data as any).results)) return (data as any).results;
    if (Array.isArray((data as any).data)) return (data as any).data;
    if (Array.isArray(data as any)) return data as any[];
    return [];
  })();

  const totalPages = Number((data as any)?.total_pages || 1) || 1;
  const totalItems = Number((data as any)?.count || 0) || 0;

  // Apply expandAll to currently loaded rows (collapsed by default)
  useEffect(() => {
    const next: Record<number, boolean> = {};
    for (const p of products) {
      if (p?.id) next[p.id] = !!expandAll;
    }
    setExpandedIds(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandAll, currentPage, search, (data as any)?.count]);

  const fetchAllProductsForExport = async (): Promise<any[]> => {
    const allRows: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const params = { ...listBaseParams, page };
      const response = await productsApi.list(params);
      const pageData = response.data;
      const pageRows: any[] = Array.isArray(pageData?.results)
        ? pageData.results
        : Array.isArray(pageData?.data)
          ? pageData.data
          : Array.isArray(pageData)
            ? pageData
            : [];
      allRows.push(...pageRows);

      const pages = pageData?.total_pages;
      if (pages != null && pages !== '' && !Number.isNaN(Number(pages))) {
        hasMore = page < Number(pages);
      } else if (pageData?.next != null && pageData.next !== '') {
        hasMore = true;
      } else {
        const pageSize = Number(pageData?.page_size ?? pageData?.limit ?? 100);
        const count = pageData?.count;
        hasMore =
          count != null &&
          count !== '' &&
          !Number.isNaN(Number(count)) &&
          pageSize > 0 &&
          page * pageSize < Number(count);
      }

      page += 1;
      if (page > 500) break;
    }

    return allRows;
  };

  const handleExportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const allProducts = await fetchAllProductsForExport();
      if (!allProducts.length) return;

      const filterLabels: string[] = [];
      if (search.trim()) filterLabels.push(`Search: ${search.trim()}`);
      if (warehouseQtyGtZero) filterLabels.push('Warehouse Qty > 0');

      exportStockOverviewToPdf({
        products: allProducts,
        filterLabels,
      });
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) {
    return <LoadingState message="Loading stock overview..." />;
  }

  if (error) {
    return <ErrorState message="Failed to load stock overview. Please try again." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Overview"
        subtitle="Read-only overview of warehouse, shop allocation, and available stock"
        icon={Boxes}
        action={
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <div className="w-full sm:w-[360px]">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search product name..."
              />
            </div>
            <Button
              variant="outline"
              onClick={handleExportPdf}
              disabled={exporting || totalItems === 0}
              className="flex items-center justify-center gap-2 whitespace-nowrap"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {exporting ? 'Exporting…' : 'Export PDF'}
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-4 py-2">
        <label className="flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={warehouseQtyGtZero}
            onChange={(e) => setWarehouseQtyGtZero(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
          />
          Warehouse Qty &gt; 0
        </label>
      </div>

      <div className="relative min-h-[200px]">
        {isFetching && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 rounded-lg border border-gray-100"
            aria-hidden="false"
          >
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              <span className="text-sm font-medium text-gray-600">Updating list…</span>
            </div>
          </div>
        )}
        {products.length === 0 ? (
          <EmptyState icon={Boxes} title="No products found" message="Try changing your search or filters." />
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
            <div className="text-sm text-gray-600">
              Showing <span className="font-semibold text-gray-900">{products.length}</span> items
              {totalItems ? (
                <>
                  {' '}
                  (total <span className="font-semibold text-gray-900">{totalItems}</span>)
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={expandAll}
                  onChange={(e) => setExpandAll(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                />
                {expandAll ? 'Collapse all' : 'Expand all'}
              </label>
              {isFetching && <div className="text-xs text-gray-500">Refreshing…</div>}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Product
                  </th>
                  <th className="px-4 py-2 text-right text-[11px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Warehouse
                  </th>
                  <th className="px-4 py-2 text-right text-[11px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Shop Alloc
                  </th>
                  <th className="px-4 py-2 text-right text-[11px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Available
                  </th>
                  <th className="px-4 py-2 text-right text-[11px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Total
                  </th>
                  <th className="px-4 py-2 text-right text-[11px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-50">
                {products.map((p: any) => {
                  const warehouse = Number(p.warehouse_stock) || 0;
                  const shopAlloc = Number(p.shop_stock) || 0;
                  const available = Number(p.available_quantity) || 0;
                  const total = warehouse + available;
                  const isExpanded = !!expandedIds[p.id];
                  const breakdown = sortSupplierBreakdownByDateDesc(
                    Array.isArray(p.supplier_breakdown) ? p.supplier_breakdown : []
                  );

                  return (
                    <>
                      <tr
                        key={p.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => navigate(`/products/${p.id}`)}
                        title="Open product"
                      >
                        <td className="px-4 py-3 text-sm text-gray-900">
                          <div className="min-w-[260px] flex items-start gap-2">
                            <button
                              type="button"
                              className="mt-0.5 p-1 rounded hover:bg-gray-100 text-gray-500"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedIds((prev) => ({ ...prev, [p.id]: !prev[p.id] }));
                              }}
                              title={isExpanded ? 'Collapse' : 'Expand'}
                            >
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <ProductName as="div"
                                className="font-medium truncate"
                                
                               name={p.name} />
                              <div className="text-xs text-gray-500 mt-0.5 truncate">
                                {p.brand_name ? p.brand_name : '—'}
                                <span className="mx-1.5 text-gray-300">|</span>
                                {p.category_name ? p.category_name : '—'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-700 font-semibold whitespace-nowrap">
                          {formatNumber(warehouse, 2)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-700 font-semibold whitespace-nowrap">
                          {formatNumber(shopAlloc, 2)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-blue-600 font-semibold whitespace-nowrap">
                          {formatNumber(available, 2)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-green-700 font-bold whitespace-nowrap">
                          {formatNumber(total, 2)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right whitespace-nowrap">
                          <ExternalLink className="h-4 w-4 inline-block text-gray-400" />
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr key={`${p.id}-breakdown`} className="bg-gray-50/40">
                          <td colSpan={6} className="px-4 py-3">
                            {breakdown.length === 0 ? (
                              <div className="text-xs text-gray-500">No purchase breakdown available.</div>
                            ) : (
                              <div className="overflow-x-auto border border-gray-100 rounded-md bg-white">
                                <table className="min-w-full divide-y divide-gray-100">
                                  <thead className="bg-gray-50">
                                    <tr>
                                      <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                                        Supplier
                                      </th>
                                      <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                                        Purchase date
                                      </th>
                                      <th className="px-3 py-2 text-right text-[10px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                                        Whse
                                      </th>
                                      <th className="px-3 py-2 text-right text-[10px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                                        Available
                                      </th>
                                      <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                                        Price
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody className="bg-white divide-y divide-gray-50">
                                    {breakdown.map((b: any, idx: number) => (
                                      <tr key={idx} className="hover:bg-gray-50">
                                        <td className="px-3 py-2 whitespace-nowrap text-xs font-medium text-gray-900 truncate max-w-[140px]">
                                          {b.supplier}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">
                                          {b.purchase_date ?? '—'}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap text-xs text-right text-gray-600 font-semibold">
                                          {formatNumber(b.warehouse_available ?? b.warehouse_stock, 2)}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap text-xs text-right text-blue-600 font-semibold">
                                          {formatNumber(b.shop_barcode_count ?? b.shop_stock, 2)}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap text-xs text-green-600 font-medium">
                                          {b.price}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Top pagination (so it's visible without scrolling) */}
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={(p) => setCurrentPage(Math.max(1, p))}
            totalItems={totalItems}
            pageSize={50}
          />

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={(p) => setCurrentPage(Math.max(1, p))}
            totalItems={totalItems}
            pageSize={50}
          />
        </div>
        )}
      </div>
    </div>
  );
}
