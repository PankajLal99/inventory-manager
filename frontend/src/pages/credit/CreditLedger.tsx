import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  Eye,
  FileText,
  History,
  IndianRupee,
  Minus,
  Plus,
  Search,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { creditApi } from '../../lib/api';
import { dateStringWithCurrentTimeISO, formatAmountINR, toLocalDateString } from '../../lib/utils';
import { toast } from '../../lib/toast';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import LoadingState from '../../components/ui/LoadingState';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import Badge from '../../components/ui/Badge';
import DatePicker from '../../components/ui/DatePicker';
import Modal from '../../components/ui/Modal';
import {
  collectionStatusBadgeVariant,
  collectionStatusDotClass,
  collectionStatusLabel,
  collectionStatusRowClass,
  daysSincePaymentLabel,
  followUpDeltaClass,
  followUpDeltaLabel,
  formatLedgerDate,
  formatLedgerDateTime,
  collectionEventStyle,
  type CreditCollectionHistoryEvent,
  type CreditLedgerCustomerRow,
} from './creditLedgerUtils';

const thClass =
  'px-3 py-3 text-[11px] font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap';
const tdClass = 'px-3 py-2.5 align-middle';

function customerInitial(name?: string | null) {
  const n = (name || '').trim();
  return n ? n.charAt(0).toUpperCase() : '?';
}

type EntryType = 'credit' | 'debit';

type PickedCustomer = {
  credit_customer_id?: number | null;
  parties_customer_id?: number | null;
  name: string;
  phone?: string | null;
  source?: string;
  balance?: string | number;
};

export default function CreditLedger() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [withBalanceOnly, setWithBalanceOnly] = useState(
    searchParams.get('with_balance') === '1'
  );
  const [customerGroup, setCustomerGroup] = useState(searchParams.get('customer_group') || '');
  const [followUpFilter, setFollowUpFilter] = useState(searchParams.get('follow_up') || '');
  const [withHeartOnly, setWithHeartOnly] = useState(searchParams.get('with_heart') !== '0');

  const [historyCustomer, setHistoryCustomer] = useState<CreditLedgerCustomerRow | null>(null);
  const [draftReasons, setDraftReasons] = useState<Record<number, string>>({});
  const [savingIds, setSavingIds] = useState<Record<number, boolean>>({});

  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryType, setEntryType] = useState<EntryType>('debit');
  const [customerSearch, setCustomerSearch] = useState('');
  const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<PickedCustomer | null>(null);
  const [entryAmount, setEntryAmount] = useState('');
  const [entryDate, setEntryDate] = useState(() => toLocalDateString(new Date()));
  const [entryNotes, setEntryNotes] = useState('Opening Balance');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [creatingNewCustomer, setCreatingNewCustomer] = useState(false);

  const buildDetailPath = (customerId: number) => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (withBalanceOnly) params.set('with_balance', '1');
    if (customerGroup) params.set('customer_group', customerGroup);
    if (followUpFilter) params.set('follow_up', followUpFilter);
    if (!withHeartOnly) params.set('with_heart', '0');
    const query = params.toString();
    return query ? `/credit-ledger/${customerId}?${query}` : `/credit-ledger/${customerId}`;
  };

  useEffect(() => {
    const legacyCustomer = searchParams.get('customer');
    if (legacyCustomer && /^\d+$/.test(legacyCustomer)) {
      const params = new URLSearchParams(searchParams);
      params.delete('customer');
      const query = params.toString();
      navigate(
        query ? `/credit-ledger/${legacyCustomer}?${query}` : `/credit-ledger/${legacyCustomer}`,
        { replace: true }
      );
    }
  }, [searchParams, navigate]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedCustomerSearch(customerSearch), 250);
    return () => window.clearTimeout(t);
  }, [customerSearch]);

  const { data: customerGroups = [] } = useQuery({
    queryKey: ['credit-customer-groups'],
    queryFn: async () => {
      const response = await creditApi.customers.groups();
      return response.data || [];
    },
  });

  const { data: customerResults = [], isFetching: isCustomerSearching } = useQuery({
    queryKey: ['credit-customer-search', debouncedCustomerSearch],
    queryFn: async () => {
      const q = debouncedCustomerSearch.trim();
      if (q.length < 1) return [];
      const res = await creditApi.customers.search({ search: q });
      return (res.data || []) as PickedCustomer[];
    },
    enabled: showEntryForm && debouncedCustomerSearch.trim().length >= 1 && !selectedCustomer,
  });

  const queryKey = [
    'credit-ledger-customers',
    search,
    withBalanceOnly,
    customerGroup,
    withHeartOnly,
    followUpFilter,
  ] as const;

  const { data: customers = [], isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (search.trim()) params.search = search.trim();
      if (withBalanceOnly) params.with_balance = '1';
      if (customerGroup) params.customer_group = customerGroup;
      if (followUpFilter) params.follow_up = followUpFilter;
      params.with_heart = withHeartOnly ? '1' : '0';
      const res = await creditApi.ledger.byCustomer(params);
      return (res.data || []) as CreditLedgerCustomerRow[];
    },
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['credit-collection-history', historyCustomer?.id],
    queryFn: async () => {
      const res = await creditApi.ledger.collectionHistory(historyCustomer!.id, { limit: 50 });
      return (res.data?.results || []) as CreditCollectionHistoryEvent[];
    },
    enabled: !!historyCustomer?.id,
  });

  const patchCollection = useMutation({
    mutationFn: async ({
      customerId,
      data,
    }: {
      customerId: number;
      data: { collection_reason?: string; next_follow_up_date?: string | null };
    }) => {
      const res = await creditApi.ledger.updateCollection(customerId, data);
      return res.data as {
        id: number;
        collection_reason: string;
        next_follow_up_date: string | null;
        follow_up_delta_days: number | null;
      };
    },
    onMutate: ({ customerId }) => {
      setSavingIds((prev) => ({ ...prev, [customerId]: true }));
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey, (old: CreditLedgerCustomerRow[] | undefined) => {
        if (!old) return old;
        return old.map((row) =>
          row.id === updated.id
            ? {
                ...row,
                collection_reason: updated.collection_reason,
                next_follow_up_date: updated.next_follow_up_date,
                follow_up_delta_days: updated.follow_up_delta_days,
              }
            : row
        );
      });
      setDraftReasons((prev) => {
        const next = { ...prev };
        delete next[updated.id];
        return next;
      });
      if (historyCustomer?.id === updated.id) {
        queryClient.invalidateQueries({ queryKey: ['credit-collection-history', updated.id] });
      }
    },
    onSettled: (_data, _err, vars) => {
      setSavingIds((prev) => {
        const next = { ...prev };
        delete next[vars.customerId];
        return next;
      });
    },
  });

  const resetEntryForm = () => {
    setShowEntryForm(false);
    setSelectedCustomer(null);
    setCustomerSearch('');
    setDebouncedCustomerSearch('');
    setEntryAmount('');
    setEntryDate(toLocalDateString(new Date()));
    setEntryNotes('Opening Balance');
    setNewCustomerPhone('');
    setCreatingNewCustomer(false);
  };

  const openEntryForm = (type: EntryType) => {
    setEntryType(type);
    setSelectedCustomer(null);
    setCustomerSearch('');
    setDebouncedCustomerSearch('');
    setEntryAmount('');
    setEntryDate(toLocalDateString(new Date()));
    setEntryNotes('Opening Balance');
    setNewCustomerPhone('');
    setCreatingNewCustomer(false);
    setShowEntryForm(true);
  };

  const createEntryMutation = useMutation({
    mutationFn: async () => {
      let creditCustomerId = selectedCustomer?.credit_customer_id
        ? Number(selectedCustomer.credit_customer_id)
        : null;
      let partiesCustomerId = selectedCustomer?.parties_customer_id
        ? Number(selectedCustomer.parties_customer_id)
        : null;

      if (!creditCustomerId && !partiesCustomerId) {
        const rawName = (selectedCustomer?.name || customerSearch).trim();
        if (!rawName) throw new Error('Customer is required');
        const name = rawName.includes('❤') ? rawName : `${rawName} ❤`;
        const ensured = await creditApi.customers.ensure({
          name,
          phone: (newCustomerPhone || selectedCustomer?.phone || '').trim() || undefined,
        });
        creditCustomerId = ensured.data.id;
      }

      const amount = parseFloat(entryAmount || '0');
      if (!(amount > 0)) throw new Error('Amount must be greater than 0');

      const payload: Parameters<typeof creditApi.ledger.createEntry>[0] = {
        entry_type: entryType,
        amount,
        description: entryNotes.trim() || 'Opening Balance',
        created_at: entryDate ? dateStringWithCurrentTimeISO(entryDate) : undefined,
      };
      if (creditCustomerId) payload.credit_customer_id = creditCustomerId;
      else if (partiesCustomerId) payload.parties_customer_id = partiesCustomerId;

      // Backend requires a method for credit entries; opening balance is not a till payment.
      if (entryType === 'credit') {
        payload.payment_method = 'cash';
      }

      const res = await creditApi.ledger.createEntry(payload);
      return res.data as { customer?: number; credit_customer_id?: number };
    },
    onSuccess: (data) => {
      const customerId = Number(
        (data as any)?.customer || (data as any)?.credit_customer_id || selectedCustomer?.credit_customer_id
      );
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-customers'] });
      resetEntryForm();
      toast(
        entryType === 'debit' ? 'Opening debit recorded' : 'Opening credit recorded',
        'success'
      );
      if (customerId) navigate(buildDetailPath(customerId));
    },
    onError: (err: any) => {
      toast(
        err?.response?.data?.detail || err?.message || 'Failed to create ledger entry',
        'error'
      );
    },
  });

  const summary = useMemo(() => {
    let totalReceivable = 0;
    let overdueFollowUps = 0;
    let atRisk = 0;
    for (const row of customers) {
      const bal = parseFloat(String(row.balance || 0));
      if (bal > 0) totalReceivable += bal;
      if ((row.follow_up_delta_days ?? null) != null && row.follow_up_delta_days! < 0) {
        overdueFollowUps += 1;
      }
      if (row.collection_status === 'warning' || row.collection_status === 'danger') {
        atRisk += 1;
      }
    }
    return { numAccounts: customers.length, totalReceivable, overdueFollowUps, atRisk };
  }, [customers]);

  const activeFilterCount = [
    search.trim(),
    withBalanceOnly,
    customerGroup,
    followUpFilter,
    !withHeartOnly,
  ].filter(Boolean).length;

  const hasActiveFilters = activeFilterCount > 0;

  const syncParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (value == null || value === '') next.delete(key);
      else next.set(key, value);
    });
    setSearchParams(next, { replace: true });
  };

  const handleResetFilters = () => {
    setSearch('');
    setWithBalanceOnly(false);
    setCustomerGroup('');
    setFollowUpFilter('');
    setWithHeartOnly(true);
    setSearchParams({});
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    syncParams({ search: value.trim() || null });
  };

  const setHeartFilter = (heartOnly: boolean) => {
    setWithHeartOnly(heartOnly);
    syncParams({ with_heart: heartOnly ? null : '0' });
  };

  const reasonValue = (row: CreditLedgerCustomerRow) =>
    draftReasons[row.id] !== undefined ? draftReasons[row.id] : row.collection_reason || '';

  const saveReason = (row: CreditLedgerCustomerRow) => {
    const next = (
      draftReasons[row.id] !== undefined ? draftReasons[row.id] : row.collection_reason || ''
    ).trim();
    const prev = (row.collection_reason || '').trim();
    if (next === prev) {
      setDraftReasons((d) => {
        const copy = { ...d };
        delete copy[row.id];
        return copy;
      });
      return;
    }
    patchCollection.mutate({
      customerId: row.id,
      data: { collection_reason: next },
    });
  };

  const saveFollowUp = (row: CreditLedgerCustomerRow, date: string) => {
    const next = date || null;
    const prev = row.next_follow_up_date || null;
    if (next === prev) return;
    patchCollection.mutate({
      customerId: row.id,
      data: { next_follow_up_date: next },
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-stone-900 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-amber-600" />
            Credit Ledger
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            Outstanding balances, reminders &amp; collection follow-ups
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => openEntryForm('credit')}
            className="bg-emerald-600 hover:bg-emerald-700 shadow-sm"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Credit (+)
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => openEntryForm('debit')}
            className="border-red-300 text-red-600 hover:bg-red-50"
          >
            <Minus className="h-3.5 w-3.5 mr-1" />
            Debit (−)
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/credit-invoices')}
            className="border-stone-300 text-stone-700 hover:bg-stone-50"
          >
            <FileText className="h-3.5 w-3.5 mr-1" />
            Invoices
          </Button>
          <Button
            size="sm"
            onClick={() => navigate('/pos-credit')}
            className="bg-amber-600 hover:bg-amber-700 shadow-sm"
          >
            POS Credit
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
                Customers
              </p>
              <p className="mt-1.5 text-2xl font-bold tabular-nums text-stone-900 leading-none">
                {summary.numAccounts}
              </p>
              <p className="mt-1.5 text-xs text-stone-400">
                {hasActiveFilters ? 'Matching filters' : 'In current view'}
              </p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100">
              <Users className="h-5 w-5 text-stone-600" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800/80">
                Receivable
              </p>
              <p className="mt-1.5 text-2xl font-bold tabular-nums text-amber-900 leading-none">
                ₹{formatAmountINR(summary.totalReceivable)}
              </p>
              <p className="mt-1.5 text-xs text-amber-700/70">Outstanding balance</p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-600 text-white shadow-sm">
              <IndianRupee className="h-5 w-5" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
                Follow-up overdue
              </p>
              <p
                className={`mt-1.5 text-2xl font-bold tabular-nums leading-none ${
                  summary.overdueFollowUps > 0 ? 'text-red-700' : 'text-stone-900'
                }`}
              >
                {summary.overdueFollowUps}
              </p>
              <p className="mt-1.5 text-xs text-stone-400">Past due dates</p>
            </div>
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                summary.overdueFollowUps > 0 ? 'bg-red-100' : 'bg-stone-100'
              }`}
            >
              <CalendarClock
                className={`h-5 w-5 ${
                  summary.overdueFollowUps > 0 ? 'text-red-600' : 'text-stone-600'
                }`}
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
                At risk
              </p>
              <p
                className={`mt-1.5 text-2xl font-bold tabular-nums leading-none ${
                  summary.atRisk > 0 ? 'text-amber-800' : 'text-stone-900'
                }`}
              >
                {summary.atRisk}
              </p>
              <p className="mt-1.5 text-xs text-stone-400">No pay 5+ days</p>
            </div>
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                summary.atRisk > 0 ? 'bg-amber-100' : 'bg-stone-100'
              }`}
            >
              <AlertTriangle
                className={`h-5 w-5 ${summary.atRisk > 0 ? 'text-amber-700' : 'text-stone-600'}`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Filters panel */}
      <div className="rounded-xl border border-stone-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-3 border-b border-stone-100 bg-stone-50/80">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-stone-500">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-600">
              Filters
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${collectionStatusDotClass('good')}`} />
              On time
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${collectionStatusDotClass('warning')}`} />
              No pay 5+
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${collectionStatusDotClass('danger')}`} />
              No pay 10+
            </span>
          </div>
          {hasActiveFilters ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetFilters}
              className="h-8 text-xs text-stone-500 border-stone-200"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Reset
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2.5 p-4">
          <div
            className="inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 p-0.5"
            role="group"
            aria-label="Customer heart filter"
          >
            <button
              type="button"
              onClick={() => setHeartFilter(true)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                withHeartOnly
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-amber-800 hover:bg-amber-100'
              }`}
            >
              ❤ Heart
            </button>
            <button
              type="button"
              onClick={() => setHeartFilter(false)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                !withHeartOnly
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-amber-800 hover:bg-amber-100'
              }`}
            >
              All
            </button>
          </div>

          <div className="relative w-full sm:w-auto sm:min-w-[220px] sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400 pointer-events-none" />
            <Input
              placeholder="Search name, phone…"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 py-2 h-9 text-sm border-stone-300 rounded-lg"
            />
          </div>

          <Select
            value={followUpFilter}
            onChange={(e) => {
              const value = e.target.value;
              setFollowUpFilter(value);
              syncParams({ follow_up: value || null });
            }}
            className="!py-2 !pr-8 text-sm min-w-[150px] rounded-lg border-stone-300"
          >
            <option value="">All follow-ups</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="upcoming">Upcoming</option>
            <option value="none">No date set</option>
            <option value="set">Has date</option>
          </Select>

          <Select
            value={customerGroup}
            onChange={(e) => {
              const value = e.target.value;
              setCustomerGroup(value);
              syncParams({ customer_group: value || null });
            }}
            className="!py-2 !pr-8 text-sm min-w-[140px] rounded-lg border-stone-300"
          >
            <option value="">All groups</option>
            {customerGroups.map((group: { id: number; name: string }) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>

          <label className="inline-flex items-center gap-2 text-sm text-stone-700 cursor-pointer whitespace-nowrap rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 hover:bg-stone-100">
            <input
              type="checkbox"
              checked={withBalanceOnly}
              onChange={(e) => {
                setWithBalanceOnly(e.target.checked);
                syncParams({ with_balance: e.target.checked ? '1' : null });
              }}
              className="rounded border-stone-300 text-amber-600 focus:ring-amber-500"
            />
            Outstanding only
          </label>
        </div>
      </div>

      {/* Content */}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <ErrorState message="Failed to load credit accounts" onRetry={() => refetch()} />
        </div>
      ) : isLoading ? (
        <div className="rounded-xl border border-stone-200 bg-white p-10 shadow-sm">
          <LoadingState />
        </div>
      ) : customers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/40 p-8 shadow-sm">
          <EmptyState
            icon={Users}
            title="No credit accounts found"
            message={
              hasActiveFilters
                ? 'Try adjusting your filters.'
                : 'Add an opening balance with Credit (+) or Debit (−), or create a credit sale.'
            }
          />
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden xl:block overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1280px] border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th className={`${thClass} text-left w-10`}>#</th>
                    <th className={`${thClass} text-left min-w-[160px]`}>Customer</th>
                    <th className={`${thClass} text-left`}>Group</th>
                    <th className={`${thClass} text-right`}>Sales</th>
                    <th className={`${thClass} text-right`}>Received</th>
                    <th className={`${thClass} text-right`}>Returns</th>
                    <th className={`${thClass} text-right`}>Outstanding</th>
                    <th className={`${thClass} text-left min-w-[200px]`}>Reason</th>
                    <th className={`${thClass} text-left min-w-[148px]`}>Next follow-up</th>
                    <th className={`${thClass} text-left`}>Last pay</th>
                    <th className={`${thClass} text-left`}>Last sale</th>
                    <th className={`${thClass} text-left min-w-[120px]`}>Status</th>
                    <th className={`${thClass} text-center w-12`} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {customers.map((row, index) => {
                    const balance = parseFloat(String(row.balance || 0));
                    const status = row.collection_status || 'good';
                    const sales = parseFloat(String(row.total_debit || 0));
                    const received = parseFloat(String(row.total_received || 0));
                    const returns = parseFloat(String(row.total_returns || 0));
                    const isSaving = !!savingIds[row.id];
                    return (
                      <tr key={row.id} className={collectionStatusRowClass(status)}>
                        <td className={`${tdClass} text-stone-400 tabular-nums text-xs`}>
                          {index + 1}
                        </td>
                        <td className={tdClass}>
                          <button
                            type="button"
                            onClick={() => navigate(buildDetailPath(row.id))}
                            className="flex items-center gap-2.5 text-left group min-w-0"
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800 ring-1 ring-amber-200">
                              {customerInitial(row.name)}
                            </span>
                            <span className="min-w-0">
                              <span className="block font-semibold text-stone-900 group-hover:text-amber-800 truncate leading-snug">
                                {row.name || 'Anonymous'}
                              </span>
                              {row.phone ? (
                                <span className="block text-[11px] text-stone-400 tabular-nums">
                                  {row.phone}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </td>
                        <td className={`${tdClass} text-stone-600 whitespace-nowrap text-xs`}>
                          {row.customer_group_name || (
                            <span className="text-stone-300">—</span>
                          )}
                        </td>
                        <td className={`${tdClass} text-right tabular-nums text-stone-700 whitespace-nowrap`}>
                          {sales ? (
                            `₹${formatAmountINR(sales)}`
                          ) : (
                            <span className="text-stone-300">—</span>
                          )}
                        </td>
                        <td className={`${tdClass} text-right tabular-nums text-emerald-700 whitespace-nowrap`}>
                          {received ? (
                            `₹${formatAmountINR(received)}`
                          ) : (
                            <span className="text-stone-300">—</span>
                          )}
                        </td>
                        <td className={`${tdClass} text-right tabular-nums text-blue-700 whitespace-nowrap`}>
                          {returns ? (
                            `₹${formatAmountINR(returns)}`
                          ) : (
                            <span className="text-stone-300">—</span>
                          )}
                        </td>
                        <td className={`${tdClass} text-right whitespace-nowrap`}>
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 tabular-nums font-semibold ${
                              balance > 0
                                ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-200'
                                : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
                            }`}
                          >
                            ₹{formatAmountINR(balance)}
                          </span>
                        </td>
                        <td className={tdClass}>
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={reasonValue(row)}
                              disabled={isSaving}
                              placeholder="Add note…"
                              onChange={(e) =>
                                setDraftReasons((prev) => ({ ...prev, [row.id]: e.target.value }))
                              }
                              onBlur={() => saveReason(row)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              }}
                              className="w-full min-w-0 h-8 text-xs border border-stone-200 rounded-lg px-2 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-60"
                            />
                            <button
                              type="button"
                              title="History"
                              onClick={() => setHistoryCustomer(row)}
                              className="flex-shrink-0 p-1.5 rounded-lg text-stone-400 hover:text-amber-800 hover:bg-amber-50"
                            >
                              <History className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className={tdClass}>
                          <div className="w-[138px]">
                            <DatePicker
                              value={row.next_follow_up_date || ''}
                              onChange={(date) => saveFollowUp(row, date)}
                              className="!text-xs !py-1.5 !h-8"
                            />
                          </div>
                          <p
                            className={`mt-0.5 text-[10px] leading-tight ${followUpDeltaClass(
                              row.follow_up_delta_days
                            )}`}
                          >
                            {followUpDeltaLabel(row.follow_up_delta_days)}
                          </p>
                        </td>
                        <td className={`${tdClass} text-xs text-stone-600 whitespace-nowrap tabular-nums`}>
                          {formatLedgerDate(row.last_payment_at)}
                        </td>
                        <td className={`${tdClass} text-xs text-stone-600 whitespace-nowrap tabular-nums`}>
                          {formatLedgerDate(row.last_sale_at)}
                        </td>
                        <td className={tdClass}>
                          <div className="space-y-0.5">
                            <Badge
                              variant={collectionStatusBadgeVariant(status)}
                              className="!px-1.5 !py-0.5 !text-[10px]"
                            >
                              {collectionStatusLabel(status)}
                            </Badge>
                            <p className="text-[10px] text-stone-500 leading-tight">
                              {daysSincePaymentLabel(row.days_since_last_payment, balance)}
                            </p>
                          </div>
                        </td>
                        <td className={`${tdClass} text-center`}>
                          <button
                            type="button"
                            onClick={() => navigate(buildDetailPath(row.id))}
                            className="inline-flex p-1.5 rounded-lg text-stone-400 hover:text-amber-800 hover:bg-amber-50"
                            title="View ledger"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tablet / mobile cards */}
          <div className="xl:hidden space-y-3">
            {customers.map((row, index) => {
              const balance = parseFloat(String(row.balance || 0));
              const status = row.collection_status || 'good';
              const sales = parseFloat(String(row.total_debit || 0));
              const received = parseFloat(String(row.total_received || 0));
              const returns = parseFloat(String(row.total_returns || 0));
              const isSaving = !!savingIds[row.id];
              return (
                <div
                  key={row.id}
                  className={`rounded-xl border border-stone-200 p-3.5 shadow-sm ${collectionStatusRowClass(
                    status
                  )}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => navigate(buildDetailPath(row.id))}
                      className="flex items-center gap-3 min-w-0 text-left group"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-600 text-sm font-bold text-white shadow-sm ring-2 ring-amber-200">
                        {customerInitial(row.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-[10px] text-stone-400 tabular-nums">#{index + 1}</span>
                          <span className="font-semibold text-stone-900 group-hover:text-amber-800 truncate">
                            {row.name || 'Anonymous'}
                          </span>
                        </span>
                        <span className="block text-xs text-stone-500 mt-0.5 truncate">
                          {row.customer_group_name || 'No group'}
                          {row.phone ? ` · ${row.phone}` : ''}
                        </span>
                      </span>
                    </button>
                    <div className="text-right flex-shrink-0">
                      <div
                        className={`inline-flex rounded-lg px-2.5 py-1.5 shadow-sm ${
                          balance > 0
                            ? 'bg-amber-600 text-white'
                            : 'bg-emerald-600 text-white'
                        }`}
                      >
                        <div>
                          <p className="text-[9px] font-semibold uppercase tracking-wide opacity-90">
                            Ledger
                          </p>
                          <p className="text-sm font-bold tabular-nums leading-tight">
                            ₹{formatAmountINR(balance)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-1.5 flex justify-end">
                        <Badge
                          variant={collectionStatusBadgeVariant(status)}
                          className="!px-1.5 !py-0.5 !text-[10px]"
                        >
                          {collectionStatusLabel(status)}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg bg-stone-50 border border-stone-100 px-2.5 py-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-stone-400">Sales</p>
                      <p className="font-semibold tabular-nums text-stone-800">
                        ₹{formatAmountINR(sales)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-stone-50 border border-stone-100 px-2.5 py-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-stone-400">Received</p>
                      <p className="font-semibold tabular-nums text-emerald-800">
                        ₹{formatAmountINR(received)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-stone-50 border border-stone-100 px-2.5 py-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-stone-400">Returns</p>
                      <p className="font-semibold tabular-nums text-blue-800">
                        ₹{formatAmountINR(returns)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-stone-50 border border-stone-100 px-2.5 py-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-stone-400">Last pay</p>
                      <p className="font-medium tabular-nums text-stone-700">
                        {formatLedgerDate(row.last_payment_at)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-stone-50 border border-stone-100 px-2.5 py-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-stone-400">Last sale</p>
                      <p className="font-medium tabular-nums text-stone-700">
                        {formatLedgerDate(row.last_sale_at)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-stone-500">
                    {daysSincePaymentLabel(row.days_since_last_payment, balance)}
                    {' · '}
                    <span className={followUpDeltaClass(row.follow_up_delta_days)}>
                      {followUpDeltaLabel(row.follow_up_delta_days)}
                    </span>
                  </p>

                  <div className="mt-3 pt-3 border-t border-stone-100 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={reasonValue(row)}
                        disabled={isSaving}
                        placeholder="Add note…"
                        onChange={(e) =>
                          setDraftReasons((prev) => ({ ...prev, [row.id]: e.target.value }))
                        }
                        onBlur={() => saveReason(row)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        className="w-full h-8 text-xs border border-stone-200 rounded-lg px-2 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                      <button
                        type="button"
                        title="History"
                        onClick={() => setHistoryCustomer(row)}
                        className="p-1.5 rounded-lg text-stone-400 hover:text-amber-800 hover:bg-amber-50"
                      >
                        <History className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(buildDetailPath(row.id))}
                        className="p-1.5 rounded-lg text-stone-400 hover:text-amber-800 hover:bg-amber-50"
                        title="View"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <DatePicker
                      value={row.next_follow_up_date || ''}
                      onChange={(date) => saveFollowUp(row, date)}
                      className="!text-xs !py-1.5 !h-8"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-stone-500 px-0.5">
            Showing <span className="font-semibold text-stone-700">{customers.length}</span> accounts
            {hasActiveFilters ? (
              <span className="text-amber-700 font-medium"> · filtered</span>
            ) : null}
          </p>
        </>
      )}

      <Modal
        isOpen={showEntryForm}
        onClose={resetEntryForm}
        title={entryType === 'credit' ? 'Opening Credit (+)' : 'Opening Debit (−)'}
        size="md"
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!selectedCustomer && !creatingNewCustomer) {
              toast('Select or create a customer', 'error');
              return;
            }
            createEntryMutation.mutate();
          }}
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Customer</label>
            {selectedCustomer ? (
              <div className="flex items-start justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 shadow-sm">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-600 text-sm font-bold text-white">
                    {customerInitial(selectedCustomer.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-stone-900 truncate">
                      {selectedCustomer.name}
                    </p>
                    {selectedCustomer.phone ? (
                      <p className="text-xs text-stone-500">{selectedCustomer.phone}</p>
                    ) : null}
                    {creatingNewCustomer ? (
                      <p className="text-[11px] text-emerald-700 mt-0.5">New credit customer</p>
                    ) : selectedCustomer.source ? (
                      <p className="text-[11px] text-stone-400 mt-0.5 uppercase">
                        {selectedCustomer.source}
                      </p>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomer(null);
                    setCreatingNewCustomer(false);
                    setNewCustomerPhone('');
                    setCustomerSearch('');
                  }}
                  className="text-xs text-red-600 hover:underline flex-shrink-0"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                <Input
                  placeholder="Search name or phone…"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="pl-8"
                  autoFocus
                />
                {customerSearch.trim() ? (
                  <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                    {isCustomerSearching ? (
                      <p className="px-3 py-2 text-xs text-gray-500">Searching…</p>
                    ) : (
                      <>
                        {customerResults.map((c) => (
                          <button
                            key={`${c.source || 'x'}-${c.credit_customer_id || c.parties_customer_id}-${c.name}`}
                            type="button"
                            onClick={() => {
                              setSelectedCustomer(c);
                              setCreatingNewCustomer(false);
                              setCustomerSearch('');
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-0"
                          >
                            <div className="text-sm font-medium text-gray-900">{c.name}</div>
                            <div className="text-xs text-gray-500 flex gap-2">
                              {c.phone ? <span>{c.phone}</span> : null}
                              {c.balance != null ? (
                                <span>Bal ₹{formatAmountINR(c.balance)}</span>
                              ) : null}
                            </div>
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            const name = customerSearch.trim();
                            setSelectedCustomer({ name, phone: newCustomerPhone || null });
                            setCreatingNewCustomer(true);
                            setCustomerSearch('');
                          }}
                          className="w-full text-left px-3 py-2.5 hover:bg-green-50 border-t border-gray-200 bg-green-50/40 flex items-center gap-2"
                        >
                          <UserPlus className="h-4 w-4 text-green-600 flex-shrink-0" />
                          <div>
                            <div className="text-sm font-medium text-green-700">
                              Add &quot;{customerSearch.trim()}&quot;
                            </div>
                            <div className="text-[11px] text-green-600">Create new credit customer</div>
                          </div>
                        </button>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            )}
            {creatingNewCustomer ? (
              <div className="mt-2">
                <Input
                  label="Phone (optional)"
                  value={newCustomerPhone}
                  onChange={(e) => setNewCustomerPhone(e.target.value)}
                  placeholder="Phone number"
                />
              </div>
            ) : null}
          </div>

          <p className="text-xs text-stone-500 rounded-xl bg-stone-50 border border-stone-100 px-3 py-2.5">
            {entryType === 'debit'
              ? 'Debit increases outstanding — use when the customer already owes you (opening receivable).'
              : 'Credit decreases outstanding — use for advance / overpayment opening balance.'}
          </p>

          <Input
            label="Amount"
            type="number"
            min="0"
            step="0.01"
            value={entryAmount}
            onChange={(e) => setEntryAmount(e.target.value)}
            required
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Date</label>
            <DatePicker value={entryDate} onChange={setEntryDate} required />
          </div>

          <Input
            label="Description"
            value={entryNotes}
            onChange={(e) => setEntryNotes(e.target.value)}
            placeholder="Opening Balance"
          />

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={resetEntryForm}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                createEntryMutation.isPending ||
                !selectedCustomer ||
                !(parseFloat(entryAmount) > 0)
              }
              className={
                entryType === 'credit'
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-red-600 hover:bg-red-700'
              }
            >
              {createEntryMutation.isPending
                ? 'Saving…'
                : entryType === 'credit'
                  ? 'Create Credit'
                  : 'Create Debit'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!historyCustomer}
        onClose={() => setHistoryCustomer(null)}
        title={
          historyCustomer
            ? `History — ${historyCustomer.name || 'Customer'}`
            : 'Collection history'
        }
        size="md"
      >
        {historyLoading ? (
          <LoadingState />
        ) : !historyData || historyData.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 py-10 text-center">
            <History className="mx-auto h-8 w-8 text-amber-600 mb-2" />
            <p className="text-sm font-medium text-stone-800">No history yet</p>
            <p className="text-sm text-stone-600 mt-1">
              Reasons and follow-up changes will show up here.
            </p>
          </div>
        ) : (
          <ol className="relative ml-2 border-l-2 border-amber-200 pl-0">
            {historyData.map((ev, idx) => {
              const style = collectionEventStyle(ev.event_type);
              const showNote =
                !!ev.note &&
                ev.note.trim().toLowerCase() !== (ev.event_type_label || '').trim().toLowerCase();
              const showFollowUp = !!(ev.follow_up_date || ev.previous_follow_up_date);
              return (
                <li key={ev.id} className={`relative pl-6 ${idx === historyData.length - 1 ? 'pb-1' : 'pb-6'}`}>
                  <span
                    className={`absolute -left-[9px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white ${style.dot}`}
                    aria-hidden
                  />
                  <div className="rounded-xl border border-stone-200 bg-white px-3.5 py-3 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${style.badge}`}
                      >
                        {ev.event_type_label}
                      </span>
                      <time className="text-xs font-medium tabular-nums text-stone-700">
                        {formatLedgerDateTime(ev.created_at)}
                      </time>
                    </div>

                    {showNote ? (
                      <p className="mt-2 text-sm font-medium text-stone-800 leading-snug">{ev.note}</p>
                    ) : null}

                    {ev.reason ? (
                      <div className="mt-2 rounded-lg bg-amber-50 border border-amber-100 px-2.5 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                          Reason
                        </p>
                        <p className="mt-0.5 text-sm text-stone-900 leading-snug">{ev.reason}</p>
                      </div>
                    ) : null}

                    {showFollowUp ? (
                      <p className="mt-2 text-sm text-stone-800">
                        <span className="font-semibold text-stone-900">Follow-up</span>
                        <span className="mx-1.5 text-stone-400">·</span>
                        {ev.previous_follow_up_date ? (
                          <>
                            <span className="text-stone-500 line-through decoration-stone-400">
                              {formatLedgerDate(ev.previous_follow_up_date)}
                            </span>
                            <span className="mx-1.5 text-amber-700 font-semibold">→</span>
                          </>
                        ) : null}
                        <span className="font-semibold text-amber-900">
                          {formatLedgerDate(ev.follow_up_date)}
                        </span>
                      </p>
                    ) : null}

                    {ev.created_by_name ? (
                      <p className="mt-2 text-xs font-medium text-stone-600">
                        by <span className="text-stone-800">{ev.created_by_name}</span>
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Modal>
    </div>
  );
}
