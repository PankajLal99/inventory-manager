import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, Plus, Search, Pencil, Trash2 } from 'lucide-react';
import { posApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import { toast } from '../../lib/toast';
import { formatDateDDMMYYYY, formatNumber, getTodayDateString } from '../../lib/utils';
import { usePersistedListDateRange } from '../../lib/listDateRangePersistence';
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

type PaymentMode = 'CASH' | 'ONLINE';
type GroupBy = 'none' | 'date' | 'expense_type' | 'lender' | 'borrower' | 'payment_type';

interface Expense {
  id: number;
  expense_date: string;
  expense_type: string;
  lender_name: string;
  borrower_name: string;
  payment_choices_type: PaymentMode;
  expense_amount: number | string;
  created_on: string;
  created_by_username?: string | null;
  last_updated_on: string;
  last_updated_by_username?: string | null;
}

interface ExpenseFormState {
  expense_date: string;
  expense_type: string;
  lender_name: string;
  borrower_name: string;
  payment_choices_type: PaymentMode;
  expense_amount: string;
}

const getDefaultFormState = (): ExpenseFormState => ({
  expense_date: getTodayDateString(),
  expense_type: '',
  lender_name: 'Manish Traders',
  borrower_name: '',
  payment_choices_type: 'CASH',
  expense_amount: '',
});

export default function Expenses() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<any>(null);
  const [isUserLoaded, setIsUserLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const { datePreset, dateFrom, dateTo, setListDateRange } = usePersistedListDateRange();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseFormState>(getDefaultFormState());
  const [debouncedExpenseType, setDebouncedExpenseType] = useState('');
  const [debouncedBorrowerName, setDebouncedBorrowerName] = useState('');
  const canSeeExpenseListing = (user?.groups || []).includes('Super');

  useEffect(() => {
    const loadUser = async () => {
      try {
        await auth.loadUser();
        setUser(auth.getUser());
      } catch (e) {
        setUser(auth.getUser());
      } finally {
        setIsUserLoaded(true);
      }
    };
    loadUser();
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['expenses', search, paymentFilter, dateFrom, dateTo],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (search.trim()) params.search = search.trim();
      if (paymentFilter) params.payment_type = paymentFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const response = await posApi.expenses.list(params);
      return response.data;
    },
    enabled: isUserLoaded && canSeeExpenseListing,
    placeholderData: keepPreviousData,
    retry: false,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedExpenseType(form.expense_type.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [form.expense_type]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedBorrowerName(form.borrower_name.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [form.borrower_name]);

  const { data: expenseTypeSuggestionsData } = useQuery({
    queryKey: ['expense-type-suggestions', debouncedExpenseType],
    queryFn: async () => {
      const response = await posApi.expenses.types(
        debouncedExpenseType ? { q: debouncedExpenseType } : {}
      );
      return response.data;
    },
    enabled: isModalOpen,
    retry: false,
  });

  const expenseTypeSuggestions: string[] = useMemo(() => {
    if (!expenseTypeSuggestionsData) return [];
    if (Array.isArray(expenseTypeSuggestionsData)) return expenseTypeSuggestionsData;
    if (Array.isArray(expenseTypeSuggestionsData.results)) return expenseTypeSuggestionsData.results;
    if (Array.isArray(expenseTypeSuggestionsData.data)) return expenseTypeSuggestionsData.data;
    return [];
  }, [expenseTypeSuggestionsData]);

  const { data: borrowerSuggestionsData } = useQuery({
    queryKey: ['expense-borrower-suggestions', debouncedBorrowerName],
    queryFn: async () => {
      const response = await posApi.expenses.borrowers(
        debouncedBorrowerName ? { q: debouncedBorrowerName } : {}
      );
      return response.data;
    },
    enabled: isModalOpen,
    retry: false,
  });

  const borrowerSuggestions: string[] = useMemo(() => {
    if (!borrowerSuggestionsData) return [];
    if (Array.isArray(borrowerSuggestionsData)) return borrowerSuggestionsData;
    if (Array.isArray(borrowerSuggestionsData.results)) return borrowerSuggestionsData.results;
    if (Array.isArray(borrowerSuggestionsData.data)) return borrowerSuggestionsData.data;
    return [];
  }, [borrowerSuggestionsData]);

  const expenses: Expense[] = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
    return [];
  }, [data]);

  const totalAmount = useMemo(
    () => expenses.reduce((sum, expense) => sum + Number(expense.expense_amount || 0), 0),
    [expenses]
  );

  const groupedRows = useMemo(() => {
    if (groupBy === 'none') return [];
    const groups = new Map<string, { label: string; count: number; total: number }>();
    expenses.forEach((expense) => {
      let key = '';
      let label = '';
      if (groupBy === 'date') {
        key = expense.expense_date || 'No Date';
        label = key === 'No Date' ? key : formatDateDDMMYYYY(key);
      } else if (groupBy === 'expense_type') {
        key = expense.expense_type || 'Unknown Type';
        label = key;
      } else if (groupBy === 'lender') {
        key = expense.lender_name || 'Unknown Lender';
        label = key;
      } else if (groupBy === 'borrower') {
        key = expense.borrower_name || 'Unknown Borrower';
        label = key;
      } else {
        key = expense.payment_choices_type || 'UNKNOWN';
        label = key;
      }
      const prev = groups.get(key) || { label, count: 0, total: 0 };
      prev.count += 1;
      prev.total += Number(expense.expense_amount || 0);
      groups.set(key, prev);
    });
    return Array.from(groups.values()).sort((a, b) => b.total - a.total);
  }, [expenses, groupBy]);

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingExpense(null);
    setForm(getDefaultFormState());
  };

  const openCreateModal = () => {
    setEditingExpense(null);
    setForm(getDefaultFormState());
    setIsModalOpen(true);
  };

  const openEditModal = (expense: Expense) => {
    setEditingExpense(expense);
    setForm({
      expense_date: expense.expense_date || '',
      expense_type: expense.expense_type || '',
      lender_name: expense.lender_name || 'Manish Traders',
      borrower_name: expense.borrower_name || '',
      payment_choices_type: expense.payment_choices_type || 'CASH',
      expense_amount: String(expense.expense_amount ?? ''),
    });
    setIsModalOpen(true);
  };

  const refreshExpenses = async () => {
    await queryClient.invalidateQueries({ queryKey: ['expenses'] });
  };

  const createExpenseMutation = useMutation({
    mutationFn: (payload: ExpenseFormState) => posApi.expenses.create(payload),
    onSuccess: async () => {
      toast('Expense added successfully', 'success');
      closeModal();
      await refreshExpenses();
    },
    onError: (err: any) => {
      toast(err?.response?.data?.error || 'Failed to create expense', 'error');
    },
  });

  const updateExpenseMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ExpenseFormState }) => posApi.expenses.update(id, payload),
    onSuccess: async () => {
      toast('Expense updated successfully', 'success');
      closeModal();
      await refreshExpenses();
    },
    onError: (err: any) => {
      toast(err?.response?.data?.error || 'Failed to update expense', 'error');
    },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: (id: number) => posApi.expenses.delete(id),
    onSuccess: async () => {
      toast('Expense deleted successfully', 'success');
      await refreshExpenses();
    },
    onError: (err: any) => {
      toast(err?.response?.data?.error || 'Failed to delete expense', 'error');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.expense_date) return toast('Expense date is required', 'error');
    if (!form.expense_type.trim()) return toast('Expense type is required', 'error');
    if (!form.expense_amount.trim() || Number(form.expense_amount) <= 0) return toast('Enter a valid amount', 'error');

    const payload: ExpenseFormState = {
      ...form,
      expense_type: form.expense_type.trim(),
      lender_name: form.lender_name.trim() || 'Manish Traders',
      borrower_name: form.borrower_name.trim(),
      expense_amount: String(Number(form.expense_amount)),
    };

    if (editingExpense) {
      updateExpenseMutation.mutate({ id: editingExpense.id, payload });
    } else {
      createExpenseMutation.mutate(payload);
    }
  };

  if (!isUserLoaded) return <LoadingState message="Loading expenses..." />;
  if (isLoading) return <LoadingState message="Loading expenses..." />;
  if (canSeeExpenseListing && error) {
    return (
      <ErrorState
        message="Error loading expenses. Please try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        subtitle="Track and manage all expense entries"
        icon={Coins}
        action={
          <Button onClick={openCreateModal} className="gap-2">
            <Plus className="h-5 w-5" />
            Add Expense
          </Button>
        }
      />

      {canSeeExpenseListing ? (
        <>
          <Card>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search by type/lender/borrower"
                  className="pl-10"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
                <option value="">All Payment Types</option>
                <option value="CASH">Cash</option>
                <option value="ONLINE">Online</option>
              </Select>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Date Range</label>
                <DateRangeSelector
                  preset={datePreset}
                  value={{ startDate: dateFrom, endDate: dateTo }}
                  onChange={setListDateRange}
                />
              </div>
            </div>
            <div className="mt-4">
              <Select label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                <option value="none">No Grouping</option>
                <option value="date">Date</option>
                <option value="expense_type">Expense Type</option>
                <option value="lender">Lender</option>
                <option value="borrower">Borrower</option>
                <option value="payment_type">Payment Type</option>
              </Select>
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-gray-600">
                Entries: <span className="font-semibold text-gray-900">{expenses.length}</span>
              </div>
              <div className="text-sm text-gray-600">
                Total amount: <span className="font-semibold text-red-600">₹{formatNumber(totalAmount)}</span>
              </div>
            </div>
          </Card>

          {groupBy !== 'none' && (
            <Card>
              <div className="space-y-2">
                {groupedRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between text-base border-b border-gray-100 pb-3 last:border-0"
                  >
                    <span className="font-semibold text-gray-800">{row.label}</span>
                    <span className="text-gray-600 font-medium">{row.count} entries</span>
                    <span className="text-lg font-bold text-red-600">₹{formatNumber(row.total)}</span>
                  </div>
                ))}
                {groupedRows.length === 0 && (
                  <p className="text-base text-gray-500">No grouped data available for selected filters.</p>
                )}
              </div>
            </Card>
          )}

          {expenses.length === 0 ? (
            <Card>
              <EmptyState
                icon={Coins}
                title="No expenses found"
                message="Add your first expense entry to start tracking."
              />
            </Card>
          ) : (
            <Table headers={['Date', 'Expense Type', 'Lender', 'Borrower', 'Payment', 'Amount', 'Actions']}>
              {expenses.map((expense) => (
                <TableRow key={expense.id}>
                  <TableCell>{formatDateDDMMYYYY(expense.expense_date)}</TableCell>
                  <TableCell className="font-medium">{expense.expense_type}</TableCell>
                  <TableCell>{expense.lender_name}</TableCell>
                  <TableCell>{expense.borrower_name}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        expense.payment_choices_type === 'ONLINE'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {expense.payment_choices_type}
                    </span>
                  </TableCell>
                  <TableCell align="right" className="font-semibold text-red-600">
                    ₹{formatNumber(expense.expense_amount)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEditModal(expense)} className="gap-1.5">
                        <Pencil className="h-4 w-4" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => {
                          const shouldDelete = window.confirm('Delete this expense entry?');
                          if (shouldDelete) deleteExpenseMutation.mutate(expense.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </Table>
          )}
        </>
      ) : (
        <Card>
          <p className="text-sm text-gray-600">
            Expense listing is only available to users in the Super group. You can still add expenses.
          </p>
        </Card>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingExpense ? 'Edit Expense' : 'Add Expense'}
        size="md"
      >
        <form className="space-y-4" onSubmit={handleSubmit}>
          <DatePicker
            label="Expense Date *"
            value={form.expense_date}
            onChange={(date) => setForm((prev) => ({ ...prev, expense_date: date }))}
            required
          />
          <Input
            type="text"
            label="Expense Type *"
            placeholder="Example: Electricity bill"
            list="expense-type-suggestions"
            value={form.expense_type}
            onChange={(e) => setForm((prev) => ({ ...prev, expense_type: e.target.value }))}
            required
          />
          <datalist id="expense-type-suggestions">
            {expenseTypeSuggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
          <Input
            type="text"
            label="Lender Name"
            value={form.lender_name}
            onChange={(e) => setForm((prev) => ({ ...prev, lender_name: e.target.value }))}
          />
          <Input
            type="text"
            label="Borrower Name"
            list="borrower-name-suggestions"
            value={form.borrower_name}
            onChange={(e) => setForm((prev) => ({ ...prev, borrower_name: e.target.value }))}
          />
          <datalist id="borrower-name-suggestions">
            {borrowerSuggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
          <Select
            label="Payment Type *"
            value={form.payment_choices_type}
            onChange={(e) => setForm((prev) => ({ ...prev, payment_choices_type: e.target.value as PaymentMode }))}
            required
          >
            <option value="CASH">Cash</option>
            <option value="ONLINE">Online</option>
          </Select>
          <Input
            type="number"
            step="0.01"
            min="0"
            label="Expense Amount *"
            value={form.expense_amount}
            onChange={(e) => setForm((prev) => ({ ...prev, expense_amount: e.target.value }))}
            required
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createExpenseMutation.isPending || updateExpenseMutation.isPending}
            >
              {createExpenseMutation.isPending || updateExpenseMutation.isPending
                ? 'Saving...'
                : editingExpense
                  ? 'Update Expense'
                  : 'Create Expense'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
