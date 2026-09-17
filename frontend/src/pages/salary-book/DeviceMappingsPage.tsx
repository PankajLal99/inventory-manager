import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, RefreshCw } from 'lucide-react';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import { toast } from '../../lib/toast';
import { apiError } from './utils';
import type {
  AttendanceDevice,
  DeviceCommand,
  DeviceUserMapping,
  Employee,
  Paginated,
} from './types';
import { auth } from '../../lib/auth';

function isAdminUser(user: { is_superuser?: boolean; groups?: string[] } | null) {
  if (!user) return false;
  return Boolean(user.is_superuser || user.groups?.includes('Admin'));
}

export default function DeviceMappingsPage() {
  const queryClient = useQueryClient();
  const user = auth.getUser('salary_book');
  const admin = isAdminUser(user);

  const devicesQuery = useQuery({
    queryKey: ['salary-book', 'devices'],
    queryFn: async () => (await salaryBookApi.devices.list()).data as AttendanceDevice[],
  });
  const mappingsQuery = useQuery({
    queryKey: ['salary-book', 'device-mappings'],
    queryFn: async () => (await salaryBookApi.deviceMappings.list()).data as DeviceUserMapping[],
  });
  const employeesQuery = useQuery({
    queryKey: ['salary-book', 'employees', 'ACTIVE'],
    queryFn: async () =>
      (await salaryBookApi.employees.list({ status: 'ACTIVE', page_size: 200 })).data as Paginated<Employee>,
  });
  const commandsQuery = useQuery({
    queryKey: ['salary-book', 'device-commands'],
    queryFn: async () => (await salaryBookApi.deviceCommands.list()).data as DeviceCommand[],
    refetchInterval: 15000,
  });

  const [deviceId, setDeviceId] = useState('');
  const [pin, setPin] = useState('');
  const [employeeId, setEmployeeId] = useState('');

  const createMutation = useMutation({
    mutationFn: async (payload: { device: number; device_user_id: string; employee_id: string }) =>
      salaryBookApi.deviceMappings.create(payload),
    onSuccess: async () => {
      toast('Mapped and queued push to device (name + PIN only)', 'success');
      setPin('');
      await queryClient.invalidateQueries({ queryKey: ['salary-book', 'device-mappings'] });
      await queryClient.invalidateQueries({ queryKey: ['salary-book', 'device-commands'] });
    },
    onError: (err) => toast(apiError(err, 'Unable to save mapping.'), 'error'),
  });

  const syncMutation = useMutation({
    mutationFn: async (id: number) => salaryBookApi.deviceMappings.sync(id),
    onSuccess: async () => {
      toast('Re-queued device register command', 'success');
      await queryClient.invalidateQueries({ queryKey: ['salary-book', 'device-commands'] });
    },
    onError: (err) => toast(apiError(err, 'Sync failed.'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => salaryBookApi.deviceMappings.remove(id),
    onSuccess: async () => {
      toast('Mapping removed; delete queued on device', 'success');
      await queryClient.invalidateQueries({ queryKey: ['salary-book', 'device-mappings'] });
      await queryClient.invalidateQueries({ queryKey: ['salary-book', 'device-commands'] });
    },
    onError: (err) => toast(apiError(err, 'Delete failed.'), 'error'),
  });

  const syncAllMutation = useMutation({
    mutationFn: async (id: number) => salaryBookApi.devices.syncMappings(id),
    onSuccess: async (res) => {
      toast(`Queued ${(res.data as { queued?: number }).queued ?? 0} command(s)`, 'success');
      await queryClient.invalidateQueries({ queryKey: ['salary-book', 'device-commands'] });
    },
    onError: (err) => toast(apiError(err, 'Sync all failed.'), 'error'),
  });

  const devices = devicesQuery.data || [];
  const defaultDevice = useMemo(() => {
    if (deviceId) return deviceId;
    const active = devices.find((d) => d.is_active) || devices[0];
    return active ? String(active.id) : '';
  }, [deviceId, devices]);

  if (devicesQuery.isLoading || mappingsQuery.isLoading) {
    return <LoadingState message="Loading devices..." />;
  }
  if (devicesQuery.isError || mappingsQuery.isError) {
    return <ErrorState onRetry={() => { devicesQuery.refetch(); mappingsQuery.refetch(); }} />;
  }

  return (
    <div className="space-y-4 lg:max-w-4xl">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold">Device mappings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Map fingerprint machine PIN → Salary Book employee. Push registers name + PIN only (no
          fingerprint or password). Device picks commands up on the next ~30s poll.
        </p>
      </div>

      {devices.length === 0 ? (
        <EmptyState
          icon={Fingerprint}
          title="No devices yet"
          message="Start the ADMS server and let the K45 connect, or approve the device in Django admin."
        />
      ) : (
        <div className="bg-white rounded-xl border border-emerald-100 p-4 space-y-3">
          <h2 className="font-semibold">Devices</h2>
          {devices.map((d) => (
            <div key={d.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm border-b border-gray-50 py-2 last:border-0">
              <div>
                <div className="font-medium">{d.device_name || d.serial_number}</div>
                <div className="text-gray-500">
                  {d.serial_number} · {d.is_active ? 'Active' : d.status}
                  {d.last_seen_at ? ` · last seen ${new Date(d.last_seen_at).toLocaleString('en-IN')}` : ''}
                </div>
              </div>
              {admin && d.is_active && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-10"
                  loading={syncAllMutation.isPending}
                  onClick={() => syncAllMutation.mutate(d.id)}
                >
                  <RefreshCw className="h-4 w-4" />
                  Push all users
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {admin && devices.length > 0 && (
        <form
          className="bg-white rounded-xl border border-emerald-100 p-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const did = Number(deviceId || defaultDevice);
            if (!did || !pin.trim() || !employeeId) {
              toast('Device, PIN, and employee are required.', 'error');
              return;
            }
            createMutation.mutate({
              device: did,
              device_user_id: pin.trim(),
              employee_id: employeeId,
            });
          }}
        >
          <h2 className="font-semibold">Add mapping</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Select
              label="Device"
              value={deviceId || defaultDevice}
              onChange={(e) => setDeviceId(e.target.value)}
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.serial_number}
                </option>
              ))}
            </Select>
            <Input
              label="Device PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="e.g. 2"
            />
            <Select
              label="Employee"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">Select…</option>
              {employeesQuery.data?.results.map((emp) => (
                <option key={emp.id} value={emp.employee_id}>
                  {emp.name} ({emp.employee_id})
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 min-h-11" loading={createMutation.isPending}>
            Save &amp; push to device
          </Button>
        </form>
      )}

      <div className="bg-white rounded-xl border border-emerald-100 overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold">Mappings</div>
        {(mappingsQuery.data?.length ?? 0) === 0 ? (
          <p className="p-4 text-sm text-gray-500">No PIN mappings yet.</p>
        ) : (
          <div className="divide-y">
            {mappingsQuery.data!.map((m) => (
              <div key={m.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm">
                <div>
                  <div className="font-medium">
                    PIN {m.device_user_id} → {m.employee_name || m.employee_id}
                  </div>
                  <div className="text-gray-500">
                    {m.device_serial} · {m.employee_id}
                    {m.pending_commands ? ` · ${m.pending_commands} pending cmd` : ''}
                  </div>
                </div>
                {admin && (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-10"
                      loading={syncMutation.isPending}
                      onClick={() => syncMutation.mutate(m.id)}
                    >
                      Push
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-10 text-red-600"
                      loading={deleteMutation.isPending}
                      onClick={() => {
                        if (window.confirm(`Remove PIN ${m.device_user_id}?`)) {
                          deleteMutation.mutate(m.id);
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-emerald-100 overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold">Recent device commands</div>
        {(commandsQuery.data?.length ?? 0) === 0 ? (
          <p className="p-4 text-sm text-gray-500">No commands queued yet.</p>
        ) : (
          <div className="divide-y max-h-64 overflow-y-auto">
            {commandsQuery.data!.slice(0, 20).map((c) => (
              <div key={c.id} className="px-4 py-2 text-xs font-mono text-gray-700">
                #{c.id} [{c.status}] {c.purpose} PIN={c.related_pin || '—'} {c.related_employee_id}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
