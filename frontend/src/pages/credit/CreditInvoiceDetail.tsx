import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  BookOpen,
  Camera,
  Coins,
  Download,
  FileText,
  Pencil,
  Printer,
  Search,
  ShoppingBag,
  Trash2,
  User,
} from 'lucide-react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { creditApi } from '../../lib/api';
import { amountForInput, formatAmountINR, formatNumber, getTodayDateString, toLocalDateString } from '../../lib/utils';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Input from '../../components/ui/Input';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import Modal from '../../components/ui/Modal';
import Badge from '../../components/ui/Badge';
import Table, { TableCell, TableRow } from '../../components/ui/Table';
import ToastContainer from '../../components/ui/Toast';
import type { Toast } from '../../components/ui/Toast';
import { formatCreditInvoiceDate, canManageCreditRecords } from './creditLedgerUtils';
import {
  buildCreditInvoiceHtml,
  CREDIT_INVOICE_CAPTURE_HEIGHT,
  CREDIT_INVOICE_CAPTURE_WIDTH,
  CREDIT_SHOP_NAME,
} from './creditInvoiceHtml';
import CreditVoidLedgerPreview from './CreditVoidLedgerPreview';

type EditLine = {
  key: string;
  id?: number;
  product_name: string;
  catalog_product_id?: number | null;
  credit_product_id?: number | null;
  quantity: string;
  unit_price: string;
  returned_quantity: number;
};

function invoiceStatusInfo(status?: string) {
  if (status === 'void') {
    return { label: 'Void', variant: 'danger' as const };
  }
  return { label: 'Open', variant: 'warning' as const };
}

function lineFromInvoiceItem(item: any): EditLine {
  return {
    key: item.id != null ? `id-${item.id}` : `new-${Math.random().toString(36).slice(2)}`,
    id: item.id,
    product_name: item.product_name || 'Product',
    catalog_product_id: item.product ?? null,
    credit_product_id: item.credit_product ?? null,
    quantity: String(Math.round(parseFloat(String(item.quantity ?? '0')) || 0) || ''),
    unit_price: amountForInput(item.unit_price) || '',
    returned_quantity: Math.round(parseFloat(String(item.returned_quantity ?? '0')) || 0),
  };
}

export default function CreditInvoiceDetail() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [editNotes, setEditNotes] = useState('');
  const [editDate, setEditDate] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [debouncedProductSearch, setDebouncedProductSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pdfFrameRef = useRef<HTMLIFrameElement>(null);
  const invoicePreviewRef = useRef<HTMLIFrameElement>(null);

  const invoiceId = parseInt(id || '', 10);
  const canManage = canManageCreditRecords();

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const tid = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id: tid, message, type }]);
  };

  const { data: invoice, isLoading, error, refetch } = useQuery({
    queryKey: ['credit-invoice', invoiceId],
    queryFn: async () => {
      const res = await creditApi.invoices.get(invoiceId);
      return res.data;
    },
    enabled: Number.isFinite(invoiceId),
  });

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedProductSearch(productSearch), 300);
    return () => window.clearTimeout(t);
  }, [productSearch]);

  const { data: productResults = [], isFetching: isProductSearching } = useQuery({
    queryKey: ['credit-product-search', 'invoice-edit', debouncedProductSearch],
    queryFn: async () => {
      const q = debouncedProductSearch.trim();
      if (!q) return [];
      const res = await creditApi.products.search({ search: q });
      return res.data || [];
    },
    enabled: showEditModal && debouncedProductSearch.trim().length >= 1,
  });

  const openEditModal = () => {
    if (!invoice || invoice.status !== 'open') return;
    setEditLines((invoice.items || []).map(lineFromInvoiceItem));
    setEditNotes(invoice.notes || '');
    setEditDate(invoice.created_at ? toLocalDateString(invoice.created_at) : toLocalDateString(new Date()));
    setProductSearch('');
    setShowEditModal(true);
  };

  useEffect(() => {
    if (canManage && invoice?.status === 'open' && searchParams.get('edit') === '1') {
      openEditModal();
      const next = new URLSearchParams(searchParams);
      next.delete('edit');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once when invoice loads with ?edit=1
  }, [invoice?.id, invoice?.status]);

  const voidMutation = useMutation({
    mutationFn: () => creditApi.invoices.void(invoiceId),
    onSuccess: () => {
      setShowVoidConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['credit-invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['credit-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-customers'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-statement'] });
      refetch();
      showToast('Invoice voided', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.detail || 'Failed to void invoice', 'error');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: any) => creditApi.invoices.update(invoiceId, payload),
    onSuccess: (res) => {
      setShowEditModal(false);
      queryClient.invalidateQueries({ queryKey: ['credit-invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['credit-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['credit-invoices-summary'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-customers'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-statement'] });
      refetch();
      const delta = parseFloat(String(res.data?.ledger_delta ?? '0')) || 0;
      if (delta === 0) {
        showToast('Invoice updated (no ledger change)', 'success');
      } else {
        const sign = delta > 0 ? '+' : '';
        showToast(`Invoice updated — ledger ${sign}₹${formatAmountINR(Math.abs(delta))}`, 'success');
      }
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.detail || 'Failed to update invoice', 'error');
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

  const originalTotal = parseFloat(String(invoice?.total ?? '0')) || 0;
  const ledgerDeltaPreview = editTotals - originalTotal;

  const updateEditLine = (key: string, field: 'quantity' | 'unit_price', value: string) => {
    setEditLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, [field]: value } : line))
    );
  };

  const removeEditLine = (key: string) => {
    const line = editLines.find((l) => l.key === key);
    if (line && line.returned_quantity > 0) {
      showToast('Cannot remove a line that has returns', 'error');
      return;
    }
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
        quantity: '1',
        unit_price: '',
        returned_quantity: 0,
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
      if (qty < line.returned_quantity) {
        showToast(
          `${line.product_name}: qty cannot be below returned (${line.returned_quantity})`,
          'error'
        );
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
        return row;
      }),
    };
    if (editDate && /^\d{4}-\d{2}-\d{2}$/.test(editDate)) {
      const timePart = invoice?.created_at
        ? new Date(invoice.created_at).toTimeString().slice(0, 8)
        : '12:00:00';
      payload.created_at = `${editDate}T${timePart}`;
    }
    updateMutation.mutate(payload);
  };

  const previewHtml = invoice
    ? buildCreditInvoiceHtml({
        invoice_number: invoice.invoice_number,
        customer_name: invoice.customer_name,
        customer_phone: invoice.customer_phone,
        created_at: invoice.created_at,
        subtotal: invoice.subtotal,
        total: invoice.total,
        notes: invoice.notes,
        status: invoice.status,
        customer_balance: invoice.customer_balance,
        previous_balance: invoice.previous_balance,
        totalItems: (invoice.items || []).length,
        items: invoice.items || [],
        showTotals: true,
      })
    : '';

  const handlePrint = () => {
    const iframe = invoicePreviewRef.current;
    const win = iframe?.contentWindow;
    if (!win) {
      window.print();
      return;
    }
    win.focus();
    win.print();
  };

  const captureFromIframe = async () => {
    const iframe = pdfFrameRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc || !invoice) {
      throw new Error('PDF preview not ready');
    }

    const html = buildCreditInvoiceHtml({
      invoice_number: invoice.invoice_number,
      customer_name: invoice.customer_name,
      customer_phone: invoice.customer_phone,
      created_at: invoice.created_at,
      subtotal: invoice.subtotal,
      total: invoice.total,
      notes: invoice.notes,
      status: invoice.status,
      customer_balance: invoice.customer_balance,
      previous_balance: invoice.previous_balance,
      totalItems: (invoice.items || []).length,
      items: invoice.items || [],
      showTotals: true,
    });

    doc.open();
    doc.write(html);
    doc.close();
    await new Promise((r) => window.setTimeout(r, 150));

    const root = doc.getElementById('credit-invoice-root') || doc.body;
    const w = CREDIT_INVOICE_CAPTURE_WIDTH;
    const h = Math.max(
      CREDIT_INVOICE_CAPTURE_HEIGHT,
      Math.ceil(
        (root as HTMLElement).scrollHeight || (root as HTMLElement).offsetHeight || 1
      )
    );
    iframe.style.height = `${h + 8}px`;

    return html2canvas(root as HTMLElement, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: w,
      windowHeight: h,
      width: w,
      height: h,
    });
  };

  const handlePdf = async () => {
    if (!invoice) return;
    setExporting(true);
    try {
      const canvas = await captureFromIframe();
      const img = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const usableWidth = pageWidth - margin * 2;
      const imgHeight = (canvas.height * usableWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = margin;

      pdf.addImage(img, 'PNG', margin, position, usableWidth, imgHeight);
      heightLeft -= pageHeight - margin * 2;
      while (heightLeft > 0) {
        position = margin - (imgHeight - heightLeft);
        pdf.addPage();
        pdf.addImage(img, 'PNG', margin, position, usableWidth, imgHeight);
        heightLeft -= pageHeight - margin * 2;
      }

      const name = `credit_invoice_${(invoice.invoice_number || id || 'doc').replace(/\s+/g, '_')}_${getTodayDateString()}.pdf`;
      pdf.save(name);
      showToast('PDF downloaded', 'success');
    } catch (e: any) {
      console.error(e);
      showToast(e?.message || 'Failed to create PDF', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleDownload = () => {
    void handlePdf();
  };

  const handleCapturePhoto = async () => {
    if (!invoice) return;
    setExporting(true);
    try {
      const canvas = await captureFromIframe();
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png', 1)
      );
      if (!blob) {
        showToast('Failed to create image', 'error');
        return;
      }
      const canWriteImage =
        typeof navigator !== 'undefined' &&
        !!navigator.clipboard &&
        typeof (window as any).ClipboardItem !== 'undefined';
      if (!canWriteImage) {
        showToast('Image clipboard not supported in this browser', 'error');
        return;
      }
      await navigator.clipboard.write([
        new (window as any).ClipboardItem({ 'image/png': blob }),
      ]);
      showToast('Invoice image copied to clipboard', 'success');
    } catch (e: any) {
      showToast(e?.message || 'Failed to copy image', 'error');
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) return <LoadingState />;
  if (error || !invoice) {
    return <ErrorState message="Failed to load credit invoice" onRetry={() => refetch()} />;
  }

  const statusInfo = invoiceStatusInfo(invoice.status);
  const items = invoice.items || [];
  const totalQty = items.reduce(
    (sum: number, item: any) => sum + (parseFloat(String(item.quantity || 0)) || 0),
    0
  );

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} onRemove={(tid) => setToasts((p) => p.filter((t) => t.id !== tid))} />

      <div className="no-print space-y-4">
        <Button
          variant="outline"
          onClick={() => {
            if (window.history.length > 1) {
              navigate(-1);
              return;
            }
            navigate('/credit-invoices');
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
                <div className="flex-shrink-0 p-2.5 bg-blue-50 rounded-lg border border-blue-100">
                  <FileText className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">
                    {invoice.invoice_number || `Credit Invoice #${invoice.id}`}
                  </h1>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1.5">
                    Created on {formatCreditInvoiceDate(invoice.created_at)}
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
              {invoice.customer && invoice.status === 'open' ? (
                <Button
                  variant="primary"
                  onClick={() => navigate(`/credit-ledger/${invoice.customer}`)}
                  className="w-full sm:w-auto"
                >
                  <BookOpen className="h-4 w-4 mr-2" />
                  View Ledger
                </Button>
              ) : null}

              <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
                <div className="flex gap-2">
                  {canManage && invoice.status === 'open' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openEditModal}
                      className="flex-1 sm:flex-none"
                    >
                      <Pencil className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Edit</span>
                    </Button>
                  ) : null}
                  <Button variant="outline" size="sm" onClick={handlePrint} className="flex-1 sm:flex-none">
                    <Printer className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Print</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCapturePhoto}
                    disabled={exporting}
                    className="flex-1 sm:flex-none"
                  >
                    <Camera className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Photo</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownload}
                    disabled={exporting}
                    className="flex-1 sm:flex-none"
                  >
                    <Download className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">{exporting ? 'Saving…' : 'Download'}</span>
                  </Button>
                </div>

                {canManage && invoice.status === 'open' ? (
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 no-print">
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Invoice Information</h3>
          <dl className="space-y-4">
            <div className="flex items-start gap-3">
              <User className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <dt className="text-sm font-medium text-gray-500 mb-1">Customer</dt>
                <dd className="text-sm text-gray-900 font-medium">{invoice.customer_name || '—'}</dd>
                {invoice.customer_phone ? (
                  <dd className="text-xs text-gray-500 mt-0.5">{invoice.customer_phone}</dd>
                ) : null}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <dt className="text-sm font-medium text-gray-500 mb-1">Shop</dt>
                <dd className="text-sm text-gray-900 font-semibold">{CREDIT_SHOP_NAME}</dd>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <dt className="text-sm font-medium text-gray-500 mb-1">Invoice type</dt>
                <dd className="text-sm text-gray-900 capitalize">Credit</dd>
              </div>
            </div>
            {invoice.notes ? (
              <div className="flex items-start gap-3">
                <FileText className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <dt className="text-sm font-medium text-gray-500 mb-1">Notes</dt>
                  <dd className="text-sm text-gray-900 leading-relaxed">{invoice.notes}</dd>
                </div>
              </div>
            ) : null}
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Coins className="h-5 w-5 text-gray-400" />
            Financial Summary
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-gray-600">Line items</span>
              <span className="text-sm font-medium text-gray-900">{items.length}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-gray-600">Total quantity</span>
              <span className="text-sm font-medium text-gray-900">{totalQty}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-gray-600">Sub total</span>
              <span className="text-sm font-medium text-gray-900">
                ₹{formatNumber(invoice.subtotal ?? invoice.total ?? '0')}
              </span>
            </div>
            <div className="border-t border-gray-200 pt-3 mt-3 flex justify-between items-center">
              <span className="text-base font-semibold text-gray-900">Grand Total</span>
              <span className="text-lg font-bold text-gray-900">
                ₹{formatNumber(invoice.total ?? '0')}
              </span>
            </div>
            {invoice.previous_balance != null ? (
              <div className="flex justify-between items-center py-2">
                <span className="text-sm text-gray-600">Previous balance</span>
                <span className="text-sm font-medium text-gray-900">
                  ₹{formatNumber(invoice.previous_balance)}
                </span>
              </div>
            ) : null}
            {invoice.customer_balance != null ? (
              <div className="flex justify-between items-center py-2 bg-amber-900/5 rounded-lg px-3 border border-amber-200">
                <span className="text-sm font-semibold text-amber-900">Balance (ledger)</span>
                <span className="text-sm font-bold text-amber-900">
                  ₹{formatNumber(invoice.customer_balance)}
                </span>
              </div>
            ) : null}
            <div className="flex justify-between items-center py-2 bg-amber-50 rounded-lg px-3 border border-amber-100">
              <span className="text-sm font-medium text-amber-800">Posted to credit ledger</span>
              <span className="text-sm font-semibold text-amber-900">
                ₹{formatNumber(invoice.total ?? '0')} Dr
              </span>
            </div>
          </div>
        </Card>
      </div>

      {items.length > 0 ? (
        <Card className="no-print">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-gray-400" />
            Invoice Items ({items.length})
          </h3>
          <div className="hidden md:block">
            <Table headers={['Product', 'Qty', 'Unit Price', 'Total']}>
              {items.map((item: any, idx: number) => {
                const qty = parseFloat(String(item.quantity || 0)) || 0;
                const price = parseFloat(String(item.unit_price || 0)) || 0;
                const lineTotal = parseFloat(String(item.line_total ?? qty * price)) || 0;
                return (
                  <TableRow key={item.id ?? idx}>
                    <TableCell>
                      <span className="font-medium text-gray-900">{item.product_name || '—'}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-600 font-semibold">{qty}</span>
                    </TableCell>
                    <TableCell align="right">
                      <span className="font-medium text-gray-900">₹{formatAmountINR(price)}</span>
                    </TableCell>
                    <TableCell align="right">
                      <span className="font-semibold text-gray-900">₹{formatAmountINR(lineTotal)}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </Table>
          </div>
          <div className="md:hidden space-y-3">
            {items.map((item: any, idx: number) => {
              const qty = parseFloat(String(item.quantity || 0)) || 0;
              const price = parseFloat(String(item.unit_price || 0)) || 0;
              const lineTotal = parseFloat(String(item.line_total ?? qty * price)) || 0;
              return (
                <div
                  key={item.id ?? idx}
                  className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm"
                >
                  <p className="font-medium text-gray-900">{item.product_name || '—'}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="text-gray-500">Qty</span>
                      <p className="font-semibold">{qty}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Price</span>
                      <p className="font-semibold">₹{formatAmountINR(price)}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Total</span>
                      <p className="font-semibold">₹{formatAmountINR(lineTotal)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card className="no-print">
        <div className="mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Printer className="h-5 w-5 text-gray-400" />
            A4 Print Preview
          </h3>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="outline" size="sm" onClick={handlePrint} className="flex-1 sm:flex-none">
              <Printer className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Print</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCapturePhoto}
              disabled={exporting}
              className="flex-1 sm:flex-none"
            >
              <Camera className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Photo</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={exporting}
              className="flex-1 sm:flex-none"
            >
              <Download className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Download</span>
            </Button>
          </div>
        </div>
        <div className="border-2 border-gray-300 rounded-lg overflow-hidden bg-gray-100 shadow-lg">
          <div className="bg-gray-50 border-b border-gray-300 px-4 py-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700">A4 Credit Invoice Preview</span>
            <span className="text-xs text-gray-500 hidden sm:inline">
              This is how the invoice will appear when printed
            </span>
          </div>
          <div
            className="bg-gray-200 p-4 sm:p-8 flex justify-center overflow-auto"
            style={{ maxHeight: '900px' }}
          >
            <div
              className="bg-white shadow-2xl mx-auto"
              style={{
                width: '210mm',
                minHeight: '297mm',
                maxWidth: '100%',
                boxShadow: '0 0 20px rgba(0,0,0,0.3)',
              }}
            >
              <iframe
                ref={invoicePreviewRef}
                title="Credit Invoice A4 Preview"
                srcDoc={previewHtml}
                className="w-full border-0 block"
                style={{
                  width: '100%',
                  minHeight: '297mm',
                  border: 'none',
                  display: 'block',
                }}
                onLoad={(e) => {
                  const iframe = e.target as HTMLIFrameElement;
                  if (iframe.contentWindow?.document?.body) {
                    const body = iframe.contentWindow.document.body;
                    const html = iframe.contentWindow.document.documentElement;
                    const height = Math.max(
                      body.scrollHeight,
                      body.offsetHeight,
                      html.clientHeight,
                      html.scrollHeight,
                      html.offsetHeight
                    );
                    iframe.style.height = `${height + 40}px`;
                  }
                }}
              />
            </div>
          </div>
        </div>
      </Card>

      <iframe
        ref={pdfFrameRef}
        title="credit-invoice-pdf"
        className="fixed left-[-10000px] top-0 w-[794px] h-auto min-h-[1px] opacity-0 pointer-events-none border-0"
        aria-hidden="true"
      />

      <Modal isOpen={showVoidConfirm} onClose={() => setShowVoidConfirm(false)} title="Void credit invoice?">
        <div className="space-y-4">
          {invoice ? (
            <CreditVoidLedgerPreview
              kind="sale"
              label={invoice.invoice_number || `Invoice #${invoice.id}`}
              total={originalTotal}
              customerName={invoice.customer_name}
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
        title={`Edit ${invoice?.invoice_number || 'credit invoice'}`}
        size="xl"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Change qty or price, add or remove lines. Ledger balance updates by the total difference.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Invoice date"
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
              <div className="px-3 py-8 text-center text-sm text-gray-400">No lines — search to add products</div>
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
                        <div className="text-sm font-medium text-gray-900 truncate">{line.product_name}</div>
                        {line.returned_quantity > 0 ? (
                          <div className="text-xs text-amber-700 mt-0.5">
                            {line.returned_quantity} returned (min qty {line.returned_quantity})
                          </div>
                        ) : null}
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
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded justify-self-end disabled:opacity-40"
                        disabled={line.returned_quantity > 0}
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
