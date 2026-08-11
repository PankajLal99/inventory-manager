import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import Select from '../../components/ui/Select';
import { formatDate, formatINR, monthLabel, statusLabel } from './utils';
import type { Attendance, Employee, LeaveRecord, Paginated, SalaryAdvance, SalaryRecord } from './types';

const KINDS = [
  { id: 'attendance', label: 'Attendance Report' },
  { id: 'leaves', label: 'Leave Report' },
  { id: 'advances', label: 'Advance Report' },
  { id: 'salaries', label: 'Monthly Salary Report' },
] as const;

export default function ReportsPage() {
  const now = new Date();
  const [kind, setKind] = useState<(typeof KINDS)[number]['id'] | ''>('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [employee, setEmployee] = useState('');

  const employeesQuery = useQuery({
    queryKey: ['salary-book', 'employees', 'all'],
    queryFn: async () => (await salaryBookApi.employees.list({ page_size: 100 })).data as Paginated<Employee>,
  });

  const params = { year, month, employee: employee || undefined, page_size: 50 };
  const reportQuery = useQuery({
    queryKey: ['salary-book', 'report', kind, params],
    enabled: Boolean(kind),
    queryFn: async () => {
      if (kind === 'attendance') return (await salaryBookApi.reports.attendance(params)).data;
      if (kind === 'leaves') return (await salaryBookApi.reports.leaves(params)).data;
      if (kind === 'advances') return (await salaryBookApi.reports.advances(params)).data;
      return (await salaryBookApi.reports.salaries(params)).data;
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl lg:text-2xl font-bold">Reports</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setKind(k.id)}
            className={`min-h-12 rounded-xl border text-left px-4 ${
              kind === k.id ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-emerald-100'
            }`}
          >
            {k.label}
          </button>
        ))}
        <Link
          to="/salary-book/employees"
          className="min-h-12 rounded-xl border bg-white border-emerald-100 flex items-center px-4"
        >
          Employee Salary History
        </Link>
      </div>

      {kind && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            <Select label="Month" value={String(month)} onChange={(e) => setMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>{monthLabel(year, i + 1)}</option>
              ))}
            </Select>
            <Select label="Year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
              {[year - 1, year, year + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </Select>
          </div>
          <Select label="Employee" value={employee} onChange={(e) => setEmployee(e.target.value)}>
            <option value="">All employees</option>
            {employeesQuery.data?.results.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.name}</option>
            ))}
          </Select>
          {reportQuery.isLoading && <LoadingState message="Loading report..." />}
          {reportQuery.data && <ReportBody kind={kind} data={reportQuery.data} />}
        </div>
      )}
    </div>
  );
}

function ReportBody({ kind, data }: { kind: string; data: Paginated<unknown> }) {
  const rows = data.results || [];
  if (!rows.length) return <p className="text-sm text-gray-500">No records found.</p>;
  if (kind === 'attendance') {
    return (
      <>
        <div className="space-y-2 lg:hidden">
          {(rows as Attendance[]).map((row) => (
            <div key={row.id} className="bg-white rounded-xl border p-3 text-sm">
              <div className="font-medium">{row.employee_name}</div>
              <div className="text-gray-600">{formatDate(row.date)} · {statusLabel(row.status)}</div>
            </div>
          ))}
        </div>
        <ReportTable headers={['Employee', 'Date', 'Status']}>
          {(rows as Attendance[]).map((row) => (
            <tr key={row.id} className="border-t border-emerald-50">
              <td className="px-4 py-3 font-medium">{row.employee_name}</td>
              <td className="px-4 py-3">{formatDate(row.date)}</td>
              <td className="px-4 py-3">{statusLabel(row.status)}</td>
            </tr>
          ))}
        </ReportTable>
      </>
    );
  }
  if (kind === 'leaves') {
    return (
      <>
        <div className="space-y-2 lg:hidden">
          {(rows as LeaveRecord[]).map((row) => (
            <div key={row.id} className="bg-white rounded-xl border p-3 text-sm">
              <div className="font-medium">{row.employee_name}</div>
              <div className="text-gray-600">{row.leave_type} · {formatDate(row.start_date)} – {formatDate(row.end_date)}</div>
            </div>
          ))}
        </div>
        <ReportTable headers={['Employee', 'Type', 'From', 'To']}>
          {(rows as LeaveRecord[]).map((row) => (
            <tr key={row.id} className="border-t border-emerald-50">
              <td className="px-4 py-3 font-medium">{row.employee_name}</td>
              <td className="px-4 py-3">{row.leave_type}</td>
              <td className="px-4 py-3">{formatDate(row.start_date)}</td>
              <td className="px-4 py-3">{formatDate(row.end_date)}</td>
            </tr>
          ))}
        </ReportTable>
      </>
    );
  }
  if (kind === 'advances') {
    return (
      <>
        <div className="space-y-2 lg:hidden">
          {(rows as SalaryAdvance[]).map((row) => (
            <div key={row.id} className="bg-white rounded-xl border p-3 text-sm flex justify-between">
              <div>
                <div className="font-medium">{row.employee_name}</div>
                <div className="text-gray-600">{formatDate(row.date)}</div>
              </div>
              <div>{formatINR(row.amount)}</div>
            </div>
          ))}
        </div>
        <ReportTable headers={['Employee', 'Date', 'Amount']}>
          {(rows as SalaryAdvance[]).map((row) => (
            <tr key={row.id} className="border-t border-emerald-50">
              <td className="px-4 py-3 font-medium">{row.employee_name}</td>
              <td className="px-4 py-3">{formatDate(row.date)}</td>
              <td className="px-4 py-3">{formatINR(row.amount)}</td>
            </tr>
          ))}
        </ReportTable>
      </>
    );
  }
  return (
    <>
      <div className="space-y-2 lg:hidden">
        {(rows as SalaryRecord[]).map((row) => (
          <Link key={row.id} to={`/salary-book/salaries/${row.id}`} className="block bg-white rounded-xl border p-3 text-sm">
            <div className="font-medium">{row.employee_name}</div>
            <div className="text-gray-600">Net {formatINR(row.net_salary)} · {statusLabel(row.payment_status)}</div>
          </Link>
        ))}
      </div>
      <ReportTable headers={['Employee', 'Net', 'Status']}>
        {(rows as SalaryRecord[]).map((row) => (
          <tr key={row.id} className="border-t border-emerald-50">
            <td className="px-4 py-3">
              <Link to={`/salary-book/salaries/${row.id}`} className="font-medium text-emerald-800">
                {row.employee_name}
              </Link>
            </td>
            <td className="px-4 py-3">{formatINR(row.net_salary)}</td>
            <td className="px-4 py-3">{statusLabel(row.payment_status)}</td>
          </tr>
        ))}
      </ReportTable>
    </>
  );
}

function ReportTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="hidden lg:block bg-white rounded-xl border border-emerald-100 overflow-hidden">
      <table className="min-w-full text-sm">
        <thead className="bg-emerald-50 text-left text-gray-600">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
