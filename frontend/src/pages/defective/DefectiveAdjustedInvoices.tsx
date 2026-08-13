import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { catalogApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import { formatAppDate } from '../../lib/utils';
import { ArrowLeft, Coins, Edit, Eye, FileText, Search, Store } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import Input from '../../components/ui/Input';
import LoadingState from '../../components/ui/LoadingState';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import Button from '../../components/ui/Button';
import { parseMoveOutAmount, readPersistedMoveOutFilters } from './moveOutFilters';

const REF_STALE_MS = 5 * 60_000;
const MOVE_OUTS_STALE_MS = 30_000;

interface AdjustedMoveOut {
  id: number;
  store_name?: string;
  invoice: number | null;
  invoice_number?: string;
  customer_name?: string;
  sent_date?: string | null;
  total_loss: string | number;
  total_adjustment?: string | number;
  total_items: number;
}

export default function DefectiveAdjustedInvoices() {
  const navigate = useNavigate();
  const persistedFilters = useRef(readPersistedMoveOutFilters()).current;
  const [search, setSearch] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(persistedFilters?.storeId ?? null);
  const [user, setUser] = useState<any>(() => auth.getUser());

  useEffect(() => {
    const loadUser = async () => {
      try {
        await auth.loadUser();
        setUser(auth.getUser());
      } catch {
        // User not loaded
      }
    };
    loadUser();
  }, []);

  const isAdmin = Boolean(
    user?.is_admin || user?.is_superuser || user?.is_staff ||
    (user?.groups && user.groups.includes('Admin'))
  );

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

  useEffect(() => {
    if (isAdmin && selectedStoreId == null && stores.length > 0) {
      const persistedStore = persistedFilters?.storeId
        ? stores.find((s: any) => s.id === persistedFilters.storeId)
        : null;
      const firstActiveStore = persistedStore || stores.find((s: any) => s.is_active) || stores[0];
      if (firstActiveStore) {
        setSelectedStoreId(firstActiveStore.id);
      }
    }
  }, [isAdmin, selectedStoreId, stores, persistedFilters?.storeId]);

  const queryEnabled = Boolean(user) && (!isAdmin || selectedStoreId != null);

  const { data, isLoading, isPending, error } = useQuery({
    queryKey: [
      'defective-move-outs-adjusted',
      persistedFilters?.dateFrom,
      persistedFilters?.dateTo,
      selectedStoreId,
      persistedFilters?.brand,
      persistedFilters?.category,
      persistedFilters?.supplier,
    ],
    queryFn: () => catalogApi.defectiveProducts.moveOuts.list({
      has_adjustment: true,
      date_from: persistedFilters?.dateFrom || undefined,
      date_to: persistedFilters?.dateTo || undefined,
      store: selectedStoreId || undefined,
      brand: persistedFilters?.brand || undefined,
      category: persistedFilters?.category || undefined,
      supplier: persistedFilters?.supplier || undefined,
    }),
    retry: false,
    enabled: queryEnabled,
    staleTime: MOVE_OUTS_STALE_MS,
    gcTime: REF_STALE_MS,
    placeholderData: keepPreviousData,
  });

  const moveOuts: AdjustedMoveOut[] = (() => {
    if (!data) return [];
    const response = data.data || data;
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.results)) return response.results;
    if (Array.isArray(response?.data)) return response.data;
    return [];
  })();

  const filteredMoveOuts = useMemo(() => {
    return moveOuts.filter((moveOut) => {
      if (!search) return true;
      const searchLower = search.toLowerCase();
      return (
        String(moveOut.id).includes(searchLower) ||
        moveOut.invoice_number?.toLowerCase().includes(searchLower) ||
        moveOut.store_name?.toLowerCase().includes(searchLower) ||
        (moveOut.customer_name || '').toLowerCase().includes(searchLower)
      );
    });
  }, [moveOuts, search]);

  const formatDate = (dateString: string) => formatAppDate(dateString, { empty: '' });

  const formatCurrency = (amount: string | number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(parseMoveOutAmount(amount));
  };

  const totalAdjustment = filteredMoveOuts.reduce(
    (sum, moveOut) => sum + parseMoveOutAmount(moveOut.total_adjustment),
    0,
  );

  const showLoading = queryEnabled && (isLoading || (isPending && !data));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <PageHeader
          title="Adjusted Invoices"
          subtitle="Move-out invoices that have an adjustment amount"
          icon={Edit}
        />
        <div className="flex items-center gap-3">
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
                  onChange={(e) => setSelectedStoreId(parseInt(e.target.value))}
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
          <Button
            variant="outline"
            onClick={() => navigate('/defective-move-outs')}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back to Move-Outs</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Adjusted Invoices</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {filteredMoveOuts.length}
              </p>
            </div>
            <div className="p-3 bg-blue-100 rounded-lg">
              <FileText className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Adjustment</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {formatCurrency(totalAdjustment)}
              </p>
            </div>
            <div className="p-3 bg-blue-100 rounded-lg">
              <Coins className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            type="text"
            placeholder="Search adjusted invoices..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </Card>

      {showLoading ? (
        <LoadingState message="Loading adjusted invoices..." />
      ) : error ? (
        <ErrorState
          message="Error loading adjusted invoices. Please try again."
          onRetry={() => window.location.reload()}
        />
      ) : filteredMoveOuts.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="No adjusted invoices"
            message="No move-out invoices have an adjustment amount for the current filters."
          />
        </Card>
      ) : (
        <>
          <div className="hidden md:block">
            <Table headers={[
              { label: 'ID', align: 'left' },
              { label: 'Sent Date', align: 'left' },
              { label: 'Customer', align: 'left' },
              { label: 'Store', align: 'left' },
              { label: 'Items', align: 'right' },
              { label: 'Total Loss', align: 'right' },
              { label: 'Adjustment', align: 'right' },
              { label: '', align: 'right' },
            ]}>
              {filteredMoveOuts.map((moveOut) => (
                <TableRow
                  key={moveOut.id}
                  onClick={() => moveOut.invoice && navigate(`/invoices/${moveOut.invoice}`)}
                  className={moveOut.invoice ? 'cursor-pointer' : ''}
                >
                  <TableCell>
                    <span className="font-mono font-semibold text-gray-900">{moveOut.id}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600">
                      {moveOut.sent_date ? formatDate(moveOut.sent_date) : (
                        <span className="text-gray-400 italic">Not set</span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-900 font-medium">{moveOut.customer_name || '—'}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Store className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-900">{moveOut.store_name || 'N/A'}</span>
                    </div>
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-medium text-gray-900">{moveOut.total_items}</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-semibold text-red-600">{formatCurrency(moveOut.total_loss)}</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-semibold text-blue-700">{formatCurrency(moveOut.total_adjustment || 0)}</span>
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                </TableRow>
              ))}
            </Table>
          </div>
          <div className="md:hidden space-y-3">
            {filteredMoveOuts.map((moveOut) => (
              <div
                key={moveOut.id}
                className="bg-white border border-gray-200 rounded-lg shadow-sm p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono font-semibold text-gray-900">#{moveOut.id}</span>
                  <span className="text-sm font-semibold text-blue-700">
                    {formatCurrency(moveOut.total_adjustment || 0)}
                  </span>
                </div>
                <div className="text-sm font-medium text-gray-900">{moveOut.customer_name || '—'}</div>
                <div className="text-sm text-gray-600 mt-1">{moveOut.store_name || 'N/A'}</div>
                {moveOut.invoice && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/invoices/${moveOut.invoice}`)}
                    className="mt-3 gap-1.5 w-full"
                  >
                    <Eye className="h-4 w-4 flex-shrink-0" />
                    <span>View Invoice</span>
                  </Button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
