import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { posApi, catalogApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import ToastContainer from '../../components/ui/Toast';
import type { Toast } from '../../components/ui/Toast';
import BarcodeScanner from '../../components/BarcodeScanner';
import { printLabelsFromResponse } from '../../utils/printBarcodes';
import {
  Wrench,
  Search,
  Filter,
  Eye,
  Phone,
  Package,
  Clock,
  CheckCircle,
  Truck,
  Edit,
  Camera,
  AlertTriangle,
  FileText,
  X,
  Printer,
  RotateCcw,
  Loader2,
  Pencil,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  formatAppDate,
  formatNumber,
  isMtShopCustomer,
  MT_SHOP_BADGE_CLASS,
  MT_SHOP_MOBILE_CARD_CLASS,
  MT_SHOP_TABLE_ROW_CLASS,
  toLocalDateString,
} from '../../lib/utils';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import LoadingState from '../../components/ui/LoadingState';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import { InvoiceCustomerWithTags } from '../../components/invoices/InvoiceTagEditor';
import type { InvoiceTag } from '../../lib/invoiceTags';

interface RepairInvoice {
  id: number;
  invoice_number: string;
  store: number;
  store_name?: string;
  customer: number | null;
  customer_name: string | null;
  customer_group_name?: string;
  invoice_type: string;
  created_at: string;
  total: string;
  display_total?: string | number;
  computed_total?: string | number;
  computed_paid?: string | number;
  paid_amount?: string;
  items?: RepairInvoiceItem[];
  status?: 'draft' | 'paid' | 'partial' | 'credit' | 'void';
  tags?: InvoiceTag[];
  repair?: {
    id: number;
    contact_no: string;
    model_name: string;
    description?: string;
    booking_amount?: string;
    status: 'received' | 'work_in_progress' | 'done' | 'delivered' | 'not_repaired' | 'cancelled';
    barcode: string;
    delivery_date?: string | null;
    created_at: string;
    updated_at: string;
  };
}

interface RepairInvoiceItem {
  quantity?: string | number | null;
  unit_price?: string | number | null;
  manual_unit_price?: string | number | null;
  line_total?: string | number | null;
  product_purchase_price?: string | number | null;
  product_selling_price?: string | number | null;
}

// Matches backend pos.models.Repair.STATUS_CHOICES
const STATUS_OPTIONS = [
  { value: 'work_in_progress', label: 'Work in Progress' },
  { value: 'received', label: 'Received' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'not_repaired', label: 'Not Repaired' },
  { value: 'cancelled', label: 'Cancelled' },
];
const STATUS_FILTER_OPTIONS = STATUS_OPTIONS.filter((status) =>
  ['received', 'not_repaired', 'work_in_progress', 'delivered'].includes(status.value)
);

const STATUS_ORDER: string[] = [
  'work_in_progress',
  'received',
  'delivered',
  'not_repaired',
];

// Row order: when sorting table rows by status, WIP first, received second, not_repaired at the end
const ROW_STATUS_ORDER: string[] = [
  'work_in_progress',
  'received',
  'delivered',
  'not_repaired',
];

const STATUS_COLORS: Record<string, string> = {
  received: 'bg-sky-100 text-sky-800 border border-sky-200',
  work_in_progress: 'bg-amber-100 text-amber-800 border border-amber-200',
  done: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  delivered: 'bg-slate-100 text-slate-700 border border-slate-200',
  not_repaired: 'bg-orange-100 text-orange-800 border border-orange-200',
  cancelled: 'bg-red-100 text-red-800 border border-red-200',
};

const STATUS_ICONS: Record<string, any> = {
  received: Clock,
  work_in_progress: Wrench,
  done: CheckCircle,
  delivered: Truck,
  not_repaired: AlertTriangle,
  cancelled: X,
};

const STATUS_BAR_CLASS: Record<string, string> = {
  received: 'bg-sky-600',
  work_in_progress: 'bg-amber-600',
  done: 'bg-emerald-600',
  delivered: 'bg-slate-600',
  not_repaired: 'bg-orange-600',
  cancelled: 'bg-red-600',
  other: 'bg-gray-400',
};
const NOT_REPAIRED_DISPLAY_LIMIT = 50;

/** Sort repair invoices by status for table display, then by most recently updated within each status. */
function sortRepairsByRowStatusOrder<T extends { repair?: { status: string; updated_at?: string } | null; created_at?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const statusA = a.repair?.status ?? '';
    const statusB = b.repair?.status ?? '';
    const idxA = ROW_STATUS_ORDER.indexOf(statusA);
    const idxB = ROW_STATUS_ORDER.indexOf(statusB);
    const i = idxA === -1 ? ROW_STATUS_ORDER.length : idxA;
    const j = idxB === -1 ? ROW_STATUS_ORDER.length : idxB;
    if (i !== j) return i - j;
    const dateA = a.repair?.updated_at || (a as any).created_at || '';
    const dateB = b.repair?.updated_at || (b as any).created_at || '';
    return dateB.localeCompare(dateA);
  });
}

/** Effective row date for UI date grouping/highlight: prefer repair.created_at, fallback to invoice.created_at. */
function getRepairDisplayDate(inv: RepairInvoice): string {
  return inv.repair?.created_at || inv.created_at;
}

function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

function parseAmount(value: unknown): number {
  const parsed = parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function Repairs() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [listSearch, setListSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const listSearchDebounceRef = useRef<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [user, setUser] = useState<any>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<RepairInvoice | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [barcodeSearch, setBarcodeSearch] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Edit registration modal
  const [editingInvoice, setEditingInvoice] = useState<RepairInvoice | null>(null);
  const [editForm, setEditForm] = useState({ contact_no: '', model_name: '', description: '', booking_amount: '', delivery_date: '' });
  // Regenerate barcode: which invoice is currently regenerating (for min 5s loading)
  const [regeneratingInvoiceId, setRegeneratingInvoiceId] = useState<number | null>(null);
  const [regenerateStartedAt, setRegenerateStartedAt] = useState<number>(0);
  // Per-invoice last regenerate time for 30s cooldown
  const [lastRegenerateAt, setLastRegenerateAt] = useState<Record<number, number>>({});
  // Not Repaired section collapsed by default
  const [notRepairedCollapsed, setNotRepairedCollapsed] = useState(true);
  // Date filter for each status group (independent controls).
  // Delivered defaults to today and should use delivery_date matching.
  const [groupDateFilters, setGroupDateFilters] = useState<Record<string, string>>(() => ({
    delivered: toLocalDateString(new Date()),
  }));

  useEffect(() => {
    const loadUser = async () => {
      try {
        await auth.loadUser();
        setUser(auth.getUser());
      } catch {
        // Ignore user-load failure here; page still works without role-based total column.
      }
    };
    loadUser();
  }, []);

  useEffect(() => {
    return () => {
      if (listSearchDebounceRef.current) {
        window.clearTimeout(listSearchDebounceRef.current);
      }
    };
  }, []);

  const handleListSearchChange = (value: string) => {
    setListSearch(value);
    if (listSearchDebounceRef.current) {
      window.clearTimeout(listSearchDebounceRef.current);
    }
    listSearchDebounceRef.current = window.setTimeout(() => {
      setDebouncedSearch(value.trim());
    }, 250);
  };

  // Fetch stores (already filtered by backend based on user groups)
  const { data: storesResponse } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => {
      const response = await catalogApi.stores.list();
      return response.data;
    },
    retry: false,
  });

  const stores = (() => {
    if (!storesResponse) return [];
    if (Array.isArray(storesResponse.results)) return storesResponse.results;
    if (Array.isArray(storesResponse.data)) return storesResponse.data;
    if (Array.isArray(storesResponse)) return storesResponse;
    return [];
  })();

  // Auto-select first active store (backend already filters stores based on user groups)
  const defaultStore = stores.find((s: any) => s.is_active) || stores[0];

  // Only send store when it's a repair store (so we don't filter to a retail store and get 0 results)
  const repairStores = stores.filter((s: any) => String(s.shop_type || '').toLowerCase() === 'repair');
  const repairStore = repairStores.find((s: any) => s.id === defaultStore?.id) || repairStores[0];

  const repairQueriesEnabled = Boolean(repairStore?.id) || Boolean(debouncedSearch);
  const isListSearchActive = Boolean(debouncedSearch);
  const deliveredDateFilter = isListSearchActive
    ? ''
    : (groupDateFilters.delivered || toLocalDateString(new Date()));
  const sectionQueryEnabled = (sectionStatus: string) =>
    repairQueriesEnabled &&
    (isListSearchActive || !statusFilter || statusFilter === sectionStatus);

  const buildRepairParams = (extra: Record<string, any> = {}) => {
    const params: any = { ...extra };
    if (debouncedSearch) {
      params.search = debouncedSearch;
    }
    if (!debouncedSearch && repairStore?.id) {
      params.store = repairStore.id;
    }
    return params;
  };

  const { data: totalKpiData } = useQuery({
    queryKey: ['repair-invoices-kpi-total', repairStore?.id, debouncedSearch],
    queryFn: async () => {
      const response = await posApi.repair.invoices.list(buildRepairParams({ limit: 1 }));
      return response.data;
    },
    enabled: repairQueriesEnabled,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const { data: receivedKpiData, isLoading: isReceivedLoading, error: receivedError } = useQuery({
    queryKey: ['repair-invoices-section-received', repairStore?.id, debouncedSearch, statusFilter],
    queryFn: async () => {
      const response = await posApi.repair.invoices.list(buildRepairParams({
        repair_status: 'received',
        unpaginated: 'true',
      }));
      return response.data;
    },
    enabled: sectionQueryEnabled('received'),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const { data: deliveredKpiData, isLoading: isDeliveredLoading, error: deliveredError } = useQuery({
    queryKey: ['repair-invoices-section-delivered', repairStore?.id, debouncedSearch, statusFilter, deliveredDateFilter],
    queryFn: async () => {
      const params = buildRepairParams({
        repair_status: 'delivered',
        unpaginated: 'true',
      });
      if (deliveredDateFilter) {
        params.delivery_date = deliveredDateFilter;
      }
      const response = await posApi.repair.invoices.list(params);
      return response.data;
    },
    enabled: sectionQueryEnabled('delivered'),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const { data: wipKpiData, isLoading: isWipLoading, error: wipError } = useQuery({
    queryKey: ['repair-invoices-section-wip', repairStore?.id, debouncedSearch, statusFilter],
    queryFn: async () => {
      const response = await posApi.repair.invoices.list(buildRepairParams({
        repair_status: 'work_in_progress',
        unpaginated: 'true',
      }));
      return response.data;
    },
    enabled: sectionQueryEnabled('work_in_progress'),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const { data: notRepairedKpiData, isLoading: isNotRepairedLoading, error: notRepairedError } = useQuery({
    queryKey: ['repair-invoices-section-not-repaired', repairStore?.id, debouncedSearch, statusFilter],
    queryFn: async () => {
      const response = await posApi.repair.invoices.list(buildRepairParams({
        repair_status: 'not_repaired',
        limit: 50,
        ordering: '-repair__updated_at',
      }));
      return response.data;
    },
    enabled: sectionQueryEnabled('not_repaired'),
    placeholderData: keepPreviousData,
    retry: false,
  });

  // Find repair invoice by barcode
  const findInvoiceByBarcodeQuery = useQuery({
    queryKey: ['find-repair-invoice', barcodeSearch],
    queryFn: async () => {
      if (!barcodeSearch.trim()) return null;
      try {
        const response = await posApi.repair.invoices.findByBarcode(barcodeSearch.trim());
        if (response.data) {
          setSelectedInvoice(response.data);
          setSearchError(null);
          return response.data;
        }
        return null;
      } catch (error: any) {
        const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Repair invoice not found';
        setSearchError(errorMsg);
        setSelectedInvoice(null);
        return null;
      }
    },
    enabled: false, // Don't auto-fetch, only on button click
    retry: false,
  });

  // Sync edit form when opening edit modal
  useEffect(() => {
    if (editingInvoice?.repair) {
      setEditForm({
        contact_no: editingInvoice.repair.contact_no || '',
        model_name: editingInvoice.repair.model_name || '',
        description: editingInvoice.repair.description || '',
        booking_amount: editingInvoice.repair.booking_amount != null && editingInvoice.repair.booking_amount !== '' ? String(editingInvoice.repair.booking_amount) : '',
        delivery_date: editingInvoice.repair.delivery_date || '',
      });
    }
  }, [editingInvoice]);

  const handleBarcodeSearch = () => {
    if (!barcodeSearch.trim()) {
      setSearchError('Please enter a repair barcode');
      return;
    }
    findInvoiceByBarcodeQuery.refetch();
  };

  const handleBarcodeScan = (barcode: string) => {
    setBarcodeSearch(barcode);
    setShowScanner(false);
    // Auto-search after scanning
    setTimeout(() => {
      if (barcode.trim()) {
        findInvoiceByBarcodeQuery.refetch();
      }
    }, 100);
  };

  // Toast helper function
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Generate and print repair label
  const generateLabelMutation = useMutation({
    mutationFn: async (invoiceId: number) => {
      return await posApi.repair.generateLabel(invoiceId);
    },
    onSuccess: (response: any) => {
      if (response?.data?.label?.image) {
        printLabelsFromResponse({ labels: [{ image: response.data.label.image }] });
        showToast('Repair label generated and opened for printing', 'success');
      } else {
        showToast('Label generated but no image found', 'error');
      }
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to generate repair label';
      showToast(errorMsg, 'error');
    },
  });

  const handlePrintRepairLabel = (invoice: RepairInvoice) => {
    if (!invoice.repair) {
      showToast('This invoice does not have a repair record', 'error');
      return;
    }
    generateLabelMutation.mutate(invoice.id);
  };

  const REGENERATE_COOLDOWN_MS = 30 * 1000;
  const REGENERATE_MIN_WAIT_MS = 5 * 1000;

  const regenerateLabelMutation = useMutation({
    mutationFn: async (invoiceId: number) => {
      return await posApi.repair.generateLabel(invoiceId, true);
    },
    onSuccess: () => {
      showToast('Repair barcode label regenerated', 'success');
      const elapsed = Date.now() - regenerateStartedAt;
      const remaining = Math.max(0, REGENERATE_MIN_WAIT_MS - elapsed);
      setTimeout(() => setRegeneratingInvoiceId(null), remaining);
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to regenerate repair barcode';
      showToast(errorMsg, 'error');
      const elapsed = Date.now() - regenerateStartedAt;
      const remaining = Math.max(0, REGENERATE_MIN_WAIT_MS - elapsed);
      setTimeout(() => setRegeneratingInvoiceId(null), remaining);
    },
  });

  const handleRegenerateRepairLabel = (invoice: RepairInvoice) => {
    if (!invoice.repair) {
      showToast('This invoice does not have a repair record', 'error');
      return;
    }
    const now = Date.now();
    const last = lastRegenerateAt[invoice.id] ?? 0;
    if (now - last < REGENERATE_COOLDOWN_MS) {
      const secs = Math.ceil((REGENERATE_COOLDOWN_MS - (now - last)) / 1000);
      showToast(`Please wait ${secs}s before regenerating again`, 'error');
      return;
    }
    setLastRegenerateAt((prev) => ({ ...prev, [invoice.id]: now }));
    setRegeneratingInvoiceId(invoice.id);
    setRegenerateStartedAt(now);
    regenerateLabelMutation.mutate(invoice.id);
  };

  const handleRepairStatusAction = (invoice: RepairInvoice) => {
    if (!invoice.repair) {
      showToast('This invoice does not have a repair record', 'error');
      return;
    }
    navigate(`/invoices/${invoice.id}?openCheckout=1`);
  };

  const isRegenerateDisabled = (invoiceId: number) => {
    const last = lastRegenerateAt[invoiceId] ?? 0;
    return Date.now() - last < REGENERATE_COOLDOWN_MS;
  };

  const updateRepairMutation = useMutation({
    mutationFn: async ({ invoiceId, data }: { invoiceId: number; data: { contact_no: string; model_name: string; description?: string; booking_amount?: string | null; delivery_date?: string | null } }) => {
      return await posApi.repair.update(invoiceId, data);
    },
    onSuccess: () => {
      showToast('Repair registration updated', 'success');
      setEditingInvoice(null);
      queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] || '').startsWith('repair-invoices-section'),
      });
      queryClient.invalidateQueries({ queryKey: ['repair-invoices-kpi-total'] });
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to update repair';
      showToast(errorMsg, 'error');
    },
  });

  const getRepairResults = (payload: any): RepairInvoice[] =>
    Array.isArray(payload?.results) ? payload.results : [];

  const workInProgressItems = getRepairResults(wipKpiData);
  const receivedItems = getRepairResults(receivedKpiData);
  const deliveredItems = getRepairResults(deliveredKpiData);
  const notRepairedItems = getRepairResults(notRepairedKpiData);

  const repairInvoices: RepairInvoice[] = (() => {
    if (!isListSearchActive && statusFilter === 'work_in_progress') return workInProgressItems;
    if (!isListSearchActive && statusFilter === 'received') return receivedItems;
    if (!isListSearchActive && statusFilter === 'delivered') return deliveredItems;
    if (!isListSearchActive && statusFilter === 'not_repaired') return notRepairedItems;
    return [
      ...workInProgressItems,
      ...receivedItems,
      ...deliveredItems,
      ...notRepairedItems,
    ];
  })();

  // Search is applied server-side (invoice_number + customer_name)
  const filteredRepairs = repairInvoices;
  const canSeeSuperMetrics = (user?.groups || []).includes('Super');
  const canSeeTotalColumn = canSeeSuperMetrics;

  // Single "Not Repaired" group: keep latest rows only to avoid an oversized section.
  const allNotRepairedItems = filteredRepairs.filter((inv) => inv.repair?.status === 'not_repaired');
  const allNotRepaired = allNotRepairedItems
    .slice()
    .sort((a, b) => {
      const dateA = a.repair?.updated_at || a.created_at || '';
      const dateB = b.repair?.updated_at || b.created_at || '';
      return dateB.localeCompare(dateA);
    })
    .slice(0, NOT_REPAIRED_DISPLAY_LIMIT);

  // Status groups: include delivered, but keep old delivered only in Old Repair.
  const STATUS_ORDER_MAIN = STATUS_ORDER.filter((s) => s !== 'not_repaired');
  const statusGroups = STATUS_ORDER_MAIN.map((status) => ({
    status,
    label: STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status,
    items: filteredRepairs.filter((inv) => {
      if (inv.repair?.status !== status) return false;
      return true;
    }),
  }));
  // Other = status not in main list; exclude not_repaired/done (and anything already covered above)
  const otherItems = filteredRepairs.filter(
    (inv) =>
      inv.repair &&
      inv.repair.status !== 'done' &&
      inv.repair.status !== 'not_repaired' &&
      !STATUS_ORDER_MAIN.includes(inv.repair?.status ?? '')
  );
  const groupsWithItems = [
    ...statusGroups,
    ...(otherItems.length > 0 ? [{ status: 'other', label: 'Other', items: otherItems }] : []),
    // Not Repaired: one group at the very end, collapsed by default (today + old)
    ...(allNotRepaired.length > 0
      ? [{ status: 'not_repaired', label: 'Not Repaired', items: allNotRepaired }]
      : []),
  ];
  const getGroupSelectedDate = (status: string, _items: RepairInvoice[]) => {
    // No default date filter: sections should show all dates unless user picks one.
    return groupDateFilters[status] ?? '';
  };
  /** Match group date. Delivered uses delivery_date only. */
  const matchesGroupDate = (invoice: RepairInvoice, selectedDate: string, status: string) => {
    if (!selectedDate) return true;
    if (status === 'delivered') {
      const deliveryDate = invoice.repair?.delivery_date ? toLocalDateString(invoice.repair.delivery_date) : '';
      return deliveryDate === selectedDate;
    }
    const repairDate = toLocalDateString(getRepairDisplayDate(invoice));
    return repairDate === selectedDate;
  };

  const formatDate = (dateString: string) =>
    formatAppDate(dateString, { includeTime: false, empty: '' });

  /** Repair row created_at (registration time), same source as POS Repair Registration. */
  const formatRepairRegisteredAt = (dateString: string | undefined) =>
    formatAppDate(dateString, { includeTime: true, empty: '—' });

  const getStatusBadge = (status: string) => {
    const Icon = STATUS_ICONS[status] || Clock;
    return (
      <Badge className={STATUS_COLORS[status] || 'bg-gray-100 text-gray-800 border border-gray-200'}>
        <Icon className="h-3 w-3 mr-1" />
        {STATUS_OPTIONS.find(s => s.value === status)?.label || status}
      </Badge>
    );
  };

  const totalRepairs = Number(totalKpiData?.count || 0);
  const receivedRepairs = receivedItems.length;
  const deliveredRepairs = deliveredItems.length;
  const workInProgressRepairs = workInProgressItems.length;
  const notRepairedRepairs = notRepairedItems.length;
  const isRepairsLoading = isWipLoading || isReceivedLoading || isDeliveredLoading || isNotRepairedLoading;
  const repairsError = wipError || receivedError || deliveredError || notRepairedError;

  if (isRepairsLoading) {
    return <LoadingState message="Loading repairs..." />;
  }

  if (repairsError) {
    return (
      <ErrorState
        message="Error loading repairs. Please try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!defaultStore && stores.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Wrench className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Repairs</h2>
          <p className="text-red-600 mb-4">No store available. Please create a store first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1">
          <PageHeader
            title="Repairs"
            subtitle="View and manage all repair orders"
            icon={Wrench}
          />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Repairs</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{totalRepairs}</p>
            </div>
            <div className="p-3 bg-blue-100 rounded-lg">
              <Wrench className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Received</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{receivedRepairs}</p>
            </div>
            <div className="p-3 bg-blue-100 rounded-lg">
              <Clock className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Delivered</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{deliveredRepairs}</p>
            </div>
            <div className="p-3 bg-slate-100 rounded-lg">
              <Truck className="h-6 w-6 text-slate-600" />
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <div className="space-y-4">
          {/* Top Filters (3-up on desktop) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Search by Repair Barcode
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <Input
                    type="text"
                    value={barcodeSearch}
                    onChange={(e) => {
                      setBarcodeSearch(e.target.value);
                      setSearchError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleBarcodeSearch();
                      }
                    }}
                    placeholder="Enter repair barcode"
                    className="pl-10 pr-20"
                  />
                  <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                    <Button
                      onClick={() => setShowScanner(true)}
                      variant="outline"
                      size="sm"
                      className="whitespace-nowrap"
                      title="Open camera scanner"
                    >
                      <Camera className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <Button
                  onClick={handleBarcodeSearch}
                  disabled={findInvoiceByBarcodeQuery.isFetching}
                  variant="default"
                >
                  <Search className="h-4 w-4 mr-2" />
                  Search
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Search (invoice #, customer, contact, model, barcode, short code)
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  value={listSearch}
                  placeholder="Invoice #, customer, contact, model, barcode, short code..."
                  onChange={(e) => handleListSearchChange(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Status
              </label>
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                icon={<Filter className="h-4 w-4" />}
              >
                <option value="">All Statuses</option>
              {STATUS_FILTER_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {searchError && (
            <div className="text-sm text-red-600 flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" />
              {searchError}
            </div>
          )}

          {/* QR Code Scanner */}
          {showScanner && (
            <div className="border rounded-lg p-4 bg-gray-50 flex justify-center">
              <div className="w-full max-w-sm">
                <BarcodeScanner
                  isOpen={showScanner}
                  continuous={true}
                  onScan={handleBarcodeScan}
                  onClose={() => setShowScanner(false)}
                />
              </div>
            </div>
          )}

          {/* Selected Invoice Details (from barcode search) */}
          {selectedInvoice && findInvoiceByBarcodeQuery.data && (
            <div className="border rounded-lg p-4 bg-blue-50 border-blue-200">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-blue-600" />
                  <h3 className="font-semibold text-lg">Repair Invoice Details</h3>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedInvoice(null);
                    setBarcodeSearch('');
                    setSearchError(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {selectedInvoice.repair && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <span className="text-gray-600 block text-xs">Invoice Number</span>
                      <span className="font-medium">{selectedInvoice.invoice_number}</span>
                    </div>
                    {!['REPAIR', 'NO GROUP'].includes((selectedInvoice.customer_group_name || '').toUpperCase()) && (
                      <div>
                        <span className="text-gray-600 block text-xs">Customer</span>
                        <span className="font-medium">{selectedInvoice.customer_name || 'N/A'}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-600 block text-xs">Store</span>
                      <span className="font-medium">{selectedInvoice.store_name || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-gray-600 block text-xs">Status</span>
                      {getStatusBadge(selectedInvoice.repair.status)}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm pt-3 border-t">
                    <div>
                      <span className="text-gray-600 block text-xs flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        Contact No
                      </span>
                      <span className="font-medium">{selectedInvoice.repair.contact_no}</span>
                    </div>
                    <div>
                      <span className="text-gray-600 block text-xs flex items-center gap-1">
                        <Package className="h-3 w-3" />
                        Model Name
                      </span>
                      <span className="font-medium">{selectedInvoice.repair.model_name}</span>
                    </div>
                    <div>
                      <span className="text-gray-600 block text-xs">Repair Barcode</span>
                      <span className="font-medium font-mono">{selectedInvoice.repair.barcode}</span>
                    </div>
                    <div>
                      <span className="text-gray-600 block text-xs">Booking Amount</span>
                      <span className="font-medium">
                        {selectedInvoice.repair.booking_amount
                          ? `₹${formatNumber(selectedInvoice.repair.booking_amount)}`
                          : 'N/A'}
                      </span>
                    </div>
                    {selectedInvoice.repair.delivery_date && (
                      <div>
                        <span className="text-gray-600 block text-xs flex items-center gap-1">
                          <Truck className="h-3 w-3" />
                          Delivery Date
                        </span>
                        <span className="font-medium">{formatDate(selectedInvoice.repair.delivery_date)}</span>
                      </div>
                    )}
                  </div>
                  <div className="pt-3 border-t flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setEditingInvoice(selectedInvoice)}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => handleRepairStatusAction(selectedInvoice)}
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Update Status
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Color Legend */}
      <div className="flex flex-wrap gap-4 px-2 py-1">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-blue-100 border border-blue-200"></div>
          <span className="text-xs text-gray-600 font-medium whitespace-nowrap">Cash Sale</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-emerald-100 border border-emerald-200"></div>
          <span className="text-xs text-gray-600 font-medium whitespace-nowrap">UPI Payment</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-amber-100 border border-amber-200"></div>
          <span className="text-xs text-gray-600 font-medium whitespace-nowrap">Pending / Credit</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-purple-100 border border-purple-200"></div>
          <span className="text-xs text-gray-600 font-medium whitespace-nowrap">Repair Service</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-red-50 border border-red-300"></div>
          <span className="text-xs text-gray-600 font-medium whitespace-nowrap">Old Received / Work in Progress</span>
        </div>
      </div>

      {/* Repairs Table */}
      {filteredRepairs.length === 0 ? (
        <Card>
          <EmptyState
            icon={Wrench}
            title="No repairs found"
            message="No repairs match your search criteria"
          />
        </Card>
      ) : (
        <div className="space-y-8">
          {groupsWithItems.map((group) => {
            const isNotRepairedGroup = group.status === 'not_repaired';
            const isCollapsed = isNotRepairedGroup && notRepairedCollapsed;
            // When status or search filters are active, show all rows (no date slicing).
            const hasAnySearch = isListSearchActive || Boolean(barcodeSearch.trim());
            const hasGroupDateSelector = group.status === 'delivered' && !statusFilter && !hasAnySearch;
            const selectedGroupDate = hasGroupDateSelector
              ? getGroupSelectedDate(group.status, group.items)
              : '';
            const displayedGroupItems = group.items.filter((invoice) => matchesGroupDate(invoice, selectedGroupDate, group.status));
            // Profit = sum(paid) - sum(total) for Super group summary row
            const groupTotalSum = displayedGroupItems.reduce((s, inv) => s + parseAmount(inv.computed_total), 0);
            const groupPaidSum = displayedGroupItems.reduce((s, inv) => s + parseAmount(inv.computed_paid), 0);
            const groupProfit = groupPaidSum - groupTotalSum;
            return (
            <div key={group.status} className="space-y-4">
              <div className="flex flex-col gap-1 px-2">
                <div
                  className={`flex items-center gap-3 ${isNotRepairedGroup ? 'cursor-pointer select-none' : ''}`}
                  onClick={
                    isNotRepairedGroup
                      ? () => setNotRepairedCollapsed((c) => !c)
                      : undefined
                  }
                >
                  {isNotRepairedGroup && (
                    <span className="text-gray-500">
                      {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                    </span>
                  )}
                  <div
                    className={`h-8 w-1.5 rounded-full shrink-0 ${STATUS_BAR_CLASS[group.status] ?? 'bg-gray-400'}`}
                  />
                  <h2 className="text-xl font-bold text-gray-900">{group.label}</h2>
                  <Badge variant="outline" className="ml-2 font-mono">
                    {group.status === 'work_in_progress'
                      ? workInProgressRepairs
                      : group.status === 'received'
                        ? receivedRepairs
                        : group.status === 'delivered'
                          ? deliveredRepairs
                          : group.status === 'not_repaired'
                            ? notRepairedRepairs
                            : displayedGroupItems.length}
                  </Badge>
                  {hasGroupDateSelector && (
                    <div className="ml-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <span className="text-xs text-gray-500 whitespace-nowrap">Delivery date</span>
                      <input
                        type="date"
                        value={selectedGroupDate}
                        onChange={(e) => setGroupDateFilters((prev) => ({ ...prev, [group.status]: e.target.value }))}
                        className="h-8 rounded-md border border-gray-200 px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-label={`Filter ${group.label} by delivery date`}
                      />
                    </div>
                  )}
                </div>
                {isNotRepairedGroup && (
                  <p className="text-sm text-gray-500 ml-5">
                    Click to expand
                    {allNotRepairedItems.length > NOT_REPAIRED_DISPLAY_LIMIT
                      ? ` · showing latest ${NOT_REPAIRED_DISPLAY_LIMIT} of ${allNotRepairedItems.length}`
                      : ''}
                  </p>
                )}
              </div>

              {/* Desktop Table View */}
              {!isCollapsed && (
              <div className="hidden md:block">
                {displayedGroupItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                    No repairs found for the selected date.
                  </div>
                ) : (
                <Table compact headers={[
                  { label: 'Invoice', align: 'left' },
                  { label: 'Registered', align: 'left' },
                  { label: 'Delivery', align: 'left' },
                  { label: 'Customer', align: 'left' },
                  { label: 'Model', align: 'left' },
                  { label: 'Booking', align: 'right' },
                  { label: 'Work', align: 'left' },
                  { label: 'Status', align: 'left' },
                  { label: 'Type', align: 'left' },
                  ...(canSeeTotalColumn ? [{ label: 'Total', align: 'right' as const }] : []),
                  { label: 'Paid', align: 'right' },
                  { label: 'Actions', align: 'right' },
                ]}>
                  {sortRepairsByRowStatusOrder(displayedGroupItems).map((invoice) => {
                    const isOlderThanToday = !isToday(new Date(getRepairDisplayDate(invoice)));
                    const isMtShop = isMtShopCustomer(invoice.customer_name, invoice.customer_group_name);

                    return (
                      <TableRow
                        key={invoice.id}
                        className={`cursor-pointer transition-colors hover:opacity-80 ${isMtShop ? MT_SHOP_TABLE_ROW_CLASS : isOlderThanToday ? 'bg-red-50/70 border-l-4 border-red-300' :
                          invoice.invoice_type === 'cash' ? 'bg-blue-50/50' :
                      invoice.invoice_type === 'upi' ? 'bg-emerald-50/50' :
                        invoice.invoice_type === 'pending' || invoice.invoice_type === 'credit' ? 'bg-amber-50/50' :
                          invoice.invoice_type === 'repair' || invoice.invoice_type === 'pos_repair' ? 'bg-purple-50/50' : ''
                          }`}
                      >
                        <TableCell>
                          <span
                            className="font-mono font-semibold text-gray-900 cursor-pointer hover:text-blue-600"
                            onClick={() => navigate(`/invoices/${invoice.id}`)}
                            title={invoice.invoice_number}
                          >
                            {invoice.invoice_number.split('-').pop()}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span
                            className="text-gray-600 text-xs leading-snug"
                            title={invoice.repair?.created_at ? formatRepairRegisteredAt(invoice.repair.created_at) : undefined}
                          >
                            {formatRepairRegisteredAt(invoice.repair?.created_at)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-gray-600 text-xs">
                            {invoice.repair?.delivery_date ? formatDate(invoice.repair.delivery_date) : '—'}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-normal min-w-[8rem]">
                          <InvoiceCustomerWithTags
                            invoiceId={invoice.id}
                            customerName={invoice.customer_name}
                            tags={invoice.tags}
                            fallbackName="Walk-in"
                            compact
                            badge={isMtShop ? (
                              <span className={MT_SHOP_BADGE_CLASS}>
                                MT SHOP
                              </span>
                            ) : undefined}
                            extraBelow={
                              <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
                                {invoice.repair?.contact_no && (
                                  <div className="flex items-center gap-0.5 text-[11px] text-gray-600 tabular-nums min-w-0">
                                    <Phone className="h-3 w-3 text-gray-400 shrink-0" />
                                    <span className="truncate" title={invoice.repair.contact_no}>
                                      {invoice.repair.contact_no}
                                    </span>
                                  </div>
                                )}
                                {invoice.customer_group_name && !isMtShop && (
                                  <span className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 shrink-0">
                                    {invoice.customer_group_name}
                                  </span>
                                )}
                              </div>
                            }
                          />
                        </TableCell>
                        <TableCell className="max-w-[10rem] whitespace-normal">
                          <div className="flex items-center gap-1 min-w-0">
                            <Package className="h-3 w-3 text-gray-400 shrink-0" />
                            <span className="text-gray-600 text-xs whitespace-normal break-words leading-4">
                              {invoice.repair?.model_name || '—'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-gray-900 font-medium text-xs tabular-nums">
                            {invoice.repair?.booking_amount != null && invoice.repair.booking_amount !== ''
                              ? `₹${formatNumber(invoice.repair.booking_amount)}`
                              : '—'}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-normal max-w-[7rem]">
                          <span className="text-gray-600 text-[11px] leading-snug line-clamp-2" title={invoice.repair?.description || undefined}>
                            {invoice.repair?.description || '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          {invoice.repair ? (
                            <span className="inline-flex scale-90 origin-left">{getStatusBadge(invoice.repair.status)}</span>
                          ) : (
                            'N/A'
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="uppercase text-[9px] font-bold tracking-wide px-1.5 py-0">
                            {invoice.invoice_type}
                          </Badge>
                        </TableCell>
                        {canSeeTotalColumn && (
                          <TableCell align="right">
                            <span className="font-semibold text-gray-900 text-xs tabular-nums">
                              ₹{formatNumber(parseAmount(invoice.computed_total))}
                            </span>
                          </TableCell>
                        )}
                        <TableCell align="right">
                          <span className="text-green-600 font-medium text-xs tabular-nums">
                            ₹{formatNumber(parseAmount(invoice.computed_paid))}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-0.5 justify-end flex-nowrap" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (invoice.repair) {
                                  setEditingInvoice(invoice);
                                } else {
                                  showToast('This invoice does not have a repair record', 'error');
                                }
                              }}
                              className="!px-2 !py-1.5 min-w-0 shrink-0"
                              disabled={!invoice.repair}
                              title="Edit repair details"
                              aria-label="Edit repair details"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRepairStatusAction(invoice);
                              }}
                              className="!px-2 !py-1.5 min-w-0 shrink-0"
                              disabled={!invoice.repair}
                              title="Update status"
                              aria-label="Update repair status"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePrintRepairLabel(invoice);
                              }}
                              className="!px-2 !py-1.5 min-w-0 shrink-0"
                              disabled={!invoice.repair || generateLabelMutation.isPending}
                              title="Print repair barcode label"
                              aria-label="Print repair barcode label"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                            {regeneratingInvoiceId === invoice.id ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled
                                className="!px-2 !py-1.5 min-w-0 shrink-0 text-orange-700 bg-orange-50 border-orange-200"
                                title="Generating barcode..."
                                aria-label="Generating barcode"
                              >
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRegenerateRepairLabel(invoice);
                                }}
                                className="!px-2 !py-1.5 min-w-0 shrink-0 text-orange-700 bg-orange-50 border-orange-200 hover:bg-orange-100 hover:border-orange-300"
                                disabled={!invoice.repair || isRegenerateDisabled(invoice.id)}
                                title={isRegenerateDisabled(invoice.id) ? 'Wait 30s before regenerating again' : 'Regenerate barcode label'}
                                aria-label="Regenerate barcode label"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/invoices/${invoice.id}`);
                              }}
                              className="!px-2 !py-1.5 min-w-0 shrink-0"
                              title="View invoice"
                              aria-label="View invoice"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {canSeeTotalColumn && displayedGroupItems.length > 0 && (
                    <TableRow className="bg-gray-100 border-t-2 border-gray-300 font-semibold">
                      <TableCell colSpan={10} className="text-right text-gray-700 text-xs whitespace-nowrap">
                      {' '}
                      </TableCell>
                      <TableCell align="right" className="text-emerald-700 text-xs tabular-nums">
                        ₹{formatNumber(groupProfit)}
                      </TableCell>
                      <TableCell>{' '}</TableCell>
                    </TableRow>
                  )}
                </Table>
                )}
              </div>
              )}

              {/* Mobile Card View */}
              {!isCollapsed && (
              <div className="md:hidden space-y-3">
                {displayedGroupItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                    No repairs found for the selected date.
                  </div>
                ) : sortRepairsByRowStatusOrder(displayedGroupItems).map((invoice) => {
                  const isOlderThanToday = !isToday(new Date(getRepairDisplayDate(invoice)));
                  const isMtShop = isMtShopCustomer(invoice.customer_name, invoice.customer_group_name);

                  return (
                    <div
                      key={invoice.id}
                      onClick={() => navigate(`/invoices/${invoice.id}`)}
                      className={`border rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer ${isMtShop ? MT_SHOP_MOBILE_CARD_CLASS : isOlderThanToday ? 'bg-red-50/70 border-red-300' :
                    invoice.invoice_type === 'cash' ? 'bg-blue-50/70 border-blue-100' :
                    invoice.invoice_type === 'upi' ? 'bg-emerald-50/70 border-emerald-100' :
                      invoice.invoice_type === 'pending' || invoice.invoice_type === 'credit' ? 'bg-amber-50/70 border-amber-100' :
                        invoice.invoice_type === 'repair' || invoice.invoice_type === 'pos_repair' ? 'bg-purple-50/70 border-purple-100' :
                          'bg-gray-50/70 border-gray-100'
                          }`}
                    >
                      <div className="p-4">
                        <div className="mb-3">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <Wrench className="h-4 w-4 text-blue-600 flex-shrink-0" />
                              <span className="font-mono font-semibold text-gray-900 text-base">
                                {invoice.invoice_number.split('-').pop()}
                              </span>
                            </div>
                            <Badge variant="outline" className="uppercase text-[9px] font-bold">
                              {invoice.invoice_type}
                            </Badge>
                          </div>
                          <div className="text-xs text-gray-600 mb-1" title={invoice.repair?.created_at ? 'Repair registered' : undefined}>
                            <span className="text-gray-500 font-medium">Registered: </span>
                            {invoice.repair?.created_at ? formatRepairRegisteredAt(invoice.repair.created_at) : '—'}
                          </div>
                          {invoice.repair?.delivery_date && (
                            <div className="text-sm text-gray-600 mb-1">
                              <span className="text-gray-500 font-medium">Delivery: </span>
                              <span>{formatDate(invoice.repair.delivery_date)}</span>
                            </div>
                          )}
                          <div className="mb-1">
                            <InvoiceCustomerWithTags
                              invoiceId={invoice.id}
                              customerName={invoice.customer_name}
                              tags={invoice.tags}
                              fallbackName="Walk-in Customer"
                              compact
                              badge={isMtShop ? (
                                <span className={MT_SHOP_BADGE_CLASS}>
                                  MT SHOP
                                </span>
                              ) : undefined}
                              extraBelow={
                                invoice.repair?.contact_no ? (
                                  <div className="mt-1 flex items-center gap-2 text-sm text-gray-600">
                                    <Phone className="h-3.5 w-3.5 text-gray-400" />
                                    <span>{invoice.repair.contact_no}</span>
                                  </div>
                                ) : undefined
                              }
                            />
                          </div>
                          {invoice.repair && (
                            <>
                              <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                                <Package className="h-3.5 w-3.5 text-gray-400" />
                                <span>{invoice.repair.model_name}</span>
                              </div>
                              <div className="text-sm text-gray-600 mb-1">
                                <span className="text-gray-500 font-medium">Booking Amt: </span>
                                <span className="font-medium text-gray-900">
                                  {invoice.repair.booking_amount != null && invoice.repair.booking_amount !== ''
                                    ? `₹${formatNumber(invoice.repair.booking_amount)}`
                                    : '—'}
                                </span>
                              </div>
                              <div className={`grid ${canSeeTotalColumn ? 'grid-cols-2' : 'grid-cols-1'} gap-2 text-sm mb-1`}>
                                {canSeeTotalColumn && (
                                  <div>
                                    <span className="text-gray-500 font-medium">Total: </span>
                                    <span className="font-medium text-gray-900">₹{formatNumber(parseAmount(invoice.computed_total))}</span>
                                  </div>
                                )}
                                <div>
                                  <span className="text-green-700 font-medium">Paid: </span>
                                  <span className="font-medium text-green-700">₹{formatNumber(parseAmount(invoice.computed_paid))}</span>
                                </div>
                              </div>
                              {invoice.repair.description && (
                                <div className="text-sm text-gray-600 mb-1">
                                  <span className="text-gray-500 font-medium">Work: </span>
                                  <span className="line-clamp-2">{invoice.repair.description}</span>
                                </div>
                              )}
                              <div className="mt-2">
                                {getStatusBadge(invoice.repair.status)}
                              </div>
                            </>
                          )}
                        </div>
                        <div className="pt-3 border-t border-black/5 mt-2 space-y-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (invoice.repair) setEditingInvoice(invoice);
                              else showToast('This invoice does not have a repair record', 'error');
                            }}
                            className="w-full gap-1.5"
                            disabled={!invoice.repair}
                          >
                            <Pencil className="h-4 w-4 flex-shrink-0" />
                            <span>Edit</span>
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRepairStatusAction(invoice);
                            }}
                            className="w-full gap-1.5"
                            disabled={!invoice.repair}
                          >
                            <Edit className="h-4 w-4 flex-shrink-0" />
                            <span>Status</span>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePrintRepairLabel(invoice);
                            }}
                            className="w-full gap-1.5"
                            disabled={!invoice.repair || generateLabelMutation.isPending}
                          >
                            <Printer className="h-4 w-4 flex-shrink-0" />
                            <span>Print Label</span>
                          </Button>
                          {regeneratingInvoiceId === invoice.id ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled
                              className="w-full gap-1.5 text-orange-700 bg-orange-50 border-orange-200"
                              title="Generating barcode..."
                            >
                              <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
                              <span>Generating...</span>
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRegenerateRepairLabel(invoice);
                              }}
                              className="w-full gap-1.5 text-orange-700 bg-orange-50 border-orange-200 hover:bg-orange-100 hover:border-orange-300"
                              disabled={!invoice.repair || isRegenerateDisabled(invoice.id)}
                              title={isRegenerateDisabled(invoice.id) ? 'Wait 30s before regenerating again' : 'Regenerate barcode label'}
                            >
                              <RotateCcw className="h-4 w-4 flex-shrink-0" />
                              <span>Regenerate Barcode</span>
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {canSeeTotalColumn && displayedGroupItems.length > 0 && (
                  <div className="rounded-lg border border-gray-200 bg-gray-100 px-4 py-3 text-sm font-semibold flex justify-between items-center gap-3">
                    <span className="text-gray-700"> </span>
                    <span className="text-emerald-700 tabular-nums shrink-0">₹{formatNumber(groupProfit)}</span>
                  </div>
                )}
              </div>
              )}
            </div>
            );
          })}
        </div>
      )}


      {/* Edit Repair Registration Modal */}
      <Modal
        isOpen={!!editingInvoice}
        onClose={() => setEditingInvoice(null)}
        title="Edit Repair Registration"
        size="md"
      >
        {editingInvoice?.repair && (
          <div className="p-2 space-y-4">
            <p className="text-sm text-gray-600">
              Invoice <span className="font-mono font-semibold">{editingInvoice.invoice_number}</span>
              {editingInvoice.repair.barcode && (
                <span className="ml-2 text-gray-500">· {editingInvoice.repair.barcode}</span>
              )}
            </p>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Contact Number</label>
              <Input
                value={editForm.contact_no}
                onChange={(e) => setEditForm((f) => ({ ...f, contact_no: e.target.value }))}
                placeholder="Contact number"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Device Model *</label>
              <Input
                value={editForm.model_name}
                onChange={(e) => setEditForm((f) => ({ ...f, model_name: e.target.value }))}
                placeholder="Model name"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Issue Description</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Describe the problem..."
                className="w-full h-24 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Booking Amount</label>
              <Input
                type="number"
                value={editForm.booking_amount}
                onChange={(e) => setEditForm((f) => ({ ...f, booking_amount: e.target.value }))}
                placeholder="0.00"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Delivery Date</label>
              <Input
                type="date"
                value={editForm.delivery_date}
                onChange={(e) => setEditForm((f) => ({ ...f, delivery_date: e.target.value }))}
                placeholder="YYYY-MM-DD"
                className="h-11"
                disabled={editingInvoice.status === 'draft' && editingInvoice.invoice_type === 'pending'}
              />
              {editingInvoice.status === 'draft' && editingInvoice.invoice_type === 'pending' && (
                <p className="text-xs text-gray-500">Delivery date is disabled for draft pending repairs.</p>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="primary"
                onClick={() => {
                  if (!editingInvoice?.repair) return;
                  if (!editForm.model_name.trim()) {
                    showToast('Device model is required', 'error');
                    return;
                  }
                  if (editingInvoice.status === 'draft' && editingInvoice.invoice_type === 'pending') {
                    showToast('Delivery date cannot be set for draft pending repairs', 'error');
                  }
                  updateRepairMutation.mutate({
                    invoiceId: editingInvoice.id,
                    data: {
                      contact_no: editForm.contact_no.trim(),
                      model_name: editForm.model_name.trim(),
                      description: editForm.description.trim() || undefined,
                      booking_amount: editForm.booking_amount.trim() ? editForm.booking_amount.trim() : null,
                      delivery_date:
                        editingInvoice.status === 'draft' && editingInvoice.invoice_type === 'pending'
                          ? null
                          : (editForm.delivery_date.trim() ? editForm.delivery_date.trim() : null),
                    },
                  });
                }}
                disabled={updateRepairMutation.isPending || !editForm.model_name.trim()}
                className="flex-1"
              >
                {updateRepairMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
              <Button variant="outline" onClick={() => setEditingInvoice(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
