import { useState, useEffect, useRef } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { searchApi, productsApi } from '../../lib/api';
import {
  Search as SearchIcon,
  Package,
  Users,
  FileText,
  ShoppingCart,
  Building2,
  Tag,
  Store,
  Warehouse,
  ShoppingBag,
  Loader2,
  ExternalLink,
  Barcode as BarcodeIcon,
  Camera,
  X,
} from 'lucide-react';
import { formatNumber, getProductNameColor } from '../../lib/utils';
import Input from '../../components/ui/Input';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import BarcodeScanner from '../../components/BarcodeScanner';

interface SearchResults {
  products: any[];
  barcodes: any[];
  customers: any[];
  invoices: any[];
  carts: any[];
  suppliers: any[];
  categories: any[];
  brands: any[];
  stores: any[];
  warehouses: any[];
  purchases: any[];
}

const SEARCH_DEBOUNCE_MS = 300;

export default function Search() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const initialType = searchParams.get('type') || 'product';
  const [inputValue, setInputValue] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [searchType, setSearchType] = useState(initialType);
  const [showZeroRows, setShowZeroRows] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [productLimit, setProductLimit] = useState(40);
  const scrollYRef = useRef<number | null>(null);

  // Debounce input so we only search after user stops typing
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(inputValue);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handler);
  }, [inputValue]);

  const { data, isLoading, error, isFetching } = useQuery<SearchResults>({
    queryKey: ['global-search', debouncedQuery, searchType, productLimit, showZeroRows],
    queryFn: async () => {
      if (!debouncedQuery.trim()) {
        return {
          products: [],
          barcodes: [],
          customers: [],
          invoices: [],
          carts: [],
          suppliers: [],
          categories: [],
          brands: [],
          stores: [],
          warehouses: [],
          purchases: [],
        };
      }
      const response = await searchApi.search(debouncedQuery, searchType, {
        product_limit: productLimit,
        include_zero_shop_rows: showZeroRows ? 'true' : 'false',
      } as any);
      return response.data;
    },
    enabled: debouncedQuery.trim().length > 0,
    retry: false,
    placeholderData: keepPreviousData,
  });

  // Sync from URL (e.g. back button) and reset product limit when search changes
  useEffect(() => {
    const urlQuery = searchParams.get('q') || '';
    const urlType = searchParams.get('type') || 'product';
    if (urlQuery !== debouncedQuery) {
      setInputValue(urlQuery);
      setDebouncedQuery(urlQuery);
      setProductLimit(40);
    }
    if (urlType !== searchType) {
      setSearchType(urlType);
      setProductLimit(40);
    }
  }, [searchParams]);

  // Restore scroll position after "Load more" / "Show all" finish loading (so we restore once new data is in the DOM)
  useEffect(() => {
    if (scrollYRef.current === null || isFetching || !data) return;
    const saved = scrollYRef.current;
    scrollYRef.current = null;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo(0, saved);
      });
    });
    return () => cancelAnimationFrame(id);
  }, [data, isFetching]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params: any = {};
    const q = inputValue.trim();
    if (q) params.q = q;
    if (searchType !== 'product') params.type = searchType;
    setSearchParams(params);
    setDebouncedQuery(q);
    // Query will trigger automatically via useQuery
  };

  const handleTypeChange = (type: string) => {
    setSearchType(type);
    if (debouncedQuery.trim()) {
      const params: any = { q: debouncedQuery.trim() };
      if (type !== 'product') params.type = type;
      setSearchParams(params);
    }
  };

  const handleClearSearch = () => {
    setInputValue('');
    setDebouncedQuery('');
    const params: any = {};
    if (searchType !== 'product') params.type = searchType;
    setSearchParams(params);
  };

  const handleBarcodeScan = async (barcode: string) => {
    if (!barcode || !barcode.trim()) return;

    const trimmedBarcode = barcode.trim();
    setScanError(null);

    try {
      // Use barcode_only=true to only search in Barcode table, not Product SKU
      const barcodeResponse = await productsApi.byBarcode(trimmedBarcode, true);

      if (barcodeResponse.data && barcodeResponse.data.id) {
        // Product found - navigate to product page
        navigate(`/products/${barcodeResponse.data.id}`);
        setShowScanner(false);
      } else {
        // Product not found - update search query to search for the barcode
        setInputValue(trimmedBarcode);
        setDebouncedQuery(trimmedBarcode);
        setSearchParams({ q: trimmedBarcode });
        setShowScanner(false);
      }
    } catch (error: any) {
      // If barcode not found, try searching for it in the search query
      if (error?.response?.status === 404) {
        setInputValue(trimmedBarcode);
        setDebouncedQuery(trimmedBarcode);
        setSearchParams({ q: trimmedBarcode });
        setShowScanner(false);
      } else {
        const errorMsg = error?.response?.data?.message || error?.response?.data?.error || error?.message || 'Failed to process barcode scan';
        setScanError(errorMsg);
        // Clear error after 5 seconds
        setTimeout(() => {
          setScanError(null);
        }, 5000);
      }
    }
  };

  const totalResults = data
    ? Object.values(data).reduce((sum, arr) => sum + arr.length, 0)
    : 0;

  const ResultSection = ({
    title,
    icon: Icon,
    items,
    onItemClick,
    getItemLabel,
    getItemSubLabel,
    getItemBadge,
    customRender,
  }: {
    title: string;
    icon: any;
    items: any[];
    onItemClick: (item: any) => void;
    getItemLabel: (item: any) => string;
    getItemSubLabel?: (item: any) => string;
    getItemBadge?: (item: any) => string;
    customRender?: (item: any, idx: number) => React.ReactNode;
  }) => {
    if (!items || items.length === 0) return null;

    return (
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Icon className="h-5 w-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <Badge variant="secondary">{items.length}</Badge>
        </div>
        <div className="grid gap-3">
          {items.map((item, idx) => {
            if (customRender) {
              return customRender(item, idx);
            }
            return (
              <div
                key={idx}
                onClick={() => onItemClick(item)}
                className="p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-md transition-all cursor-pointer group"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-gray-900 group-hover:text-blue-600">
                        {getItemLabel(item)}
                      </h3>
                      {getItemBadge && (
                        <Badge variant="outline" className="text-xs">
                          {getItemBadge(item)}
                        </Badge>
                      )}
                    </div>
                    {getItemSubLabel && (
                      <p className="text-sm text-gray-600 mt-1">{getItemSubLabel(item)}</p>
                    )}
                  </div>
                  <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-blue-600 transition-colors flex-shrink-0 ml-2" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Global Search</h1>
        <p className="text-gray-600">Search across all products, customers, invoices, and more</p>
      </div>

      <form onSubmit={handleSearch} className="mb-8">
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <Input
              type="text"
              placeholder="Search products, customers, invoices, SKUs, barcodes..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="pl-12 pr-12 py-3 text-lg"
              autoFocus
            />
            {inputValue.trim() && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="Clear search"
                title="Clear"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button
            type="button"
            onClick={() => setShowScanner(true)}
            variant="outline"
            className="px-4"
            title="Scan barcode"
          >
            <Camera className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex flex-wrap gap-4 items-center bg-gray-50 p-4 rounded-lg border border-gray-100">
          <span className="text-sm font-medium text-gray-700">Search for:</span>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {[
              { id: 'all', label: 'All' },
              { id: 'product', label: 'Product search' },
              { id: 'barcode', label: 'Barcode Search' },
              { id: 'barcode_status', label: 'Barcode Status Search' },
              { id: 'sku', label: 'SKU Search' },
              { id: 'brand', label: 'Brand Search' },
              { id: 'customer', label: 'Customer Search' },
              { id: 'category', label: 'Product Category Search' },
            ].map((type) => (
              <label key={type.id} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="radio"
                  name="searchType"
                  value={type.id}
                  checked={searchType === type.id}
                  onChange={() => handleTypeChange(type.id)}
                  className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500 cursor-pointer"
                />
                <span className={`text-sm ${searchType === type.id ? 'text-blue-600 font-semibold' : 'text-gray-600'} group-hover:text-blue-500 transition-colors`}>
                  {type.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      </form>


      {scanError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{scanError}</p>
        </div>
      )}

      {showScanner && (
        <div className="mb-8">
          <BarcodeScanner
            isOpen={showScanner}
            continuous={true}
            onScan={handleBarcodeScan}
            onClose={() => {
              setShowScanner(false);
              setScanError(null);
            }}
          />
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <span className="ml-3 text-gray-600">Searching...</span>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-600">Error searching. Please try again.</p>
        </div>
      )}

      {!isLoading && !error && debouncedQuery.trim() && (
        <>
          {totalResults === 0 ? (
            <div className="text-center py-12">
              <SearchIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600">No results found for "{debouncedQuery}"</p>
            </div>
          ) : (
            <div className="mb-4">
              <p className="text-sm text-gray-600">
                Found <span className="font-semibold">{totalResults}</span> result{totalResults !== 1 ? 's' : ''} for "{debouncedQuery}"
              </p>
            </div>
          )}

          {data && (
            <div>
              {/* Products section - shown first and prioritized */}
              <>
                  <ResultSection
                    title="Products"
                    icon={Package}
                    items={data.products || []}
                    onItemClick={(item) => {
                      // Navigate to product detail page (same as barcode scan)
                      navigate(`/products/${item.id}`);
                    }}
                    getItemLabel={(item) => item.name}
                    getItemSubLabel={(item) => {
                      const parts = [];
                      // Show Brand
                      if (item.brand_name) parts.push(`Brand: ${item.brand_name}`);
                      // Show Category
                      if (item.category_name) parts.push(`Category: ${item.category_name}`);
                      const breakdown = item.supplier_breakdown || [];
                      const totalFromTable = breakdown.reduce(
                        (sum: number, s: any) =>
                          sum + (Number(s.warehouse_available ?? s.warehouse_stock) || 0) + (Number(s.shop_barcode_count ?? s.shop_stock) || 0),
                        0
                      );
                      const total =
                        breakdown.length > 0
                          ? totalFromTable
                          : (Number(item.warehouse_stock) || 0) + (Number(item.available_quantity) || 0);
                      parts.push(`Warehouse + Available: ${formatNumber(total, 2)}`);
                      return parts.length > 0 ? parts.join(' | ') : 'No details available';
                    }}
                    getItemBadge={(item) => item.is_active ? 'Active' : 'Inactive'}
                    customRender={(item, idx) => {
                      const breakdown = item.supplier_breakdown || [];
                      const maxSellingPriceFromBreakdown = breakdown.reduce((max: number, s: any) => {
                        const val = Number(s.selling_price_value ?? 0) || 0;
                        return val > max ? val : max;
                      }, 0);
                      const maxPurchasePriceFromBreakdown = breakdown.reduce((max: number, s: any) => {
                        const raw = s.purchase_price_value ?? s.purchase_price ?? s.price;
                        const cleaned = typeof raw === 'string' ? raw.replace(/[^0-9.-]/g, '') : raw;
                        const val = Number(cleaned);
                        if (Number.isNaN(val)) return max;
                        return val > max ? val : max;
                      }, 0);
                      const parsedSellingPrice = Number(item.selling_price);
                      const parsedPurchasePrice = Number(item.purchase_price);
                      const hasSellingPrice =
                        item.selling_price !== null &&
                        item.selling_price !== undefined &&
                        item.selling_price !== '' &&
                        !Number.isNaN(parsedSellingPrice);
                      const hasPurchasePrice =
                        item.purchase_price !== null &&
                        item.purchase_price !== undefined &&
                        item.purchase_price !== '' &&
                        !Number.isNaN(parsedPurchasePrice);
                      // Top-right price should prefer max selling price from all purchase rows.
                      const price = maxSellingPriceFromBreakdown > 0
                        ? maxSellingPriceFromBreakdown
                        : (
                            hasSellingPrice
                              ? parsedSellingPrice
                              : (hasPurchasePrice ? parsedPurchasePrice : (maxPurchasePriceFromBreakdown > 0 ? maxPurchasePriceFromBreakdown : null))
                          );
                      const hasPrice = price !== null && price !== undefined;
                      const priceDisplay = hasPrice ? `₹${formatNumber(price)}` : 'N/A';

                      // Warehouse + Available = sum of (Whse + Shop Qty) from table so total matches the breakdown
                      const totalFromTable = breakdown.reduce(
                        (sum: number, s: any) =>
                          sum + (Number(s.warehouse_available ?? s.warehouse_stock) || 0) + (Number(s.shop_barcode_count ?? s.shop_stock) || 0),
                        0
                      );
                      const warehousePlusAvailable =
                        breakdown.length > 0
                          ? formatNumber(totalFromTable, 2)
                          : formatNumber(
                              (Number(item.warehouse_stock) || 0) + (Number(item.available_quantity) || 0),
                              2
                            );

                      return (
                        <div
                          key={idx}
                          onClick={() => navigate(`/products/${item.id}`)}
                          className="p-3 bg-white border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-md transition-all cursor-pointer group"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start gap-2 mb-2">
                                <div className="flex-1 min-w-0">
                                  <h3
                                    className="font-medium text-gray-900 group-hover:text-blue-600 block sm:inline"
                                    style={getProductNameColor(item.name) ? { color: getProductNameColor(item.name) } : undefined}
                                  >
                                    {item.name}
                                  </h3>
                                  {(item.brand_name || item.category_name) && (
                                    <span className="hidden md:inline-flex items-center text-sm text-gray-500 ml-2 font-normal">
                                      {item.brand_name && <span>{item.brand_name}</span>}
                                      {item.brand_name && item.category_name && <span className="mx-1.5 text-gray-300">|</span>}
                                      {item.category_name && <span>{item.category_name}</span>}
                                    </span>
                                  )}
                                </div>
                                {item.is_active ? (
                                  <Badge variant="outline" className="text-xs shrink-0">
                                    Active
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs shrink-0">
                                    Inactive
                                  </Badge>
                                )}
                              </div>

                              {/* Desktop/Tablet Details List (Mobile hidden) */}
                              <div className="md:hidden flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-600 mb-2">
                                {item.brand_name && <span>{item.brand_name}</span>}
                                {item.category_name && <span>{item.category_name}</span>}
                              </div>

                            </div>
                            <div className="flex flex-col items-end gap-1 flex-shrink-0 pt-0.5">
                              <div className="flex items-center gap-3">
                                <div className="text-right">
                                  <div className={`text-xl font-bold leading-none ${hasPrice ? 'text-green-600 group-hover:text-green-700' : 'text-gray-400 group-hover:text-gray-500'}`}>
                                    {priceDisplay}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-none">QTY</div>
                                  <div className="text-xl font-bold text-indigo-600 group-hover:text-indigo-700 leading-none">
                                    {warehousePlusAvailable}
                                  </div>
                                </div>
                              </div>
                              <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-blue-600 transition-colors mt-auto" />
                            </div>
                          </div>

                          {/* Supplier Breakdown Table */}
                          {item.supplier_breakdown && item.supplier_breakdown.length > 0 && (
                            <div className="mt-4 overflow-x-auto border border-gray-100 rounded-md">
                              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
                                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                  Supplier breakdown
                                </div>
                                <label
                                  className="flex items-center gap-2 text-[11px] font-medium text-gray-700 select-none cursor-pointer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    checked={showZeroRows}
                                    onChange={(e) => setShowZeroRows(e.target.checked)}
                                    className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                                  />
                                  Show zero rows
                                </label>
                              </div>
                              <table className="min-w-full divide-y divide-gray-100">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider align-middle whitespace-nowrap">Supplier</th>
                                    <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider align-middle whitespace-nowrap">Purchase date</th>
                                    <th className="px-3 py-2 text-right text-[10px] font-bold text-gray-500 uppercase tracking-wider align-middle whitespace-nowrap">Whse</th>
                                    <th className="px-3 py-2 text-right text-[10px] font-bold text-gray-500 uppercase tracking-wider align-middle whitespace-nowrap">Available</th>
                                    <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider align-middle whitespace-nowrap">Purchase Price</th>
                                    <th className="px-3 py-2 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider align-middle whitespace-nowrap">Selling Price</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-50">
                                  {item.supplier_breakdown.map((s: any, sIdx: number) => (
                                    <tr key={sIdx} className="hover:bg-gray-50 transition-colors">
                                      <td className="px-3 py-2 whitespace-nowrap text-xs font-medium text-gray-900 truncate max-w-[120px] align-middle">{s.supplier}</td>
                                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600 align-middle">{s.purchase_date ?? '—'}</td>
                                      <td className="px-3 py-2 whitespace-nowrap text-xs text-right text-gray-600 font-semibold align-middle">{formatNumber(s.warehouse_available ?? s.warehouse_stock, 2)}</td>
                                      <td className="px-3 py-2 whitespace-nowrap text-xs text-right text-blue-600 font-semibold align-middle">{formatNumber(s.shop_barcode_count ?? s.shop_stock, 2)}</td>
                                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-700 font-medium align-middle">{s.price}</td>
                                      <td className="px-3 py-2 whitespace-nowrap text-xs text-green-600 font-medium align-middle">{s.selling_price ?? '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {/* Fallback to simple breakdown if supplier_breakdown missing */}
                          {!item.supplier_breakdown && (item.stock_bifurcation || item.price_bifurcation) && (
                            <div className="space-y-0.5 mt-2">
                              {item.stock_bifurcation && (
                                <div className="text-sm font-medium text-blue-600">
                                  Stock: {item.stock_bifurcation}
                                </div>
                              )}
                              {item.price_bifurcation && (
                                <div className="text-sm font-medium text-green-600">
                                  Price: {item.price_bifurcation}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  {(searchType === 'all' || searchType === 'product') &&
                    productLimit > 0 &&
                    productLimit < 500 &&
                    (data.products || []).length >= productLimit && (
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={() => {
                            scrollYRef.current = window.scrollY;
                            setProductLimit((prev) => Math.min(prev + 50, 500));
                          }}
                          disabled={isFetching}
                        >
                          {isFetching ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                              Loading…
                            </>
                          ) : (
                            'Load 50 more'
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={() => {
                            scrollYRef.current = window.scrollY;
                            setProductLimit(0);
                          }}
                          disabled={isFetching}
                        >
                          Show all
                        </Button>
                      </div>
                    )}
                </>

              {/* Barcodes: show all matching barcodes with current status; if sold, show invoice detail */}
              <ResultSection
                title="Barcodes"
                icon={BarcodeIcon}
                items={data.barcodes || []}
                onItemClick={(item) => {
                  if (item.invoice_id) {
                    navigate(`/invoices/${item.invoice_id}`);
                  } else if (item.product) {
                    navigate(`/products/${item.product}`);
                  }
                }}
                getItemLabel={(item) => item.short_code || item.barcode || 'N/A'}
                getItemSubLabel={(item) => {
                  const parts = [];
                  parts.push(`Status: ${item.tag_display || item.tag || 'Unknown'}`);
                  if (item.invoice_number) parts.push(`Invoice: ${item.invoice_number}`);
                  if (item.product) parts.push(`Product ID: ${item.product}`);
                  return parts.join(' | ');
                }}
                getItemBadge={(item) => item.tag_display || item.tag || 'Unknown'}
                customRender={(item, idx) => (
                  <div
                    key={idx}
                    onClick={() => {
                      if (item.invoice_id) {
                        navigate(`/invoices/${item.invoice_id}`);
                      } else if (item.product) {
                        navigate(`/products/${item.product}`);
                      }
                    }}
                    className="p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-md transition-all cursor-pointer group"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-medium text-gray-900 group-hover:text-blue-600">
                            {item.short_code || item.barcode || 'N/A'}
                          </h3>
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              item.tag === 'sold'
                                ? 'border-amber-200 text-amber-700 bg-amber-50'
                                : item.tag === 'defective'
                                  ? 'border-red-200 text-red-700 bg-red-50'
                                  : item.tag === 'new'
                                    ? 'border-green-200 text-green-700 bg-green-50'
                                    : item.tag === 'returned'
                                      ? 'border-blue-200 text-blue-700 bg-blue-50'
                                      : 'border-gray-200 text-gray-700'
                            }`}
                          >
                            {item.tag_display || item.tag || 'Unknown'}
                          </Badge>
                        </div>
                        {/* Invoice details when sold */}
                        {item.tag === 'sold' && (item.invoice_number || item.invoice_id) && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-2 gap-x-4 text-sm mt-3">
                            {item.invoice_number && (
                              <div className="flex items-center gap-2">
                                <span className="text-gray-400 font-medium">Invoice:</span>
                                <span className="font-semibold text-blue-600">{item.invoice_number}</span>
                              </div>
                            )}
                            {item.invoice_date && (
                              <div className="flex items-center gap-2">
                                <span className="text-gray-400 font-medium">Date:</span>
                                <span className="text-gray-700 font-medium">
                                  {new Date(item.invoice_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </span>
                              </div>
                            )}
                            {item.customer_name && (
                              <div className="flex items-center gap-2">
                                <span className="text-gray-400 font-medium whitespace-nowrap">Customer:</span>
                                <span className="text-gray-700 font-medium truncate">{item.customer_name}</span>
                              </div>
                            )}
                            {item.invoice_type_display && (
                              <div className="flex items-center gap-2">
                                <span className="text-gray-400 font-medium whitespace-nowrap">Payment:</span>
                                <span className="text-gray-700 font-medium">{item.invoice_type_display}</span>
                              </div>
                            )}
                            {item.product && (
                              <div className="flex items-center gap-2">
                                <span className="text-gray-400 font-medium whitespace-nowrap">Product ID:</span>
                                <span className="text-gray-600">{item.product}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {/* Non-sold: show status only (defective, fresh/new, returned, etc.) */}
                        {item.tag !== 'sold' && item.tag_display && (
                          <p className="text-sm text-gray-600 mt-1">
                            Current status: {item.tag_display}
                            {item.product && ` · Product ID: ${item.product}`}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 flex-shrink-0 pt-0.5">
                        {item.tag === 'sold' && item.sold_price != null && (
                          <div className="text-right">
                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Sold Price</div>
                            <div className="text-xl font-bold text-green-600 group-hover:text-green-700 leading-none">
                              ₹{formatNumber(item.sold_price)}
                            </div>
                          </div>
                        )}
                        {item.tag !== 'sold' && (item.selling_price != null || item.purchase_price != null) && (
                          <div className="text-right space-y-1">
                            {item.selling_price != null && item.selling_price > 0 && (
                              <div>
                                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Selling Price</div>
                                <div className="text-xl font-bold text-green-600 group-hover:text-green-700 leading-none">
                                  ₹{formatNumber(item.selling_price)}
                                </div>
                              </div>
                            )}
                            {item.purchase_price != null && item.purchase_price > 0 && (
                              <div>
                                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Purchase Price</div>
                                <div className="text-base font-semibold text-gray-600 leading-none">
                                  ₹{formatNumber(item.purchase_price)}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-blue-600 transition-colors mt-auto" />
                      </div>
                    </div>
                  </div>
                )}
              />

              <ResultSection
                title="Customers"
                icon={Users}
                items={data.customers}
                onItemClick={(item) => {
                  const params = new URLSearchParams();
                  params.set('search', debouncedQuery);
                  params.set('is_active', item.is_active ? 'true' : 'false');
                  if (item.customer_group) params.set('customer_group', item.customer_group.toString());
                  navigate(`/customers?${params.toString()}`);
                }}
                getItemLabel={(item) => item.name}
                getItemSubLabel={(item) => `${item.phone || ''} ${item.email ? `| ${item.email}` : ''}`.trim()}
                getItemBadge={(item) => item.is_active ? 'Active' : 'Inactive'}
              />

              <ResultSection
                title="Invoices"
                icon={FileText}
                items={data.invoices}
                onItemClick={(item) => {
                  const params = new URLSearchParams();
                  params.set('search', debouncedQuery);
                  params.set('status', item.status);
                  navigate(`/invoices?${params.toString()}`);
                }}
                getItemLabel={(item) => item.invoice_number}
                getItemSubLabel={(item) => {
                  const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
                  return `Customer: ${item.customer_name || 'N/A'} | Total: ₹${item.total || '0.00'}${dateStr ? ` | ${dateStr}` : ''}`;
                }}
                getItemBadge={(item) => item.status}
              />

              <ResultSection
                title="Carts"
                icon={ShoppingCart}
                items={data.carts}
                onItemClick={(_item) => navigate('/pos')}
                getItemLabel={(item) => item.cart_number}
                getItemSubLabel={(item) => `Status: ${item.status} | Customer: ${item.customer_name || 'N/A'}`}
                getItemBadge={(item) => item.status}
              />

              <ResultSection
                title="Suppliers"
                icon={Building2}
                items={data.suppliers}
                onItemClick={(_item) => navigate('/purchases')}
                getItemLabel={(item) => item.name}
                getItemSubLabel={(item) => `${item.code ? `Code: ${item.code} | ` : ''}${item.phone || ''} ${item.email ? `| ${item.email}` : ''}`.trim()}
                getItemBadge={(item) => item.is_active ? 'Active' : 'Inactive'}
              />

              <ResultSection
                title="Categories"
                icon={Tag}
                items={data.categories}
                onItemClick={(_item) => navigate('/products')}
                getItemLabel={(item) => item.name}
                getItemBadge={(item) => item.is_active ? 'Active' : 'Inactive'}
              />

              <ResultSection
                title="Brands"
                icon={Tag}
                items={data.brands}
                onItemClick={(_item) => navigate('/products')}
                getItemLabel={(item) => item.name}
                getItemBadge={(item) => item.is_active ? 'Active' : 'Inactive'}
              />

              <ResultSection
                title="Stores"
                icon={Store}
                items={data.stores}
                onItemClick={(item) => {
                  const params = new URLSearchParams();
                  params.set('is_active', item.is_active ? 'true' : 'false');
                  params.set('shop_type', item.shop_type || '');
                  navigate(`/stores?${params.toString()}`);
                }}
                getItemLabel={(item) => item.name}
                getItemSubLabel={(item) => `Code: ${item.code} | Type: ${item.shop_type}`}
                getItemBadge={(item) => item.is_active ? 'Active' : 'Inactive'}
              />

              <ResultSection
                title="Warehouses"
                icon={Warehouse}
                items={data.warehouses}
                onItemClick={(_item) => navigate('/purchases')}
                getItemLabel={(item) => item.name}
                getItemSubLabel={(item) => `Code: ${item.code}`}
                getItemBadge={(item) => item.is_active ? 'Active' : 'Inactive'}
              />

              <ResultSection
                title="Purchases"
                icon={ShoppingBag}
                items={data.purchases}
                onItemClick={(item) => {
                  const params = new URLSearchParams();
                  if (item.supplier) params.set('supplier', item.supplier.toString());
                  if (item.purchase_date) {
                    params.set('date_from', item.purchase_date);
                    params.set('date_to', item.purchase_date);
                  }
                  navigate(`/purchases?${params.toString()}`);
                }}
                getItemLabel={(item) => item.purchase_number || `PUR-${item.id}`}
                getItemSubLabel={(item) => `Supplier: ${item.supplier_name || 'N/A'} | Total: ₹${item.total || '0.00'}`}
              />
            </div>
          )}
        </>
      )}

      {!isLoading && !error && !debouncedQuery.trim() && (
        <div className="text-center py-12">
          <SearchIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600">Enter a search query to find products, customers, invoices, and more</p>
        </div>
      )}
    </div>
  );
}

