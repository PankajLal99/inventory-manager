import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  Camera,
  ClipboardCopy,
  Columns3,
  FileText,
  Filter,
  Minus,
  Pencil,
  Plus,
  Printer,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { creditApi } from '../../lib/api';
import { dateStringWithCurrentTimeISO, formatNumber, getTodayDateString, toLocalDateString } from '../../lib/utils';
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
  compareLedgerStatementRows,
  formatCreditDate,
  formatCreditDateTime,
  formatCreditStatementDate,
} from './creditLedgerUtils';
import {
  docFooterFontPx,
  docFooterFontWeight,
  docHeaderFontPx,
  docHeaderFontWeight,
  docPageBackground,
  docPdfFooterFontSize,
  docPdfFontFamily,
  docPdfHeaderFontSize,
  docPdfRowFontSize,
  docPdfSubHeaderFontSize,
  docRowBackground,
  docRowFontPx,
  docSubHeaderFontPx,
  docSubHeaderFontWeight,
  getLedgerTheme,
  hexToRgb,
  useCreditDocThemes,
} from './creditDocTheme';
import {
  copyPngBlobToClipboard,
  buildCreditLedgerSnapshotBlobs,
} from './creditDocumentClipboard';
import {
  chunkLedgerRowsForExport,
  ledgerSnapshotPageCount,
} from './creditLedgerSnapshot';
import {
  LEDGER_EXPORT_DAY_PRESETS,
  LEDGER_EXPORT_ROW_PRESETS,
  ledgerExportSplitBadge,
  loadLedgerExportSplit,
  saveLedgerExportSplit,
  type LedgerExportSplit,
} from './ledgerExportSettings';
import {
  peekPendingLedgerClipboardImage,
  setPendingLedgerClipboardImage,
  takePendingLedgerClipboardImage,
} from './pendingLedgerClipboard';
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

function formatPdfDate(value?: string | null) {
  return formatCreditDate(value);
}

/** Statement / table date columns: DD/MM/YYYY (+ time when present). */
function formatPdfDateShort(value?: string | null) {
  return formatCreditStatementDate(value);
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
    const pdfBlob =
      blob.type === 'application/pdf'
        ? blob
        : new Blob([blob], { type: 'application/pdf' });

    // Chromium often requires a Promise for non-text clipboard MIME types
    try {
      await navigator.clipboard.write([
        new (window as any).ClipboardItem({
          'application/pdf': Promise.resolve(pdfBlob),
        }),
      ]);
      return true;
    } catch {
      await navigator.clipboard.write([
        new (window as any).ClipboardItem({
          'application/pdf': pdfBlob,
        }),
      ]);
      return true;
    }
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
  const [showCopySettings, setShowCopySettings] = useState(false);
  const [columnVisibility, setColumnVisibility] =
    useState<Record<LedgerColumnId, boolean>>(loadColumnVisibility);
  const [search, setSearch] = useState('');
  const { ledger: ledgerTheme } = useCreditDocThemes();

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
  const [showLedgerImageBanner, setShowLedgerImageBanner] = useState(false);
  const [copyingLedgerImage, setCopyingLedgerImage] = useState(false);
  const [exportSplit, setExportSplit] = useState<LedgerExportSplit>(loadLedgerExportSplit);
  const [pictureCopied, setPictureCopied] = useState<boolean[]>([]);
  const [preparingPictures, setPreparingPictures] = useState(false);
  const canManage = canManageCreditRecords();
  const pictureCopyFrameRef = useRef<HTMLIFrameElement>(null);
  const pictureBlobsRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (searchParams.get('copy_ledger') === '1' && peekPendingLedgerClipboardImage()) {
      setShowLedgerImageBanner(true);
    }
  }, [searchParams, customerId]);

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
    // Latest datetime on top (descending)
    list.sort((a, b) => compareLedgerStatementRows(b, a));
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

  const oldestRow = rows.length ? rows[rows.length - 1] : undefined;
  const copyPageCount = ledgerSnapshotPageCount(rows, exportSplit);

  const persistExportSplit = (next: LedgerExportSplit) => {
    setExportSplit(saveLedgerExportSplit(next));
  };

  // Reset prepared images when statement / filters / split change
  useEffect(() => {
    pictureBlobsRef.current = [];
    setPictureCopied([]);
    setPreparingPictures(false);
  }, [rows, customerId, dateFrom, dateTo, txnType, exportSplit]);

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
    : oldestRow?.created_at
      ? `on ${formatPdfDate(oldestRow.created_at)}`
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
      : oldestRow?.created_at
        ? formatPdfDateShort(oldestRow.created_at)
        : formatPdfDateShort(new Date().toISOString());

    // Brought-forward row only when filtering from a start date (avoids duplicating opening-balance entries on "All")
    if (dateFrom) {
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
    }

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
  }, [statement, rows, dateFrom, oldestRow]);

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

  const buildCreditLedgerPdf = (split: LedgerExportSplit = exportSplit) => {
    if (!selectedCustomer || !statement) return null;

    const theme = getLedgerTheme();
    const PDF_PRIMARY = hexToRgb(theme.primary);
    const PDF_SECONDARY = hexToRgb(theme.secondary);
    const PDF_HEAD = hexToRgb(theme.tableHead);
    const PDF_BORDER = hexToRgb(theme.primaryBorder);
    const PDF_MUTED = hexToRgb(theme.textMuted);
    const PDF_INK = hexToRgb(theme.text);
    const PDF_DEBIT_BG = hexToRgb(theme.debitBg);
    const PDF_CREDIT_BG = hexToRgb(theme.creditBg);
    const PDF_GREEN = hexToRgb(theme.creditText);
    const PDF_RED = hexToRgb(theme.debitText);

    const PDF_PAGE = hexToRgb(docPageBackground(theme));
    const pdfFont = docPdfFontFamily(theme);
    const pdfHeaderSize = docPdfHeaderFontSize(theme);
    const pdfSubSize = docPdfSubHeaderFontSize(theme);
    const pdfBodySize = docPdfRowFontSize(theme);
    const pdfFooterSize = docPdfFooterFontSize(theme);
    const pdfRowWeight = theme.rowFontBold ? 'bold' : 'normal';
    const pdfHeaderWeight = theme.headerFontBold ? 'bold' : 'normal';
    const pdfSubWeight = theme.subHeaderFontBold ? 'bold' : 'normal';
    const pdfFooterWeight = theme.footerFontBold ? 'bold' : 'normal';

    const themeColorToPdfRgb = (
      color: string,
      fallback: [number, number, number]
    ): [number, number, number] => {
      const c = color.trim().toLowerCase();
      if (!c || c === 'transparent') return fallback;
      return hexToRgb(c);
    };

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
      : oldestRow?.created_at
        ? `on ${formatPdfDate(oldestRow.created_at)}`
        : '';

    // Top brand bar — ledger chrome color
    doc.setFillColor(...PDF_PRIMARY);
    doc.rect(0, 0, pageWidth, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont(pdfFont, pdfHeaderWeight);
    doc.setFontSize(pdfHeaderSize);
    doc.text('Manish Traders', marginX, 5.4);
    doc.setFont(pdfFont, pdfSubWeight);
    doc.setFontSize(pdfSubSize);
    doc.text('Credit Ledger', pageWidth - marginX, 5.4, { align: 'right' });

    // Title — tight
    let y = 14;
    doc.setTextColor(...PDF_SECONDARY);
    doc.setFont(pdfFont, pdfHeaderWeight);
    doc.setFontSize(pdfHeaderSize);
    doc.text(`${customerName} Statement`, pageWidth / 2, y, { align: 'center' });
    y += 4.5;
    doc.setFont(pdfFont, pdfSubWeight);
    doc.setFontSize(pdfSubSize);
    doc.setTextColor(...PDF_MUTED);
    doc.text(`(${periodLabel})`, pageWidth / 2, y, { align: 'center' });

    // Summary strip — shorter (white card, themed border)
    y += 4;
    const boxH = 16;
    doc.setDrawColor(...PDF_BORDER);
    doc.setFillColor(...PDF_PAGE);
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
      doc.setFont(pdfFont, pdfSubWeight);
      doc.setFontSize(pdfSubSize * 0.85);
      doc.setTextColor(...PDF_MUTED);
      doc.text(card.label, x + 2.5, y + 4.5);
      doc.setFont(pdfFont, pdfSubWeight);
      doc.setFontSize(pdfSubSize);
      doc.setTextColor(...card.color);
      doc.text(card.value, x + 2.5, y + 9.5, { maxWidth: colW - 5 });
      if (card.sub) {
        doc.setFont(pdfFont, pdfFooterWeight);
        doc.setFontSize(pdfFooterSize);
        doc.setTextColor(...(i === 3 ? card.color : PDF_MUTED));
        doc.text(card.sub, x + 2.5, y + 13.5, { maxWidth: colW - 5 });
      }
    });

    y += boxH + 4;
    doc.setTextColor(...PDF_INK);
    doc.setFont(pdfFont, pdfSubWeight);
    doc.setFontSize(pdfSubSize);
    const entriesSuffix = dateFrom || dateTo ? '(Date Range)' : '(All)';
    doc.text(`No. of Entries: ${rows.length} ${entriesSuffix}`, marginX, y);
    y += 1.5;

    const allTableRows = buildStatementRows();
    const openingRows = allTableRows.filter((r) => r.isOpening);
    const totalRows = allTableRows.filter((r) => r.isTotal);
    const bodyRows = allTableRows.filter((r) => !r.isOpening && !r.isTotal);
    const rowChunks = chunkLedgerRowsForExport(
      bodyRows.map((r) => ({ ...r, created_at: r.rawDate })),
      split
    );
    const cols = visibleColumns.length ? visibleColumns : LEDGER_COLUMN_DEFS.filter((c) => c.defaultOn);
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

    const paintTopBar = () => {
      doc.setFillColor(...PDF_PRIMARY);
      doc.rect(0, 0, pageWidth, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont(pdfFont, pdfHeaderWeight);
      doc.setFontSize(pdfHeaderSize);
      doc.text('Manish Traders', marginX, 5.4);
      doc.setFont(pdfFont, pdfSubWeight);
      doc.setFontSize(pdfSubSize);
      doc.text('Credit Ledger', pageWidth - marginX, 5.4, { align: 'right' });
    };

    const paintBottomBar = () => {
      doc.setFillColor(...PDF_PRIMARY);
      doc.rect(0, pageHeight - 8, pageWidth, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont(pdfFont, pdfFooterWeight);
      doc.setFontSize(pdfFooterSize);
      doc.text('Manish Traders', marginX, pageHeight - 3);
      doc.text('Credit Ledger', pageWidth - marginX, pageHeight - 3, { align: 'right' });
    };

    const chunkPeriod = (chunk: typeof bodyRows) => {
      if (!chunk.length) return periodLabel;
      const newest = chunk[0].rawDate;
      const oldest = chunk[chunk.length - 1].rawDate;
      const from = formatPdfDate(oldest);
      const to = formatPdfDate(newest);
      if (!from || from === to) return to || periodLabel;
      return `${from} - ${to}`;
    };

    rowChunks.forEach((chunk, chunkIdx) => {
      const tableRows = [
        ...(chunkIdx === 0 ? openingRows : []),
        ...chunk,
        ...(chunkIdx === rowChunks.length - 1 ? totalRows : []),
      ];
      const body = tableRows.map((r) => cols.map((c) => cellValue(r, c.id)));

      if (chunkIdx > 0) {
        doc.addPage();
        paintTopBar();
        let continuedY = 14;
        doc.setTextColor(...PDF_SECONDARY);
        doc.setFont(pdfFont, pdfHeaderWeight);
        doc.setFontSize(pdfHeaderSize);
        doc.text(`${customerName} Statement`, pageWidth / 2, continuedY, { align: 'center' });
        continuedY += 4.5;
        doc.setFont(pdfFont, pdfSubWeight);
        doc.setFontSize(pdfSubSize);
        doc.setTextColor(...PDF_MUTED);
        doc.text(`(${chunkPeriod(chunk)})`, pageWidth / 2, continuedY, { align: 'center' });
        continuedY += 5;
        doc.setTextColor(...PDF_INK);
        doc.text('Entries continued…', marginX, continuedY);
        y = continuedY + 1.5;
      }

      autoTable(doc, {
        startY: y,
        head: [cols.map((c) => c.label)],
        body,
        styles: {
          font: pdfFont,
          fontSize: pdfBodySize,
          cellPadding: { top: 1.2, right: 2, bottom: 1.2, left: 2 },
          lineColor: PDF_BORDER,
          lineWidth: 0.1,
          textColor: PDF_INK,
          valign: 'middle',
          minCellHeight: 5,
          fontStyle: pdfRowWeight,
        },
        headStyles: {
          fillColor: PDF_HEAD,
          textColor: PDF_INK,
          fontStyle: pdfSubWeight,
          fontSize: pdfSubSize,
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

          let rowBg = themeColorToPdfRgb(docRowBackground(theme, data.row.index), PDF_PAGE);
          if (rowMeta.isTotal) rowBg = PDF_HEAD;
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
          } else if (rowMeta.isTotal) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.textColor = PDF_SECONDARY;
          } else if (theme.rowFontBold) {
            data.cell.styles.fontStyle = 'bold';
          } else {
            data.cell.styles.fontStyle = 'normal';
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

      y = ((doc as any).lastAutoTable?.finalY || y) + 4;
    });

    const finalY = ((doc as any).lastAutoTable?.finalY || y) + 4;
    const pageCount = (doc as any).internal.getNumberOfPages?.() || 1;
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      if (p === pageCount) {
        doc.setFont(pdfFont, pdfFooterWeight);
        doc.setFontSize(pdfFooterSize);
        doc.setTextColor(...PDF_MUTED);
        doc.text(
          `Report Generated : ${formatCreditDateTime(new Date())}`,
          marginX,
          Math.min(finalY, pageHeight - 12)
        );
      }
      doc.setFont(pdfFont, pdfFooterWeight);
      doc.setFontSize(pdfFooterSize);
      doc.setTextColor(...PDF_MUTED);
      doc.text(`Page ${p} of ${pageCount}`, pageWidth - marginX, pageHeight - 12, {
        align: 'right',
      });
      paintBottomBar();
    }

    const safeName = customerName.replace(/[^\w\-]+/g, '_').replace(/_+/g, '_');
    const fileName = `credit_ledger_${safeName}_${getTodayDateString()}.pdf`;
    return { doc, fileName };
  };

  const exportPDF = (split: LedgerExportSplit = exportSplit) => {
    const built = buildCreditLedgerPdf(split);
    if (!built) return;
    built.doc.save(built.fileName);
  };

  const clearCopyLedgerParam = () => {
    const params = new URLSearchParams(searchParams);
    if (!params.has('copy_ledger')) return;
    params.delete('copy_ledger');
    const query = params.toString();
    navigate(query ? `/credit-ledger/${customerId}?${query}` : `/credit-ledger/${customerId}`, {
      replace: true,
    });
  };

  const copyQueuedLedgerImage = async () => {
    setCopyingLedgerImage(true);
    try {
      const blob = takePendingLedgerClipboardImage();
      if (!blob) {
        toast('Ledger image expired — use Copy Picture instead', 'error');
        setShowLedgerImageBanner(false);
        clearCopyLedgerParam();
        return;
      }
      if (!(await copyPngBlobToClipboard(blob))) {
        setPendingLedgerClipboardImage(blob);
        toast('Could not copy ledger image', 'error');
        return;
      }
      setShowLedgerImageBanner(false);
      clearCopyLedgerParam();
      toast('Ledger image copied (2/2) — paste as second image in WhatsApp', 'success');
    } finally {
      setCopyingLedgerImage(false);
    }
  };

  const markPictureCopied = (index: number) => {
    setPictureCopied((prev) => {
      const next = prev.slice();
      next[index] = true;
      return next;
    });
  };

  const copyPreparedPicturePage = async (index: number) => {
    const blob = pictureBlobsRef.current[index];
    const total = pictureBlobsRef.current.length;
    if (!blob) {
      toast('That image is not ready yet', 'error');
      return;
    }
    setCopyingLedgerImage(true);
    try {
      window.getSelection()?.removeAllRanges();
      if (!(await copyPngBlobToClipboard(blob))) {
        toast('Could not copy picture. Check clipboard permissions.', 'error');
        return;
      }
      markPictureCopied(index);
      toast(
        total > 1
          ? `Image ${index + 1} of ${total} copied — paste in WhatsApp, then copy the next image`
          : 'Ledger picture copied — paste in WhatsApp',
        'success'
      );
    } finally {
      setCopyingLedgerImage(false);
    }
  };

  const nextUncopiedPictureIndex = () => pictureCopied.findIndex((done) => !done);

  const copyLedgerPicture = async (split: LedgerExportSplit = exportSplit) => {
    if (!statement) {
      toast('Ledger not ready yet', 'error');
      return;
    }
    const iframe = pictureCopyFrameRef.current;
    if (!iframe) {
      toast('Picture preview not ready. Try again.', 'error');
      return;
    }

    const readyNext = nextUncopiedPictureIndex();
    if (pictureBlobsRef.current.length > 0 && readyNext >= 0) {
      await copyPreparedPicturePage(readyNext);
      return;
    }
    if (pictureBlobsRef.current.length > 0 && readyNext < 0) {
      await copyPreparedPicturePage(0);
      return;
    }

    setCopyingLedgerImage(true);
    setPreparingPictures(true);
    try {
      window.getSelection()?.removeAllRanges();
      const blobs = await buildCreditLedgerSnapshotBlobs(
        iframe,
        {
          ...statement,
          rows,
        },
        split
      );
      if (!blobs.length) {
        toast('Could not create ledger picture', 'error');
        return;
      }

      pictureBlobsRef.current = blobs;
      setPictureCopied(blobs.map((_, i) => i === 0));

      if (!(await copyPngBlobToClipboard(blobs[0]))) {
        setPictureCopied(blobs.map(() => false));
        toast('Could not copy picture. Check clipboard permissions.', 'error');
        return;
      }

      toast(
        blobs.length > 1
          ? `Image 1 of ${blobs.length} copied. Use Copy 2 … Copy ${blobs.length} for each next image.`
          : 'Ledger picture copied — paste in WhatsApp',
        'success'
      );
    } catch (e: any) {
      pictureBlobsRef.current = [];
      setPictureCopied([]);
      toast(e?.message || 'Failed to copy picture', 'error');
    } finally {
      setPreparingPictures(false);
      setCopyingLedgerImage(false);
    }
  };

  const copiedPictureCount = pictureCopied.filter(Boolean).length;
  const nextPicturePart = nextUncopiedPictureIndex();
  const picturePageButtons =
    pictureCopied.length > 1 ? (
      <div className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="text-sm text-amber-950 font-medium">
            {copiedPictureCount}/{pictureCopied.length} images copied. Each button copies a new
            WhatsApp image.
          </div>
          <button
            type="button"
            className="shrink-0 text-xs font-semibold text-amber-900 underline"
            onClick={() => setShowCopySettings(true)}
          >
            Change split
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {pictureCopied.map((done, i) => (
            <button
              key={i}
              type="button"
              disabled={copyingLedgerImage}
              onClick={() => void copyPreparedPicturePage(i)}
              className={`min-w-[2.75rem] rounded-md border px-2 py-1.5 text-xs font-semibold ${
                done
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-amber-800 bg-amber-800 text-white hover:bg-amber-900'
              }`}
              title={done ? `Copy image ${i + 1} again` : `Copy image ${i + 1} of ${pictureCopied.length}`}
            >
              {done ? `✓ ${i + 1}` : `Copy ${i + 1}`}
            </button>
          ))}
        </div>
      </div>
    ) : null;
  const pictureButtonLabel = copyingLedgerImage
    ? preparingPictures
      ? `Preparing ${Math.max(pictureCopied.length, 1)} images…`
      : 'Copying…'
    : pictureCopied.length > 1 && nextPicturePart >= 0
      ? `Copy ${nextPicturePart + 1}/${pictureCopied.length}`
      : pictureCopied.length > 1
        ? 'Copy again'
        : 'Copy Picture';

  const copyPDF = async (split: LedgerExportSplit = exportSplit) => {
    const built = buildCreditLedgerPdf(split);
    if (!built) return;

    setCopyingPdf(true);
    try {
      window.getSelection()?.removeAllRanges();

      const pdfBlob = built.doc.output('blob');
      // PDF only — no share sheet, no image fallback
      if (await copyPdfBlobToClipboard(pdfBlob)) {
        toast('PDF copied to clipboard', 'success');
        return;
      }

      // Most browsers block PDF clipboard; download so you still get a PDF file
      built.doc.save(built.fileName);
      toast(
        'This browser can’t copy PDF to clipboard — PDF downloaded instead',
        'info'
      );
    } catch (e: any) {
      toast(e?.message || 'Failed to copy PDF', 'error');
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
      {showLedgerImageBanner ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-sm text-amber-950">
            <span className="font-semibold">Image 1 (invoice/return)</span> is on your clipboard.
            Paste it in WhatsApp, then copy the ledger as a <span className="font-semibold">separate</span> image 2.
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                takePendingLedgerClipboardImage();
                setShowLedgerImageBanner(false);
                clearCopyLedgerParam();
              }}
            >
              Dismiss
            </Button>
            <Button
              size="sm"
              className="bg-amber-600 hover:bg-amber-700"
              disabled={copyingLedgerImage}
              onClick={() => void copyQueuedLedgerImage()}
            >
              {copyingLedgerImage ? 'Copying…' : 'Copy ledger (2/2)'}
            </Button>
          </div>
        </div>
      ) : null}

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
              <Button variant="outline" size="sm" onClick={() => exportPDF()}>
                <FileText className="h-4 w-4 mr-1.5" />
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyLedgerPicture()}
                disabled={copyingLedgerImage}
                title="Copy ledger picture to clipboard for WhatsApp"
              >
                <Camera className="h-4 w-4 mr-1.5" />
                {pictureButtonLabel}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyPDF()}
                disabled={copyingPdf}
                title="Copy ledger PDF to clipboard"
              >
                <ClipboardCopy className="h-4 w-4 mr-1.5" />
                {copyingPdf ? 'Copying…' : 'Copy PDF'}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {picturePageButtons}

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
                onClick={() => {
                  setShowCopySettings(false);
                  setShowColumnSettings((v) => !v);
                }}
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
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowColumnSettings(false);
                  setShowCopySettings((v) => !v);
                }}
                className="flex items-center gap-2"
                title="Copy / PDF page split"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Copy settings
                <span className="bg-amber-800 text-white rounded-full min-w-[1.25rem] h-5 px-1.5 flex items-center justify-center text-xs">
                  {ledgerExportSplitBadge(exportSplit)}
                </span>
              </Button>
              {showCopySettings ? (
                <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-stone-200 bg-white shadow-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold text-stone-800">Copy / PDF pages</div>
                    <button
                      type="button"
                      className="text-stone-400 hover:text-stone-600"
                      onClick={() => setShowCopySettings(false)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-xs text-stone-500 mb-2">
                    Saved on this device. Copy Picture uses these settings immediately.
                  </p>
                  <label className="flex items-center gap-2 text-sm text-stone-800 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-stone-300 text-amber-700 focus:ring-amber-600"
                      checked={exportSplit.useRows}
                      onChange={() =>
                        persistExportSplit({
                          ...exportSplit,
                          useRows: !exportSplit.useRows,
                          useDays: exportSplit.useDays || exportSplit.useRows,
                        })
                      }
                    />
                    Split by rows
                  </label>
                  {exportSplit.useRows ? (
                    <div className="mt-1.5 mb-2">
                      <Input
                        type="number"
                        min={1}
                        max={200}
                        value={String(exportSplit.rowsPerPage)}
                        onChange={(e) =>
                          persistExportSplit({
                            ...exportSplit,
                            rowsPerPage: Number(e.target.value) || 1,
                          })
                        }
                        className="h-8 py-1 text-sm"
                      />
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {LEDGER_EXPORT_ROW_PRESETS.map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() =>
                              persistExportSplit({ ...exportSplit, useRows: true, rowsPerPage: n })
                            }
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                              exportSplit.rowsPerPage === n
                                ? 'border-amber-800 bg-amber-800 text-white'
                                : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <label className="flex items-center gap-2 text-sm text-stone-800 cursor-pointer mt-2">
                    <input
                      type="checkbox"
                      className="rounded border-stone-300 text-amber-700 focus:ring-amber-600"
                      checked={exportSplit.useDays}
                      onChange={() =>
                        persistExportSplit({
                          ...exportSplit,
                          useDays: !exportSplit.useDays,
                          useRows: exportSplit.useRows || exportSplit.useDays,
                        })
                      }
                    />
                    Split by days
                  </label>
                  {exportSplit.useDays ? (
                    <div className="mt-1.5">
                      <Input
                        type="number"
                        min={1}
                        max={366}
                        value={String(exportSplit.daysPerPage)}
                        onChange={(e) =>
                          persistExportSplit({
                            ...exportSplit,
                            daysPerPage: Number(e.target.value) || 1,
                          })
                        }
                        className="h-8 py-1 text-sm"
                      />
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {LEDGER_EXPORT_DAY_PRESETS.map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() =>
                              persistExportSplit({ ...exportSplit, useDays: true, daysPerPage: n })
                            }
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                              exportSplit.daysPerPage === n
                                ? 'border-amber-800 bg-amber-800 text-white'
                                : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                            }`}
                          >
                            {n}d
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-3 pt-2 border-t border-stone-100 text-xs text-stone-600">
                    {copyPageCount === 1
                      ? '1 image / PDF section'
                      : `${copyPageCount} images — Copy 1 … Copy ${copyPageCount}`}
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
          <div
            className="border-[3px] overflow-hidden"
            style={{
              borderColor: ledgerTheme.primary,
              background: docPageBackground(ledgerTheme),
            }}
          >
            <div
              className="text-white px-4 py-2 flex items-center justify-between"
              style={{ background: ledgerTheme.primary }}
            >
              <div
                style={{
                  fontSize: docHeaderFontPx(ledgerTheme),
                  fontWeight: docHeaderFontWeight(ledgerTheme),
                }}
              >
                Manish Traders
              </div>
              <div
                style={{
                  fontSize: docSubHeaderFontPx(ledgerTheme),
                  fontWeight: docSubHeaderFontWeight(ledgerTheme),
                }}
              >
                Credit Ledger
              </div>
            </div>

            <div
              className="px-4 py-4 sm:px-5"
              style={{
                background: docPageBackground(ledgerTheme),
                fontFamily: ledgerTheme.fontFamily,
              }}
            >
              <div className="text-center">
                <div
                  style={{
                    color: ledgerTheme.secondary,
                    fontSize: docHeaderFontPx(ledgerTheme),
                    fontWeight: docHeaderFontWeight(ledgerTheme),
                  }}
                >
                  {customerDisplayName} Statement
                </div>
                <div
                  className="mt-0.5"
                  style={{
                    color: ledgerTheme.textMuted,
                    fontSize: docSubHeaderFontPx(ledgerTheme),
                    fontWeight: docSubHeaderFontWeight(ledgerTheme),
                  }}
                >
                  ({periodLabel})
                </div>
              </div>

              <div
                className="mt-3 grid grid-cols-2 lg:grid-cols-4 rounded overflow-hidden"
                style={{
                  border: `1px solid ${ledgerTheme.primaryBorder}`,
                  background: docPageBackground(ledgerTheme),
                }}
              >
                <div
                  className="px-3 py-2.5 border-b lg:border-b-0 lg:border-r"
                  style={{ borderColor: ledgerTheme.primaryBorder }}
                >
                  <div
                    style={{
                      color: ledgerTheme.textMuted,
                      fontSize: docSubHeaderFontPx(ledgerTheme),
                      fontWeight: docSubHeaderFontWeight(ledgerTheme),
                    }}
                  >
                    Opening Balance
                  </div>
                  <div
                    className="mt-0.5 tabular-nums"
                    style={{
                      color: ledgerTheme.text,
                      fontSize: docSubHeaderFontPx(ledgerTheme),
                      fontWeight: docSubHeaderFontWeight(ledgerTheme),
                    }}
                  >
                    Rs. {formatPdfAmount(statement?.opening_balance)}
                  </div>
                  {openingOnLabel ? (
                    <div
                      className="mt-0.5"
                      style={{
                        color: ledgerTheme.textMuted,
                        fontSize: docFooterFontPx(ledgerTheme),
                        fontWeight: docFooterFontWeight(ledgerTheme),
                      }}
                    >
                      {openingOnLabel}
                    </div>
                  ) : null}
                </div>
                <div
                  className="px-3 py-2.5 border-b lg:border-b-0 lg:border-r"
                  style={{ borderColor: ledgerTheme.primaryBorder }}
                >
                  <div
                    style={{
                      color: ledgerTheme.textMuted,
                      fontSize: docSubHeaderFontPx(ledgerTheme),
                      fontWeight: docSubHeaderFontWeight(ledgerTheme),
                    }}
                  >
                    Total Debit(-)
                  </div>
                  <div
                    className="mt-0.5 tabular-nums"
                    style={{
                      color: ledgerTheme.text,
                      fontSize: docSubHeaderFontPx(ledgerTheme),
                      fontWeight: docSubHeaderFontWeight(ledgerTheme),
                    }}
                  >
                    Rs. {formatPdfAmount(statement?.total_debit)}
                  </div>
                </div>
                <div
                  className="px-3 py-2.5 border-b sm:border-b-0 lg:border-r"
                  style={{ borderColor: ledgerTheme.primaryBorder }}
                >
                  <div
                    style={{
                      color: ledgerTheme.textMuted,
                      fontSize: docSubHeaderFontPx(ledgerTheme),
                      fontWeight: docSubHeaderFontWeight(ledgerTheme),
                    }}
                  >
                    Total Credit(+)
                  </div>
                  <div
                    className="mt-0.5 tabular-nums"
                    style={{
                      color: ledgerTheme.text,
                      fontSize: docSubHeaderFontPx(ledgerTheme),
                      fontWeight: docSubHeaderFontWeight(ledgerTheme),
                    }}
                  >
                    Rs. {formatPdfAmount(statement?.total_credit)}
                  </div>
                </div>
                <div className="px-3 py-2.5">
                  <div
                    style={{
                      color: ledgerTheme.textMuted,
                      fontSize: docSubHeaderFontPx(ledgerTheme),
                      fontWeight: docSubHeaderFontWeight(ledgerTheme),
                    }}
                  >
                    Net Balance
                  </div>
                  <div
                    className="mt-0.5 tabular-nums"
                    style={{
                      color: netIsCr ? ledgerTheme.creditText : ledgerTheme.debitText,
                      fontSize: docSubHeaderFontPx(ledgerTheme),
                      fontWeight: docSubHeaderFontWeight(ledgerTheme),
                    }}
                  >
                    Rs. {formatPdfAmount(closingBalance)} {netIsCr ? 'Cr' : 'Dr'}
                  </div>
                  <div
                    className="mt-0.5"
                    style={{
                      color: netIsCr ? ledgerTheme.creditText : ledgerTheme.debitText,
                      fontSize: docFooterFontPx(ledgerTheme),
                      fontWeight: docFooterFontWeight(ledgerTheme),
                    }}
                  >
                    {netHint}
                  </div>
                </div>
              </div>

              <div
                className="mt-3"
                style={{
                  color: ledgerTheme.secondary,
                  fontSize: docSubHeaderFontPx(ledgerTheme),
                  fontWeight: docSubHeaderFontWeight(ledgerTheme),
                }}
              >
                No. of Entries: {rows.length} {entriesSuffix}
              </div>

              <div
                className="mt-1.5 overflow-x-auto rounded"
                style={{
                  border: `1px solid ${ledgerTheme.primaryBorder}`,
                  background: docPageBackground(ledgerTheme),
                }}
              >
                <table
                  className="min-w-full border-collapse"
                  style={{
                    fontFamily: ledgerTheme.fontFamily,
                    fontSize: docRowFontPx(ledgerTheme),
                  }}
                >
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
                            ? ledgerTheme.debitBg
                            : col.id === 'credit'
                              ? ledgerTheme.creditBg
                              : ledgerTheme.tableHead;
                        return (
                          <th
                            key={col.id}
                            className={`${align} px-2.5 py-1.5 whitespace-nowrap`}
                            style={{
                              color: ledgerTheme.secondary,
                              background: bg,
                              border: `1px solid ${ledgerTheme.primaryBorder}`,
                              fontSize: docSubHeaderFontPx(ledgerTheme),
                              fontWeight: docSubHeaderFontWeight(ledgerTheme),
                            }}
                          >
                            {col.label}
                          </th>
                        );
                      })}
                      {canManage ? (
                        <th
                          className="px-2 py-1.5 w-16"
                          style={{
                            color: ledgerTheme.secondary,
                            background: ledgerTheme.tableHead,
                            border: `1px solid ${ledgerTheme.primaryBorder}`,
                            fontSize: docSubHeaderFontPx(ledgerTheme),
                            fontWeight: docSubHeaderFontWeight(ledgerTheme),
                          }}
                        />
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
                                    className={`px-2.5 py-1.5 font-bold ${align} ${
                                      col.id === 'balance' ? 'text-stone-500' : 'text-stone-900'
                                    }`}
                                    style={{ border: `1px solid ${ledgerTheme.primaryBorder}` }}
                                  >
                                    {cellValue(r, col.id)}
                                  </td>
                                );
                              })}
                              {canManage ? (
                                <td style={{ border: `1px solid ${ledgerTheme.primaryBorder}` }} />
                              ) : null}
                            </tr>
                          ))}
                        <tr>
                          <td
                            colSpan={Math.max(visibleColumns.length, 1) + (canManage ? 1 : 0)}
                            className="px-2.5 py-6 text-center text-stone-400"
                            style={{ border: `1px solid ${ledgerTheme.primaryBorder}` }}
                          >
                            No entries in this period.
                          </td>
                        </tr>
                        {statementRows
                          .filter((r) => r.isTotal)
                          .map((r, i) => (
                            <tr
                              key={`total-${i}`}
                              className="font-bold"
                              style={{ background: ledgerTheme.tableHead }}
                            >
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
                                    className={`px-2.5 py-1.5 tabular-nums ${align} ${bg} ${
                                      col.id === 'balance' ? balColor : ''
                                    }`}
                                    style={{
                                      border: `1px solid ${ledgerTheme.primaryBorder}`,
                                      color: col.id === 'balance' ? undefined : ledgerTheme.secondary,
                                    }}
                                  >
                                    {cellValue(r, col.id)}
                                  </td>
                                );
                              })}
                              {canManage ? (
                                <td style={{ border: `1px solid ${ledgerTheme.primaryBorder}` }} />
                              ) : null}
                            </tr>
                          ))}
                      </>
                    ) : (
                      statementRows.map((r, idx) => {
                        const balCr = /cr/i.test(r.balance);
                        const balColor = r.isOpening
                          ? ledgerTheme.textMuted
                          : balCr
                            ? ledgerTheme.creditText
                            : ledgerTheme.debitText;
                        const rowBg = r.isTotal
                          ? ledgerTheme.tableHead
                          : docRowBackground(ledgerTheme, idx);
                        const rowWeight =
                          r.isTotal || r.isOpening || ledgerTheme.rowFontBold
                            ? 700
                            : 500;

                        return (
                          <tr
                            key={idx}
                            style={{ background: rowBg }}
                          >
                            {visibleColumns.map((col) => {
                              const align =
                                col.align === 'right'
                                  ? 'text-right'
                                  : col.align === 'center'
                                    ? 'text-center'
                                    : 'text-left';
                              let cellBg = rowBg;
                              let color = ledgerTheme.text;
                              let fw = rowWeight;
                              if (col.id === 'debit' && (r.hasDebit || r.isTotal)) {
                                cellBg = ledgerTheme.debitBg;
                              }
                              if (col.id === 'credit' && (r.hasCredit || r.isTotal)) {
                                cellBg = ledgerTheme.creditBg;
                              }
                              if (col.id === 'balance') {
                                fw = 700;
                                color = balColor;
                                if (r.hasCredit && !r.isOpening && !r.isTotal) {
                                  cellBg = ledgerTheme.creditBg;
                                } else if (r.isTotal) {
                                  cellBg = ledgerTheme.tableHead;
                                }
                              }
                              if (col.id === 'type') {
                                if (r.type === 'sale') color = ledgerTheme.debitText;
                                else if (r.type === 'payment') color = ledgerTheme.creditText;
                                else if (r.type === 'return') color = '#1d4ed8';
                              }
                              if (
                                (col.id === 'date' || col.id === 'particulars') &&
                                (r.isOpening || r.isTotal)
                              ) {
                                fw = 700;
                              }
                              return (
                                <td
                                  key={col.id}
                                  className={`px-2.5 py-1 tabular-nums ${align} ${
                                    col.id === 'date' || col.id === 'vch' ? 'whitespace-nowrap' : ''
                                  } ${col.id === 'type' && r.type ? 'capitalize' : ''}`}
                                  style={{
                                    border: `1px solid ${ledgerTheme.primaryBorder}`,
                                    background: cellBg,
                                    color,
                                    fontWeight: fw,
                                  }}
                                >
                                  {cellValue(r, col.id)}
                                </td>
                              );
                            })}
                            {canManage ? (
                              <td
                                className="px-1 py-1 text-center whitespace-nowrap"
                                style={{ border: `1px solid ${ledgerTheme.primaryBorder}` }}
                              >
                                {r.isManual && r.entryId ? (
                                  <div className="inline-flex items-center gap-0.5">
                                    <button
                                      type="button"
                                      className="p-1 rounded hover:opacity-80"
                                      style={{ color: ledgerTheme.secondary }}
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

              <div
                className="mt-2.5 flex flex-wrap justify-between gap-2"
                style={{
                  color: ledgerTheme.textMuted,
                  fontSize: docFooterFontPx(ledgerTheme),
                  fontWeight: docFooterFontWeight(ledgerTheme),
                }}
              >
                <div>Report Generated : {formatCreditDateTime(new Date())}</div>
                <div>Page 1 of 1</div>
              </div>
            </div>

            <div
              className="text-white px-4 py-2 flex items-center justify-between"
              style={{
                background: ledgerTheme.primary,
                fontSize: docFooterFontPx(ledgerTheme),
                fontWeight: docFooterFontWeight(ledgerTheme),
              }}
            >
              <div>Manish Traders</div>
              <div>Credit Ledger</div>
            </div>

            <div
              className="px-4 py-2.5 border-t flex flex-col gap-2 bg-white"
              style={{ borderColor: ledgerTheme.primaryBorder }}
            >
              {picturePageButtons}
              <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyLedgerPicture()}
                disabled={copyingLedgerImage}
                title="Copy ledger picture to clipboard for WhatsApp"
              >
                <Camera className="h-4 w-4 mr-1" />
                {pictureButtonLabel}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyPDF()}
                disabled={copyingPdf}
                title="Copy ledger PDF to clipboard"
              >
                <ClipboardCopy className="h-4 w-4 mr-1" />
                {copyingPdf ? 'Copying…' : 'Copy PDF'}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => exportPDF()}>
                <Printer className="h-4 w-4 mr-1" />
                Download PDF
              </Button>
              </div>
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
        ref={pictureCopyFrameRef}
        title="credit-ledger-picture-copy"
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
