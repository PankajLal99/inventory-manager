import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  BookOpen,
  Camera,
  Coins,
  Download,
  FileText,
  Printer,
  ShoppingBag,
  User,
} from 'lucide-react';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { creditApi } from '../../lib/api';
import { formatAmountINR, formatNumber } from '../../lib/utils';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import Modal from '../../components/ui/Modal';
import Badge from '../../components/ui/Badge';
import Table, { TableCell, TableRow } from '../../components/ui/Table';
import ToastContainer from '../../components/ui/Toast';
import type { Toast } from '../../components/ui/Toast';
import { formatCreditInvoiceDate } from './CreditInvoiceDocument';
import {
  buildCreditInvoiceHtml,
  CREDIT_INVOICE_CAPTURE_HEIGHT,
  CREDIT_INVOICE_CAPTURE_WIDTH,
  CREDIT_SHOP_NAME,
} from './creditInvoiceHtml';

function invoiceStatusInfo(status?: string) {
  if (status === 'void') {
    return { label: 'Void', variant: 'danger' as const };
  }
  return { label: 'Open', variant: 'warning' as const };
}

export default function CreditInvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pdfFrameRef = useRef<HTMLIFrameElement>(null);
  const invoicePreviewRef = useRef<HTMLIFrameElement>(null);

  const invoiceId = parseInt(id || '', 10);

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
  });

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

      const name = `credit_invoice_${(invoice.invoice_number || id || 'doc').replace(/\s+/g, '_')}_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
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
      const link = document.createElement('a');
      link.download = `credit_invoice_${(invoice.invoice_number || id || 'photo').replace(/\s+/g, '_')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('Image saved', 'success');
    } catch (e: any) {
      showToast(e?.message || 'Failed to capture image', 'error');
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

                {invoice.status === 'open' ? (
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
        <p className="text-sm text-gray-600 mb-4">
          This reverses the ledger debit and reduces the customer&apos;s credit balance. No stock is
          changed.
        </p>
        {voidMutation.isError ? (
          <p className="text-sm text-red-600 mb-3">
            {(voidMutation.error as any)?.response?.data?.detail || 'Void failed'}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
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
      </Modal>
    </div>
  );
}
