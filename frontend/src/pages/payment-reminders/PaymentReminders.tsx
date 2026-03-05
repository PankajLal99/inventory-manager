import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Search, Filter } from 'lucide-react';
import { customersApi } from '../../lib/api';
import { formatNumber, toLocalDateString } from '../../lib/utils';
import { toast } from '../../lib/toast';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';

function getCurrentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getDayLabel(isoDate: string): string {
  return String(new Date(isoDate).getDate());
}

export default function PaymentReminders() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [customerGroup, setCustomerGroup] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [month, setMonth] = useState(getCurrentMonthValue());
  const [selectedCell, setSelectedCell] = useState<{
    customerId: number;
    customerName: string;
    date: string;
    amount: number;
  } | null>(null);
  const [newReminder, setNewReminder] = useState({
    due_date: '',
  });
  const [rowDrafts, setRowDrafts] = useState<Record<number, { due_date: string; settled_payment: string }>>({});

  const { data: groupsData } = useQuery({
    queryKey: ['customer-groups'],
    queryFn: async () => {
      const response = await customersApi.groups.list();
      return response.data;
    },
    retry: false,
  });

  const groups = useMemo(() => {
    if (!groupsData) return [];
    if (Array.isArray(groupsData)) return groupsData;
    if (Array.isArray(groupsData.results)) return groupsData.results;
    if (Array.isArray(groupsData.data)) return groupsData.data;
    return [];
  }, [groupsData]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['payment-reminders-calendar', search, customerGroup, dateFrom, dateTo, month],
    queryFn: async () => {
      const params: Record<string, string> = { month };
      if (search.trim()) params.search = search.trim();
      if (customerGroup) params.customer_group = customerGroup;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const response = await customersApi.paymentReminders.calendar(params);
      return response.data;
    },
    retry: false,
  });

  const customers = data?.customers || [];
  const days = data?.days || [];

  const kpis = useMemo(() => {
    const today = toLocalDateString(new Date());
    const next7StartDate = new Date();
    next7StartDate.setDate(next7StartDate.getDate() + 1);
    const next7EndDate = new Date();
    next7EndDate.setDate(next7EndDate.getDate() + 7);
    const next7Start = toLocalDateString(next7StartDate);
    const next7End = toLocalDateString(next7EndDate);

    let owedToday = 0;
    let owedNext7Days = 0;
    let owedThisMonth = 0;

    for (const customer of customers) {
      const dailyTotals = customer.daily_totals || {};
      for (const [date, rawAmount] of Object.entries(dailyTotals)) {
        const amount = Number(rawAmount || 0);
        if (amount <= 0) continue;
        owedThisMonth += amount;
        if (date === today) {
          owedToday += amount;
        }
        if (date >= next7Start && date <= next7End) {
          owedNext7Days += amount;
        }
      }
    }

    return {
      totalDue: Number(data?.total_due || 0),
      owedToday,
      owedNext7Days,
      owedThisMonth,
    };
  }, [customers, data?.total_due]);

  const { data: cellRemindersData, isLoading: cellRemindersLoading } = useQuery({
    queryKey: ['payment-reminder-cell', selectedCell?.customerId, selectedCell?.date],
    queryFn: async () => {
      if (!selectedCell) return [];
      const response = await customersApi.paymentReminders.list({
        customer: selectedCell.customerId,
        date_from: selectedCell.date,
        date_to: selectedCell.date,
        include_settled: 'true',
      });
      return response.data;
    },
    enabled: !!selectedCell,
    retry: false,
  });

  useEffect(() => {
    if (selectedCell) {
      setNewReminder({ due_date: selectedCell.date });
    } else {
      setNewReminder({ due_date: '' });
      setRowDrafts({});
    }
  }, [selectedCell]);

  useEffect(() => {
    if (!cellRemindersData || !Array.isArray(cellRemindersData)) {
      setRowDrafts({});
      return;
    }
    const nextDrafts: Record<number, { due_date: string; settled_payment: string }> = {};
    for (const reminder of cellRemindersData) {
      nextDrafts[reminder.id] = {
        due_date: reminder.due_date || '',
        settled_payment: reminder.settled_payment ? String(reminder.settled_payment) : '',
      };
    }
    setRowDrafts(nextDrafts);
  }, [cellRemindersData]);

  const refreshReminderQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: ['payment-reminders-calendar'] });
    await queryClient.invalidateQueries({ queryKey: ['payment-reminder-cell'] });
  };

  const createReminderMutation = useMutation({
    mutationFn: (payload: any) => customersApi.paymentReminders.create(payload),
    onSuccess: async () => {
      toast('Payment reminder created', 'success');
      await refreshReminderQueries();
    },
    onError: (err: any) => {
      toast(err?.response?.data?.error || 'Failed to create payment reminder', 'error');
    },
  });

  const updateReminderMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: any }) => customersApi.paymentReminders.update(id, payload),
    onSuccess: async () => {
      toast('Payment reminder updated', 'success');
      await refreshReminderQueries();
    },
    onError: (err: any) => {
      toast(err?.response?.data?.error || 'Failed to update payment reminder', 'error');
    },
  });

  const deleteReminderMutation = useMutation({
    mutationFn: (id: number) => customersApi.paymentReminders.delete(id),
    onSuccess: async () => {
      toast('Payment reminder deleted', 'success');
      await refreshReminderQueries();
    },
    onError: (err: any) => {
      toast(err?.response?.data?.error || 'Failed to delete payment reminder', 'error');
    },
  });

  const handleCreateReminder = () => {
    if (!selectedCell) return;
    if (!newReminder.due_date) {
      toast('Please enter due date', 'error');
      return;
    }
    createReminderMutation.mutate({
      customer: selectedCell.customerId,
      due_date: newReminder.due_date,
      // Amount is always derived from ledger outstanding, not stored reminder amount.
      due_amount: 0,
    });
  };

  const handleUpdateReminder = (id: number) => {
    const draft = rowDrafts[id];
    if (!draft?.due_date) {
      toast('Due date is required', 'error');
      return;
    }
    const payload: any = {
      due_date: draft.due_date,
    };
    if (draft.settled_payment.trim()) {
      payload.settled_payment = Number(draft.settled_payment);
    }
    updateReminderMutation.mutate({ id, payload });
  };

  const handleSettleReminder = (id: number, settle: boolean) => {
    const draft = rowDrafts[id];
    const payload: any = { is_settled: settle };
    if (settle && draft?.settled_payment?.trim()) {
      payload.settled_payment = Number(draft.settled_payment);
    }
    if (!settle) {
      payload.settled_payment = null;
    }
    updateReminderMutation.mutate({ id, payload });
  };

  if (isLoading) {
    return <LoadingState message="Loading payment reminders..." />;
  }

  if (error) {
    return (
      <ErrorState
        message="Error loading payment reminders. Please try again."
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment Reminders"
        subtitle="Month view of due amounts by customer"
        icon={CalendarDays}
      />

      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm font-semibold text-gray-600">Calendar Total Dues</p>
          <p className="text-2xl font-bold text-red-600">₹{formatNumber(kpis.totalDue)}</p>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <p className="text-sm text-gray-600">Customers</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{data?.customers_count || 0}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-600">Month</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{data?.month || month}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-600">Owed Today</p>
          <p className="text-2xl font-bold text-red-600 mt-1">₹{formatNumber(kpis.owedToday)}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-600">Owed in Next 7 Days</p>
          <p className="text-2xl font-bold text-red-600 mt-1">₹{formatNumber(kpis.owedNext7Days)}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <p className="text-sm text-gray-600">Owed in This Month</p>
          <p className="text-2xl font-bold text-red-600 mt-1">₹{formatNumber(kpis.owedThisMonth)}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-600">Total Dues (Calendar)</p>
          <p className="text-2xl font-bold text-red-600 mt-1">₹{formatNumber(kpis.totalDue)}</p>
        </Card>
      </div>

      <Card>
        <div className="flex gap-3 overflow-x-auto pb-1">
          <div className="relative min-w-[320px] flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search customer name, phone, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="min-w-[220px]">
            <Select
              value={customerGroup}
              onChange={(e) => setCustomerGroup(e.target.value)}
              icon={<Filter className="h-4 w-4" />}
            >
              <option value="">All Customer Groups</option>
              {groups.map((group: any) => (
                <option key={group.id} value={String(group.id)}>
                  {group.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="min-w-[170px]">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              placeholder="From date"
            />
          </div>

          <div className="min-w-[170px]">
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              placeholder="To date"
            />
          </div>

          <div className="min-w-[190px]">
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
        </div>
      </Card>

      {customers.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="No reminders found"
            message="Try changing the filters or add payment reminders for this month."
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-[1200px] w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="sticky left-0 z-20 bg-white text-left px-3 py-2 min-w-[220px]">Customer</th>
                  {days.map((day: string) => (
                    <th key={day} className="text-right px-2 py-2 min-w-[72px] text-gray-600">
                      {getDayLabel(day)}
                    </th>
                  ))}
                  <th className="sticky right-0 z-20 bg-white text-right px-3 py-2 min-w-[140px]">Total Due</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer: any) => (
                  <tr key={customer.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2">
                      <div className="font-medium text-gray-900">{customer.name}</div>
                      <div className="text-xs text-gray-500">{customer.customer_group_name || 'No group'}</div>
                    </td>
                    {days.map((day: string) => {
                      const value = customer.daily_totals?.[day] || '0';
                      const amount = Number(value);
                      return (
                        <td key={`${customer.id}-${day}`} className="text-right px-2 py-2">
                          {amount > 0 ? (
                            <button
                              type="button"
                              onClick={() => setSelectedCell({
                                customerId: customer.id,
                                customerName: customer.name,
                                date: day,
                                amount,
                              })}
                              className="font-semibold text-red-600 hover:text-red-700 underline underline-offset-2"
                            >
                              ₹{formatNumber(amount)}
                            </button>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="sticky right-0 z-10 bg-white text-right px-3 py-2 font-semibold text-red-600">
                      ₹{formatNumber(customer.total_due || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm font-semibold text-gray-600">Calendar Total Dues</p>
          <p className="text-2xl font-bold text-red-600">₹{formatNumber(kpis.totalDue)}</p>
        </div>
      </Card>

      <Modal
        isOpen={!!selectedCell}
        onClose={() => setSelectedCell(null)}
        title={selectedCell ? `Due Details - ${selectedCell.customerName} (${selectedCell.date})` : 'Due Details'}
        size="xl"
      >
        <div className="space-y-6">
          <div className="rounded-lg bg-red-50 border border-red-200 p-4">
            <p className="text-sm text-red-800">
              Total due for this day: <span className="font-semibold">₹{formatNumber(selectedCell?.amount || 0)}</span>
            </p>
            <p className="text-xs text-red-700 mt-1">
              All due amounts are highlighted in red on the calendar. Click a due amount to manage it.
            </p>
          </div>

          <Card>
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-900">Add New Reminder</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  label="Due Date"
                  type="date"
                  value={newReminder.due_date}
                  onChange={(e) => setNewReminder((prev) => ({ ...prev, due_date: e.target.value }))}
                />
                <div className="flex items-end">
                  <Button
                    onClick={handleCreateReminder}
                    disabled={createReminderMutation.isPending}
                    className="w-full"
                  >
                    {createReminderMutation.isPending ? 'Adding...' : 'Add Reminder'}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Reminder amount is auto-derived from ledger outstanding amount.
              </p>
            </div>
          </Card>

          <Card>
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-900">Existing Reminders</h4>
              {cellRemindersLoading ? (
                <p className="text-sm text-gray-500">Loading reminders...</p>
              ) : Array.isArray(cellRemindersData) && cellRemindersData.length > 0 ? (
                <div className="space-y-3">
                  {cellRemindersData.map((reminder: any) => {
                    const draft = rowDrafts[reminder.id] || {
                      due_date: reminder.due_date || '',
                      settled_payment: reminder.settled_payment ? String(reminder.settled_payment) : '',
                    };
                    return (
                      <div key={reminder.id} className="border border-gray-200 rounded-lg p-3 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          <Input
                            label="Due Date"
                            type="date"
                            value={draft.due_date}
                            onChange={(e) => setRowDrafts((prev) => ({
                              ...prev,
                              [reminder.id]: { ...draft, due_date: e.target.value },
                            }))}
                          />
                          <div className="flex flex-col justify-end">
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                              Ledger Outstanding
                            </label>
                            <div className="h-10 px-3 flex items-center rounded-lg border border-gray-200 bg-gray-50 text-red-600 font-semibold">
                              ₹{formatNumber(selectedCell?.amount || 0)}
                            </div>
                          </div>
                          <Input
                            label="Settled Payment ID (optional)"
                            type="number"
                            min="1"
                            value={draft.settled_payment}
                            onChange={(e) => setRowDrafts((prev) => ({
                              ...prev,
                              [reminder.id]: { ...draft, settled_payment: e.target.value },
                            }))}
                            placeholder="Payment ID"
                          />
                          <div className="flex items-end">
                            <span className={`text-xs font-semibold px-2 py-1 rounded ${reminder.is_settled ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                              {reminder.is_settled ? 'Settled' : 'Pending'}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleUpdateReminder(reminder.id)}
                            disabled={updateReminderMutation.isPending}
                          >
                            Save Changes
                          </Button>
                          {reminder.is_settled ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleSettleReminder(reminder.id, false)}
                              disabled={updateReminderMutation.isPending}
                            >
                              Mark Unsettled
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => handleSettleReminder(reminder.id, true)}
                              disabled={updateReminderMutation.isPending}
                            >
                              Settle Payment
                            </Button>
                          )}
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => deleteReminderMutation.mutate(reminder.id)}
                            disabled={deleteReminderMutation.isPending}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-500">No reminders found for this customer/date.</p>
              )}
            </div>
          </Card>
        </div>
      </Modal>
    </div>
  );
}
