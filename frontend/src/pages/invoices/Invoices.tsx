import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { posApi, catalogApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import {
  FileText,
  Search,
  Filter,
  Eye,
  CheckCircle,
  Coins,
  User,
  Store,
  ChevronDown,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatNumber } from '../../lib/utils';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
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
  status: string;
  invoice_type: string;
  subtotal: string;
  discount_amount: string;
  tax_amount: string;
  total: string;
  paid_amount: string;
  due_amount: string;
  created_at: string;
  created_by: number | null;
  is_edited?: boolean;
  edited_on?: string | null;
}

export default function Invoices() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [invoiceTypeFilter, setInvoiceTypeFilter] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [user, setUser] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);

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

  // Check if user can see KPI stats (hide from Retail and Repair groups)
  const canSeeKPIStats = (() => {
    const userGroups = user?.groups || [];
    if (userGroups.includes('Retail') || userGroups.includes('Repair')) {
      return false;
    }
    return true;
  })();

  // When group contains Admin: no store filter (all). Else: use selected store or first active store.
  const defaultStore = groupContainsAdmin
    ? null
    : (stores.find((s: any) => s.id === selectedStoreId) || stores.find((s: any) => s.is_active) || stores[0]) ?? null;

  // For non-Admin groups: set selectedStoreId to first store when stores load
  useEffect(() => {
    if (!groupContainsAdmin && !selectedStoreId && stores.length > 0) {
      const first = stores.find((s: any) => s.is_active) || stores[0];
      if (first) setSelectedStoreId(first.id);
    }
  }, [groupContainsAdmin, selectedStoreId, stores]);

  const currentStore = stores.find((s: any) => s.id === selectedStoreId);

  // Today's date in YYYY-MM-DD for KPI summary
  const todayStr = (() => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  })();

  // Fetch today's invoices for KPI stats only (independent of table filters)
  const { data: todayData } = useQuery({
    queryKey: ['invoices', 'today', todayStr, defaultStore?.id ?? 'all'],
    queryFn: () => posApi.invoices.list({
      date_from: todayStr,
      date_to: todayStr,
      store: defaultStore?.id ?? undefined,
      page: 1,
      page_size: 500,
    }),
    enabled: canSeeKPIStats && (groupContainsAdmin ? true : !!defaultStore),
  });

  const todayInvoices: Invoice[] = (() => {
    const raw = todayData?.data;
    if (!raw || typeof raw !== 'object') return [];
    if (Array.isArray((raw as any).results)) return (raw as any).results;
    if (Array.isArray((raw as any).data)) return (raw as any).data;
    if (Array.isArray(raw)) return raw;
    return [];
  })().filter((inv: Invoice) => inv.invoice_type !== 'defective');

  const { data, isLoading, error } = useQuery({
    queryKey: ['invoices', invoiceTypeFilter, dateFrom, dateTo, defaultStore?.id ?? 'all', currentPage, search],
    queryFn: () => posApi.invoices.list({
      invoice_type: invoiceTypeFilter || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      store: defaultStore?.id ?? undefined,
      page: currentPage,
      search: search.trim() || undefined,
    }),
    enabled: groupContainsAdmin ? true : !!defaultStore,
    placeholderData: keepPreviousData,
  });

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [invoiceTypeFilter, dateFrom, dateTo, defaultStore?.id ?? 'all', search]);

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
  // Search is applied server-side (invoice_number + customer_name)
  const filteredInvoices = invoices.filter(
    (invoice) => invoice.invoice_type !== 'defective'
  );

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


  // KPI: today's summary only
  const totalRevenue = todayInvoices
    .filter(inv => inv.status === 'paid')
    .reduce((sum, inv) => sum + parseFloat(inv.total || '0'), 0);
  const totalInvoices = todayInvoices.length;
  const paidInvoices = todayInvoices.filter(inv => inv.status === 'paid').length;

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
        {/* Store selector for non-Admin groups (Retail, Repair, Wholesale, etc.) - like POS */}
        {!groupContainsAdmin && stores.length > 0 && (
          <div className="w-full sm:w-auto">
            <div className="relative group">
              <div className="flex items-center gap-2 sm:gap-3 bg-white border-2 border-blue-200 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm hover:shadow-md hover:border-blue-400 transition-all duration-200 cursor-pointer">
                <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                  <div className="flex-shrink-0 p-1.5 bg-blue-50 rounded-lg">
                    <Store className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm sm:text-base font-semibold text-gray-900 truncate block">
                      {currentStore?.name || 'Select Store'}
                    </span>
                  </div>
                  <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400 group-hover:text-blue-600 transition-colors flex-shrink-0" />
                </div>
              </div>
              <select
                value={selectedStoreId?.toString() || ''}
                onChange={(e) => {
                  const storeId = parseInt(e.target.value);
                  setSelectedStoreId(storeId);
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 appearance-none"
              >
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

      {/* Stats Cards - Today's summary only; hidden from Retail and Repair groups */}
      {canSeeKPIStats && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-500">Today&apos;s summary</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search invoices..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select
            value={invoiceTypeFilter}
            onChange={(e) => setInvoiceTypeFilter(e.target.value)}
            icon={<Filter className="h-4 w-4" />}
          >
            <option value="">All Invoice Types</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="pending">Pending</option>
          </Select>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder="From Date"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            placeholder="To Date"
          />
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

      {/* Page date label (date-based pagination: each page = one day) */}
      {paginationInfo && pageDate && (
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
              { label: 'Invoice Type', align: 'left' },
              { label: 'Total', align: 'right' },
              { label: 'Paid', align: 'right' },
              { label: '', align: 'right' },
            ]}>
              {filteredInvoices.map((invoice) => {
                return (
                  <TableRow
                    key={invoice.id}
                    onClick={() => navigate(`/invoices/${invoice.id}`)}
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
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {invoice.invoice_type === 'cash' ? 'Cash' :
                          invoice.invoice_type === 'upi' ? 'UPI' :
                            invoice.invoice_type === 'pending' ? 'Pending' :
                              invoice.invoice_type || 'Cash'}
                      </span>
                    </TableCell>
                    <TableCell align="right">
                      <span className="font-semibold text-gray-900">
                        ₹{formatNumber(invoice.total)}
                      </span>
                    </TableCell>
                    <TableCell align="right">
                      <span className="text-green-600 font-medium">
                        ₹{formatNumber(invoice.paid_amount)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/invoices/${invoice.id}`);
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
            </Table>
          </div>
          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {filteredInvoices.map((invoice) => {
              return (
                <div
                  key={invoice.id}
                  onClick={() => navigate(`/invoices/${invoice.id}`)}
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
                      <div className="mt-1">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {invoice.invoice_type === 'cash' ? 'Cash' :
                            invoice.invoice_type === 'upi' ? 'UPI' :
                              invoice.invoice_type === 'pending' ? 'Pending' :
                                invoice.invoice_type || 'Cash'}
                        </span>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-gray-100">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Total</div>
                          <div className="text-base font-bold text-gray-900">₹{formatNumber(invoice.total)}</div>
                        </div>
                        {parseFloat(invoice.paid_amount || '0') > 0 && (
                          <div>
                            <div className="text-xs font-medium text-green-600 uppercase tracking-wide mb-1">Paid</div>
                            <div className="text-sm font-semibold text-green-600">₹{formatNumber(invoice.paid_amount)}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {paginationInfo && (
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
