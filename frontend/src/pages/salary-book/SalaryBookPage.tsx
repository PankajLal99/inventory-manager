import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import { formatINR, monthLabel } from './utils';
import EmployeeAdvanceLedger from './components/EmployeeAdvanceLedger';
import type { SalaryRecord } from './types';
import {
  KpiCard,
  PageHeader,
  SalaryCard,
  SalaryTable,
  SalaryTd,
  StatusBadge,
} from './ui';

export default function SalaryBookPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [ledgerEmp, setLedgerEmp] = useState<{ id: number; name: string } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['salary-book', 'salaries', year, month],
    queryFn: async () =>
      (await salaryBookApi.salaries.list({ year, month })).data as {
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
    <div className="space-y-4" data-tutorial="sal-list">
      <PageHeader
        title="Salary Book"
        subtitle="Month = each employee’s cycle end month (joining day, e.g. 13th → next 13th)."
        actions={
          <select
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"
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
        }
      />

      {isLoading && <LoadingState message="Calculating salaries..." />}
      {isError && <ErrorState onRetry={() => refetch()} />}
      {!isLoading && data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <KpiCard label="Employees" value={String(data.totals.total_employees)} />
            <KpiCard label="Gross" value={formatINR(data.totals.total_gross_salary)} />
            <KpiCard label="Leave deduction" value={formatINR(data.totals.total_leave_deduction)} tone="warning" />
            <KpiCard label="Advances" value={formatINR(data.totals.total_advances)} tone="info" />
            <KpiCard label="Net payable" value={formatINR(data.totals.total_net_payable)} tone="success" />
          </div>
          {(data.results.length ?? 0) === 0 && (
            <EmptyState icon={BookOpen} title="No employees yet." message="Add employees to see monthly salary." />
          )}
          <div className="space-y-3 lg:hidden">
            {data.results.map((row) => (
              <SalaryCard key={row.id} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="font-semibold text-slate-900 text-left"
                    onClick={() => setLedgerEmp({ id: row.employee, name: row.employee_name })}
                  >
                    {row.employee_name}
                  </button>
                  <StatusBadge status={row.payment_status} />
                </div>
                <Mini label="Gross" value={formatINR(row.gross_salary)} />
                <Mini label="Present" value={row.present_days} />
                <Mini label="Leave deduction" value={formatINR(row.leave_deduction)} />
                <Mini label="Advance" value={formatINR(row.total_advances)} />
                <div className="flex justify-between pt-2 font-semibold tabular-nums">
                  <span>Net payable</span>
                  <span>{formatINR(row.net_salary)}</span>
                </div>
                <div className="text-xs text-slate-500">{row.status === 'FINALIZED' ? 'Finalized' : 'Draft'}</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Link
                    to={`/salary-book/salaries/${row.id}`}
                    className="flex items-center justify-center min-h-11 rounded-xl bg-emerald-700 text-white font-medium text-sm"
                  >
                    Open
                  </Link>
                  <Link
                    to={`/salary-book/employees/${row.employee}`}
                    className="flex items-center justify-center min-h-11 rounded-xl border border-emerald-200 text-emerald-800 font-medium text-sm bg-white"
                  >
                    Invoice
                  </Link>
                </div>
              </SalaryCard>
            ))}
          </div>
          {data.results.length > 0 && (
            <SalaryTable
              columns={[
                { key: 'emp', label: 'Employee' },
                { key: 'gross', label: 'Gross', align: 'right' },
                { key: 'present', label: 'Present', align: 'right' },
                { key: 'leave', label: 'Deduction', align: 'right' },
                { key: 'adv', label: 'Advance', align: 'right' },
                { key: 'net', label: 'Net payable', align: 'right' },
                { key: 'pay', label: 'Payment' },
                { key: 'rec', label: 'Record' },
                { key: 'act', label: '' },
              ]}
            >
              {data.results.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <SalaryTd>
                    <button
                      type="button"
                      className="font-medium text-slate-900 hover:text-emerald-800"
                      onClick={() => setLedgerEmp({ id: row.employee, name: row.employee_name })}
                    >
                      {row.employee_name}
                    </button>
                  </SalaryTd>
                  <SalaryTd align="right">{formatINR(row.gross_salary)}</SalaryTd>
                  <SalaryTd align="right">{row.present_days}</SalaryTd>
                  <SalaryTd align="right">{formatINR(row.leave_deduction)}</SalaryTd>
                  <SalaryTd align="right">
                    <button
                      type="button"
                      className="text-emerald-800 font-medium hover:underline"
                      onClick={() => setLedgerEmp({ id: row.employee, name: row.employee_name })}
                    >
                      {formatINR(row.total_advances)}
                    </button>
                  </SalaryTd>
                  <SalaryTd align="right" className="font-semibold">
                    {formatINR(row.net_salary)}
                  </SalaryTd>
                  <SalaryTd>
                    <StatusBadge status={row.payment_status} />
                  </SalaryTd>
                  <SalaryTd>
                    <StatusBadge status={row.status} />
                  </SalaryTd>
                  <SalaryTd>
                    <Link
                      to={`/salary-book/salaries/${row.id}`}
                      className="inline-flex items-center justify-center min-h-9 px-3 rounded-lg bg-emerald-700 text-white text-sm font-medium"
                    >
                      Open
                    </Link>
                  </SalaryTd>
                </tr>
              ))}
            </SalaryTable>
          )}
          {ledgerEmp && (
            <EmployeeAdvanceLedger
              employeeId={ledgerEmp.id}
              employeeName={ledgerEmp.name}
              year={year}
              month={month}
              onClose={() => setLedgerEmp(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="tabular-nums text-slate-800">{value}</span>
    </div>
  );
}
