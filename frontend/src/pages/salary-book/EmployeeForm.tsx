import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { salaryBookApi } from '../../lib/api';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Textarea from '../../components/ui/Textarea';
import Button from '../../components/ui/Button';
import LoadingState from '../../components/ui/LoadingState';
import { toast } from '../../lib/toast';
import { apiError, formatINR, scheduledHoursFromTimes, todayISO, toTimeInput } from './utils';
import ConfirmDialog from './components/ConfirmDialog';
import type { AttendanceRule, Employee, SalaryBookSettings } from './types';

const BLOOD = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const empty = {
  employee_id: '',
  name: '',
  mobile: '',
  alternate_contact: '',
  address: '',
  blood_group: '',
  date_of_joining: todayISO(),
  designation: '',
  department: '',
  monthly_salary: '',
  salary_calculation_method: 'INHERIT',
  fixed_working_days: '',
  expected_check_in: '',
  expected_check_out: '',
  status: 'ACTIVE',
  notes: '',
};

export default function EmployeeForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(empty);
  const [confirmSalary, setConfirmSalary] = useState(false);
  const [originalSalary, setOriginalSalary] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['salary-book', 'employee', id],
    queryFn: async () => (await salaryBookApi.employees.get(Number(id))).data as Employee,
    enabled: isEdit,
  });

  const settingsQuery = useQuery({
    queryKey: ['salary-book', 'settings'],
    queryFn: async () => (await salaryBookApi.settings.get()).data as SalaryBookSettings,
  });

  useEffect(() => {
    if (!data) return;
    setOriginalSalary(String(data.monthly_salary));
    setForm({
      employee_id: data.employee_id,
      name: data.name,
      mobile: data.mobile,
      alternate_contact: data.alternate_contact || '',
      address: data.address || '',
      blood_group: data.blood_group || '',
      date_of_joining: data.date_of_joining,
      designation: data.designation || '',
      department: data.department || '',
      monthly_salary: String(data.monthly_salary),
      salary_calculation_method: data.salary_calculation_method,
      fixed_working_days: data.fixed_working_days ? String(data.fixed_working_days) : '',
      expected_check_in: toTimeInput(data.expected_check_in),
      expected_check_out: toTimeInput(data.expected_check_out),
      status: data.status,
      notes: data.notes || '',
    });
  }, [data]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        ...form,
        employee_id: form.employee_id || undefined,
        monthly_salary: form.monthly_salary,
        fixed_working_days: form.fixed_working_days ? Number(form.fixed_working_days) : null,
        expected_check_in: form.expected_check_in || null,
        expected_check_out: form.expected_check_out || null,
      };
      if (isEdit) return salaryBookApi.employees.update(Number(id), payload);
      return salaryBookApi.employees.create(payload);
    },
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
      toast(isEdit ? 'Employee updated' : 'Employee added', 'success');
      navigate(`/salary-book/employees/${res.data.id}`);
    },
    onError: (err) => toast(apiError(err, 'Unable to save employee.'), 'error'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEdit && form.monthly_salary !== originalSalary) {
      setConfirmSalary(true);
      return;
    }
    mutation.mutate();
  };

  const settings = settingsQuery.data;
  const preview = useMemo(() => {
    const cin = form.expected_check_in || toTimeInput(settings?.default_check_in);
    const cout = form.expected_check_out || toTimeInput(settings?.default_check_out);
    const hours = scheduledHoursFromTimes(cin, cout);
    const salary = Number(form.monthly_salary) || 0;
    const now = new Date();
    const calendarDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const divisor =
      form.salary_calculation_method === 'FIXED_WORKING_DAYS'
        ? Number(form.fixed_working_days) || settings?.fixed_working_days || 26
        : form.salary_calculation_method === 'CALENDAR_DAYS'
          ? calendarDays
          : settings?.salary_calculation_method === 'FIXED_WORKING_DAYS'
            ? settings.fixed_working_days
            : calendarDays;
    const daily = divisor ? salary / divisor : 0;
    const hourly = hours ? daily / hours : 0;
    return { hours, daily, hourly, cin, cout };
  }, [form, settings]);

  if (isEdit && isLoading) return <LoadingState message="Loading employee..." />;

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <form onSubmit={submit} className="space-y-4 lg:max-w-4xl">
      <h1 className="text-xl lg:text-2xl font-bold text-gray-900">{isEdit ? 'Edit Employee' : 'Add Employee'}</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Input label="Employee ID" placeholder="Auto EMP-001" value={form.employee_id} onChange={(e) => set('employee_id', e.target.value)} />
      <Input label="Employee Name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
      <Input label="Mobile Number" required inputMode="numeric" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} />
      <Input label="Alternate Contact" inputMode="numeric" value={form.alternate_contact} onChange={(e) => set('alternate_contact', e.target.value)} />
      <div className="lg:col-span-2">
        <Textarea label="Address" rows={3} value={form.address} onChange={(e) => set('address', e.target.value)} />
      </div>
      <Select label="Blood Group" value={form.blood_group} onChange={(e) => set('blood_group', e.target.value)}>
        {BLOOD.map((b) => (
          <option key={b || 'none'} value={b}>{b || 'Select'}</option>
        ))}
      </Select>
      <Input label="Date of Joining" type="date" required value={form.date_of_joining} onChange={(e) => set('date_of_joining', e.target.value)} />
      <Input label="Designation" value={form.designation} onChange={(e) => set('designation', e.target.value)} />
      <Input label="Department" value={form.department} onChange={(e) => set('department', e.target.value)} />
      <Input label="Monthly Salary" required inputMode="decimal" value={form.monthly_salary} onChange={(e) => set('monthly_salary', e.target.value)} />
      <Select label="Salary Calculation Method" value={form.salary_calculation_method} onChange={(e) => set('salary_calculation_method', e.target.value)}>
        <option value="INHERIT">Use company default</option>
        <option value="CALENDAR_DAYS">Calendar Days</option>
        <option value="FIXED_WORKING_DAYS">Fixed Working Days</option>
      </Select>
      {form.salary_calculation_method === 'FIXED_WORKING_DAYS' && (
        <Input label="Fixed Working Days" inputMode="numeric" value={form.fixed_working_days} onChange={(e) => set('fixed_working_days', e.target.value)} />
      )}
      <Input
        label="Expected Check-in"
        type="time"
        value={form.expected_check_in}
        onChange={(e) => set('expected_check_in', e.target.value)}
      />
      <Input
        label="Expected Check-out"
        type="time"
        value={form.expected_check_out}
        onChange={(e) => set('expected_check_out', e.target.value)}
      />
      {isEdit && (
        <Select label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </Select>
      )}
      <div className="lg:col-span-2 bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-sm grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Preview label="Scheduled hours" value={`${preview.hours ? preview.hours.toFixed(2) : '—'} h`} hint={form.expected_check_in ? undefined : `Company default ${preview.cin || '09:00'}–${preview.cout || '18:00'}`} />
        <Preview label="Per-day rate" value={formatINR(preview.daily)} />
        <Preview label="Per-hour rate" value={formatINR(preview.hourly)} />
      </div>
      <div className="lg:col-span-2">
        <Textarea label="Notes" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
      </div>
      <Button type="submit" loading={mutation.isPending} className="w-full lg:w-auto min-h-12 px-8 bg-emerald-600 hover:bg-emerald-700">
        Save
      </Button>
      {isEdit && id && <AttendanceRulesEditor employeeId={Number(id)} />}
      <ConfirmDialog
        open={confirmSalary}
        title="Change salary?"
        message="Monthly salary will be updated for this employee."
        confirmLabel="Change salary"
        onCancel={() => setConfirmSalary(false)}
        onConfirm={() => {
          setConfirmSalary(false);
          mutation.mutate();
        }}
      />
    </form>
  );
}

function Preview({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-xs text-emerald-800">{label}</div>
      <div className="font-semibold text-gray-900">{value}</div>
      {hint && <div className="text-xs text-gray-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function AttendanceRulesEditor({ employeeId }: { employeeId: number }) {
  const queryClient = useQueryClient();
  const [threshold, setThreshold] = useState('30');
  const [days, setDays] = useState('3');

  const { data, isLoading } = useQuery({
    queryKey: ['salary-book', 'rules', employeeId],
    queryFn: async () =>
      (await salaryBookApi.employees.attendanceRules.list(employeeId)).data as AttendanceRule[],
  });

  const create = useMutation({
    mutationFn: () =>
      salaryBookApi.employees.attendanceRules.create(employeeId, {
        rule_type: 'CONSECUTIVE_LATE',
        late_threshold_minutes: Number(threshold),
        consecutive_late_days: Number(days),
        is_active: true,
      }),
    onSuccess: async () => {
      toast('Attendance rule added', 'success');
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err, 'Unable to add rule.'), 'error'),
  });

  const toggle = useMutation({
    mutationFn: (rule: AttendanceRule) =>
      salaryBookApi.employees.attendanceRules.update(employeeId, rule.id, { is_active: !rule.is_active }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err, 'Unable to update rule.'), 'error'),
  });

  const remove = useMutation({
    mutationFn: (ruleId: number) => salaryBookApi.employees.attendanceRules.remove(employeeId, ruleId),
    onSuccess: async () => {
      toast('Rule removed', 'success');
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err, 'Unable to delete rule.'), 'error'),
  });

  return (
    <div className="bg-white rounded-xl border border-emerald-100 p-4 space-y-3">
      <h2 className="font-semibold text-gray-900">Attendance rules</h2>
      <p className="text-sm text-gray-600">
        If the employee is late by the threshold for consecutive days, the next check-in is marked absent even if they arrive on time.
      </p>
      {isLoading && <p className="text-sm text-gray-500">Loading rules...</p>}
      {(data || []).map((rule) => (
        <div key={rule.id} className="flex flex-col sm:flex-row sm:items-center gap-2 border border-gray-100 rounded-xl p-3">
          <div className="flex-1 text-sm">
            <div className="font-medium">
              Late ≥ {rule.late_threshold_minutes} min for {rule.consecutive_late_days} consecutive days
            </div>
            <div className="text-gray-500">{rule.is_active ? 'Active' : 'Inactive'} · next day marked absent</div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="min-h-10" onClick={() => toggle.mutate(rule)}>
              {rule.is_active ? 'Disable' : 'Enable'}
            </Button>
            <Button type="button" variant="outline" className="min-h-10 text-red-600" onClick={() => remove.mutate(rule.id)}>
              Delete
            </Button>
          </div>
        </div>
      ))}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input label="Late by (minutes)" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        <Input label="Consecutive days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        <div className="flex items-end">
          <Button
            type="button"
            className="w-full min-h-12 bg-emerald-600 hover:bg-emerald-700"
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Add rule
          </Button>
        </div>
      </div>
    </div>
  );
}
