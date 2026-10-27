import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, Users } from 'lucide-react';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import { formatDate, formatINR } from './utils';
import type { Employee, Paginated } from './types';
import { FilterChips, PageHeader, SalaryCard, SalaryTable, SalaryTd, StatusBadge } from './ui';

export default function EmployeeList() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE' | 'ALL'>('ACTIVE');
  const params = useMemo(
    () => ({ q: q || undefined, status: status === 'ALL' ? undefined : status, page_size: 50 }),
    [q, status]
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['salary-book', 'employees', params],
    queryFn: async () => (await salaryBookApi.employees.list(params)).data as Paginated<Employee>,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Employees"
        subtitle="Directory of people on the salary book"
        actions={
          <Link
            to="/salary-book/employees/new"
            data-tutorial="emp-add"
            aria-label="Add employee"
            className="inline-flex items-center justify-center gap-2 h-11 w-11 lg:w-auto lg:px-4 rounded-full lg:rounded-xl bg-emerald-700 text-white font-medium text-sm hover:bg-emerald-800"
          >
            <Plus className="h-5 w-5" />
            <span className="hidden lg:inline">Add employee</span>
          </Link>
        }
      />

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, ID, or mobile…"
            className="w-full min-h-12 pl-9 pr-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600"
          />
        </div>
        <FilterChips
          chips={[
            { key: 'ACTIVE', label: 'Active' },
            { key: 'INACTIVE', label: 'Inactive' },
            { key: 'ALL', label: 'All' },
          ]}
          value={status}
          onChange={setStatus}
        />
      </div>

      {isLoading && <LoadingState message="Loading employees..." />}
      {isError && <ErrorState onRetry={() => refetch()} />}
      {!isLoading && !isError && (data?.results.length ?? 0) === 0 && (
        <EmptyState
          icon={Users}
          title="No employees yet."
          message="Add your first employee to start managing Salary Book."
          action={
            <Link
              to="/salary-book/employees/new"
              className="inline-flex items-center justify-center min-h-11 px-4 rounded-xl bg-emerald-700 text-white font-medium text-sm"
            >
              Add employee
            </Link>
          }
        />
      )}

      <div className="space-y-3 lg:hidden">
        {data?.results.map((emp) => (
          <SalaryCard
            key={emp.id}
            role="link"
            tabIndex={0}
            onClick={() => navigate(`/salary-book/employees/${emp.id}`)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') navigate(`/salary-book/employees/${emp.id}`);
            }}
            className="cursor-pointer hover:border-emerald-200"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-slate-900">{emp.name}</div>
                <div className="text-sm text-slate-500">{emp.employee_id}</div>
                <div className="text-sm text-slate-800 mt-1 tabular-nums">{formatINR(emp.monthly_salary)} / month</div>
                {emp.designation ? <div className="text-xs text-slate-500 mt-0.5">{emp.designation}</div> : null}
              </div>
              <StatusBadge status={emp.status} />
            </div>
          </SalaryCard>
        ))}
      </div>

      {(data?.results.length ?? 0) > 0 && (
        <SalaryTable
          columns={[
            { key: 'name', label: 'Employee' },
            { key: 'id', label: 'ID' },
            { key: 'designation', label: 'Designation' },
            { key: 'joined', label: 'Joined' },
            { key: 'salary', label: 'Salary', align: 'right' },
            { key: 'status', label: 'Status' },
          ]}
        >
          {data?.results.map((emp) => (
            <tr
              key={emp.id}
              className="hover:bg-slate-50 cursor-pointer"
              onClick={() => navigate(`/salary-book/employees/${emp.id}`)}
            >
              <SalaryTd>
                <div className="font-medium text-slate-900">{emp.name}</div>
                <div className="text-xs text-slate-500">{emp.department || '—'}</div>
              </SalaryTd>
              <SalaryTd>{emp.employee_id}</SalaryTd>
              <SalaryTd>{emp.designation || '—'}</SalaryTd>
              <SalaryTd>{formatDate(emp.date_of_joining)}</SalaryTd>
              <SalaryTd align="right">{formatINR(emp.monthly_salary)}</SalaryTd>
              <SalaryTd>
                <StatusBadge status={emp.status} />
              </SalaryTd>
            </tr>
          ))}
        </SalaryTable>
      )}
    </div>
  );
}
