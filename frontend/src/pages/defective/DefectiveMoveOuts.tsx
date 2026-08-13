import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useState, useEffect, useMemo } from 'react';
import { catalogApi, purchasingApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import { formatAppDate } from '../../lib/utils';
import { 
  FileText, 
  Search, 
  Eye,
  Package,
  Coins,
  Store,
  AlertTriangle,
  ArrowLeft,
  Edit,
  Trash2,
  StickyNote,
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
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import { Filter } from 'lucide-react';

const REF_STALE_MS = 5 * 60_000;
const MOVE_OUTS_STALE_MS = 30_000;

interface DefectiveMoveOut {
  id: number;
  move_out_number: string;
  store: number;
  store_name?: string;
  invoice: number | null;
  invoice_number?: string;
  customer_name?: string;
  reason: string;
  reason_display?: string;
  notes: string;
  sent_date?: string | null;
  total_loss: string | number;
  total_adjustment?: string | number;
  total_items: number;
  created_by: number | null;
  created_by_username?: string;
  created_at: string;
  updated_at: string;
  items?: any[];
}

export default function DefectiveMoveOuts() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [user, setUser] = useState<any>(() => auth.getUser());
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [selectedMoveOut, setSelectedMoveOut] = useState<DefectiveMoveOut | null>(null);
  const [adjustmentValue, setAdjustmentValue] = useState('');
  const [moveOutToDelete, setMoveOutToDelete] = useState<DefectiveMoveOut | null>(null);
  const [detailsMoveOut, setDetailsMoveOut] = useState<DefectiveMoveOut | null>(null);
  const [detailsNotes, setDetailsNotes] = useState('');
  const [detailsSentDate, setDetailsSentDate] = useState('');
  const queryClient = useQueryClient();

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

  const isAdmin = Boolean(
    user?.is_admin || user?.is_superuser || user?.is_staff ||
    (user?.groups && user.groups.includes('Admin'))
  );

  // Fetch stores
  const { data: storesResponse } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => {
      const response = await catalogApi.stores.list();
      return response.data;
    },
    retry: false,
    enabled: isAdmin,
    staleTime: REF_STALE_MS,
    gcTime: REF_STALE_MS,
  });

  const stores = (() => {
    if (!storesResponse) return [];
    if (Array.isArray(storesResponse.results)) return storesResponse.results;
    if (Array.isArray(storesResponse.data)) return storesResponse.data;
    if (Array.isArray(storesResponse)) return storesResponse;
    return [];
  })();

  // Fetch categories for filter
  const { data: categoriesData } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const response = await catalogApi.categories.list();
      return response.data;
    },
    retry: false,
    staleTime: REF_STALE_MS,
    gcTime: REF_STALE_MS,
  });

  // Fetch brands for filter
  const { data: brandsData } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await catalogApi.brands.list();
      return response.data;
    },
    retry: false,
    staleTime: REF_STALE_MS,
    gcTime: REF_STALE_MS,
  });

  // Fetch suppliers for filter
  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const response = await purchasingApi.suppliers.list();
      return response.data;
    },
    retry: false,
    staleTime: REF_STALE_MS,
    gcTime: REF_STALE_MS,
  });

  // Update selectedStoreId when stores load and Admin hasn't selected one yet
  useEffect(() => {
    if (isAdmin && !selectedStoreId && stores.length > 0) {
      const firstActiveStore = stores.find((s: any) => s.is_active) || stores[0];
      if (firstActiveStore) {
        setSelectedStoreId(firstActiveStore.id);
      }
    }
  }, [isAdmin, selectedStoreId, stores]);

  const moveOutsQueryEnabled = Boolean(user) && (!isAdmin || selectedStoreId != null);

  // Fetch move-outs
  const { data, isLoading, isPending, error } = useQuery({
    queryKey: ['defective-move-outs', dateFrom, dateTo, selectedStoreId, brandFilter, categoryFilter, supplierFilter],
    queryFn: () => catalogApi.defectiveProducts.moveOuts.list({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      store: selectedStoreId || undefined,
      brand: brandFilter || undefined,
      category: categoryFilter || undefined,
      supplier: supplierFilter || undefined,
    }),
    retry: false,
    enabled: moveOutsQueryEnabled,
    staleTime: MOVE_OUTS_STALE_MS,
    gcTime: REF_STALE_MS,
    placeholderData: keepPreviousData,
  });

  const moveOuts: DefectiveMoveOut[] = (() => {
    if (!data) return [];
    const response = data.data || data;
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.results)) return response.results;
    if (Array.isArray(response?.data)) return response.data;
    return [];
  })();

  // Filter move-outs by search
  const filteredMoveOuts = useMemo(() => {
    return moveOuts.filter((moveOut) => {
      if (!search) return true;
      const searchLower = search.toLowerCase();
      return (
        String(moveOut.id).includes(searchLower) ||
        moveOut.move_out_number.toLowerCase().includes(searchLower) ||
        moveOut.invoice_number?.toLowerCase().includes(searchLower) ||
        moveOut.store_name?.toLowerCase().includes(searchLower) ||
        moveOut.reason_display?.toLowerCase().includes(searchLower) ||
        (moveOut.notes || '').toLowerCase().includes(searchLower) ||
        (moveOut.customer_name || '').toLowerCase().includes(searchLower)
      );
    });
  }, [moveOuts, search]);

  // Calculate summary metrics
  const summaryMetrics = useMemo(() => {
    const totalMoveOuts = filteredMoveOuts.length;
    const totalLoss = filteredMoveOuts.reduce((sum, moveOut) => {
      const loss = typeof moveOut.total_loss === 'number' 
        ? moveOut.total_loss 
        : parseFloat(moveOut.total_loss) || 0;
      const adjustment = typeof moveOut.total_adjustment === 'number'
        ? moveOut.total_adjustment
        : parseFloat(moveOut.total_adjustment || '0') || 0;
      return sum + (loss - adjustment);
    }, 0);
    const totalItems = filteredMoveOuts.reduce((sum, moveOut) => sum + (moveOut.total_items || 0), 0);

    return {
      totalMoveOuts,
      totalLoss,
      totalItems,
    };
  }, [filteredMoveOuts]);

  const formatDate = (dateString: string) =>
    formatAppDate(dateString, { empty: '' });

  const formatCurrency = (amount: string | number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(parseFloat(String(amount || '0')));
  };

  const updateAdjustmentMutation = useMutation({
    mutationFn: ({ id, total_adjustment }: { id: number; total_adjustment: number }) => {
      return catalogApi.defectiveProducts.moveOuts.updateAdjustment(id, { total_adjustment });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['defective-move-outs'] });
      setShowAdjustmentModal(false);
      setSelectedMoveOut(null);
      setAdjustmentValue('');
      alert('Adjustment updated successfully');
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || 'Failed to update adjustment');
    },
  });

  const handleUpdateAdjustment = (moveOut: DefectiveMoveOut) => {
    setSelectedMoveOut(moveOut);
    setAdjustmentValue(String(moveOut.total_adjustment || '0'));
    setShowAdjustmentModal(true);
  };

  const handleOpenDetails = (moveOut: DefectiveMoveOut) => {
    setDetailsMoveOut(moveOut);
    setDetailsNotes(moveOut.notes || '');
    setDetailsSentDate(moveOut.sent_date ? String(moveOut.sent_date).slice(0, 10) : '');
  };

  const updateDetailsMutation = useMutation({
    mutationFn: ({ id, notes, sent_date }: { id: number; notes: string; sent_date: string | null }) => {
      return catalogApi.defectiveProducts.moveOuts.updateAdjustment(id, { notes, sent_date });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['defective-move-outs'] });
      setDetailsMoveOut(null);
      setDetailsNotes('');
      setDetailsSentDate('');
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || 'Failed to update move-out details');
    },
  });

  const deleteMoveOutMutation = useMutation({
    mutationFn: (id: number) => catalogApi.defectiveProducts.moveOuts.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['defective-move-outs'] });
      queryClient.invalidateQueries({ queryKey: ['defective-move-outs-for-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['existing-move-outs'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setMoveOutToDelete(null);
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || 'Failed to delete move-out');
    },
  });

  const handleDeleteMoveOut = (moveOut: DefectiveMoveOut) => {
    setMoveOutToDelete(moveOut);
  };

  const handleAdjustmentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMoveOut) return;
    
    const adjustment = parseFloat(adjustmentValue) || 0;
    updateAdjustmentMutation.mutate({
      id: selectedMoveOut.id,
      total_adjustment: adjustment,
    });
  };

  const getReasonBadge = (reason: string) => {
    const reasonMap: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' }> = {
      'defective': { label: 'Defective', variant: 'danger' },
      'damaged': { label: 'Damaged', variant: 'warning' },
      'expired': { label: 'Expired', variant: 'warning' },
      'return_to_supplier': { label: 'Return to Supplier', variant: 'info' },
      'disposal': { label: 'Disposal', variant: 'danger' },
      'other': { label: 'Other', variant: 'info' },
    };
    const reasonInfo = reasonMap[reason] || { label: reason, variant: 'info' as const };
    return <Badge variant={reasonInfo.variant}>{reasonInfo.label}</Badge>;
  };

  if (isLoading || isPending) {
    return <LoadingState message="Loading move-outs..." />;
  }

  if (error) {
    return (
      <ErrorState
        message="Error loading move-outs. Please try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <PageHeader
          title="Defective Product Move-Outs"
          subtitle="View and manage all defective product move-out transactions"
          icon={AlertTriangle}
        />
        <div className="flex items-center gap-3">
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
                        {stores.find((s: any) => s.id === selectedStoreId)?.name || 'Select Store'}
                      </span>
                    </div>
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
          {/* Go Back Button */}
          <Button
            variant="outline"
            onClick={() => navigate(-1)}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Go Back</span>
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Move-Outs</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {summaryMetrics.totalMoveOuts}
              </p>
            </div>
            <div className="p-3 bg-red-100 rounded-lg">
              <Package className="h-6 w-6 text-red-600" />
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Loss</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {formatCurrency(summaryMetrics.totalLoss)}
              </p>
            </div>
            <div className="p-3 bg-yellow-100 rounded-lg">
              <Coins className="h-6 w-6 text-yellow-600" />
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Items</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {summaryMetrics.totalItems}
              </p>
            </div>
            <div className="p-3 bg-gray-100 rounded-lg">
              <FileText className="h-6 w-6 text-gray-600" />
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search move-outs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
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
          <Select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            icon={<Filter className="h-4 w-4" />}
          >
            <option value="">All Categories</option>
            {(() => {
              const categories = categoriesData?.results || categoriesData?.data || categoriesData || [];
              return Array.isArray(categories) ? categories.map((cat: any) => (
                <option key={cat.id} value={cat.id.toString()}>{cat.name}</option>
              )) : null;
            })()}
          </Select>
          <Select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            icon={<Filter className="h-4 w-4" />}
          >
            <option value="">All Brands</option>
            {(() => {
              const brands = brandsData?.results || brandsData?.data || brandsData || [];
              return Array.isArray(brands) ? brands.map((brand: any) => (
                <option key={brand.id} value={brand.id.toString()}>{brand.name}</option>
              )) : null;
            })()}
          </Select>
          <Select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            icon={<Filter className="h-4 w-4" />}
          >
            <option value="">All Suppliers</option>
            {(() => {
              const suppliers = suppliersData?.results || suppliersData?.data || suppliersData || [];
              return Array.isArray(suppliers) ? suppliers.map((supplier: any) => (
                <option key={supplier.id} value={supplier.id.toString()}>{supplier.name}</option>
              )) : null;
            })()}
          </Select>
        </div>
      </Card>

      {/* Move-Outs Table */}
      {filteredMoveOuts.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="No move-outs found"
            message="No move-out transactions match your search criteria"
          />
        </Card>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block">
            <Table headers={[
              { label: 'ID', align: 'left' },
              { label: 'Sent Date', align: 'left' },
              { label: 'Customer', align: 'left' },
              { label: 'Store', align: 'left' },
              { label: 'Invoice', align: 'left' },
              { label: 'Reason', align: 'left' },
              { label: 'Notes', align: 'left' },
              { label: 'Items', align: 'right' },
              { label: 'Total Loss', align: 'right' },
              { label: 'Adjustment', align: 'right' },
              { label: '', align: 'right' },
            ]}>
              {filteredMoveOuts.map((moveOut) => {
                return (
                  <TableRow
                    key={moveOut.id}
                    onClick={() => moveOut.invoice && navigate(`/invoices/${moveOut.invoice}`)}
                    className={moveOut.invoice ? "cursor-pointer" : ""}
                  >
                    <TableCell>
                      <span className="font-mono font-semibold text-gray-900">
                        {moveOut.id}
                      </span>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDetails(moveOut);
                        }}
                        className="text-left text-gray-600 hover:text-blue-700"
                        title="Set sent date"
                      >
                        {moveOut.sent_date ? formatDate(moveOut.sent_date) : (
                          <span className="text-gray-400 italic">Not set</span>
                        )}
                      </button>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-900 font-medium">
                        {moveOut.customer_name || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Store className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-900">
                          {moveOut.store_name || 'N/A'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {moveOut.invoice_number ? (
                        <span className="font-mono text-blue-600 hover:text-blue-800">
                          {moveOut.invoice_number}
                        </span>
                      ) : (
                        <span className="text-gray-400">No invoice</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {getReasonBadge(moveOut.reason)}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDetails(moveOut);
                        }}
                        className="max-w-[180px] text-left text-sm text-gray-700 hover:text-blue-700 truncate block"
                        title={moveOut.notes || 'Add note'}
                      >
                        {moveOut.notes?.trim() ? moveOut.notes : (
                          <span className="text-gray-400 italic">Add note</span>
                        )}
                      </button>
                    </TableCell>
                    <TableCell align="right">
                      <span className="font-medium text-gray-900">
                        {moveOut.total_items}
                      </span>
                    </TableCell>
                    <TableCell align="right">
                      <span className="font-semibold text-red-600">
                        {formatCurrency(moveOut.total_loss)}
                      </span>
                    </TableCell>
                    <TableCell align="right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateAdjustment(moveOut);
                        }}
                        className="font-medium text-gray-900 hover:text-blue-700"
                        title="Edit adjustment"
                      >
                        {formatCurrency(moveOut.total_adjustment || 0)}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenDetails(moveOut);
                          }}
                          className="gap-1.5"
                        >
                          <StickyNote className="h-4 w-4 flex-shrink-0" />
                          <span>Note</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUpdateAdjustment(moveOut);
                          }}
                          className="gap-1.5"
                        >
                          <Edit className="h-4 w-4 flex-shrink-0" />
                          <span>Adjust</span>
                        </Button>
                        {moveOut.invoice && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/invoices/${moveOut.invoice}`);
                            }}
                            className="gap-1.5"
                          >
                            <Eye className="h-4 w-4 flex-shrink-0" />
                            <span>View Invoice</span>
                          </Button>
                        )}
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteMoveOut(moveOut);
                          }}
                          className="gap-1.5"
                          disabled={deleteMoveOutMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 flex-shrink-0" />
                          <span>Delete</span>
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
            {filteredMoveOuts.map((moveOut) => {
              return (
                <div
                  key={moveOut.id}
                  onClick={() => moveOut.invoice && navigate(`/invoices/${moveOut.invoice}`)}
                  className={`bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow ${moveOut.invoice ? 'cursor-pointer' : ''}`}
                >
                  <div className="p-4">
                    <div className="mb-3">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="h-4 w-4 text-red-600 flex-shrink-0" />
                        <span className="font-mono font-semibold text-gray-900 text-base">
                          #{moveOut.id}
                        </span>
                      </div>
                      {moveOut.customer_name && (
                        <div className="text-sm font-medium text-gray-900 mb-1">
                          {moveOut.customer_name}
                        </div>
                      )}
                      <div className="text-sm text-gray-600 mb-1">
                        Sent: {moveOut.sent_date ? formatDate(moveOut.sent_date) : 'Not set'}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                        <Store className="h-3.5 w-3.5 text-gray-400" />
                        <span className="truncate">
                          {moveOut.store_name || 'N/A'}
                        </span>
                      </div>
                      <div className="mt-1">
                        {getReasonBadge(moveOut.reason)}
                      </div>
                    </div>
                    <div className="pt-3 border-t border-gray-100">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Items</div>
                          <div className="text-base font-bold text-gray-900">{moveOut.total_items}</div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-red-600 uppercase tracking-wide mb-1">Total Loss</div>
                          <div className="text-base font-bold text-red-600">{formatCurrency(moveOut.total_loss)}</div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUpdateAdjustment(moveOut);
                            }}
                            className="text-xs text-blue-600 mt-0.5"
                          >
                            Adj: {formatCurrency(moveOut.total_adjustment || 0)}
                          </button>
                        </div>
                      </div>
                      {moveOut.notes?.trim() && (
                        <div className="mt-3 pt-3 border-t border-gray-100">
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Notes</div>
                          <div className="text-sm text-gray-700 whitespace-pre-wrap">{moveOut.notes}</div>
                        </div>
                      )}
                      {moveOut.invoice_number && (
                        <div className="mt-3 pt-3 border-t border-gray-100">
                          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Invoice</div>
                          <div className="font-mono text-blue-600">{moveOut.invoice_number}</div>
                        </div>
                      )}
                      <div className="mt-3 pt-3 border-t border-gray-100 flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenDetails(moveOut);
                          }}
                          className="flex-1 gap-1.5"
                        >
                          <StickyNote className="h-4 w-4 flex-shrink-0" />
                          <span>Note / Date</span>
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteMoveOut(moveOut);
                          }}
                          className="flex-1 gap-1.5"
                          disabled={deleteMoveOutMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 flex-shrink-0" />
                          <span>Delete</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Adjustment Modal */}
      {showAdjustmentModal && selectedMoveOut && (
        <Modal
          isOpen={showAdjustmentModal}
          onClose={() => {
            setShowAdjustmentModal(false);
            setSelectedMoveOut(null);
            setAdjustmentValue('');
          }}
          title="Update Total Adjustment"
          size="md"
        >
          <form onSubmit={handleAdjustmentSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Move-Out Number
              </label>
              <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-mono">
                #{selectedMoveOut.id}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Total Loss
              </label>
              <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm">
                {formatCurrency(selectedMoveOut.total_loss)}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Total Adjustment <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={adjustmentValue}
                onChange={(e) => setAdjustmentValue(e.target.value)}
                placeholder="Enter adjustment amount"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Net Loss will be: {formatCurrency((typeof selectedMoveOut.total_loss === 'number' ? selectedMoveOut.total_loss : parseFloat(selectedMoveOut.total_loss) || 0) - (parseFloat(adjustmentValue) || 0))}
              </p>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowAdjustmentModal(false);
                  setSelectedMoveOut(null);
                  setAdjustmentValue('');
                }}
                disabled={updateAdjustmentMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateAdjustmentMutation.isPending}
              >
                {updateAdjustmentMutation.isPending ? 'Updating...' : 'Update Adjustment'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {moveOutToDelete && (
        <Modal
          isOpen={!!moveOutToDelete}
          onClose={() => setMoveOutToDelete(null)}
          title="Delete Move-Out"
          size="md"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              This will delete move-out{' '}
              <span className="font-mono font-semibold">
                #{moveOutToDelete.id}
              </span>
              {moveOutToDelete.invoice_number ? (
                <>
                  {' '}and its invoice{' '}
                  <span className="font-mono font-semibold">{moveOutToDelete.invoice_number}</span>
                </>
              ) : null}
              . Products in this move-out will be available to move out again.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMoveOutToDelete(null)}
                disabled={deleteMoveOutMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => deleteMoveOutMutation.mutate(moveOutToDelete.id)}
                disabled={deleteMoveOutMutation.isPending}
              >
                {deleteMoveOutMutation.isPending ? 'Deleting...' : 'Delete Move-Out'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {detailsMoveOut && (
        <Modal
          isOpen={!!detailsMoveOut}
          onClose={() => setDetailsMoveOut(null)}
          title="Move-Out Notes & Sent Date"
          size="md"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateDetailsMutation.mutate({
                id: detailsMoveOut.id,
                notes: detailsNotes,
                sent_date: detailsSentDate || null,
              });
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ID
              </label>
              <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-mono">
                #{detailsMoveOut.id}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sent Date
              </label>
              <Input
                type="date"
                value={detailsSentDate}
                onChange={(e) => setDetailsSentDate(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">
                Date this was returned to the supplier. This can be different from the day the move-out was created.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                rows={4}
                value={detailsNotes}
                onChange={(e) => setDetailsNotes(e.target.value)}
                placeholder="Keep a note of the items in this move-out..."
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDetailsMoveOut(null)}
                disabled={updateDetailsMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateDetailsMutation.isPending}>
                {updateDetailsMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

