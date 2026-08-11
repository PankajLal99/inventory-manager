import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import Input from '../../components/ui/Input';
import Textarea from '../../components/ui/Textarea';
import { toast } from '../../lib/toast';
import { apiError, formatDate, getCurrentGps, gpsUserMessage, todayISO } from './utils';
import ConfirmDialog from './components/ConfirmDialog';
import SalaryBookSheet from './components/SalaryBookSheet';
import type { Employee, LeaveRecord, Paginated } from './types';

export default function LeaveList() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [voidId, setVoidId] = useState<LeaveRecord | null>(null);

  const listQuery = useQuery({
    queryKey: ['salary-book', 'leaves'],
    queryFn: async () => (await salaryBookApi.leaves.list({ page_size: 50 })).data as Paginated<LeaveRecord>,
  });
  const employeesQuery = useQuery({
    queryKey: ['salary-book', 'employees', 'ACTIVE'],
    queryFn: async () =>
      (await salaryBookApi.employees.list({ status: 'ACTIVE', page_size: 100 })).data as Paginated<Employee>,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => salaryBookApi.leaves.create(payload),
    onSuccess: async () => {
      toast('Leave saved', 'success');
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err, 'Unable to save leave.'), 'error'),
  });

  const voidMutation = useMutation({
    mutationFn: async (id: number) => salaryBookApi.leaves.void(id),
    onSuccess: async () => {
      toast('Leave voided', 'success');
      setVoidId(null);
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err, 'Unable to void leave.'), 'error'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Leaves</h1>
        <Button className="min-h-11 bg-emerald-600 hover:bg-emerald-700" onClick={() => setOpen(true)}>
          Add Leave
        </Button>
      </div>
      {listQuery.isLoading && <LoadingState message="Loading leaves..." />}
      {listQuery.isError && <ErrorState onRetry={() => listQuery.refetch()} />}
      {!listQuery.isLoading && (listQuery.data?.results.length ?? 0) === 0 && (
        <EmptyState icon={CalendarDays} title="No leave records found." />
      )}
      <div className="space-y-2 lg:hidden">
        {listQuery.data?.results.map((row) => (
          <div key={row.id} className="bg-white rounded-xl border border-emerald-100 p-4">
            <div className="font-semibold">{row.employee_name}</div>
            <div className="text-sm text-gray-600">
              {row.leave_type === 'PAID' ? 'Paid Leave' : 'Unpaid Leave'} · {row.days} days
            </div>
            <div className="text-sm text-gray-500">
              {formatDate(row.start_date)} – {formatDate(row.end_date)}
            </div>
            {row.status === 'ACTIVE' && (
              <button type="button" className="mt-2 text-sm text-red-600" onClick={() => setVoidId(row)}>
                Void
              </button>
            )}
            {row.status === 'VOID' && <div className="text-xs text-gray-400 mt-1">Voided</div>}
          </div>
        ))}
      </div>
      {(listQuery.data?.results.length ?? 0) > 0 && (
        <div className="hidden lg:block bg-white rounded-xl border border-emerald-100 overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-emerald-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Dates</th>
                <th className="px-4 py-3 font-medium">Days</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {listQuery.data?.results.map((row) => (
                <tr key={row.id} className="border-t border-emerald-50">
                  <td className="px-4 py-3 font-medium">{row.employee_name}</td>
                  <td className="px-4 py-3">{row.leave_type === 'PAID' ? 'Paid Leave' : 'Unpaid Leave'}</td>
                  <td className="px-4 py-3">{formatDate(row.start_date)} – {formatDate(row.end_date)}</td>
                  <td className="px-4 py-3">{row.days}</td>
                  <td className="px-4 py-3">{row.status === 'VOID' ? 'Voided' : 'Active'}</td>
                  <td className="px-4 py-3 text-right">
                    {row.status === 'ACTIVE' && (
                      <button type="button" className="text-sm text-red-600" onClick={() => setVoidId(row)}>
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
        <LeaveForm
          employees={employeesQuery.data?.results || []}
          loading={createMutation.isPending}
          onClose={() => setOpen(false)}
          onSave={(payload) => createMutation.mutate(payload)}
        />
      )}
      <ConfirmDialog
        open={Boolean(voidId)}
        title="Void leave?"
        message="This leave and related attendance will be removed."
        confirmLabel="Void"
        danger
        loading={voidMutation.isPending}
        onCancel={() => setVoidId(null)}
        onConfirm={() => voidId && voidMutation.mutate(voidId.id)}
      />
    </div>
  );
}

function LeaveForm({
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
  const [leaveType, setLeaveType] = useState('PAID');
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [locating, setLocating] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocating(true);
    try {
      const gps = await getCurrentGps();
      onSave({
        employee: Number(employee),
        leave_type: leaveType,
        start_date: start,
        end_date: end,
        reason,
        latitude: gps.latitude,
        longitude: gps.longitude,
        location_accuracy: Math.round(gps.accuracy),
        location_captured_at: gps.capturedAt,
      });
    } catch (err) {
      toast(gpsUserMessage((err as Error).message), 'error');
    } finally {
      setLocating(false);
    }
  };

  return (
    <SalaryBookSheet onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <h2 className="font-semibold text-lg">Add Leave</h2>
        <Select label="Employee" required value={employee} onChange={(e) => setEmployee(e.target.value)}>
          <option value="">Select</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
            </option>
          ))}
        </Select>
        <Select label="Leave Type" value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
          <option value="PAID">Paid Leave</option>
          <option value="UNPAID">Unpaid Leave</option>
        </Select>
        <Input label="Start Date" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <Input label="End Date" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        <Textarea label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        <p className="text-xs text-gray-500">Location is required. We will capture GPS when you save.</p>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <Button type="button" variant="outline" className="min-h-12" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="min-h-12 bg-emerald-600 hover:bg-emerald-700" loading={loading || locating}>
            Save
          </Button>
        </div>
      </form>
    </SalaryBookSheet>
  );
}
