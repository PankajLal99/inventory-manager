import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Coins,
  Eye,
  FileText,
  Filter,
  Pencil,
  RefreshCw,
  Search,
  TrendingUp,
  Undo2,
} from 'lucide-react';
import { creditApi } from '../../lib/api';
import { DateRangePreset, formatNumber } from '../../lib/utils';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import DateRangeSelector from '../../components/ui/DateRangeSelector';
import Button from '../../components/ui/Button';
import Pagination from '../../components/ui/Pagination';
import LoadingState from '../../components/ui/LoadingState';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import CreditPOSModeToggle from './CreditPOSModeToggle';

type ListMode = 'sale' | 'return';

export default function CreditInvoices() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode: ListMode = searchParams.get('mode') === 'return' ? 'return' : 'sale';
  const isReturn = mode === 'return';

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [customerGroup, setCustomerGroup] = useState('');
  const [page, setPage] = useState(1);
  const [datePreset, setDatePreset] = useState<DateRangePreset>('custom');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(true);

  const setMode = (next: ListMode) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'return') params.set('mode', 'return');
    else params.delete('mode');
    setSearchParams(params, { replace: true });
    setStatus('');
    setPage(1);
  };

  const { data: customerGroups = [] } = useQuery({
    queryKey: ['credit-customer-groups'],
    queryFn: async () => {
      const res = await creditApi.customers.groups();
      return res.data || [];
    },
  });

  const filterParams = useMemo(() => {
    const params: Record<string, string | number> = { page, page_size: 25 };
    if (search.trim()) params.search = search.trim();
    if (status) params.status = status;
    if (customerGroup) params.customer_group = customerGroup;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return params;
  }, [search, status, customerGroup, dateFrom, dateTo, page]);

  const summaryParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (search.trim()) params.search = search.trim();
    if (customerGroup) params.customer_group = customerGroup;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return params;
  }, [search, customerGroup, dateFrom, dateTo]);

  const { data: summary } = useQuery({
    queryKey: ['credit-invoices-summary', summaryParams],
    queryFn: async () => {
      const res = await creditApi.invoices.summary(summaryParams);
      return res.data;
    },
  });

  const invoicesQuery = useQuery({
    queryKey: ['credit-invoices', filterParams],
    queryFn: async () => {
      const res = await creditApi.invoices.list(filterParams);
      return res.data;
    },
    enabled: !isReturn,
  });

  const returnsQuery = useQuery({
    queryKey: ['credit-returns', filterParams],
    queryFn: async () => {
      const res = await creditApi.returns.list(filterParams);
      return res.data;
    },
    enabled: isReturn,
  });

  const listQuery = isReturn ? returnsQuery : invoicesQuery;
  const { data, isLoading, error, refetch } = listQuery;

  const results = data?.results || [];
  const count = data?.count || 0;
  const pageSize = data?.page_size || 25;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  const totalSales = parseFloat(String(summary?.total_sales || 0));
  const totalReturns = parseFloat(String(summary?.total_returns || 0));
  const salesCount = summary?.sales_count || 0;
  const returnsCount = summary?.returns_count || 0;

  const hasActiveFilters = !!(search.trim() || status || customerGroup || dateFrom || dateTo);

  const handleResetFilters = () => {
    setSearch('');
    setStatus('');
    setCustomerGroup('');
    setDateFrom('');
    setDateTo('');
    setDatePreset('custom');
    setPage(1);
  };

  return (
    <div className="space-y-6 w-full">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <PageHeader
            title={isReturn ? 'Return Invoices' : 'Invoices'}
            subtitle={
              isReturn
                ? 'Credit returns from POS Credit Return'
                : 'Credit sales invoices from POS Credit'
            }
            icon={isReturn ? Undo2 : FileText}
          />
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
            <CreditPOSModeToggle
              mode={mode}
              onChange={setMode}
              ariaLabel="Invoice list mode"
            />
            <Button
              onClick={() => navigate(isReturn ? '/pos-credit-return' : '/pos-credit')}
              className="w-full sm:w-auto"
            >
              {isReturn ? 'Open POS Return' : 'Open POS Credit'}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-500">Summary for selected date range</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-6">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Sales</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">₹{formatNumber(totalSales)}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {salesCount} open invoice{salesCount === 1 ? '' : 's'}
                </p>
              </div>
              <div className="p-3 bg-green-100 rounded-lg">
                <TrendingUp className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Returns</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">₹{formatNumber(totalReturns)}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {returnsCount} return{returnsCount === 1 ? '' : 's'}
                </p>
              </div>
              <div className="p-3 bg-amber-100 rounded-lg">
                <RefreshCw className="h-6 w-6 text-amber-600" />
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Net (Sales − Returns)</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  ₹{formatNumber(totalSales - totalReturns)}
                </p>
              </div>
              <div className="p-3 bg-blue-100 rounded-lg">
                <Coins className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  {isReturn ? 'Returns in range' : 'Invoices in range'}
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {isReturn ? returnsCount : (summary?.invoice_count ?? count)}
                </p>
                {!isReturn && summary?.void_count ? (
                  <p className="text-xs text-red-600 mt-1">{summary.void_count} voided</p>
                ) : null}
              </div>
              <div className="p-3 bg-gray-100 rounded-lg">
                {isReturn ? (
                  <Undo2 className="h-6 w-6 text-gray-600" />
                ) : (
                  <FileText className="h-6 w-6 text-gray-600" />
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Card className="w-full">
        <div className="p-4 border-b border-gray-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-gray-900 shrink-0">
            {isReturn ? 'Return filters' : 'Filters'}
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 self-start sm:self-auto"
          >
            <Filter className="h-4 w-4" />
            {showFilters ? 'Hide' : 'Show'} filters
          </Button>
        </div>

        {showFilters ? (
          <div className="p-4 border-b border-gray-100 overflow-visible">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-12 gap-4 items-end">
              <div className="relative sm:col-span-2 xl:col-span-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                <Input
                  type="text"
                  placeholder={
                    isReturn
                      ? 'Search return # or customer…'
                      : 'Search invoice # or customer…'
                  }
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-10 h-10"
                />
              </div>
              <div className="xl:col-span-2">
                <Select
                  label="Status"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                  className="h-10 py-2 text-sm"
                >
                  <option value="">All</option>
                  {isReturn ? (
                    <>
                      <option value="completed">Completed</option>
                      <option value="void">Void</option>
                    </>
                  ) : (
                    <>
                      <option value="open">Open</option>
                      <option value="void">Void</option>
                    </>
                  )}
                </Select>
              </div>
              <div className="xl:col-span-2">
                <Select
                  label="Customer Group"
                  value={customerGroup}
                  onChange={(e) => {
                    setCustomerGroup(e.target.value);
                    setPage(1);
                  }}
                  className="h-10 py-2 text-sm"
                >
                  <option value="">All Groups</option>
                  {(customerGroups as any[]).map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="sm:col-span-2 xl:col-span-3 min-w-0">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Date range</label>
                <DateRangeSelector
                  preset={datePreset}
                  value={{ startDate: dateFrom, endDate: dateTo }}
                  onChange={({ preset, range }) => {
                    setDatePreset(preset);
                    setDateFrom(range.startDate);
                    setDateTo(range.endDate);
                    setPage(1);
                  }}
                />
              </div>
              {hasActiveFilters ? (
                <div className="sm:col-span-2 xl:col-span-1 flex xl:justify-end">
                  <Button
                    variant="outline"
                    onClick={handleResetFilters}
                    className="h-10 w-full xl:w-auto"
                  >
                    Reset
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState
            message={isReturn ? 'Failed to load credit returns' : 'Failed to load credit invoices'}
            onRetry={() => refetch()}
          />
        ) : results.length === 0 ? (
          <EmptyState
            icon={isReturn ? Undo2 : FileText}
            title={isReturn ? 'No return invoices' : 'No invoices'}
            message={
              hasActiveFilters
                ? 'Try adjusting your filters.'
                : isReturn
                  ? 'Create a return from POS Credit Return.'
                  : 'Checkout from POS Credit to create one.'
            }
          />
        ) : isReturn ? (
          <>
            <Table headers={['Return', 'Customer', 'Group', 'Store', 'Status', 'Total', 'Date', '']}>
              {results.map((ret: any) => (
                <TableRow key={ret.id}>
                  <TableCell className="font-medium">{ret.return_number}</TableCell>
                  <TableCell>
                    <div>{ret.customer_name}</div>
                    {ret.customer_phone ? (
                      <div className="text-xs text-gray-400">{ret.customer_phone}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {ret.customer_group_name || '—'}
                  </TableCell>
                  <TableCell>{ret.store_name}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                        ret.status === 'void'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-green-100 text-green-800'
                      }`}
                    >
                      {ret.status}
                    </span>
                  </TableCell>
                  <TableCell>₹{formatNumber(parseFloat(ret.total || 0))}</TableCell>
                  <TableCell className="text-sm text-gray-500">
                    {ret.created_at ? new Date(ret.created_at).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {ret.status === 'completed' ? (
                        <button
                          type="button"
                          className="p-1.5 text-amber-700 hover:bg-amber-50 rounded"
                          onClick={() => navigate(`/credit-returns/${ret.id}?edit=1`)}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                        onClick={() => navigate(`/credit-returns/${ret.id}`)}
                        title="View"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </Table>
            <div className="p-4">
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
                totalItems={count}
                pageSize={pageSize}
              />
            </div>
          </>
        ) : (
          <>
            <Table headers={['Invoice', 'Customer', 'Group', 'Store', 'Status', 'Total', 'Date', '']}>
              {results.map((inv: any) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                  <TableCell>
                    <div>{inv.customer_name}</div>
                    {inv.customer_phone ? (
                      <div className="text-xs text-gray-400">{inv.customer_phone}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {inv.customer_group_name || '—'}
                  </TableCell>
                  <TableCell>{inv.store_name}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                        inv.status === 'void'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {inv.status}
                    </span>
                  </TableCell>
                  <TableCell>₹{formatNumber(parseFloat(inv.total || 0))}</TableCell>
                  <TableCell className="text-sm text-gray-500">
                    {inv.created_at ? new Date(inv.created_at).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {inv.status === 'open' ? (
                        <button
                          type="button"
                          className="p-1.5 text-amber-700 hover:bg-amber-50 rounded"
                          onClick={() => navigate(`/credit-invoices/${inv.id}?edit=1`)}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                        onClick={() => navigate(`/credit-invoices/${inv.id}`)}
                        title="View"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </Table>
            <div className="p-4">
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
                totalItems={count}
                pageSize={pageSize}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
