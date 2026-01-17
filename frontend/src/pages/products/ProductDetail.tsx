import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { productsApi, catalogApi } from '../../lib/api';
import Badge from '../../components/ui/Badge';
import { Box, Barcode, Package, DollarSign, ShoppingCart, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const productId = parseInt(id || '0');

  const { data: product, isLoading, error } = useQuery({
    queryKey: ['product', productId],
    queryFn: () => productsApi.get(productId),
    enabled: !!productId,
    retry: false,
  });

  // Fetch tax rates to get tax rate name
  const { data: taxRatesData } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => catalogApi.taxRates.list(),
    enabled: !!product?.data?.tax_rate,
  });

  const taxRate = taxRatesData?.data?.find((tr: any) => tr.id === product?.data?.tax_rate);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
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
                {p.created_at ? format(new Date(p.created_at), 'PPpp') : '-'}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Last Updated</dt>
              <dd className="text-sm font-medium">
                {p.updated_at ? format(new Date(p.updated_at), 'PPpp') : '-'}
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
                    <p className="text-xs text-gray-400 mt-0.5">All barcodes count</p>
                  </div>
                </div>
                <div className="flex items-center">
                  <ShoppingCart className="h-5 w-5 text-blue-600 mr-2" />
                  <div className="flex-1">
                    <dt className="text-sm text-gray-500">Available Stock</dt>
                    <dd className="text-sm font-medium text-blue-600">{p.available_quantity || 0}</dd>
                    <p className="text-xs text-gray-400 mt-0.5">Barcodes with tag 'new' or 'returned'</p>
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

      {p.barcodes && Array.isArray(p.barcodes) && p.barcodes.length > 0 && (
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center">
            <Barcode className="h-5 w-5 mr-2" />
            Barcodes ({p.barcodes.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Barcode</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Tag</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Purchase Price</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Supplier</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Purchase Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Primary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {p.barcodes.map((barcode: any) => (
                  <tr key={barcode.id}>
                    <td className="px-4 py-3 text-sm font-mono font-medium">{barcode.barcode}</td>
                    <td className="px-4 py-3 text-sm">
                      <Badge variant={
                        barcode.tag === 'new' ? 'success' : 
                        barcode.tag === 'returned' ? 'info' : 
                        barcode.tag === 'sold' ? 'default' : 
                        'default'
                      }>
                        {barcode.tag_display || barcode.tag}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm">₹{barcode.purchase_price || '-'}</td>
                    <td className="px-4 py-3 text-sm">{barcode.supplier_name || '-'}</td>
                    <td className="px-4 py-3 text-sm">{barcode.purchase_date || '-'}</td>
                    <td className="px-4 py-3 text-sm">
                      {barcode.is_primary && (
                        <Badge variant="info">Primary</Badge>
                      )}
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
