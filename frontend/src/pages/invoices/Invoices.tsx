import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { posApi, catalogApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import {
  FileText,
  Search,
  Filter,
  Eye,
  CheckCircle,
  Coins,
  Clock,
  User,
  Store,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DateRangePreset, formatNumber } from '../../lib/utils';
import { readPersistedListDateRange, writePersistedListDateRange } from '../../lib/listDateRangePersistence';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import DateRangeSelector from '../../components/ui/DateRangeSelector';
import LoadingState from '../../components/ui/LoadingState';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import Button from '../../components/ui/Button';
import Pagination from '../../components/ui/Pagination';

interface Invoice {
  id: number;
  invoice_number: string;
  store: number;
  store_name?: string;
  customer: number | null;
  customer_name: string | null;
  customer_group_name?: string | null;
  status: string;
  invoice_type: string;
  subtotal: string;
  discount_amount: string;
  tax_amount: string;
  total: string;
  display_total?: string | number;
  computed_total?: string | number;
  computed_paid?: string | number;
  paid_amount: string;
  due_amount: string;
  created_at: string;
  created_by: number | null;
  is_edited?: boolean;
  edited_on?: string | null;
  repair?: { id: number; [key: string]: unknown } | null;
  items?: InvoiceItem[];
}

interface InvoiceItem {
  quantity?: string | number | null;
  unit_price?: string | number | null;
  manual_unit_price?: string | number | null;
  line_total?: string | number | null;
  product_purchase_price?: string | number | null;
  product_selling_price?: string | number | null;
}

const INVOICES_LIST_STATE_KEY = 'invoices:list-state:v1';

type InvoicesListState = {
  search: string;
  invoiceTypeFilter: string;
  datePreset: DateRangePreset;
  dateRange: { startDate: string; endDate: string };
  selectedStoreId: number | null;
  currentPage: number;
};

const readPersistedInvoicesListState = (): InvoicesListState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(INVOICES_LIST_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<InvoicesListState>;
    const preset = parsed.datePreset;
    const safePreset: DateRangePreset =
      preset === 'one_day' || preset === 'last_7_days' || preset === 'last_30_days' || preset === 'custom'
        ? preset
        : 'custom';
    return {
      search: typeof parsed.search === 'string' ? parsed.search : '',
      invoiceTypeFilter: typeof parsed.invoiceTypeFilter === 'string' ? parsed.invoiceTypeFilter : '',
      datePreset: safePreset,
      dateRange: {
        startDate: typeof parsed.dateRange?.startDate === 'string' ? parsed.dateRange.startDate : '',
        endDate: typeof parsed.dateRange?.endDate === 'string' ? parsed.dateRange.endDate : '',
      },
      selectedStoreId:
        typeof parsed.selectedStoreId === 'number' && Number.isFinite(parsed.selectedStoreId)
          ? parsed.selectedStoreId
          : null,
      currentPage:
        typeof parsed.currentPage === 'number' && Number.isFinite(parsed.currentPage) && parsed.currentPage > 0
          ? parsed.currentPage
          : 1,
    };
  } catch {
    return null;
  }
};

const parseAmount = (value: unknown) => {
  const parsed = parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
};

const invoiceTypeLabel: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  pending: 'Pending',
  credit: 'Credit',
  defective: 'Defective',
  mixed: 'Mixed',
  repair: 'Repair',
  pos_repair: 'Repair',
};
const invoiceStatusLabel: Record<string, string> = {
  draft: 'Draft',
  paid: 'Paid',
  partial: 'Partially Paid',
  credit: 'Credit',
  void: 'Void',
};
const getInvoiceTypeLabel = (type: string) =>
  invoiceTypeLabel[String(type || '').toLowerCase()] || type || 'Cash';
const getInvoiceStatusLabel = (status: string) =>
  invoiceStatusLabel[String(status || '').toLowerCase()] || status || '—';

/** Type pill color (compact) */
const typePillClass: Record<string, string> = {
  cash: 'bg-blue-100 text-blue-800',
  upi: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-amber-100 text-amber-800',
  credit: 'bg-amber-100 text-amber-800',
  mixed: 'bg-slate-100 text-slate-700',
  repair: 'bg-purple-100 text-purple-800',
  pos_repair: 'bg-purple-100 text-purple-800',
};
const getTypePillClass = (type: string) =>
  typePillClass[String(type || '').toLowerCase()] || 'bg-slate-100 text-slate-700';

/** Status text color only (no pill, keeps cell compact) */
const statusTextClass: Record<string, string> = {
  paid: 'text-emerald-700',
  partial: 'text-amber-700',
  credit: 'text-amber-700',
  draft: 'text-slate-500',
  void: 'text-red-600',
};
const getStatusTextClass = (status: string) =>
  statusTextClass[String(status || '').toLowerCase()] || 'text-gray-600';

export default function Invoices() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const persistedListStateRef = useRef<InvoicesListState | null>(readPersistedInvoicesListState());
  const [search, setSearch] = useState(() => searchParams.get('search') ?? persistedListStateRef.current?.search ?? '');
  const [invoiceTypeFilter, setInvoiceTypeFilter] = useState<string>(
    () => searchParams.get('invoice_type') ?? persistedListStateRef.current?.invoiceTypeFilter ?? ''
  );
  const [datePreset, setDatePreset] = useState<DateRangePreset>(() => {
    const preset = searchParams.get('preset');
    if (preset === 'one_day' || preset === 'last_7_days' || preset === 'last_30_days' || preset === 'custom') {
      return preset;
    }
    const global = readPersistedListDateRange();
    return persistedListStateRef.current?.datePreset ?? global?.preset ?? 'custom';
  });
  const [dateRange, setDateRange] = useState(() => {
    const global = readPersistedListDateRange();
    return {
      startDate:
        searchParams.get('date_from') ??
        persistedListStateRef.current?.dateRange.startDate ??
        global?.startDate ??
        '',
      endDate:
        searchParams.get('date_to') ??
        persistedListStateRef.current?.dateRange.endDate ??
        global?.endDate ??
        '',
    };
  });
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(() => {
    const storeParam = searchParams.get('store');
    if (!storeParam) return persistedListStateRef.current?.selectedStoreId ?? null;
    const parsed = parseInt(storeParam, 10);
    return Number.isNaN(parsed) ? null : parsed;
  });
  const [user, setUser] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(() => {
    const pageParam = parseInt(searchParams.get('page') ?? String(persistedListStateRef.current?.currentPage ?? 1), 10);
    return Number.isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
  });

  // Load user on mount
  useEffect(() => {
    const loadUser = async () => {
      try {
        await auth.loadUser();
        setUser(auth.getUser());
      } catch (e) {
        // User not loaded
      }
    };
    loadUser();
  }, []);

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

  // Only if group name contains "Admin" (Admin, RetailAdmin, WholesaleAdmin) → show all stores. Else → store selector like POS.
  const groupContainsAdmin = (user?.groups || []).some((g: string) => String(g).includes('Admin'));

  const canSeeSuperMetrics = (user?.groups || []).includes('Super');
  const canSeeKPIStats = canSeeSuperMetrics;
  const canSeeTotalColumn = canSeeSuperMetrics;

  // Use selected store or null (ALL) — all users default to "All".
  const defaultStore = selectedStoreId === null ? null : stores.find((s: any) => s.id === selectedStoreId) ?? null;

  const currentStore = selectedStoreId === null ? null : stores.find((s: any) => s.id === selectedStoreId);

  const { startDate: dateFrom, endDate: dateTo } = dateRange;
  // Default view uses date-based pagination; any active filter returns full filtered data.
  const useFilteredMode = !!invoiceTypeFilter || !!dateFrom || !!dateTo || !!search.trim() || !!defaultStore?.id;
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['invoices', invoiceTypeFilter, dateFrom, dateTo, defaultStore?.id ?? 'all', useFilteredMode ? 1 : currentPage, search],
    queryFn: () => posApi.invoices.list({
      invoice_type: invoiceTypeFilter || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      store: defaultStore?.id ?? undefined,
      page: useFilteredMode ? undefined : currentPage,
      search: search.trim() || undefined,
      ordering: useFilteredMode ? 'created_at' : undefined,
    }),
    enabled: true,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    const nextParams = new URLSearchParams();
    const trimmedSearch = search.trim();
    if (trimmedSearch) nextParams.set('search', trimmedSearch);
    if (invoiceTypeFilter) nextParams.set('invoice_type', invoiceTypeFilter);
    if (datePreset && datePreset !== 'custom') nextParams.set('preset', datePreset);
    if (dateFrom) nextParams.set('date_from', dateFrom);
    if (dateTo) nextParams.set('date_to', dateTo);
    if (selectedStoreId !== null) nextParams.set('store', String(selectedStoreId));
    if (!useFilteredMode && currentPage > 1) nextParams.set('page', String(currentPage));

    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    search,
    invoiceTypeFilter,
    datePreset,
    dateFrom,
    dateTo,
    selectedStoreId,
    currentPage,
    useFilteredMode,
    searchParams,
    setSearchParams,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const snapshot: InvoicesListState = {
      search,
      invoiceTypeFilter,
      datePreset,
      dateRange: {
        startDate: dateFrom,
        endDate: dateTo,
      },
      selectedStoreId,
      currentPage,
    };
    window.sessionStorage.setItem(INVOICES_LIST_STATE_KEY, JSON.stringify(snapshot));
    writePersistedListDateRange(datePreset, dateFrom, dateTo);
  }, [search, invoiceTypeFilter, datePreset, dateFrom, dateTo, selectedStoreId, currentPage]);

  const invoices: Invoice[] = data?.data?.results || data?.data?.results || data?.data || [];
  const rawData = data?.data && typeof data.data === 'object' ? data.data : null;
  const pageDate = rawData && 'page_date' in rawData ? (rawData.page_date as string) : null;
  const paginationInfo = rawData && 'count' in rawData ? {
    totalItems: rawData.count as number,
    totalPages: (rawData.total_pages as number) ?? 1,
    currentPage: (rawData.page as number) ?? 1,
    pageSize: (rawData.page_size as number) ?? ((rawData.count as number) || 50),
  } : null;

  // Filter out defective invoices (they should only appear in defective move-outs page)
  // Filter out repair invoices (they appear on the Repairs page only)
  // Credit status invoices (invoice_type === 'credit' or status === 'credit') are shown by default.
  // Search is applied server-side (invoice_number + customer_name)
  const filteredInvoices = invoices.filter((invoice) => {
    const invoiceType = String(invoice.invoice_type || '').toLowerCase();
    const customerGroup = String(invoice.customer_group_name || '').toUpperCase();
    const isRepairByType = invoiceType === 'repair' || invoiceType === 'pos_repair';
    const isRepairByCustomerGroup = customerGroup === 'REPAIR';
    const isRepairInvoice = Boolean(invoice.repair) || isRepairByType || isRepairByCustomerGroup;

    if (invoice.invoice_type === 'defective') return false;
    if (isRepairInvoice) return false;
    return true;
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };


  // KPI summary based on currently loaded/visible invoice results
  const totalRevenue = filteredInvoices
    .filter(inv => inv.status === 'paid')
    .reduce((sum, inv) => sum + parseAmount(inv.total), 0);
  const totalPendingInvoiceAmount = filteredInvoices
    .filter(inv => inv.invoice_type === 'pending')
    .reduce((sum, inv) => sum + parseAmount(inv.display_total ?? inv.total), 0);
  const totalInvoices = filteredInvoices.length;
  const paidInvoices = filteredInvoices.filter(inv => inv.status === 'paid').length;

  // Credit = invoice_type === 'credit' OR status === 'credit' (UI shows Type / Status separately)
  const isCreditInvoice = (inv: Invoice) =>
    String(inv.invoice_type || '').toLowerCase() === 'credit' ||
    String(inv.status || '').toLowerCase() === 'credit';
  // Footer totals should exclude pending type and draft status rows.
  const footerTotalsInvoices = filteredInvoices.filter((inv) => {
    const type = String(inv.invoice_type || '').toLowerCase();
    const status = String(inv.status || '').toLowerCase();
    return type !== 'pending' && status !== 'draft';
  });
  // Profit summary for Super group footer row; bifurcate Paid vs Credit
  const paidSumNonCredit = footerTotalsInvoices
    .filter((inv) => !isCreditInvoice(inv))
    .reduce((s, inv) => s + parseAmount(inv.computed_paid), 0);
  const creditDifference = footerTotalsInvoices
    .filter((inv) => isCreditInvoice(inv))
    .reduce((s, inv) => s + (parseAmount(inv.computed_paid) - parseAmount(inv.computed_total)), 0);
  const pendingAmount = filteredInvoices
    .filter((inv) => String(inv.invoice_type || '').toLowerCase() === 'pending')
    .reduce((s, inv) => s + parseAmount(inv.display_total ?? inv.total), 0);
  const combinedProfit = paidSumNonCredit + creditDifference;

  const buildInvoiceDetailPath = (invoiceId: number) => {
    const params = new URLSearchParams();
    const trimmedSearch = search.trim();
    if (trimmedSearch) params.set('search', trimmedSearch);
    if (invoiceTypeFilter) params.set('invoice_type', invoiceTypeFilter);
    if (datePreset && datePreset !== 'custom') params.set('preset', datePreset);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (selectedStoreId !== null) params.set('store', String(selectedStoreId));
    if (!useFilteredMode && currentPage > 1) params.set('page', String(currentPage));
    const query = params.toString();
    return query ? `/invoices/${invoiceId}?${query}` : `/invoices/${invoiceId}`;
  };

  if (isLoading) {
    return <LoadingState message="Loading invoices..." />;
  }

  if (error) {
    return (
      <ErrorState
        message="Error loading invoices. Please try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!groupContainsAdmin && stores.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Invoices</h2>
          <p className="text-red-600 mb-4">No store available. Please create a store first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <PageHeader
          title="Invoices"
          subtitle={groupContainsAdmin ? 'View and manage all invoices (all stores)' : 'View and manage all invoices'}
          icon={FileText}
        />
        {/* Store selector: Admin gets "All" + stores; non-Admin gets stores only */}
        {stores.length > 0 && (
          <div className="w-full sm:w-auto">
            <div className="relative group">
              <div className="flex items-center gap-2 sm:gap-3 bg-white border-2 border-blue-200 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm hover:shadow-md hover:border-blue-400 transition-all duration-200 cursor-pointer">
                <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                  <div className="flex-shrink-0 p-1.5 bg-blue-50 rounded-lg">
                    <Store className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm sm:text-base font-semibold text-gray-900 truncate block">
                      {selectedStoreId === null ? 'All' : (currentStore?.name || 'Select Store')}
                    </span>
                  </div>
                  <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400 group-hover:text-blue-600 transition-colors flex-shrink-0" />
                </div>
              </div>
              <select
                value={selectedStoreId === null ? '' : selectedStoreId.toString()}
                onChange={(e) => {
                  const val = e.target.value;
                  setCurrentPage(1);
                  setSelectedStoreId(val === '' ? null : parseInt(val, 10));
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 appearance-none"
              >
                <option value="">All</option>
                {stores.map((store: any) => (
                  <option key={store.id} value={store.id.toString()}>
                    {store.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Stats Cards - live summary of currently loaded invoices; hidden from Retail and Repair groups */}
      {canSeeKPIStats && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-500">Live summary</p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Revenue</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  ₹{formatNumber(totalRevenue)}
                </p>
              </div>
              <div className="p-3 bg-green-100 rounded-lg">
                <Coins className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </Card>
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Pending Invoice Amount</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    ₹{formatNumber(totalPendingInvoiceAmount)}
                  </p>
                </div>
                <div className="p-3 bg-amber-100 rounded-lg">
                  <Clock className="h-6 w-6 text-amber-600" />
                </div>
              </div>
            </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Invoices</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{totalInvoices}</p>
              </div>
              <div className="p-3 bg-blue-100 rounded-lg">
                <FileText className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Paid Invoices</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{paidInvoices}</p>
              </div>
              <div className="p-3 bg-green-100 rounded-lg">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </Card>
          </div>
        </div>
      )}

      {/* Filters */}
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search invoices..."
              value={search}
              onChange={(e) => {
                setCurrentPage(1);
                setSearch(e.target.value);
              }}
              className="pl-10"
            />
          </div>
          <Select
            value={invoiceTypeFilter}
            onChange={(e) => {
              setCurrentPage(1);
              setInvoiceTypeFilter(e.target.value);
            }}
            icon={<Filter className="h-4 w-4" />}
          >
            <option value="">All Invoice Types</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="pending">Pending</option>
            <option value="credit">Credit</option>
          </Select>
          <div className="lg:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date range
            </label>
            <DateRangeSelector
              preset={datePreset}
              value={dateRange}
              onChange={({ preset, range }) => {
                setCurrentPage(1);
                setDatePreset(preset);
                setDateRange(range);
              }}
            />
          </div>
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
          <span className="h-2 w-2 rounded-full bg-red-500 shrink-0"></span>
          <span className="text-xs text-gray-600 font-medium whitespace-nowrap">Edited invoice</span>
        </div>
      </div>

      {/* Page date label (date-based pagination: each page = one day; hidden when type filter is on) */}
      {paginationInfo && pageDate && !useFilteredMode && (
        <p className="text-sm text-gray-600 font-medium">
          Invoices for{' '}
          <span className="text-gray-900">
            {new Date(pageDate).toLocaleDateString('en-IN', {
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </span>
        </p>
      )}

      {/* Loader when filters are updated (refetching in background) */}
      {isFetching && !isLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-600 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600 flex-shrink-0" />
          <span>Updating results...</span>
        </div>
      )}

      {/* Invoices Table */}
      {filteredInvoices.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="No invoices found"
            message="No invoices match your search criteria"
          />
        </Card>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block">
            <Table headers={[
              { label: 'Invoice #', align: 'left' },
              { label: 'Date & time', align: 'left' },
              { label: 'Customer', align: 'left' },
              { label: 'Type / Status', align: 'left' },
              ...(canSeeTotalColumn ? [{ label: 'Total', align: 'right' as const }] : []),
              { label: 'Paid', align: 'right' },
              { label: '', align: 'right' },
            ]}>
              {filteredInvoices.map((invoice) => {
                return (
                  <TableRow
                    key={invoice.id}
                    onClick={() => navigate(buildInvoiceDetailPath(invoice.id))}
                    className={`cursor-pointer transition-colors hover:opacity-80 ${invoice.invoice_type === 'cash' ? 'bg-blue-50/50' :
                      invoice.invoice_type === 'upi' ? 'bg-emerald-50/50' :
                        invoice.invoice_type === 'pending' || invoice.invoice_type === 'credit' ? 'bg-amber-50/50' :
                          invoice.invoice_type === 'repair' || invoice.invoice_type === 'pos_repair' ? 'bg-purple-50/50' : ''
                      }`}
                  >
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        {invoice.is_edited && (
                          <span
                            className="h-2 w-2 rounded-full bg-red-500 shrink-0"
                            title="Edited"
                            aria-hidden
                          />
                        )}
                        <span className="font-mono font-semibold text-gray-900">
                          {invoice.invoice_number}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-600">
                        {formatDate(invoice.created_at)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-900">
                          {invoice.customer_name || 'Walk-in Customer'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 shadow-sm">
                        <span
                          className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${getTypePillClass(invoice.invoice_type)}`}
                        >
                          {getInvoiceTypeLabel(invoice.invoice_type)}
                        </span>
                        <span className="text-gray-400 font-medium">·</span>
                        <span className={`shrink-0 text-xs font-medium ${getStatusTextClass(invoice.status)}`}>
                          {getInvoiceStatusLabel(invoice.status)}
                        </span>
                      </div>
                    </TableCell>
                    {canSeeTotalColumn && (
                      <TableCell align="right">
                        <span className="font-semibold text-gray-900">
                          ₹{formatNumber(parseAmount(invoice.computed_total))}
                        </span>
                      </TableCell>
                    )}
                    <TableCell align="right">
                      <span className="text-green-600 font-medium">
                        ₹{formatNumber(parseAmount(invoice.computed_paid))}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(buildInvoiceDetailPath(invoice.id));
                        }}
                        className="gap-1.5"
                      >
                        <Eye className="h-4 w-4 flex-shrink-0" />
                        <span>View</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {canSeeTotalColumn && filteredInvoices.length > 0 && (
                <>
                  <TableRow className="bg-gray-50 border-t border-gray-200 font-medium">
                    <TableCell colSpan={5}>Paid (non-credit)</TableCell>
                    <TableCell align="right" className="text-green-700">
                      ₹{formatNumber(paidSumNonCredit)}
                    </TableCell>
                    <TableCell>{' '}</TableCell>
                  </TableRow>
                  <TableRow className="bg-amber-50/80 border-t border-gray-200 font-medium">
                    <TableCell colSpan={5}>Credit (Paid − Total)</TableCell>
                    <TableCell align="right" className="text-amber-800">
                      ₹{formatNumber(creditDifference)}
                    </TableCell>
                    <TableCell>{' '}</TableCell>
                  </TableRow>
                  <TableRow className="bg-yellow-50/80 border-t border-gray-200 font-medium">
                    <TableCell colSpan={5}>Pending</TableCell>
                    <TableCell align="right" className="text-yellow-800">
                      ₹{formatNumber(pendingAmount)}
                    </TableCell>
                    <TableCell>{' '}</TableCell>
                  </TableRow>
                  <TableRow className="bg-gray-100 border-t-2 border-gray-300 font-semibold">
                    <TableCell colSpan={5}>Profit (Paid + Credit)</TableCell>
                    <TableCell align="right" className="text-emerald-700">
                      ₹{formatNumber(combinedProfit)}
                    </TableCell>
                    <TableCell>{' '}</TableCell>
                  </TableRow>
                </>
              )}
            </Table>
          </div>
          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {filteredInvoices.map((invoice) => {
              return (
                <div
                  key={invoice.id}
                  onClick={() => navigate(buildInvoiceDetailPath(invoice.id))}
                  className={`border rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer ${invoice.invoice_type === 'cash' ? 'bg-blue-50/70 border-blue-100' :
                    invoice.invoice_type === 'upi' ? 'bg-emerald-50/70 border-emerald-100' :
                      invoice.invoice_type === 'pending' || invoice.invoice_type === 'credit' ? 'bg-amber-50/70 border-amber-100' :
                        invoice.invoice_type === 'repair' || invoice.invoice_type === 'pos_repair' ? 'bg-purple-50/70 border-purple-100' :
                          'bg-white border-gray-200'
                    }`}
                >
                  <div className="p-4">
                    <div className="mb-3">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="h-4 w-4 text-blue-600 flex-shrink-0" />
                        {invoice.is_edited && (
                          <span
                            className="h-2 w-2 rounded-full bg-red-500 shrink-0 mt-1.5"
                            title="Edited"
                            aria-hidden
                          />
                        )}
                        <span className="font-mono font-semibold text-gray-900 text-base">
                          {invoice.invoice_number}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600 mb-1">
                        {formatDate(invoice.created_at)}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                        <User className="h-3.5 w-3.5 text-gray-400" />
                        <span className="truncate">
                          {invoice.customer_name || 'Walk-in Customer'}
                        </span>
                      </div>
                      <div className="mt-1.5 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 shadow-sm">
                        <span
                          className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${getTypePillClass(invoice.invoice_type)}`}
                        >
                          {getInvoiceTypeLabel(invoice.invoice_type)}
                        </span>
                        <span className="text-gray-400 font-medium">·</span>
                        <span className={`shrink-0 text-xs font-medium ${getStatusTextClass(invoice.status)}`}>
                          {getInvoiceStatusLabel(invoice.status)}
                        </span>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-gray-100">
                      <div className={`grid ${canSeeTotalColumn ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
                        {canSeeTotalColumn && (
                          <div>
                            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Total</div>
                            <div className="text-base font-bold text-gray-900">₹{formatNumber(parseAmount(invoice.computed_total))}</div>
                          </div>
                        )}
                        <div>
                          <div className="text-xs font-medium text-green-600 uppercase tracking-wide mb-1">Paid</div>
                          <div className="text-sm font-semibold text-green-600">₹{formatNumber(parseAmount(invoice.computed_paid))}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {canSeeTotalColumn && filteredInvoices.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 space-y-2 px-4 py-3 text-sm font-medium">
                <div className="flex justify-between items-center">
                  <span className="text-gray-700">Paid (non-credit)</span>
                  <span className="text-green-700">₹{formatNumber(paidSumNonCredit)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700">Credit (Paid − Total)</span>
                  <span className="text-amber-800">₹{formatNumber(creditDifference)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700">Pending</span>
                  <span className="text-yellow-800">₹{formatNumber(pendingAmount)}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-gray-200 font-semibold">
                  <span className="text-gray-700">Profit (Paid + Credit)</span>
                  <span className="text-emerald-700">₹{formatNumber(combinedProfit)}</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {paginationInfo && !useFilteredMode && (
        <Card>
          <Pagination
            currentPage={paginationInfo.currentPage}
            totalPages={paginationInfo.totalPages}
            totalItems={paginationInfo.totalItems}
            pageSize={paginationInfo.pageSize}
            onPageChange={(page) => setCurrentPage(page)}
          />
        </Card>
      )}
    </div>
  );
}
