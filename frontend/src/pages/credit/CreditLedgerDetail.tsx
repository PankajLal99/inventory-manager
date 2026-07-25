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

/** POS Credit amber palette for statement PDF / copy image */
const PDF_AMBER: [number, number, number] = [146, 64, 14]; // amber-800
const PDF_HEAD: [number, number, number] = [245, 245, 244]; // stone-100
const PDF_BORDER: [number, number, number] = [214, 211, 209]; // stone-300
const PDF_MUTED: [number, number, number] = [120, 113, 108]; // stone-500
const PDF_INK: [number, number, number] = [28, 25, 23]; // stone-900
const PDF_DEBIT_BG: [number, number, number] = [254, 242, 242]; // red-50
const PDF_CREDIT_BG: [number, number, number] = [236, 253, 245]; // emerald-50
const PDF_GREEN: [number, number, number] = [4, 120, 87]; // emerald-700
const PDF_RED: [number, number, number] = [185, 28, 28]; // red-700

function formatPdfDate(value?: string | null) {
  if (!value) return '—';
  try {
    const d = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
    if (Number.isNaN(d.getTime())) return '—';
    return format(d, 'dd-MM-yyyy');
  } catch {
    return '—';
  }
}

/** jsPDF Helvetica can't render ₹ / emoji — keep printable Latin text only */
function sanitizePdfText(value?: string | null) {
  return String(value ?? '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u2600-\u27BF]/g, '')
    .replace(/[\uFE0E\uFE0F]/g, '')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPdfAmount(value: string | number | null | undefined) {
  const n = parseFloat(String(value ?? 0));
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPdfMoney(value: string | number | null | undefined) {
  const n = parseFloat(String(value ?? 0));
  if (!Number.isFinite(n) || n === 0) return '';
  return formatPdfAmount(n);
}

function formatPdfRs(value: string | number | null | undefined) {
  return `Rs. ${formatPdfAmount(value)}`;
}

function formatPdfBalance(amount: string | number | null | undefined, side?: string) {
  const n = parseFloat(String(amount ?? 0));
  if (!Number.isFinite(n)) return '0.00 Dr';
  const s = (side || 'Dr').toLowerCase() === 'cr' ? 'Cr' : 'Dr';
  return `${formatPdfAmount(n)} ${s}`;
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
    if (dateFrom && dateTo) return `${formatPdfDate(dateFrom)} - ${formatPdfDate(dateTo)}`;
    if (dateFrom) return `From ${formatPdfDate(dateFrom)}`;
    if (dateTo) return `To ${formatPdfDate(dateTo)}`;
    return 'All dates';
  }, [dateFrom, dateTo]);

  const closingBalance = statement?.closing_balance ?? selectedCustomer?.balance ?? '0';
  const closingSide = statement?.closing_side ?? 'Dr';

  const buildStatementRows = () => {
    if (!statement) return [];
    const out: Array<{
      date: string;
      debit: string;
      credit: string;
      balance: string;
      isOpening?: boolean;
      isTotal?: boolean;
    }> = [];

    const openingDate = dateFrom
      ? formatPdfDate(dateFrom)
      : rows[0]?.created_at
        ? formatPdfDate(rows[0].created_at)
        : formatPdfDate(new Date().toISOString());

    out.push({
      date: openingDate,
      debit: '',
      credit: '',
      balance: `(Opening: ${formatPdfAmount(statement.opening_balance)})`,
      isOpening: true,
    });

    for (const row of rows) {
      out.push({
        date: formatPdfDate(row.created_at),
        debit: formatPdfMoney(row.debit),
        credit: formatPdfMoney(row.credit),
        balance: formatPdfBalance(row.running_balance, row.balance_side),
      });
    }

    out.push({
      date: 'Grand Total',
      debit: formatPdfAmount(statement.total_debit),
      credit: formatPdfAmount(statement.total_credit),
      balance: formatPdfBalance(statement.closing_balance, statement.closing_side),
      isTotal: true,
    });

    return out;
  };

  const buildCreditLedgerPdf = () => {
    if (!selectedCustomer || !statement) return null;

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 10;
    const contentW = pageWidth - marginX * 2;
    const customerName = sanitizePdfText(selectedCustomer.name || 'Customer') || 'Customer';
    const firstName = customerName.split(/\s+/)[0] || customerName;
    const netSide = String(statement.closing_side || 'Dr').toUpperCase();
    const isCr = netSide === 'CR';
    const netHint = isCr ? `(${firstName} will get)` : `(${firstName} will give)`;
    const openOn = dateFrom
      ? `on ${formatPdfDate(dateFrom)}`
      : rows[0]?.created_at
        ? `on ${formatPdfDate(rows[0].created_at)}`
        : '';

    // Top brand bar — compact
    doc.setFillColor(...PDF_AMBER);
    doc.rect(0, 0, pageWidth, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Manish Traders', marginX, 5.4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Credit Ledger', pageWidth - marginX, 5.4, { align: 'right' });

    // Title — tight
    let y = 14;
    doc.setTextColor(...PDF_INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`${customerName} Statement`, pageWidth / 2, y, { align: 'center' });
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...PDF_MUTED);
    doc.text(`(${periodLabel})`, pageWidth / 2, y, { align: 'center' });

    // Summary strip — shorter
    y += 4;
    const boxH = 16;
    doc.setDrawColor(...PDF_BORDER);
    doc.setFillColor(255, 255, 255);
    doc.setLineWidth(0.2);
    doc.roundedRect(marginX, y, contentW, boxH, 0.8, 0.8, 'FD');

    const colW = contentW / 4;
    const cards = [
      {
        label: 'Opening Balance',
        value: formatPdfRs(statement.opening_balance),
        sub: openOn,
        color: PDF_INK as [number, number, number],
      },
      {
        label: 'Total Debit(-)',
        value: formatPdfRs(statement.total_debit),
        sub: '',
        color: PDF_INK as [number, number, number],
      },
      {
        label: 'Total Credit(+)',
        value: formatPdfRs(statement.total_credit),
        sub: '',
        color: PDF_INK as [number, number, number],
      },
      {
        label: 'Net Balance',
        value: `${formatPdfRs(statement.closing_balance)} ${isCr ? 'Cr' : 'Dr'}`,
        sub: netHint,
        color: (isCr ? PDF_GREEN : PDF_RED) as [number, number, number],
      },
    ];

    cards.forEach((card, i) => {
      const x = marginX + i * colW;
      if (i > 0) {
        doc.setDrawColor(...PDF_BORDER);
        doc.line(x, y + 2, x, y + boxH - 2);
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...PDF_MUTED);
      doc.text(card.label, x + 2.5, y + 4.5);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...card.color);
      doc.text(card.value, x + 2.5, y + 9.5, { maxWidth: colW - 5 });
      if (card.sub) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6);
        doc.setTextColor(...(i === 3 ? card.color : PDF_MUTED));
        doc.text(card.sub, x + 2.5, y + 13.5, { maxWidth: colW - 5 });
      }
    });

    y += boxH + 4;
    doc.setTextColor(...PDF_INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const entriesSuffix = dateFrom || dateTo ? '(Date Range)' : '(All)';
    doc.text(`No. of Entries: ${rows.length} ${entriesSuffix}`, marginX, y);
    y += 1.5;

    const tableRows = buildStatementRows();
    const body = tableRows.map((r) => [r.date, r.debit, r.credit, r.balance]);

    autoTable(doc, {
      startY: y,
      head: [['Date', 'Debit(-)', 'Credit(+)', 'Balance']],
      body,
      styles: {
        fontSize: 7.5,
        cellPadding: { top: 1.2, right: 2, bottom: 1.2, left: 2 },
        lineColor: PDF_BORDER,
        lineWidth: 0.1,
        textColor: PDF_INK,
        valign: 'middle',
        minCellHeight: 5,
      },
      headStyles: {
        fillColor: PDF_HEAD,
        textColor: PDF_INK,
        fontStyle: 'bold',
        fontSize: 7.5,
        cellPadding: { top: 1.4, right: 2, bottom: 1.4, left: 2 },
      },
      columnStyles: {
        0: { cellWidth: 28 },
        1: { cellWidth: 38, halign: 'right', fillColor: PDF_DEBIT_BG },
        2: { cellWidth: 38, halign: 'right', fillColor: PDF_CREDIT_BG },
        3: { cellWidth: contentW - 104, halign: 'right' },
      },
      didParseCell: (data: any) => {
        if (data.section === 'head') {
          if (data.column.index === 1) data.cell.styles.fillColor = PDF_DEBIT_BG;
          if (data.column.index === 2) data.cell.styles.fillColor = PDF_CREDIT_BG;
          return;
        }
        const rowMeta = tableRows[data.row.index];
        if (!rowMeta) return;

        if (data.column.index === 1) data.cell.styles.fillColor = PDF_DEBIT_BG;
        if (data.column.index === 2) data.cell.styles.fillColor = PDF_CREDIT_BG;

        if (rowMeta.isOpening) {
          if (data.column.index === 0 || data.column.index === 3) {
            data.cell.styles.fontStyle = 'bold';
          }
          if (data.column.index === 3) {
            data.cell.styles.textColor = PDF_MUTED;
          }
        }
        if (rowMeta.isTotal) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = PDF_HEAD;
          if (data.column.index === 1) data.cell.styles.fillColor = PDF_DEBIT_BG;
          if (data.column.index === 2) data.cell.styles.fillColor = PDF_CREDIT_BG;
        }
        if (data.column.index === 3 && rowMeta.balance && !rowMeta.isOpening) {
          const balCr = /cr/i.test(rowMeta.balance);
          data.cell.styles.textColor = balCr ? PDF_GREEN : PDF_RED;
          data.cell.styles.fontStyle = 'bold';
        }
      },
      margin: { left: marginX, right: marginX, bottom: 16 },
      theme: 'grid',
    });

    const finalY = ((doc as any).lastAutoTable?.finalY || y) + 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...PDF_MUTED);
    doc.text(
      `Report Generated : ${format(new Date(), "h:mm a | dd MMM''yy")}`,
      marginX,
      Math.min(finalY, pageHeight - 12)
    );
    const pageCount = (doc as any).internal.getNumberOfPages?.() || 1;
    doc.text(`Page 1 of ${pageCount}`, pageWidth - marginX, Math.min(finalY, pageHeight - 12), {
      align: 'right',
    });

    // Bottom brand bar — compact
    doc.setFillColor(...PDF_AMBER);
    doc.rect(0, pageHeight - 8, pageWidth, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('Manish Traders', marginX, pageHeight - 3);
    doc.setFont('helvetica', 'normal');
    doc.text('Credit Ledger', pageWidth - marginX, pageHeight - 3, { align: 'right' });

    const safeName = customerName.replace(/[^\w\-]+/g, '_').replace(/_+/g, '_');
    const fileName = `credit_ledger_${safeName}_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
    return { doc, fileName };
  };

  const buildLedgerCaptureHtml = () => {
    if (!selectedCustomer || !statement) return '';

    const customerName = sanitizePdfText(selectedCustomer.name || 'Customer') || 'Customer';
    const firstName = customerName.split(/\s+/)[0] || customerName;
    const netSide = String(statement.closing_side || 'Dr').toUpperCase();
    const isCr = netSide === 'CR';
    const netHint = isCr ? `(${firstName} will get)` : `(${firstName} will give)`;
    const netColor = isCr ? '#047857' : '#b91c1c';
    const openOn = dateFrom
      ? `on ${formatPdfDate(dateFrom)}`
      : rows[0]?.created_at
        ? `on ${formatPdfDate(rows[0].created_at)}`
        : '';
    const tableRows = buildStatementRows();
    const entriesSuffix = dateFrom || dateTo ? '(Date Range)' : '(All)';

    const trs = tableRows
      .map((r) => {
        const balColor = r.isOpening ? '#78716c' : /cr/i.test(r.balance) ? '#047857' : '#b91c1c';
        const weight = r.isOpening || r.isTotal ? '700' : '500';
        const rowBg = r.isTotal ? '#f5f5f4' : '#ffffff';
        return `<tr style="background:${rowBg};">
          <td style="padding:4px 8px;border-bottom:1px solid #e7e5e4;font-size:11px;color:#1c1917;font-weight:${weight};">${escapeHtml(r.date)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e7e5e4;font-size:11px;text-align:right;background:#fef2f2;color:#1c1917;font-weight:${weight};">${escapeHtml(r.debit)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e7e5e4;font-size:11px;text-align:right;background:#ecfdf5;color:#1c1917;font-weight:${weight};">${escapeHtml(r.credit)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e7e5e4;font-size:11px;text-align:right;font-weight:700;color:${balColor};">${escapeHtml(r.balance)}</td>
        </tr>`;
      })
      .join('');

    return `<!doctype html>
<html><head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#fff;">
  <div id="credit-ledger-copy-root" style="width:794px;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;color:#1c1917;background:#fff;">
    <div style="background:#92400e;color:#fff;padding:7px 16px;display:flex;justify-content:space-between;align-items:center;">
      <div style="font-weight:700;font-size:12px;">Manish Traders</div>
      <div style="font-size:11px;">Credit Ledger</div>
    </div>
    <div style="padding:12px 16px 10px;">
      <div style="text-align:center;font-size:16px;font-weight:800;color:#1c1917;">${escapeHtml(customerName)} Statement</div>
      <div style="text-align:center;font-size:11px;color:#57534e;margin-top:2px;">(${escapeHtml(periodLabel)})</div>

      <div style="display:flex;margin-top:10px;border:1px solid #d6d3d1;border-radius:4px;overflow:hidden;">
        <div style="flex:1;padding:8px 10px;border-right:1px solid #e7e5e4;">
          <div style="font-size:10px;color:#78716c;">Opening Balance</div>
          <div style="font-size:13px;font-weight:700;margin-top:2px;">Rs. ${escapeHtml(formatPdfAmount(statement.opening_balance))}</div>
          ${openOn ? `<div style="font-size:9px;color:#78716c;margin-top:2px;">${escapeHtml(openOn)}</div>` : ''}
        </div>
        <div style="flex:1;padding:8px 10px;border-right:1px solid #e7e5e4;">
          <div style="font-size:10px;color:#78716c;">Total Debit(-)</div>
          <div style="font-size:13px;font-weight:700;margin-top:2px;">Rs. ${escapeHtml(formatPdfAmount(statement.total_debit))}</div>
        </div>
        <div style="flex:1;padding:8px 10px;border-right:1px solid #e7e5e4;">
          <div style="font-size:10px;color:#78716c;">Total Credit(+)</div>
          <div style="font-size:13px;font-weight:700;margin-top:2px;">Rs. ${escapeHtml(formatPdfAmount(statement.total_credit))}</div>
        </div>
        <div style="flex:1;padding:8px 10px;">
          <div style="font-size:10px;color:#78716c;">Net Balance</div>
          <div style="font-size:13px;font-weight:700;margin-top:2px;color:${netColor};">Rs. ${escapeHtml(formatPdfAmount(statement.closing_balance))} ${isCr ? 'Cr' : 'Dr'}</div>
          <div style="font-size:9px;margin-top:2px;color:${netColor};">${escapeHtml(netHint)}</div>
        </div>
      </div>

      <div style="margin-top:10px;font-size:11px;font-weight:700;color:#1c1917;">No. of Entries: ${rows.length} ${entriesSuffix}</div>

      <table style="width:100%;border-collapse:collapse;margin-top:4px;border:1px solid #e7e5e4;">
        <thead>
          <tr>
            <th style="text-align:left;padding:5px 8px;font-size:10px;color:#44403c;background:#f5f5f4;border-bottom:1px solid #d6d3d1;">Date</th>
            <th style="text-align:right;padding:5px 8px;font-size:10px;color:#44403c;background:#fef2f2;border-bottom:1px solid #d6d3d1;">Debit(-)</th>
            <th style="text-align:right;padding:5px 8px;font-size:10px;color:#44403c;background:#ecfdf5;border-bottom:1px solid #d6d3d1;">Credit(+)</th>
            <th style="text-align:right;padding:5px 8px;font-size:10px;color:#44403c;background:#f5f5f4;border-bottom:1px solid #d6d3d1;">Balance</th>
          </tr>
        </thead>
        <tbody>${trs}</tbody>
      </table>

      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:10px;color:#78716c;">
        <div>Report Generated : ${escapeHtml(format(new Date(), "h:mm a | dd MMM''yy"))}</div>
        <div>Page 1 of 1</div>
      </div>
    </div>
    <div style="background:#92400e;color:#fff;padding:7px 16px;display:flex;justify-content:space-between;font-size:11px;">
      <div style="font-weight:700;">Manish Traders</div>
      <div>Credit Ledger</div>
    </div>
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
      // Avoid accidentally copying page title / selected UI text with the PDF
      window.getSelection()?.removeAllRanges();

      const pdfBlob = built.doc.output('blob');
      const file = new File([pdfBlob], built.fileName, { type: 'application/pdf' });

      const canShareFiles =
        typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] });

      if (canShareFiles) {
        try {
          // files only — no title/text so WhatsApp doesn't paste "Name — Credit Ledger"
          await navigator.share({ files: [file] });
          toast('Share opened — pick WhatsApp to send the PDF', 'success');
          return;
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
        }
      }

      if (await copyPdfBlobToClipboard(pdfBlob)) {
        toast('PDF copied to clipboard', 'success');
        return;
      }

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
      const w = Math.max(root.scrollWidth || 794, 794);
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
          width: '794px',
          height: '1px',
          border: 0,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
