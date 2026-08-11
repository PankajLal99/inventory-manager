import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { salaryBookApi } from '../../lib/api';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Textarea from '../../components/ui/Textarea';
import Button from '../../components/ui/Button';
import LoadingState from '../../components/ui/LoadingState';
import { toast } from '../../lib/toast';
import { apiError, todayISO } from './utils';
import ConfirmDialog from './components/ConfirmDialog';
import type { Employee } from './types';

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
      {isEdit && (
        <Select label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </Select>
      )}
      <div className="lg:col-span-2">
        <Textarea label="Notes" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
      </div>
      <Button type="submit" loading={mutation.isPending} className="w-full lg:w-auto min-h-12 px-8 bg-emerald-600 hover:bg-emerald-700">
        Save
      </Button>
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
