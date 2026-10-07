import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Wallet } from 'lucide-react';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import Input from '../../components/ui/Input';
import Textarea from '../../components/ui/Textarea';
import { toast } from '../../lib/toast';
import { apiError, formatINR, todayISO } from './utils';
import SalaryBookSheet from './components/SalaryBookSheet';
import EmployeeAdvanceLedger from './components/EmployeeAdvanceLedger';
import type { Employee, Paginated, SalaryAdvance } from './types';

type EmployeeAdvanceGroup = {
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  outstanding: number;
};

function groupAdvancesByEmployee(rows: SalaryAdvance[]): EmployeeAdvanceGroup[] {
  const map = new Map<number, EmployeeAdvanceGroup>();
  for (const row of rows) {
    let group = map.get(row.employee);
    if (!group) {
      group = {
        employeeId: row.employee,
        employeeName: row.employee_name,
        employeeCode: row.employee_code || '',
        outstanding: 0,
      };
      map.set(row.employee, group);
    }
    if (row.status === 'ACTIVE') {
      group.outstanding += Number(row.amount) || 0;
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName, undefined, { sensitivity: 'base' })
  );
}

export default function AdvanceList() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [ledgerEmp, setLedgerEmp] = useState<{ id: number; name: string } | null>(null);

  const listQuery = useQuery({
    queryKey: ['salary-book', 'advances'],
    queryFn: async () =>
      (await salaryBookApi.advances.list({ page_size: 200 })).data as Paginated<SalaryAdvance>,
  });
  const employeesQuery = useQuery({
    queryKey: ['salary-book', 'employees', 'ACTIVE'],
    queryFn: async () =>
      (await salaryBookApi.employees.list({ status: 'ACTIVE', page_size: 100 })).data as Paginated<Employee>,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => salaryBookApi.advances.create(payload),
    onSuccess: async () => {
      toast('Advance saved', 'success');
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err, 'Unable to save advance.'), 'error'),
  });

  const groups = useMemo(
    () => groupAdvancesByEmployee(listQuery.data?.results || []),
    [listQuery.data?.results]
  );

  const openLedger = (group: EmployeeAdvanceGroup) =>
    setLedgerEmp({ id: group.employeeId, name: group.employeeName });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Advances</h1>
        <Button
          data-tutorial="adv-add"
          className="min-h-11 bg-emerald-600 hover:bg-emerald-700"
          onClick={() => setOpen(true)}
        >
          Add Advance
        </Button>
      </div>
      <p className="text-sm text-gray-600">
        One row per employee. Tap to open their ledger and mark paid or void individual entries.
      </p>
      {listQuery.isLoading && <LoadingState message="Loading advances..." />}
      {listQuery.isError && <ErrorState onRetry={() => listQuery.refetch()} />}
      {!listQuery.isLoading && groups.length === 0 && (
        <EmptyState icon={Wallet} title="No salary advances recorded." />
      )}
      <div className="space-y-2 lg:hidden">
        {groups.map((group) => (
          <button
            key={group.employeeId}
            type="button"
            onClick={() => openLedger(group)}
            className="w-full bg-white rounded-xl border border-emerald-100 p-4 flex items-center justify-between gap-3 text-left active:bg-emerald-50/40"
          >
            <div className="min-w-0">
              <div className="font-semibold text-emerald-800">{group.employeeName}</div>
              {group.employeeCode ? (
                <div className="text-sm text-gray-500 mt-0.5">{group.employeeCode}</div>
              ) : null}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="text-right">
                <div className="text-[11px] text-gray-500">Outstanding</div>
                <div className="font-semibold tabular-nums">{formatINR(group.outstanding.toFixed(2))}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-400" />
            </div>
          </button>
        ))}
      </div>
      {groups.length > 0 && (
        <div className="hidden lg:block bg-white rounded-xl border border-emerald-100 overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-emerald-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Outstanding</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr
                  key={group.employeeId}
                  className="border-t border-emerald-50 cursor-pointer hover:bg-emerald-50/40"
                  onClick={() => openLedger(group)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-emerald-800">{group.employeeName}</div>
                    {group.employeeCode ? (
                      <div className="text-xs text-gray-400">{group.employeeCode}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-semibold tabular-nums">
                    {formatINR(group.outstanding.toFixed(2))}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400">
                    <ChevronRight className="inline h-4 w-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <AdvanceForm
          employees={employeesQuery.data?.results || []}
          loading={createMutation.isPending}
          onClose={() => setOpen(false)}
          onSave={(payload) => createMutation.mutate(payload)}
        />
      )}
      {ledgerEmp && (
        <EmployeeAdvanceLedger
          employeeId={ledgerEmp.id}
          employeeName={ledgerEmp.name}
          onClose={() => setLedgerEmp(null)}
        />
      )}
    </div>
  );
}

function AdvanceForm({
  employees,
  loading,
  onClose,
  onSave,
}: {
  employees: Employee[];
  loading: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [employee, setEmployee] = useState('');
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');

  return (
    <SalaryBookSheet onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ employee: Number(employee), date, amount, reason, remarks });
        }}
        className="space-y-3"
      >
        <h2 className="font-semibold text-lg">Add Advance</h2>
        <Select label="Employee" required value={employee} onChange={(e) => setEmployee(e.target.value)}>
          <option value="">Select</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.name}</option>
          ))}
        </Select>
        <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label="Amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Textarea label="Remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="outline" className="min-h-12" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="min-h-12 bg-emerald-600 hover:bg-emerald-700" loading={loading}>Save</Button>
        </div>
      </form>
    </SalaryBookSheet>
  );
}
