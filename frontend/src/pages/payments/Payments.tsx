import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Coins, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { customersApi } from '../../lib/api';
import { formatAmountINR, toLocalDateString } from '../../lib/utils';
import { usePersistedListDateRange } from '../../lib/listDateRangePersistence';
import { toast } from '../../lib/toast';
import { auth } from '../../lib/auth';
import { canSeeSuperMetrics, hasNavPermission, hasPaymentsExtendedColumns, isStoreManagementAdmin } from '../../lib/access';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Table, { TableCell, TableRow } from '../../components/ui/Table';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import DatePicker from '../../components/ui/DatePicker';
import DateRangeSelector from '../../components/ui/DateRangeSelector';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';

type PaymentMode = 'cash' | 'upi' | 'mixed' | 'other';
type GroupBy = 'none' | 'date' | 'customer' | 'payment_mode';

interface ManualCreditEntry {
  id: number;
  customer?: number | null;
  customer_name?: string;
  payment_mode?: PaymentMode;
  cash_amount?: number | string | null;
  upi_amount?: number | string | null;
  amount: number | string;
  description?: string;
  is_sent?: boolean;
  created_at?: string;
  created_by_username?: string;
}

const getTodayDateValue = (): string => toLocalDateString(new Date());
const getCurrentTime = (): string => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

export default function Payments() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = auth.getUser();
  const isSuper = canSeeSuperMetrics(user);
  const isRetail = !hasPaymentsExtendedColumns(user);
  const canAddPayments = true;
  const canEditPayments = !isRetail;
  const canMarkSent = canEditPayments || isRetail;
  const canAccessLedger = hasNavPermission(user, 'nav.ledger');
  const canDeletePayments = isStoreManagementAdmin(user);
  const [search, setSearch] = useState('');
  const [paymentMode, setPaymentMode] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const { datePreset, dateFrom, dateTo, setListDateRange } = usePersistedListDateRange();
  const [showAddPaymentModal, setShowAddPaymentModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ManualCreditEntry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<ManualCreditEntry | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [form, setForm] = useState({
    date: getTodayDateValue(),
    time: getCurrentTime(),
    amount: '',
    payment_mode: 'cash' as PaymentMode,
    cash_amount: '',
    upi_amount: '',
    description: '',
  });
  const [editForm, setEditForm] = useState({
    date: getTodayDateValue(),
    amount: '',
    payment_mode: 'cash' as PaymentMode,
    cash_amount: '',
    upi_amount: '',
    description: '',
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['manual-credit-entries', search, paymentMode, dateFrom, dateTo],
    queryFn: async () => {
      const params: Record<string, string> = {
        entry_type: 'credit',
        manual_only: 'true',
      };
      if (search.trim()) params.search = search.trim();
      if (paymentMode) params.payment_mode = paymentMode;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const response = await customersApi.ledger.entries.list(params);
      return response.data;
    },
    placeholderData: keepPreviousData,
    retry: false,
  });

  const entries: ManualCreditEntry[] = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
    return [];
  }, [data]);

  const totalAmount = useMemo(
    () => entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
    [entries]
  );

  const groupedRows = useMemo(() => {
    if (groupBy === 'none') return [];
    const groups = new Map<string, { label: string; count: number; total: number }>();
    entries.forEach((entry) => {
      let key = '';
      let label = '';
      if (groupBy === 'date') {
        key = (entry.created_at || '').slice(0, 10) || 'No Date';
        label = key;
      } else if (groupBy === 'customer') {
        key = entry.customer_name || 'Unknown Customer';
        label = key;
      } else {
        key = entry.payment_mode || 'other';
        label = key.toUpperCase();
      }
      const prev = groups.get(key) || { label, count: 0, total: 0 };
      prev.count += 1;
      prev.total += Number(entry.amount || 0);
      groups.set(key, prev);
    });
    return Array.from(groups.values()).sort((a, b) => b.total - a.total);
  }, [entries, groupBy]);

  const { data: customersResponse } = useQuery({
    queryKey: ['customer-groups-for-payments'],
    queryFn: async () => {
      const response = await customersApi.groups.list();
      return response.data;
    },
    retry: false,
  });

  const customerGroups = useMemo(() => {
    if (!customersResponse) return [];
    if (Array.isArray(customersResponse.results)) return customersResponse.results;
    if (Array.isArray(customersResponse.data)) return customersResponse.data;
    if (Array.isArray(customersResponse)) return customersResponse;
    return [];
  }, [customersResponse]);

  const repairGroupIds = useMemo(() => {
    return customerGroups
      .filter((group: any) => String(group?.name || '').toLowerCase().includes('repair'))
      .map((group: any) => group.id);
  }, [customerGroups]);

  const { data: customerSearchResponse } = useQuery({
    queryKey: ['payments-customer-search', customerSearch],
    queryFn: async () => {
      const params: Record<string, any> = { search: customerSearch.trim() };
      // If exactly one repair group exists, also ask backend to exclude it.
      if (repairGroupIds.length === 1) {
        params.exclude_group = repairGroupIds[0];
      }
      const response = await customersApi.list(params);
      return response.data;
    },
    enabled: showAddPaymentModal && customerSearch.trim().length > 0,
    retry: false,
  });

  const customers = useMemo(() => {
    let list: any[] = [];
    if (!customerSearchResponse) return list;
    if (Array.isArray(customerSearchResponse.results)) list = customerSearchResponse.results;
    else if (Array.isArray(customerSearchResponse.data)) list = customerSearchResponse.data;
    else if (Array.isArray(customerSearchResponse)) list = customerSearchResponse;

    // Always exclude any Repair groups on frontend too (covers multiple repair group ids).
    if (repairGroupIds.length > 0) {
      list = list.filter((customer: any) => !repairGroupIds.includes(customer.customer_group));
    } else {
      // Fallback by group name, in case group ids are unavailable.
      list = list.filter(
        (customer: any) =>
          !String(customer?.customer_group_name || '').toLowerCase().includes('repair')
      );
    }
    return list;
  }, [customerSearchResponse, repairGroupIds]);

  const resetForm = () => {
    setSelectedCustomer(null);
    setCustomerSearch('');
    setForm({
      date: getTodayDateValue(),
      time: getCurrentTime(),
      amount: '',
      payment_mode: 'cash',
      cash_amount: '',
      upi_amount: '',
      description: '',
    });
  };

  const createPaymentMutation = useMutation({
    mutationFn: (payload: any) => customersApi.ledger.entries.create(payload),
    onSuccess: async () => {
      toast('Payment added successfully', 'success');
      setShowAddPaymentModal(false);
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ['manual-credit-entries'] });
    },
    onError: (err: any) => {
      toast(err?.response?.data?.error || 'Failed to add payment', 'error');
    },
  });

  const updatePaymentMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: any }) => customersApi.ledger.entries.update(id, payload),
    onSuccess: async () => {
      toast('Payment updated successfully', 'success');
      setEditingEntry(null);
      await queryClient.invalidateQueries({ queryKey: ['manual-credit-entries'] });
    },
    onError: (err: any) => {
      toast(err?.response?.data?.error || 'Failed to update payment', 'error');
    },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: (id: number) => customersApi.ledger.entries.delete(id),
    onSuccess: async () => {
      toast('Payment deleted successfully', 'success');
      setDeletingEntry(null);
      await queryClient.invalidateQueries({ queryKey: ['manual-credit-entries'] });
    },
    onError: (err: any) => {
      toast(err?.response?.data?.error || 'Failed to delete payment', 'error');
    },
  });

  const updateSentMutation = useMutation({
    mutationFn: ({ id, is_sent }: { id: number; is_sent: boolean }) =>
      customersApi.ledger.entries.update(id, { is_sent }),
    onMutate: async ({ id, is_sent }) => {
      await queryClient.cancelQueries({ queryKey: ['manual-credit-entries'] });
      const previousData = queryClient.getQueryData(['manual-credit-entries', search, paymentMode, dateFrom, dateTo]);
      queryClient.setQueryData(['manual-credit-entries', search, paymentMode, dateFrom, dateTo], (old: any) => {
        if (!old) return old;
        const updated = JSON.parse(JSON.stringify(old));
        const results = updated.results || updated.data || (Array.isArray(updated) ? updated : []);
        for (const entry of results) {
          if (entry.id === id) {
            entry.is_sent = is_sent;
            break;
          }
        }
        return updated;
      });
      return { previousData };
    },
    onError: (error: any, _variables, context: any) => {
      if (context?.previousData) {
        queryClient.setQueryData(['manual-credit-entries', search, paymentMode, dateFrom, dateTo], context.previousData);
      }
      toast(error?.response?.data?.error || 'Failed to update sent status', 'error');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['manual-credit-entries'], refetchType: 'none' });
    },
  });

  const handleCreatePayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) {
      toast('Please select a customer', 'error');
      return;
    }
    if (!form.amount.trim() || Number(form.amount) <= 0) {
      toast('Please enter a valid amount', 'error');
      return;
    }
    if (form.payment_mode === 'mixed') {
      const cash = Number(form.cash_amount || 0);
      const upi = Number(form.upi_amount || 0);
      if (cash < 0 || upi < 0) {
        toast('Cash and UPI split cannot be negative', 'error');
        return;
      }
      if ((cash + upi).toFixed(2) !== Number(form.amount).toFixed(2)) {
        toast('For mixed mode, cash + UPI must match amount', 'error');
        return;
      }
    }
    createPaymentMutation.mutate({
      customer: selectedCustomer.id,
      entry_type: 'credit',
      payment_mode: form.payment_mode,
      cash_amount: form.payment_mode === 'mixed' ? Number(form.cash_amount || 0) : undefined,
      upi_amount: form.payment_mode === 'mixed' ? Number(form.upi_amount || 0) : undefined,
      amount: Number(form.amount),
      description: form.description.trim(),
      created_at: form.date ? `${form.date}T${form.time || '12:00'}:00` : undefined,
    });
  };

  const openEditModal = (entry: ManualCreditEntry) => {
    setEditingEntry(entry);
    setEditForm({
      date: entry.created_at ? entry.created_at.slice(0, 10) : getTodayDateValue(),
      amount: String(entry.amount ?? ''),
      payment_mode: (entry.payment_mode || 'cash') as PaymentMode,
      cash_amount: String(entry.cash_amount ?? ''),
      upi_amount: String(entry.upi_amount ?? ''),
      description: entry.description || '',
    });
  };

  const handleUpdatePayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;
    if (!editForm.amount.trim() || Number(editForm.amount) <= 0) {
      toast('Please enter a valid amount', 'error');
      return;
    }
    if (editForm.payment_mode === 'mixed') {
      const cash = Number(editForm.cash_amount || 0);
      const upi = Number(editForm.upi_amount || 0);
      if (cash < 0 || upi < 0) {
        toast('Cash and UPI split cannot be negative', 'error');
        return;
      }
      if ((cash + upi).toFixed(2) !== Number(editForm.amount).toFixed(2)) {
        toast('For mixed mode, cash + UPI must match amount', 'error');
        return;
      }
    }
    updatePaymentMutation.mutate({
      id: editingEntry.id,
      payload: {
        amount: Number(editForm.amount),
        payment_mode: editForm.payment_mode,
        cash_amount: editForm.payment_mode === 'mixed' ? Number(editForm.cash_amount || 0) : null,
        upi_amount: editForm.payment_mode === 'mixed' ? Number(editForm.upi_amount || 0) : null,
        description: editForm.description.trim(),
        // keep as credit payment entry, only update metadata/amount
        entry_type: 'credit',
        created_at: editForm.date ? `${editForm.date}T12:00:00` : undefined,
      },
    });
  };

  if (isLoading) return <LoadingState message="Loading payments..." />;
  if (error) {
    return (
      <ErrorState
        message="Error loading manual credit entries. Please try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        subtitle="Manual credit entries recorded against customers"
        icon={Coins}
        action={canAddPayments ? (
          <Button onClick={() => setShowAddPaymentModal(true)} className="gap-2">
            <Plus className="h-5 w-5" />
            Add Payment
          </Button>
        ) : undefined}
      />

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search customer/description"
              className="pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
            <option value="">All Payment Modes</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="mixed">Mixed</option>
            <option value="other">Other</option>
          </Select>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">Date Range</label>
            <DateRangeSelector preset={datePreset} value={{ startDate: dateFrom, endDate: dateTo }} onChange={setListDateRange} />
          </div>
        </div>
        <div className="mt-4">
          <Select label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            <option value="none">No Grouping</option>
            <option value="date">Date</option>
            <option value="customer">Customer</option>
            <option value="payment_mode">Payment Mode</option>
          </Select>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-600">
            Entries: <span className="font-semibold text-gray-900">{entries.length}</span>
          </div>
          {isSuper && (
            <div className="text-sm text-gray-600">
              Total amount: <span className="font-semibold text-emerald-700">₹{formatAmountINR(totalAmount)}</span>
            </div>
          )}
        </div>
      </Card>

      {groupBy !== 'none' && (
        <Card>
          <div className="space-y-2">
            {groupedRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between text-base border-b border-gray-100 pb-3 last:border-0">
                <span className="font-semibold text-gray-800">{row.label}</span>
                <span className="text-gray-600 font-medium">{row.count} entries</span>
                <span className="text-lg font-bold text-emerald-700">₹{formatAmountINR(row.total)}</span>
              </div>
            ))}
            {groupedRows.length === 0 && (
              <p className="text-base text-gray-500">No grouped data available for selected filters.</p>
            )}
          </div>
        </Card>
      )}

      {entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={Coins}
            title="No manual credit entries found"
            message="Record a credit in Ledger to see entries here."
          />
        </Card>
      ) : (
        <Table headers={['Date', 'Customer', 'Payment Mode', 'Description', 'Amount', 'Created By', 'Sent', 'Actions']}>
          {entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell className="text-base">{entry.created_at ? entry.created_at.slice(0, 10) : '-'}</TableCell>
              <TableCell className="font-semibold text-base">{entry.customer_name || '-'}</TableCell>
              <TableCell>
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-blue-100 text-blue-800">
                  {(entry.payment_mode || 'other').toUpperCase()}
                </span>
              </TableCell>
              <TableCell className="text-base">{entry.description || '-'}</TableCell>
              <TableCell align="right" className="text-base font-bold text-emerald-700">
                <div>
                  <div>₹{formatAmountINR(entry.amount || 0)}</div>
                  {entry.payment_mode === 'mixed' && (
                    <div className="text-xs text-gray-500 font-normal">
                      Cash: ₹{formatAmountINR(entry.cash_amount || 0)} | UPI: ₹{formatAmountINR(entry.upi_amount || 0)}
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-base">{entry.created_by_username || '-'}</TableCell>
              <TableCell align="center">
                {canMarkSent ? (
                  <input
                    type="checkbox"
                    checked={entry.is_sent || false}
                    onChange={(e) => {
                      updateSentMutation.mutate({
                        id: entry.id,
                        is_sent: e.target.checked,
                      });
                    }}
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                    title={entry.is_sent ? 'Marked as sent' : 'Mark as sent'}
                  />
                ) : (
                  <span className="text-gray-500 text-sm">{entry.is_sent ? 'Yes' : 'No'}</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2 flex-wrap">
                  {canAccessLedger && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-blue-700 border-blue-200 hover:bg-blue-50"
                      disabled={entry.customer == null}
                      title={entry.customer == null ? 'No customer on this entry' : 'Open customer ledger'}
                      onClick={() => {
                        if (entry.customer != null) navigate(`/ledger/${entry.customer}`);
                      }}
                    >
                      <BookOpen className="h-4 w-4" />
                      Ledger
                    </Button>
                  )}
                  {canEditPayments && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => openEditModal(entry)}
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </Button>
                  )}
                  {canDeletePayments && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => setDeletingEntry(entry)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </Table>
      )}

      {canAddPayments && <Modal
        isOpen={showAddPaymentModal}
        onClose={() => {
          setShowAddPaymentModal(false);
          resetForm();
        }}
        title="Add Payment"
      >
        <form onSubmit={handleCreatePayment} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Customer</label>
            <div className="relative">
              <Input
                placeholder="Search customer by name or phone..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
              />
              {customerSearch && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                  {customers.length > 0 ? (
                    customers.map((customer: any) => (
                      <button
                        key={customer.id}
                        type="button"
                        onClick={() => {
                          setSelectedCustomer(customer);
                          setCustomerSearch('');
                        }}
                        className="w-full text-left px-4 py-2 hover:bg-blue-50 border-b last:border-b-0"
                      >
                        <div className="font-medium">{customer.name}</div>
                        <div className="text-sm text-gray-500 flex flex-wrap gap-x-2">
                          {customer.phone && <span>{customer.phone}</span>}
                          <span className="text-blue-600">
                            Group: {customer.customer_group_name || 'Unassigned'}
                          </span>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-3 text-sm text-gray-500">No customers found</div>
                  )}
                </div>
              )}
            </div>
            {selectedCustomer && (
              <div className="mt-2 p-2 bg-blue-50 rounded flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-600" />
                  <div>
                    <span className="text-sm font-medium">{selectedCustomer.name}</span>
                    {selectedCustomer.phone && (
                      <span className="text-sm text-gray-600 ml-2">({selectedCustomer.phone})</span>
                    )}
                  </div>
                </div>
                <button type="button" className="text-xs text-red-600" onClick={() => setSelectedCustomer(null)}>
                  Remove
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DatePicker
              label="Date"
              value={form.date}
              onChange={(date) => setForm((prev) => ({ ...prev, date }))}
              required
            />
            <Input
              type="time"
              label="Time"
              value={form.time}
              onChange={(e) => setForm((prev) => ({ ...prev, time: e.target.value }))}
              required
            />
          </div>

          <Input
            type="number"
            step="0.01"
            min="0"
            label="Amount *"
            value={form.amount}
            onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
            required
          />

          <Select
            label="Payment Mode *"
            value={form.payment_mode}
            onChange={(e) => setForm((prev) => ({ ...prev, payment_mode: e.target.value as PaymentMode }))}
            required
          >
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="mixed">Mixed (Cash + UPI)</option>
            <option value="other">Other</option>
          </Select>

          {form.payment_mode === 'mixed' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                type="number"
                step="0.01"
                min="0"
                label="Cash Amount *"
                value={form.cash_amount}
                onChange={(e) => setForm((prev) => ({ ...prev, cash_amount: e.target.value }))}
                required
              />
              <Input
                type="number"
                step="0.01"
                min="0"
                label="UPI Amount *"
                value={form.upi_amount}
                onChange={(e) => setForm((prev) => ({ ...prev, upi_amount: e.target.value }))}
                required
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="Enter description"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowAddPaymentModal(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createPaymentMutation.isPending}>
              {createPaymentMutation.isPending ? 'Saving...' : 'Add Payment'}
            </Button>
          </div>
        </form>
      </Modal>}

      {canEditPayments && <Modal
        isOpen={!!editingEntry}
        onClose={() => setEditingEntry(null)}
        title="Edit Payment"
      >
        {editingEntry && (
          <form onSubmit={handleUpdatePayment} className="space-y-4">
            <DatePicker
              label="Date"
              value={editForm.date}
              onChange={(date) => setEditForm((prev) => ({ ...prev, date }))}
              required
            />

            <Input
              type="number"
              step="0.01"
              min="0"
              label="Amount *"
              value={editForm.amount}
              onChange={(e) => setEditForm((prev) => ({ ...prev, amount: e.target.value }))}
              required
            />

            <Select
              label="Payment Mode *"
              value={editForm.payment_mode}
              onChange={(e) => setEditForm((prev) => ({ ...prev, payment_mode: e.target.value as PaymentMode }))}
              required
            >
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="mixed">Mixed (Cash + UPI)</option>
              <option value="other">Other</option>
            </Select>

            {editForm.payment_mode === 'mixed' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  label="Cash Amount *"
                  value={editForm.cash_amount}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, cash_amount: e.target.value }))}
                  required
                />
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  label="UPI Amount *"
                  value={editForm.upi_amount}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, upi_amount: e.target.value }))}
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
              <textarea
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                value={editForm.description}
                onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditingEntry(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updatePaymentMutation.isPending}>
                {updatePaymentMutation.isPending ? 'Saving...' : 'Update Payment'}
              </Button>
            </div>
          </form>
        )}
      </Modal>}

      {canDeletePayments && <Modal
        isOpen={!!deletingEntry}
        onClose={() => setDeletingEntry(null)}
        title="Delete payment?"
      >
        <p className="text-gray-600 mb-4">
          This will remove the payment entry and adjust customer ledger balance. This cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => setDeletingEntry(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-red-600 hover:bg-red-700"
            disabled={deletePaymentMutation.isPending}
            onClick={() => deletingEntry && deletePaymentMutation.mutate(deletingEntry.id)}
          >
            {deletePaymentMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </Modal>}
    </div>
  );
}
