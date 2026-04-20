import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Truck,
  XCircle,
} from 'lucide-react';
import { catalogApi, inventoryApi, productsApi } from '../../lib/api';
import { buildStockTransferCreatePayload } from '../../lib/stockTransferPayload';
import { useToast } from '../../lib/toast';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Select from '../../components/ui/Select';
import Input from '../../components/ui/Input';
import Textarea from '../../components/ui/Textarea';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import Badge from '../../components/ui/Badge';

type TransferKind = 'store' | 'warehouse';

type StockTransferRow = {
  id: number;
  transfer_number: string;
  from_store: number | null;
  from_warehouse: number | null;
  to_store: number | null;
  to_warehouse: number | null;
  status: string;
  notes: string;
  items: {
    id: number;
    product: number;
    product_name?: string;
    quantity: string;
    received_quantity: string;
    selected_barcodes?: string[];
  }[];
};

function parseLineBarcodes(input: string): string[] {
  return input
    .split(/\r?\n|,/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function normalizeListResponse(data: unknown): unknown[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.results)) return d.results;
  if (Array.isArray(d.data)) return d.data;
  return [];
}

function statusBadgeVariant(status: string): 'success' | 'info' | 'warning' | 'danger' | 'default' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'in_transit':
      return 'info';
    case 'pending':
      return 'warning';
    case 'cancelled':
      return 'danger';
    default:
      return 'default';
  }
}

function TransferLineProductPicker({
  productLabel,
  search,
  onSearchChange,
  onPick,
  results,
  searching,
}: {
  productLabel: string;
  search: string;
  onSearchChange: (v: string) => void;
  onPick: (id: number, name: string) => void;
  results: { id: number; name: string }[];
  searching: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-600">Product</label>
      <Input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Type at least 2 characters to search…"
      />
      {productLabel && (
        <p className="text-sm text-gray-800 font-medium truncate" title={productLabel}>
          Selected: {productLabel}
        </p>
      )}
      {searching && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Searching…
        </div>
      )}
      {results.length > 0 && (
        <ul className="max-h-36 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100 bg-white text-sm">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-blue-50 text-gray-900"
                onClick={() => onPick(p.id, p.name)}
              >
                <span className="font-mono text-xs text-gray-500 mr-2">#{p.id}</span>
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function StockTransfers() {
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const [srcKind, setSrcKind] = useState<TransferKind>('store');
  const [srcId, setSrcId] = useState<string>('');
  const [dstKind, setDstKind] = useState<TransferKind>('store');
  const [dstId, setDstId] = useState<string>('');
  const [notes, setNotes] = useState('');

  const [lines, setLines] = useState<
    {
      key: string;
      productId: number | null;
      productName: string;
      quantity: string;
      serialsText: string;
      search: string;
    }[]
  >([{ key: '1', productId: null, productName: '', quantity: '1', serialsText: '', search: '' }]);

  const { data: transfersRaw, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['stock-transfers'],
    queryFn: async () => (await inventoryApi.transfers.list()).data,
    retry: false,
  });

  const transfers = useMemo(
    () => normalizeListResponse(transfersRaw) as StockTransferRow[],
    [transfersRaw]
  );

  const { data: storesRaw } = useQuery({
    queryKey: ['stores', 'stock-transfers'],
    queryFn: async () => (await catalogApi.stores.list()).data,
    retry: false,
  });

  const { data: warehousesRaw } = useQuery({
    queryKey: ['warehouses', 'stock-transfers'],
    queryFn: async () => (await catalogApi.warehouses.list()).data,
    retry: false,
  });

  const stores = useMemo(() => normalizeListResponse(storesRaw) as { id: number; name: string; code?: string }[], [storesRaw]);
  const warehouses = useMemo(
    () => normalizeListResponse(warehousesRaw) as { id: number; name: string; code?: string }[],
    [warehousesRaw]
  );

  const storeName = useMemo(() => {
    const m = new Map(stores.map((s) => [s.id, s.name]));
    return (id: number | null) => (id == null ? null : m.get(id) ?? `#${id}`);
  }, [stores]);

  const whName = useMemo(() => {
    const m = new Map(warehouses.map((w) => [w.id, w.name]));
    return (id: number | null) => (id == null ? null : m.get(id) ?? `#${id}`);
  }, [warehouses]);

  const selected = transfers.find((t) => t.id === selectedId) ?? null;

  const completeMut = useMutation({
    mutationFn: (id: number) => inventoryApi.transfers.complete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
      success('Transfer completed. Stock has been moved.');
    },
    onError: (err: unknown) => {
      const ax = err as { response?: { data?: { error?: string } } };
      toastError(ax.response?.data?.error || 'Could not complete transfer.');
    },
  });

  const cancelMut = useMutation({
    mutationFn: (id: number) => inventoryApi.transfers.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
      success('Transfer cancelled.');
    },
    onError: () => toastError('Could not cancel transfer.'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => inventoryApi.transfers.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
      setSelectedId(null);
      success('Transfer deleted.');
    },
    onError: () => toastError('Only pending transfers can be deleted.'),
  });

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => inventoryApi.transfers.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
      setCreateOpen(false);
      resetCreateForm();
      success('Transfer created. Complete it when ready to move stock.');
    },
    onError: (err: unknown) => {
      const ax = err as { response?: { data?: unknown } };
      const d = ax.response?.data;
      if (d && typeof d === 'object') {
        const parts = Object.entries(d as Record<string, unknown>)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join('; ');
        toastError(parts || 'Create failed.');
      } else {
        toastError('Could not create transfer.');
      }
    },
  });

  const resetCreateForm = () => {
    setSrcKind('store');
    setSrcId('');
    setDstKind('store');
    setDstId('');
    setNotes('');
    setLines([{ key: '1', productId: null, productName: '', quantity: '1', serialsText: '', search: '' }]);
  };

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        key: `${Date.now()}-${Math.random()}`,
        productId: null,
        productName: '',
        quantity: '1',
        serialsText: '',
        search: '',
      },
    ]);
  };

  const removeLine = (key: string) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));
  };

  const submitCreate = () => {
    const sid = Number(srcId);
    const did = Number(dstId);
    if (!sid || !did) {
      toastError('Select source and destination locations.');
      return;
    }
    if (srcKind === 'store' && dstKind === 'store' && sid === did) {
      toastError('Source and destination cannot be the same store.');
      return;
    }
    let items: { productId: number; quantity: string; selectedBarcodes: string[] }[] = [];
    try {
      items = lines
        .filter((l) => l.productId != null && Number(l.quantity) > 0)
        .map((l) => {
          const qty = Number(l.quantity);
          const selectedBarcodes = parseLineBarcodes(l.serialsText);
          if (!Number.isInteger(qty)) {
            throw new Error(`Quantity must be whole number for "${l.productName || `Product #${l.productId}`}".`);
          }
          if (selectedBarcodes.length !== qty) {
            throw new Error(
              `"${l.productName || `Product #${l.productId}`}" needs ${qty} barcode/serial value(s), got ${selectedBarcodes.length}.`
            );
          }
          return {
            productId: l.productId as number,
            quantity: l.quantity,
            selectedBarcodes,
          };
        });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Invalid transfer lines.';
      toastError(message);
      return;
    }
    if (items.length === 0) {
      toastError('Add at least one line with a product and positive quantity.');
      return;
    }
    const seen = new Set<string>();
    for (const item of items) {
      for (const code of item.selectedBarcodes) {
        if (seen.has(code)) {
          toastError(`Duplicate barcode/serial across lines: ${code}`);
          return;
        }
        seen.add(code);
      }
    }
    const body = buildStockTransferCreatePayload({
      source: { kind: srcKind, id: sid },
      destination: { kind: dstKind, id: did },
      notes,
      items,
    });
    createMut.mutate(body);
  };

  const formatRoute = (t: StockTransferRow) => {
    const from =
      t.from_store != null
        ? `Store: ${storeName(t.from_store)}`
        : t.from_warehouse != null
          ? `Warehouse: ${whName(t.from_warehouse)}`
          : '—';
    const to =
      t.to_store != null
        ? `Store: ${storeName(t.to_store)}`
        : t.to_warehouse != null
          ? `Warehouse: ${whName(t.to_warehouse)}`
          : '—';
    return `${from} → ${to}`;
  };

  if (isLoading) {
    return <LoadingState message="Loading stock transfers…" />;
  }

  if (error) {
    return <ErrorState message="Could not load stock transfers. Check your connection and retailer access." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock transfers"
        subtitle="Move inventory between shops or warehouses for your retailer, then complete to update stock."
        icon={Truck}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New transfer
            </Button>
          </div>
        }
      />

      <p className="text-sm text-gray-600">
        <Link to="/stock" className="text-blue-600 hover:text-blue-800 font-medium inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />
          Back to stock overview
        </Link>
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[420px]">
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 font-medium text-gray-900">Transfers</div>
          {transfers.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="No transfers yet"
              message="Create a transfer from the hub shop to another store, then complete it to move quantities."
            />
          ) : (
            <div className="overflow-x-auto flex-1">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">Number</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Route</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {transfers.map((t) => (
                    <tr
                      key={t.id}
                      className={`cursor-pointer hover:bg-blue-50/60 ${selectedId === t.id ? 'bg-blue-50' : ''}`}
                      onClick={() => setSelectedId(t.id)}
                    >
                      <td className="px-3 py-2 font-mono text-xs">{t.transfer_number}</td>
                      <td className="px-3 py-2">
                        <Badge variant={statusBadgeVariant(t.status)}>{t.status.replace('_', ' ')}</Badge>
                      </td>
                      <td className="px-3 py-2 text-gray-700 max-w-[200px] truncate" title={formatRoute(t)}>
                        {formatRoute(t)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 font-medium text-gray-900">Details</div>
          {!selected ? (
            <div className="p-8 text-center text-gray-500 text-sm">Select a transfer to view lines and actions.</div>
          ) : (
            <div className="p-4 space-y-4 flex-1 overflow-y-auto">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-mono text-sm font-semibold text-gray-900">{selected.transfer_number}</div>
                  <div className="text-sm text-gray-600 mt-1">{formatRoute(selected)}</div>
                </div>
                <Badge variant={statusBadgeVariant(selected.status)}>{selected.status.replace('_', ' ')}</Badge>
              </div>
              {selected.notes ? (
                <p className="text-sm text-gray-700 bg-gray-50 rounded-md p-3 border border-gray-100">{selected.notes}</p>
              ) : null}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Line items</h4>
                <div className="border border-gray-200 rounded-md overflow-hidden">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Product</th>
                        <th className="px-3 py-2 text-right font-medium">Qty</th>
                        <th className="px-3 py-2 text-right font-medium">Received</th>
                        <th className="px-3 py-2 text-left font-medium">Barcodes/Serials</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selected.items?.length ? (
                        selected.items.map((it) => (
                          <tr key={it.id}>
                            <td className="px-3 py-2">
                              <div className="font-medium text-gray-900">{it.product_name || `Product #${it.product}`}</div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{it.quantity}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{it.received_quantity}</td>
                            <td className="px-3 py-2 text-xs text-gray-700">
                              {it.selected_barcodes?.length ? (
                                <div className="space-y-1 max-h-24 overflow-y-auto">
                                  {it.selected_barcodes.map((code) => (
                                    <div key={code} className="font-mono">
                                      {code}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="px-3 py-4 text-center text-gray-500">
                            No lines
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                {selected.status === 'pending' || selected.status === 'in_transit' ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() => completeMut.mutate(selected.id)}
                      disabled={completeMut.isPending}
                    >
                      {completeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Complete (move stock)
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => cancelMut.mutate(selected.id)}
                      disabled={cancelMut.isPending}
                    >
                      <XCircle className="h-4 w-4" />
                      Cancel
                    </Button>
                  </>
                ) : null}
                {selected.status === 'pending' ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      if (window.confirm('Delete this pending transfer?')) deleteMut.mutate(selected.id);
                    }}
                    disabled={deleteMut.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={createOpen}
        onClose={() => {
          if (!createMut.isPending) {
            setCreateOpen(false);
            resetCreateForm();
          }
        }}
        title="New stock transfer"
        size="xl"
      >
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Select
                label="From (source)"
                id="src-kind"
                value={srcKind}
                onChange={(e) => setSrcKind(e.target.value as TransferKind)}
              >
                <option value="store">Store</option>
                <option value="warehouse">Warehouse</option>
              </Select>
              <Select
                className="mt-2"
                id="src-id"
                value={srcId}
                onChange={(e) => setSrcId(e.target.value)}
              >
                <option value="">Select…</option>
                {(srcKind === 'store' ? stores : warehouses).map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} {loc.code ? `(${loc.code})` : ''}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Select
                label="To (destination)"
                id="dst-kind"
                value={dstKind}
                onChange={(e) => setDstKind(e.target.value as TransferKind)}
              >
                <option value="store">Store</option>
                <option value="warehouse">Warehouse</option>
              </Select>
              <Select
                className="mt-2"
                id="dst-id"
                value={dstId}
                onChange={(e) => setDstId(e.target.value)}
              >
                <option value="">Select…</option>
                {(dstKind === 'store' ? stores : warehouses).map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} {loc.code ? `(${loc.code})` : ''}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <p className="text-xs text-gray-600 bg-blue-50 border border-blue-100 rounded-md px-3 py-2">
            Source:{' '}
            <span className="font-medium">
              {srcId ? (srcKind === 'store' ? storeName(Number(srcId)) : whName(Number(srcId))) : 'Not selected'}
            </span>{' '}
            → Destination:{' '}
            <span className="font-medium">
              {dstId ? (dstKind === 'store' ? storeName(Number(dstId)) : whName(Number(dstId))) : 'Not selected'}
            </span>
          </p>

          <div>
            <label htmlFor="xfer-notes" className="block text-sm font-medium text-gray-700 mb-1">
              Notes (optional)
            </label>
            <Textarea id="xfer-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-900">Products</span>
              <Button type="button" size="sm" variant="outline" onClick={addLine}>
                <Plus className="h-4 w-4" />
                Add line
              </Button>
            </div>
            <div className="space-y-4">
              {lines.map((line) => (
                <TransferLineEditor
                  key={line.key}
                  line={line}
                  onRemove={() => removeLine(line.key)}
                  canRemove={lines.length > 1}
                  onUpdate={(patch) =>
                    setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, ...patch } : l)))
                  }
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                resetCreateForm();
              }}
              disabled={createMut.isPending}
            >
              Close
            </Button>
            <Button onClick={submitCreate} disabled={createMut.isPending}>
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create transfer
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function TransferLineEditor({
  line,
  onUpdate,
  onRemove,
  canRemove,
}: {
  line: {
    key: string;
    productId: number | null;
    productName: string;
    quantity: string;
    serialsText: string;
    search: string;
  };
  onUpdate: (patch: Partial<typeof line>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const q = line.search.trim();
  const enabled = q.length >= 2;
  const parsedBarcodes = parseLineBarcodes(line.serialsText);
  const qty = Number(line.quantity || 0);
  const qtyWhole = Number.isInteger(qty) && qty > 0;
  const match = qtyWhole && parsedBarcodes.length === qty;

  const { data, isFetching } = useQuery({
    queryKey: ['xfer-product-search', q],
    queryFn: async () => (await productsApi.list({ search: q, limit: 15, search_mode: 'name_only' })).data,
    enabled,
    retry: false,
  });

  const results = useMemo(() => {
    const raw = normalizeListResponse(data) as { id: number; name: string }[];
    return raw.map((p) => ({ id: p.id, name: p.name }));
  }, [data]);

  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50/50">
      <div className="flex justify-between gap-2">
        <span className="text-xs font-semibold text-gray-500 uppercase">Line</span>
        {canRemove ? (
          <button type="button" className="text-xs text-red-600 hover:text-red-800" onClick={onRemove}>
            Remove
          </button>
        ) : null}
      </div>
      <TransferLineProductPicker
        productLabel={line.productName}
        search={line.search}
        onSearchChange={(v) => onUpdate({ search: v })}
        onPick={(id, name) => onUpdate({ productId: id, productName: name, search: '' })}
        results={results}
        searching={enabled && isFetching}
      />
      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Quantity</label>
          <Input
            value={line.quantity}
            onChange={(e) => onUpdate({ quantity: e.target.value })}
            placeholder="1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">
            Barcodes / Serials (one per line)
          </label>
          <Textarea
            rows={4}
            value={line.serialsText}
            onChange={(e) => onUpdate({ serialsText: e.target.value })}
            placeholder={'ABC-0001\nABC-0002'}
          />
          <p className="text-xs text-gray-500 mt-1">
            Enter exact barcodes/serials to transfer. Count must match quantity.
          </p>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <Badge variant={match ? 'success' : 'warning'}>
              {parsedBarcodes.length} entered / {qtyWhole ? qty : '—'} required
            </Badge>
            {!qtyWhole ? (
              <span className="text-red-600">Quantity must be a whole number.</span>
            ) : match ? (
              <span className="text-green-700">Ready for transfer.</span>
            ) : (
              <span className="text-amber-700">Add/remove barcode rows to match quantity.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
