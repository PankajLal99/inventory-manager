import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import { formatINR, monthLabel, statusLabel } from './utils';
import type { SalaryRecord } from './types';

export default function SalaryBookPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['salary-book', 'salaries', year, month],
    queryFn: async () => (await salaryBookApi.salaries.list({ year, month })).data as {
      totals: {
        total_employees: number;
        total_gross_salary: string;
        total_leave_deduction: string;
        total_advances: string;
        total_net_payable: string;
      };
      results: SalaryRecord[];
    },
  });

  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Salary Book</h1>
        <select
          className="min-h-11 rounded-xl border border-gray-300 bg-white px-3"
          value={`${year}-${month}`}
          onChange={(e) => {
            const [y, m] = e.target.value.split('-').map(Number);
            setYear(y);
            setMonth(m);
          }}
        >
          {[year - 1, year, year + 1].flatMap((y) =>
            months.map((m) => (
              <option key={`${y}-${m}`} value={`${y}-${m}`}>
                {monthLabel(y, m)}
              </option>
            ))
          )}
        </select>
      </div>

      {isLoading && <LoadingState message="Calculating salaries..." />}
      {isError && <ErrorState onRetry={() => refetch()} />}
      {!isLoading && data && (
        <>
          <div className="bg-white rounded-xl border border-emerald-100 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
            <Kpi label="Total Employees" value={String(data.totals.total_employees)} />
            <Kpi label="Total Gross Salary" value={formatINR(data.totals.total_gross_salary)} />
            <Kpi label="Total Leave Deduction" value={formatINR(data.totals.total_leave_deduction)} />
            <Kpi label="Total Advances" value={formatINR(data.totals.total_advances)} />
            <Kpi label="Total Net Payable" value={formatINR(data.totals.total_net_payable)} />
          </div>
          {(data.results.length ?? 0) === 0 && (
            <EmptyState icon={BookOpen} title="No employees yet." message="Add employees to see monthly salary." />
          )}
          <div className="space-y-3 lg:hidden">
            {data.results.map((row) => (
              <div key={row.id} className="bg-white rounded-xl border border-emerald-100 p-4 space-y-1">
                <div className="font-semibold text-gray-900">{row.employee_name}</div>
                <Mini label="Salary" value={formatINR(row.gross_salary)} />
                <Mini label="Present" value={row.present_days} />
                <Mini label="Paid Leave" value={row.paid_leave_days} />
                <Mini label="Unpaid Leave" value={row.unpaid_leave_days} />
                <Mini label="Leave Deduction" value={formatINR(row.leave_deduction)} />
                <Mini label="Advance" value={formatINR(row.total_advances)} />
                <div className="flex justify-between pt-2 font-semibold">
                  <span>NET PAYABLE</span>
                  <span>{formatINR(row.net_salary)}</span>
                </div>
                <div className="text-xs text-gray-500">{statusLabel(row.payment_status)} · {row.status}</div>
                <Link
                  to={`/salary-book/salaries/${row.id}`}
                  className="mt-2 flex items-center justify-center min-h-11 rounded-xl border border-emerald-200 text-emerald-800 font-medium"
                >
                  View Details
                </Link>
              </div>
            ))}
          </div>
          {data.results.length > 0 && (
            <div className="hidden lg:block bg-white rounded-xl border border-emerald-100 overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-emerald-50 text-left text-gray-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Gross</th>
                    <th className="px-4 py-3 font-medium">Present</th>
                    <th className="px-4 py-3 font-medium">Paid Leave</th>
                    <th className="px-4 py-3 font-medium">Deduction</th>
                    <th className="px-4 py-3 font-medium">Advance</th>
                    <th className="px-4 py-3 font-medium">Net Payable</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((row) => (
                    <tr key={row.id} className="border-t border-emerald-50">
                      <td className="px-4 py-3 font-medium">{row.employee_name}</td>
                      <td className="px-4 py-3">{formatINR(row.gross_salary)}</td>
                      <td className="px-4 py-3">{row.present_days}</td>
                      <td className="px-4 py-3">{row.paid_leave_days}</td>
                      <td className="px-4 py-3">{formatINR(row.leave_deduction)}</td>
                      <td className="px-4 py-3">{formatINR(row.total_advances)}</td>
                      <td className="px-4 py-3 font-semibold">{formatINR(row.net_salary)}</td>
                      <td className="px-4 py-3">{statusLabel(row.payment_status)}</td>
                      <td className="px-4 py-3">
                        <Link to={`/salary-book/salaries/${row.id}`} className="text-emerald-800 font-medium">
                          Details
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-gray-500">{label}</div>
      <div className="font-semibold text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span>{value}</span>
    </div>
  );
}
