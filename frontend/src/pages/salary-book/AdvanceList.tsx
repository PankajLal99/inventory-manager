import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Wallet } from 'lucide-react';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import Select from '../../components/ui/Select';
import { PageHeader, SalaryButton, SalaryTable, SalaryTd } from './ui';
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
      <PageHeader
        title="Advances"
        subtitle="One row per employee. Tap to open their ledger and mark paid or void individual entries."
        actions={
          <SalaryButton data-tutorial="adv-add" onClick={() => setOpen(true)}>
            Add advance
          </SalaryButton>
        }
      />
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
            className="w-full bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-3 text-left active:bg-slate-50"
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
        <SalaryTable
          columns={[
            { key: 'emp', label: 'Employee' },
            { key: 'out', label: 'Outstanding', align: 'right' },
            { key: 'act', label: '' },
          ]}
        >
          {groups.map((group) => (
            <tr
              key={group.employeeId}
              className="cursor-pointer hover:bg-slate-50"
              onClick={() => openLedger(group)}
            >
              <SalaryTd>
                <div className="font-medium text-slate-900">{group.employeeName}</div>
                {group.employeeCode ? <div className="text-xs text-slate-400">{group.employeeCode}</div> : null}
              </SalaryTd>
              <SalaryTd align="right">{formatINR(group.outstanding.toFixed(2))}</SalaryTd>
              <SalaryTd className="text-right text-slate-400">
                <ChevronRight className="inline h-4 w-4" />
              </SalaryTd>
            </tr>
          ))}
        </SalaryTable>
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
          <SalaryButton type="button" variant="secondary" size="lg" onClick={onClose}>Cancel</SalaryButton>
          <SalaryButton type="submit" size="lg" loading={loading}>Save</SalaryButton>
        </div>
      </form>
    </SalaryBookSheet>
  );
}
