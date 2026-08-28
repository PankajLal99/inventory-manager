import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, Users } from 'lucide-react';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import { formatINR } from './utils';
import type { Employee, Paginated } from './types';

export default function EmployeeList() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE' | ''>('ACTIVE');
  const params = useMemo(() => ({ q: q || undefined, status: status || undefined, page_size: 50 }), [q, status]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['salary-book', 'employees', params],
    queryFn: async () => (await salaryBookApi.employees.list(params)).data as Paginated<Employee>,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Employees</h1>
        <Link
          to="/salary-book/employees/new"
          className="inline-flex items-center justify-center h-11 w-11 lg:w-auto lg:px-4 lg:gap-2 rounded-full lg:rounded-xl bg-emerald-600 text-white"
          aria-label="Add employee"
        >
          <Plus className="h-5 w-5" />
          <span className="hidden lg:inline font-medium">Add Employee</span>
        </Link>
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search employee..."
            className="w-full min-h-12 pl-9 pr-3 rounded-xl border border-gray-300 bg-white"
          />
        </div>
        <div className="flex gap-2">
          {(['ACTIVE', 'INACTIVE'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(status === s ? '' : s)}
              className={`px-4 py-2 rounded-full text-sm min-h-10 ${
                status === s ? 'bg-emerald-600 text-white' : 'bg-white border border-gray-200 text-gray-700'
              }`}
            >
              {s === 'ACTIVE' ? 'Active' : 'Inactive'}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <LoadingState message="Loading employees..." />}
      {isError && <ErrorState onRetry={() => refetch()} />}
      {!isLoading && !isError && (data?.results.length ?? 0) === 0 && (
        <EmptyState
          icon={Users}
          title="No employees yet."
          message="Add your first employee to start managing Salary Book."
          action={
            <Link to="/salary-book/employees/new" className="inline-flex min-h-12 px-4 items-center rounded-xl bg-emerald-600 text-white font-medium">
              Add Employee
            </Link>
          }
        />
      )}

      <div className="space-y-3 lg:hidden">
        {data?.results.map((emp) => (
          <button
            key={emp.id}
            type="button"
            onClick={() => navigate(`/salary-book/employees/${emp.id}`)}
            className="w-full text-left bg-white rounded-xl border border-emerald-100 p-4"
          >
            <div className="font-semibold text-gray-900">{emp.name}</div>
            <div className="text-sm text-gray-500">{emp.employee_id}</div>
            <div className="text-sm text-gray-800 mt-1">{formatINR(emp.monthly_salary)} / month</div>
            <div className={`text-xs mt-1 ${emp.status === 'ACTIVE' ? 'text-emerald-700' : 'text-gray-500'}`}>
              {emp.status === 'ACTIVE' ? 'Active' : 'Inactive'}
            </div>
          </button>
        ))}
      </div>

      {(data?.results.length ?? 0) > 0 && (
        <div className="hidden lg:block bg-white rounded-xl border border-emerald-100 overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-emerald-50 text-gray-600 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Salary</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data?.results.map((emp) => (
                <tr
                  key={emp.id}
                  className="border-t border-emerald-50 hover:bg-emerald-50/50 cursor-pointer"
                  onClick={() => navigate(`/salary-book/employees/${emp.id}`)}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{emp.name}</td>
                  <td className="px-4 py-3 text-gray-600">{emp.employee_id}</td>
                  <td className="px-4 py-3 text-gray-600">{emp.department || '—'}</td>
                  <td className="px-4 py-3">{formatINR(emp.monthly_salary)}</td>
                  <td className={`px-4 py-3 ${emp.status === 'ACTIVE' ? 'text-emerald-700' : 'text-gray-500'}`}>
                    {emp.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
