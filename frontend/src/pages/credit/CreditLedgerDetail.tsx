import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  ClipboardCopy,
  Columns3,
  FileText,
  Filter,
  Minus,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { creditApi } from '../../lib/api';
import { dateStringWithCurrentTimeISO, formatNumber, toLocalDateString } from '../../lib/utils';
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
  canManageCreditRecords,
  collectionStatusBadgeVariant,
  collectionStatusLabel,
} from './creditLedgerUtils';
import { CREDIT_THEME } from './creditInvoiceHtml';

type PaymentMethod = 'cash' | 'upi' | 'mixed';
type TxnType = '' | 'sale' | 'payment' | 'return';

type LedgerColumnId =
  | 'sr'
  | 'date'
  | 'type'
  | 'vch'
  | 'particulars'
  | 'narration'
  | 'debit'
  | 'credit'
  | 'balance';

const LEDGER_COLUMN_DEFS: Array<{
  id: LedgerColumnId;
  label: string;
  defaultOn: boolean;
  align?: 'left' | 'right' | 'center';
  pdfWidth?: number;
}> = [
  { id: 'sr', label: 'Sr', defaultOn: false, align: 'center', pdfWidth: 10 },
  { id: 'date', label: 'Date', defaultOn: true, align: 'left', pdfWidth: 18 },
  { id: 'type', label: 'Type', defaultOn: false, align: 'left', pdfWidth: 18 },
  { id: 'vch', label: 'Vch No.', defaultOn: false, align: 'left', pdfWidth: 26 },
  { id: 'particulars', label: 'Particulars', defaultOn: true, align: 'left' },
  { id: 'narration', label: 'Narration', defaultOn: false, align: 'left' },
  { id: 'debit', label: 'Debit(-)', defaultOn: true, align: 'right', pdfWidth: 28 },
  { id: 'credit', label: 'Credit(+)', defaultOn: true, align: 'right', pdfWidth: 28 },
  { id: 'balance', label: 'Balance', defaultOn: true, align: 'right', pdfWidth: 30 },
];

const LEDGER_COLUMNS_STORAGE_KEY = 'credit-ledger-detail-columns-v1';

function defaultColumnVisibility(): Record<LedgerColumnId, boolean> {
  return Object.fromEntries(
    LEDGER_COLUMN_DEFS.map((c) => [c.id, c.defaultOn])
  ) as Record<LedgerColumnId, boolean>;
}

function loadColumnVisibility(): Record<LedgerColumnId, boolean> {
  const defaults = defaultColumnVisibility();
  try {
    const raw = localStorage.getItem(LEDGER_COLUMNS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<LedgerColumnId, boolean>>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Same amber scheme as A4 credit invoice print; green/red for ledger debit/credit rows */
const PDF_PRIMARY = hexToRgb(CREDIT_THEME.primary);
const PDF_SECONDARY = hexToRgb(CREDIT_THEME.secondary);
const PDF_HEAD = hexToRgb(CREDIT_THEME.tableHead);
const PDF_BORDER = hexToRgb(CREDIT_THEME.primaryBorder);
const PDF_MUTED = hexToRgb(CREDIT_THEME.textMuted);
const PDF_INK = hexToRgb(CREDIT_THEME.text);
const PDF_DEBIT_BG = hexToRgb(CREDIT_THEME.debitBg);
const PDF_DEBIT_SOFT = hexToRgb(CREDIT_THEME.debitBgSoft);
const PDF_CREDIT_BG = hexToRgb(CREDIT_THEME.creditBg);
const PDF_CREDIT_SOFT = hexToRgb(CREDIT_THEME.creditBgSoft);
const PDF_GREEN = hexToRgb(CREDIT_THEME.creditText);
const PDF_RED = hexToRgb(CREDIT_THEME.debitText);

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

/** Compact table dates like Khatabook (06 Jul) */
function formatPdfDateShort(value?: string | null) {
  if (!value) return '—';
  try {
    const d = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
    if (Number.isNaN(d.getTime())) return '—';
    return format(d, 'dd MMM');
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
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [columnVisibility, setColumnVisibility] =
    useState<Record<LedgerColumnId, boolean>>(loadColumnVisibility);
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
  const [showEditModal, setShowEditModal] = useState(false);
  const [editEntryId, setEditEntryId] = useState<number | null>(null);
  const [editEntryType, setEditEntryType] = useState<'debit' | 'credit'>('debit');
  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState(() => toLocalDateString(new Date()));
  const [editDescription, setEditDescription] = useState('');
  const [deleteEntryId, setDeleteEntryId] = useState<number | null>(null);
  const [copyingPdf, setCopyingPdf] = useState(false);
  const canManage = canManageCreditRecords();
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

  const visibleColumns = useMemo(
    () => LEDGER_COLUMN_DEFS.filter((c) => columnVisibility[c.id]),
    [columnVisibility]
  );

  const toggleColumn = (id: LedgerColumnId) => {
    setColumnVisibility((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      const anyOn = LEDGER_COLUMN_DEFS.some((c) => next[c.id]);
      if (!anyOn) {
        toast('Keep at least one column visible', 'error');
        return prev;
      }
      try {
        localStorage.setItem(LEDGER_COLUMNS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const resetColumns = () => {
    const defaults = defaultColumnVisibility();
    setColumnVisibility(defaults);
    try {
      localStorage.setItem(LEDGER_COLUMNS_STORAGE_KEY, JSON.stringify(defaults));
    } catch {
      /* ignore */
    }
  };

  const showAllColumns = () => {
    const all = Object.fromEntries(LEDGER_COLUMN_DEFS.map((c) => [c.id, true])) as Record<
      LedgerColumnId,
      boolean
    >;
    setColumnVisibility(all);
    try {
      localStorage.setItem(LEDGER_COLUMNS_STORAGE_KEY, JSON.stringify(all));
    } catch {
      /* ignore */
    }
  };

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

  const openEditEntry = (row: {
    entryId?: number;
    entryType?: string;
    rawAmount?: string | number;
    rawDate?: string;
    rawDescription?: string;
  }) => {
    setEditEntryId(Number(row.entryId));
    setEditEntryType(row.entryType === 'credit' ? 'credit' : 'debit');
    setEditAmount(String(row.rawAmount ?? ''));
    setEditDate(
      row.rawDate ? toLocalDateString(new Date(row.rawDate)) : toLocalDateString(new Date())
    );
    setEditDescription(String(row.rawDescription || 'Opening Balance'));
    setShowEditModal(true);
  };

  const editEntryMutation = useMutation({
    mutationFn: async () => {
      if (!editEntryId) throw new Error('No entry selected');
      const amount = parseFloat(editAmount);
      if (!(amount > 0)) throw new Error('Amount must be greater than 0');
      const res = await creditApi.ledger.updateEntry(editEntryId, {
        amount,
        description: editDescription.trim() || 'Opening Balance',
        created_at: editDate ? dateStringWithCurrentTimeISO(editDate) : undefined,
      });
      return res.data;
    },
    onSuccess: () => {
      setShowEditModal(false);
      setEditEntryId(null);
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-statement'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-customers'] });
      refetch();
      toast('Opening balance updated', 'success');
    },
    onError: (err: any) => {
      toast(
        err?.response?.data?.detail || err?.message || 'Failed to update entry',
        'error'
      );
    },
  });

  const deleteEntryMutation = useMutation({
    mutationFn: async (entryId: number) => {
      await creditApi.ledger.deleteEntry(entryId);
    },
    onSuccess: () => {
      setDeleteEntryId(null);
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-statement'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-customers'] });
      queryClient.invalidateQueries({ queryKey: ['manual-credit-entries'] });
      refetch();
      toast('Entry removed', 'success');
    },
    onError: (err: any) => {
      toast(err?.response?.data?.detail || 'Failed to delete entry', 'error');
    },
  });

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
  const netIsCr = String(closingSide || 'Dr').toUpperCase() === 'CR';
  const customerDisplayName =
    sanitizePdfText(selectedCustomer?.name || 'Customer') || 'Customer';
  const customerFirstName = customerDisplayName.split(/\s+/)[0] || customerDisplayName;
  const netHint = netIsCr
    ? `(${customerFirstName} will get)`
    : `(${customerFirstName} will give)`;
  const openingOnLabel = dateFrom
    ? `on ${formatPdfDate(dateFrom)}`
    : rows[0]?.created_at
      ? `on ${formatPdfDate(rows[0].created_at)}`
      : '';
  const entriesSuffix = dateFrom || dateTo ? '(Date Range)' : '(All)';

  const statementRows = useMemo(() => {
    if (!statement) return [];
    const out: Array<{
      sr: string;
      date: string;
      type: string;
      vch: string;
      particulars: string;
      narration: string;
      debit: string;
      credit: string;
      balance: string;
      isOpening?: boolean;
      isTotal?: boolean;
      hasDebit?: boolean;
      hasCredit?: boolean;
      entryId?: number;
      isManual?: boolean;
      entryType?: string;
      rawAmount?: string | number;
      rawDate?: string;
      rawDescription?: string;
    }> = [];

    const openingDate = dateFrom
      ? formatPdfDateShort(dateFrom)
      : rows[0]?.created_at
        ? formatPdfDateShort(rows[0].created_at)
        : formatPdfDateShort(new Date().toISOString());

    out.push({
      sr: '',
      date: openingDate,
      type: '',
      vch: '',
      particulars: 'Opening Balance',
      narration: '',
      debit: '',
      credit: '',
      balance: formatPdfBalance(statement.opening_balance, statement.opening_side),
      isOpening: true,
    });

    rows.forEach((row: any, idx: number) => {
      const debit = formatPdfMoney(row.debit);
      const credit = formatPdfMoney(row.credit);
      out.push({
        sr: String(idx + 1),
        date: formatPdfDateShort(row.created_at),
        type: sanitizePdfText(row.txn_type || '') || '',
        vch: sanitizePdfText(row.vch_no || '') || '',
        particulars: sanitizePdfText(row.particulars || '') || '',
        narration: sanitizePdfText(row.narration || '') || '',
        debit,
        credit,
        balance: formatPdfBalance(row.running_balance, row.balance_side),
        hasDebit: !!debit,
        hasCredit: !!credit,
        entryId: row.id,
        isManual: !!row.is_manual,
        entryType: row.entry_type,
        rawAmount: row.amount,
        rawDate: row.created_at,
        rawDescription: row.description || row.narration || '',
      });
    });

    out.push({
      sr: '',
      date: 'Grand Total',
      type: '',
      vch: '',
      particulars: '',
      narration: '',
      debit: formatPdfAmount(statement.total_debit),
      credit: formatPdfAmount(statement.total_credit),
      balance: formatPdfBalance(statement.closing_balance, statement.closing_side),
      isTotal: true,
      hasDebit: true,
      hasCredit: true,
    });

    return out;
  }, [statement, rows, dateFrom]);

  const cellValue = (r: (typeof statementRows)[number], id: LedgerColumnId) => {
    switch (id) {
      case 'sr':
        return r.sr;
      case 'date':
        return r.date;
      case 'type':
        return r.type;
      case 'vch':
        return r.vch;
      case 'particulars':
        return r.particulars;
      case 'narration':
        return r.narration;
      case 'debit':
        return r.debit;
      case 'credit':
        return r.credit;
      case 'balance':
        return r.balance;
      default:
        return '';
    }
  };

  const buildStatementRows = () => statementRows;

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

    // Top brand bar — same amber as A4 credit invoice
    doc.setFillColor(...PDF_PRIMARY);
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
    doc.setTextColor(...PDF_SECONDARY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`${customerName} Statement`, pageWidth / 2, y, { align: 'center' });
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...PDF_MUTED);
    doc.text(`(${periodLabel})`, pageWidth / 2, y, { align: 'center' });

    // Summary strip — shorter (white card, amber border)
    y += 4;
    const boxH = 16;
    doc.setDrawColor(...PDF_BORDER);
    doc.setFillColor(255, 255, 255);
    doc.setLineWidth(0.3);
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
    const cols = visibleColumns.length ? visibleColumns : LEDGER_COLUMN_DEFS.filter((c) => c.defaultOn);
    const body = tableRows.map((r) => cols.map((c) => cellValue(r, c.id)));
    const flexIds = new Set<LedgerColumnId>(['particulars', 'narration']);
    const fixedW = cols.reduce((sum, c) => sum + (flexIds.has(c.id) ? 0 : c.pdfWidth || 20), 0);
    const flexCount = cols.filter((c) => flexIds.has(c.id)).length || 1;
    const flexEach = Math.max(24, (contentW - fixedW) / flexCount);

    const columnStyles: Record<number, any> = {};
    cols.forEach((c, i) => {
      columnStyles[i] = {
        cellWidth: flexIds.has(c.id) ? flexEach : c.pdfWidth || 20,
        halign: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left',
      };
    });

    autoTable(doc, {
      startY: y,
      head: [cols.map((c) => c.label)],
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
      columnStyles,
      didParseCell: (data: any) => {
        const col = cols[data.column.index];
        if (!col) return;

        if (data.section === 'head') {
          data.cell.styles.fillColor = PDF_HEAD;
          data.cell.styles.textColor = PDF_SECONDARY;
          if (col.id === 'debit') data.cell.styles.fillColor = PDF_DEBIT_BG;
          if (col.id === 'credit') data.cell.styles.fillColor = PDF_CREDIT_BG;
          return;
        }
        const rowMeta = tableRows[data.row.index];
        if (!rowMeta) return;

        let rowBg: [number, number, number] = [255, 255, 255];
        if (rowMeta.isTotal) rowBg = PDF_HEAD;
        else if (rowMeta.hasCredit && !rowMeta.hasDebit) rowBg = PDF_CREDIT_SOFT;
        else if (rowMeta.hasDebit && !rowMeta.hasCredit) rowBg = PDF_DEBIT_SOFT;
        data.cell.styles.fillColor = rowBg;

        if (col.id === 'debit' && (rowMeta.hasDebit || rowMeta.isTotal)) {
          data.cell.styles.fillColor = PDF_DEBIT_BG;
        }
        if (col.id === 'credit' && (rowMeta.hasCredit || rowMeta.isTotal)) {
          data.cell.styles.fillColor = PDF_CREDIT_BG;
        }
        if (col.id === 'balance' && rowMeta.hasCredit && !rowMeta.isOpening) {
          data.cell.styles.fillColor = PDF_CREDIT_BG;
        }

        if (rowMeta.isOpening) {
          if (col.id === 'date' || col.id === 'particulars' || col.id === 'balance') {
            data.cell.styles.fontStyle = 'bold';
          }
          if (col.id === 'balance') data.cell.styles.textColor = PDF_MUTED;
        }
        if (rowMeta.isTotal) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = PDF_SECONDARY;
        }
        if (col.id === 'balance' && rowMeta.balance && !rowMeta.isOpening) {
          const balCr = /cr/i.test(rowMeta.balance);
          data.cell.styles.textColor = balCr ? PDF_GREEN : PDF_RED;
          data.cell.styles.fontStyle = 'bold';
        }
        if (col.id === 'type' && rowMeta.type) {
          if (rowMeta.type === 'sale') data.cell.styles.textColor = PDF_RED;
          else if (rowMeta.type === 'payment') data.cell.styles.textColor = PDF_GREEN;
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

    // Bottom brand bar — same amber as A4 credit invoice
    doc.setFillColor(...PDF_PRIMARY);
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
    const netColor = isCr ? CREDIT_THEME.creditText : CREDIT_THEME.debitText;
    const openOn = dateFrom
      ? `on ${formatPdfDate(dateFrom)}`
      : rows[0]?.created_at
        ? `on ${formatPdfDate(rows[0].created_at)}`
        : '';
    const tableRows = buildStatementRows();
    const entriesSuffix = dateFrom || dateTo ? '(Date Range)' : '(All)';
    const cols = visibleColumns.length ? visibleColumns : LEDGER_COLUMN_DEFS.filter((c) => c.defaultOn);

    const trs = tableRows
      .map((r) => {
        const balCr = /cr/i.test(r.balance);
        const balColor = r.isOpening
          ? CREDIT_THEME.textMuted
          : balCr
            ? CREDIT_THEME.creditText
            : CREDIT_THEME.debitText;
        const weight = r.isOpening || r.isTotal ? '700' : '500';
        let rowBg = CREDIT_THEME.white;
        if (r.isTotal) rowBg = CREDIT_THEME.tableHead;
        else if (r.hasCredit && !r.hasDebit) rowBg = CREDIT_THEME.creditBgSoft;
        else if (r.hasDebit && !r.hasCredit) rowBg = CREDIT_THEME.debitBgSoft;

        const tds = cols
          .map((c) => {
            const val = cellValue(r, c.id);
            let bg = rowBg;
            let color = CREDIT_THEME.text;
            let fw = weight;
            let align = c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left';
            if (c.id === 'debit' && (r.hasDebit || r.isTotal)) bg = CREDIT_THEME.debitBg;
            if (c.id === 'credit' && (r.hasCredit || r.isTotal)) bg = CREDIT_THEME.creditBg;
            if (c.id === 'balance') {
              fw = '700';
              color = balColor;
              if (r.hasCredit && !r.isOpening && !r.isTotal) bg = CREDIT_THEME.creditBg;
              else if (r.isTotal) bg = CREDIT_THEME.tableHead;
            }
            if (c.id === 'type') {
              if (r.type === 'sale') color = CREDIT_THEME.debitText;
              else if (r.type === 'payment') color = CREDIT_THEME.creditText;
            }
            return `<td style="padding:4px 8px;border:1px solid ${CREDIT_THEME.primaryBorder};font-size:11px;text-align:${align};background:${bg};color:${color};font-weight:${fw};">${escapeHtml(val)}</td>`;
          })
          .join('');

        return `<tr style="background:${rowBg};">${tds}</tr>`;
      })
      .join('');

    const ths = cols
      .map((c) => {
        let bg = CREDIT_THEME.tableHead;
        if (c.id === 'debit') bg = CREDIT_THEME.debitBg;
        if (c.id === 'credit') bg = CREDIT_THEME.creditBg;
        const align = c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left';
        return `<th style="text-align:${align};padding:5px 8px;font-size:10px;color:${CREDIT_THEME.secondary};background:${bg};border:1px solid ${CREDIT_THEME.primaryBorder};">${escapeHtml(c.label)}</th>`;
      })
      .join('');

    return `<!doctype html>
<html><head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#fff;">
  <div id="credit-ledger-copy-root" style="width:794px;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;color:${CREDIT_THEME.text};background:${CREDIT_THEME.white};border:3px solid ${CREDIT_THEME.primary};">
    <div style="background:${CREDIT_THEME.primary};color:#fff;padding:7px 16px;display:flex;justify-content:space-between;align-items:center;">
      <div style="font-weight:700;font-size:12px;">Manish Traders</div>
      <div style="font-size:11px;">Credit Ledger</div>
    </div>
    <div style="padding:12px 16px 10px;background:${CREDIT_THEME.white};">
      <div style="text-align:center;font-size:16px;font-weight:800;color:${CREDIT_THEME.secondary};">${escapeHtml(customerName)} Statement</div>
      <div style="text-align:center;font-size:11px;color:${CREDIT_THEME.textMuted};margin-top:2px;">(${escapeHtml(periodLabel)})</div>

      <div style="display:flex;margin-top:10px;border:1px solid ${CREDIT_THEME.primaryBorder};border-radius:4px;overflow:hidden;background:${CREDIT_THEME.white};">
        <div style="flex:1;padding:8px 10px;border-right:1px solid ${CREDIT_THEME.primaryBorder};">
          <div style="font-size:10px;color:${CREDIT_THEME.textMuted};">Opening Balance</div>
          <div style="font-size:13px;font-weight:700;margin-top:2px;color:${CREDIT_THEME.text};">Rs. ${escapeHtml(formatPdfAmount(statement.opening_balance))}</div>
          ${openOn ? `<div style="font-size:9px;color:${CREDIT_THEME.textMuted};margin-top:2px;">${escapeHtml(openOn)}</div>` : ''}
        </div>
        <div style="flex:1;padding:8px 10px;border-right:1px solid ${CREDIT_THEME.primaryBorder};">
          <div style="font-size:10px;color:${CREDIT_THEME.textMuted};">Total Debit(-)</div>
          <div style="font-size:13px;font-weight:700;margin-top:2px;color:${CREDIT_THEME.text};">Rs. ${escapeHtml(formatPdfAmount(statement.total_debit))}</div>
        </div>
        <div style="flex:1;padding:8px 10px;border-right:1px solid ${CREDIT_THEME.primaryBorder};">
          <div style="font-size:10px;color:${CREDIT_THEME.textMuted};">Total Credit(+)</div>
          <div style="font-size:13px;font-weight:700;margin-top:2px;color:${CREDIT_THEME.text};">Rs. ${escapeHtml(formatPdfAmount(statement.total_credit))}</div>
        </div>
        <div style="flex:1;padding:8px 10px;">
          <div style="font-size:10px;color:${CREDIT_THEME.textMuted};">Net Balance</div>
          <div style="font-size:13px;font-weight:700;margin-top:2px;color:${netColor};">Rs. ${escapeHtml(formatPdfAmount(statement.closing_balance))} ${isCr ? 'Cr' : 'Dr'}</div>
          <div style="font-size:9px;margin-top:2px;color:${netColor};">${escapeHtml(netHint)}</div>
        </div>
      </div>

      <div style="margin-top:10px;font-size:11px;font-weight:700;color:${CREDIT_THEME.secondary};">No. of Entries: ${rows.length} ${entriesSuffix}</div>

      <table style="width:100%;border-collapse:collapse;margin-top:4px;border:1px solid ${CREDIT_THEME.primaryBorder};background:${CREDIT_THEME.white};">
        <thead>
          <tr>
            ${ths}
          </tr>
        </thead>
        <tbody>${trs}</tbody>
      </table>

      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:10px;color:${CREDIT_THEME.textMuted};">
        <div>Report Generated : ${escapeHtml(format(new Date(), "h:mm a | dd MMM''yy"))}</div>
        <div>Page 1 of 1</div>
      </div>
    </div>
    <div style="background:${CREDIT_THEME.primary};color:#fff;padding:7px 16px;display:flex;justify-content:space-between;font-size:11px;">
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
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
            <h1 className="text-xl sm:text-2xl font-bold text-stone-900 truncate">
              {selectedCustomer?.name || 'Customer'}
            </h1>
            {selectedCustomer?.phone ? (
              <p className="text-sm text-stone-500 mt-0.5">Phone: {selectedCustomer.phone}</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={openPaymentModal} className="bg-green-600 hover:bg-green-700" size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            Credit (+)
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-red-300 text-red-600 hover:bg-red-50"
            onClick={openDebitModal}
          >
            <Minus className="h-4 w-4 mr-1.5" />
            Debit (-)
          </Button>
          {statement ? (
            <>
              <Button variant="outline" size="sm" onClick={exportPDF}>
                <FileText className="h-4 w-4 mr-1.5" />
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={copyPDF}
                disabled={copyingPdf}
                title="Copy ledger to clipboard for WhatsApp"
              >
                <ClipboardCopy className="h-4 w-4 mr-1.5" />
                {copyingPdf ? 'Copying…' : 'Copy PDF'}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-b border-stone-200 bg-stone-50/80">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
            <BookOpen className="h-4 w-4 text-amber-800" />
            Statement
            {customerMeta?.collection_status ? (
              <Badge variant={collectionStatusBadgeVariant(customerMeta.collection_status)}>
                {collectionStatusLabel(customerMeta.collection_status)}
                {customerMeta.days_since_last_payment != null
                  ? ` (${customerMeta.days_since_last_payment}d)`
                  : ''}
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[140px] max-w-[220px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400 pointer-events-none" />
              <Input
                placeholder="Search entries…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 py-1.5 h-9 text-sm"
              />
            </div>
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowColumnSettings((v) => !v)}
                className="flex items-center gap-2"
              >
                <Columns3 className="h-4 w-4" />
                Columns
                <span className="bg-amber-800 text-white rounded-full min-w-[1.25rem] h-5 px-1 flex items-center justify-center text-xs">
                  {visibleColumns.length}
                </span>
              </Button>
              {showColumnSettings ? (
                <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-stone-200 bg-white shadow-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold text-stone-800">Column settings</div>
                    <button
                      type="button"
                      className="text-stone-400 hover:text-stone-600"
                      onClick={() => setShowColumnSettings(false)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="space-y-1.5 max-h-64 overflow-auto">
                    {LEDGER_COLUMN_DEFS.map((col) => (
                      <label
                        key={col.id}
                        className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-amber-50 cursor-pointer text-sm text-stone-700"
                      >
                        <input
                          type="checkbox"
                          className="rounded border-stone-300 text-amber-700 focus:ring-amber-600"
                          checked={!!columnVisibility[col.id]}
                          onChange={() => toggleColumn(col.id)}
                        />
                        {col.label}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-3 pt-2 border-t border-stone-100">
                    <Button variant="outline" size="sm" className="flex-1" onClick={showAllColumns}>
                      All
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={resetColumns}>
                      Reset
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2"
            >
              <Filter className="h-4 w-4" />
              Filters
              {hasActiveFilters ? (
                <span className="bg-amber-800 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                  {[txnType, dateFrom, dateTo, search].filter(Boolean).length}
                </span>
              ) : null}
            </Button>
          </div>
        </div>

        {showFilters ? (
          <div className="px-4 py-3 border-b border-stone-200 space-y-3 bg-white">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-stone-700 mb-1.5">
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
              <Button variant="outline" size="sm" onClick={handleResetFilters} className="flex items-center gap-2">
                <X className="h-4 w-4" />
                Reset Filters
              </Button>
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <div className="p-8">
            <LoadingState />
          </div>
        ) : error ? (
          <div className="p-8">
            <ErrorState message="Failed to load statement" onRetry={() => refetch()} />
          </div>
        ) : (
          <div className="bg-white border-[3px] border-amber-600 overflow-hidden">
            <div className="bg-amber-600 text-white px-4 py-2 flex items-center justify-between">
              <div className="font-bold text-sm">Manish Traders</div>
              <div className="text-xs sm:text-sm">Credit Ledger</div>
            </div>

            <div className="px-4 py-4 sm:px-5 bg-white">
              <div className="text-center">
                <div className="text-lg sm:text-xl font-extrabold text-amber-950">
                  {customerDisplayName} Statement
                </div>
                <div className="text-xs sm:text-sm text-stone-600 mt-0.5">({periodLabel})</div>
              </div>

              <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 border border-amber-400 rounded overflow-hidden bg-white">
                <div className="px-3 py-2.5 border-b lg:border-b-0 lg:border-r border-amber-300">
                  <div className="text-[10px] sm:text-xs text-stone-500">Opening Balance</div>
                  <div className="text-sm font-bold text-stone-900 mt-0.5 tabular-nums">
                    Rs. {formatPdfAmount(statement?.opening_balance)}
                  </div>
                  {openingOnLabel ? (
                    <div className="text-[10px] text-stone-500 mt-0.5">{openingOnLabel}</div>
                  ) : null}
                </div>
                <div className="px-3 py-2.5 border-b lg:border-b-0 lg:border-r border-amber-300">
                  <div className="text-[10px] sm:text-xs text-stone-500">Total Debit(-)</div>
                  <div className="text-sm font-bold text-stone-900 mt-0.5 tabular-nums">
                    Rs. {formatPdfAmount(statement?.total_debit)}
                  </div>
                </div>
                <div className="px-3 py-2.5 border-b sm:border-b-0 lg:border-r border-amber-300">
                  <div className="text-[10px] sm:text-xs text-stone-500">Total Credit(+)</div>
                  <div className="text-sm font-bold text-stone-900 mt-0.5 tabular-nums">
                    Rs. {formatPdfAmount(statement?.total_credit)}
                  </div>
                </div>
                <div className="px-3 py-2.5">
                  <div className="text-[10px] sm:text-xs text-stone-500">Net Balance</div>
                  <div
                    className={`text-sm font-bold mt-0.5 tabular-nums ${
                      netIsCr ? 'text-green-700' : 'text-red-700'
                    }`}
                  >
                    Rs. {formatPdfAmount(closingBalance)} {netIsCr ? 'Cr' : 'Dr'}
                  </div>
                  <div
                    className={`text-[10px] mt-0.5 ${
                      netIsCr ? 'text-green-700' : 'text-red-700'
                    }`}
                  >
                    {netHint}
                  </div>
                </div>
              </div>

              <div className="mt-3 text-xs sm:text-sm font-bold text-amber-900">
                No. of Entries: {rows.length} {entriesSuffix}
              </div>

              <div className="mt-1.5 overflow-x-auto border border-amber-400 rounded bg-white">
                <table className="min-w-full text-xs sm:text-sm border-collapse">
                  <thead>
                    <tr>
                      {visibleColumns.map((col) => {
                        const align =
                          col.align === 'right'
                            ? 'text-right'
                            : col.align === 'center'
                              ? 'text-center'
                              : 'text-left';
                        const bg =
                          col.id === 'debit'
                            ? 'bg-red-100'
                            : col.id === 'credit'
                              ? 'bg-green-100'
                              : 'bg-amber-100';
                        return (
                          <th
                            key={col.id}
                            className={`${align} px-2.5 py-1.5 font-bold text-amber-900 ${bg} border border-amber-400 whitespace-nowrap`}
                          >
                            {col.label}
                          </th>
                        );
                      })}
                      {canManage ? (
                        <th className="px-2 py-1.5 font-bold text-amber-900 bg-amber-100 border border-amber-400 w-16" />
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <>
                        {statementRows
                          .filter((r) => r.isOpening)
                          .map((r, i) => (
                            <tr key={`open-${i}`} className="bg-white">
                              {visibleColumns.map((col) => {
                                const align =
                                  col.align === 'right'
                                    ? 'text-right'
                                    : col.align === 'center'
                                      ? 'text-center'
                                      : 'text-left';
                                return (
                                  <td
                                    key={col.id}
                                    className={`px-2.5 py-1.5 font-bold border border-amber-300 ${align} ${
                                      col.id === 'balance' ? 'text-stone-500' : 'text-stone-900'
                                    }`}
                                  >
                                    {cellValue(r, col.id)}
                                  </td>
                                );
                              })}
                              {canManage ? <td className="border border-amber-300" /> : null}
                            </tr>
                          ))}
                        <tr>
                          <td
                            colSpan={Math.max(visibleColumns.length, 1) + (canManage ? 1 : 0)}
                            className="px-2.5 py-6 text-center text-stone-400 border border-amber-300"
                          >
                            No entries in this period.
                          </td>
                        </tr>
                        {statementRows
                          .filter((r) => r.isTotal)
                          .map((r, i) => (
                            <tr key={`total-${i}`} className="bg-amber-100 font-bold">
                              {visibleColumns.map((col) => {
                                const align =
                                  col.align === 'right'
                                    ? 'text-right'
                                    : col.align === 'center'
                                      ? 'text-center'
                                      : 'text-left';
                                const bg =
                                  col.id === 'debit'
                                    ? 'bg-red-100'
                                    : col.id === 'credit'
                                      ? 'bg-green-100'
                                      : '';
                                const balColor = /cr/i.test(r.balance)
                                  ? 'text-green-700'
                                  : 'text-red-700';
                                return (
                                  <td
                                    key={col.id}
                                    className={`px-2.5 py-1.5 border border-amber-400 tabular-nums ${align} ${bg} ${
                                      col.id === 'balance' ? balColor : 'text-amber-950'
                                    }`}
                                  >
                                    {cellValue(r, col.id)}
                                  </td>
                                );
                              })}
                              {canManage ? <td className="border border-amber-400" /> : null}
                            </tr>
                          ))}
                      </>
                    ) : (
                      statementRows.map((r, idx) => {
                        const balCr = /cr/i.test(r.balance);
                        const balColor = r.isOpening
                          ? 'text-stone-500'
                          : balCr
                            ? 'text-green-700'
                            : 'text-red-700';
                        let rowBg = 'bg-white';
                        if (r.isTotal) rowBg = 'bg-amber-100';
                        else if (r.hasCredit && !r.hasDebit) rowBg = 'bg-green-50';
                        else if (r.hasDebit && !r.hasCredit) rowBg = 'bg-red-50';

                        return (
                          <tr key={idx} className={`${rowBg} ${r.isTotal ? 'font-bold' : ''}`}>
                            {visibleColumns.map((col) => {
                              const align =
                                col.align === 'right'
                                  ? 'text-right'
                                  : col.align === 'center'
                                    ? 'text-center'
                                    : 'text-left';
                              let extra = '';
                              if (col.id === 'debit' && (r.hasDebit || r.isTotal)) extra = 'bg-red-100';
                              if (col.id === 'credit' && (r.hasCredit || r.isTotal))
                                extra = 'bg-green-100';
                              if (col.id === 'balance') {
                                extra = `${balColor} font-bold ${
                                  r.hasCredit && !r.isOpening && !r.isTotal ? 'bg-green-100' : ''
                                }`;
                              }
                              if (col.id === 'type') {
                                if (r.type === 'sale') extra = 'text-red-700 capitalize';
                                else if (r.type === 'payment') extra = 'text-green-700 capitalize';
                                else if (r.type === 'return') extra = 'text-blue-700 capitalize';
                                else if (r.type) extra = 'capitalize';
                              }
                              if (
                                (col.id === 'date' || col.id === 'particulars') &&
                                (r.isOpening || r.isTotal)
                              ) {
                                extra = `${extra} font-bold`.trim();
                              }
                              return (
                                <td
                                  key={col.id}
                                  className={`px-2.5 py-1 border border-amber-300 text-stone-900 tabular-nums ${align} ${
                                    col.id === 'date' || col.id === 'vch' ? 'whitespace-nowrap' : ''
                                  } ${extra}`}
                                >
                                  {cellValue(r, col.id)}
                                </td>
                              );
                            })}
                            {canManage ? (
                              <td className="px-1 py-1 border border-amber-300 text-center whitespace-nowrap">
                                {r.isManual && r.entryId ? (
                                  <div className="inline-flex items-center gap-0.5">
                                    <button
                                      type="button"
                                      className="p-1 text-amber-800 hover:bg-amber-100 rounded"
                                      title="Edit opening balance"
                                      onClick={() => openEditEntry(r)}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      className="p-1 text-red-600 hover:bg-red-50 rounded"
                                      title="Delete entry"
                                      onClick={() => setDeleteEntryId(r.entryId!)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                ) : null}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-2.5 flex flex-wrap justify-between gap-2 text-[10px] sm:text-xs text-stone-500">
                <div>Report Generated : {format(new Date(), "h:mm a | dd MMM''yy")}</div>
                <div>Page 1 of 1</div>
              </div>
            </div>

            <div className="bg-amber-600 text-white px-4 py-2 flex items-center justify-between text-xs sm:text-sm">
              <div className="font-bold">Manish Traders</div>
              <div>Credit Ledger</div>
            </div>

            <div className="px-4 py-2.5 border-t border-amber-200 flex flex-wrap justify-end gap-2 bg-white">
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

      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title={
          editEntryType === 'credit'
            ? `Edit Opening Credit${selectedCustomer ? ` — ${selectedCustomer.name}` : ''}`
            : `Edit Opening Debit${selectedCustomer ? ` — ${selectedCustomer.name}` : ''}`
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-stone-600">
            Changing amount or date recalculates the customer balance and statement totals.
          </p>
          <Input
            label="Amount"
            type="number"
            min="0"
            step="0.01"
            value={editAmount}
            onChange={(e) => setEditAmount(e.target.value)}
          />
          <Input
            label="Date"
            type="date"
            value={editDate}
            onChange={(e) => setEditDate(e.target.value)}
          />
          <Input
            label="Description"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="Opening Balance"
          />
          {editEntryMutation.isError ? (
            <p className="text-sm text-red-600">
              {(editEntryMutation.error as any)?.response?.data?.detail ||
                (editEntryMutation.error as Error)?.message ||
                'Update failed'}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowEditModal(false)}>
              Cancel
            </Button>
            <Button
              className="bg-amber-700 hover:bg-amber-800"
              disabled={editEntryMutation.isPending || !(parseFloat(editAmount) > 0)}
              onClick={() => editEntryMutation.mutate()}
            >
              {editEntryMutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={deleteEntryId != null}
        onClose={() => setDeleteEntryId(null)}
        title="Delete ledger entry?"
      >
        <p className="text-sm text-gray-600 mb-4">
          This removes the entry and reverses its effect on the customer balance. This cannot be
          undone.
        </p>
        {deleteEntryMutation.isError ? (
          <p className="text-sm text-red-600 mb-3">
            {(deleteEntryMutation.error as any)?.response?.data?.detail || 'Delete failed'}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteEntryId(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={deleteEntryMutation.isPending || deleteEntryId == null}
            onClick={() => deleteEntryId != null && deleteEntryMutation.mutate(deleteEntryId)}
          >
            {deleteEntryMutation.isPending ? 'Deleting…' : 'Delete'}
          </Button>
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
