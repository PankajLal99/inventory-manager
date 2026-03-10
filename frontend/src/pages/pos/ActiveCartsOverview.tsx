import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { posApi, catalogApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import {
  ShoppingCart,
  User,
  Lock,
  Store,
  ChevronDown,
  ChevronRight,
  Package,
  Trash2,
  Loader2,
} from 'lucide-react';
import { formatNumber, getProductNameColor } from '../../lib/utils';
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
  scanned_barcodes_display?: string[];
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
  const queryClient = useQueryClient();
  const toast = useToast();
  const [storeId, setStoreId] = useState<number | ''>('');
  const [expandedCartId, setExpandedCartId] = useState<number | null>(null);
  const [user, setUser] = useState<any>(null);

  const discardCartMutation = useMutation({
    mutationFn: ({ cartId }: { cartId: number; productIds: number[] }) => posApi.carts.delete(cartId),
    onSuccess: (_data, { cartId, productIds }) => {
      productIds.forEach((productId) => {
        queryClient.invalidateQueries({ queryKey: ['product-barcodes', productId] });
      });
      queryClient.invalidateQueries({ queryKey: ['pos/carts/overview'] });
      setExpandedCartId((prev) => (prev === cartId ? null : prev));
      toast.success('Cart discarded. Items returned to inventory and barcodes set to fresh.');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error ?? err?.response?.data?.detail ?? (err?.message || 'Failed to discard cart');
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    },
  });

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

  const isSuper = user?.groups && user.groups.includes('Super');

  const { data: carts, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pos/carts/overview', storeId || undefined],
    queryFn: async () => {
      const params = storeId ? { store: storeId } : undefined;
      const response = await posApi.carts.getOverview(params);
      return response.data as CartOverview[];
    },
  });

  const list = Array.isArray(carts) ? carts : [];
  const discardableCarts = list.filter(
    (c) => !c.locked && user != null && (c.created_by === user.id || isSuper)
  );
  const [isDiscardAllPending, setIsDiscardAllPending] = useState(false);

  const handleDiscardAll = async () => {
    if (discardableCarts.length === 0) return;
    const message =
      discardableCarts.length === 1
        ? `Discard 1 cart? All items will be returned to inventory and barcodes set to fresh.`
        : `Discard all ${discardableCarts.length} carts? All items will be returned to inventory and barcodes set to fresh.`;
    if (!window.confirm(message)) return;
    setIsDiscardAllPending(true);
    const allProductIds = new Set<number>();
    let successCount = 0;
    let failCount = 0;
    try {
      for (const cart of discardableCarts) {
        try {
          await posApi.carts.delete(cart.id);
          (cart.items || []).forEach((item) => allProductIds.add(item.product));
          successCount += 1;
        } catch {
          failCount += 1;
        }
      }
      allProductIds.forEach((productId) => {
        queryClient.invalidateQueries({ queryKey: ['product-barcodes', productId] });
      });
      queryClient.invalidateQueries({ queryKey: ['pos/carts/overview'] });
      setExpandedCartId(null);
      if (failCount === 0) {
        toast.success(
          successCount === 1 ? 'Cart discarded.' : `${successCount} carts discarded. Items returned to inventory.`
        );
      } else {
        toast.error(`Discarded ${successCount} cart(s). ${failCount} failed.`);
      }
    } finally {
      setIsDiscardAllPending(false);
    }
  };

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
        subtitle="View which carts are active, who has them, and what’s in each. Discard a cart to remove it and return all items to inventory (barcodes set to fresh)."
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
          <>
            {discardableCarts.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center justify-end gap-2 border-b border-gray-200 pb-4">
                <button
                  type="button"
                  onClick={handleDiscardAll}
                  disabled={isDiscardAllPending}
                  title="Discard all carts you can discard (unlocked; your carts or any if Super). Items returned to inventory."
                  className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDiscardAllPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Discard all{discardableCarts.length > 1 ? ` (${discardableCarts.length})` : ''}
                </button>
              </div>
            )}
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
              'Actions',
            ]}
          >
            {list.flatMap((cart) => {
              const isExpanded = expandedCartId === cart.id;
              const itemCount = cart.items?.length ?? 0;
              const productIds = cart.items?.length ? [...new Set(cart.items.map((item) => item.product))] : [];
              const canDiscard = !cart.locked && user != null && (cart.created_by === user.id || isSuper);
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
                    <span className="flex items-center gap-2">
                      {cart.cart_number}
                      {cart.cart_number?.startsWith('EDIT-') && (
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                          Invoice edit
                        </span>
                      )}
                    </span>
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
                  <TableCell>
                    <div onClick={(e: React.MouseEvent) => e.stopPropagation()} role="presentation">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canDiscard) return;
                        const message =
                          itemCount > 0
                            ? `Discard cart ${cart.cart_number}? All ${itemCount} item(s) will be removed and returned to inventory; barcodes will be set to fresh.`
                            : `Discard cart ${cart.cart_number}?`;
                        if (!window.confirm(message)) return;
                        discardCartMutation.mutate({
                          cartId: cart.id,
                          productIds,
                        });
                      }}
                      disabled={!canDiscard || isDiscardAllPending || (discardCartMutation.isPending && discardCartMutation.variables?.cartId === cart.id)}
                      title={
                        cart.locked
                          ? 'Unlock the cart before discarding'
                          : !isSuper && cart.created_by !== user?.id
                            ? 'You can only discard your own carts'
                            : 'Discard cart and return items to inventory'
                      }
                      className="inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {discardCartMutation.isPending && discardCartMutation.variables?.cartId === cart.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Discard
                    </button>
                    </div>
                  </TableCell>
                </TableRow>,
                isExpanded ? (
                  <TableRow key={`${cart.id}-items`}>
                    <TableCell colSpan={9} className="bg-gray-50/80 p-0">
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
                                      <td className="px-4 py-2" style={getProductNameColor(item.product_name) ? { color: getProductNameColor(item.product_name) } : undefined}>
                                        {item.product_name}
                                      </td>
                                      <td className="px-4 py-2 font-mono text-gray-600">
                                        {item.scanned_barcodes_display?.length
                                          ? item.scanned_barcodes_display.filter(Boolean).join(', ')
                                          : item.product_sku}
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
          </>
        )}
      </Card>
    </div>
  );
}
