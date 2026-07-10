import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useRef, Fragment, useMemo } from 'react';
import { posApi, productsApi, catalogApi, customersApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import { formatNumber, formatAmountINR, getProductNameColor } from '../../lib/utils';
import { toast } from '../../lib/toast';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import {
  FileText,
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  User,
  Store,
  ShoppingBag,
  Coins,
  Printer,
  Download,
  Camera,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Pencil,
  Eye,
  EyeOff,
  Wrench,
  AlertTriangle,
  Package,
  BookOpen,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import RepairStatusModal from '../repair/RepairStatusModal';
import CartLineScannedTime from '../../components/pos/CartLineScannedTime';
import { addScannedBarcodeToInvoice } from '../../lib/scanningQueue';
import InvoiceTagEditor, { InvoiceTagChip } from '../../components/invoices/InvoiceTagEditor';
import type { InvoiceTag } from '../../lib/invoiceTags';

/** A4 width at 96dpi — fixed capture size for sharp images regardless of on-screen preview scale */
const INVOICE_CAPTURE_WIDTH_PX = 794;
const INVOICE_CAPTURE_HEIGHT_PX = 1123;
const INVOICE_SHOP_NAME = 'MANISH TRADERS';

/** Orange / amber theme — matches credit invoice print layout */
const INV_THEME = {
  primary: '#d97706',
  primaryPale: '#fffbeb',
  primaryBorder: '#fbbf24',
  secondary: '#78350f',
  secondaryMuted: '#92400e',
  text: '#1c1917',
  textMuted: '#57534e',
  white: '#ffffff',
  rowAlt: '#fff7ed',
  tableHead: '#fef3c7',
};

function invoiceCaptureScale(): number {
  return Math.min(4, Math.max(3, window.devicePixelRatio));
}

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function invoiceHeaderShapes(): string {
  return `
    <div style="position:absolute;top:-48px;left:48px;width:128px;height:128px;border-radius:50%;background:rgba(255,255,255,0.14);z-index:0;"></div>
    <div style="position:absolute;bottom:-36px;left:28%;width:72px;height:72px;border-radius:50%;background:rgba(251,191,36,0.5);z-index:0;"></div>
    <div style="position:absolute;bottom:8px;left:-18px;width:56px;height:56px;border-radius:12px;background:rgba(255,255,255,0.1);transform:rotate(-12deg);z-index:0;"></div>
  `;
}

function invoiceFooterShapes(): string {
  const T = INV_THEME;
  return `
    <div style="position:absolute;bottom:-20px;right:24px;width:64px;height:64px;border-radius:50%;background:${T.primaryBorder};opacity:0.35;"></div>
    <div style="position:absolute;top:16px;left:-12px;width:40px;height:40px;border-radius:10px;background:${T.primary};opacity:0.12;transform:rotate(20deg);"></div>
  `;
}

/** Plain-text line for on-screen invoice item rows */
function formatExchangeSnapshotNote(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const o = snapshot as Record<string, unknown>;
  const parts: string[] = [];
  if (o.old_product_name != null) parts.push(`Replaced: ${String(o.old_product_name)}`);
  if (o.old_barcode != null) parts.push(`old barcode ${String(o.old_barcode)}`);
  if (o.original_sale_unit_price != null) parts.push(`sold ₹${String(o.original_sale_unit_price)}`);
  if (o.charge_unit_price != null) parts.push(`charged ₹${String(o.charge_unit_price)}`);
  if (o.purchase_cost != null) parts.push(`cost ref ₹${String(o.purchase_cost)}`);
  return parts.join(' · ');
}

/** Small HTML block for A4 / print preview (description column) */
function formatExchangeSnapshotPrintHtml(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const o = snapshot as Record<string, unknown>;
  const bits: string[] = [];
  if (o.old_product_name != null) bits.push(`Replaced: ${escapeHtml(String(o.old_product_name))}`);
  if (o.old_barcode != null) bits.push(`old ${escapeHtml(String(o.old_barcode))}`);
  if (o.original_sale_unit_price != null) bits.push(`sold ₹${escapeHtml(String(o.original_sale_unit_price))}`);
  if (o.charge_unit_price != null) bits.push(`charged ₹${escapeHtml(String(o.charge_unit_price))}`);
  if (o.purchase_cost != null) bits.push(`cost ref ₹${escapeHtml(String(o.purchase_cost))}`);
  if (!bits.length) return '';
  return `<div style="font-size:10px;color:${INV_THEME.textMuted};margin-top:4px;line-height:1.35;font-weight:500;">${bits.join(' · ')}</div>`;
}

/** Replace-product metadata lives on the invoice (`exchange_snapshots`), keyed by line id */
function exchangeSnapshotForItem(inv: { exchange_snapshots?: unknown }, itemId: number): unknown {
  const rows = inv?.exchange_snapshots;
  if (!Array.isArray(rows)) return null;
  const match = rows.find((r: any) => Number(r?.invoice_item_id) === Number(itemId));
  return match ?? null;
}

function formatTradeInReturnTag(tag: unknown): string {
  if (tag == null || tag === '') return '—';
  const s = String(tag).toLowerCase();
  if (s === 'returned' || s === 'unknown' || s === 'defective') {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return String(tag);
}

function getInvoiceAdjustedTotalValue(invoice: any): number {
  const adjusted = invoice?.replacement_summary?.adjusted_total;
  if (adjusted !== undefined && adjusted !== null && adjusted !== '') {
    const n = parseFloat(String(adjusted));
    if (Number.isFinite(n)) return n;
  }
  const base = parseFloat(String(invoice?.total ?? '0'));
  return Number.isFinite(base) ? base : 0;
}

/** Extra summary detail lines for A4 print after trade-in total */
function buildTradeInDetailRowsA4Html(inv: { pos_trade_ins?: unknown }): string {
  const rows = inv?.pos_trade_ins;
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const T = INV_THEME;
  return rows
    .map((row: any) => {
      const product = row.product_name ? escapeHtml(String(row.product_name)) : '—';
      const bc = row.barcode ? escapeHtml(String(row.barcode)) : '—';
      const src = row.source_invoice_number ? escapeHtml(String(row.source_invoice_number)) : '—';
      const tag = row.return_tag ? escapeHtml(formatTradeInReturnTag(row.return_tag)) : '—';
      const orig =
        row.original_line_credit != null && String(row.original_line_credit) !== ''
          ? `₹${escapeHtml(String(row.original_line_credit))}`
          : '—';
      const cred =
        row.credit != null && String(row.credit) !== '' ? `₹${escapeHtml(String(row.credit))}` : '—';
      return `<div style="margin-top:8px;padding:8px 12px;background:#ecfdf5;border:1px solid #a7f3d0;border-left:3px solid #059669;font-size:10px;line-height:1.45;color:${T.text};">
        <strong style="color:#065f46;">Trade-in</strong> · ${product}${bc !== '—' ? ` · ${bc}` : ''}<br/>
        Prior invoice ${src} · ${tag}<br/>
        Original line ${orig} · Credit applied ${cred}
      </div>`;
    })
    .join('');
}

function buildTradeInDetailThermalHtml(invoice: { pos_trade_ins?: unknown }): string {
  const rows = invoice?.pos_trade_ins;
  if (!Array.isArray(rows) || rows.length === 0) return '';
  return rows
    .map((row: any) => {
      const product = row.product_name ? escapeHtml(String(row.product_name)) : 'Item';
      const bc = row.barcode ? escapeHtml(String(row.barcode)) : '';
      const src = row.source_invoice_number ? escapeHtml(String(row.source_invoice_number)) : '—';
      const tag = row.return_tag ? escapeHtml(formatTradeInReturnTag(row.return_tag)) : '—';
      const orig =
        row.original_line_credit != null && String(row.original_line_credit) !== ''
          ? ` orig ${escapeHtml(String(row.original_line_credit))}`
          : '';
      const cred =
        row.credit != null && String(row.credit) !== '' ? ` cr ${escapeHtml(String(row.credit))}` : '';
      const line = `${product}${bc ? ` / ${bc}` : ''} · ${src} · ${tag}${orig}${cred}`;
      return `<div style="font-size:8px;padding:3px 0;border-bottom:1px dotted #ccc;line-height:1.25;">${line}</div>`;
    })
    .join('');
}

export default function InvoiceDetail() {
  const user = auth.getUser();
  const userGroups = user?.groups || [];
  const isRestrictedUser = (userGroups.includes('Retail') || userGroups.includes('Wholesale')) &&
    !userGroups.includes('Admin') &&
    !userGroups.includes('RetailAdmin') &&
    !userGroups.includes('WholesaleAdmin');
  // Hide CASH / UPI / CASH+UPI in checkout modal for Wholesale, WholesaleAdmin, or user sunny
  const hideCheckoutPaymentOptions =
    userGroups.includes('Wholesale') ||
    userGroups.includes('WholesaleAdmin') ||
    user?.username === 'sunny' ||
    String(user?.id) === 'sunny';
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const invoicesListPath = (() => {
    const query = searchParams.toString();
    return query ? `/invoices?${query}` : '/invoices';
  })();
  const invoiceId = parseInt(id || '0');
  const queryClient = useQueryClient();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showRepairStatusModal, setShowRepairStatusModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showEditPaymentModal, setShowEditPaymentModal] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);
  const [editPaymentMethod, setEditPaymentMethod] = useState<'cash' | 'upi' | 'mixed'>('cash');
  const [editPaymentAmount, setEditPaymentAmount] = useState<string>('');
  const [editPaymentCashAmount, setEditPaymentCashAmount] = useState<string>('');
  const [editPaymentUpiAmount, setEditPaymentUpiAmount] = useState<string>('');
  const [editPaymentReference, setEditPaymentReference] = useState<string>('');
  const [editPaymentNotes, setEditPaymentNotes] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi' | 'mixed'>('cash');
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [paymentCashAmount, setPaymentCashAmount] = useState<string>('');
  const [paymentUpiAmount, setPaymentUpiAmount] = useState<string>('');
  const [paymentReference, setPaymentReference] = useState<string>('');
  const [paymentNotes, setPaymentNotes] = useState<string>('');
  const [deleteRestoreStock, setDeleteRestoreStock] = useState(true);
  const [checkoutInvoiceType, setCheckoutInvoiceType] = useState<'cash' | 'upi' | 'pending' | 'mixed' | 'credit'>('pending');
  const [checkoutCashAmount, setCheckoutCashAmount] = useState<string>('');
  const [checkoutUpiAmount, setCheckoutUpiAmount] = useState<string>('');
  const [checkoutQuantities, setCheckoutQuantities] = useState<Record<number, string>>({});
  const [checkoutPrices, setCheckoutPrices] = useState<Record<number, string>>({});
  const [parentGroupPrices, setParentGroupPrices] = useState<Record<string, string>>({});
  const [checkoutPriceErrors, setCheckoutPriceErrors] = useState<Record<string, string>>({});
  const [checkoutPurchasePrices, setCheckoutPurchasePrices] = useState<Record<number, string>>({});
  const [barcodeInput, setBarcodeInput] = useState('');
  const [debouncedBarcodeInput, setDebouncedBarcodeInput] = useState('');
  const [productSearchSelectedIndex, setProductSearchSelectedIndex] = useState(-1);
  const [isSearchTyped, setIsSearchTyped] = useState(false);
  const [editingPrice, setEditingPrice] = useState<Record<number, string>>({});
  const [showPriceInput, setShowPriceInput] = useState<Record<number, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedInvoiceItems, setExpandedInvoiceItems] = useState<Record<string, boolean>>({});
  const [editingInvoiceType, setEditingInvoiceType] = useState(false);
  const [editingStore, setEditingStore] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [selectedInvoiceType, setSelectedInvoiceType] = useState<string>('');
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState('');
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const customerDropdownRef = useRef<HTMLDivElement>(null);
  const invoicePreviewRef = useRef<HTMLIFrameElement>(null);
  const invoiceCaptureFrameRef = useRef<HTMLIFrameElement>(null);
  // Toggle to show/hide purchase price in checkout modal (default on = visible, blue)
  const [showPurchasePrice, setShowPurchasePrice] = useState(true);
  // Repair status in checkout modal (when invoice is repair)
  const [checkoutRepairStatus, setCheckoutRepairStatus] = useState<string>('');
  // Repair delivery date in checkout modal (from repair model, editable)
  const [checkoutDeliveryDate, setCheckoutDeliveryDate] = useState<string>('');
  const [showCustomProductModal, setShowCustomProductModal] = useState(false);
  const [customProductName, setCustomProductName] = useState('');
  // Replacement-return finalize modal state
  const [replSettlementType, setReplSettlementType] = useState<'cash' | 'upi' | 'mixed' | 'credit'>('cash');
  const [replCashAmount, setReplCashAmount] = useState('');
  const [replUpiAmount, setReplUpiAmount] = useState('');
  const [replReplacementDate, setReplReplacementDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Debounce customer search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedCustomerSearch(customerSearchQuery.trim()), 250);
    return () => clearTimeout(t);
  }, [customerSearchQuery]);

  // Close customer dropdown when clicking outside
  useEffect(() => {
    if (!editingCustomer || !customerDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(e.target as Node)) {
        setCustomerDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [editingCustomer, customerDropdownOpen]);

  const { data: invoice, isLoading, error } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => posApi.invoices.get(invoiceId),
    enabled: !!invoiceId,
    retry: false,
  });

  const inv = invoice?.data;
  const invoiceTags: InvoiceTag[] = Array.isArray(inv?.tags) ? (inv.tags as InvoiceTag[]) : [];

  useEffect(() => {
    if (inv?.is_replacement_return && typeof inv?.replacement_date === 'string' && inv.replacement_date) {
      setReplReplacementDate(inv.replacement_date);
    }
  }, [inv?.id, inv?.is_replacement_return, inv?.replacement_date]);

  const visibleInvoiceItems = useMemo(
    () => (Array.isArray(inv?.items) ? inv.items.filter((item: any) => !item?.replacement_ref) : []),
    [inv?.items]
  );

  const getEffectiveInvoiceTypeFromPayments = (payments: any[]): 'cash' | 'upi' | 'mixed' | null => {
    if (!Array.isArray(payments) || payments.length === 0) return null;
    const salePayments = payments.filter((payment: any) => {
      if (!payment || payment.payment_method === 'refund') return false;
      const amount = parseFloat(String(payment.amount ?? '0'));
      return Number.isFinite(amount) && amount > 0;
    });
    if (salePayments.length === 0) return null;

    const hasCash = salePayments.some((payment: any) => payment.payment_method === 'cash');
    const hasUpi = salePayments.some((payment: any) => payment.payment_method === 'upi');

    if (hasCash && hasUpi) return 'mixed';
    if (hasCash) return 'cash';
    if (hasUpi) return 'upi';
    return null;
  };

  const openPaymentEditor = (payment: any, forceMethod?: 'cash' | 'upi' | 'mixed') => {
    setEditingPaymentId(payment.id);
    const selectedMethod = forceMethod ?? (
      payment.payment_method === 'cash' || payment.payment_method === 'upi' || payment.payment_method === 'mixed'
        ? payment.payment_method
        : 'cash'
    );
    setEditPaymentMethod(selectedMethod);
    const existingAmount = String(payment.amount ?? '');
    setEditPaymentAmount(existingAmount);

    if (selectedMethod === 'mixed') {
      const salePayments = Array.isArray(inv?.payments)
        ? inv.payments.filter((p: any) => p && p.payment_method !== 'refund')
        : [];
      const cashTotal = salePayments
        .filter((p: any) => p.payment_method === 'cash')
        .reduce((sum: number, p: any) => sum + (parseFloat(String(p.amount ?? '0')) || 0), 0);
      const upiTotal = salePayments
        .filter((p: any) => p.payment_method === 'upi')
        .reduce((sum: number, p: any) => sum + (parseFloat(String(p.amount ?? '0')) || 0), 0);
      const fallbackAmount = parseFloat(existingAmount) || 0;
      setEditPaymentCashAmount(cashTotal > 0 ? String(cashTotal) : String(fallbackAmount));
      setEditPaymentUpiAmount(upiTotal > 0 ? String(upiTotal) : '');
    } else {
      setEditPaymentCashAmount(existingAmount);
      setEditPaymentUpiAmount('');
    }

    setEditPaymentReference(payment.reference || '');
    setEditPaymentNotes(payment.notes || '');
    setShowEditPaymentModal(true);
  };

  const syncInvoiceTypeWithPayments = async (invoiceData: any) => {
    if (!invoiceData) return;
    if (invoiceData.invoice_type === 'credit' || invoiceData.invoice_type === 'pending') return;

    const inferredType = getEffectiveInvoiceTypeFromPayments(invoiceData.payments || []);
    if (!inferredType || inferredType === invoiceData.invoice_type) return;

    await posApi.invoices.update(invoiceId, { invoice_type: inferredType });
    await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
    await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
    queryClient.invalidateQueries({ queryKey: ['invoices'] });
  };

  // Fetch customer details for balance calculation
  const { data: customerData } = useQuery({
    queryKey: ['customer', inv?.customer],
    queryFn: () => (inv?.customer ? customersApi.get(inv.customer) : Promise.resolve(null)),
    enabled: !!inv?.customer,
    retry: false,
  });

  const customer = customerData?.data || customerData;

  const { data: customersList } = useQuery({
    queryKey: ['customers-list', debouncedCustomerSearch],
    queryFn: () =>
      customersApi.list({
        page_size: 100,
        ...(debouncedCustomerSearch ? { search: debouncedCustomerSearch } : {}),
      }),
    enabled: editingCustomer,
  });
  const customers = (customersList?.data?.results ?? customersList?.data ?? []) as any[];

  // Repair status choices from backend (for dropdown and labels)
  const { data: repairStatusChoicesResponse } = useQuery({
    queryKey: ['repair-status-choices'],
    queryFn: () => posApi.repair.getStatusChoices(),
    enabled: !!inv?.repair,
  });
  const repairStatusOptions: { value: string; label: string }[] = repairStatusChoicesResponse?.data ?? [];
  const limitedRepairStatusOptions: { value: string; label: string; disabled?: boolean }[] = useMemo(() => {
    const allowed = ['received', 'work_in_progress', 'delivered', 'not_repaired'] as const;
    const allowedSet = new Set<string>(allowed);
    const byValue = new Map<string, { value: string; label: string }>(repairStatusOptions.map((o) => [o.value, o]));

    const orderedAllowed = allowed
      .map((value) => byValue.get(value) ?? { value, label: value.replace(/_/g, ' ') })
      .filter(Boolean) as { value: string; label: string }[];

    const currentValue = inv?.repair?.status;
    if (currentValue && !allowedSet.has(currentValue)) {
      const currentOpt = byValue.get(currentValue) ?? { value: currentValue, label: currentValue.replace(/_/g, ' ') };
      return [{ ...currentOpt, label: `${currentOpt.label} (current)`, disabled: true }, ...orderedAllowed];
    }
    return orderedAllowed;
  }, [repairStatusOptions, inv?.repair?.status]);

  // Old balance = total of customer's ledger (invoices moved to ledger / mark credit, minus payments).
  // Pending invoices do not affect the ledger until "Move to Ledger" (mark credit). totalOutstanding = -credit_balance.
  const { prevBalance, totalOutstanding } = useMemo(() => {
    if (!inv || !customer) return { prevBalance: 0, totalOutstanding: 0 };

    const invoiceTotal = parseFloat(inv.total || '0');
    const currentOutstanding = -parseFloat(customer.credit_balance || '0');

    // Only credit (moved to ledger) and paid invoices are in the ledger. Pending = draft, not in ledger yet.
    const isReflected =
      inv.status !== 'void' &&
      (inv.status === 'credit' || inv.status === 'paid' || (inv.status === 'draft' && inv.invoice_type !== 'pending'));

    let total = currentOutstanding;
    let pb = 0;

    if (isReflected) {
      total = currentOutstanding;
      if (inv.status === 'credit') {
        pb = total - invoiceTotal; // Old balance = outstanding before this invoice
      } else if (inv.status === 'paid') {
        pb = total + invoiceTotal; // Before this payment, they owed more
      } else {
        pb = total;
      }
    } else {
      pb = currentOutstanding;
      total = pb; // Pending/draft not in ledger: show same for both
    }

    return { prevBalance: pb, totalOutstanding: total };
  }, [inv, customer]);

  // Only show Old Balance / Total Outstanding when this customer has at least one credit invoice
  const { data: customerCreditInvoicesData } = useQuery({
    queryKey: ['invoices', 'customer-credit', inv?.customer],
    queryFn: () => posApi.invoices.list({ customer: inv!.customer, status: 'credit', page: 1, page_size: 1 }),
    enabled: !!inv?.customer,
    retry: false,
  });
  const customerHasCreditInvoice = (() => {
    const raw = customerCreditInvoicesData?.data;
    if (!raw || typeof raw !== 'object') return false;
    const results = (raw as any).results;
    return Array.isArray(results) && results.length > 0;
  })();

  const tradeInCreditAmount = useMemo(() => {
    const raw = (inv as { trade_in_credit?: string | number })?.trade_in_credit;
    const n = parseFloat(String(raw ?? '0'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [inv]);

  const posTradeInsRows = useMemo(() => {
    const raw = (inv as { pos_trade_ins?: unknown })?.pos_trade_ins;
    return Array.isArray(raw) ? raw : [];
  }, [inv]);

  const tradeInDetailTableEl = useMemo(() => {
    if (!posTradeInsRows.length) return null;
    return (
      <div className="overflow-x-auto rounded-lg border border-emerald-200/60 bg-white shadow-sm">
        <Table
          headers={['Product', 'Barcode', 'Prior invoice', 'Condition', 'Orig. line', 'Credit applied']}
        >
          {posTradeInsRows.map((row: any, idx: number) => (
            <TableRow key={idx}>
              <TableCell>
                <span className="text-sm text-gray-900">{row.product_name || '—'}</span>
              </TableCell>
              <TableCell>
                <span className="font-mono text-xs text-gray-700">{row.barcode || '—'}</span>
              </TableCell>
              <TableCell>
                <span className="text-sm text-gray-700">{row.source_invoice_number || '—'}</span>
              </TableCell>
              <TableCell>
                <span className="text-sm text-gray-800">{row.return_tag ? formatTradeInReturnTag(row.return_tag) : '—'}</span>
              </TableCell>
              <TableCell align="right">
                <span className="text-sm tabular-nums text-gray-800">
                  {row.original_line_credit != null && String(row.original_line_credit) !== ''
                    ? `₹${formatNumber(row.original_line_credit)}`
                    : '—'}
                </span>
              </TableCell>
              <TableCell align="right">
                <span className="text-sm font-semibold text-emerald-900 tabular-nums">
                  {row.credit != null && String(row.credit) !== '' ? `₹${formatNumber(row.credit)}` : '—'}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </Table>
      </div>
    );
  }, [posTradeInsRows]);

  // Fetch stores list
  const { data: storesData } = useQuery({
    queryKey: ['stores'],
    queryFn: () => catalogApi.stores.list(),
    retry: false,
  });

  const stores = storesData?.data || [];

  // Mutations - must be defined before any early returns
  const checkoutMutation = useMutation({
    mutationFn: (data: { invoice_type: 'cash' | 'upi' | 'pending' | 'mixed' | 'credit'; items: any[]; cash_amount?: number; upi_amount?: number }) => {
      return posApi.invoices.checkout(invoiceId, data);
    },
    onSuccess: async (response: any) => {
      // Update invoice cache immediately with response (includes updated repair status when backend auto-set to work_in_progress)
      const updatedInvoice = response?.data;
      if (updatedInvoice) {
        queryClient.setQueryData(['invoice', invoiceId], updatedInvoice);
      }
      // Invalidate and refetch so totals and related data are in sync
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['repair-invoices'] });
      setShowCheckoutModal(false);
      setCheckoutQuantities({});
      setCheckoutPrices({});
      setCheckoutPriceErrors({});
      setCheckoutPurchasePrices({});
      setCheckoutCashAmount('');
      setCheckoutUpiAmount('');
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to checkout invoice';
      alert(errorMsg);
    },
  });

  const markCreditMutation = useMutation({
    mutationFn: (payload: { items: any[]; delivery_date?: string | null; repair_status?: string }) =>
      posApi.invoices.markCredit(invoiceId, {
        items: payload.items,
        ...(payload.delivery_date !== undefined && payload.delivery_date !== null && payload.delivery_date !== ''
          ? { delivery_date: payload.delivery_date }
          : {}),
        ...(payload.repair_status ? { repair_status: payload.repair_status } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-summary'] });
      if (invoice?.data?.customer) {
        queryClient.invalidateQueries({ queryKey: ['customer', invoice.data.customer] });
      }
      setShowCheckoutModal(false);
      setCheckoutQuantities({});
      setCheckoutPrices({});
      setCheckoutPriceErrors({});
      setCheckoutPurchasePrices({});
      alert('Invoice marked as credit and moved to ledger successfully!');
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to mark invoice as credit';
      alert(errorMsg);
    },
  });

  // Finalize a pending replacement-return invoice (settlement only — no price editing)
  const finalizeReplacementMutation = useMutation({
    mutationFn: (payload: { settlement_invoice_type: string; replacement_date?: string; cash_amount?: string | null; upi_amount?: string | null }) =>
      posApi.replacement.replacementPos.finalize(invoiceId, payload),
    onSuccess: async () => {
      try {
        await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
        await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
        queryClient.invalidateQueries({ queryKey: ['invoices'] });
        queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
        queryClient.invalidateQueries({ queryKey: ['ledger-summary'] });
        if (invoice?.data?.customer) {
          queryClient.invalidateQueries({ queryKey: ['customer', invoice.data.customer] });
        }
      } catch {
        // Do not treat post-success refetch/cache issues as finalize failure.
      }
      setShowCheckoutModal(false);
      setReplSettlementType('cash');
      setReplCashAmount('');
      setReplUpiAmount('');
      setReplReplacementDate(new Date().toISOString().slice(0, 10));
      toast('Replacement invoice finalized successfully!', 'success');
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to finalize replacement invoice';
      alert(msg);
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: number; data: any }) =>
      posApi.invoices.updateItem(invoiceId, itemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || 'Failed to update item');
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: number) => posApi.invoices.deleteItem(invoiceId, itemId),
    onSuccess: async () => {
      // Invalidate and refetch to get updated invoice without deleted items
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || 'Failed to delete item');
    },
  });

  const updateRepairStatusMutation = useMutation({
    mutationFn: (data: { repair_status: string }) =>
      posApi.repair.updateStatus(invoiceId, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['repair-invoices'] });
      setShowRepairStatusModal(false);
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || error?.response?.data?.message || 'Failed to update repair status');
    },
  });

  const paymentMutation = useMutation({
    mutationFn: async (data: {
      payment_method: string;
      amount?: number;
      cash_amount?: number;
      upi_amount?: number;
      reference?: string;
      notes?: string
    }) => {
      if (data.payment_method === 'mixed') {
        const cashAmount = data.cash_amount ?? 0;
        const upiAmount = data.upi_amount ?? 0;

        const [cashResponse] = await Promise.all([
          posApi.invoices.payments(invoiceId, {
            payment_method: 'cash',
            amount: cashAmount,
            reference: data.reference,
            notes: data.notes,
          }),
          posApi.invoices.payments(invoiceId, {
            payment_method: 'upi',
            amount: upiAmount,
            reference: data.reference,
            notes: data.notes,
          }),
        ]);
        return cashResponse;
      }

      return posApi.invoices.payments(invoiceId, {
        payment_method: data.payment_method,
        amount: data.amount as number,
        reference: data.reference,
        notes: data.notes,
      });
    },
    onSuccess: async () => {
      // Invalidate and refetch to get updated invoice with payment
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
      const latestInvoice = (queryClient.getQueryData(['invoice', invoiceId]) as any)?.data;
      await syncInvoiceTypeWithPayments(latestInvoice);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setShowPaymentModal(false);
      setPaymentAmount('');
      setPaymentCashAmount('');
      setPaymentUpiAmount('');
      setPaymentReference('');
      setPaymentNotes('');
      if (invoice?.data?.customer) {
        queryClient.invalidateQueries({ queryKey: ['customer', invoice.data.customer] });
      }
      setPaymentMethod('cash');
      alert('Payment recorded successfully!');
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to record payment';
      alert(errorMsg);
    },
  });

  const resetEditPaymentState = () => {
    setShowEditPaymentModal(false);
    setEditingPaymentId(null);
    setEditPaymentMethod('cash');
    setEditPaymentAmount('');
    setEditPaymentCashAmount('');
    setEditPaymentUpiAmount('');
    setEditPaymentReference('');
    setEditPaymentNotes('');
  };

  const updatePaymentMutation = useMutation({
    mutationFn: async (data: {
      payment_id: number;
      payment_method: string;
      amount?: number;
      cash_amount?: number;
      upi_amount?: number;
      reference?: string;
      notes?: string
    }) => {
      if (data.payment_method === 'mixed') {
        const cashAmount = data.cash_amount ?? 0;
        const upiAmount = data.upi_amount ?? 0;

        await posApi.invoices.updatePayment(invoiceId, {
          payment_id: data.payment_id,
          payment_method: 'cash',
          amount: cashAmount,
          reference: data.reference,
          notes: data.notes,
        });

        return posApi.invoices.payments(invoiceId, {
          payment_method: 'upi',
          amount: upiAmount,
          reference: data.reference,
          notes: data.notes,
        });
      }

      return posApi.invoices.updatePayment(invoiceId, {
        payment_id: data.payment_id,
        payment_method: data.payment_method,
        amount: data.amount as number,
        reference: data.reference,
        notes: data.notes,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
      const latestInvoice = (queryClient.getQueryData(['invoice', invoiceId]) as any)?.data;
      await syncInvoiceTypeWithPayments(latestInvoice);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (invoice?.data?.customer) {
        queryClient.invalidateQueries({ queryKey: ['customer', invoice.data.customer] });
      }
      resetEditPaymentState();
      alert('Payment updated successfully!');
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to update payment';
      alert(errorMsg);
    },
  });

  const addItemMutation = useMutation({
    mutationFn: (data: any) => posApi.invoices.addItem(invoiceId, data),
    onSuccess: async () => {
      // Invalidate and refetch to get updated invoice (includes repair status when backend auto-set to work_in_progress)
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['repair-invoices'] });
      setBarcodeInput('');
      setProductSearchSelectedIndex(-1);
      setIsSearchTyped(false);
    },
    onError: (error: any) => {
      const errorMessage = error?.response?.data?.error || error?.response?.data?.message || error?.response?.data?.detail || error?.response?.data || 'Failed to add item';
      console.error('Add item error:', error?.response?.data);
      // Show detailed error including serializer errors
      if (error?.response?.data && typeof error.response.data === 'object') {
        const errorDetails = Object.entries(error.response.data)
          .map(([key, value]: [string, any]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value} `)
          .join('\n');
        alert(`Failed to add item: \n\n${errorDetails} `);
      } else {
        alert(errorMessage);
      }
    },
  });

  // Debounce barcode input for search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedBarcodeInput(barcodeInput);
    }, 300);
    return () => clearTimeout(handler);
  }, [barcodeInput]);

  // Helper function to detect if input looks like a barcode
  const looksLikeBarcode = (input: string): boolean => {
    if (!input || input.length < 3) return false;
    const barcodePattern = /^[A-Za-z0-9\-_]+$/;
    return barcodePattern.test(input) && (input.length >= 4 || input.includes('-') || input.includes('_'));
  };

  const trimmedBarcodeInput = useMemo(() => debouncedBarcodeInput.trim(), [debouncedBarcodeInput]);

  // Barcode check query
  const { data: barcodeCheck } = useQuery({
    queryKey: ['barcode-check-invoice', trimmedBarcodeInput],
    queryFn: async () => {
      if (!trimmedBarcodeInput || trimmedBarcodeInput.length < 3) return null;
      if (!looksLikeBarcode(trimmedBarcodeInput)) return null;

      try {
        const response = await productsApi.byBarcode(trimmedBarcodeInput, true, true);
        if (response.data) {
          return { product: response.data, isUnavailable: !response.data.barcode_available };
        }
      } catch (error: any) {
        // Not a barcode or not found
        return null;
      }
      return null;
    },
    enabled: trimmedBarcodeInput.length >= 3 && looksLikeBarcode(trimmedBarcodeInput),
    retry: false,
  });

  // Product search query
  const { data: products } = useQuery({
    queryKey: ['products-invoice', debouncedBarcodeInput],
    queryFn: async () => {
      const params: any = { search: debouncedBarcodeInput };
      const response = await productsApi.list(params);
      return response.data;
    },
    enabled: debouncedBarcodeInput.trim().length > 0
      && !(looksLikeBarcode(debouncedBarcodeInput.trim()) && barcodeCheck?.product && !barcodeCheck?.isUnavailable),
    retry: false,
  });


  const deleteInvoiceMutation = useMutation({
    mutationFn: ({ force, restoreStock }: { force: boolean; restoreStock: boolean }) =>
      posApi.invoices.delete(invoiceId, force, restoreStock),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['products'] }); // Refresh products to show updated stock
      setShowDeleteModal(false);
      navigate(invoicesListPath);
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || 'Failed to delete invoice');
    },
  });

  const updateInvoiceMutation = useMutation({
    mutationFn: (data: { invoice_type?: string; store?: number; customer?: number | null }) =>
      posApi.invoices.update(invoiceId, data),
    onSuccess: async () => {
      // Invalidate and refetch to get updated totals
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setEditingInvoiceType(false);
      setEditingStore(false);
      setEditingCustomer(false);
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || error?.response?.data?.message || 'Failed to update invoice');
    },
  });

  const editInvoiceMutation = useMutation({
    mutationFn: () => posApi.invoices.edit(invoiceId),
    onSuccess: (res: any) => {
      const cartId = res?.data?.cart_id;
      if (cartId != null) {
        navigate(`/invoices/${invoiceId}/edit`, { state: { cartId } });
      } else {
        alert('Failed to start edit: no cart returned');
      }
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || error?.response?.data?.message || 'Failed to start edit');
    },
  });

  // When invoice items change and checkout modal is open, initialize new items
  useEffect(() => {
    const inv = invoice?.data;
    if (showCheckoutModal && inv?.items && Array.isArray(inv.items)) {
      const newQuantities = { ...checkoutQuantities };
      const newPrices = { ...checkoutPrices };
      const newParentPrices = { ...parentGroupPrices };
      const newPurchasePrices = { ...checkoutPurchasePrices };
      let hasNewItems = false;

      // Check for new items that aren't in checkoutQuantities
      inv.items.forEach((item: any) => {
        if (!(item.id in checkoutQuantities)) {
          // New item - initialize it
          newQuantities[item.id] = item.quantity.toString();
          newPrices[item.id] = (item.manual_unit_price || item.unit_price || '0').toString();
          if (item.product_name?.startsWith('Other -')) {
            const pp = item.product_purchase_price ?? item.purchase_price;
            if (pp != null && Number(pp) > 0) newPurchasePrices[item.id] = String(pp);
          }
          hasNewItems = true;
        }
      });

      // Update parent prices for any new groups
      if (hasNewItems) {
        const groupedItems = groupItemsByProduct(inv.items);
        groupedItems.forEach((group, groupIndex) => {
          const groupKey = `group_${group.productId}_${groupIndex} `;
          if (!(groupKey in parentGroupPrices)) {
            const firstItem = group.items[0];
            const basePrice = (firstItem.manual_unit_price || firstItem.unit_price || '0').toString();
            newParentPrices[groupKey] = basePrice;
          }
        });
      }

      if (hasNewItems) {
        setCheckoutQuantities(newQuantities);
        setCheckoutPrices(newPrices);
        setParentGroupPrices(newParentPrices);
        setCheckoutPurchasePrices(newPurchasePrices);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.data?.items?.length, showCheckoutModal]); // Only run when item count changes or modal opens

  // When navigating from Repairs with ?openCheckout=1, always open checkout modal.
  useEffect(() => {
    const inv = invoice?.data;
    if (!inv) return;
    const openCheckout = searchParams.get('openCheckout');
    if (openCheckout !== '1') return;
    handleCheckout();
    const next = new URLSearchParams(searchParams);
    next.delete('openCheckout');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.data, searchParams]);

  // Sync repair status in checkout modal when modal opens or invoice repair changes
  useEffect(() => {
    const inv = invoice?.data;
    if (showCheckoutModal && inv?.repair) {
      const hasProducts = Array.isArray(inv.items) && inv.items.length > 0;
      const pendingAllowed = new Set(['received', 'not_repaired']);
      const currentPending = (checkoutRepairStatus || inv.repair.status || '').trim();
      const initialStatus = checkoutInvoiceType === 'pending'
        ? (hasProducts ? 'work_in_progress' : (pendingAllowed.has(currentPending) ? currentPending : 'received'))
        : inv.repair.status;
      setCheckoutRepairStatus(initialStatus);
    }
  }, [showCheckoutModal, checkoutInvoiceType, checkoutRepairStatus, invoice?.data?.repair?.status, invoice?.data?.items?.length]);

  // Prefill repair delivery date from existing value (do not auto-set to today)
  useEffect(() => {
    const inv = invoice?.data;
    if (showCheckoutModal && inv?.repair) {
      const existing = inv.repair.delivery_date ? String(inv.repair.delivery_date).slice(0, 10) : '';
      setCheckoutDeliveryDate(existing);
    }
  }, [showCheckoutModal, invoice?.data?.repair?.id]);

  // F6: Open Custom Product modal when checkout modal is open (same as POS / Invoice Edit)
  useEffect(() => {
    if (!showCheckoutModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F6') {
        e.preventDefault();
        setShowCustomProductModal(true);
        setBarcodeInput('');
        setProductSearchSelectedIndex(-1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCheckoutModal]);

  // Early returns after all hooks
  if (isLoading) {
    return <LoadingState message="Loading invoice details..." />;
  }

  if (error || !invoice?.data) {
    return (
      <ErrorState
        message="Invoice not found or failed to load"
        onRetry={() => navigate(invoicesListPath)}
      />
    );
  }

  const statusConfig: Record<string, { label: string; color: 'success' | 'warning' | 'danger' | 'info' | 'default'; icon: any }> = {
    draft: { label: 'Draft', color: 'default', icon: Clock },
    paid: { label: 'Paid', color: 'success', icon: CheckCircle },
    partial: { label: 'Partial', color: 'warning', icon: Clock },
    credit: { label: 'Credit', color: 'info', icon: Coins },
    void: { label: 'Void', color: 'danger', icon: XCircle },
    pending: { label: 'Pending', color: 'warning', icon: Clock },
    sale: { label: 'Sale', color: 'success', icon: CheckCircle },
  };

  const StatusIcon = statusConfig[inv.status]?.icon || FileText;
  const statusInfo = statusConfig[inv.status] || statusConfig.draft;
  const invoiceTypeLabel =
    inv.invoice_type === 'mixed'
      ? 'Cash + UPI'
      : inv.invoice_type
        ? inv.invoice_type.charAt(0).toUpperCase() + inv.invoice_type.slice(1)
        : 'Sale';
  const repairStatusLabel = inv?.repair
    ? (repairStatusOptions.find((o) => o.value === inv.repair?.status)?.label ?? inv.repair?.status ?? '—')
    : '—';
  const repairStatusBadgeClass = inv?.repair?.status === 'received'
    ? 'bg-blue-100 text-blue-800 border-blue-200'
    : inv?.repair?.status === 'work_in_progress'
      ? 'bg-yellow-100 text-yellow-800 border-yellow-200'
      : inv?.repair?.status === 'done'
        ? 'bg-green-100 text-green-800 border-green-200'
        : inv?.repair?.status === 'delivered'
          ? 'bg-gray-100 text-gray-800 border-gray-200'
          : inv?.repair?.status === 'not_repaired'
            ? 'bg-orange-100 text-orange-800 border-orange-200'
            : inv?.repair?.status === 'cancelled'
              ? 'bg-red-100 text-red-800 border-red-200'
              : 'bg-gray-100 text-gray-800 border-gray-200';

  const formatBalance = (val: number) => {
    const absVal = Math.abs(val);
    const formatted = formatNumber(absVal, 2);
    return val < 0 ? `${formatted} (Credit)` : `₹${formatted}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Convert number to words (Indian numbering system)
  const numberToWords = (num: number): string => {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    if (num === 0) return 'Zero Rupees Only';

    const convertHundreds = (n: number): string => {
      if (n === 0) return '';
      let result = '';
      if (n >= 100) {
        result += ones[Math.floor(n / 100)] + ' Hundred ';
        n %= 100;
      }
      if (n >= 20) {
        result += tens[Math.floor(n / 10)] + ' ';
        n %= 10;
      }
      if (n > 0) {
        result += ones[n] + ' ';
      }
      return result.trim();
    };

    const convert = (n: number): string => {
      if (n === 0) return '';

      // Crore
      if (n >= 10000000) {
        const crores = Math.floor(n / 10000000);
        const remainder = n % 10000000;
        return convertHundreds(crores) + 'Crore ' + convert(remainder);
      }

      // Lakh
      if (n >= 100000) {
        const lakhs = Math.floor(n / 100000);
        const remainder = n % 100000;
        return convertHundreds(lakhs) + 'Lakh ' + convert(remainder);
      }

      // Thousand
      if (n >= 1000) {
        const thousands = Math.floor(n / 1000);
        const remainder = n % 1000;
        return convertHundreds(thousands) + 'Thousand ' + convert(remainder);
      }

      // Hundreds, Tens, Ones
      return convertHundreds(n);
    };

    const integerPart = Math.floor(num);
    const decimalPart = Math.round((num % 1) * 100);

    let result = convert(integerPart).trim();

    if (result) {
      result += ' Rupees';
    } else {
      result = 'Zero Rupees';
    }

    if (decimalPart > 0) {
      const paiseWords = convert(decimalPart).trim();
      if (paiseWords) {
        result += ' and ' + paiseWords + ' Paise';
      }
    }

    return result + ' Only';
  };

  const formatDateForInvoice = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Edit invoice (cart): show for non-void
  const isReplacementReturn = inv?.is_replacement_return === true;
  const canEditItems = inv.status !== 'void' && !isReplacementReturn;
  const isEditable = inv.status !== 'void';
  const isPending = inv.invoice_type === 'pending' && inv.status === 'draft';
  const isDraftPendingCheckout = inv.status === 'draft' && checkoutInvoiceType === 'pending';
  const hasProductsInCheckout = Array.isArray(inv.items) && inv.items.length > 0;
  const pendingAllowedStatus = new Set(['received', 'not_repaired']);
  const forcedPendingRepairStatus = checkoutInvoiceType === 'pending'
    ? (hasProductsInCheckout
      ? 'work_in_progress'
      : (pendingAllowedStatus.has((checkoutRepairStatus || '').trim()) ? (checkoutRepairStatus || '').trim() : 'received'))
    : '';
  const effectiveCheckoutRepairStatus = (checkoutRepairStatus || inv.repair?.status || '').trim();
  const shouldShowCheckoutDeliveryDate =
  checkoutInvoiceType !== 'pending' && (
    effectiveCheckoutRepairStatus === 'done' ||
    effectiveCheckoutRepairStatus === 'delivered'
  );

  // Group items by product only (not by barcode)
  const groupItemsByProduct = (items: any[]) => {
    const grouped = new Map<number, {
      productId: number;
      productName: string;
      items: any[];
      totalQuantity: number;
      isTrackedInventory: boolean;
    }>();

    items.forEach((item: any) => {
      const productId = item.product || item.product_id || 0;

      if (grouped.has(productId)) {
        const group = grouped.get(productId)!;
        group.items.push(item);
        group.totalQuantity += parseInt(item.quantity || '0') || 0;
      } else {
        grouped.set(productId, {
          productId: productId,
          productName: item.product_name || '-',
          items: [item],
          totalQuantity: parseInt(item.quantity || '0') || 0,
          isTrackedInventory: item.product_track_inventory === true,
        });
      }
    });

    return Array.from(grouped.values());
  };

  // Check if all items have prices entered
  const areAllPricesEntered = (): boolean => {
    if (!inv?.items || inv.items.length === 0) return false;

    // Filter out items with quantity 0
    const activeItems = inv.items.filter((item: any) => {
      const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
      return parseFloat(qty) > 0;
    });

    if (activeItems.length === 0) return false;

    // Group items to get parent prices (same logic as calculateCheckoutTotal)
    const groupedItems = groupItemsByProduct(activeItems);

    for (let groupIndex = 0; groupIndex < groupedItems.length; groupIndex++) {
      const group = groupedItems[groupIndex];
      const groupKey = `group_${group.productId}_${groupIndex} `;
      const parentPrice = parentGroupPrices[groupKey];

      // Check if parent price is set
      if (!parentPrice || parseFloat(parentPrice.toString()) <= 0) {
        return false;
      }

      // Check each item in the group (individual item prices override parent price)
      for (const item of group.items) {
        const itemPrice = checkoutPrices[item.id];
        // If item has individual price, use it; otherwise use parent price
        const effectivePrice = itemPrice ?? parentPrice;
        if (!effectivePrice || parseFloat(effectivePrice.toString()) <= 0) {
          return false;
        }
      }
    }

    return true;
  };

  // Helper function to calculate invoice total from checkout prices
  const calculateCheckoutTotal = (): number => {
    if (!inv?.items || !Array.isArray(inv.items)) return 0;

    // Filter out items with quantity 0
    const activeItems = inv.items.filter((item: any) => {
      const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
      return parseFloat(qty) > 0;
    });

    if (activeItems.length === 0) return 0;

    // Group items to get parent prices
    const groupedItems = groupItemsByProduct(activeItems);
    const groupPriceMap: Record<number, string> = {}; // Map item.id to parent group price

    groupedItems.forEach((group, groupIndex) => {
      const groupKey = `group_${group.productId}_${groupIndex} `;
      const parentPrice = parentGroupPrices[groupKey];
      group.items.forEach((item: any) => {
        groupPriceMap[item.id] = parentPrice;
      });
    });

    return activeItems.reduce((sum: number, item: any) => {
      const quantity = checkoutQuantities[item.id] ?? item.quantity.toString();
      // Use checkoutPrices first, then fall back to parentGroupPrices, then original price
      let price = checkoutPrices[item.id];
      if (!price || price === '' || price === '0') {
        price = groupPriceMap[item.id];
      }
      if (!price || price === '' || price === '0') {
        price = (item.manual_unit_price || item.unit_price || '0').toString();
      }

      const qty = parseFloat(quantity) || 0;
      const prc = parseFloat(price) || 0;
      return sum + (qty * prc);
    }, 0);
  };

  // Helper function to validate price threshold
  const validatePriceThreshold = (price: string, item: any, effectivePurchasePrice?: number): string | null => {
    if (!price || price.trim() === '' || parseFloat(price) <= 0) {
      return null; // No validation needed for empty or zero prices
    }

    const salePrice = parseFloat(price);
    if (isNaN(salePrice)) {
      return null;
    }

    // Use purchase_price as the floor — selling at cost (break even) is always allowed
    const purchasePrice = effectivePurchasePrice !== undefined && effectivePurchasePrice !== null && !Number.isNaN(effectivePurchasePrice)
      ? effectivePurchasePrice
      : parseFloat(item.product_purchase_price ?? item.purchase_price ?? '0');

    const minPrice = purchasePrice;
    const isCustomOtherProduct = item.product_name?.startsWith('Other -');
    const canGoBelow = item.product_can_go_below_purchase_price || false;
    // For custom "Other -" items, never allow below-cost sale from UI.
    const shouldEnforcePurchaseFloor = isCustomOtherProduct || !canGoBelow;

    if (shouldEnforcePurchaseFloor && minPrice > 0 && salePrice < minPrice) {
      return `Price cannot be less than purchase price (₹${formatNumber(minPrice)})`;
    }

    return null;
  };

  const getItemPurchasePriceForValidation = (item: any): number => {
    if (item.product_name?.startsWith('Other -')) {
      const rawCustomPurchase = checkoutPurchasePrices[item.id];
      if (rawCustomPurchase != null && rawCustomPurchase !== '') {
        const parsedCustomPurchase = parseFloat(rawCustomPurchase);
        if (!Number.isNaN(parsedCustomPurchase)) return parsedCustomPurchase;
      }
    }

    const fallbackPurchase = parseFloat(item.product_purchase_price ?? item.purchase_price ?? '0');
    return Number.isNaN(fallbackPurchase) ? 0 : fallbackPurchase;
  };

  const getCheckoutPriceValidationErrors = (sourceItems: any[]): string[] => {
    const priceValidationErrors: string[] = [];

    sourceItems.forEach((item: any) => {
      const salePrice = checkoutPrices[item.id]
        ? parseFloat(checkoutPrices[item.id])
        : (parseFloat(item.manual_unit_price) || parseFloat(item.unit_price) || 0);

      if (salePrice > 0) {
        const minPrice = getItemPurchasePriceForValidation(item);
        const isCustomOtherProduct = item.product_name?.startsWith('Other -');
        const canGoBelow = item.product_can_go_below_purchase_price || false;
        const shouldEnforcePurchaseFloor = isCustomOtherProduct || !canGoBelow;

        if (shouldEnforcePurchaseFloor && minPrice > 0 && salePrice < minPrice) {
          priceValidationErrors.push(
            `${item.product_name || 'Product'}: Sale price(₹${formatNumber(salePrice)}) cannot be less than purchase price (₹${formatNumber(minPrice)})`
          );
        }
      }
    });

    return priceValidationErrors;
  };

  const handleCheckout = () => {
    // Initialize checkout quantities and prices from current invoice items
    const initialQuantities: Record<number, string> = {};
    const initialPrices: Record<number, string> = {};
    const initialParentPrices: Record<string, string> = {};
    const initialPurchasePrices: Record<number, string> = {};

    // Group items to initialize parent prices
    if (inv?.items && Array.isArray(inv.items)) {
      const groupedItems = groupItemsByProduct(inv.items);
      groupedItems.forEach((group, groupIndex) => {
        const groupKey = `group_${group.productId}_${groupIndex} `;
        const firstItem = group.items[0];
        const basePrice = (firstItem.manual_unit_price || firstItem.unit_price || '0').toString();
        initialParentPrices[groupKey] = basePrice;
      });
    }

    inv?.items?.forEach((item: any) => {
      initialQuantities[item.id] = item.quantity.toString();
      initialPrices[item.id] = (item.manual_unit_price || item.unit_price || '0').toString();
      if (item.product_name?.startsWith('Other -')) {
        const pp = item.product_purchase_price ?? item.purchase_price;
        if (pp != null && Number(pp) > 0) initialPurchasePrices[item.id] = String(pp);
      }
    });
    setCheckoutQuantities(initialQuantities);
    setCheckoutPrices(initialPrices);
    setParentGroupPrices(initialParentPrices);
    setCheckoutPurchasePrices(initialPurchasePrices);
    setCheckoutPriceErrors({}); // Clear any previous errors
    // Preserve current invoice type when opening from Repairs or existing invoice context.
    setCheckoutInvoiceType(inv?.invoice_type || 'pending');
    setShowCheckoutModal(true);
  };

  const handleMoveToLedger = () => {
    // Same init as handleCheckout but pre-select credit so user can move paid bill to ledger
    const initialQuantities: Record<number, string> = {};
    const initialPrices: Record<number, string> = {};
    const initialParentPrices: Record<string, string> = {};
    const initialPurchasePrices: Record<number, string> = {};
    if (inv?.items && Array.isArray(inv.items)) {
      const groupedItems = groupItemsByProduct(inv.items);
      groupedItems.forEach((group, groupIndex) => {
        const groupKey = `group_${group.productId}_${groupIndex} `;
        const firstItem = group.items[0];
        const basePrice = (firstItem.manual_unit_price || firstItem.unit_price || '0').toString();
        initialParentPrices[groupKey] = basePrice;
      });
    }
    inv?.items?.forEach((item: any) => {
      initialQuantities[item.id] = item.quantity.toString();
      initialPrices[item.id] = (item.manual_unit_price || item.unit_price || '0').toString();
      if (item.product_name?.startsWith('Other -')) {
        const pp = item.product_purchase_price ?? item.purchase_price;
        if (pp != null && Number(pp) > 0) initialPurchasePrices[item.id] = String(pp);
      }
    });
    setCheckoutQuantities(initialQuantities);
    setCheckoutPrices(initialPrices);
    setParentGroupPrices(initialParentPrices);
    setCheckoutPurchasePrices(initialPurchasePrices);
    setCheckoutPriceErrors({});
    setCheckoutInvoiceType('credit');
    setShowCheckoutModal(true);
  };

  const handleCheckoutSubmit = async () => {
    // Refetch invoice to ensure we have the latest data (in case items were deleted)
    await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });

    // Get fresh invoice data
    const freshInvoice = queryClient.getQueryData(['invoice', invoiceId]) as any;
    const freshInv = freshInvoice?.data;
    const submitRepairStatus =
      checkoutInvoiceType === 'pending'
        ? (
            (freshInv?.items?.length ?? 0) > 0
              ? 'work_in_progress'
              : (pendingAllowedStatus.has((checkoutRepairStatus || '').trim()) ? (checkoutRepairStatus || '').trim() : 'received')
          )
        : (
            checkoutInvoiceType !== freshInv?.invoice_type
              ? 'delivered'
              : ((checkoutRepairStatus || '').trim() || (freshInv?.repair?.status || '').trim())
          );

    const canSavePendingNotRepairedWithoutItems =
      !!freshInv?.repair && checkoutInvoiceType === 'pending' && submitRepairStatus === 'not_repaired';

    if ((!freshInv?.items || freshInv.items.length === 0) && canSavePendingNotRepairedWithoutItems) {
      try {
        await posApi.repair.updateStatus(invoiceId, { repair_status: 'not_repaired' });
        await posApi.repair.update(invoiceId, { delivery_date: null });
        await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
        queryClient.invalidateQueries({ queryKey: ['repair-invoices'] });
        setShowCheckoutModal(false);
        return;
      } catch (error: any) {
        alert(error?.response?.data?.error || error?.response?.data?.message || 'Failed to save repair status');
        return;
      }
    }

    if (!freshInv?.items || freshInv.items.length === 0) {
      alert('Invoice has no items');
      return;
    }

    // Check for any price validation errors
    if (Object.keys(checkoutPriceErrors).length > 0) {
      const errorMessages = Object.values(checkoutPriceErrors).filter(Boolean);
      if (errorMessages.length > 0) {
        alert(`Price validation failed: \n\n${errorMessages.join('\n')} `);
        return;
      }
    }

    // Prepare items with updated quantities and prices
    // Filter out items with quantity 0 (they will be deleted by backend)
    // Use freshInv instead of inv to ensure we have the latest data
    const items = freshInv.items
      .map((item: any): any => {
        const quantity = checkoutQuantities[item.id]
          ? parseInt(checkoutQuantities[item.id]) || 0
          : parseInt(item.quantity) || 0;
        const price = checkoutPrices[item.id]
          ? parseFloat(checkoutPrices[item.id])
          : (parseFloat(item.manual_unit_price) || parseFloat(item.unit_price) || 0);
        const payload: any = {
          id: item.id,
          quantity: quantity,
          unit_price: item.unit_price,
          manual_unit_price: price > 0 ? price : null,
          discount_amount: item.discount_amount || 0,
          tax_amount: item.tax_amount || 0,
        };
        if (item.product_name?.startsWith('Other -')) {
          const purchaseVal = checkoutPurchasePrices[item.id] != null && checkoutPurchasePrices[item.id] !== ''
            ? parseFloat(checkoutPurchasePrices[item.id])
            : (item.product_purchase_price != null ? parseFloat(item.product_purchase_price) : item.purchase_price != null ? parseFloat(item.purchase_price) : null);
          if (purchaseVal != null && !Number.isNaN(purchaseVal) && purchaseVal > 0) {
            payload.purchase_price = purchaseVal;
          }
        }
        return payload;
      })
      .filter((item: any) => item.quantity > 0); // Remove items with quantity 0

    // Check if there are any items left after filtering
    if (items.length === 0) {
      alert('Invoice must have at least one item with quantity greater than 0.');
      return;
    }

    // Validate purchase price for custom products (must be > 0)
    const customItemsMissingPurchasePrice = freshInv.items.filter((item: any) => {
      if (!item.product_name?.startsWith('Other -')) return false;
      const qty = checkoutQuantities[item.id] ?? item.quantity?.toString();
      if (parseFloat(qty) <= 0) return false;
      const purchaseVal = checkoutPurchasePrices[item.id] != null && checkoutPurchasePrices[item.id] !== ''
        ? parseFloat(checkoutPurchasePrices[item.id])
        : (item.product_purchase_price != null ? parseFloat(item.product_purchase_price) : item.purchase_price != null ? parseFloat(item.purchase_price) : NaN);
      return Number.isNaN(purchaseVal) || purchaseVal <= 0;
    });
    if (customItemsMissingPurchasePrice.length > 0) {
      const names = customItemsMissingPurchasePrice.map((i: any) => i.product_name || 'Custom Product').join(', ');
      alert(`Purchase price is required and must be greater than 0 for: ${names}`);
      return;
    }

    // Validate that all items have prices for cash/upi/mixed invoices (not required for pending)
    if (checkoutInvoiceType !== 'pending') {
      const itemsWithoutPrice = items.filter((item: any) => !item.manual_unit_price || item.manual_unit_price <= 0);
      if (itemsWithoutPrice.length > 0) {
        alert(`Please enter prices for all items.${itemsWithoutPrice.length} item(s) are missing prices.`);
        return;
      }
    }

    // Validate price threshold for all invoice types (including pending/draft)
    // Use freshInv to ensure latest purchase/sale inputs are checked at submit time
    const priceValidationErrors = getCheckoutPriceValidationErrors(freshInv.items);

    if (priceValidationErrors.length > 0) {
      alert(`Price validation failed: \n\n${priceValidationErrors.join('\n')} `);
      return;
    }

    // Validate split payments for mixed type
    if (checkoutInvoiceType === 'mixed') {
      const total = items.reduce((sum: number, item: any) => {
        return sum + (item.quantity * (item.manual_unit_price || 0));
      }, 0);
      const cash = parseFloat(checkoutCashAmount) || 0;
      const upi = parseFloat(checkoutUpiAmount) || 0;

      if (!checkoutCashAmount || !checkoutUpiAmount || cash <= 0 || upi <= 0) {
        alert('Please enter both cash and UPI amounts for split payment');
        return;
      }

      if (Math.abs((cash + upi) - total) > 0.01) { // Allow small floating point differences
        alert(`Split payment amounts(₹${formatNumber(cash + upi)}) do not match invoice total(₹${formatNumber(total)})`);
        return;
      }
    }

    const checkoutData: any = {
      invoice_type: checkoutInvoiceType,
      items: items,
    };

    // Persist selected repair status during checkout so backend state matches UI selection.
    if (freshInv?.repair) {
      if (submitRepairStatus) {
        checkoutData.repair_status = submitRepairStatus;
      }
    }

    // Add split payment amounts for mixed type
    if (checkoutInvoiceType === 'mixed') {
      checkoutData.cash_amount = parseFloat(checkoutCashAmount);
      checkoutData.upi_amount = parseFloat(checkoutUpiAmount);
    }

    // Include repair delivery date when invoice is a repair (from repair model, can be set/updated at checkout)
    const canSubmitDeliveryDate =
      submitRepairStatus === 'done' ||
      submitRepairStatus === 'delivered';
    if (freshInv?.repair && canSubmitDeliveryDate && checkoutDeliveryDate.trim()) {
      checkoutData.delivery_date = checkoutDeliveryDate.trim();
    } else if (freshInv?.repair && canSubmitDeliveryDate && (checkoutDeliveryDate === '' || checkoutDeliveryDate === null)) {
      checkoutData.delivery_date = null;
    }

    // Only persist "clear delivery date" when user confirms submit (not while toggling controls).
    if (freshInv?.repair && checkoutInvoiceType === 'pending') {
      try {
        await posApi.repair.update(invoiceId, { delivery_date: null });
      } catch (error: any) {
        alert(error?.response?.data?.error || error?.response?.data?.message || 'Failed to clear repair delivery date');
        return;
      }
    }

    checkoutMutation.mutate(checkoutData);
  };

  const handleUpdateQuantity = (item: any, delta: number) => {
    const newQuantity = Math.max(0, parseInt(item.quantity) || 0 + delta);
    if (newQuantity === 0) {
      if (window.confirm('Remove this item from the invoice?')) {
        deleteItemMutation.mutate(item.id);
      }
    } else {
      updateItemMutation.mutate({
        itemId: item.id,
        data: { quantity: newQuantity },
      });
    }
  };

  const handleBarcodeScan = async (barcode: string) => {
    const currentItems = (queryClient.getQueryData(['invoice', invoiceId]) as any)?.data?.items
      ?? inv?.items
      ?? [];
    const result = await addScannedBarcodeToInvoice({
      barcode,
      items: currentItems,
      invoiceStatus: inv?.status,
      invoiceType: inv?.invoice_type,
      lookupBarcode: async (value) => {
        const response = await productsApi.byBarcode(value, true, true);
        return response.data;
      },
      // Direct API call avoids duplicate alerts from addItemMutation.onError + scan handler
      addItem: async (payload) => {
        await posApi.invoices.addItem(invoiceId, payload);
        await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
        await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
        queryClient.invalidateQueries({ queryKey: ['repair-invoices'] });
      },
    });
    if (!result.ok) {
      if (result.silent || !result.message) return;
      if (result.duplicate) {
        toast(result.message, 'info');
        setBarcodeInput('');
        setProductSearchSelectedIndex(-1);
        setIsSearchTyped(false);
      } else {
        alert(result.message);
      }
      return;
    }
    setBarcodeInput('');
    setProductSearchSelectedIndex(-1);
    setIsSearchTyped(false);
  };

  const handleDelete = () => {
    setDeleteRestoreStock(true); // Default to restoring stock
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = () => {
    const isDraftOrVoid = inv.status === 'draft' || inv.status === 'void';
    deleteInvoiceMutation.mutate({
      force: !isDraftOrVoid, // Force flag for non-draft/void invoices
      restoreStock: deleteRestoreStock
    });
  };

  // Shared function to generate invoice HTML for both print and download
  const generateInvoiceHTML = () => {
    const T = INV_THEME;
    const isRepairInvoice = !!inv?.repair;
    const printableInvoiceTitle = isRepairInvoice ? 'Repair Invoice' : 'Sale Invoice';
    const printableItems = Array.isArray(inv?.items) ? inv.items.filter((item: any) => !item?.replacement_ref) : [];

    const totalPcs = printableItems.reduce((sum: number, item: any) => sum + (parseInt(item.quantity || '0') || 0), 0);
    const totalAmount = getInvoiceAdjustedTotalValue(inv);
    const amountInWords = numberToWords(totalAmount);
    const invoiceDate = formatDateForInvoice(inv.created_at);
    const invoiceNo = inv.invoice_number || `#${inv.id}`;
    const shopName = INVOICE_SHOP_NAME;
    const companyAddress = 'Shop Number 124-A Ground Floor, Chaitaniya Market Ghoda Nikkas Bhopal';
    const customerName = inv.customer_name || 'Walk-in Customer';
    const storeName = inv.store_name || '';
    const statusLabel = String(inv.status || '').toUpperCase();
    const typeLabel = String(inv.invoice_type || 'sale').toUpperCase();

    // Group items by product name AND brand
    const groupedItems: Record<string, {
      name: string;
      brand: string;
      totalQuantity: number;
      totalAmount: number;
      items: any[];
    }> = {};

    printableItems.forEach((item: any) => {
      const name = item.product_name || '-';
      const brand = item.product_brand_name || item.brand_name || '';
      const groupKey = brand ? `${name}::${brand}` : name;
      if (!groupedItems[groupKey]) {
        groupedItems[groupKey] = { name, brand, totalQuantity: 0, totalAmount: 0, items: [] };
      }
      const quantity = parseInt(item.quantity || '0') || 0;
      const amount = parseFloat(item.line_total || '0');
      groupedItems[groupKey].totalQuantity += quantity;
      groupedItems[groupKey].totalAmount += amount;
      groupedItems[groupKey].items.push(item);
    });

    const groupedList = Object.values(groupedItems);
    const lineCount = groupedList.length;
    const subtotalBeforeTradeIn = groupedList.reduce((s, g) => s + g.totalAmount, 0);

    const bodyRows = groupedList
      .map((group, i) => {
        const avgUnitPrice = group.totalQuantity > 0 ? group.totalAmount / group.totalQuantity : 0;
        const productDisplay = group.brand ? `${group.name} (${group.brand})` : group.name;
        const productColor = getProductNameColor(group.name);
        const nameColor = productColor || T.text;
        const exchangeHtml = group.items
          .map((item: any) => formatExchangeSnapshotPrintHtml(exchangeSnapshotForItem(inv, item.id)))
          .join('');
        return `<tr style="background:${i % 2 === 1 ? T.rowAlt : T.white};">
      <td style="border:1px solid ${T.primaryBorder};padding:7px 8px;text-align:center;width:42px;font-size:12px;color:${T.secondaryMuted};font-weight:600;">${i + 1}</td>
      <td style="border:1px solid ${T.primaryBorder};padding:7px 8px;text-align:left;font-size:12px;font-weight:600;color:${nameColor};">${escapeHtml(productDisplay)}${exchangeHtml}</td>
      <td style="border:1px solid ${T.primaryBorder};padding:7px 8px;text-align:right;width:64px;font-size:12px;font-weight:600;">${escapeHtml(formatNumber(group.totalQuantity, 3))}</td>
      <td style="border:1px solid ${T.primaryBorder};padding:7px 8px;text-align:center;width:52px;font-size:12px;color:${T.textMuted};">Pcs.</td>
      <td style="border:1px solid ${T.primaryBorder};padding:7px 8px;text-align:right;width:80px;font-size:12px;">${escapeHtml(formatAmountINR(avgUnitPrice))}</td>
      <td style="border:1px solid ${T.primaryBorder};padding:7px 8px;text-align:right;width:96px;font-size:12px;font-weight:700;color:${T.secondary};">${escapeHtml(formatAmountINR(group.totalAmount))}</td>
    </tr>`;
      })
      .join('');

    const emptyRow = `<tr>
      <td colspan="6" style="border:1px solid ${T.primaryBorder};padding:28px;text-align:center;font-size:12px;color:#a8a29e;">No line items</td>
    </tr>`;

    const qtyFooterRow = `<tr>
      <td style="border:1px solid ${T.secondaryMuted};padding:7px 8px;background:${T.tableHead};"></td>
      <td style="border:1px solid ${T.secondaryMuted};padding:7px 8px;background:${T.tableHead};font-size:12px;font-weight:700;color:${T.secondary};">Total Quantity</td>
      <td colspan="2" style="border:1px solid ${T.secondaryMuted};padding:7px 8px;background:${T.tableHead};text-align:right;font-size:12px;font-weight:700;color:${T.secondary};">${escapeHtml(formatNumber(totalPcs, 3))} Pcs.</td>
      <td style="border:1px solid ${T.secondaryMuted};padding:7px 8px;background:${T.tableHead};"></td>
      <td style="border:1px solid ${T.secondaryMuted};padding:7px 8px;background:${T.tableHead};"></td>
    </tr>`;

    const summaryRow = (label: string, value: string, opts?: { muted?: boolean }) => `
      <tr>
        <td style="padding:8px 14px;font-size:12px;color:${opts?.muted ? T.textMuted : T.textMuted};font-weight:600;border-bottom:1px solid ${T.primaryBorder};">${label}</td>
        <td style="padding:8px 14px;font-size:12px;text-align:right;font-weight:700;color:${T.text};border-bottom:1px solid ${T.primaryBorder};">${value}</td>
      </tr>`;

    const fmtBal = (n: number) =>
      n < 0
        ? `₹ ${escapeHtml(formatAmountINR(Math.abs(n)))} (Cr)`
        : `₹ ${escapeHtml(formatAmountINR(n))}`;

    const showLedgerBalances = !!(inv.customer && customerHasCreditInvoice && inv.status !== 'paid');
    const totalLabel = `${tradeInCreditAmount > 0 ? 'Net Total' : 'Total'}${inv.replacement_summary ? ' (Adj.)' : ''}`;

    const summaryBlock = `
      <table style="width:100%;border-collapse:collapse;margin-top:14px;border:2px solid ${T.primary};font-size:12px;">
        <tr>
          <td colspan="2" style="padding:9px 14px;background:${T.primary};color:${T.white};font-weight:700;font-size:11px;letter-spacing:0.5px;text-transform:uppercase;">Invoice Summary</td>
        </tr>
        ${summaryRow('Total Items', `${escapeHtml(String(lineCount))} ${lineCount === 1 ? 'Line' : 'Lines'} · ${escapeHtml(formatNumber(totalPcs, 3))} Pcs.`)}
        ${summaryRow('Sub Total', `₹ ${escapeHtml(formatAmountINR(subtotalBeforeTradeIn))}`)}
        ${
          tradeInCreditAmount > 0
            ? summaryRow('Trade-in Credit', `− ₹ ${escapeHtml(formatAmountINR(tradeInCreditAmount))}`)
            : ''
        }
        ${
          inv.replacement_summary
            ? summaryRow('Original Invoice Total', `₹ ${escapeHtml(formatAmountINR(parseFloat(String(inv.total ?? 0)) || 0))}`)
            : ''
        }
        <tr>
          <td style="padding:9px 14px;font-size:12px;color:${T.white};font-weight:700;background:${T.primary};">${escapeHtml(totalLabel)}</td>
          <td style="padding:9px 14px;font-size:12px;text-align:right;font-weight:800;color:${T.white};background:${T.primary};">₹ ${escapeHtml(formatAmountINR(totalAmount))}</td>
        </tr>
        ${
          showLedgerBalances
            ? `
        ${summaryRow('Old Balance', fmtBal(prevBalance))}
        <tr>
          <td style="padding:9px 14px;font-size:12px;color:${T.white};font-weight:700;background:${T.secondary};">Total Outstanding</td>
          <td style="padding:9px 14px;font-size:12px;text-align:right;font-weight:800;color:${T.white};background:${T.secondary};">${fmtBal(totalOutstanding)}</td>
        </tr>`
            : ''
        }
      </table>
      ${tradeInCreditAmount > 0 ? buildTradeInDetailRowsA4Html(inv) : ''}
      <div style="margin-top:12px;padding:10px 14px;background:${T.white};border:1px solid ${T.primaryBorder};border-left:4px solid ${T.primary};font-size:12px;line-height:1.5;">
        <span style="color:${T.secondary};font-weight:700;">Amount in Words: </span>
        <span style="color:${T.text};font-weight:600;">${escapeHtml(amountInWords)}</span>
      </div>`;

    const voidBadge =
      inv.status === 'void'
        ? `<div style="margin-top:10px;display:inline-block;padding:3px 10px;font-size:11px;font-weight:700;text-transform:uppercase;border-radius:4px;border:1px solid #b91c1c;background:#fee2e2;color:#b91c1c;">Void</div>`
        : '';

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(printableInvoiceTitle)} ${escapeHtml(invoiceNo)}</title>
  <style>
    @media print {
      body { margin: 0; padding: 0; background: #fff !important; }
      #invoice-print-root { border: 3px solid ${T.primary} !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#e7e5e4;font-size:12px;">
  <div id="invoice-print-root" style="width:${INVOICE_CAPTURE_WIDTH_PX}px;min-height:${INVOICE_CAPTURE_HEIGHT_PX}px;margin:0 auto;background:${T.white};color:${T.text};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;box-sizing:border-box;display:flex;flex-direction:column;border:3px solid ${T.primary};">

    <div style="position:relative;overflow:hidden;background:${T.primary};padding:20px 28px;color:${T.white};">
      ${invoiceHeaderShapes()}
      <table style="position:relative;z-index:1;width:100%;border-collapse:collapse;color:${T.white};">
        <tr>
          <td style="vertical-align:middle;">
            <div style="font-size:24px;font-weight:800;letter-spacing:1px;text-transform:uppercase;line-height:1.2;color:${T.white};">${escapeHtml(shopName)}</div>
            <div style="font-size:11px;font-weight:600;margin-top:5px;letter-spacing:0.5px;text-transform:uppercase;color:${T.white};">${escapeHtml(printableInvoiceTitle)}</div>
            <div style="font-size:11px;margin-top:6px;color:rgba(255,255,255,0.9);font-weight:500;line-height:1.35;">${escapeHtml(companyAddress)}</div>
          </td>
          <td style="vertical-align:middle;text-align:right;width:240px;color:${T.white};">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:${T.white};">Invoice No.</div>
            <div style="font-size:15px;font-weight:800;margin-top:4px;letter-spacing:0.3px;color:${T.white};">${escapeHtml(invoiceNo)}</div>
          </td>
        </tr>
      </table>
    </div>

    <table style="width:100%;border-collapse:collapse;table-layout:fixed;background:${T.primaryPale};border-bottom:2px solid ${T.primaryBorder};font-size:12px;">
      <tr>
        <td style="width:58%;vertical-align:top;padding:14px 20px;border-right:1px solid ${T.primaryBorder};">
          <div style="font-size:11px;font-weight:700;color:${T.secondary};text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px;">Bill To</div>
          <div style="font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:0.2px;color:${T.text};line-height:1.25;">${escapeHtml(customerName)}</div>
          ${storeName ? `<div style="font-size:12px;color:${T.textMuted};margin-top:4px;font-weight:600;">Store: ${escapeHtml(storeName)}</div>` : ''}
          ${voidBadge}
        </td>
        <td style="width:42%;vertical-align:top;padding:14px 20px;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <tr>
              <td style="padding:0 0 8px 0;font-weight:600;color:${T.secondaryMuted};white-space:nowrap;">Invoice No.</td>
              <td style="padding:0 0 8px 0;font-weight:800;text-align:right;color:${T.secondary};">${escapeHtml(invoiceNo)}</td>
            </tr>
            <tr>
              <td style="padding:0 0 8px 0;font-weight:600;color:${T.secondaryMuted};white-space:nowrap;">Dated</td>
              <td style="padding:0 0 8px 0;font-weight:700;text-align:right;color:${T.text};">${escapeHtml(invoiceDate)}</td>
            </tr>
            <tr>
              <td style="padding:0 0 8px 0;font-weight:600;color:${T.secondaryMuted};white-space:nowrap;">Type</td>
              <td style="padding:0 0 8px 0;text-align:right;font-weight:700;color:${T.primary};">${escapeHtml(typeLabel)}</td>
            </tr>
            <tr>
              <td style="padding:0;font-weight:600;color:${T.secondaryMuted};white-space:nowrap;">Status</td>
              <td style="padding:0;text-align:right;font-weight:700;color:${T.text};">${escapeHtml(statusLabel || '—')}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <table style="width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;flex-shrink:0;">
      <thead>
        <tr style="background:${T.tableHead};">
          <th style="border:1px solid ${T.secondaryMuted};padding:8px 6px;text-align:center;font-weight:700;color:${T.secondary};width:42px;font-size:11px;">S.N.</th>
          <th style="border:1px solid ${T.secondaryMuted};padding:8px 8px;text-align:left;font-weight:700;color:${T.secondary};font-size:11px;">Description of Goods</th>
          <th style="border:1px solid ${T.secondaryMuted};padding:8px 6px;text-align:right;font-weight:700;color:${T.secondary};width:64px;font-size:11px;">Qty.</th>
          <th style="border:1px solid ${T.secondaryMuted};padding:8px 6px;text-align:center;font-weight:700;color:${T.secondary};width:52px;font-size:11px;">Unit</th>
          <th style="border:1px solid ${T.secondaryMuted};padding:8px 6px;text-align:right;font-weight:700;color:${T.secondary};width:80px;font-size:11px;">Rate (₹)</th>
          <th style="border:1px solid ${T.secondaryMuted};padding:8px 8px;text-align:right;font-weight:700;color:${T.secondary};width:96px;font-size:11px;">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows || emptyRow}
        ${qtyFooterRow}
      </tbody>
    </table>

    <div style="flex:1;min-height:20px;"></div>

    <div style="position:relative;overflow:hidden;padding:16px 24px 20px;border-top:3px solid ${T.primary};background:${T.primaryPale};">
      ${invoiceFooterShapes()}
      ${summaryBlock}
      <table style="position:relative;width:100%;border-collapse:collapse;font-size:12px;margin-top:18px;">
        <tr>
          <td style="width:50%;vertical-align:bottom;padding:0 16px 0 0;">
            <div style="font-weight:700;color:${T.secondary};text-transform:uppercase;letter-spacing:0.4px;font-size:11px;">Declaration</div>
            <div style="font-size:12px;color:${T.textMuted};margin-top:5px;line-height:1.45;">We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.</div>
          </td>
          <td style="width:50%;vertical-align:bottom;text-align:center;padding:0 0 0 16px;">
            <div style="font-size:12px;font-weight:700;color:${T.secondary};margin-bottom:28px;">for ${escapeHtml(shopName)}</div>
            <div style="display:inline-block;border-top:2px solid ${T.secondaryMuted};padding:5px 18px 0;font-size:12px;font-weight:700;color:${T.secondary};">Authorised Signatory</div>
          </td>
        </tr>
      </table>
      <div style="position:relative;margin-top:14px;text-align:center;font-size:11px;color:${T.textMuted};">This is a Computer Generated Invoice · ${escapeHtml(shopName)}</div>
    </div>
  </div>
</body>
</html>`;
  };

  const handlePrint = () => {
    // Create a printable version of the invoice using the same HTML as download
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const invoiceHTML = generateInvoiceHTML();
    printWindow.document.write(invoiceHTML);
    printWindow.document.close();

    // Wait for content to load, then trigger print
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
      }, 250);
    };
  };

  const handleDownload = () => {
    // Create a printable version of the invoice (same as print)
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const invoiceHTML = generateInvoiceHTML();
    printWindow.document.write(invoiceHTML);
    printWindow.document.close();

    // Wait for content to load, then trigger print or save as PDF
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
        // Note: Browser will handle PDF download through print dialog
      }, 250);
    };
  };

  const handleCapturePhoto = async () => {
    const iframe = invoiceCaptureFrameRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) {
      toast('Invoice preview is not ready. Please wait a moment and try again.', 'error');
      return;
    }
    try {
      doc.open();
      doc.write(generateInvoiceHTML());
      doc.close();
      await new Promise((r) => window.setTimeout(r, 150));

      const root =
        (doc.getElementById('invoice-print-root') as HTMLElement | null) || doc.body;
      const w = INVOICE_CAPTURE_WIDTH_PX;
      const h = Math.max(
        INVOICE_CAPTURE_HEIGHT_PX,
        Math.ceil(root.scrollHeight || root.offsetHeight || 1)
      );
      iframe.style.height = `${h + 8}px`;

      const canvas = await html2canvas(root, {
        scale: invoiceCaptureScale(),
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: w,
        windowHeight: h,
        width: w,
        height: h,
      });
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            toast('Failed to create image.', 'error');
            return;
          }
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(
            () => toast('Invoice image copied to clipboard.', 'success'),
            () => toast('Failed to copy to clipboard. Please check permissions.', 'error')
          );
        },
        'image/png',
        1
      );
    } catch (e) {
      toast('Failed to capture invoice preview.', 'error');
    }
  };

  const generateThermalInvoiceHTML = (invoice: any) => {
    const printableItems = Array.isArray(invoice?.items)
      ? invoice.items.filter((item: any) => !item?.replacement_ref)
      : [];

    const formatDate = (dateString: string) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    return `
  <!DOCTYPE html>
    <html>
      <head>
        <title>Invoice ${invoice.invoice_number || invoice.id}</title>
        <meta charset="UTF-8">
          <style>
            * {margin: 0; padding: 0; box-sizing: border-box; }
            @page {size: 4in auto; margin: 0.1in; }
            body {
              font-family: 'Courier New', monospace;
            font-size: 10px;
            width: 4in;
            max-width: 4in;
            padding: 5px;
            color: #000;
            }
            .header {
              text-align: center;
            margin-bottom: 8px;
            border-bottom: 1px dashed #000;
            padding-bottom: 5px; 
            }
            .header h1 {font-size: 14px; margin-bottom: 3px; font-weight: bold; }
            .header p {font-size: 9px; margin: 1px 0; }
            .info {margin-bottom: 6px; font-size: 9px; }
            .info-row {margin: 2px 0; }
            table {width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 9px; }
            th {padding: 3px 2px; text-align: left; border-bottom: 1px dashed #000; font-weight: bold; }
            td {padding: 2px; border-bottom: 1px dotted #ccc; }
            .text-right {text-align: right; }
            .text-center {text-align: center; }
            .summary {margin-top: 6px; border-top: 1px dashed #000; padding-top: 4px; }
            .summary-row {display: flex; justify-content: space-between; padding: 2px 0; font-size: 9px; }
            .summary-total {border-top: 1px solid #000; margin-top: 4px; padding-top: 4px; font-weight: bold; font-size: 11px; }
            .footer {margin-top: 8px; padding-top: 4px; border-top: 1px dashed #000; text-align: center; font-size: 8px; }
            /* Watermark - positioned relative to content area */
            body {position: relative; }
            .watermark {
              position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-45deg);
            font-size: 60px;
            font-weight: bold;
            color: rgba(0, 0, 0, 0.08);
            z-index: -1;
            pointer-events: none;
            white-space: nowrap;
            text-transform: uppercase;
            letter-spacing: 5px;
            width: 100%;
            text-align: center;
            }
            @media print {
              body {padding: 0; margin: 0; position: relative; }
            .no-print {display: none; }
            .watermark {
              position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-45deg);
            font-size: 60px;
            font-weight: bold;
            color: rgba(0, 0, 0, 0.08);
            z-index: -1;
            pointer-events: none;
            white-space: nowrap;
            text-transform: uppercase;
            letter-spacing: 5px;
            width: 100%;
            text-align: center;
              }
            }
          </style>
      </head>
      <body>
        <!-- Watermark -->
        <div class="watermark">${(invoice.invoice_type || 'sale').toUpperCase()}</div>

        <div class="header">
          <h1>INVOICE</h1>
          <p>${invoice.invoice_number || `#${invoice.id}`}</p>
          <p>${formatDate(invoice.created_at)}</p>
        </div>
        <div class="info">
          <div class="info-row"><strong>Store:</strong> ${invoice.store_name || '-'}</div>
          <div class="info-row"><strong>Customer:</strong> ${invoice.customer_name || 'Walk-in Customer'}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th class="text-right">Qty</th>
              <th class="text-right">Price</th>
              <th class="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${printableItems.length > 0 ? (() => {
        // Group items by product name AND brand for thermal layout
        const groupedItems: Record<string, {
          name: string;
          brand: string;
          totalQuantity: number;
          totalAmount: number;
          avgPrice: number;
          items: any[];
        }> = {};

        printableItems.forEach((item: any) => {
          const name = item.product_name || '-';
          const brand = item.product_brand_name || item.brand_name || '';
          const groupKey = brand ? `${name}::${brand}` : name;

          if (!groupedItems[groupKey]) {
            groupedItems[groupKey] = {
              name,
              brand,
              totalQuantity: 0,
              totalAmount: 0,
              avgPrice: 0,
              items: []
            };
          }

          const quantity = parseInt(item.quantity || '0') || 0;
          const amount = parseFloat(item.line_total || '0');
          groupedItems[groupKey].totalQuantity += quantity;
          groupedItems[groupKey].totalAmount += amount;
          groupedItems[groupKey].items.push(item);
        });

        // Calculate average price for each group
        Object.values(groupedItems).forEach(group => {
          group.avgPrice = group.totalQuantity > 0
            ? group.totalAmount / group.totalQuantity
            : 0;
        });

        // Render grouped items
        return Object.values(groupedItems).map((group) => {
          const productDisplay = group.brand
            ? `${group.name} (${group.brand})`
            : group.name;
          // Truncate for thermal printer (max 20 chars)
          const displayText = productDisplay.substring(0, 20);
          const productColor = getProductNameColor(group.name);
          const productColorStyle = productColor ? ` style="color: ${productColor};"` : '';

          const exchangeRows = group.items
            .map((item: any) => {
              const note = formatExchangeSnapshotNote(exchangeSnapshotForItem(invoice, item.id));
              if (!note) return '';
              return `<tr><td colspan="4" style="font-size:8px;padding-top:0;padding-bottom:4px;line-height:1.25;">${escapeHtml(note)}</td></tr>`;
            })
            .join('');
          const replacementRows = group.items
            .map((item: any) => {
              const rep = item?.replacement_ref;
              if (!rep) return '';
              const tag = rep?.return_tag ? escapeHtml(formatTradeInReturnTag(rep.return_tag)) : '—';
              const ref = rep?.invoice_number || rep?.invoice_id || '—';
              return `<tr><td colspan="4" style="font-size:8px;padding-top:0;padding-bottom:4px;line-height:1.25;color:#065f46;">Replacement ${escapeHtml(String(ref))} · ${tag}</td></tr>`;
            })
            .join('');

          return `
                    <tr>
                      <td${productColorStyle}>${displayText}</td>
                      <td class="text-right">${group.totalQuantity}</td>
                      <td class="text-right">₹${formatNumber(group.avgPrice)}</td>
                      <td class="text-right">₹${formatNumber(group.totalAmount)}</td>
                </tr>
                  ${exchangeRows}${replacementRows}`;
        }).join('');
      })() : '<tr><td colspan="4">No items</td></tr>'}
          </tbody>
        </table>
        <div class="summary">
          <div class="summary-row">
            <span>Subtotal:</span>
            <span>₹${formatNumber(invoice.subtotal || '0')}</span>
          </div>
          ${parseFloat(invoice.discount_amount || '0') > 0 ? `
            <div class="summary-row">
              <span>Discount:</span>
              <span>-₹${formatNumber(invoice.discount_amount || '0')}</span>
            </div>
            ` : ''}
          ${parseFloat(invoice.tax_amount || '0') > 0 ? `
            <div class="summary-row">
              <span>Tax:</span>
              <span>₹${formatNumber(invoice.tax_amount || '0')}</span>
            </div>
            ` : ''}
          ${parseFloat(invoice.trade_in_credit || '0') > 0 ? `
            <div class="summary-row">
              <span>Trade-in:</span>
              <span>-₹${formatNumber(invoice.trade_in_credit || '0')}</span>
            </div>
            ${buildTradeInDetailThermalHtml(invoice)}
            ` : ''}
          <div class="summary-row">
            <span>Transport Charge:</span>
            <span>₹${formatNumber(0)}</span>
          </div>
          <div class="summary-row summary-total">
            <span>TOTAL:</span>
            <span>₹${formatNumber(getInvoiceAdjustedTotalValue(invoice))}</span>
          </div>
          ${invoice.customer && customerHasCreditInvoice && invoice.status !== 'paid' ? `
          <div class="summary-row" style="margin-top: 4px; padding-top: 4px; border-top: 1px dotted #ccc;">
            <span>Old Balance:</span>
            <span>${prevBalance < 0 ? formatNumber(Math.abs(prevBalance)) + ' (Cr)' : '₹' + formatNumber(prevBalance)}</span>
          </div>
          <div class="summary-row summary-total" style="border-top: 1px dashed #000;">
            <span>TOTAL OUTSTANDING:</span>
            <span>${totalOutstanding < 0 ? formatNumber(Math.abs(totalOutstanding)) + ' (Cr)' : '₹' + formatNumber(totalOutstanding)}</span>
          </div>
          ` : ''}
          ${parseFloat(invoice.paid_amount || '0') > 0 ? `
            <div class="summary-row">
              <span>Paid:</span>
              <span>₹${formatNumber(invoice.paid_amount || '0')}</span>
            </div>
            ` : ''}
          ${parseFloat(invoice.due_amount || '0') > 0 ? `
            <div class="summary-row">
              <span>Due:</span>
              <span>₹${formatNumber(invoice.due_amount || '0')}</span>
            </div>
            ` : ''}
        </div>
        <div class="footer">
          <p>Thank you for your business!</p>
        </div>
      </body>
    </html>
`;
  };

  const handlePrintThermal = () => {
    if (!inv) return;

    const thermalHTML = generateThermalInvoiceHTML(inv);
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print invoice');
      return;
    }

    printWindow.document.write(thermalHTML);
    printWindow.document.close();

    // Wait for content to load, then trigger print
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
      }, 250);
    };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="no-print space-y-4">
        {/* Back Button */}
        <Button
          variant="outline"
          onClick={() => {
            if (window.history.length > 1) {
              navigate(-1);
              return;
            }
            navigate(invoicesListPath);
          }}
          className="w-full sm:w-auto"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        {/* Main Header Card */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          {/* Top Section: Invoice Info */}
          <div className="p-4 sm:p-6 border-b border-gray-100 overflow-visible">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              {/* Invoice Details */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex-shrink-0 p-2.5 bg-blue-50 rounded-lg border border-blue-100">
                  <FileText className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">
                    {inv.invoice_number || `Invoice #${inv.id} `}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {invoiceTags.map((tag) => (
                      <InvoiceTagChip key={tag.id} tag={tag} size="sm" />
                    ))}
                    <InvoiceTagEditor
                      invoiceId={inv.id}
                      tags={invoiceTags}
                      onUpdated={(tags) => {
                        queryClient.setQueryData(['invoice', invoiceId], (old: any) => {
                          if (!old?.data) return old;
                          return { ...old, data: { ...old.data, tags } };
                        });
                        queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
                        queryClient.invalidateQueries({ queryKey: ['invoices'] });
                        queryClient.invalidateQueries({
                          predicate: (query) => String(query.queryKey[0] || '').startsWith('repair-invoices-section'),
                        });
                      }}
                    />
                    {invoiceTags.length === 0 && (
                      <span className="text-xs text-gray-400">Add one or more tags</span>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1.5">
                    Created on {formatDate(inv.created_at)}
                  </p>
                </div>
              </div>

              {/* Top-right status block */}
              <div className="flex-shrink-0 w-full sm:w-auto">
                {inv?.repair ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-[320px]">
                    <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5">
                      <p className="text-[11px] uppercase tracking-wide text-indigo-700 font-semibold">Invoice Type</p>
                      <p className="text-base sm:text-lg font-bold text-indigo-900 mt-0.5">{invoiceTypeLabel}</p>
                    </div>
                    <div className={`rounded-lg border px-3 py-2.5 ${repairStatusBadgeClass}`}>
                      <p className="text-[11px] uppercase tracking-wide font-semibold">Repair Status</p>
                      <p className="text-base sm:text-lg font-bold mt-0.5">{repairStatusLabel}</p>
                    </div>
                  </div>
                ) : (
                  <Badge variant={statusInfo.color} className="w-full sm:w-auto justify-center sm:justify-start text-sm px-3 py-2">
                    <StatusIcon className="h-4 w-4 mr-1.5" />
                    {statusInfo.label}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Actions Section */}
          <div className="p-4 sm:p-6 bg-gray-50">
            <div className="flex flex-col sm:flex-row gap-3 sm:justify-end sm:items-center">
              {/* Primary Action */}
              {isPending && (
                <Button
                  variant="primary"
                  onClick={handleCheckout}
                  className="w-full sm:w-auto sm:min-w-[160px]"
                  disabled={checkoutMutation.isPending}
                >
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  {checkoutMutation.isPending ? 'Processing...' : 'Checkout'}
                </Button>
              )}
              {/* Move to Ledger: show when bill is paid (to move paid bill to ledger or mark as credit) */}
              {inv.status === 'paid' && !isReplacementReturn && (
                <Button
                  variant="primary"
                  onClick={handleMoveToLedger}
                  className="w-full sm:w-auto sm:min-w-[160px]"
                  disabled={markCreditMutation.isPending}
                >
                  <BookOpen className="h-4 w-4 mr-2" />
                  {markCreditMutation.isPending ? 'Moving...' : 'Move to Ledger'}
                </Button>
              )}

              {/* Secondary Actions */}
              <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
                {/* Edit invoice (items via cart) */}
                {canEditItems && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => editInvoiceMutation.mutate()}
                    className="w-full sm:w-auto"
                    disabled={editInvoiceMutation.isPending}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    {editInvoiceMutation.isPending ? 'Opening...' : 'Edit invoice'}
                  </Button>
                )}

                {/* Print & Download */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePrint}
                    className="flex-1 sm:flex-none"
                  >
                    <Printer className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Print</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePrintThermal}
                    className="flex-1 sm:flex-none"
                  >
                    <Printer className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Thermal</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownload}
                    className="flex-1 sm:flex-none"
                  >
                    <Download className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Download</span>
                  </Button>
                </div>

                {/* Delete */}
                {!isRestrictedUser && !isReplacementReturn && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleDelete}
                    className="w-full sm:w-auto"
                    disabled={deleteInvoiceMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {deleteInvoiceMutation.isPending ? 'Deleting...' : 'Delete'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Invoice Information & Financial Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 print-area">
        {/* Invoice Information */}
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Invoice Information</h3>
          <dl className="space-y-4">
            <div className="flex items-start gap-3">
              <Store className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <dt className="text-sm font-medium text-gray-500 mb-1 flex items-center gap-2">
                  Store
                  {!isRestrictedUser && (
                    <button
                      onClick={() => {
                        setSelectedStoreId(inv.store || null);
                        setEditingStore(true);
                      }}
                      className="p-1 rounded hover:bg-gray-100 transition-colors"
                      title="Edit store"
                    >
                      <Pencil className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600" />
                    </button>
                  )}
                </dt>
                {editingStore ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={selectedStoreId || ''}
                      onChange={(e) => setSelectedStoreId(e.target.value ? parseInt(e.target.value) : null)}
                      className="flex-1 text-sm"
                    >
                      <option value="">Select a store</option>
                      {stores.map((store: any) => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      onClick={() => {
                        if (selectedStoreId && selectedStoreId !== inv.store) {
                          updateInvoiceMutation.mutate({ store: selectedStoreId });
                        } else {
                          setEditingStore(false);
                        }
                      }}
                      disabled={updateInvoiceMutation.isPending || !selectedStoreId}
                    >
                      {updateInvoiceMutation.isPending ? 'Saving...' : 'Save'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingStore(false);
                        setSelectedStoreId(inv.store || null);
                      }}
                      disabled={updateInvoiceMutation.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <dd className="text-sm text-gray-900">{inv.store_name || '-'}</dd>
                )}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <User className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <dt className="text-sm font-medium text-gray-500 mb-1 flex items-center gap-2">
                  Customer
                  {!isRestrictedUser && (
                    <button
                      onClick={() => {
                        setSelectedCustomerId(inv.customer ?? null);
                        setCustomerSearchQuery(inv.customer_name || 'Walk-in (no customer)');
                        setCustomerDropdownOpen(true);
                        setEditingCustomer(true);
                      }}
                      className="p-1 rounded hover:bg-gray-100 transition-colors"
                      title="Edit customer"
                    >
                      <Pencil className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600" />
                    </button>
                  )}
                </dt>
                {editingCustomer ? (
                  <div className="flex flex-col gap-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="relative flex-1 min-w-[200px]" ref={customerDropdownRef}>
                        <Input
                          type="text"
                          placeholder="Type to search customers..."
                          value={customerSearchQuery}
                          onChange={(e) => {
                            setCustomerSearchQuery(e.target.value);
                            setCustomerDropdownOpen(true);
                          }}
                          onFocus={() => setCustomerDropdownOpen(true)}
                          className="text-sm w-full"
                          autoComplete="off"
                        />
                        {customerDropdownOpen && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-56 overflow-y-auto">
                            <button
                              type="button"
                              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 border-b border-gray-100 ${selectedCustomerId === null ? 'bg-blue-50 font-medium' : ''}`}
                              onClick={() => {
                                setSelectedCustomerId(null);
                                setCustomerSearchQuery('Walk-in (no customer)');
                                setCustomerDropdownOpen(false);
                              }}
                            >
                              Walk-in (no customer)
                            </button>
                            {customers.map((c: any) => (
                              <button
                                key={c.id}
                                type="button"
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 border-b border-gray-100 last:border-0 ${selectedCustomerId === c.id ? 'bg-blue-50 font-medium' : ''}`}
                                onClick={() => {
                                  setSelectedCustomerId(c.id);
                                  setCustomerSearchQuery(c.name + (c.phone ? ` – ${c.phone}` : ''));
                                  setCustomerDropdownOpen(false);
                                }}
                              >
                                {c.name}
                                {c.phone ? ` – ${c.phone}` : ''}
                              </button>
                            ))}
                            {customers.length === 0 && debouncedCustomerSearch && (
                              <div className="px-3 py-4 text-sm text-gray-500 text-center">No customers found</div>
                            )}
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        onClick={() => {
                          const newId = selectedCustomerId ?? null;
                          const currentId = inv.customer ?? null;
                          if (newId !== currentId) {
                            updateInvoiceMutation.mutate({ customer: newId });
                          } else {
                            setEditingCustomer(false);
                          }
                        }}
                        disabled={updateInvoiceMutation.isPending}
                      >
                        {updateInvoiceMutation.isPending ? 'Saving...' : 'Save'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingCustomer(false);
                          setSelectedCustomerId(inv.customer ?? null);
                          setCustomerSearchQuery('');
                          setCustomerDropdownOpen(false);
                        }}
                        disabled={updateInvoiceMutation.isPending}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <dd className="text-sm text-gray-900">{inv.customer_name || 'Walk-in'}</dd>
                )}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <dt className="text-sm font-medium text-gray-500 mb-1 flex items-center gap-2">
                  Invoice Type
                  {!isRestrictedUser && (
                    <button
                      onClick={() => {
                        setSelectedInvoiceType(inv.invoice_type || 'cash');
                        setEditingInvoiceType(true);
                      }}
                      className="p-1 rounded hover:bg-gray-100 transition-colors"
                      title="Edit invoice type"
                    >
                      <Pencil className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600" />
                    </button>
                  )}
                </dt>
                {editingInvoiceType ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={selectedInvoiceType}
                      onChange={(e) => setSelectedInvoiceType(e.target.value)}
                      className="flex-1 text-sm"
                    >
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                      <option value="mixed">Cash + UPI</option>
                      <option value="credit">Credit</option>
                      <option value="pending">Pending</option>
                      <option value="defective">Defective</option>
                    </Select>
                    <Button
                      size="sm"
                      onClick={() => {
                        if (selectedInvoiceType !== inv.invoice_type) {
                          const isSaleType = selectedInvoiceType === 'cash' || selectedInvoiceType === 'upi' || selectedInvoiceType === 'mixed';
                          if (isSaleType) {
                            const inferredType = getEffectiveInvoiceTypeFromPayments(inv.payments || []);
                            if (inferredType && inferredType !== selectedInvoiceType) {
                              alert(`Payments currently indicate ${inferredType.toUpperCase()}. Update payments to match ${selectedInvoiceType.toUpperCase()} first.`);
                              const editablePayment = Array.isArray(inv.payments)
                                ? inv.payments.find((payment: any) => payment && payment.payment_method !== 'refund')
                                : null;
                              if (editablePayment) {
                                openPaymentEditor(editablePayment, selectedInvoiceType as 'cash' | 'upi' | 'mixed');
                              }
                              setEditingInvoiceType(false);
                              return;
                            }
                          }
                          updateInvoiceMutation.mutate({ invoice_type: selectedInvoiceType });
                        } else {
                          setEditingInvoiceType(false);
                        }
                      }}
                      disabled={updateInvoiceMutation.isPending}
                    >
                      {updateInvoiceMutation.isPending ? 'Saving...' : 'Save'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingInvoiceType(false);
                        setSelectedInvoiceType(inv.invoice_type || 'cash');
                      }}
                      disabled={updateInvoiceMutation.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <dd className="text-sm text-gray-900 capitalize">{inv.invoice_type || 'Sale'}</dd>
                )}
              </div>
            </div>
            {inv.notes && (
              <div className="flex items-start gap-3">
                <FileText className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <dt className="text-sm font-medium text-gray-500 mb-1">Notes</dt>
                  <dd className="text-sm text-gray-900 leading-relaxed">{inv.notes}</dd>
                </div>
              </div>
            )}
          </dl>
        </Card>

        {/* Financial Summary */}
        <Card className="lg:col-span-2">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Coins className="h-5 w-5 text-gray-400" />
            Financial Summary
          </h3>
          <div className="space-y-3">
            {isPending ? (
              // For pending invoices, show totals as 0
              <>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-gray-600">Subtotal</span>
                  <span className="text-sm font-medium text-gray-900">₹{formatNumber('0')}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-gray-600">Transport Charge</span>
                  <span className="text-sm font-medium text-gray-900">₹{formatNumber(0)}</span>
                </div>
                <div className="border-t border-gray-200 pt-3 mt-3 flex justify-between items-center">
                  <span className="text-base font-semibold text-gray-900">Total</span>
                  <span className="text-lg font-bold text-gray-900">₹{formatNumber('0')}</span>
                </div>
                {inv.customer && customerHasCreditInvoice && inv.status !== 'paid' && (
                  <>
                    <div className="flex justify-between items-center py-2 border-t border-dashed border-gray-200 mt-2 pt-2">
                      <span className="text-sm text-gray-600">Old Balance</span>
                      <span className={`text-sm font-medium ${prevBalance < 0 ? "text-green-600" : "text-gray-900"}`}>{formatBalance(prevBalance)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-t border-double border-gray-900 mt-2 pt-2">
                      <span className="text-sm font-bold text-gray-900">Total Outstanding</span>
                      <span className={`text-base font-bold ${totalOutstanding < 0 ? "text-green-600" : "text-blue-600"}`}>{formatBalance(totalOutstanding)}</span>
                    </div>
                  </>
                )}
              </>
            ) : (
              // For other invoices, show actual totals
              <>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-gray-600">Subtotal (new sale lines)</span>
                  <span className="text-sm font-medium text-gray-900">₹{formatNumber(inv.subtotal || '0')}</span>
                </div>
                {tradeInCreditAmount > 0 && (
                  <>
                    <div className="flex justify-between items-center py-2 bg-emerald-50/80 -mx-1 px-2 rounded-md border border-emerald-100">
                      <span className="text-sm font-medium text-emerald-900">Trade-in credit (prior sale)</span>
                      <span className="text-sm font-semibold text-emerald-900 tabular-nums">
                        −₹{formatNumber(tradeInCreditAmount)}
                      </span>
                    </div>
                    {tradeInDetailTableEl ? (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-emerald-900/90">Trade-in line detail</p>
                        {tradeInDetailTableEl}
                      </div>
                    ) : (
                      <p className="text-xs text-amber-900 bg-amber-50/90 border border-amber-200 rounded-md px-2 py-2">
                        Trade-in credit is applied on this invoice, but per-line detail was not stored (older checkout).
                      </p>
                    )}
                  </>
                )}
                {parseFloat(inv.discount_amount || '0') > 0 && (
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-gray-600">Discount</span>
                    <span className="text-sm font-medium text-red-600">-₹{formatNumber(inv.discount_amount || '0')}</span>
                  </div>
                )}
                {parseFloat(inv.tax_amount || '0') > 0 && (
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-gray-600">Tax</span>
                    <span className="text-sm font-medium text-gray-900">₹{formatNumber(inv.tax_amount || '0')}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-gray-600">Transport Charge</span>
                  <span className="text-sm font-medium text-gray-900">₹{formatNumber(0)}</span>
                </div>
                <div className="border-t border-gray-200 pt-3 mt-3 flex justify-between items-center">
                  <span className="text-base font-semibold text-gray-900">Total</span>
                  <span className="text-lg font-bold text-gray-900">
                    ₹{formatNumber(inv.replacement_summary?.adjusted_total ?? inv.total ?? '0')}
                  </span>
                </div>
                {inv.replacement_summary && (
                  <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-emerald-900">Replacement credit impact</span>
                      <span className="text-sm font-semibold text-emerald-900">
                        -₹{formatNumber(inv.replacement_summary.total_credit || '0')}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-emerald-900/80">Original invoice total</span>
                      <span className="text-sm font-semibold text-emerald-900">
                        ₹{formatNumber(inv.total || '0')}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-emerald-900/80">Adjusted total (for reshare)</span>
                      <span className="text-sm font-bold text-emerald-900">
                        ₹{formatNumber(inv.replacement_summary.adjusted_total || '0')}
                      </span>
                    </div>
                  </div>
                )}
                {inv.customer && customerHasCreditInvoice && inv.status !== 'paid' && (
                  <>
                    <div className="flex justify-between items-center py-2 border-t border-dashed border-gray-200 mt-2 pt-2">
                      <span className="text-sm text-gray-600">Old Balance</span>
                      <span className={`text-sm font-medium ${prevBalance < 0 ? "text-green-600" : "text-gray-900"}`}>{formatBalance(prevBalance)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-t border-double border-gray-900 mt-2 pt-2">
                      <span className="text-sm font-bold text-gray-900">Total Outstanding</span>
                      <span className={`text-base font-bold ${totalOutstanding < 0 ? "text-green-600" : "text-blue-600"}`}>{formatBalance(totalOutstanding)}</span>
                    </div>
                  </>
                )}
              </>
            )}
            {parseFloat(inv.paid_amount || '0') > 0 && (
              <div className="flex justify-between items-center py-2 bg-green-50 rounded-lg px-3">
                <span className="text-sm font-medium text-green-700">Paid</span>
                <span className="text-sm font-semibold text-green-700">₹{formatNumber(inv.paid_amount || '0')}</span>
              </div>
            )}
            {parseFloat(inv.due_amount || '0') > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between items-center py-2 bg-red-50 rounded-lg px-3">
                  <span className="text-sm font-medium text-red-700">Due</span>
                  <span className="text-sm font-semibold text-red-700">₹{formatNumber(inv.due_amount || '0')}</span>
                </div>
                <Button
                  onClick={() => {
                    setPaymentAmount(inv.due_amount || '0');
                    setShowPaymentModal(true);
                  }}
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                >
                  Settle Up
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Invoice Items */}
      {visibleInvoiceItems.length > 0 && (
        <Card className="print-area">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-gray-400" />
            Invoice Items ({(() => {
              if (visibleInvoiceItems.length === 0) return 0;
              return groupItemsByProduct(visibleInvoiceItems).length;
            })()})
          </h3>
          {/* Desktop Table View */}
          <div className="hidden md:block">
            {(() => {
              const groupedItems = groupItemsByProduct(visibleInvoiceItems);

              if (isPending) {
                // For pending invoices, show only Product, SKU, and Quantity
                return (
                  <Table headers={['Product', 'SKU', 'Quantity']}>
                    {groupedItems.map((group, groupIndex) => {
                      const groupKey = `invoice_group_${group.productId}_${groupIndex} `;
                      const isExpanded = expandedInvoiceItems[groupKey] || false;
                      const totalQuantity = group.items.reduce((sum, item) => sum + (parseInt(item.quantity || '0') || 0), 0);
                      const barcodes = group.items.map(item => ({
                        barcode: item.barcode_value || item.product_sku || 'N/A',
                        item: item
                      }));

                      return (
                        <>
                          <TableRow key={groupKey}>
                            <TableCell>
                              <span className="font-medium text-gray-900" style={getProductNameColor(group.productName) ? { color: getProductNameColor(group.productName) } : undefined}>{group.productName}</span>
                            </TableCell>
                            <TableCell>
                              <button
                                onClick={() => setExpandedInvoiceItems({ ...expandedInvoiceItems, [groupKey]: !isExpanded })}
                                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 font-mono"
                              >
                                <span>{barcodes.length} Barcode{barcodes.length > 1 ? 's' : ''}</span>
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </button>
                              {barcodes.length === 1 ? (
                                <CartLineScannedTime item={barcodes[0].item} variant="row" />
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <span className="text-gray-600 font-semibold">{totalQuantity}</span>
                            </TableCell>
                          </TableRow>
                          {isExpanded && barcodes.map((barcodeItem, barcodeIndex) => (
                            <TableRow key={`${groupKey}_barcode_${barcodeIndex} `} className="bg-gray-50">
                              <TableCell className="pl-12">
                                <span className="text-xs text-gray-500" style={getProductNameColor(group.productName) ? { color: getProductNameColor(group.productName) } : undefined}>↳ {group.productName}</span>
                              </TableCell>
                              <TableCell>
                                <span className="text-xs text-gray-600 font-mono">{barcodeItem.barcode}</span>
                                <CartLineScannedTime item={barcodeItem.item} variant="row" />
                              </TableCell>
                              <TableCell>
                                <span className="text-xs text-gray-600 font-semibold">{barcodeItem.item.quantity}</span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </>
                      );
                    })}
                  </Table>
                );
              } else {
                // For other invoices, show full details with prices
                return (
                  <Table headers={['Product', 'SKU', 'Quantity', 'Unit Price', 'Discount', 'Tax', 'Total']}>
                    {groupedItems.map((group, groupIndex) => {
                      const groupKey = `invoice_group_${group.productId}_${groupIndex} `;
                      const isExpanded = expandedInvoiceItems[groupKey] || false;
                      const totalQuantity = group.items.reduce((sum, item) => sum + (parseInt(item.quantity || '0') || 0), 0);
                      const totalLineTotal = group.items.reduce((sum, item) => sum + parseFloat(item.line_total || '0'), 0);
                      const totalDiscount = group.items.reduce((sum, item) => sum + parseFloat(item.discount_amount || '0'), 0);
                      const totalTax = group.items.reduce((sum, item) => sum + parseFloat(item.tax_amount || '0'), 0);
                      const avgUnitPrice = totalQuantity > 0 ? totalLineTotal / totalQuantity : 0;
                      const barcodes = group.items.map(item => ({
                        barcode: item.barcode_value || item.product_sku || 'N/A',
                        item: item
                      }));

                      return (
                        <>
                          <TableRow key={groupKey}>
                            <TableCell>
                              <span className="font-medium text-gray-900" style={getProductNameColor(group.productName) ? { color: getProductNameColor(group.productName) } : undefined}>{group.productName}</span>
                            </TableCell>
                            <TableCell>
                              <button
                                onClick={() => setExpandedInvoiceItems({ ...expandedInvoiceItems, [groupKey]: !isExpanded })}
                                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 font-mono"
                              >
                                <span>{barcodes.length} Barcode{barcodes.length > 1 ? 's' : ''}</span>
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </button>
                              {barcodes.length === 1 ? (
                                <CartLineScannedTime item={barcodes[0].item} variant="row" />
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <span className="text-gray-600 font-semibold">{totalQuantity}</span>
                            </TableCell>
                            <TableCell align="right">
                              <span className="font-medium text-gray-900">₹{formatNumber(avgUnitPrice)}</span>
                            </TableCell>
                            <TableCell align="right">
                              <span className="text-gray-600">₹{formatNumber(totalDiscount)}</span>
                            </TableCell>
                            <TableCell align="right">
                              <span className="text-gray-600">₹{formatNumber(totalTax)}</span>
                            </TableCell>
                            <TableCell align="right">
                              <span className="font-semibold text-gray-900">₹{formatNumber(totalLineTotal)}</span>
                            </TableCell>
                          </TableRow>
                          {isExpanded && barcodes.map((barcodeItem, barcodeIndex) => {
                            const item = barcodeItem.item;
                            const exNote = formatExchangeSnapshotNote(exchangeSnapshotForItem(inv, item.id));
                            return (
                              <TableRow key={`${groupKey}_barcode_${barcodeIndex} `} className="bg-gray-50">
                                <TableCell className="pl-12">
                                  <div>
                                    <span className="text-xs text-gray-500" style={getProductNameColor(group.productName) ? { color: getProductNameColor(group.productName) } : undefined}>↳ {group.productName}</span>
                                    {exNote ? (
                                      <div className="mt-1 text-[10px] text-gray-600 leading-snug max-w-xl">
                                        {exNote}
                                      </div>
                                    ) : null}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <span className="text-xs text-gray-600 font-mono">{barcodeItem.barcode}</span>
                                  <CartLineScannedTime item={item} variant="row" />
                                </TableCell>
                                <TableCell>
                                  <span className="text-xs text-gray-600">{item.quantity}</span>
                                </TableCell>
                                <TableCell align="right">
                                  {item.manual_unit_price && parseFloat(item.unit_price || '0') > 0 && parseFloat(item.unit_price || '0') !== parseFloat(item.manual_unit_price || '0') ? (
                                    <div className="flex flex-col items-end">
                                      <span className="line-through text-gray-400 text-xs">₹{formatNumber(item.unit_price || '0')}</span>
                                      <span className="text-xs font-medium text-gray-900">₹{formatNumber(item.manual_unit_price)}</span>
                                    </div>
                                  ) : (
                                    <span className="text-xs font-medium text-gray-900">₹{formatNumber(item.manual_unit_price || item.unit_price || '0')}</span>
                                  )}
                                </TableCell>
                                <TableCell align="right">
                                  <span className="text-xs text-gray-600">₹{formatNumber(item.discount_amount || '0')}</span>
                                </TableCell>
                                <TableCell align="right">
                                  <span className="text-xs text-gray-600">₹{formatNumber(item.tax_amount || '0')}</span>
                                </TableCell>
                                <TableCell align="right">
                                  <span className="text-xs font-semibold text-gray-900">₹{formatNumber(item.line_total || '0')}</span>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </>
                      );
                    })}
                  </Table>
                );
              }
            })()}
          </div>
          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {(() => {
              const groupedItems = groupItemsByProduct(visibleInvoiceItems);
              return groupedItems.map((group, groupIndex) => {
                const groupKey = `invoice_group_${group.productId}_${groupIndex} `;
                const isExpanded = expandedInvoiceItems[groupKey] || false;
                const totalQuantity = group.items.reduce((sum, item) => sum + parseFloat(item.quantity || '0'), 0);
                const totalLineTotal = group.items.reduce((sum, item) => sum + parseFloat(item.line_total || '0'), 0);
                const totalDiscount = group.items.reduce((sum, item) => sum + parseFloat(item.discount_amount || '0'), 0);
                const totalTax = group.items.reduce((sum, item) => sum + parseFloat(item.tax_amount || '0'), 0);
                const avgUnitPrice = totalQuantity > 0 ? totalLineTotal / totalQuantity : 0;
                const barcodes = group.items.map(item => ({
                  barcode: item.barcode_value || item.product_sku || 'N/A',
                  item: item
                }));

                return (
                  <div key={groupKey} className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                    {/* Parent Card */}
                    <div className="p-4">
                      <div className="flex justify-between items-start">
                        <div className="flex-1 min-w-0 pr-3">
                          <h4 className="font-semibold text-gray-900 text-base mb-1" style={getProductNameColor(group.productName) ? { color: getProductNameColor(group.productName) } : undefined}>{group.productName}</h4>
                          <button
                            onClick={() => setExpandedInvoiceItems({ ...expandedInvoiceItems, [groupKey]: !isExpanded })}
                            className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-900 font-mono mt-1"
                          >
                            <span>{barcodes.length} Barcode{barcodes.length > 1 ? 's' : ''}</span>
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </button>
                          {barcodes.length === 1 ? (
                            <CartLineScannedTime item={barcodes[0].item} variant="row" />
                          ) : null}
                          <div className="text-sm text-gray-500 mt-1">
                            <span>Quantity: <span className="font-semibold text-gray-900">{totalQuantity}</span></span>
                          </div>
                        </div>
                        {!isPending && (
                          <div className="text-right flex-shrink-0">
                            <div className="text-lg font-bold text-gray-900">₹{formatNumber(totalLineTotal)}</div>
                            <div className="text-xs text-gray-500 mt-0.5">Total</div>
                          </div>
                        )}
                      </div>
                      {!isPending && (
                        <div className="grid grid-cols-2 gap-4 pt-3 border-t border-gray-100 mt-3">
                          <div>
                            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Unit Price</div>
                            <div className="font-semibold text-gray-900">₹{formatNumber(avgUnitPrice)}</div>
                          </div>
                          <div>
                            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Discount</div>
                            <div className="font-medium text-gray-900">₹{formatNumber(totalDiscount)}</div>
                          </div>
                          <div>
                            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Tax</div>
                            <div className="font-medium text-gray-900">₹{formatNumber(totalTax)}</div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Expanded Barcode Section */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-gray-200 bg-gray-50">
                        <div className="pt-3 space-y-2">
                          {barcodes.map((barcodeItem, barcodeIndex) => {
                            const item = barcodeItem.item;
                            const exNote = formatExchangeSnapshotNote(exchangeSnapshotForItem(inv, item.id));
                            return (
                              <div key={`${groupKey}_barcode_${barcodeIndex} `} className="bg-white rounded-md p-3 border border-gray-200">
                                <div className="flex items-center justify-between mb-2">
                                  <div>
                                    <div className="text-xs font-mono text-gray-600">{barcodeItem.barcode}</div>
                                    <CartLineScannedTime item={item} variant="row" />
                                  </div>
                                  <div className="text-xs text-gray-500">Qty: {item.quantity}</div>
                                </div>
                                {!isPending && (
                                  <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                      <div className="text-gray-500 mb-0.5">Price</div>
                                      {item.manual_unit_price && parseFloat(item.unit_price || '0') > 0 && parseFloat(item.unit_price || '0') !== parseFloat(item.manual_unit_price || '0') ? (
                                        <div className="space-y-0.5">
                                          <div className="line-through text-gray-400 text-xs">₹{formatNumber(item.unit_price || '0')}</div>
                                          <div className="font-semibold text-gray-900">₹{formatNumber(item.manual_unit_price)}</div>
                                        </div>
                                      ) : (
                                        <div className="font-semibold text-gray-900">₹{formatNumber(item.manual_unit_price || item.unit_price || '0')}</div>
                                      )}
                                    </div>
                                    <div>
                                      <div className="text-gray-500 mb-0.5">Total</div>
                                      <div className="font-semibold text-gray-900">₹{formatNumber(item.line_total || '0')}</div>
                                    </div>
                                  </div>
                                )}
                                {exNote ? (
                                  <div className="mt-2 text-[10px] text-gray-600 leading-snug border-t border-gray-100 pt-2">
                                    {exNote}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
          {!isPending && tradeInCreditAmount > 0 && (
            <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg print-area space-y-4">
              <div>
                <p className="text-sm font-semibold text-gray-900 mb-2">Why the total differs from the lines above</p>
                <p className="text-xs text-gray-600 mb-3">
                  Line totals above are the <strong>new items</strong> on this invoice. A trade-in from a prior sale reduces the amount due.
                </p>
                <div className="space-y-1.5 text-sm text-gray-800">
                  <div className="flex justify-between">
                    <span>Sum of line items</span>
                    <span className="tabular-nums">
                      ₹
                      {formatNumber(
                        (inv?.items ?? []).reduce(
                          (acc: number, item: any) => acc + parseFloat(String(item.line_total ?? '0')),
                          0,
                        ),
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-emerald-900">
                    <span>Trade-in credit</span>
                    <span className="tabular-nums font-medium">−₹{formatNumber(tradeInCreditAmount)}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t border-slate-200 pt-2 mt-2">
                    <span>Invoice total</span>
                    <span className="tabular-nums">
                      ₹{formatNumber(inv.replacement_summary?.adjusted_total ?? inv.total ?? '0')}
                    </span>
                  </div>
                </div>
              </div>
              {tradeInDetailTableEl ? (
                <div className="border-t border-slate-200 pt-3">
                  <p className="text-sm font-semibold text-gray-900 mb-2">Trade-in line detail</p>
                  <p className="text-xs text-gray-600 mb-2">
                    Each returned line from a prior invoice: condition, original line value, and credit applied to this invoice.
                  </p>
                  {tradeInDetailTableEl}
                </div>
              ) : null}
            </div>
          )}
        </Card>
      )}

      {/* Payments */}
      {inv.payments && Array.isArray(inv.payments) && inv.payments.length > 0 && (
        <Card className="print-area">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Coins className="h-5 w-5 text-gray-400" />
            Payments ({inv.payments.length})
          </h3>
          {/* Desktop Table View */}
          <div className="hidden md:block">
            <Table headers={['Payment Method', 'Amount', 'Reference', 'Date', 'Action']}>
              {inv.payments.map((payment: any) => (
                <TableRow key={payment.id}>
                  <TableCell>
                    <span className="capitalize font-medium text-gray-900">{payment.payment_method || '-'}</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-semibold text-gray-900">₹{formatNumber(payment.amount || '0')}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600">{payment.reference || '-'}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600">{formatDate(payment.created_at)}</span>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openPaymentEditor(payment)}
                      className="!px-2"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </Table>
          </div>
          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {inv.payments.map((payment: any) => (
              <div key={payment.id} className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                <div className="p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Coins className="h-4 w-4 text-gray-400" />
                        <div className="font-semibold text-gray-900 capitalize">{payment.payment_method || '-'}</div>
                      </div>
                      <div className="text-sm text-gray-500">{formatDate(payment.created_at)}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-lg font-bold text-green-600">₹{formatNumber(payment.amount || '0')}</div>
                    </div>
                  </div>
                  {payment.reference && (
                    <div className="pt-3 border-t border-gray-100">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Reference</div>
                      <div className="text-sm font-medium text-gray-900 break-all">{payment.reference}</div>
                    </div>
                  )}
                  <div className="pt-3 mt-3 border-t border-gray-100 flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openPaymentEditor(payment)}
                      className="inline-flex items-center gap-2"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* A4 Print Preview - Embedded */}
      <Card className="no-print">
        <div className="mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Printer className="h-5 w-5 text-gray-400" />
            A4 Print Preview
          </h3>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="flex-1 sm:flex-none"
            >
              <Printer className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Print</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCapturePhoto}
              className="flex-1 sm:flex-none"
            >
              <Camera className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Photo</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              className="flex-1 sm:flex-none"
            >
              <Download className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Download</span>
            </Button>
          </div>
        </div>
        <div className="border-2 border-gray-300 rounded-lg overflow-hidden bg-gray-100 shadow-lg">
          <div className="bg-gray-50 border-b border-gray-300 px-4 py-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700">
              {inv?.repair ? 'A4 Repair Invoice Preview' : 'A4 Invoice Preview'}
            </span>
            <span className="text-xs text-gray-500 hidden sm:inline">This is how the invoice will appear when printed</span>
          </div>
          <div className="bg-gray-200 p-4 sm:p-8 flex justify-center overflow-auto" style={{ maxHeight: '900px' }}>
            <div
              className="bg-white shadow-2xl mx-auto"
              style={{
                width: '210mm',
                minHeight: '297mm',
                maxWidth: '100%',
                boxShadow: '0 0 20px rgba(0,0,0,0.3)'
              }}
            >
              <iframe
                ref={invoicePreviewRef}
                title={inv?.repair ? 'Repair Invoice A4 Preview' : 'Invoice A4 Preview'}
                srcDoc={generateInvoiceHTML()}
                className="w-full border-0 block"
                style={{
                  width: '100%',
                  minHeight: '297mm',
                  border: 'none',
                  display: 'block'
                }}
                onLoad={(e) => {
                  // Auto-resize iframe to content height
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
                    // Convert pixels to mm (1mm = 3.779527559 pixels at 96 DPI)
                    // Add some padding
                    iframe.style.height = (height + 40) + 'px';
                  }
                }}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Checkout Modal */}
      <Modal
        isOpen={showCheckoutModal}
        onClose={() => {
          setShowCheckoutModal(false);
          setCheckoutQuantities({});
          setCheckoutPrices({});
          setCheckoutPriceErrors({});
          setCheckoutPurchasePrices({});
          setParentGroupPrices({});
          setCheckoutCashAmount('');
          setCheckoutUpiAmount('');
          setCheckoutDeliveryDate('');
        }}
        title={`Checkout Invoice (${inv.customer_name?.trim() || 'Walk-in'})`}
        size="xl-wide"
        closeOnBackdropClick={false}
      >
          <div className="space-y-6">
            {/* ---- Replacement-return finalize UI (pending mode settlement) ---- */}
            {inv?.is_replacement_return && inv?.replacement_mode === 'pending' && inv?.status === 'draft' ? (
              <div className="space-y-5">
                {/* Info banner */}
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Finalizing Replacement Return Invoice</p>
                    <p className="text-xs text-amber-700 mt-1">
                      This invoice was created in <strong>pending</strong> mode — prices were saved but stock/barcode updates
                      and the customer ledger credit have not been applied yet. Choose how this replacement is being settled
                      and click <strong>Finalize Return</strong>.
                    </p>
                  </div>
                </div>

                {/* Invoice summary */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Items returned</span>
                    <span className="font-semibold">{Array.isArray(inv?.items) ? inv.items.length : '—'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Total credit value</span>
                    <span className="font-semibold text-green-700">
                      ₹{formatNumber(inv?.total ?? '0')}
                    </span>
                  </div>
                  {inv?.replacement_source_customers && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Credit goes to</span>
                      <span className="font-semibold">{inv.customer_name || 'Customer'}</span>
                    </div>
                  )}
                </div>

                {/* Settlement type */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                  <label className="block text-sm font-semibold text-gray-900">Replacement Date</label>
                  <Input
                    type="date"
                    value={replReplacementDate}
                    onChange={(e) => setReplReplacementDate(e.target.value)}
                    className="w-full font-semibold border-2 border-blue-300 hover:border-blue-400 bg-white"
                  />
                  <label className="block text-sm font-semibold text-gray-900">
                    <Coins className="h-4 w-4 inline mr-2" />
                    Settlement Type
                  </label>
                  <Select
                    value={replSettlementType}
                    onChange={(e) => {
                      setReplSettlementType(e.target.value as 'cash' | 'upi' | 'mixed' | 'credit');
                      setReplCashAmount('');
                      setReplUpiAmount('');
                    }}
                    className="w-full font-semibold border-2 border-blue-300 hover:border-blue-400 bg-white"
                  >
                    <option value="cash">CASH — Customer paid in cash</option>
                    <option value="upi">UPI — Customer paid via UPI</option>
                    <option value="mixed">CASH + UPI — Split payment</option>
                    <option value="credit">CREDIT — Add credit to customer ledger</option>
                  </Select>
                  <p className="text-xs text-blue-700 font-medium">
                    {replSettlementType === 'cash' && '✓ Replacement credit settled in cash. Barcodes tagged & stock updated.'}
                    {replSettlementType === 'upi' && '✓ Replacement credit settled via UPI. Barcodes tagged & stock updated.'}
                    {replSettlementType === 'mixed' && '✓ Split payment. Enter amounts below. Barcodes tagged & stock updated.'}
                    {replSettlementType === 'credit' && '✓ Credit added to customer ledger (balance goes up). Barcodes tagged & stock updated.'}
                  </p>

                  {/* Split payment inputs */}
                  {replSettlementType === 'mixed' && (
                    <div className="mt-2 space-y-2">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Cash Amount (₹)</label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={replCashAmount}
                            onChange={(e) => {
                              setReplCashAmount(e.target.value);
                              const total = parseFloat(String(inv?.total ?? '0')) || 0;
                              const cash = parseFloat(e.target.value) || 0;
                              setReplUpiAmount(String(Math.max(0, total - cash)));
                            }}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">UPI Amount (₹)</label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={replUpiAmount}
                            onChange={(e) => {
                              setReplUpiAmount(e.target.value);
                              const total = parseFloat(String(inv?.total ?? '0')) || 0;
                              const upi = parseFloat(e.target.value) || 0;
                              setReplCashAmount(String(Math.max(0, total - upi)));
                            }}
                          />
                        </div>
                      </div>
                      {replCashAmount && replUpiAmount && (
                        <p className="text-xs text-gray-600">
                          Total entered: ₹{formatNumber(
                            (parseFloat(replCashAmount) || 0) + (parseFloat(replUpiAmount) || 0)
                          )} / Invoice: ₹{formatNumber(inv?.total ?? '0')}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2 border-t border-gray-200">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowCheckoutModal(false);
                      setReplSettlementType('cash');
                      setReplCashAmount('');
                      setReplUpiAmount('');
                      setReplReplacementDate(new Date().toISOString().slice(0, 10));
                    }}
                    disabled={finalizeReplacementMutation.isPending}
                    className="w-full sm:w-auto"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      if (replSettlementType === 'mixed') {
                        const total = parseFloat(String(inv?.total ?? '0')) || 0;
                        const cash = parseFloat(replCashAmount) || 0;
                        const upi = parseFloat(replUpiAmount) || 0;
                        if (cash <= 0 && upi <= 0) {
                          alert('Please enter cash and UPI amounts for mixed settlement.');
                          return;
                        }
                        if (Math.abs(cash + upi - total) > 0.5) {
                          if (!window.confirm(`Split total ₹${formatNumber(cash + upi)} doesn't match invoice total ₹${formatNumber(total)}. Continue anyway?`)) return;
                        }
                      }
                      finalizeReplacementMutation.mutate({
                        replacement_date: replReplacementDate,
                        settlement_invoice_type: replSettlementType,
                        cash_amount: replSettlementType === 'mixed' ? replCashAmount || null : null,
                        upi_amount: replSettlementType === 'mixed' ? replUpiAmount || null : null,
                      });
                    }}
                    disabled={finalizeReplacementMutation.isPending}
                    className="w-full sm:w-auto bg-green-600 hover:bg-green-700"
                  >
                    {finalizeReplacementMutation.isPending ? 'Finalizing...' : 'Finalize Return'}
                  </Button>
                </div>
              </div>
            ) : (
              <>
            {/* Show/hide purchase price toggle - same as POS */}
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowPurchasePrice((p) => !p)}
                title={showPurchasePrice ? 'Hide reference prices (selling/purchase)' : 'Show reference prices'}
                className={`flex items-center justify-center p-2 rounded-md border transition-colors ${showPurchasePrice
                  ? 'text-blue-600 border-blue-300 bg-blue-50 hover:bg-blue-100'
                  : 'text-gray-400 border-gray-300 bg-gray-50 hover:bg-gray-100'
                  }`}
              >
                {showPurchasePrice ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
            </div>

            {/* Add Product Section */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Product
                <span className="text-xs font-normal text-gray-500">(F6: Custom Product)</span>
              </h4>
              <div className="relative w-full">
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Input
                      type="text"
                      placeholder="Search by name, SKU, or scan barcode / short code..."
                      value={barcodeInput}
                      autoComplete="off"
                      onChange={(e) => {
                        const newValue = e.target.value;
                        setBarcodeInput(newValue);
                        setIsSearchTyped(newValue.trim().length > 0);
                        setProductSearchSelectedIndex(-1);
                      }}
                      onInput={(e) => {
                        const target = e.target as HTMLInputElement;
                        const currentValue = target.value;
                        if (currentValue !== barcodeInput) {
                          setBarcodeInput(currentValue);
                          setIsSearchTyped(currentValue.trim().length > 0);
                        }
                      }}
                      onKeyDown={async (e) => {
                        const inputElement = e.currentTarget as HTMLInputElement;
                        const searchValue = (inputElement.value || '').trim();
                        const searchLower = searchValue.toLowerCase();
                        const showCustomOption = searchLower === 'other' || searchLower === 'custom' || searchLower.startsWith('other ') || searchLower.startsWith('custom ');
                        const productList: any[] = [];
                        const searchUpper = searchValue.trim().toUpperCase();
                        if (barcodeCheck?.product && !barcodeCheck.isUnavailable) {
                          const p = barcodeCheck.product;
                          const matched = (p.matched_barcode ?? p.canonical_barcode ?? '').toString().trim().toUpperCase();
                          if (matched && matched === searchUpper) productList.push(p);
                        }
                        if (products) {
                          const existingIds = new Set(productList.map((p: any) => p.id));
                          if (Array.isArray(products?.results)) productList.push(...products.results.filter((p: any) => !existingIds.has(p.id)));
                          else if (Array.isArray(products?.data)) productList.push(...products.data.filter((p: any) => !existingIds.has(p.id)));
                          else if (Array.isArray(products)) productList.push(...products.filter((p: any) => !existingIds.has(p.id)));
                        }
                        const totalOptions = (showCustomOption ? 1 : 0) + productList.length;

                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (!searchValue) return;
                          if (showCustomOption && productSearchSelectedIndex === 0) {
                            setShowCustomProductModal(true);
                            setBarcodeInput('');
                            inputElement.value = '';
                            setProductSearchSelectedIndex(-1);
                            setIsSearchTyped(false);
                            return;
                          }
                          if (productSearchSelectedIndex >= 0 && totalOptions > 0) {
                            const idx = showCustomOption ? productSearchSelectedIndex - 1 : productSearchSelectedIndex;
                            if (idx >= 0 && productList[idx]) {
                              const product = productList[idx];
                              const isPending = inv?.invoice_type === 'pending' && inv?.status === 'draft';
                              const quantity = 1;
                              const unitPrice = isPending ? 0 : (product.selling_price || 0);
                              const discountAmount = 0;
                              const taxAmount = 0;
                              const lineTotal = quantity * unitPrice - discountAmount + taxAmount;
                              const payload: any = {
                                product: product.id,
                                quantity,
                                unit_price: unitPrice,
                                discount_amount: discountAmount,
                                tax_amount: taxAmount,
                                line_total: lineTotal,
                              };
                              if (product.barcode_id != null && product.barcode_available !== false) {
                                payload.barcode_id = product.barcode_id;
                              }
                              addItemMutation.mutate(payload);
                              setBarcodeInput('');
                              inputElement.value = '';
                              setProductSearchSelectedIndex(-1);
                              setIsSearchTyped(false);
                              return;
                            }
                          }
                          await handleBarcodeScan(searchValue);
                          setBarcodeInput('');
                          inputElement.value = '';
                        } else if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          if (totalOptions > 0) setProductSearchSelectedIndex((prev) => Math.min(prev + 1, totalOptions - 1));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          if (productSearchSelectedIndex > 0) setProductSearchSelectedIndex(productSearchSelectedIndex - 1);
                        }
                      }}
                      className="w-full"
                    />
                    {/* Product Search Dropdown */}
                    {(() => {
                      const searchLower = barcodeInput.trim().toLowerCase();
                      const showCustomOption = searchLower === 'other' || searchLower === 'custom' || searchLower.startsWith('other ') || searchLower.startsWith('custom ');
                      if (!isSearchTyped || (!products && !barcodeCheck?.product && !showCustomOption)) return null;
                      const productList: any[] = [];
                      const exactSearchUpper = barcodeInput.trim().toUpperCase();
                      if (barcodeCheck?.product && !barcodeCheck.isUnavailable) {
                        const p = barcodeCheck.product;
                        const matched = (p.matched_barcode ?? p.canonical_barcode ?? '').toString().trim().toUpperCase();
                        if (matched && matched === exactSearchUpper) productList.push(p);
                      }
                      if (products) {
                        const existingIds = new Set(productList.map((p: any) => p.id));
                        if (Array.isArray(products?.results)) productList.push(...products.results.filter((p: any) => !existingIds.has(p.id)));
                        else if (Array.isArray(products?.data)) productList.push(...products.data.filter((p: any) => !existingIds.has(p.id)));
                        else if (Array.isArray(products)) productList.push(...products.filter((p: any) => !existingIds.has(p.id)));
                      }
                      return (
                        <div
                          className="absolute top-full left-0 z-20 w-full pt-2"
                          onMouseDown={(e) => e.preventDefault()}
                        >
                          <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg bg-white shadow-xl">
                            {showCustomOption && (
                              <button
                                type="button"
                                onClick={() => {
                                  setShowCustomProductModal(true);
                                  setBarcodeInput('');
                                  setProductSearchSelectedIndex(-1);
                                  setIsSearchTyped(false);
                                }}
                                onMouseEnter={() => setProductSearchSelectedIndex(0)}
                                className={`w-full text-left px-4 py-3 transition-colors border-b border-gray-100 ${productSearchSelectedIndex === 0 ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50'}`}
                              >
                                <div className="font-medium text-gray-900 flex items-center gap-2">
                                  <Package className="h-4 w-4 text-blue-600" />
                                  Add Custom Product (Other)
                                </div>
                                <div className="text-xs text-gray-500 mt-1">Enter a product name not in inventory</div>
                              </button>
                            )}
                            {productList.length === 0 && !showCustomOption && (
                              <div className="px-4 py-6 text-center text-sm text-gray-500">No products found</div>
                            )}
                            {productList.map((product: any, index: number) => {
                              const adjustedIndex = showCustomOption ? index + 1 : index;
                              const isSelected = adjustedIndex === productSearchSelectedIndex;
                              return (
                                <button
                                  key={product.id}
                                  type="button"
                                  onClick={() => {
                                    const isPending = inv?.invoice_type === 'pending' && inv?.status === 'draft';
                                    const quantity = 1;
                                    const unitPrice = isPending ? 0 : (product.selling_price || 0);
                                    const discountAmount = 0;
                                    const taxAmount = 0;
                                    const lineTotal = quantity * unitPrice - discountAmount + taxAmount;
                                    const payload: any = {
                                      product: product.id,
                                      quantity,
                                      unit_price: unitPrice,
                                      discount_amount: discountAmount,
                                      tax_amount: taxAmount,
                                      line_total: lineTotal,
                                    };
                                    if (product.barcode_id != null && product.barcode_available !== false) {
                                      payload.barcode_id = product.barcode_id;
                                    }
                                    addItemMutation.mutate(payload);
                                    setBarcodeInput('');
                                    setProductSearchSelectedIndex(-1);
                                    setIsSearchTyped(false);
                                  }}
                                  onMouseEnter={() => setProductSearchSelectedIndex(showCustomOption ? index + 1 : index)}
                                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50 border-l-2 border-blue-500' : ''}`}
                                >
                                  <div className="font-medium text-gray-900" style={getProductNameColor(product.name) ? { color: getProductNameColor(product.name) } : undefined}>{product.name}</div>
                                  {(product.matched_barcode || product.sku) && (
                                    <div className="text-xs text-gray-500 mt-1">
                                      {product.matched_barcode ? `Short code: ${product.matched_barcode}` : `SKU: ${product.sku}`}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <Button
                    onClick={async () => {
                      if (barcodeInput.trim()) {
                        await handleBarcodeScan(barcodeInput);
                      }
                    }}
                    disabled={!barcodeInput.trim() || addItemMutation.isPending}
                    className="flex-shrink-0"
                  >
                    <Plus className="h-4 w-4" />
                    {addItemMutation.isPending ? 'Adding...' : 'Add'}
                  </Button>
                </div>
              </div>
            </div>

            {/* Invoice Items with Editable Quantities */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" />
                Invoice Items ({(() => {
                  if (!inv.items || !Array.isArray(inv.items) || inv.items.length === 0) return 0;
                  // Filter out items with quantity 0
                  const activeItems = inv.items.filter((item: any) => {
                    const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
                    return parseFloat(qty) > 0;
                  });
                  return groupItemsByProduct(activeItems).length;
                })()})
              </h4>
              {inv.items && Array.isArray(inv.items) && inv.items.length > 0 ? (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  {/* Desktop Table View */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Product</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">SKU</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Sell / Cost</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Quantity</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Unit Price</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Total</th>
                          {inv?.repair && (
                            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {(() => {
                          // Filter out items with quantity 0 for display
                          const activeItems = inv.items.filter((item: any) => {
                            const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
                            return parseFloat(qty) > 0;
                          });
                          const groupedItems = groupItemsByProduct(activeItems);
                          return groupedItems.map((group, groupIndex) => {
                            // Calculate total quantity from all items in group
                            const totalQuantity = group.items.reduce((sum, item) => {
                              const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
                              return sum + parseFloat(qty || '0');
                            }, 0);

                            // Create a unique key for the group
                            const groupKey = `group_${group.productId}_${groupIndex} `;
                            const isExpanded = expandedGroups[groupKey] || false;

                            // Get parent price from separate state (independent of individual item prices)
                            const firstItem = group.items[0];
                            const parentPrice = parentGroupPrices[groupKey] ?? (firstItem.manual_unit_price || firstItem.unit_price || '0').toString();

                            // Calculate line total using parent price
                            const lineTotal = totalQuantity * parseFloat(parentPrice);

                            // Get all unique barcodes for this product
                            const barcodes = group.items.map(item => ({
                              barcode: item.barcode_value || item.product_sku || 'N/A',
                              item: item
                            }));

                            return (
                              <Fragment key={groupKey}>
                                {/* Parent Row */}
                                <tr className="hover:bg-gray-50 transition-colors">
                                  <td className="px-4 py-4">
                                    <div className="font-medium text-gray-900" style={getProductNameColor(group.productName) ? { color: getProductNameColor(group.productName) } : undefined}>{group.productName}</div>
                                  </td>
                                  <td className="px-4 py-4">
                                    <button
                                      onClick={() => setExpandedGroups({ ...expandedGroups, [groupKey]: !isExpanded })}
                                      className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 font-mono"
                                    >
                                      <span>{barcodes.length} Barcode{barcodes.length > 1 ? 's' : ''}</span>
                                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                    </button>
                                  </td>
                                  <td className="px-4 py-4 text-right">
                                    {(() => {
                                      const isCustom = firstItem.product_name?.startsWith('Other -');
                                      const rawSelling = firstItem.product_selling_price != null ? parseFloat(String(firstItem.product_selling_price)) : NaN;
                                      const rawPurchase = firstItem.product_purchase_price != null ? parseFloat(String(firstItem.product_purchase_price)) : firstItem.purchase_price != null ? parseFloat(String(firstItem.purchase_price)) : NaN;
                                      if (isCustom) {
                                        const purchaseVal = checkoutPurchasePrices[firstItem.id] ?? (rawPurchase > 0 ? String(rawPurchase) : '');
                                        const isPurchaseInvalid = !purchaseVal || parseFloat(purchaseVal) <= 0;
                                        return (
                                          <div className="flex items-center justify-end gap-1">
                                            <span className="text-sm text-gray-500">₹</span>
                                            <Input
                                              type="number"
                                              step="0.01"
                                              min={0}
                                              placeholder="Required"
                                              value={purchaseVal}
                                              onChange={(e) => setCheckoutPurchasePrices((p) => ({ ...p, [firstItem.id]: e.target.value }))}
                                              className={`w-24 text-right text-sm ${isPurchaseInvalid ? 'border-red-500 ring-red-500' : ''}`}
                                              title="Cost (purchase price) - Required"
                                              required
                                            />
                                          </div>
                                        );
                                      }
                                      const hasValidSellingPrice = !Number.isNaN(rawSelling) && rawSelling > 0;
                                      const hasValidPurchasePrice = !Number.isNaN(rawPurchase) && rawPurchase > 0;
                                      const hasAnyRef = hasValidSellingPrice || hasValidPurchasePrice;
                                      if (hasAnyRef && !showPurchasePrice) {
                                        return <span className="text-sm text-gray-400">•••</span>;
                                      }
                                      if (!hasAnyRef) return <span className="text-sm text-gray-900">—</span>;
                                      return (
                                        <div
                                          className="inline-flex px-2 py-1 bg-blue-50 rounded-md border border-blue-200 text-left"
                                          title={hasValidSellingPrice ? (hasValidPurchasePrice ? 'Selling & cost' : 'Selling Price') : 'Purchase Price (cost)'}
                                        >
                                          <div className="flex flex-col gap-0.5 items-end">
                                            {hasValidSellingPrice && (
                                              <span className="text-xs font-medium text-blue-700">Sell: ₹{formatNumber(rawSelling)}</span>
                                            )}
                                            {hasValidPurchasePrice && (
                                              <span className="text-xs font-medium text-blue-600">Cost: ₹{formatNumber(rawPurchase)}</span>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </td>
                                  <td className="px-4 py-4">
                                    {group.isTrackedInventory ? (
                                      <div className="flex items-center justify-center">
                                        <span className="text-gray-600 font-semibold">{totalQuantity}</span>
                                        <span className="ml-2 text-xs text-gray-500">(Fixed)</span>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-center gap-1">
                                        <button
                                          onClick={() => {
                                            const newQty = Math.max(0, totalQuantity - 1);
                                            // Distribute quantity change proportionally across items
                                            const newQuantities = { ...checkoutQuantities };
                                            group.items.forEach((item) => {
                                              const currentQty = parseInt(checkoutQuantities[item.id] ?? item.quantity.toString()) || 0;
                                              const proportion = totalQuantity > 0 ? currentQty / totalQuantity : 1 / group.items.length;
                                              newQuantities[item.id] = Math.max(0, Math.floor(newQty * proportion)).toString();
                                            });
                                            setCheckoutQuantities(newQuantities);
                                          }}
                                          className="p-1.5 rounded-md text-gray-600 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 transition-colors"
                                          disabled={totalQuantity <= 0}
                                        >
                                          <Minus className="h-4 w-4" />
                                        </button>
                                        <Input
                                          type="number"
                                          step="1"
                                          min="0"
                                          value={totalQuantity}
                                          onChange={(e) => {
                                            const newQty = parseFloat(e.target.value) || 0;
                                            // Distribute quantity proportionally across items
                                            const newQuantities = { ...checkoutQuantities };
                                            group.items.forEach((item) => {
                                              const currentQty = parseInt(checkoutQuantities[item.id] ?? item.quantity.toString()) || 0;
                                              const proportion = totalQuantity > 0 ? currentQty / totalQuantity : 1 / group.items.length;
                                              newQuantities[item.id] = Math.max(0, Math.floor(newQty * proportion)).toString();
                                            });
                                            setCheckoutQuantities(newQuantities);
                                          }}
                                          className="w-20 text-center font-semibold"
                                        />
                                        <button
                                          onClick={() => {
                                            const newQty = totalQuantity + 1;
                                            // Distribute quantity change proportionally across items
                                            const newQuantities = { ...checkoutQuantities };
                                            group.items.forEach((item) => {
                                              const currentQty = parseInt(checkoutQuantities[item.id] ?? item.quantity.toString()) || 0;
                                              const proportion = totalQuantity > 0 ? currentQty / totalQuantity : 1 / group.items.length;
                                              newQuantities[item.id] = Math.max(0, Math.floor(newQty * proportion)).toString();
                                            });
                                            setCheckoutQuantities(newQuantities);
                                          }}
                                          className="p-1.5 rounded-md text-gray-600 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 transition-colors"
                                        >
                                          <Plus className="h-4 w-4" />
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-4">
                                    <div className="flex items-center justify-end gap-1">
                                      <span className="text-sm text-gray-500">₹</span>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        placeholder="0.00"
                                        value={parentPrice}
                                        onFocus={(e) => {
                                          // Clear the input when focused
                                          setParentGroupPrices({
                                            ...parentGroupPrices,
                                            [groupKey]: '',
                                          });
                                          e.target.select();
                                        }}
                                        onBlur={(e) => {
                                          // Restore original value if empty
                                          const newPrice = e.target.value;
                                          if (!newPrice || newPrice.trim() === '') {
                                            const firstItem = group.items[0];
                                            const originalPrice = (firstItem.manual_unit_price || firstItem.unit_price || '0').toString();
                                            setParentGroupPrices({
                                              ...parentGroupPrices,
                                              [groupKey]: originalPrice,
                                            });
                                          }
                                        }}
                                        onChange={(e) => {
                                          // Update parent price state
                                          const newPrice = e.target.value;
                                          setParentGroupPrices({
                                            ...parentGroupPrices,
                                            [groupKey]: newPrice,
                                          });

                                          // Validate price threshold for parent price (use first item for validation)
                                          const firstItem = group.items[0];
                                          const effectivePurchase = firstItem.product_name?.startsWith('Other -')
                                            ? (parseFloat(checkoutPurchasePrices[firstItem.id]) || undefined)
                                            : undefined;
                                          const error = validatePriceThreshold(newPrice, firstItem, effectivePurchase);
                                          if (error) {
                                            setCheckoutPriceErrors({
                                              ...checkoutPriceErrors,
                                              [groupKey]: error,
                                            });
                                          } else {
                                            const newErrors = { ...checkoutPriceErrors };
                                            delete newErrors[groupKey];
                                            setCheckoutPriceErrors(newErrors);
                                          }

                                          // Keep SKU (expanded) prices in sync with the parent price.
                                          // If the parent price changes, it becomes the single source of truth for all rows in the group.
                                          const newPrices = { ...checkoutPrices };
                                          group.items.forEach((item) => {
                                            newPrices[item.id] = newPrice;

                                            const effectivePurchaseItem = item.product_name?.startsWith('Other -')
                                              ? (parseFloat(checkoutPurchasePrices[item.id]) || undefined)
                                              : undefined;
                                            const itemError = validatePriceThreshold(newPrice, item, effectivePurchaseItem);
                                            if (itemError) {
                                              setCheckoutPriceErrors((prev) => ({
                                                ...prev,
                                                [`item_${item.id} `]: itemError,
                                              }));
                                            } else {
                                              setCheckoutPriceErrors((prev) => {
                                                const updated = { ...prev };
                                                delete updated[`item_${item.id} `];
                                                return updated;
                                              });
                                            }
                                          });
                                          setCheckoutPrices(newPrices);
                                        }}
                                        className={`w - 28 text-right font - medium ${checkoutPriceErrors[groupKey] ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : ''} `}
                                      />
                                    </div>
                                    {checkoutPriceErrors[groupKey] && (
                                      <div className="text-xs text-red-600 mt-1 text-right pr-1">{checkoutPriceErrors[groupKey]}</div>
                                    )}
                                  </td>
                                  <td className="px-4 py-4">
                                    <div className="text-right">
                                      <div className="font-semibold text-gray-900">
                                        ₹{formatNumber(lineTotal)}
                                      </div>
                                    </div>
                                  </td>
                                  {inv?.repair && (
                                    <td className="px-4 py-4">
                                      <div className="flex items-center justify-center">
                                        <button
                                          onClick={() => {
                                            // Remove all items in this group by calling delete API for each item
                                            if (window.confirm(`Remove all items of "${group.productName}" from the invoice ? `)) {
                                              group.items.forEach((item) => {
                                                deleteItemMutation.mutate(item.id);
                                              });
                                            }
                                          }}
                                          disabled={deleteItemMutation.isPending}
                                          className="p-1.5 rounded-md text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 hover:border-red-300 transition-colors disabled:opacity-50"
                                          title="Remove Product"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                      </div>
                                    </td>
                                  )}
                                </tr>
                                {/* Expanded Barcode Rows */}
                                {isExpanded && barcodes.map((barcodeItem, barcodeIndex) => {
                                  const item = barcodeItem.item;
                                  const itemQty = checkoutQuantities[item.id] ?? item.quantity.toString();
                                  const itemPrice = checkoutPrices[item.id] ?? parentPrice;
                                  const itemLineTotal = parseFloat(itemQty) * parseFloat(itemPrice);

                                  return (
                                    <tr key={`${groupKey}_barcode_${barcodeIndex} `} className="bg-gray-50 hover:bg-gray-100 transition-colors">
                                      <td className="px-4 py-3 pl-12">
                                        <div className="text-xs text-gray-500" style={getProductNameColor(group.productName) ? { color: getProductNameColor(group.productName) } : undefined}>↳ {group.productName}</div>
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="text-xs text-gray-600 font-mono">{barcodeItem.barcode}</div>
                                      </td>
                                      <td className="px-4 py-3 text-right">
                                        <span className="text-xs text-gray-600">
                                          {(() => {
                                            const rawSelling = item.product_selling_price != null ? parseFloat(String(item.product_selling_price)) : NaN;
                                            const rawPurchase = item.product_purchase_price != null ? parseFloat(String(item.product_purchase_price)) : item.purchase_price != null ? parseFloat(String(item.purchase_price)) : NaN;
                                            const hasValidSellingPrice = !Number.isNaN(rawSelling) && rawSelling > 0;
                                            const displayVal = hasValidSellingPrice ? rawSelling : rawPurchase;
                                            if (!Number.isNaN(displayVal) && !showPurchasePrice) return '•••';
                                            return Number.isNaN(displayVal) ? '—' : `₹${formatNumber(displayVal)}`;
                                          })()}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="text-center text-xs text-gray-600 font-semibold">{itemQty}</div>
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-1">
                                          <span className="text-xs text-gray-500">₹</span>
                                          <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            placeholder={parentPrice}
                                            value={itemPrice}
                                            onFocus={(e) => {
                                              // Clear the input when focused
                                              setCheckoutPrices({
                                                ...checkoutPrices,
                                                [item.id]: '',
                                              });
                                              e.target.select();
                                            }}
                                            onBlur={(e) => {
                                              // Restore parent price if empty
                                              const newPrice = e.target.value;
                                              if (!newPrice || newPrice.trim() === '') {
                                                setCheckoutPrices({
                                                  ...checkoutPrices,
                                                  [item.id]: parentPrice,
                                                });
                                              }
                                            }}
                                            onChange={(e) => {
                                              const newPrice = e.target.value;
                                              // Allow individual price override - this does NOT affect parent price
                                              setCheckoutPrices({
                                                ...checkoutPrices,
                                                [item.id]: newPrice,
                                              });

                                              // Validate price threshold for individual item (use checkout purchase for custom)
                                              const effectivePurchaseItem = item.product_name?.startsWith('Other -')
                                                ? (parseFloat(checkoutPurchasePrices[item.id]) || undefined)
                                                : undefined;
                                              const error = validatePriceThreshold(newPrice, item, effectivePurchaseItem);
                                              if (error) {
                                                setCheckoutPriceErrors(prev => ({
                                                  ...prev,
                                                  [`item_${item.id} `]: error,
                                                }));
                                              } else {
                                                setCheckoutPriceErrors(prev => {
                                                  const updated = { ...prev };
                                                  delete updated[`item_${item.id} `];
                                                  return updated;
                                                });
                                              }
                                            }}
                                            className={`w - 24 text-right font - medium text-xs ${checkoutPriceErrors[`item_${item.id}`] ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : ''} `}
                                          />
                                        </div>
                                        {checkoutPriceErrors[`item_${item.id} `] && (
                                          <div className="text-xs text-red-600 mt-1 text-right pr-1">{checkoutPriceErrors[`item_${item.id} `]}</div>
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="text-right text-xs font-semibold text-gray-700">
                                          ₹{formatNumber(itemLineTotal)}
                                        </div>
                                      </td>
                                      {inv?.repair && <td className="px-4 py-3" />}
                                    </tr>
                                  );
                                })}
                              </Fragment>
                            );
                          });
                        })()}
                      </tbody>
                      <tfoot className="bg-gray-100 border-t-2 border-gray-300">
                        {(() => {
                          const activeItems = inv.items.filter((item: any) => {
                            const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
                            return parseFloat(qty) > 0;
                          });
                          let totalPurchaseAmount = 0;
                          let totalQty = 0;
                          activeItems.forEach((item: any) => {
                            const qty = parseFloat(checkoutQuantities[item.id] ?? item.quantity.toString()) || 0;
                            totalQty += qty;
                            const isCustom = item.product_name?.startsWith('Other -');
                            let pp: number;
                            if (isCustom) {
                              const val = checkoutPurchasePrices[item.id] != null && checkoutPurchasePrices[item.id] !== ''
                                ? parseFloat(checkoutPurchasePrices[item.id])
                                : (item.product_purchase_price != null ? parseFloat(item.product_purchase_price) : item.purchase_price != null ? parseFloat(item.purchase_price) : NaN);
                              pp = !Number.isNaN(val) ? val : 0;
                            } else {
                              const rawPurchase = item.product_purchase_price != null ? parseFloat(String(item.product_purchase_price)) : item.purchase_price != null ? parseFloat(String(item.purchase_price)) : NaN;
                              pp = !Number.isNaN(rawPurchase) ? rawPurchase : 0;
                            }
                            totalPurchaseAmount += qty * pp;
                          });
                          const totalSaleAmount = calculateCheckoutTotal();
                          return (
                            <tr>
                              <td className="px-4 py-3 text-left text-sm font-bold text-gray-900" colSpan={2}>Total</td>
                              <td className="px-4 py-3 text-right text-sm font-bold text-gray-900">
                                {!showPurchasePrice && totalPurchaseAmount > 0
                                  ? <span className="text-gray-400">•••</span>
                                  : `₹${formatNumber(totalPurchaseAmount)}`}
                              </td>
                              <td className="px-4 py-3 text-center text-sm font-bold text-gray-900">{totalQty}</td>
                              <td className="px-4 py-3"></td>
                              <td className="px-4 py-3 text-right text-sm font-bold text-blue-600">₹{formatNumber(totalSaleAmount)}</td>
                              {inv?.repair && <td className="px-4 py-3" />}
                            </tr>
                          );
                        })()}
                      </tfoot>
                    </table>
                  </div>

                  {/* Mobile Card View */}
                  <div className="md:hidden divide-y divide-gray-200 max-h-96 overflow-y-auto">
                    {(() => {
                      // Filter out items with quantity 0 for display
                      const activeItems = inv.items.filter((item: any) => {
                        const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
                        return parseFloat(qty) > 0;
                      });
                      const groupedItems = groupItemsByProduct(activeItems);
                      return groupedItems.map((group, groupIndex) => {
                        // Calculate total quantity from all items in group
                        const totalQuantity = group.items.reduce((sum, item) => {
                          const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
                          return sum + parseFloat(qty || '0');
                        }, 0);

                        // Create a unique key for the group
                        const groupKey = `group_${group.productId}_${groupIndex} `;
                        const isExpanded = expandedGroups[groupKey] || false;

                        // Get parent price from separate state (independent of individual item prices)
                        const firstItem = group.items[0];
                        const parentPrice = parentGroupPrices[groupKey] ?? (firstItem.manual_unit_price || firstItem.unit_price || '0').toString();
                        const lineTotal = totalQuantity * parseFloat(parentPrice);

                        // Get all unique barcodes for this product
                        const barcodes = group.items.map(item => ({
                          barcode: item.barcode_value || item.product_sku || 'N/A',
                          item: item
                        }));

                        return (
                          <div key={groupKey} className="bg-white">
                            {/* Parent Card */}
                            <div className="p-4">
                              <div className="mb-3">
                                <div className="flex justify-between items-start">
                                  <div>
                                    <h5 className="font-semibold text-gray-900 mb-1" style={getProductNameColor(group.productName) ? { color: getProductNameColor(group.productName) } : undefined}>{group.productName}</h5>
                                    <button
                                      onClick={() => setExpandedGroups({ ...expandedGroups, [groupKey]: !isExpanded })}
                                      className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-900 font-mono"
                                    >
                                      <span>{barcodes.length} Barcode{barcodes.length > 1 ? 's' : ''}</span>
                                      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                    </button>
                                  </div>
                                  <div className="text-right">
                                    <span className="text-xs text-gray-500 block">Sell / Cost</span>
                                    {(() => {
                                      const isCustom = firstItem.product_name?.startsWith('Other -');
                                      if (isCustom) {
                                        const purchaseVal = checkoutPurchasePrices[firstItem.id] ?? (firstItem.product_purchase_price != null ? String(firstItem.product_purchase_price) : firstItem.purchase_price != null ? String(firstItem.purchase_price) : '');
                                        const isPurchaseInvalid = !purchaseVal || parseFloat(purchaseVal) <= 0;
                                        return (
                                          <div className="flex items-center justify-end gap-1">
                                            <span className="text-xs text-gray-500">₹</span>
                                            <Input
                                              type="number"
                                              step="0.01"
                                              min={0}
                                              placeholder="Required"
                                              value={purchaseVal}
                                              onChange={(e) => setCheckoutPurchasePrices((p) => ({ ...p, [firstItem.id]: e.target.value }))}
                                              className={`w-20 text-right text-sm ${isPurchaseInvalid ? 'border-red-500 ring-red-500' : ''}`}
                                              required
                                            />
                                          </div>
                                        );
                                      }
                                      const rawSelling = firstItem.product_selling_price != null ? parseFloat(String(firstItem.product_selling_price)) : NaN;
                                      const rawPurchase = firstItem.product_purchase_price != null ? parseFloat(String(firstItem.product_purchase_price)) : firstItem.purchase_price != null ? parseFloat(String(firstItem.purchase_price)) : NaN;
                                      const hasValidSellingPrice = !Number.isNaN(rawSelling) && rawSelling > 0;
                                      const hasValidPurchasePrice = !Number.isNaN(rawPurchase) && rawPurchase > 0;
                                      const hasAnyRef = hasValidSellingPrice || hasValidPurchasePrice;
                                      if (hasAnyRef && !showPurchasePrice) return <span className="text-sm text-gray-400">•••</span>;
                                      if (!hasAnyRef) return <span className="text-sm font-medium text-gray-900">—</span>;
                                      return (
                                        <div
                                          className="inline-flex px-2 py-1 bg-blue-50 rounded-md border border-blue-200"
                                          title={hasValidSellingPrice ? (hasValidPurchasePrice ? 'Selling & cost' : 'Selling Price') : 'Purchase Price (cost)'}
                                        >
                                          <div className="flex flex-col gap-0.5 items-end">
                                            {hasValidSellingPrice && (
                                              <span className="text-[11px] font-medium text-blue-700">Sell: ₹{formatNumber(rawSelling)}</span>
                                            )}
                                            {hasValidPurchasePrice && (
                                              <span className="text-[11px] font-medium text-blue-600">Cost: ₹{formatNumber(rawPurchase)}</span>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                {/* Quantity */}
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Quantity</label>
                                  {group.isTrackedInventory ? (
                                    <div className="flex items-center gap-2">
                                      <span className="text-gray-900 font-semibold">{totalQuantity}</span>
                                      <span className="text-xs text-gray-500">(Fixed)</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={() => {
                                          const newQty = Math.max(0, totalQuantity - 1);
                                          const newQuantities = { ...checkoutQuantities };
                                          group.items.forEach((item) => {
                                            const currentQty = parseFloat(checkoutQuantities[item.id] ?? item.quantity.toString());
                                            const proportion = totalQuantity > 0 ? currentQty / totalQuantity : 1 / group.items.length;
                                            newQuantities[item.id] = Math.max(0, Math.floor(newQty * proportion)).toString();
                                          });
                                          setCheckoutQuantities(newQuantities);
                                        }}
                                        className="p-1.5 rounded-md text-gray-600 hover:bg-gray-200 disabled:opacity-50"
                                        disabled={totalQuantity <= 0}
                                      >
                                        <Minus className="h-4 w-4" />
                                      </button>
                                      <Input
                                        type="number"
                                        step="1"
                                        min="0"
                                        value={totalQuantity}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          if (val === '' || /^\d+$/.test(val)) {
                                            const newQty = parseInt(val) || 0;
                                            const newQuantities = { ...checkoutQuantities };
                                            group.items.forEach((item) => {
                                              const currentQty = parseInt(checkoutQuantities[item.id] ?? item.quantity.toString()) || 0;
                                              const proportion = totalQuantity > 0 ? currentQty / totalQuantity : 1 / group.items.length;
                                              newQuantities[item.id] = Math.max(0, Math.floor(newQty * proportion)).toString();
                                            });
                                            setCheckoutQuantities(newQuantities);
                                          }
                                        }}
                                        onBlur={(e) => {
                                          const val = Math.max(0, parseInt(e.target.value) || 0);
                                          const newQuantities = { ...checkoutQuantities };
                                          group.items.forEach((item) => {
                                            const currentQty = parseInt(checkoutQuantities[item.id] ?? item.quantity.toString()) || 0;
                                            const proportion = totalQuantity > 0 ? currentQty / totalQuantity : 1 / group.items.length;
                                            newQuantities[item.id] = Math.max(0, Math.floor(val * proportion)).toString();
                                          });
                                          setCheckoutQuantities(newQuantities);
                                        }}
                                        className="w-20 text-center font-semibold"
                                      />
                                      <button
                                        onClick={() => {
                                          const newQty = totalQuantity + 1;
                                          const newQuantities = { ...checkoutQuantities };
                                          group.items.forEach((item) => {
                                            const currentQty = parseFloat(checkoutQuantities[item.id] ?? item.quantity.toString());
                                            const proportion = totalQuantity > 0 ? currentQty / totalQuantity : 1 / group.items.length;
                                            newQuantities[item.id] = Math.max(0, Math.floor(newQty * proportion)).toString();
                                          });
                                          setCheckoutQuantities(newQuantities);
                                        }}
                                        className="p-1.5 rounded-md text-gray-600 hover:bg-gray-200 disabled:opacity-50"
                                      >
                                        <Plus className="h-4 w-4" />
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {/* Price */}
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Unit Price</label>
                                  <div className="flex items-center gap-1">
                                    <span className="text-sm text-gray-500">₹</span>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      placeholder="0.00"
                                      value={parentPrice}
                                      onFocus={(e) => {
                                        setParentGroupPrices({
                                          ...parentGroupPrices,
                                          [groupKey]: '',
                                        });
                                        e.target.select();
                                      }}
                                      onBlur={(e) => {
                                        const newPrice = e.target.value;
                                        if (!newPrice || newPrice.trim() === '') {
                                          const firstItem = group.items[0];
                                          const originalPrice = (firstItem.manual_unit_price || firstItem.unit_price || '0').toString();
                                          setParentGroupPrices({
                                            ...parentGroupPrices,
                                            [groupKey]: originalPrice,
                                          });
                                        }
                                      }}
                                      onChange={(e) => {
                                        const newPrice = e.target.value;
                                        setParentGroupPrices({
                                          ...parentGroupPrices,
                                          [groupKey]: newPrice,
                                        });

                                        const firstItem = group.items[0];
                                        const effectivePurchaseFirst = firstItem.product_name?.startsWith('Other -')
                                          ? (parseFloat(checkoutPurchasePrices[firstItem.id]) || undefined)
                                          : undefined;
                                        const error = validatePriceThreshold(newPrice, firstItem, effectivePurchaseFirst);
                                        if (error) {
                                          setCheckoutPriceErrors({
                                            ...checkoutPriceErrors,
                                            [groupKey]: error,
                                          });
                                        } else {
                                          const newErrors = { ...checkoutPriceErrors };
                                          delete newErrors[groupKey];
                                          setCheckoutPriceErrors(newErrors);
                                        }

                                        const newPrices = { ...checkoutPrices };
                                        const oldParentPrice = parentPrice;
                                        group.items.forEach((item) => {
                                          const currentItemPrice = checkoutPrices[item.id];
                                          const originalItemPrice = (item.manual_unit_price || item.unit_price || '0').toString();

                                          const shouldUpdate = !currentItemPrice ||
                                            currentItemPrice === oldParentPrice ||
                                            currentItemPrice === originalItemPrice;

                                          if (shouldUpdate) {
                                            newPrices[item.id] = newPrice;

                                            const effectivePurchaseItem = item.product_name?.startsWith('Other -')
                                              ? (parseFloat(checkoutPurchasePrices[item.id]) || undefined)
                                              : undefined;
                                            const itemError = validatePriceThreshold(newPrice, item, effectivePurchaseItem);
                                            if (itemError) {
                                              setCheckoutPriceErrors(prev => ({
                                                ...prev,
                                                [`item_${item.id} `]: itemError,
                                              }));
                                            } else {
                                              setCheckoutPriceErrors(prev => {
                                                const updated = { ...prev };
                                                delete updated[`item_${item.id} `];
                                                return updated;
                                              });
                                            }
                                          }
                                        });
                                        setCheckoutPrices(newPrices);
                                      }}
                                      className={`flex - 1 text-right font - medium ${checkoutPriceErrors[groupKey] ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : ''} `}
                                    />
                                  </div>
                                  {checkoutPriceErrors[groupKey] && (
                                    <div className="text-xs text-red-600 mt-1">{checkoutPriceErrors[groupKey]}</div>
                                  )}
                                </div>
                              </div>

                              {/* Line Total */}
                              {parseFloat(parentPrice) > 0 && (
                                <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
                                  <span className="text-sm font-medium text-gray-700">Line Total:</span>
                                  <span className="text-lg font-bold text-gray-900">₹{formatNumber(lineTotal)}</span>
                                </div>
                              )}
                            </div>

                            {/* Expanded Barcode Section */}
                            {isExpanded && (
                              <div className="px-4 pb-4 border-t border-gray-200 bg-gray-50">
                                <div className="pt-3 space-y-2">
                                  {barcodes.map((barcodeItem, barcodeIndex) => {
                                    const item = barcodeItem.item;
                                    const itemQty = checkoutQuantities[item.id] ?? item.quantity.toString();
                                    const itemPrice = checkoutPrices[item.id] ?? parentPrice;
                                    const itemLineTotal = parseFloat(itemQty) * parseFloat(itemPrice);

                                    return (
                                      <div key={`${groupKey}_barcode_${barcodeIndex} `} className="bg-white rounded-md p-3 border border-gray-200">
                                        <div className="flex items-center justify-between mb-2">
                                          <div className="text-xs font-mono text-gray-600">{barcodeItem.barcode}</div>
                                          <div className="text-xs text-gray-500">Qty: {itemQty}</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <label className="text-xs font-medium text-gray-700">Price:</label>
                                          <div className="flex items-center gap-1 flex-1">
                                            <span className="text-xs text-gray-500">₹</span>
                                            <Input
                                              type="number"
                                              step="0.01"
                                              min="0"
                                              placeholder={parentPrice}
                                              value={itemPrice}
                                              onFocus={(e) => {
                                                setCheckoutPrices({
                                                  ...checkoutPrices,
                                                  [item.id]: '',
                                                });
                                                e.target.select();
                                              }}
                                              onBlur={(e) => {
                                                const newPrice = e.target.value;
                                                if (!newPrice || newPrice.trim() === '') {
                                                  setCheckoutPrices({
                                                    ...checkoutPrices,
                                                    [item.id]: parentPrice,
                                                  });
                                                }
                                              }}
                                              onChange={(e) => {
                                                const newPrice = e.target.value;
                                                setCheckoutPrices({
                                                  ...checkoutPrices,
                                                  [item.id]: newPrice,
                                                });

                                                const effectivePurchaseItem = item.product_name?.startsWith('Other -')
                                                  ? (parseFloat(checkoutPurchasePrices[item.id]) || undefined)
                                                  : undefined;
                                                const error = validatePriceThreshold(newPrice, item, effectivePurchaseItem);
                                                if (error) {
                                                  setCheckoutPriceErrors(prev => ({
                                                    ...prev,
                                                    [`item_${item.id} `]: error,
                                                  }));
                                                } else {
                                                  setCheckoutPriceErrors(prev => {
                                                    const updated = { ...prev };
                                                    delete updated[`item_${item.id} `];
                                                    return updated;
                                                  });
                                                }
                                              }}
                                              className={`flex - 1 text-right font - medium text-xs ${checkoutPriceErrors[`item_${item.id}`] ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : ''} `}
                                            />
                                          </div>
                                          <div className="text-xs font-semibold text-gray-700">
                                            ₹{formatNumber(itemLineTotal)}
                                          </div>
                                        </div>
                                        {checkoutPriceErrors[`item_${item.id} `] && (
                                          <div className="text-xs text-red-600 mt-1">{checkoutPriceErrors[`item_${item.id} `]}</div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            {/* Remove Button for Mobile - only for repair checkout */}
                            {inv?.repair && (
                              <div className="mt-3 pt-3 border-t border-gray-200">
                                <button
                                  onClick={() => {
                                    if (window.confirm(`Remove all items of "${group.productName}" from the invoice ? `)) {
                                      group.items.forEach((item) => {
                                        deleteItemMutation.mutate(item.id);
                                      });
                                    }
                                  }}
                                  disabled={deleteItemMutation.isPending}
                                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 transition-colors disabled:opacity-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Remove Product
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                    {/* Mobile Totals */}
                    {(() => {
                      const activeItems = inv.items.filter((item: any) => {
                        const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
                        return parseFloat(qty) > 0;
                      });
                      let totalPurchaseAmount = 0;
                      let totalQty = 0;
                      activeItems.forEach((item: any) => {
                        const qty = parseFloat(checkoutQuantities[item.id] ?? item.quantity.toString()) || 0;
                        totalQty += qty;
                        const isCustom = item.product_name?.startsWith('Other -');
                        let pp: number;
                        if (isCustom) {
                          const val = checkoutPurchasePrices[item.id] != null && checkoutPurchasePrices[item.id] !== ''
                            ? parseFloat(checkoutPurchasePrices[item.id])
                            : (item.product_purchase_price != null ? parseFloat(item.product_purchase_price) : item.purchase_price != null ? parseFloat(item.purchase_price) : NaN);
                          pp = !Number.isNaN(val) ? val : 0;
                        } else {
                          const rawPurchase = item.product_purchase_price != null ? parseFloat(String(item.product_purchase_price)) : item.purchase_price != null ? parseFloat(String(item.purchase_price)) : NaN;
                          pp = !Number.isNaN(rawPurchase) ? rawPurchase : 0;
                        }
                        totalPurchaseAmount += qty * pp;
                      });
                      const totalSaleAmount = calculateCheckoutTotal();
                      return (
                        <div className="bg-gray-100 border-t-2 border-gray-300 p-3 flex justify-between items-center text-sm">
                          <div className="flex gap-4">
                            <div>
                              <span className="text-gray-500 text-xs">Purchase</span>
                              <div className="font-bold text-gray-900">
                                {!showPurchasePrice && totalPurchaseAmount > 0 ? '•••' : `₹${formatNumber(totalPurchaseAmount)}`}
                              </div>
                            </div>
                            <div>
                              <span className="text-gray-500 text-xs">Qty</span>
                              <div className="font-bold text-gray-900">{totalQty}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-gray-500 text-xs">Sale Total</span>
                            <div className="font-bold text-blue-600">₹{formatNumber(totalSaleAmount)}</div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <ShoppingBag className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">No items in invoice</p>
                </div>
              )}
            </div>

            {/* Summary */}
            {(() => {
              // Filter out items with quantity 0 for total calculation
              const activeItems = inv.items?.filter((item: any) => {
                const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
                return parseFloat(qty) > 0;
              }) || [];

              if (activeItems.length > 0) {
                const subtotal = calculateCheckoutTotal();
                let totalPurchase = 0;
                activeItems.forEach((item: any) => {
                  const qty = parseFloat(checkoutQuantities[item.id] ?? item.quantity.toString()) || 0;
                  const isCustom = item.product_name?.startsWith('Other -');
                  let pp: number;
                  if (isCustom) {
                    const val = checkoutPurchasePrices[item.id] != null && checkoutPurchasePrices[item.id] !== ''
                      ? parseFloat(checkoutPurchasePrices[item.id])
                      : (item.product_purchase_price != null ? parseFloat(item.product_purchase_price) : item.purchase_price != null ? parseFloat(item.purchase_price) : NaN);
                    pp = !Number.isNaN(val) ? val : 0;
                  } else {
                    const rawPurchase = item.product_purchase_price != null ? parseFloat(String(item.product_purchase_price)) : item.purchase_price != null ? parseFloat(String(item.purchase_price)) : NaN;
                    pp = !Number.isNaN(rawPurchase) ? rawPurchase : 0;
                  }
                  totalPurchase += qty * pp;
                });
                const margin = subtotal - totalPurchase;
                return (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-gray-900 mb-3">Summary</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Purchase Total:</span>
                        <span className="font-semibold text-gray-900">
                          {!showPurchasePrice && totalPurchase > 0 ? '•••' : `₹${formatNumber(totalPurchase)}`}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Sale Total:</span>
                        <span className="font-semibold text-gray-900">₹{formatNumber(subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Margin:</span>
                        <span className={`font-semibold ${margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {!showPurchasePrice && totalPurchase > 0 ? '•••' : `₹${formatNumber(margin)}`}
                        </span>
                      </div>
                      <div className="pt-2 border-t border-gray-200 flex justify-between">
                        <span className="text-base font-bold text-gray-900">Total:</span>
                        <span className="text-xl font-bold text-blue-600">₹{formatNumber(subtotal)}</span>
                      </div>
                    </div>
                  </div>
                );
              }
              return null;
            })()}

            {/* Invoice Type Selection */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <label className="block text-sm font-semibold text-gray-900 mb-3">
                <FileText className="h-4 w-4 inline mr-2" />
                Invoice Type
              </label>
              <Select
                value={hideCheckoutPaymentOptions && !['pending', 'credit'].includes(checkoutInvoiceType) ? 'pending' : checkoutInvoiceType}
                onChange={(e) => {
                  const newType = e.target.value as 'cash' | 'upi' | 'pending' | 'mixed' | 'credit';

                  // Allow switching back to pending even when products are removed.
                  // Product/line-total guards are only for checkout types.
                  if (newType === 'pending') {
                    setCheckoutInvoiceType(newType);
                    setCheckoutCashAmount('');
                    setCheckoutUpiAmount('');
                    if (inv?.repair) {
                      const hasProducts = Array.isArray(inv.items) && inv.items.length > 0;
                      const currentPendingStatus = (checkoutRepairStatus || inv.repair.status || '').trim();
                      const pendingStatusToSet = hasProducts
                        ? 'work_in_progress'
                        : (currentPendingStatus === 'not_repaired' ? 'not_repaired' : 'received');
                      setCheckoutRepairStatus(pendingStatusToSet);
                      setCheckoutDeliveryDate('');
                    }
                    return;
                  }

                  // Guard invoice type changes: invoice must have products and each line total must be > 0.
                  const currentItems = Array.isArray(inv?.items) ? inv.items : [];
                  if (currentItems.length === 0) {
                    alert('Please add at least one product before changing invoice type.');
                    return;
                  }
                  const nextCheckoutPrices = { ...checkoutPrices };
                  const nextCheckoutPurchasePrices = { ...checkoutPurchasePrices };
                  const invalidCustomPurchaseItems: string[] = [];
                  const invalidLine = currentItems.find((item: any) => {
                    const quantity = checkoutQuantities[item.id]
                      ? parseInt(checkoutQuantities[item.id]) || 0
                      : parseInt(item.quantity) || 0;
                    const existingSell = checkoutPrices[item.id];
                    const fallbackSell = (parseFloat(item.manual_unit_price) || parseFloat(item.unit_price) || 0);
                    const price = existingSell ? parseFloat(existingSell) : fallbackSell;
                    if (!existingSell && fallbackSell > 0) {
                      nextCheckoutPrices[item.id] = String(fallbackSell);
                    }

                    const isCustomProduct = item.product_name?.startsWith('Other -');
                    if (isCustomProduct) {
                      const existingPurchase = checkoutPurchasePrices[item.id];
                      const fallbackPurchase =
                        item.product_purchase_price != null
                          ? parseFloat(item.product_purchase_price)
                          : item.purchase_price != null
                            ? parseFloat(item.purchase_price)
                            : 0;
                      if (!existingPurchase && fallbackPurchase > 0) {
                        nextCheckoutPurchasePrices[item.id] = String(fallbackPurchase);
                      }
                      const effectivePurchase = existingPurchase ? parseFloat(existingPurchase) : fallbackPurchase;
                      if (!(effectivePurchase > 0)) {
                        invalidCustomPurchaseItems.push(item.product_name || 'Custom Product');
                        return true;
                      }
                    }

                    const lineTotal = quantity * price;
                    return !(lineTotal > 0);
                  });

                  setCheckoutPrices(nextCheckoutPrices);
                  setCheckoutPurchasePrices(nextCheckoutPurchasePrices);

                  if (invalidCustomPurchaseItems.length > 0) {
                    alert(`Please enter purchase price (> 0) for custom product(s): ${invalidCustomPurchaseItems.join(', ')}`);
                    return;
                  }
                  if (invalidLine) {
                    alert('Each product line total must be greater than 0 before changing invoice type.');
                    return;
                  }

                  setCheckoutInvoiceType(newType);
                  // Clear split amounts when switching away from mixed
                  if (newType !== 'mixed') {
                    setCheckoutCashAmount('');
                    setCheckoutUpiAmount('');
                  }

                  // Auto-update repair status to 'delivered' when changing to a checkout type.
                  // (pending is handled in the early-return block above)
                  if (inv?.repair) {
                    const statusToSet = 'delivered';
                    setCheckoutRepairStatus(statusToSet);
                    // Prefill delivery date to today (UI only). Do NOT auto-save because user may switch back to pending.
                    const existingDeliveryDate = inv.repair.delivery_date ? String(inv.repair.delivery_date).slice(0, 10) : '';
                    const today = new Date().toISOString().slice(0, 10);
                    setCheckoutDeliveryDate(existingDeliveryDate || today);
                  }
                }}
                className="w-full font-semibold border-2 border-blue-300 hover:border-blue-400 cursor-pointer bg-white"
              >
                <option value="pending">PENDING (Save Prices Only)</option>
                {!hideCheckoutPaymentOptions && (
                  <>
                    <option value="cash">CASH (Checkout)</option>
                    <option value="upi">UPI (Checkout)</option>
                    <option value="mixed">CASH + UPI (Checkout)</option>
                  </>
                )}
                <option value="credit">CREDIT (Move to Ledger)</option>
              </Select>
              <p className="text-xs text-blue-700 mt-2 font-medium">
                {checkoutInvoiceType === 'pending' && '✓ Prices will be saved. Invoice remains as draft. No checkout performed.'}
                {checkoutInvoiceType === 'cash' && '✓ Invoice will be checked out and marked as paid (cash). Inventory will be updated.'}
                {checkoutInvoiceType === 'upi' && '✓ Invoice will be checked out and marked as paid (UPI). Inventory will be updated.'}
                {checkoutInvoiceType === 'mixed' && '✓ Invoice will be checked out with split payment (cash + UPI). Inventory will be updated.'}
                {checkoutInvoiceType === 'credit' && '✓ Invoice will be marked as credit and moved to ledger.'}
              </p>
              {/* Split Payment Inputs for Mixed Type */}
              {checkoutInvoiceType === 'mixed' && (
                <div className="mt-3 space-y-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-blue-900 mb-2">
                    <FileText className="h-3.5 w-3.5" />
                    Split Payment Amounts
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Cash Amount (₹)</label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={checkoutCashAmount}
                        onChange={(e) => {
                          const value = e.target.value;
                          setCheckoutCashAmount(value);
                          // Auto-calculate UPI amount if total is known (plain number string — commas break type="number")
                          if (inv?.items && value) {
                            const total = calculateCheckoutTotal();
                            const cash = parseFloat(value) || 0;
                            const remaining = Math.max(0, total - cash);
                            setCheckoutUpiAmount(formatNumber(remaining, 2, false));
                          }
                        }}
                        className="w-full text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">UPI Amount (₹)</label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={checkoutUpiAmount}
                        onChange={(e) => {
                          const value = e.target.value;
                          setCheckoutUpiAmount(value);
                          // Auto-calculate Cash amount if total is known (plain number string — commas break type="number")
                          if (inv?.items && value) {
                            const total = calculateCheckoutTotal();
                            const upi = parseFloat(value) || 0;
                            const remaining = Math.max(0, total - upi);
                            setCheckoutCashAmount(formatNumber(remaining, 2, false));
                          }
                        }}
                        className="w-full text-xs"
                      />
                    </div>
                  </div>
                  {inv?.items && checkoutCashAmount && checkoutUpiAmount && (
                    <div className="text-xs mt-2">
                      <span className="text-gray-600">Total: </span>
                      <span className={`font - semibold ${formatNumber(parseFloat(checkoutCashAmount) + parseFloat(checkoutUpiAmount)) === formatNumber(calculateCheckoutTotal()) ? 'text-green-600' : 'text-red-600'} `}>
                        ₹{formatNumber(parseFloat(checkoutCashAmount) + parseFloat(checkoutUpiAmount))}
                      </span>
                      <span className="text-gray-600"> / Invoice Total: ₹{formatNumber(calculateCheckoutTotal())}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Update Repair Status (when invoice is repair) */}
            {inv?.repair && (
              <div className={`rounded-lg p-4 space-y-3 border ${checkoutInvoiceType !== inv.invoice_type ? 'bg-amber-50 border-amber-300' : 'bg-purple-50 border-purple-200'}`}>
                <h4 className="text-sm font-semibold text-purple-900 flex items-center gap-2">
                  <Wrench className="h-4 w-4" />
                  Update Repair Status
                  {checkoutInvoiceType !== inv.invoice_type && (
                    <span className="text-amber-700 text-xs font-normal">(required when invoice type is changed)</span>
                  )}
                </h4>
                {checkoutInvoiceType !== inv.invoice_type && (
                  <p className="text-xs text-amber-700 flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    You changed the invoice type. Please select a new repair status before completing checkout.
                  </p>
                )}
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[140px]">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Current</label>
                    <Badge className={
                      inv.repair.status === 'received' ? 'bg-blue-100 text-blue-800' :
                        inv.repair.status === 'work_in_progress' ? 'bg-yellow-100 text-yellow-800' :
                          inv.repair.status === 'done' ? 'bg-green-100 text-green-800' :
                            inv.repair.status === 'delivered' ? 'bg-gray-100 text-gray-800' :
                              inv.repair.status === 'not_repaired' ? 'bg-orange-100 text-orange-800' :
                                inv.repair.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                                  'bg-gray-100 text-gray-800'
                    }>
                      {repairStatusOptions.find((o) => o.value === inv.repair.status)?.label ?? inv.repair.status}
                    </Badge>
                    <p className="text-xs text-gray-500 mt-1">
                      Delivery: {inv.repair.delivery_date ? formatDate(inv.repair.delivery_date) : '—'}
                    </p>
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      New Status
                      {updateRepairStatusMutation.isPending && (
                        <span className="ml-2 text-gray-500 font-normal">Updating...</span>
                      )}
                    </label>
                    <Select
                      value={checkoutInvoiceType === 'pending' ? forcedPendingRepairStatus : (checkoutRepairStatus || inv.repair.status)}
                      onChange={(e) => {
                        const newStatus = e.target.value;
                        if ((e.target as HTMLSelectElement).selectedOptions?.[0]?.disabled) return;
                        setCheckoutRepairStatus(newStatus);
                        if (newStatus !== 'done' && newStatus !== 'delivered') {
                          setCheckoutDeliveryDate('');
                        }
                      }}
                      className="w-full"
                    >
                      {limitedRepairStatusOptions
                        .filter((opt) => {
                          // For pending invoice type:
                          // - with products: only work_in_progress
                          // - without products: received / not_repaired
                          if (checkoutInvoiceType === 'pending') {
                            if (hasProductsInCheckout) return opt.value === 'work_in_progress';
                            return opt.value === 'received' || opt.value === 'not_repaired';
                          }
                          // When invoice type is NOT pending, only Delivered can be selected.
                          return opt.value === 'delivered';
                        })
                        .map((opt) => (
                          <option key={opt.value} value={opt.value} disabled={!!opt.disabled}>
                            {opt.label}
                          </option>
                        ))}
                    </Select>
                  </div>
                  {shouldShowCheckoutDeliveryDate && (
                    <div className="flex-1 min-w-[160px]">
                      <label className="block text-xs font-medium text-gray-700 mb-1">Delivery date</label>
                      <Input
                        type="date"
                        value={checkoutDeliveryDate}
                        onChange={(e) => setCheckoutDeliveryDate(e.target.value)}
                        className="w-full"
                        disabled={isDraftPendingCheckout}
                      />
                      {isDraftPendingCheckout && (
                        <p className="text-xs text-gray-500 mt-1">Delivery date is disabled for draft pending repairs.</p>
                      )}
                      {inv.repair.delivery_date && (
                        <p className="text-xs text-gray-500 mt-1">Current: {formatDate(inv.repair.delivery_date)}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-gray-200">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCheckoutModal(false);
                  setCheckoutQuantities({});
                  setCheckoutPrices({});
                  setCheckoutPurchasePrices({});
                }}
                disabled={checkoutMutation.isPending || markCreditMutation.isPending}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (checkoutInvoiceType !== 'credit') {
                    alert('Select CREDIT invoice type to move this invoice to ledger.');
                    return;
                  }

                  // Refetch invoice to use latest data (same as Complete Checkout)
                  await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
                  const freshInvoice = queryClient.getQueryData(['invoice', invoiceId]) as any;
                  const freshInv = freshInvoice?.data;

                  if (!freshInv?.items || freshInv.items.length === 0) {
                    alert('Invoice has no items');
                    return;
                  }

                  // Check for any price validation errors
                  if (Object.keys(checkoutPriceErrors).length > 0) {
                    const errorMessages = Object.values(checkoutPriceErrors).filter(Boolean);
                    if (errorMessages.length > 0) {
                      alert(`Price validation failed: \n\n${errorMessages.join('\n')} `);
                      return;
                    }
                  }

                  // Validate purchase price for custom products (must be > 0)
                  const customItemsMissingPP = freshInv.items.filter((item: any) => {
                    if (!item.product_name?.startsWith('Other -')) return false;
                    const qty = checkoutQuantities[item.id] ?? item.quantity?.toString();
                    if (parseFloat(qty) <= 0) return false;
                    const purchaseVal = checkoutPurchasePrices[item.id] != null && checkoutPurchasePrices[item.id] !== ''
                      ? parseFloat(checkoutPurchasePrices[item.id])
                      : (item.product_purchase_price != null ? parseFloat(item.product_purchase_price) : item.purchase_price != null ? parseFloat(item.purchase_price) : NaN);
                    return Number.isNaN(purchaseVal) || purchaseVal <= 0;
                  });
                  if (customItemsMissingPP.length > 0) {
                    const names = customItemsMissingPP.map((i: any) => i.product_name || 'Custom Product').join(', ');
                    alert(`Purchase price is required and must be greater than 0 for: ${names}`);
                    return;
                  }

                  // Final UI-level guard: block below-cost pricing at submit time as well
                  const priceValidationErrors = getCheckoutPriceValidationErrors(freshInv.items);
                  if (priceValidationErrors.length > 0) {
                    alert(`Price validation failed: \n\n${priceValidationErrors.join('\n')} `);
                    return;
                  }

                  // Prepare items with updated quantities and prices (same as handleCheckoutSubmit)
                  // Filter out items with quantity 0 (they will be deleted by backend)
                  const items = freshInv.items
                    .map((item: any): any => {
                      const quantity = checkoutQuantities[item.id]
                        ? parseInt(checkoutQuantities[item.id]) || 0
                        : parseInt(item.quantity) || 0;
                      const price = checkoutPrices[item.id]
                        ? parseFloat(checkoutPrices[item.id])
                        : (parseFloat(item.manual_unit_price) || parseFloat(item.unit_price) || 0);

                      const payload: any = {
                        id: item.id,
                        quantity: quantity,
                        unit_price: item.unit_price,
                        manual_unit_price: price > 0 ? price : null,
                        discount_amount: item.discount_amount || 0,
                        tax_amount: item.tax_amount || 0,
                      };
                      if (item.product_name?.startsWith('Other -')) {
                        const purchaseVal = checkoutPurchasePrices[item.id] != null && checkoutPurchasePrices[item.id] !== ''
                          ? parseFloat(checkoutPurchasePrices[item.id])
                          : (item.product_purchase_price != null ? parseFloat(item.product_purchase_price) : item.purchase_price != null ? parseFloat(item.purchase_price) : null);
                        if (purchaseVal != null && !Number.isNaN(purchaseVal) && purchaseVal > 0) {
                          payload.purchase_price = purchaseVal;
                        }
                      }
                      return payload;
                    })
                    .filter((item: any) => item.quantity > 0); // Remove items with quantity 0

                  // Check if there are any items left after filtering
                  if (items.length === 0) {
                    alert('Invoice must have at least one item with quantity greater than 0.');
                    return;
                  }

                  // Validate that all items have prices
                  const itemsWithoutPrice = items.filter((item: any) => !item.manual_unit_price || item.manual_unit_price <= 0);
                  if (itemsWithoutPrice.length > 0) {
                    alert(`Please enter prices for all items.${itemsWithoutPrice.length} item(s) are missing prices.`);
                    return;
                  }

                  const payload: { items: any[]; delivery_date?: string | null; repair_status?: string } = { items };
                  const submitRepairStatus =
                    checkoutInvoiceType === 'credit'
                      ? 'delivered'
                      : (checkoutRepairStatus || freshInv?.repair?.status || '').trim();
                  const canSubmitDeliveryDate =
                    submitRepairStatus === 'done' ||
                    submitRepairStatus === 'delivered';
                  if (freshInv?.repair && submitRepairStatus) {
                    payload.repair_status = submitRepairStatus;
                  }
                  if (freshInv?.repair && canSubmitDeliveryDate && checkoutDeliveryDate?.trim()) {
                    payload.delivery_date = checkoutDeliveryDate.trim();
                  }
                  markCreditMutation.mutate(payload);
                }}
                disabled={checkoutInvoiceType !== 'credit' || markCreditMutation.isPending || checkoutMutation.isPending || !areAllPricesEntered() || !inv?.items || inv.items.length === 0 || Object.keys(checkoutPriceErrors).length > 0}
                className="w-full sm:w-auto bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:hover:bg-gray-400"
              >
                {markCreditMutation.isPending ? 'Moving to Ledger...' : 'Move to Ledger'}
              </Button>
              <Button
                onClick={handleCheckoutSubmit}
                disabled={
                  checkoutMutation.isPending ||
                  markCreditMutation.isPending ||
                  checkoutInvoiceType === 'credit' ||
                  (
                    (!inv?.items || inv.items.length === 0) &&
                    !(inv?.repair && checkoutInvoiceType === 'pending' && (checkoutRepairStatus || inv.repair?.status || '').trim() === 'not_repaired')
                  )
                }
                className="w-full sm:w-auto"
              >
                {checkoutMutation.isPending ? 'Processing...' : 'Complete Checkout'}
              </Button>
            </div>
            </>
            )}
          </div>
      </Modal>

      {/* Custom Product Modal (checkout modal add-product search) */}
      <Modal
        isOpen={showCustomProductModal}
        onClose={() => {
          setShowCustomProductModal(false);
          setCustomProductName('');
        }}
        title="Add Custom Product"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Product Name <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              placeholder="Enter product name"
              value={customProductName}
              onChange={(e) => setCustomProductName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customProductName.trim()) {
                  addItemMutation.mutate(
                    { custom_product_name: customProductName.trim(), quantity: 1, unit_price: 0, discount_amount: 0, tax_amount: 0, line_total: 0 },
                    { onSuccess: () => { setShowCustomProductModal(false); setCustomProductName(''); } }
                  );
                }
              }}
            />
            <p className="mt-1 text-xs text-gray-500">
              Saved as &quot;Other - [name]&quot;. No inventory tracking.
            </p>
          </div>
          <div className="flex gap-3 pt-2">
            <Button
              onClick={() => {
                if (!customProductName.trim()) {
                  alert('Product name is required');
                  return;
                }
                addItemMutation.mutate(
                  { custom_product_name: customProductName.trim(), quantity: 1, unit_price: 0, discount_amount: 0, tax_amount: 0, line_total: 0 },
                  { onSuccess: () => { setShowCustomProductModal(false); setCustomProductName(''); } }
                );
              }}
              disabled={addItemMutation.isPending || !customProductName.trim()}
              className="flex-1"
            >
              {addItemMutation.isPending ? 'Adding...' : 'Add to Invoice'}
            </Button>
            <Button
              variant="outline"
              onClick={() => { setShowCustomProductModal(false); setCustomProductName(''); }}
              disabled={addItemMutation.isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Repair Status Modal (when opened from Repairs page for non-draft repair invoice) */}
      {invoice?.data?.repair && (
        <RepairStatusModal
          isOpen={showRepairStatusModal}
          onClose={() => setShowRepairStatusModal(false)}
          onUpdate={(status) => updateRepairStatusMutation.mutate({ repair_status: status })}
          invoiceNumber={invoice.data.invoice_number}
          currentStatus={invoice.data.repair.status}
          invoiceStatus={invoice.data.status}
          isLoading={updateRepairStatusMutation.isPending}
          customerName={invoice.data.customer_name}
          bookingAmount={invoice.data.repair.booking_amount}
          statusOptions={limitedRepairStatusOptions}
        />
      )}

      {/* Payment Modal */}
      {invoice?.data && (() => {
        const inv = invoice.data;
        return (
          <Modal
            isOpen={showPaymentModal}
            onClose={() => {
              setShowPaymentModal(false);
              setPaymentAmount('');
              setPaymentCashAmount('');
              setPaymentUpiAmount('');
              setPaymentReference('');
              setPaymentNotes('');
              setPaymentMethod('cash');
            }}
            title="Settle Payment"
            size="md"
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Payment Method <span className="text-red-500">*</span>
                </label>
                <Select
                  value={paymentMethod}
                  onChange={(e) => {
                    const nextMethod = e.target.value as typeof paymentMethod;
                    setPaymentMethod(nextMethod);
                    if (nextMethod === 'mixed' && paymentAmount) {
                      setPaymentCashAmount(paymentAmount);
                      setPaymentUpiAmount('');
                    }
                  }}
                  className="w-full"
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="mixed">Cash + UPI (Mixed)</option>
                </Select>
              </div>

              {paymentMethod === 'mixed' ? (
                <div className="space-y-3 border border-blue-200 bg-blue-50 rounded-lg p-3">
                  <div className="text-sm font-medium text-gray-700">Split Amounts</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Cash Amount <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={paymentCashAmount}
                        onChange={(e) => setPaymentCashAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        UPI Amount <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={paymentUpiAmount}
                        onChange={(e) => setPaymentUpiAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-600">
                    Total: ₹{formatNumber((parseFloat(paymentCashAmount) || 0) + (parseFloat(paymentUpiAmount) || 0))} | Due: ₹{formatNumber(inv.due_amount || '0')}
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Amount <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max={parseFloat(inv.due_amount || '0')}
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder={`Max: ₹${formatNumber(inv.due_amount || '0')} `}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Due Amount: ₹{formatNumber(inv.due_amount || '0')}
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reference (Optional)
                </label>
                <Input
                  type="text"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder="Transaction ID, Check Number, etc."
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="Additional notes about this payment"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={3}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  onClick={() => {
                    setShowPaymentModal(false);
                    setPaymentAmount('');
                    setPaymentCashAmount('');
                    setPaymentUpiAmount('');
                    setPaymentReference('');
                    setPaymentNotes('');
                    setPaymentMethod('cash');
                  }}
                  variant="outline"
                  className="flex-1"
                  disabled={paymentMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (paymentMethod === 'mixed') {
                      const cashAmount = parseFloat(paymentCashAmount);
                      const upiAmount = parseFloat(paymentUpiAmount);
                      const splitTotal = (cashAmount || 0) + (upiAmount || 0);
                      const dueAmount = parseFloat(inv.due_amount || '0');

                      if (!cashAmount || cashAmount <= 0 || !upiAmount || upiAmount <= 0) {
                        alert('Please enter valid cash and UPI amounts for mixed payment');
                        return;
                      }
                      if (splitTotal > dueAmount) {
                        alert(`Split payment total cannot exceed due amount of ₹${formatNumber(inv.due_amount || '0')} `);
                        return;
                      }

                      paymentMutation.mutate({
                        payment_method: 'mixed',
                        cash_amount: cashAmount,
                        upi_amount: upiAmount,
                        reference: paymentReference || undefined,
                        notes: paymentNotes || undefined,
                      });
                      return;
                    }

                    const amount = parseFloat(paymentAmount);
                    if (!amount || amount <= 0) {
                      alert('Please enter a valid payment amount');
                      return;
                    }
                    if (amount > parseFloat(inv.due_amount || '0')) {
                      alert(`Payment amount cannot exceed due amount of ₹${formatNumber(inv.due_amount || '0')} `);
                      return;
                    }
                    paymentMutation.mutate({
                      payment_method: paymentMethod,
                      amount,
                      reference: paymentReference || undefined,
                      notes: paymentNotes || undefined,
                    });
                  }}
                  disabled={
                    paymentMutation.isPending || (
                      paymentMethod === 'mixed'
                        ? (
                          !paymentCashAmount
                          || !paymentUpiAmount
                          || parseFloat(paymentCashAmount) <= 0
                          || parseFloat(paymentUpiAmount) <= 0
                        )
                        : (!paymentAmount || parseFloat(paymentAmount) <= 0)
                    )
                  }
                  className="flex-1"
                >
                  {paymentMutation.isPending ? 'Processing...' : 'Record Payment'}
                </Button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* Edit Payment Modal */}
      <Modal
        isOpen={showEditPaymentModal}
        onClose={resetEditPaymentState}
        title="Edit Payment"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Method <span className="text-red-500">*</span>
            </label>
            <Select
              value={editPaymentMethod}
              onChange={(e) => {
                const nextMethod = e.target.value as typeof editPaymentMethod;
                setEditPaymentMethod(nextMethod);
                if (nextMethod === 'mixed' && editPaymentAmount) {
                  setEditPaymentCashAmount(editPaymentAmount);
                  setEditPaymentUpiAmount('');
                }
              }}
              className="w-full"
            >
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="mixed">Cash + UPI (Mixed)</option>
            </Select>
          </div>

          {editPaymentMethod === 'mixed' ? (
            <div className="space-y-3 border border-blue-200 bg-blue-50 rounded-lg p-3">
              <div className="text-sm font-medium text-gray-700">Split Amounts</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cash Amount <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editPaymentCashAmount}
                    onChange={(e) => setEditPaymentCashAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    UPI Amount <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editPaymentUpiAmount}
                    onChange={(e) => setEditPaymentUpiAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-600">
                Split Total: ₹{formatNumber((parseFloat(editPaymentCashAmount) || 0) + (parseFloat(editPaymentUpiAmount) || 0))}
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={editPaymentAmount}
                onChange={(e) => setEditPaymentAmount(e.target.value)}
                placeholder="Enter amount"
                className="w-full"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reference (Optional)
            </label>
            <Input
              type="text"
              value={editPaymentReference}
              onChange={(e) => setEditPaymentReference(e.target.value)}
              placeholder="Transaction ID, Check Number, etc."
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes (Optional)
            </label>
            <textarea
              value={editPaymentNotes}
              onChange={(e) => setEditPaymentNotes(e.target.value)}
              placeholder="Additional notes about this payment"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              onClick={resetEditPaymentState}
              variant="outline"
              className="flex-1"
              disabled={updatePaymentMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editingPaymentId) {
                  alert('Invalid payment selected');
                  return;
                }
                if (editPaymentMethod === 'mixed') {
                  const cashAmount = parseFloat(editPaymentCashAmount);
                  const upiAmount = parseFloat(editPaymentUpiAmount);
                  if (!cashAmount || cashAmount <= 0 || !upiAmount || upiAmount <= 0) {
                    alert('Please enter valid cash and UPI amounts for mixed payment');
                    return;
                  }
                  updatePaymentMutation.mutate({
                    payment_id: editingPaymentId,
                    payment_method: 'mixed',
                    cash_amount: cashAmount,
                    upi_amount: upiAmount,
                    reference: editPaymentReference || undefined,
                    notes: editPaymentNotes || undefined,
                  });
                  return;
                }

                const amount = parseFloat(editPaymentAmount);
                if (!amount || amount <= 0) {
                  alert('Please enter a valid payment amount');
                  return;
                }
                updatePaymentMutation.mutate({
                  payment_id: editingPaymentId,
                  payment_method: editPaymentMethod,
                  amount,
                  reference: editPaymentReference || undefined,
                  notes: editPaymentNotes || undefined,
                });
              }}
              disabled={
                updatePaymentMutation.isPending || (
                  editPaymentMethod === 'mixed'
                    ? (
                      !editPaymentCashAmount
                      || !editPaymentUpiAmount
                      || parseFloat(editPaymentCashAmount) <= 0
                      || parseFloat(editPaymentUpiAmount) <= 0
                    )
                    : (!editPaymentAmount || parseFloat(editPaymentAmount) <= 0)
                )
              }
              className="flex-1"
            >
              {updatePaymentMutation.isPending ? 'Saving...' : 'Update Payment'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Invoice"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-gray-700">
            Are you sure you want to delete invoice <strong>{inv.invoice_number || `#${inv.id} `}</strong>?
          </p>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm font-medium text-yellow-800 mb-3">
              Choose what to do with the items:
            </p>
            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="deleteOption"
                  checked={deleteRestoreStock}
                  onChange={() => setDeleteRestoreStock(true)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">Add items back to inventory</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Stock quantities will be restored, barcodes will be marked as available, and ledger entries will be reversed.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="deleteOption"
                  checked={!deleteRestoreStock}
                  onChange={() => setDeleteRestoreStock(false)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">Delete everything</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Invoice will be permanently deleted. Stock will NOT be restored. Ledger entries will still be reversed.
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <Button
              variant="outline"
              onClick={() => setShowDeleteModal(false)}
              disabled={deleteInvoiceMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDeleteConfirm}
              disabled={deleteInvoiceMutation.isPending}
            >
              {deleteInvoiceMutation.isPending ? 'Deleting...' : 'Delete Invoice'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      {isEditable && (
        <Modal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          title="Edit Invoice"
          size="xl"
        >
          <div className="space-y-6">
            {/* Add Item Section */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-3">Add Item</h4>
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="Scan barcode / short code or enter SKU..."
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const inputEl = e.currentTarget as HTMLInputElement;
                      const b = (inputEl.value || '').trim();
                      if (b) {
                        handleBarcodeScan(b);
                        setBarcodeInput('');
                        inputEl.value = '';
                      }
                    }
                  }}
                  className="flex-1"
                />
                <Button
                  onClick={() => {
                    if (barcodeInput.trim()) {
                      handleBarcodeScan(barcodeInput);
                    }
                  }}
                  disabled={!barcodeInput.trim() || addItemMutation.isPending}
                >
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
            </div>

            {/* Invoice Items */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-3">Invoice Items</h4>
              {inv.items && Array.isArray(inv.items) && inv.items.length > 0 ? (
                <div className="space-y-3">
                  {inv.items.map((item: any) => {
                    const isEditingPrice = showPriceInput[item.id];
                    const priceValue = editingPrice[item.id] ?? (item.manual_unit_price?.toString() || item.unit_price?.toString() || '');
                    return (
                      <div key={item.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <h5 className="font-semibold text-gray-900" style={getProductNameColor(item.product_name) ? { color: getProductNameColor(item.product_name) } : undefined}>{item.product_name || '-'}</h5>
                            <div className="text-sm text-gray-600 flex items-center gap-2 flex-wrap">
                              <span>SKU: {item.barcode_value || item.product_sku || 'N/A'}</span>
                              {(item.replacement_ref?.return_tag || item.barcode_tag) && (
                                <span
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border ${
                                    String(item.replacement_ref?.return_tag || item.barcode_tag).toLowerCase() === 'returned'
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                      : String(item.replacement_ref?.return_tag || item.barcode_tag).toLowerCase() === 'defective'
                                        ? 'bg-red-50 text-red-800 border-red-200'
                                        : String(item.replacement_ref?.return_tag || item.barcode_tag).toLowerCase() === 'unknown'
                                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                                          : 'bg-slate-50 text-slate-700 border-slate-200'
                                  }`}
                                  title="Current barcode status (may change after returns/replacements)"
                                >
                                  {String(item.replacement_ref?.return_tag || item.barcode_tag).toUpperCase()}
                                </span>
                              )}
                              {item.replacement_ref?.invoice_id && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/invoices/${item.replacement_ref.invoice_id}`);
                                  }}
                                  className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                                  title="Open replacement invoice"
                                >
                                  Replacement #{item.replacement_ref.invoice_number || item.replacement_ref.invoice_id}
                                </button>
                              )}
                            </div>
                            <div className="mt-2 space-y-2">
                              {isEditingPrice ? (
                                <div className="flex items-center gap-2">
                                  <Input
                                    type="number"
                                    step="0.01"
                                    placeholder="Enter price"
                                    value={priceValue}
                                    onChange={(e) => setEditingPrice({ ...editingPrice, [item.id]: e.target.value })}
                                    className="w-32"
                                  />
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      if (priceValue) {
                                        updateItemMutation.mutate({
                                          itemId: item.id,
                                          data: { manual_unit_price: parseFloat(priceValue) },
                                        });
                                      }
                                      setShowPriceInput({ ...showPriceInput, [item.id]: false });
                                    }}
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setShowPriceInput({ ...showPriceInput, [item.id]: false });
                                      setEditingPrice({ ...editingPrice, [item.id]: item.manual_unit_price?.toString() || item.unit_price?.toString() || '' });
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-3 flex-wrap">
                                  {isPending ? (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600">
                                          Quantity: <span className="font-semibold text-gray-900 text-base">{item.quantity}</span>
                                        </span>
                                      </div>
                                      {!item.manual_unit_price && (
                                        <Button
                                          size="sm"
                                          onClick={() => {
                                            setShowPriceInput({ ...showPriceInput, [item.id]: true });
                                            setEditingPrice({ ...editingPrice, [item.id]: item.manual_unit_price?.toString() || item.unit_price?.toString() || '0' });
                                          }}
                                          className="bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm"
                                        >
                                          <Coins className="h-3.5 w-3.5 mr-1.5" />
                                          Set Price
                                        </Button>
                                      )}
                                      {item.manual_unit_price && (
                                        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-md">
                                          <span className="text-xs text-green-700 font-medium">Price Set:</span>
                                          <span className="text-sm font-semibold text-green-900">₹{formatNumber(item.manual_unit_price)}</span>
                                          <button
                                            onClick={() => {
                                              setShowPriceInput({ ...showPriceInput, [item.id]: true });
                                              setEditingPrice({ ...editingPrice, [item.id]: item.manual_unit_price?.toString() || item.unit_price?.toString() || '0' });
                                            }}
                                            className="text-xs text-blue-600 hover:text-blue-700 ml-2 font-medium"
                                          >
                                            Change
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <span className="text-sm text-gray-600">
                                        ₹{formatNumber(item.manual_unit_price || item.unit_price || '0')} × {item.quantity} = ₹{formatNumber(item.line_total || '0')}
                                      </span>
                                      <button
                                        onClick={() => {
                                          setShowPriceInput({ ...showPriceInput, [item.id]: true });
                                          setEditingPrice({ ...editingPrice, [item.id]: item.manual_unit_price?.toString() || item.unit_price?.toString() || '' });
                                        }}
                                        className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                                      >
                                        Edit Price
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleUpdateQuantity(item, -1)}
                              disabled={updateItemMutation.isPending || deleteItemMutation.isPending}
                              className="p-1.5 rounded-md text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="min-w-[3rem] px-2 py-1 text-center font-semibold text-gray-900 bg-gray-50 rounded border border-gray-300">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => handleUpdateQuantity(item, 1)}
                              disabled={updateItemMutation.isPending}
                              className="p-1.5 rounded-md text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm('Remove this item from the invoice?')) {
                                  deleteItemMutation.mutate(item.id);
                                }
                              }}
                              disabled={deleteItemMutation.isPending}
                              className="p-1.5 rounded-md text-red-600 hover:bg-red-50 disabled:opacity-50 ml-2"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">No items in invoice</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <Button variant="outline" onClick={() => setShowEditModal(false)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Offscreen iframe at full A4 width for high-quality image capture */}
      <iframe
        ref={invoiceCaptureFrameRef}
        title="invoice-capture"
        style={{
          position: 'fixed',
          left: '-99999px',
          top: 0,
          width: `${INVOICE_CAPTURE_WIDTH_PX}px`,
          height: '1px',
          border: 0,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
