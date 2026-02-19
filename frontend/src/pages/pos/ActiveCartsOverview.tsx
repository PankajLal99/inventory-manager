import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { posApi, catalogApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import {
  ShoppingCart,
  User,
  Lock,
  Store,
  ChevronDown,
  ChevronRight,
  Package,
} from 'lucide-react';
import { formatNumber } from '../../lib/utils';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import Select from '../../components/ui/Select';
import LoadingState from '../../components/ui/LoadingState';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';

interface CartItemOverview {
  id: number;
  product: number;
  product_name: string;
  product_sku: string;
  quantity: string;
  unit_price: string;
  discount_amount?: string;
  tax_amount?: string;
}

interface CartOverview {
  id: number;
  cart_number: string;
  store: number;
  store_name: string;
  status: string;
  locked: boolean;
  created_by: number | null;
  created_by_username: string | null;
  customer: number | null;
  customer_name: string | null;
  created_at: string;
  updated_at: string;
  items: CartItemOverview[];
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function ActiveCartsOverview() {
  const [storeId, setStoreId] = useState<number | ''>('');
  const [expandedCartId, setExpandedCartId] = useState<number | null>(null);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const loadUser = async () => {
      try {
        await auth.loadUser();
        setUser(auth.getUser());
      } catch {
        // ignore
      }
    };
    loadUser();
  }, []);

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

  const isAdmin =
    user?.is_admin ||
    user?.is_superuser ||
    user?.is_staff ||
    (user?.groups && user.groups.includes('Admin'));

  const { data: carts, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pos/carts/overview', storeId || undefined],
    queryFn: async () => {
      const params = storeId ? { store: storeId } : undefined;
      const response = await posApi.carts.getOverview(params);
      return response.data as CartOverview[];
    },
  });

  const list = Array.isArray(carts) ? carts : [];

  if (isLoading) {
    return (
      <div className="p-6">
        <PageHeader title="Active Carts Overview" />
        <LoadingState message="Loading carts…" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <PageHeader title="Active Carts Overview" />
        <ErrorState
          message={(error as any)?.response?.data?.detail || (error as Error)?.message || 'Failed to load carts'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Active Carts Overview"
        subtitle="View which carts are active, who has them, and what’s in each. Read-only; no changes or continue-to-cart here."
      />

      {isAdmin && stores.length > 1 && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-center gap-4">
            <label className="text-sm font-medium text-gray-700">Store</label>
            <Select
              value={storeId === '' ? '' : String(storeId)}
              onChange={(e) => setStoreId(e.target.value === '' ? '' : Number(e.target.value))}
              className="min-w-[200px]"
            >
              <option value="">All stores</option>
              {stores.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </Card>
      )}

      <Card>
        {list.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="No active carts"
            message="There are no active or held carts right now."
          />
        ) : (
          <Table
            headers={[
              '',
              'Cart',
              'User',
              'Locked',
              'Store',
              'Status',
              'Items',
              'Updated',
            ]}
          >
            {list.flatMap((cart) => {
              const isExpanded = expandedCartId === cart.id;
              const itemCount = cart.items?.length ?? 0;
              return [
                <TableRow
                  key={cart.id}
                  onClick={() => setExpandedCartId(isExpanded ? null : cart.id)}
                  className="cursor-pointer"
                >
                  <TableCell>
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-gray-500" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-gray-500" />
                    )}
                  </TableCell>
                  <TableCell className="font-mono font-medium">
                    {cart.cart_number}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <User className="h-4 w-4 text-gray-400" />
                      {cart.created_by_username ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    {cart.locked ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        <Lock className="h-3 w-3" />
                        Locked
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <Store className="h-4 w-4 text-gray-400" />
                      {cart.store_name ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="capitalize">{cart.status}</span>
                  </TableCell>
                  <TableCell>{itemCount}</TableCell>
                  <TableCell className="text-gray-600">
                    {formatDate(cart.updated_at)}
                  </TableCell>
                </TableRow>,
                isExpanded ? (
                  <TableRow key={`${cart.id}-items`}>
                    <TableCell colSpan={8} className="bg-gray-50/80 p-0">
                      <div className="border-t border-gray-200 px-6 py-4">
                        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                          <Package className="h-4 w-4" />
                          Items in cart
                          {cart.customer_name && (
                            <span className="text-gray-500">
                              · Customer: {cart.customer_name}
                            </span>
                          )}
                        </div>
                        {itemCount === 0 ? (
                          <p className="text-sm text-gray-500">No items</p>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                            <table className="min-w-full text-sm">
                              <thead>
                                <tr className="border-b border-gray-200 bg-gray-50">
                                  <th className="px-4 py-2 text-left font-medium text-gray-700">
                                    Product
                                  </th>
                                  <th className="px-4 py-2 text-left font-medium text-gray-700">
                                    SKU
                                  </th>
                                  <th className="px-4 py-2 text-right font-medium text-gray-700">
                                    Qty
                                  </th>
                                  <th className="px-4 py-2 text-right font-medium text-gray-700">
                                    Unit price
                                  </th>
                                  <th className="px-4 py-2 text-right font-medium text-gray-700">
                                    Line
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {cart.items.map((item) => {
                                  const qty = parseFloat(item.quantity);
                                  const unit = parseFloat(item.unit_price);
                                  const line = qty * unit;
                                  return (
                                    <tr
                                      key={item.id}
                                      className="border-b border-gray-100 last:border-0"
                                    >
                                      <td className="px-4 py-2">
                                        {item.product_name}
                                      </td>
                                      <td className="px-4 py-2 font-mono text-gray-600">
                                        {item.product_sku}
                                      </td>
                                      <td className="px-4 py-2 text-right">
                                        {formatNumber(qty, 3)}
                                      </td>
                                      <td className="px-4 py-2 text-right">
                                        {formatNumber(unit, 2)}
                                      </td>
                                      <td className="px-4 py-2 text-right font-medium">
                                        {formatNumber(line, 2)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null,
              ].filter(Boolean);
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
