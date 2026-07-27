import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  BookOpen,
  Pencil,
  Search,
  Trash2,
  Undo2,
  User,
} from 'lucide-react';
import { creditApi } from '../../lib/api';
import { amountForInput, formatAmountINR, formatNumber, toLocalDateString } from '../../lib/utils';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import Table, { TableCell, TableRow } from '../../components/ui/Table';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import ToastContainer from '../../components/ui/Toast';
import type { Toast } from '../../components/ui/Toast';
import { formatCreditInvoiceDate } from './CreditInvoiceDocument';
import { canManageCreditRecords } from './creditLedgerUtils';
import CreditVoidLedgerPreview from './CreditVoidLedgerPreview';

type EditLine = {
  key: string;
  id?: number;
  product_name: string;
  catalog_product_id?: number | null;
  credit_product_id?: number | null;
  invoice_item_id?: number | null;
  quantity: string;
  unit_price: string;
};

function returnStatusInfo(status?: string) {
  if (status === 'void') {
    return { label: 'Void', variant: 'danger' as const };
  }
  return { label: 'Completed', variant: 'success' as const };
}

function lineFromReturnItem(item: any): EditLine {
  return {
    key: item.id != null ? `id-${item.id}` : `new-${Math.random().toString(36).slice(2)}`,
    id: item.id,
    product_name: item.product_name || 'Product',
    catalog_product_id: item.product ?? null,
    credit_product_id: item.credit_product ?? null,
    invoice_item_id: item.invoice_item ?? null,
    quantity: String(Math.round(parseFloat(String(item.quantity ?? '0')) || 0) || ''),
    unit_price: amountForInput(item.unit_price) || '',
  };
}

export default function CreditReturnDetail() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const returnId = parseInt(id || '', 10);
  const canManage = canManageCreditRecords();

  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [editNotes, setEditNotes] = useState('');
  const [editDate, setEditDate] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [debouncedProductSearch, setDebouncedProductSearch] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const tid = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id: tid, message, type }]);
  };

  const { data: creditReturn, isLoading, error, refetch } = useQuery({
    queryKey: ['credit-return', returnId],
    queryFn: async () => {
      const res = await creditApi.returns.get(returnId);
      return res.data;
    },
    enabled: Number.isFinite(returnId) && returnId > 0,
  });

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedProductSearch(productSearch), 300);
    return () => window.clearTimeout(t);
  }, [productSearch]);

  const { data: productResults = [], isFetching: isProductSearching } = useQuery({
    queryKey: ['credit-product-search', 'return-edit', debouncedProductSearch],
    queryFn: async () => {
      const q = debouncedProductSearch.trim();
      if (!q) return [];
      const res = await creditApi.products.search({ search: q });
      return res.data || [];
    },
    enabled: showEditModal && debouncedProductSearch.trim().length >= 1,
  });

  const openEditModal = () => {
    if (!creditReturn || creditReturn.status !== 'completed') return;
    setEditLines((creditReturn.items || []).map(lineFromReturnItem));
    setEditNotes(creditReturn.notes || '');
    setEditDate(
      creditReturn.created_at
        ? toLocalDateString(creditReturn.created_at)
        : toLocalDateString(new Date())
    );
    setProductSearch('');
    setShowEditModal(true);
  };

  useEffect(() => {
    if (creditReturn?.status === 'completed' && searchParams.get('edit') === '1' && canManage) {
      openEditModal();
      const next = new URLSearchParams(searchParams);
      next.delete('edit');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once when return loads with ?edit=1
  }, [creditReturn?.id, creditReturn?.status]);

  const voidMutation = useMutation({
    mutationFn: () => creditApi.returns.void(returnId),
    onSuccess: () => {
      setShowVoidConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['credit-return', returnId] });
      queryClient.invalidateQueries({ queryKey: ['credit-returns'] });
      queryClient.invalidateQueries({ queryKey: ['credit-invoices-summary'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-customers'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-statement'] });
      refetch();
      showToast('Return voided', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.detail || 'Failed to void return', 'error');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: any) => creditApi.returns.update(returnId, payload),
    onSuccess: (res) => {
      setShowEditModal(false);
      queryClient.invalidateQueries({ queryKey: ['credit-return', returnId] });
      queryClient.invalidateQueries({ queryKey: ['credit-returns'] });
      queryClient.invalidateQueries({ queryKey: ['credit-invoices-summary'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-customers'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-statement'] });
      refetch();
      const delta = parseFloat(String(res.data?.ledger_delta ?? '0')) || 0;
      if (delta === 0) {
        showToast('Return updated (no ledger change)', 'success');
      } else {
        const sign = delta > 0 ? '+' : '';
        showToast(`Return updated — ledger ${sign}₹${formatAmountINR(Math.abs(delta))}`, 'success');
      }
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.detail || 'Failed to update return', 'error');
    },
  });

  const editTotals = useMemo(() => {
    let total = 0;
    for (const line of editLines) {
      const qty = parseInt(line.quantity, 10) || 0;
      const price = parseFloat(line.unit_price) || 0;
      total += qty * price;
    }
    return total;
  }, [editLines]);

  const originalTotal = parseFloat(String(creditReturn?.total ?? '0')) || 0;
  // Return credits reduce balance; higher return total → negative balance delta
  const ledgerDeltaPreview = originalTotal - editTotals;

  const updateEditLine = (key: string, field: 'quantity' | 'unit_price', value: string) => {
    setEditLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, [field]: value } : line))
    );
  };

  const removeEditLine = (key: string) => {
    setEditLines((prev) => prev.filter((l) => l.key !== key));
  };

  const addProductToEdit = (product: any) => {
    const catalogId =
      product.source === 'catalog' ? product.catalog_product_id || product.id : product.catalog_product_id || null;
    const creditId =
      product.source === 'credit' ? product.credit_product_id || product.id : product.credit_product_id || null;
    setEditLines((prev) => [
      ...prev,
      {
        key: `new-${Math.random().toString(36).slice(2)}`,
        product_name: product.name,
        catalog_product_id: catalogId,
        credit_product_id: creditId,
        invoice_item_id: null,
        quantity: '1',
        unit_price: '',
      },
    ]);
    setProductSearch('');
  };

  const handleSaveEdit = () => {
    if (!editLines.length) {
      showToast('Add at least one product', 'error');
      return;
    }
    for (const line of editLines) {
      const qty = parseInt(line.quantity, 10);
      const price = parseFloat(line.unit_price);
      if (!Number.isFinite(qty) || qty <= 0) {
        showToast(`Enter qty > 0 for ${line.product_name}`, 'error');
        return;
      }
      if (!Number.isFinite(price) || price <= 0) {
        showToast(`Enter price > 0 for ${line.product_name}`, 'error');
        return;
      }
    }

    const payload: any = {
      notes: editNotes,
      items: editLines.map((line) => {
        const row: any = {
          product_name: line.product_name,
          quantity: parseInt(line.quantity, 10),
          unit_price: parseFloat(line.unit_price),
        };
        if (line.id != null) row.id = line.id;
        if (line.catalog_product_id) row.catalog_product_id = line.catalog_product_id;
        if (line.credit_product_id) row.credit_product_id = line.credit_product_id;
        if (line.invoice_item_id) row.invoice_item_id = line.invoice_item_id;
        return row;
      }),
    };
    if (editDate && /^\d{4}-\d{2}-\d{2}$/.test(editDate)) {
      const timePart = creditReturn?.created_at
        ? new Date(creditReturn.created_at).toTimeString().slice(0, 8)
        : '12:00:00';
      payload.created_at = `${editDate}T${timePart}`;
    }
    updateMutation.mutate(payload);
  };

  if (isLoading) return <LoadingState />;
  if (error || !creditReturn) {
    return <ErrorState message="Failed to load credit return" onRetry={() => refetch()} />;
  }

  const statusInfo = returnStatusInfo(creditReturn.status);
  const items = creditReturn.items || [];
  const totalQty = items.reduce(
    (sum: number, item: any) => sum + (parseFloat(String(item.quantity || 0)) || 0),
    0
  );
  const canEdit = canManage && creditReturn.status === 'completed';

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} onRemove={(tid) => setToasts((p) => p.filter((t) => t.id !== tid))} />

      <div className="space-y-4">
        <Button
          variant="outline"
          onClick={() => {
            if (window.history.length > 1) {
              navigate(-1);
              return;
            }
            navigate('/credit-invoices?mode=return');
          }}
          className="w-full sm:w-auto"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="p-4 sm:p-6 border-b border-gray-100">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex-shrink-0 p-2.5 bg-amber-50 rounded-lg border border-amber-100">
                  <Undo2 className="h-5 w-5 text-amber-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">
                    {creditReturn.return_number || `Credit Return #${creditReturn.id}`}
                  </h1>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1.5">
                    Created on {formatCreditInvoiceDate(creditReturn.created_at)}
                  </p>
                </div>
              </div>
              <Badge variant={statusInfo.variant} className="w-full sm:w-auto justify-center text-sm px-3 py-2">
                {statusInfo.label}
              </Badge>
            </div>
          </div>

          <div className="p-4 sm:p-6 bg-gray-50">
            <div className="flex flex-col sm:flex-row gap-3 sm:justify-end sm:items-center">
              {creditReturn.customer ? (
                <Button
                  variant="primary"
                  onClick={() => navigate(`/credit-ledger/${creditReturn.customer}`)}
                  className="w-full sm:w-auto"
                >
                  <BookOpen className="h-4 w-4 mr-2" />
                  View Ledger
                </Button>
              ) : null}

              <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
                <div className="flex gap-2">
                  {canEdit ? (
                    <Button variant="outline" size="sm" onClick={openEditModal} className="flex-1 sm:flex-none">
                      <Pencil className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Edit</span>
                    </Button>
                  ) : null}
                </div>
                {canEdit ? (
                  <Button variant="danger" size="sm" onClick={() => setShowVoidConfirm(true)}>
                    <Ban className="h-4 w-4 mr-2" />
                    Void
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <Card>
          <div className="flex items-start gap-3">
            <div className="p-2 bg-gray-100 rounded-lg">
              <User className="h-5 w-5 text-gray-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-500">Customer</p>
              <p className="text-base font-semibold text-gray-900 truncate">
                {creditReturn.customer_name || '—'}
              </p>
              {creditReturn.customer_phone ? (
                <p className="text-sm text-gray-500 mt-0.5">{creditReturn.customer_phone}</p>
              ) : null}
              {creditReturn.customer_group_name ? (
                <p className="text-xs text-gray-400 mt-1">{creditReturn.customer_group_name}</p>
              ) : null}
            </div>
          </div>
        </Card>
        <Card>
          <p className="text-sm font-medium text-gray-500">Store</p>
          <p className="text-base font-semibold text-gray-900 mt-1">
            {creditReturn.store_name || '—'}
          </p>
          {creditReturn.created_by_name ? (
            <p className="text-xs text-gray-400 mt-2">By {creditReturn.created_by_name}</p>
          ) : null}
        </Card>
        <Card>
          <p className="text-sm font-medium text-gray-500">Return total</p>
          <p className="text-2xl font-bold text-amber-800 mt-1">
            ₹{formatNumber(parseFloat(String(creditReturn.total || 0)))}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {items.length} line{items.length === 1 ? '' : 's'} · {formatNumber(totalQty)} qty
          </p>
        </Card>
      </div>

      <Card>
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Return lines</h2>
        </div>
        {items.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">No items on this return.</div>
        ) : (
          <Table headers={['Product', 'Qty', 'Unit price', 'Line total', 'Source invoice']}>
            {items.map((item: any) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.product_name}</TableCell>
                <TableCell>{formatNumber(parseFloat(String(item.quantity || 0)))}</TableCell>
                <TableCell>₹{formatNumber(parseFloat(String(item.unit_price || 0)))}</TableCell>
                <TableCell>₹{formatNumber(parseFloat(String(item.line_total || 0)))}</TableCell>
                <TableCell className="text-sm text-gray-600">
                  {item.invoice_number || '—'}
                </TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>

      {creditReturn.notes ? (
        <Card>
          <p className="text-sm font-medium text-gray-500">Notes</p>
          <p className="text-sm text-gray-800 mt-2 whitespace-pre-wrap">{creditReturn.notes}</p>
        </Card>
      ) : null}

      <Modal isOpen={showVoidConfirm} onClose={() => setShowVoidConfirm(false)} title="Void credit return?">
        <div className="space-y-4">
          {creditReturn ? (
            <CreditVoidLedgerPreview
              kind="return"
              label={creditReturn.return_number || `Return #${creditReturn.id}`}
              total={parseFloat(String(creditReturn.total ?? '0')) || 0}
              customerName={creditReturn.customer_name}
            />
          ) : null}
          {voidMutation.isError ? (
            <p className="text-sm text-red-600">
              {(voidMutation.error as any)?.response?.data?.detail || 'Void failed'}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="secondary" onClick={() => setShowVoidConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={voidMutation.isPending}
              onClick={() => voidMutation.mutate()}
            >
              {voidMutation.isPending ? 'Voiding…' : 'Confirm void'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showEditModal}
        onClose={() => !updateMutation.isPending && setShowEditModal(false)}
        title={`Edit ${creditReturn?.return_number || 'credit return'}`}
        size="xl"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Change qty or price, add or remove lines. Ledger balance updates by the total difference.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Return date"
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
            />
            <Input
              label="Notes"
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Add product</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                className="pl-9"
                placeholder="Search products…"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
            </div>
            {productSearch.trim() ? (
              <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-auto">
                {isProductSearching || productSearch.trim() !== debouncedProductSearch.trim() ? (
                  <div className="px-3 py-2 text-sm text-gray-400">Searching…</div>
                ) : productResults.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-400">No products found</div>
                ) : (
                  productResults.map((p: any) => (
                    <button
                      key={`${p.source}-${p.id}`}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 flex justify-between gap-2"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        addProductToEdit(p);
                      }}
                    >
                      <span>{p.name}</span>
                      <span className="text-xs uppercase text-gray-400">{p.source}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="hidden sm:grid grid-cols-[1fr_5.5rem_6.5rem_6rem_2.5rem] gap-2 px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
              <div>Product</div>
              <div>Qty</div>
              <div>Price</div>
              <div className="text-right">Line</div>
              <div />
            </div>
            {editLines.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-gray-400">
                No lines — search to add products
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {editLines.map((line) => {
                  const qty = parseInt(line.quantity, 10) || 0;
                  const price = parseFloat(line.unit_price) || 0;
                  const lineTotal = qty * price;
                  return (
                    <div
                      key={line.key}
                      className="grid grid-cols-1 sm:grid-cols-[1fr_5.5rem_6.5rem_6rem_2.5rem] gap-2 px-3 py-3 items-center"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {line.product_name}
                        </div>
                      </div>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={line.quantity}
                        onChange={(e) =>
                          updateEditLine(line.key, 'quantity', e.target.value.replace(/\D/g, ''))
                        }
                        className="text-sm"
                        aria-label="Quantity"
                      />
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={line.unit_price}
                        onChange={(e) => updateEditLine(line.key, 'unit_price', e.target.value)}
                        className="text-sm"
                        aria-label="Unit price"
                      />
                      <div className="text-sm font-semibold text-right text-gray-900">
                        ₹{formatNumber(lineTotal)}
                      </div>
                      <button
                        type="button"
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded justify-self-end"
                        onClick={() => removeEditLine(line.key)}
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Original total</span>
              <span className="font-medium">₹{formatNumber(originalTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">New total</span>
              <span className="font-semibold text-gray-900">₹{formatNumber(editTotals)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-amber-200">
              <span className="text-amber-900 font-medium">Ledger delta</span>
              <span
                className={`font-bold ${
                  ledgerDeltaPreview > 0
                    ? 'text-red-700'
                    : ledgerDeltaPreview < 0
                      ? 'text-green-700'
                      : 'text-gray-700'
                }`}
              >
                {ledgerDeltaPreview > 0 ? '+' : ''}
                ₹{formatNumber(ledgerDeltaPreview)}
              </span>
            </div>
          </div>

          {updateMutation.isError ? (
            <p className="text-sm text-red-600">
              {(updateMutation.error as any)?.response?.data?.detail || 'Update failed'}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="secondary"
              disabled={updateMutation.isPending}
              onClick={() => setShowEditModal(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={updateMutation.isPending || editLines.length === 0}
              onClick={handleSaveEdit}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save & update ledger'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
