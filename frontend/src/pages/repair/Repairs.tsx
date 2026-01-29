import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { posApi, catalogApi } from '../../lib/api';
import ToastContainer from '../../components/ui/Toast';
import type { Toast } from '../../components/ui/Toast';
import RepairStatusModal from './RepairStatusModal';
import BarcodeScanner from '../../components/BarcodeScanner';
import { printLabelsFromResponse } from '../../utils/printBarcodes';
import {
  Wrench,
  Search,
  Filter,
  Eye,
  Phone,
  Package,
  User,
  Clock,
  CheckCircle,
  Truck,
  Edit,
  Camera,
  AlertTriangle,
  FileText,
  X,
  Printer,
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
import Badge from '../../components/ui/Badge';

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
  status?: 'draft' | 'paid' | 'partial' | 'credit' | 'void';
  repair?: {
    id: number;
    contact_no: string;
    model_name: string;
    booking_amount?: string;
    status: 'received' | 'work_in_progress' | 'done' | 'delivered';
    barcode: string;
    created_at: string;
    updated_at: string;
  };
}

const STATUS_OPTIONS = [
  { value: 'received', label: 'Received' },
  { value: 'work_in_progress', label: 'In Progress' },
  { value: 'done', label: 'Completed' },
  { value: 'delivered', label: 'Delivered' },
];

const STATUS_COLORS: Record<string, string> = {
  received: 'bg-blue-100 text-blue-800',
  work_in_progress: 'bg-yellow-100 text-yellow-800',
  done: 'bg-green-100 text-green-800',
  delivered: 'bg-gray-100 text-gray-800',
};

const STATUS_ICONS: Record<string, any> = {
  received: Clock,
  work_in_progress: Wrench,
  done: CheckCircle,
  delivered: Truck,
};

export default function Repairs() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedInvoice, setSelectedInvoice] = useState<RepairInvoice | null>(null);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [barcodeSearch, setBarcodeSearch] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

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

  const { data, isLoading, error } = useQuery({
    queryKey: ['repair-invoices', statusFilter, dateFrom, dateTo, defaultStore?.id, currentPage, barcodeSearch],
    queryFn: async () => {
      const params: any = {
        page: currentPage,
        limit: 50,
      };
      if (statusFilter) {
        params.repair_status = statusFilter;
      }
      if (dateFrom) {
        params.date_from = dateFrom;
      }
      if (dateTo) {
        params.date_to = dateTo;
      }
      if (defaultStore?.id) {
        params.store = defaultStore.id;
      }
      if (search.trim()) {
        params.invoice_number = search.trim();
      }
      if (barcodeSearch.trim()) {
        params.repair_barcode = barcodeSearch.trim();
      }
      const response = await posApi.repair.invoices.list(params);
      return response.data;
    },
    enabled: !!defaultStore,
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

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, dateFrom, dateTo, defaultStore?.id, search, barcodeSearch]);

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

  // Update repair status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async (data: { invoiceId: number; repair_status: string }) => {
      return await posApi.repair.updateStatus(data.invoiceId, { repair_status: data.repair_status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repair-invoices'] });
      showToast('Repair status updated successfully', 'success');
      setShowStatusModal(false);
      setSelectedInvoice(null);
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to update repair status';
      showToast(errorMsg, 'error');
    },
  });

  const handleOpenStatusModal = (invoice: RepairInvoice) => {
    if (invoice.repair) {
      setSelectedInvoice(invoice);
      setShowStatusModal(true);
    }
  };

  const handleUpdateStatus = (newStatus: string) => {
    if (!selectedInvoice?.repair) {
      showToast('Please select a repair invoice', 'error');
      return;
    }
    updateStatusMutation.mutate({
      invoiceId: selectedInvoice.id,
      repair_status: newStatus,
    });
  };

  const handleCloseStatusModal = () => {
    setShowStatusModal(false);
    setSelectedInvoice(null);
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

  const repairInvoices: RepairInvoice[] = data?.results || [];
  const paginationInfo = data ? {
    totalItems: data.count || 0,
    totalPages: data.total_pages || 1,
    currentPage: data.page || 1,
    pageSize: data.page_size || 50,
  } : null;


  // Filter by search
  const filteredRepairs = repairInvoices.filter((invoice) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      invoice.invoice_number.toLowerCase().includes(searchLower) ||
      invoice.customer_name?.toLowerCase().includes(searchLower) ||
      invoice.repair?.contact_no?.toLowerCase().includes(searchLower) ||
      invoice.repair?.model_name?.toLowerCase().includes(searchLower) ||
      invoice.repair?.barcode?.toLowerCase().includes(searchLower)
    );
  });

  const repairGroupInvoices = filteredRepairs.filter(inv => inv.customer_group_name === 'REPAIR');
  const otherGroupInvoices = filteredRepairs.filter(inv => inv.customer_group_name !== 'REPAIR');

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };


  const getStatusBadge = (status: string) => {
    const Icon = STATUS_ICONS[status] || Clock;
    return (
      <Badge className={STATUS_COLORS[status] || 'bg-gray-100 text-gray-800'}>
        <Icon className="h-3 w-3 mr-1" />
        {STATUS_OPTIONS.find(s => s.value === status)?.label || status}
      </Badge>
    );
  };

  const totalRepairs = filteredRepairs.length;
  const receivedRepairs = filteredRepairs.filter(inv => inv.repair?.status === 'received').length;
  const doneRepairs = filteredRepairs.filter(inv => inv.repair?.status === 'done').length;

  if (isLoading) {
    return <LoadingState message="Loading repairs..." />;
  }

  if (error) {
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
              <p className="text-sm font-medium text-gray-600">Completed</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{doneRepairs}</p>
            </div>
            <div className="p-3 bg-green-100 rounded-lg">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <div className="space-y-4">
          {/* Barcode Search Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                Search by Invoice Number
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Enter invoice number"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
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
                    <div>
                      <span className="text-gray-600 block text-xs">Customer</span>
                      <span className="font-medium">{selectedInvoice.customer_name || 'N/A'}</span>
                    </div>
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
                  </div>
                  <div className="pt-3 border-t">
                    <Button
                      variant="primary"
                      onClick={() => handleOpenStatusModal(selectedInvoice)}
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Update Status
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Other Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2 border-t">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              icon={<Filter className="h-4 w-4" />}
            >
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
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
          {[
            { title: 'Repair Group Customers', items: repairGroupInvoices },
            { title: 'Other Group Customers', items: otherGroupInvoices }
          ].map((group, groupIdx) => group.items.length > 0 && (
            <div key={groupIdx} className="space-y-4">
              <div className="flex items-center gap-3 px-2">
                <div className={`h-8 w-1.5 rounded-full ${groupIdx === 0 ? 'bg-blue-600' : 'bg-gray-400'}`}></div>
                <h2 className="text-xl font-bold text-gray-900">{group.title}</h2>
                <Badge variant="outline" className="ml-2 font-mono">
                  {group.items.length}
                </Badge>
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block">
                <Table headers={[
                  { label: 'Invoice #', align: 'left' },
                  { label: 'Date', align: 'left' },
                  { label: 'Customer', align: 'left' },
                  { label: 'Contact', align: 'left' },
                  { label: 'Model', align: 'left' },
                  { label: 'Status', align: 'left' },
                  { label: 'Invoice Type', align: 'left' },
                  { label: '', align: 'right' },
                ]}>
                  {group.items.map((invoice) => {
                    const statusColor = invoice.invoice_type === 'cash' ? 'bg-blue-50/50' :
                      invoice.invoice_type === 'upi' ? 'bg-emerald-50/50' :
                        invoice.invoice_type === 'pending' || invoice.invoice_type === 'credit' ? 'bg-amber-50/50' :
                          invoice.invoice_type === 'repair' || invoice.invoice_type === 'pos_repair' ? 'bg-purple-50/50' : '';

                    return (
                      <TableRow
                        key={invoice.id}
                        className={`cursor-pointer transition-colors ${statusColor} hover:opacity-80`}
                      >
                        <TableCell>
                          <span
                            className="font-mono font-semibold text-gray-900 cursor-pointer hover:text-blue-600"
                            onClick={() => navigate(`/invoices/${invoice.id}`)}
                          >
                            {invoice.invoice_number.split('-').pop()}
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
                          <div className="flex items-center gap-2">
                            <Phone className="h-3.5 w-3.5 text-gray-400" />
                            <span className="text-gray-600 text-sm">
                              {invoice.repair?.contact_no || 'N/A'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Package className="h-3.5 w-3.5 text-gray-400" />
                            <span className="text-gray-600 text-sm">
                              {invoice.repair?.model_name || 'N/A'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {invoice.repair ? getStatusBadge(invoice.repair.status) : 'N/A'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="uppercase text-[10px] font-bold tracking-wider">
                            {invoice.invoice_type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (invoice.repair) {
                                  handleOpenStatusModal(invoice);
                                } else {
                                  showToast('This invoice does not have a repair record', 'error');
                                }
                              }}
                              className="gap-1.5"
                              disabled={!invoice.repair}
                            >
                              <Edit className="h-4 w-4 flex-shrink-0" />
                              <span>Update Status</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePrintRepairLabel(invoice);
                              }}
                              className="gap-1.5"
                              disabled={!invoice.repair || generateLabelMutation.isPending}
                              title="Print Repair Barcode Label"
                            >
                              <Printer className="h-4 w-4 flex-shrink-0" />
                              <span>Print Label</span>
                            </Button>
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
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </Table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden space-y-3">
                {group.items.map((invoice) => {
                  const statusColor = invoice.invoice_type === 'cash' ? 'bg-blue-50/70 border-blue-100' :
                    invoice.invoice_type === 'upi' ? 'bg-emerald-50/70 border-emerald-100' :
                      invoice.invoice_type === 'pending' || invoice.invoice_type === 'credit' ? 'bg-amber-50/70 border-amber-100' :
                        invoice.invoice_type === 'repair' || invoice.invoice_type === 'pos_repair' ? 'bg-purple-50/70 border-purple-100' :
                          'bg-gray-50/70 border-gray-100';

                  return (
                    <div
                      key={invoice.id}
                      onClick={() => navigate(`/invoices/${invoice.id}`)}
                      className={`border rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer ${statusColor}`}
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
                          <div className="text-sm text-gray-600 mb-1">
                            {formatDate(invoice.created_at)}
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-900 font-medium mb-1">
                            <User className="h-3.5 w-3.5 text-gray-400" />
                            <span className="truncate">
                              {invoice.customer_name || 'Walk-in Customer'}
                            </span>
                          </div>
                          {invoice.repair && (
                            <>
                              <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                                <Phone className="h-3.5 w-3.5 text-gray-400" />
                                <span>{invoice.repair.contact_no}</span>
                              </div>
                              <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                                <Package className="h-3.5 w-3.5 text-gray-400" />
                                <span>{invoice.repair.model_name}</span>
                              </div>
                              <div className="mt-2">
                                {getStatusBadge(invoice.repair.status)}
                              </div>
                            </>
                          )}
                        </div>
                        <div className="pt-3 border-t border-black/5 mt-2 space-y-2">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (invoice.repair) {
                                handleOpenStatusModal(invoice);
                              } else {
                                showToast('This invoice does not have a repair record', 'error');
                              }
                            }}
                            className="w-full gap-1.5"
                            disabled={!invoice.repair}
                          >
                            <Edit className="h-4 w-4 flex-shrink-0" />
                            <span>Update Status</span>
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
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Status Update Modal */}
      {selectedInvoice?.repair && (
        <RepairStatusModal
          isOpen={showStatusModal}
          onClose={handleCloseStatusModal}
          onUpdate={handleUpdateStatus}
          invoiceNumber={selectedInvoice.invoice_number}
          currentStatus={selectedInvoice.repair.status}
          invoiceStatus={selectedInvoice.status}
          isLoading={updateStatusMutation.isPending}
        />
      )}

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />

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
