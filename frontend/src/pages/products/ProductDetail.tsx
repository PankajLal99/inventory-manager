import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { productsApi, catalogApi } from '../../lib/api';
import Badge from '../../components/ui/Badge';
import { Box, Barcode, Package, DollarSign, ShoppingCart, AlertCircle, Store, Warehouse, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { formatAppDate, sortSupplierBreakdownByDateDesc } from '../../lib/utils';
import Button from '../../components/ui/Button';

const PRODUCT_INVOICES_PAGE_SIZE = 20;

const TAG_LABELS: Record<string, string> = {
  new: 'New (Fresh)',
  returned: 'Returned',
  'in-cart': 'In Cart',
  defective: 'Defective',
  unknown: 'Unknown',
  sold: 'Sold',
};

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const productId = parseInt(id || '0');
  const [expandedTags, setExpandedTags] = useState<Record<string, boolean>>({ new: true, returned: true, sold: false });

  const { data: product, isLoading, error } = useQuery({
    queryKey: ['product', productId],
    queryFn: () => productsApi.get(productId),
    enabled: !!productId,
    retry: false,
  });

  const { data: barcodesFull } = useQuery({
    queryKey: ['product-barcodes-full', productId],
    queryFn: () => productsApi.barcodesFull(productId),
    enabled: !!productId && !!product?.data,
  });

  const {
    data: invoicesInfiniteData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: invoicesLoading,
  } = useInfiniteQuery({
    queryKey: ['product-invoices', productId],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const res = await productsApi.invoices(productId, {
        limit: PRODUCT_INVOICES_PAGE_SIZE,
        offset: pageParam as number,
      });
      return res.data;
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage?.has_more) return undefined;
      const next = (lastPage.offset ?? 0) + (lastPage.invoices?.length ?? 0);
      return next;
    },
    enabled: !!productId && !!product?.data,
  });

  const { data: taxRatesData } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => catalogApi.taxRates.list(),
    enabled: !!product?.data?.tax_rate,
  });

  const taxRate = taxRatesData?.data?.find((tr: any) => tr.id === product?.data?.tax_rate);

  const toggleTag = (tag: string) => {
    setExpandedTags((prev) => ({ ...prev, [tag]: !prev[tag] }));
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  if (error || !product?.data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-red-600">Product not found</p>
        </div>
      </div>
    );
  }

  const p = product.data;
  const byTag = barcodesFull?.data?.by_tag || {};
  const invoices =
    invoicesInfiniteData?.pages.flatMap((page) => page?.invoices ?? []) ?? [];
  const invoicesTotal = invoicesInfiniteData?.pages[0]?.total ?? invoices.length;
  const tagOrder = ['new', 'returned', 'in-cart', 'defective', 'unknown', 'sold'];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          {p.image && (
            <img
              src={p.image}
              alt={p.name}
              className="w-16 h-16 object-cover rounded-lg"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <h1 className="text-3xl font-bold text-gray-900">{p.name}</h1>
        </div>
        <Badge variant={p.is_active ? 'success' : 'default'}>
          {p.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Product Information</h2>
          <dl className="space-y-3">
            <div>
              <dt className="text-sm text-gray-500">SKU</dt>
              <dd className="text-sm font-medium">{p.sku || '-'}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Category</dt>
              <dd className="text-sm font-medium">{p.category_name || '-'}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Brand</dt>
              <dd className="text-sm font-medium">{p.brand_name || '-'}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Type</dt>
              <dd className="text-sm font-medium capitalize">{p.product_type}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Tax Rate</dt>
              <dd className="text-sm font-medium">{taxRate ? `${taxRate.name} (${taxRate.rate}%)` : '-'}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Description</dt>
              <dd className="text-sm">{p.description || '-'}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Created</dt>
              <dd className="text-sm font-medium">
                {formatAppDate(p.created_at, { includeTime: true, empty: '-' })}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Last Updated</dt>
              <dd className="text-sm font-medium">
                {formatAppDate(p.updated_at, { includeTime: true, empty: '-' })}
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Inventory & Settings</h2>
          <dl className="space-y-3">
            {p.track_inventory && (
              <>
                <div className="flex items-center">
                  <Box className="h-5 w-5 text-green-600 mr-2" />
                  <div className="flex-1">
                    <dt className="text-sm text-gray-500">Total Stock</dt>
                    <dd className="text-sm font-medium text-green-600">{p.stock_quantity || 0}</dd>
                    <p className="text-xs text-gray-400 mt-0.5">All barcodes (excl. sold)</p>
                  </div>
                </div>
                <div className="flex items-center">
                  <Store className="h-5 w-5 text-blue-600 mr-2" />
                  <div className="flex-1">
                    <dt className="text-sm text-gray-500">Shop Stock</dt>
                    <dd className="text-sm font-medium text-blue-600">{p.shop_stock ?? 0}</dd>
                    <p className="text-xs text-gray-400 mt-0.5">In retail store(s)</p>
                  </div>
                </div>
                <div className="flex items-center">
                  <Warehouse className="h-5 w-5 text-gray-600 mr-2" />
                  <div className="flex-1">
                    <dt className="text-sm text-gray-500">Warehouse Stock</dt>
                    <dd className="text-sm font-medium text-gray-700">{p.warehouse_stock ?? 0}</dd>
                    <p className="text-xs text-gray-400 mt-0.5">In warehouse</p>
                  </div>
                </div>
                <div className="flex items-center">
                  <ShoppingCart className="h-5 w-5 text-emerald-600 mr-2" />
                  <div className="flex-1">
                    <dt className="text-sm text-gray-500">Available to Sell</dt>
                    <dd className="text-sm font-medium text-emerald-600">{p.available_quantity || 0}</dd>
                    <p className="text-xs text-gray-400 mt-0.5">New + returned barcodes</p>
                  </div>
                </div>
                {p.low_stock_threshold > 0 && (
                  <div className="flex items-center">
                    <AlertCircle className={`h-5 w-5 mr-2 ${(p.stock_quantity || 0) <= p.low_stock_threshold ? 'text-red-600' : 'text-gray-400'}`} />
                    <div className="flex-1">
                      <dt className="text-sm text-gray-500">Low Stock Threshold</dt>
                      <dd className={`text-sm font-medium ${(p.stock_quantity || 0) <= p.low_stock_threshold ? 'text-red-600' : ''}`}>
                        {p.low_stock_threshold}
                      </dd>
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="flex items-center">
              <Box className="h-5 w-5 text-gray-400 mr-2" />
              <div className="flex-1">
                <dt className="text-sm text-gray-500">Track Inventory</dt>
                <dd className="text-sm font-medium">{p.track_inventory ? 'Yes' : 'No'}</dd>
              </div>
            </div>
            <div className="flex items-center">
              <Package className="h-5 w-5 text-gray-400 mr-2" />
              <div className="flex-1">
                <dt className="text-sm text-gray-500">Track Batches</dt>
                <dd className="text-sm font-medium">{p.track_batches ? 'Yes' : 'No'}</dd>
              </div>
            </div>
            <div className="flex items-center">
              <DollarSign className="h-5 w-5 text-gray-400 mr-2" />
              <div className="flex-1">
                <dt className="text-sm text-gray-500">Can Go Below Purchase Price</dt>
                <dd className="text-sm font-medium">{p.can_go_below_purchase_price ? 'Yes' : 'No'}</dd>
              </div>
            </div>
          </dl>
        </div>
      </div>

      {/* Supplier breakdown: Whse + Shop Qty (shop - sold) per supplier */}
      {p.supplier_breakdown && Array.isArray(p.supplier_breakdown) && p.supplier_breakdown.length > 0 && (
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Inventory by supplier</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supplier</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Purchase date</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Whse</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-blue-600 uppercase tracking-wider">Shop Qty</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortSupplierBreakdownByDateDesc(p.supplier_breakdown).map((s: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{s.supplier}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.purchase_date ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{Number(s.warehouse_available ?? s.warehouse_stock).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-blue-600">{(s.shop_barcode_count ?? s.shop_stock).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 mt-2">One row per purchase batch (latest first). Shop Qty = available barcodes from that batch.</p>
        </div>
      )}

      {/* Barcodes - grouped by tag, collapsible */}
      {barcodesFull?.data?.total > 0 && (
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center">
            <Barcode className="h-5 w-5 mr-2" />
            Barcodes ({barcodesFull?.data?.total ?? 0})
          </h2>
          <div className="space-y-2">
            {tagOrder.map((tag) => {
              const items = byTag[tag] || [];
              if (items.length === 0) return null;
              const isExpanded = expandedTags[tag] !== false;
              return (
                <div key={tag} className="border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-gray-500" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-gray-500" />
                      )}
                      <Badge
                        variant={
                          tag === 'new' ? 'success' :
                          tag === 'returned' ? 'info' :
                          tag === 'sold' ? 'default' :
                          tag === 'defective' ? 'danger' : 'default'
                        }
                      >
                        {TAG_LABELS[tag] || tag}
                      </Badge>
                      <span className="text-sm text-gray-600">{items.length} barcode(s)</span>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-gray-200">
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-100">
                          <thead className="bg-gray-50/50">
                            <tr>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Barcode</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Location</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Supplier</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Purchase Date</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Price</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {items.map((b: any) => (
                              <tr key={b.id} className="hover:bg-gray-50/50">
                                <td className="px-4 py-2 text-sm font-mono">{b.short_code || b.barcode}</td>
                                <td className="px-4 py-2 text-sm text-gray-600">{b.location}</td>
                                <td className="px-4 py-2 text-sm">{b.supplier_name || '—'}</td>
                                <td className="px-4 py-2 text-sm">{b.purchase_date || '—'}</td>
                                <td className="px-4 py-2 text-sm text-right">
                                  {b.sold_price != null ? `₹${b.sold_price}` : b.purchase_price != null ? `₹${b.purchase_price}` : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Related Invoices (paginated; backend was capped at 50, now limit/offset) */}
      {(invoices.length > 0 || invoicesLoading) && (
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center">
            <FileText className="h-5 w-5 mr-2" />
            Related Invoices
            {invoicesTotal > 0 && (
              <span className="ml-2 text-base font-normal text-gray-500">
                (showing {invoices.length} of {invoicesTotal})
              </span>
            )}
          </h2>
          {invoicesLoading && invoices.length === 0 ? (
            <div className="text-center py-8 text-gray-500">Loading invoices...</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Invoice</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Customer</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Qty</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {invoices.map((inv: any) => (
                      <tr
                        key={inv.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => navigate(`/invoices/${inv.id}`)}
                      >
                        <td className="px-4 py-3 text-sm font-medium text-blue-600">{inv.invoice_number}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {formatAppDate(inv.created_at, { includeTime: false, empty: '—' })}
                        </td>
                        <td className="px-4 py-3 text-sm">{inv.customer_name}</td>
                        <td className="px-4 py-3 text-sm">
                          <Badge variant={inv.status === 'paid' ? 'success' : inv.status === 'credit' ? 'info' : 'default'}>
                            {inv.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm text-right">{inv.product_quantity}</td>
                        <td className="px-4 py-3 text-sm text-right font-medium">₹{inv.total?.toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasNextPage && (
                <div className="mt-4 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? 'Loading...' : 'Load more'}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {p.variants && Array.isArray(p.variants) && p.variants.length > 0 && (
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Variants</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">SKU</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Attributes</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {p.variants.map((variant: any) => (
                  <tr key={variant.id}>
                    <td className="px-4 py-3 text-sm font-medium">{variant.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{variant.sku}</td>
                    <td className="px-4 py-3 text-sm">
                      {variant.attributes && Object.keys(variant.attributes).length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(variant.attributes).map(([key, value]) => (
                            <Badge key={key} variant="info" className="text-xs">
                              {key}: {String(value)}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <Badge variant={variant.is_active ? 'success' : 'default'}>
                        {variant.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {p.components && Array.isArray(p.components) && p.components.length > 0 && (
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center">
            <Package className="h-5 w-5 mr-2" />
            Components ({p.components.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Component Product</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Quantity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {p.components.map((component: any) => (
                  <tr key={component.id}>
                    <td className="px-4 py-3 text-sm font-medium">{component.component_product_name}</td>
                    <td className="px-4 py-3 text-sm">{component.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
