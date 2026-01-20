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

  // Check if user is Admin (only Admin group gets store selector)
  const isAdmin = user?.is_admin || user?.is_superuser || user?.is_staff ||
    (user?.groups && user.groups.includes('Admin'));

  // Check if user can see KPI stats (hide from Retail and Repair groups)
  const canSeeKPIStats = (() => {
    const userGroups = user?.groups || [];
    // Hide from Retail and Repair groups only
    if (userGroups.includes('Retail') || userGroups.includes('Repair')) {
      return false;
    }
    // Show to everyone else (Admin, RetailAdmin, WholesaleAdmin, Wholesale, etc.)
    return true;
  })();

  // Determine the active store:
  // - For Admin: Use selectedStoreId if set, otherwise first active store
  // - For others: Auto-select first active store (filtered by backend)
  const defaultStore = (() => {
    if (isAdmin && selectedStoreId) {
      return stores.find((s: any) => s.id === selectedStoreId) || stores.find((s: any) => s.is_active) || stores[0];
    }
    return stores.find((s: any) => s.is_active) || stores[0];
  })();

  // Update selectedStoreId when stores load and Admin hasn't selected one yet
  useEffect(() => {
    if (isAdmin && !selectedStoreId && stores.length > 0) {
      const firstActiveStore = stores.find((s: any) => s.is_active) || stores[0];
      if (firstActiveStore) {
        setSelectedStoreId(firstActiveStore.id);
      }
    }
  }, [isAdmin, selectedStoreId, stores]);

  // Get current selected store for display
  const currentStore = stores.find((s: any) => s.id === selectedStoreId);

  const { data, isLoading, error } = useQuery({
    queryKey: ['invoices', invoiceTypeFilter, dateFrom, dateTo, defaultStore?.id, currentPage],
    queryFn: () => posApi.invoices.list({
      invoice_type: invoiceTypeFilter || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      store: defaultStore?.id || undefined,
      page: currentPage,
      limit: 50,
    }),
    enabled: !!defaultStore,
    placeholderData: keepPreviousData,
  });

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [invoiceTypeFilter, dateFrom, dateTo, defaultStore?.id]);

  const invoices: Invoice[] = data?.data?.results || data?.data?.results || data?.data || [];
  const paginationInfo = data?.data && typeof data.data === 'object' && 'count' in data.data ? {
    totalItems: data.data.count as number,
    totalPages: data.data.total_pages as number,
    currentPage: data.data.page as number,
    pageSize: data.data.page_size as number,
  } : null;

  // Filter out defective invoices (they should only appear in defective move-outs page)
  const filteredInvoices = invoices
    .filter((invoice) => invoice.invoice_type !== 'defective')
    .filter((invoice) => {
      if (!search) return true;
      const searchLower = search.toLowerCase();
      return (
        invoice.invoice_number.toLowerCase().includes(searchLower) ||
        invoice.customer_name?.toLowerCase().includes(searchLower) ||
        invoice.total.toLowerCase().includes(searchLower)
      );
    });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatCurrency = (amount: string) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(parseFloat(amount || '0'));
  };

  const totalRevenue = filteredInvoices
    .filter(inv => inv.status === 'paid')
    .reduce((sum, inv) => sum + parseFloat(inv.total || '0'), 0);

  const totalInvoices = filteredInvoices.length;
  const paidInvoices = filteredInvoices.filter(inv => inv.status === 'paid').length;

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

  if (!defaultStore && stores.length === 0) {
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
          subtitle="View and manage all invoices"
          icon={FileText}
        />
        {/* Store Selector for Admin users */}
        {isAdmin && stores.length > 0 && (
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

      {/* Stats Cards - Hidden from Retail and Repair groups */}
      {canSeeKPIStats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Revenue</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {formatCurrency(totalRevenue.toString())}
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
              { label: 'Date', align: 'left' },
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
                    className="cursor-pointer"
                  >
                    <TableCell>
                      <span className="font-mono font-semibold text-gray-900">
                        {invoice.invoice_number}
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
                        {formatCurrency(invoice.total)}
                      </span>
                    </TableCell>
                    <TableCell align="right">
                      <span className="text-green-600 font-medium">
                        {formatCurrency(invoice.paid_amount)}
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
                  className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                >
                  <div className="p-4">
                    <div className="mb-3">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="h-4 w-4 text-blue-600 flex-shrink-0" />
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
                          <div className="text-base font-bold text-gray-900">{formatCurrency(invoice.total)}</div>
                        </div>
                        {parseFloat(invoice.paid_amount || '0') > 0 && (
                          <div>
                            <div className="text-xs font-medium text-green-600 uppercase tracking-wide mb-1">Paid</div>
                            <div className="text-sm font-semibold text-green-600">{formatCurrency(invoice.paid_amount)}</div>
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
