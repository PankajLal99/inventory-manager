import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  FileText,
  Filter,
  Search,
  TrendingDown,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { creditApi } from '../../lib/api';
import { formatAmountINR } from '../../lib/utils';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import LoadingState from '../../components/ui/LoadingState';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import Badge from '../../components/ui/Badge';
import {
  collectionStatusBadgeVariant,
  collectionStatusDotClass,
  collectionStatusLabel,
  collectionStatusRowClass,
  formatCustomerWithGroup,
  type CreditLedgerCustomerRow,
} from './creditLedgerUtils';

export default function CreditLedger() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [showFilters, setShowFilters] = useState(false);
  const [withBalanceOnly, setWithBalanceOnly] = useState(
    searchParams.get('with_balance') === '1'
  );
  const [customerGroup, setCustomerGroup] = useState(searchParams.get('customer_group') || '');
  // Default: heart-marked customers only (with_heart omitted or '1')
  const [withHeartOnly, setWithHeartOnly] = useState(
    searchParams.get('with_heart') !== '0'
  );

  const buildDetailPath = (customerId: number) => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (withBalanceOnly) params.set('with_balance', '1');
    if (customerGroup) params.set('customer_group', customerGroup);
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

  const { data: customerGroups = [] } = useQuery({
    queryKey: ['credit-customer-groups'],
    queryFn: async () => {
      const response = await creditApi.customers.groups();
      return response.data || [];
    },
  });

  const { data: customers = [], isLoading, error, refetch } = useQuery({
    queryKey: ['credit-ledger-customers', search, withBalanceOnly, customerGroup, withHeartOnly],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (search.trim()) params.search = search.trim();
      if (withBalanceOnly) params.with_balance = '1';
      if (customerGroup) params.customer_group = customerGroup;
      params.with_heart = withHeartOnly ? '1' : '0';
      const res = await creditApi.ledger.byCustomer(params);
      return (res.data || []) as CreditLedgerCustomerRow[];
    },
  });

  const summary = useMemo(() => {
    let totalDebit = 0;
    let totalCredit = 0;
    let accountsWithBalance = 0;
    for (const row of customers) {
      totalDebit += parseFloat(String(row.total_debit || 0));
      totalCredit += parseFloat(String(row.total_credit || 0));
      if (parseFloat(String(row.balance || 0)) > 0) accountsWithBalance += 1;
    }
    return {
      totalDebit,
      totalCredit,
      numAccounts: customers.length,
      accountsWithBalance,
      netAmount: totalDebit - totalCredit,
    };
  }, [customers]);

  const hasActiveFilters = !!(search.trim() || withBalanceOnly || customerGroup || !withHeartOnly);

  const handleResetFilters = () => {
    setSearch('');
    setWithBalanceOnly(false);
    setCustomerGroup('');
    setWithHeartOnly(true);
    setSearchParams({});
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    const next = new URLSearchParams(searchParams);
    if (value.trim()) next.set('search', value.trim());
    else next.delete('search');
    setSearchParams(next, { replace: true });
  };

  const setHeartFilter = (heartOnly: boolean) => {
    setWithHeartOnly(heartOnly);
    const next = new URLSearchParams(searchParams);
    if (heartOnly) next.delete('with_heart');
    else next.set('with_heart', '0');
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Credit Ledger</h1>
          <p className="text-sm text-gray-600 mt-1">Accounts and outstanding balances</p>
        </div>
        <Button variant="secondary" onClick={() => navigate('/pos-credit')}>
          POS Credit
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm">
        <span className="text-gray-600 font-medium">Collection status:</span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${collectionStatusDotClass('good')}`} />
          Green — paying on time
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${collectionStatusDotClass('warning')}`} />
          Yellow — no payment 5+ days
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${collectionStatusDotClass('danger')}`} />
          Red — no payment 10+ days
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Sales (Debit)</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                ₹{formatAmountINR(summary.totalDebit)}
              </p>
            </div>
            <TrendingUp className="h-12 w-12 text-red-500" />
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Received (Credit)</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                ₹{formatAmountINR(summary.totalCredit)}
              </p>
            </div>
            <TrendingDown className="h-12 w-12 text-green-600" />
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Accounts</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{summary.numAccounts}</p>
              <p className="text-xs text-gray-500 mt-1">
                {summary.accountsWithBalance} with balance due
              </p>
            </div>
            <Users className="h-12 w-12 text-blue-600" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-gray-500" />
            Ledger Accounts
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 p-0.5"
              role="group"
              aria-label="Customer heart filter"
            >
              <button
                type="button"
                onClick={() => setHeartFilter(true)}
                className={`px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-md transition-colors ${
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
                className={`px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-md transition-colors ${
                  !withHeartOnly
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-amber-800 hover:bg-amber-100'
                }`}
              >
                All
              </button>
            </div>
            <div className="relative flex-1 min-w-[140px] max-w-[240px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <Input
                placeholder="Search name, phone…"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9 py-1.5 h-9 text-sm border-gray-300 rounded-lg"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-1.5 text-xs sm:text-sm"
            >
              <Filter className="h-4 w-4" />
              Filters
              {hasActiveFilters ? (
                <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                  {[search.trim(), withBalanceOnly, customerGroup, !withHeartOnly].filter(Boolean).length}
                </span>
              ) : null}
            </Button>
          </div>
        </div>

        {showFilters ? (
          <div className="border-t pt-4 mb-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label="Customer Group"
                value={customerGroup}
                onChange={(e) => {
                  const value = e.target.value;
                  setCustomerGroup(value);
                  const next = new URLSearchParams(searchParams);
                  if (value) next.set('customer_group', value);
                  else next.delete('customer_group');
                  setSearchParams(next, { replace: true });
                }}
              >
                <option value="">All Groups</option>
                {customerGroups.map((group: any) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={withBalanceOnly}
                onChange={(e) => {
                  setWithBalanceOnly(e.target.checked);
                  const next = new URLSearchParams(searchParams);
                  if (e.target.checked) next.set('with_balance', '1');
                  else next.delete('with_balance');
                  setSearchParams(next, { replace: true });
                }}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Show only accounts with outstanding balance
            </label>
            <div className="flex justify-end">
              <Button variant="outline" onClick={handleResetFilters} className="flex items-center gap-2">
                <X className="h-4 w-4" />
                Reset Filters
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <ErrorState message="Failed to load credit accounts" onRetry={() => refetch()} />
        ) : isLoading ? (
          <LoadingState />
        ) : customers.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No credit accounts found"
            message={hasActiveFilters ? 'Try adjusting your filters.' : 'Create a credit sale to add accounts.'}
          />
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                      Customer
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                      Group
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                      Entries
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                      Latest
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">
                      Balance Due
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {customers.map((row) => {
                    const balance = parseFloat(String(row.balance || 0));
                    const status = row.collection_status || 'good';
                    return (
                      <tr
                        key={row.id}
                        className={`transition-colors ${collectionStatusRowClass(status)}`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-blue-600 flex-shrink-0" />
                            <button
                              type="button"
                              onClick={() => navigate(buildDetailPath(row.id))}
                              className="text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline text-left"
                            >
                              {formatCustomerWithGroup(row.name, row.customer_group_name)}
                            </button>
                            {row.phone ? (
                              <span className="text-xs text-gray-500">({row.phone})</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {row.customer_group_name || (
                            <span className="text-gray-400 italic">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Badge variant={collectionStatusBadgeVariant(status)}>
                            {collectionStatusLabel(status)}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {row.entry_count || 0}{' '}
                          {(row.entry_count || 0) === 1 ? 'entry' : 'entries'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700 max-w-xs truncate">
                          {row.latest_description || (
                            <span className="text-gray-400 italic">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <span
                            className={`inline-flex items-center px-3 py-1.5 rounded text-sm font-bold ${
                              balance > 0
                                ? 'bg-amber-50 border border-amber-200 text-amber-800'
                                : 'bg-green-50 border border-green-200 text-green-700'
                            }`}
                          >
                            ₹{formatAmountINR(balance)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                  <tr>
                    <td colSpan={5} className="px-6 py-4 text-right text-sm font-bold text-gray-700">
                      Totals:
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="space-y-1 text-sm">
                        <div>
                          <span className="text-gray-600">Sales: </span>
                          <span className="font-bold text-red-700">
                            ₹{formatAmountINR(summary.totalDebit)}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-600">Received: </span>
                          <span className="font-bold text-green-700">
                            ₹{formatAmountINR(summary.totalCredit)}
                          </span>
                        </div>
                        <div className="pt-1 border-t border-gray-300">
                          <span className="text-gray-700">Outstanding: </span>
                          <span className="font-bold text-amber-700">
                            ₹{formatAmountINR(summary.netAmount)}
                          </span>
                        </div>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="md:hidden space-y-3">
              {customers.map((row) => {
                const balance = parseFloat(String(row.balance || 0));
                const status = row.collection_status || 'good';
                return (
                  <div
                    key={row.id}
                    className={`rounded-lg shadow-sm border border-gray-200 p-4 ${collectionStatusRowClass(status)}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => navigate(buildDetailPath(row.id))}
                          className="text-base font-semibold text-blue-600 hover:underline text-left"
                        >
                          {formatCustomerWithGroup(row.name, row.customer_group_name)}
                        </button>
                        {row.phone ? (
                          <p className="text-xs text-gray-500 mt-0.5">{row.phone}</p>
                        ) : null}
                        <div className="mt-2">
                          <Badge variant={collectionStatusBadgeVariant(status)}>
                            {collectionStatusLabel(status)}
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-600 mt-2">
                          {row.entry_count || 0} entries
                          {row.latest_description ? ` · ${row.latest_description}` : ''}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center px-3 py-1.5 rounded text-sm font-bold flex-shrink-0 ${
                          balance > 0
                            ? 'bg-amber-50 border border-amber-200 text-amber-800'
                            : 'bg-green-50 border border-green-200 text-green-700'
                        }`}
                      >
                        ₹{formatAmountINR(balance)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between text-sm text-gray-600 bg-gray-50 px-4 py-2 rounded-lg">
              <div>
                Showing <strong className="text-gray-900">{customers.length}</strong> accounts
                {hasActiveFilters ? (
                  <span className="ml-2 text-xs text-blue-600">(filtered)</span>
                ) : null}
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate('/credit-invoices')}>
                <FileText className="h-4 w-4 mr-1" />
                Invoices
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
