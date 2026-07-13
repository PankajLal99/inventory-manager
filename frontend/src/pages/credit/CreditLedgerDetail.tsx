import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  ClipboardCopy,
  FileText,
  Filter,
  Minus,
  Plus,
  Printer,
  Search,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { creditApi } from '../../lib/api';
import { dateStringWithCurrentTimeISO, formatAmountINR, formatNumber, toLocalDateString } from '../../lib/utils';
import { toast } from '../../lib/toast';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import Modal from '../../components/ui/Modal';
import DateRangeSelector from '../../components/ui/DateRangeSelector';
import type { DateRangePreset } from '../../lib/utils';
import Badge from '../../components/ui/Badge';
import {
  balanceLabel,
  collectionStatusBadgeVariant,
  collectionStatusLabel,
  formatLedgerDate,
  formatMoneyCell,
} from './creditLedgerUtils';

type PaymentMethod = 'cash' | 'upi' | 'mixed';
type TxnType = '' | 'sale' | 'payment' | 'return';

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function copyPdfBlobToClipboard(blob: Blob): Promise<boolean> {
  try {
    if (!navigator.clipboard || typeof (window as any).ClipboardItem === 'undefined') {
      return false;
    }
    await navigator.clipboard.write([
      new (window as any).ClipboardItem({
        'application/pdf': blob,
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function copyPngBlobToClipboard(blob: Blob): Promise<boolean> {
  try {
    if (!navigator.clipboard || typeof (window as any).ClipboardItem === 'undefined') {
      return false;
    }
    await navigator.clipboard.write([
      new (window as any).ClipboardItem({ 'image/png': blob }),
    ]);
    return true;
  } catch {
    return false;
  }
}

export default function CreditLedgerDetail() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const ledgerListPath = (() => {
    const query = searchParams.toString();
    return query ? `/credit-ledger?${query}` : '/credit-ledger';
  })();

  const [txnType, setTxnType] = useState<TxnType>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('custom');
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState('');

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showDebitModal, setShowDebitModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [upiAmount, setUpiAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => toLocalDateString(new Date()));
  const [paymentNotes, setPaymentNotes] = useState('');
  const [debitAmount, setDebitAmount] = useState('');
  const [debitDate, setDebitDate] = useState(() => toLocalDateString(new Date()));
  const [debitNotes, setDebitNotes] = useState('');
  const [copyingPdf, setCopyingPdf] = useState(false);
  const pdfCopyFrameRef = useRef<HTMLIFrameElement>(null);

  const { data: customers = [] } = useQuery({
    queryKey: ['credit-ledger-customers', ''],
    queryFn: async () => {
      const res = await creditApi.ledger.byCustomer({ with_balance: '0' });
      return res.data || [];
    },
  });

  const customerMeta = useMemo(
    () => (customers as any[]).find((c) => String(c.id) === String(customerId)),
    [customers, customerId]
  );

  const {
    data: statement,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['credit-ledger-statement', customerId, dateFrom, dateTo, txnType],
    queryFn: async () => {
      const res = await creditApi.ledger.statement({
        customer: customerId!,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        txn_type: txnType || undefined,
      });
      return res.data;
    },
    enabled: !!customerId,
  });

  const selectedCustomer = statement?.customer || customerMeta;
  const rows = useMemo(() => {
    const list = [...(statement?.rows || [])];
    // Oldest date on top (ascending)
    list.sort((a: any, b: any) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      if (ta !== tb) return ta - tb;
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((row: any) => {
      const hay = [
        row.particulars,
        row.narration,
        row.vch_no,
        row.txn_type,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [statement?.rows, search]);

  const hasActiveFilters = !!(txnType || dateFrom || dateTo || search);

  const openPaymentModal = () => {
    setPaymentMethod('cash');
    setPaymentAmount('');
    setCashAmount('');
    setUpiAmount('');
    setPaymentDate(toLocalDateString(new Date()));
    setPaymentNotes('');
    setShowPaymentModal(true);
  };

  const paymentMutation = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('Customer not found');
      const payload: any = {
        credit_customer_id: Number(customerId),
        payment_method: paymentMethod,
        notes: paymentNotes.trim() || undefined,
        paid_at: paymentDate ? `${paymentDate}T12:00:00` : undefined,
      };
      if (paymentMethod === 'mixed') {
        payload.cash_amount = parseFloat(cashAmount || '0');
        payload.upi_amount = parseFloat(upiAmount || '0');
      } else {
        payload.amount = parseFloat(paymentAmount);
      }
      const res = await creditApi.payments.create(payload);
      return res.data;
    },
    onSuccess: () => {
      setShowPaymentModal(false);
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-statement'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-customers'] });
      refetch();
      toast('Payment recorded', 'success');
    },
    onError: (err: any) => {
      toast(err?.response?.data?.detail || 'Payment failed', 'error');
    },
  });

  const debitMutation = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('Customer not found');
      const res = await creditApi.ledger.createEntry({
        credit_customer_id: Number(customerId),
        entry_type: 'debit',
        amount: parseFloat(debitAmount),
        description: debitNotes.trim() || undefined,
        created_at: debitDate ? dateStringWithCurrentTimeISO(debitDate) : undefined,
      });
      return res.data;
    },
    onSuccess: () => {
      setShowDebitModal(false);
      setDebitAmount('');
      setDebitNotes('');
      setDebitDate(toLocalDateString(new Date()));
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-statement'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-customers'] });
      refetch();
      toast('Debit recorded', 'success');
    },
    onError: (err: any) => {
      toast(err?.response?.data?.detail || 'Debit failed', 'error');
    },
  });

  const openDebitModal = () => {
    setDebitAmount('');
    setDebitNotes('');
    setDebitDate(toLocalDateString(new Date()));
    setShowDebitModal(true);
  };

  const mixedPreview =
    (parseFloat(cashAmount || '0') || 0) + (parseFloat(upiAmount || '0') || 0);

  const periodLabel = useMemo(() => {
    if (dateFrom && dateTo) return `From ${formatLedgerDate(dateFrom)} to ${formatLedgerDate(dateTo)}`;
    if (dateFrom) return `From ${formatLedgerDate(dateFrom)}`;
    if (dateTo) return `To ${formatLedgerDate(dateTo)}`;
    return 'All dates';
  }, [dateFrom, dateTo]);

  const closingBalance = statement?.closing_balance ?? selectedCustomer?.balance ?? '0';
  const closingSide = statement?.closing_side ?? 'Dr';

  const buildCreditLedgerPdf = () => {
    if (!selectedCustomer || !statement) return null;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 12;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('POS CREDIT', pageWidth / 2, y, { align: 'center' });
    y += 6;
    doc.setFontSize(14);
    doc.text('LEDGER', pageWidth / 2, y, { align: 'center' });
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`( ${periodLabel} )`, pageWidth / 2, y, { align: 'center' });
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Account : ${(selectedCustomer.name || '').toUpperCase()}`, pageWidth / 2, y, {
      align: 'center',
    });
    y += 4;

    const body: any[][] = [];
    body.push([
      '',
      '',
      '',
      'Opening Balance',
      '',
      '',
      '',
      balanceLabel(statement.opening_balance, statement.opening_side),
    ]);

    for (const row of rows) {
      body.push([
        formatLedgerDate(row.created_at),
        row.txn_type || '',
        row.vch_no || '',
        row.particulars || '',
        row.narration || '',
        formatMoneyCell(row.debit),
        formatMoneyCell(row.credit),
        balanceLabel(row.running_balance, row.balance_side),
      ]);
    }

    body.push([
      '',
      '',
      '',
      'Totals',
      '',
      formatMoneyCell(statement.total_debit),
      formatMoneyCell(statement.total_credit),
      balanceLabel(statement.closing_balance, statement.closing_side),
    ]);

    autoTable(doc, {
      startY: y + 2,
      head: [['Date', 'Type', 'Vch No.', 'Particulars', 'Narration', 'Debit', 'Credit', 'Balance']],
      body,
      styles: {
        fontSize: 8,
        cellPadding: 1.5,
        lineColor: [0, 0, 0],
        lineWidth: 0.1,
        textColor: [0, 0, 0],
      },
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        fontStyle: 'bold',
        lineWidth: 0.2,
      },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 20 },
        2: { cellWidth: 32 },
        3: { cellWidth: 45 },
        4: { cellWidth: 40 },
        5: { cellWidth: 28, halign: 'right' },
        6: { cellWidth: 28, halign: 'right' },
        7: { cellWidth: 32, halign: 'right' },
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && (data.row.index === 0 || data.row.index === body.length - 1)) {
          data.cell.styles.fontStyle = 'bold';
        }
      },
      margin: { left: 10, right: 10 },
      theme: 'grid',
    });

    const fileName = `credit_ledger_${(selectedCustomer.name || 'customer').replace(/\s+/g, '_')}_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
    return { doc, fileName };
  };

  const buildLedgerCaptureHtml = () => {
    if (!selectedCustomer || !statement) return '';

    const head = ['Date', 'Type', 'Vch No.', 'Particulars', 'Narration', 'Debit', 'Credit', 'Balance'];
    const bodyRows: string[][] = [];
    bodyRows.push([
      '',
      '',
      '',
      'Opening Balance',
      '',
      '',
      '',
      balanceLabel(statement.opening_balance, statement.opening_side),
    ]);
    for (const row of rows) {
      bodyRows.push([
        formatLedgerDate(row.created_at),
        row.txn_type || '',
        row.vch_no || '',
        row.particulars || '',
        row.narration || '',
        formatMoneyCell(row.debit),
        formatMoneyCell(row.credit),
        balanceLabel(row.running_balance, row.balance_side),
      ]);
    }
    bodyRows.push([
      '',
      '',
      '',
      'Totals',
      '',
      formatMoneyCell(statement.total_debit),
      formatMoneyCell(statement.total_credit),
      balanceLabel(statement.closing_balance, statement.closing_side),
    ]);

    const th = head
      .map(
        (h) =>
          `<th style="border:1px solid #000;padding:6px 5px;font-size:11px;font-weight:700;background:#fff;text-align:left;">${escapeHtml(h)}</th>`
      )
      .join('');

    const trs = bodyRows
      .map((cols, idx) => {
        const bold = idx === 0 || idx === bodyRows.length - 1;
        const tds = cols
          .map((c, ci) => {
            const align = ci >= 5 ? 'right' : 'left';
            return `<td style="border:1px solid #000;padding:5px 5px;font-size:10px;text-align:${align};${bold ? 'font-weight:700;' : ''}">${escapeHtml(c)}</td>`;
          })
          .join('');
        return `<tr>${tds}</tr>`;
      })
      .join('');

    return `<!doctype html>
<html><head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#fff;">
  <div id="credit-ledger-copy-root" style="width:1123px;padding:24px 28px;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;">
    <div style="text-align:center;font-size:14px;font-weight:700;letter-spacing:0.4px;">POS CREDIT</div>
    <div style="text-align:center;font-size:18px;font-weight:800;margin-top:4px;">LEDGER</div>
    <div style="text-align:center;font-size:12px;margin-top:4px;">( ${escapeHtml(periodLabel)} )</div>
    <div style="text-align:center;font-size:13px;font-weight:700;margin:10px 0 14px;">Account : ${escapeHtml((selectedCustomer.name || '').toUpperCase())}</div>
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
      <thead><tr>${th}</tr></thead>
      <tbody>${trs}</tbody>
    </table>
  </div>
</body></html>`;
  };

  const exportPDF = () => {
    const built = buildCreditLedgerPdf();
    if (!built) return;
    built.doc.save(built.fileName);
  };

  const copyPDF = async () => {
    const built = buildCreditLedgerPdf();
    if (!built) return;

    setCopyingPdf(true);
    try {
      const pdfBlob = built.doc.output('blob');
      const file = new File([pdfBlob], built.fileName, { type: 'application/pdf' });

      // Mobile / supported browsers: share sheet includes WhatsApp with the real PDF
      const canShareFiles =
        typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] });

      if (canShareFiles) {
        try {
          await navigator.share({
            files: [file],
            title: built.fileName,
            text: `Credit ledger — ${selectedCustomer?.name || 'customer'}`,
          });
          toast('Share opened — pick WhatsApp to send the PDF', 'success');
          return;
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
          // Fall through to clipboard paths
        }
      }

      if (await copyPdfBlobToClipboard(pdfBlob)) {
        toast('PDF copied to clipboard', 'success');
        return;
      }

      // Most browsers block PDF clipboard writes — copy a matching image for WhatsApp paste
      const iframe = pdfCopyFrameRef.current;
      const doc = iframe?.contentDocument;
      if (!iframe || !doc) {
        toast('Copy preview not ready. Try Download PDF instead.', 'error');
        return;
      }

      doc.open();
      doc.write(buildLedgerCaptureHtml());
      doc.close();
      await new Promise((r) => window.setTimeout(r, 120));

      const root =
        (doc.getElementById('credit-ledger-copy-root') as HTMLElement | null) || doc.body;
      const w = Math.max(root.scrollWidth || 1123, 1123);
      const h = Math.max(root.scrollHeight || 1, 1);
      iframe.style.width = `${w}px`;
      iframe.style.height = `${h + 8}px`;

      const canvas = await html2canvas(root, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: w,
        windowHeight: h,
        width: w,
        height: h,
      });

      const pngBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png', 1)
      );
      if (!pngBlob || !(await copyPngBlobToClipboard(pngBlob))) {
        toast('Could not copy to clipboard. Use Download PDF instead.', 'error');
        return;
      }
      toast('Ledger copied — paste in WhatsApp or anywhere', 'success');
    } catch (e: any) {
      toast(e?.message || 'Failed to copy ledger', 'error');
    } finally {
      setCopyingPdf(false);
    }
  };

  const handleResetFilters = () => {
    setTxnType('');
    setDateFrom('');
    setDateTo('');
    setSearch('');
    setDatePreset('custom');
  };

  if (!customerId) {
    return <ErrorState message="Customer not found" onRetry={() => navigate(ledgerListPath)} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 flex-1 min-w-0">
          <Button
            variant="outline"
            onClick={() => {
              if (window.history.length > 1) {
                navigate(-1);
                return;
              }
              navigate(ledgerListPath);
            }}
            size="sm"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-gray-900 truncate">
              {selectedCustomer?.name || 'Customer'} — Credit Ledger
            </h1>
            {selectedCustomer?.phone ? (
              <p className="text-sm text-gray-600 mt-1">Phone: {selectedCustomer.phone}</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {statement ? (
            <>
              <Button variant="outline" onClick={exportPDF}>
                <FileText className="h-4 w-4 mr-2" />
                PDF
              </Button>
              <Button
                variant="outline"
                onClick={copyPDF}
                disabled={copyingPdf}
                title="Copy ledger to clipboard for WhatsApp"
              >
                <ClipboardCopy className="h-4 w-4 mr-2" />
                {copyingPdf ? 'Copying…' : 'Copy PDF'}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm text-gray-600">Current Balance</p>
            <p className="text-3xl font-bold mt-1 text-amber-700">
              ₹{formatAmountINR(closingBalance)} {closingSide}
            </p>
            {customerMeta?.collection_status ? (
              <div className="mt-2">
                <Badge variant={collectionStatusBadgeVariant(customerMeta.collection_status)}>
                  {collectionStatusLabel(customerMeta.collection_status)}
                  {customerMeta.days_since_last_payment != null
                    ? ` (${customerMeta.days_since_last_payment}d)`
                    : ''}
                </Badge>
              </div>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button onClick={openPaymentModal} className="bg-green-600 hover:bg-green-700">
              <Plus className="h-4 w-4 mr-2" />
              Credit (+)
            </Button>
            <Button
              variant="outline"
              className="border-red-300 text-red-600 hover:bg-red-50"
              onClick={openDebitModal}
            >
              <Minus className="h-4 w-4 mr-2" />
              Debit (-)
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-gray-500" />
            Statement
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[140px] max-w-[220px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <Input
                placeholder="Search entries…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 py-1.5 h-9 text-sm"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2"
            >
              <Filter className="h-4 w-4" />
              Filters
              {hasActiveFilters ? (
                <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                  {[txnType, dateFrom, dateTo, search].filter(Boolean).length}
                </span>
              ) : null}
            </Button>
          </div>
        </div>

        {showFilters ? (
          <div className="border-t pt-4 mb-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Calendar className="h-4 w-4 inline mr-1" />
                  Date Range
                </label>
                <DateRangeSelector
                  preset={datePreset}
                  value={{ startDate: dateFrom, endDate: dateTo }}
                  onChange={({ preset, range }) => {
                    setDatePreset(preset);
                    setDateFrom(range.startDate);
                    setDateTo(range.endDate);
                  }}
                />
              </div>
              <div>
                <Select
                  label="Type"
                  value={txnType}
                  onChange={(e) => setTxnType(e.target.value as TxnType)}
                >
                  <option value="">All</option>
                  <option value="sale">Sale</option>
                  <option value="payment">Payment</option>
                  <option value="return">Return</option>
                </Select>
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={handleResetFilters} className="flex items-center gap-2">
                <X className="h-4 w-4" />
                Reset Filters
              </Button>
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message="Failed to load statement" onRetry={() => refetch()} />
        ) : (
          <div className="border border-gray-300 rounded-lg overflow-hidden shadow-sm">
            <div className="border-b border-gray-800 px-4 py-4 text-center bg-white">
              <div className="text-sm font-semibold tracking-wide text-gray-700">POS CREDIT</div>
              <div className="text-xl font-bold tracking-wider text-gray-900 mt-1">LEDGER</div>
              <div className="text-sm text-gray-600 mt-1">( {periodLabel} )</div>
              <div className="text-base font-bold text-gray-900 mt-2 uppercase">
                Account : {selectedCustomer?.name}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-gray-800 bg-gray-50">
                    <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Date</th>
                    <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Type</th>
                    <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Vch No.</th>
                    <th className="text-left px-3 py-2 font-semibold">Particulars</th>
                    <th className="text-left px-3 py-2 font-semibold">Narration</th>
                    <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Debit</th>
                    <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Credit</th>
                    <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-200 font-medium bg-amber-50/40">
                    <td className="px-3 py-2" colSpan={3} />
                    <td className="px-3 py-2">Opening Balance</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {balanceLabel(statement?.opening_balance, statement?.opening_side)}
                    </td>
                  </tr>

                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                        No entries in this period.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row: any) => (
                      <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {formatLedgerDate(row.created_at)}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap capitalize">
                          <span
                            className={
                              row.txn_type === 'sale'
                                ? 'text-red-700'
                                : row.txn_type === 'payment'
                                  ? 'text-green-700'
                                  : 'text-blue-700'
                            }
                          >
                            {row.txn_type}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap font-mono text-xs">
                          {row.vch_no}
                        </td>
                        <td className="px-3 py-1.5">{row.particulars}</td>
                        <td className="px-3 py-1.5 text-gray-500">{row.narration}</td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
                          {formatMoneyCell(row.debit)}
                        </td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
                          {formatMoneyCell(row.credit)}
                        </td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums font-medium">
                          {balanceLabel(row.running_balance, row.balance_side)}
                        </td>
                      </tr>
                    ))
                  )}

                  <tr className="border-t-2 border-gray-800 font-bold bg-gray-50">
                    <td className="px-3 py-2" colSpan={3} />
                    <td className="px-3 py-2">Totals</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {formatMoneyCell(statement?.total_debit)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {formatMoneyCell(statement?.total_credit)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {balanceLabel(statement?.closing_balance, statement?.closing_side)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={copyPDF}
                disabled={copyingPdf}
                title="Copy ledger to clipboard for WhatsApp"
              >
                <ClipboardCopy className="h-4 w-4 mr-1" />
                {copyingPdf ? 'Copying…' : 'Copy PDF'}
              </Button>
              <Button variant="secondary" size="sm" onClick={exportPDF}>
                <Printer className="h-4 w-4 mr-1" />
                Download PDF
              </Button>
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        title={`Add Payment${selectedCustomer ? ` — ${selectedCustomer.name}` : ''}`}
      >
        <div className="space-y-3">
          <Select
            label="Payment type"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
          >
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="mixed">Cash + UPI</option>
          </Select>

          {paymentMethod === 'mixed' ? (
            <>
              <Input
                label="Cash amount"
                type="number"
                min="0"
                step="0.01"
                value={cashAmount}
                onChange={(e) => setCashAmount(e.target.value)}
              />
              <Input
                label="UPI amount"
                type="number"
                min="0"
                step="0.01"
                value={upiAmount}
                onChange={(e) => setUpiAmount(e.target.value)}
              />
              <div className="text-sm text-gray-600">Total: ₹{formatNumber(mixedPreview)}</div>
            </>
          ) : (
            <Input
              label="Amount"
              type="number"
              min="0"
              step="0.01"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
            />
          )}

          <Input
            label="Payment date"
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
          />
          <Input
            label="Notes / narration (optional)"
            value={paymentNotes}
            onChange={(e) => setPaymentNotes(e.target.value)}
          />

          {paymentMutation.isError ? (
            <p className="text-sm text-red-600">
              {(paymentMutation.error as any)?.response?.data?.detail ||
                (paymentMutation.error as Error)?.message ||
                'Payment failed'}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowPaymentModal(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                paymentMutation.isPending ||
                (paymentMethod === 'mixed'
                  ? mixedPreview <= 0
                  : !(parseFloat(paymentAmount) > 0))
              }
              onClick={() => paymentMutation.mutate()}
            >
              {paymentMutation.isPending ? 'Saving…' : 'Record payment'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showDebitModal}
        onClose={() => setShowDebitModal(false)}
        title={`Add Debit${selectedCustomer ? ` — ${selectedCustomer.name}` : ''}`}
      >
        <div className="space-y-3">
          <Input
            label="Amount"
            type="number"
            min="0"
            step="0.01"
            value={debitAmount}
            onChange={(e) => setDebitAmount(e.target.value)}
          />
          <Input
            label="Date"
            type="date"
            value={debitDate}
            onChange={(e) => setDebitDate(e.target.value)}
          />
          <Input
            label="Description (optional)"
            value={debitNotes}
            onChange={(e) => setDebitNotes(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowDebitModal(false)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              disabled={debitMutation.isPending || !(parseFloat(debitAmount) > 0)}
              onClick={() => debitMutation.mutate()}
            >
              {debitMutation.isPending ? 'Saving…' : 'Create Debit'}
            </Button>
          </div>
        </div>
      </Modal>

      <iframe
        ref={pdfCopyFrameRef}
        title="credit-ledger-pdf-copy"
        style={{
          position: 'fixed',
          left: '-99999px',
          top: 0,
          width: '1123px',
          height: '1px',
          border: 0,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
