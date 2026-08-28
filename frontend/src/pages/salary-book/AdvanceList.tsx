import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import Input from '../../components/ui/Input';
import Textarea from '../../components/ui/Textarea';
import { toast } from '../../lib/toast';
import { apiError, formatDate, formatINR, todayISO } from './utils';
import ConfirmDialog from './components/ConfirmDialog';
import SalaryBookSheet from './components/SalaryBookSheet';
import type { Employee, Paginated, SalaryAdvance } from './types';

export default function AdvanceList() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [voidRow, setVoidRow] = useState<SalaryAdvance | null>(null);

  const listQuery = useQuery({
    queryKey: ['salary-book', 'advances'],
    queryFn: async () => (await salaryBookApi.advances.list({ page_size: 50 })).data as Paginated<SalaryAdvance>,
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

  const voidMutation = useMutation({
    mutationFn: async (id: number) => salaryBookApi.advances.void(id),
    onSuccess: async () => {
      toast('Advance voided', 'success');
      setVoidRow(null);
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err, 'Unable to void advance.'), 'error'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Advances</h1>
        <Button className="min-h-11 bg-emerald-600 hover:bg-emerald-700" onClick={() => setOpen(true)}>
          Add Advance
        </Button>
      </div>
      {listQuery.isLoading && <LoadingState message="Loading advances..." />}
      {listQuery.isError && <ErrorState onRetry={() => listQuery.refetch()} />}
      {!listQuery.isLoading && (listQuery.data?.results.length ?? 0) === 0 && (
        <EmptyState icon={Wallet} title="No salary advances recorded." />
      )}
      <div className="space-y-2 lg:hidden">
        {listQuery.data?.results.map((row) => (
          <div key={row.id} className="bg-white rounded-xl border border-emerald-100 p-4 flex justify-between gap-3">
            <div>
              <div className="font-semibold">{row.employee_name}</div>
              <div className="text-sm text-gray-500">{formatDate(row.date)} · {row.reason || '—'}</div>
              {row.status === 'VOID' && <div className="text-xs text-gray-400">Voided</div>}
              {row.status === 'ACTIVE' && (
                <button type="button" className="mt-1 text-sm text-red-600" onClick={() => setVoidRow(row)}>
                  Void
                </button>
              )}
            </div>
            <div className="font-semibold">{formatINR(row.amount)}</div>
          </div>
        ))}
      </div>
      {(listQuery.data?.results.length ?? 0) > 0 && (
        <div className="hidden lg:block bg-white rounded-xl border border-emerald-100 overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-emerald-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {listQuery.data?.results.map((row) => (
                <tr key={row.id} className="border-t border-emerald-50">
                  <td className="px-4 py-3 font-medium">{row.employee_name}</td>
                  <td className="px-4 py-3">{formatDate(row.date)}</td>
                  <td className="px-4 py-3">{row.reason || '—'}</td>
                  <td className="px-4 py-3 font-medium">{formatINR(row.amount)}</td>
                  <td className="px-4 py-3">{row.status === 'VOID' ? 'Voided' : 'Active'}</td>
                  <td className="px-4 py-3 text-right">
                    {row.status === 'ACTIVE' && (
                      <button type="button" className="text-sm text-red-600" onClick={() => setVoidRow(row)}>
                        Void
                      </button>
                    )}
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
      <ConfirmDialog
        open={Boolean(voidRow)}
        title="Delete Advance?"
        message={voidRow ? `${formatINR(voidRow.amount)} advance for ${voidRow.employee_name} will be voided.` : ''}
        confirmLabel="Void"
        danger
        loading={voidMutation.isPending}
        onCancel={() => setVoidRow(null)}
        onConfirm={() => voidRow && voidMutation.mutate(voidRow.id)}
      />
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
