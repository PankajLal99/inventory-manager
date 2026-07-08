import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FileText, Eye } from 'lucide-react';
import { creditApi, catalogApi } from '../../lib/api';
import { formatNumber } from '../../lib/utils';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Button from '../../components/ui/Button';
import Pagination from '../../components/ui/Pagination';
import LoadingState from '../../components/ui/LoadingState';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';

export default function CreditInvoices() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [storeId, setStoreId] = useState('');
  const [page, setPage] = useState(1);

  const { data: stores = [] } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => {
      const res = await catalogApi.stores.list();
      const d = res.data;
      return Array.isArray(d) ? d : d?.results || [];
    },
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['credit-invoices', search, status, storeId, page],
    queryFn: async () => {
      const params: any = { page, page_size: 25 };
      if (search.trim()) params.search = search.trim();
      if (status) params.status = status;
      if (storeId) params.store = storeId;
      const res = await creditApi.invoices.list(params);
      return res.data;
    },
  });

  const results = data?.results || [];
  const count = data?.count || 0;
  const pageSize = data?.page_size || 25;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Credit Invoices"
        subtitle="Invoices created from POS Credit (separate from regular POS)"
        icon={FileText}
        action={<Button onClick={() => navigate('/pos-credit')}>Open POS Credit</Button>}
      />

      <Card>
        <div className="p-4 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <Input
              label="Search"
              placeholder="Invoice # or customer…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="w-40">
            <Select
              label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="void">Void</option>
            </Select>
          </div>
          <div className="w-48">
            <Select
              label="Store"
              value={storeId}
              onChange={(e) => {
                setStoreId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All stores</option>
              {(Array.isArray(stores) ? stores : []).map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message="Failed to load credit invoices" onRetry={() => refetch()} />
        ) : results.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No credit invoices"
            message="Checkout from POS Credit to create one."
          />
        ) : (
          <>
            <Table headers={['Invoice', 'Customer', 'Store', 'Status', 'Total', 'Date', '']}>
              {results.map((inv: any) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                  <TableCell>
                    <div>{inv.customer_name}</div>
                    {inv.customer_phone ? (
                      <div className="text-xs text-gray-400">{inv.customer_phone}</div>
                    ) : null}
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
                    <button
                      type="button"
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                      onClick={() => navigate(`/credit-invoices/${inv.id}`)}
                      title="View"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
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
