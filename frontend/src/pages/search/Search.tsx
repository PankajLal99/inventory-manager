import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  Box,
  Barcode as BarcodeIcon,
  Camera,
} from 'lucide-react';
import Input from '../../components/ui/Input';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import BarcodeScanner from '../../components/BarcodeScanner';

interface SearchResults {
  products: any[];
  variants: any[];
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

export default function Search() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const [query, setQuery] = useState(initialQuery);
  const [showScanner, setShowScanner] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<SearchResults>({
    queryKey: ['global-search', query],
    queryFn: async () => {
      if (!query.trim()) {
        return {
          products: [],
          variants: [],
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
      const response = await searchApi.search(query);
      return response.data;
    },
    enabled: query.trim().length > 0,
    retry: false,
  });

  // Sync query with URL params
  useEffect(() => {
    const urlQuery = searchParams.get('q') || '';
    if (urlQuery !== query) {
      setQuery(urlQuery);
    }
  }, [searchParams]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setSearchParams({ q: query.trim() });
    } else {
      setSearchParams({});
    }
    // Query will trigger automatically via useQuery
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
        setQuery(trimmedBarcode);
        setSearchParams({ q: trimmedBarcode });
        setShowScanner(false);
      }
    } catch (error: any) {
      // If barcode not found, try searching for it in the search query
      if (error?.response?.status === 404) {
        setQuery(trimmedBarcode);
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
        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <Input
              type="text"
              placeholder="Search products, customers, invoices, SKUs, barcodes..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-12 pr-4 py-3 text-lg"
              autoFocus
            />
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

      {!isLoading && !error && query.trim() && (
        <>
          {totalResults === 0 ? (
            <div className="text-center py-12">
              <SearchIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600">No results found for "{query}"</p>
            </div>
          ) : (
            <div className="mb-4">
              <p className="text-sm text-gray-600">
                Found <span className="font-semibold">{totalResults}</span> result{totalResults !== 1 ? 's' : ''} for "{query}"
              </p>
            </div>
          )}

          {data && (
            <div>
              {/* Products section - shown first and prioritized */}
              {/* Sort products: items with prices first */}
              {(() => {
                const sortedProducts = [...(data.products || [])].sort((a, b) => {
                  // Check if product has price (selling_price > 0 or purchase_price > 0)
                  const aHasPrice = (a.selling_price && a.selling_price > 0) || (a.purchase_price && a.purchase_price > 0);
                  const bHasPrice = (b.selling_price && b.selling_price > 0) || (b.purchase_price && b.purchase_price > 0);
                  
                  // Products with prices come first
                  if (aHasPrice && !bHasPrice) return -1;
                  if (!aHasPrice && bHasPrice) return 1;
                  return 0; // Keep original order for items in the same group
                });
                
                return (
                  <ResultSection
                    title="Products"
                    icon={Package}
                    items={sortedProducts}
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
                  // Show Available Qty
                  if (item.available_quantity !== undefined && item.available_quantity !== null) {
                    parts.push(`Available Qty: ${parseFloat(item.available_quantity).toFixed(0)}`);
                  }
                  // Show SKU last
                  if (item.sku) parts.push(`SKU: ${item.sku}`);
                  return parts.length > 0 ? parts.join(' | ') : 'No details available';
                }}
                getItemBadge={(item) => item.is_active ? 'Active' : 'Inactive'}
                customRender={(item, idx) => {
                  // Get price (selling_price if available, otherwise purchase_price)
                  const price = item.selling_price && item.selling_price > 0 
                    ? item.selling_price 
                    : (item.purchase_price || null);
                  const priceDisplay = price ? `₹${parseFloat(price).toFixed(2)}` : 'N/A';
                  
                  // Get quantity
                  const quantity = item.available_quantity !== undefined && item.available_quantity !== null
                    ? parseFloat(item.available_quantity).toFixed(0)
                    : null;
                  
                  // Build other details (excluding quantity since it's shown separately)
                  const details = [];
                  if (item.brand_name) details.push(`Brand: ${item.brand_name}`);
                  if (item.category_name) details.push(`Category: ${item.category_name}`);
                  if (item.sku) details.push(`SKU: ${item.sku}`);
                  
                  return (
                    <div
                      key={idx}
                      onClick={() => navigate(`/products/${item.id}`)}
                      className="p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-md transition-all cursor-pointer group"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-medium text-gray-900 group-hover:text-blue-600">
                              {item.name}
                            </h3>
                            {item.is_active ? (
                              <Badge variant="outline" className="text-xs">
                                Active
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">
                                Inactive
                              </Badge>
                            )}
                          </div>
                          {details.length > 0 && (
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-600">
                              {details.map((detail, detailIdx) => (
                                <span key={detailIdx}>{detail}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          {price && (
                            <div className="text-right">
                              <div className="text-2xl font-bold text-green-600 group-hover:text-green-700">
                                {priceDisplay}
                              </div>
                            </div>
                          )}
                          {quantity !== null && (
                            <div className="text-right">
                              <div className="text-sm text-gray-500 mb-0.5">Qty</div>
                              <div className="text-xl font-semibold text-blue-600 group-hover:text-blue-700">
                                {quantity}
                              </div>
                            </div>
                          )}
                          <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-blue-600 transition-colors mt-auto" />
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
                );
              })()}

              <ResultSection
                title="Product Variants"
                icon={Box}
                items={data.variants}
                onItemClick={(item) => navigate(`/products/${item.product}`)}
                getItemLabel={(item) => item.name}
                getItemSubLabel={(item) => `SKU: ${item.sku}`}
              />

              <ResultSection
                title="Barcodes"
                icon={BarcodeIcon}
                items={data.barcodes.filter((item) => item.tag === 'new' || item.tag === 'returned')}
                onItemClick={(item) => {
                  if (item.product) {
                    navigate(`/products/${item.product}`);
                  }
                }}
                getItemLabel={(item) => item.barcode}
                getItemSubLabel={(item) => item.product ? `Product ID: ${item.product}` : 'No product'}
              />

              {/* Sold Barcodes - barcodes with tags other than 'new' and 'returned' */}
              {(() => {
                const soldBarcodes = (data.barcodes || []).filter(
                  (item) => item.tag && item.tag !== 'new' && item.tag !== 'returned'
                );
                
                return (
                  <ResultSection
                    title="Sold Barcodes"
                    icon={BarcodeIcon}
                    items={soldBarcodes}
                    onItemClick={(item) => {
                      if (item.invoice_id) {
                        navigate(`/invoices/${item.invoice_id}`);
                      } else if (item.product) {
                        navigate(`/products/${item.product}`);
                      }
                    }}
                    getItemLabel={(item) => item.barcode || item.short_code || 'N/A'}
                    getItemSubLabel={(item) => {
                      const parts = [];
                      if (item.product) parts.push(`Product ID: ${item.product}`);
                      if (item.tag_display) parts.push(`Tag: ${item.tag_display}`);
                      if (item.invoice_number) parts.push(`Invoice: ${item.invoice_number}`);
                      return parts.length > 0 ? parts.join(' | ') : 'No details available';
                    }}
                    getItemBadge={(item) => item.tag_display || item.tag || 'Unknown'}
                    customRender={(item, idx) => {
                      return (
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
                                  {item.barcode || item.short_code || 'N/A'}
                                </h3>
                                {item.tag_display && (
                                  <Badge variant="outline" className="text-xs">
                                    {item.tag_display}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-600">
                                {item.product && (
                                  <span>Product ID: {item.product}</span>
                                )}
                                {item.invoice_number && (
                                  <span className="font-semibold text-blue-600">
                                    Invoice: {item.invoice_number}
                                  </span>
                                )}
                              </div>
                            </div>
                            <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-blue-600 transition-colors flex-shrink-0 ml-2" />
                          </div>
                        </div>
                      );
                    }}
                  />
                );
              })()}

              <ResultSection
                title="Customers"
                icon={Users}
                items={data.customers}
                onItemClick={(item) => {
                  const params = new URLSearchParams();
                  params.set('search', query);
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
                  params.set('search', query);
                  params.set('status', item.status);
                  navigate(`/invoices?${params.toString()}`);
                }}
                getItemLabel={(item) => item.invoice_number}
                getItemSubLabel={(item) => `Customer: ${item.customer_name || 'N/A'} | Total: ₹${item.total || '0.00'}`}
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

      {!isLoading && !error && !query.trim() && (
        <div className="text-center py-12">
          <SearchIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600">Enter a search query to find products, customers, invoices, and more</p>
        </div>
      )}
    </div>
  );
}

