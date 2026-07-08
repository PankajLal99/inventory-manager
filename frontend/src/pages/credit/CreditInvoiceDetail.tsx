import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, FileText, Printer } from 'lucide-react';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { creditApi } from '../../lib/api';
import Button from '../../components/ui/Button';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import Modal from '../../components/ui/Modal';
import PageHeader from '../../components/ui/PageHeader';
import ToastContainer from '../../components/ui/Toast';
import type { Toast } from '../../components/ui/Toast';
import CreditInvoiceDocument from './CreditInvoiceDocument';
import {
  buildCreditInvoiceHtml,
  CREDIT_INVOICE_CAPTURE_WIDTH,
} from './creditInvoiceHtml';

export default function CreditInvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pdfFrameRef = useRef<HTMLIFrameElement>(null);

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
      queryClient.invalidateQueries({ queryKey: ['credit-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-statement'] });
      refetch();
    },
  });

  const handlePrint = () => {
    window.print();
  };

  const handlePdf = async () => {
    if (!invoice) return;
    const iframe = pdfFrameRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) {
      showToast('PDF preview not ready. Please refresh and try again.', 'error');
      return;
    }

    setExporting(true);
    try {
      const html = buildCreditInvoiceHtml({
        invoice_number: invoice.invoice_number,
        customer_name: invoice.customer_name,
        customer_phone: invoice.customer_phone,
        store_name: invoice.store_name,
        created_at: invoice.created_at,
        total: invoice.total,
        notes: invoice.notes,
        status: invoice.status,
        items: invoice.items || [],
        showTotals: true,
      });

      doc.open();
      doc.write(html);
      doc.close();
      await new Promise((r) => window.setTimeout(r, 80));

      const root =
        doc.getElementById('credit-invoice-root') || doc.body;
      const w = CREDIT_INVOICE_CAPTURE_WIDTH;
      const h = Math.ceil(
        (root as HTMLElement).scrollHeight || (root as HTMLElement).offsetHeight || 1
      );
      iframe.style.height = `${h + 8}px`;

      const canvas = await html2canvas(root as HTMLElement, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: w,
        windowHeight: h,
        width: w,
        height: h,
      });

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

  if (isLoading) return <LoadingState />;
  if (error || !invoice) {
    return <ErrorState message="Failed to load credit invoice" onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-4">
      <ToastContainer toasts={toasts} onRemove={(tid) => setToasts((p) => p.filter((t) => t.id !== tid))} />

      <div className="print:hidden">
        <PageHeader
          title="Credit Invoice"
          subtitle={invoice.invoice_number}
          icon={FileText}
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => navigate('/credit-invoices')}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <Button
                variant="secondary"
                onClick={() => navigate(`/credit-ledger?customer=${invoice.customer}`)}
              >
                Ledger
              </Button>
              <Button variant="secondary" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-1" />
                Print
              </Button>
              <Button variant="secondary" disabled={exporting} onClick={handlePdf}>
                <FileText className="h-4 w-4 mr-1" />
                {exporting ? 'PDF…' : 'PDF'}
              </Button>
              {invoice.status === 'open' && (
                <Button variant="danger" onClick={() => setShowVoidConfirm(true)}>
                  <Ban className="h-4 w-4 mr-1" />
                  Void
                </Button>
              )}
            </div>
          }
        />
      </div>

      <div className="max-w-4xl mx-auto">
        <CreditInvoiceDocument invoice={invoice} />
      </div>

      <iframe
        ref={pdfFrameRef}
        title="credit-invoice-pdf"
        className="fixed left-[-10000px] top-0 w-[794px] h-auto min-h-[1px] opacity-0 pointer-events-none border-0"
        aria-hidden="true"
      />

      <Modal
        isOpen={showVoidConfirm}
        onClose={() => setShowVoidConfirm(false)}
        title="Void credit invoice?"
      >
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

      <style>{`
        @media print {
          body * { visibility: hidden; }
          [data-credit-invoice-doc], [data-credit-invoice-doc] * { visibility: visible; }
          [data-credit-invoice-doc] {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            border: none !important;
            box-shadow: none !important;
          }
        }
      `}</style>
    </div>
  );
}
