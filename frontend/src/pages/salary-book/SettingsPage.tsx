import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import Select from '../../components/ui/Select';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { toast } from '../../lib/toast';
import { apiError, getCurrentGps, gpsUserMessage } from './utils';
import type { SalaryBookSettings } from './types';
import { auth } from '../../lib/auth';
import ConfirmDialog from './components/ConfirmDialog';

function isAdminUser(user: { is_superuser?: boolean; groups?: string[] } | null) {
  if (!user) return false;
  return Boolean(user.is_superuser || user.groups?.includes('Admin'));
}

function formatDeltaLabel(minutes: number) {
  if (!minutes) return 'No adjustment (0 min)';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (mins || !hours) parts.push(`${mins}m`);
  return `${minutes > 0 ? '+' : '−'}${parts.join(' ')}`;
}

function formatClockTime(d: Date) {
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(auth.getUser('salary_book'));
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['salary-book', 'settings'],
    queryFn: async () => (await salaryBookApi.settings.get()).data as SalaryBookSettings,
  });
  const [form, setForm] = useState<SalaryBookSettings | null>(null);
  const [locating, setLocating] = useState(false);
  const [serverNow, setServerNow] = useState(() => new Date());
  const [deltaConfirmOpen, setDeltaConfirmOpen] = useState(false);

  useEffect(() => {
    auth.loadUser('salary_book').then(setUser).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  useEffect(() => {
    const id = window.setInterval(() => setServerNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const mutation = useMutation({
    mutationFn: async (opts?: { confirmMachineTimeDelta?: boolean }) =>
      salaryBookApi.settings.update({
        salary_calculation_method: form?.salary_calculation_method,
        fixed_working_days: Number(form?.fixed_working_days),
        max_gps_accuracy_meters: Number(form?.max_gps_accuracy_meters),
        office_latitude: form?.office_latitude,
        office_longitude: form?.office_longitude,
        geofence_radius_meters: Number(form?.geofence_radius_meters),
        require_photo: form?.require_photo,
        require_checkout_gps_photo: form?.require_checkout_gps_photo,
        default_check_in: form?.default_check_in,
        default_check_out: form?.default_check_out,
        machine_time_delta_minutes: Number(form?.machine_time_delta_minutes ?? 0),
        ...(opts?.confirmMachineTimeDelta ? { confirm_machine_time_delta: true } : {}),
        ...(isAdminUser(user)
          ? { attendance_capture_mode: form?.attendance_capture_mode }
          : {}),
      }),
    onSuccess: async () => {
      setDeltaConfirmOpen(false);
      toast('Settings saved', 'success');
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err, 'Unable to save settings.'), 'error'),
  });

  const savedDelta = Number(data?.machine_time_delta_minutes ?? 0);
  const deltaLocked = Boolean(data?.machine_time_delta_locked);
  const formDelta = Number(form?.machine_time_delta_minutes ?? 0);
  const deltaChanging = !deltaLocked && formDelta !== savedDelta;

  const requestSave = () => {
    if (deltaChanging) {
      setDeltaConfirmOpen(true);
      return;
    }
    mutation.mutate({});
  };

  const useCurrentLocation = async () => {
    setLocating(true);
    try {
      const gps = await getCurrentGps();
      setForm((prev) =>
        prev
          ? {
              ...prev,
              office_latitude: gps.latitude.toFixed(6),
              office_longitude: gps.longitude.toFixed(6),
            }
          : prev
      );
      toast('Office location set to your current GPS. Save to apply.', 'success');
    } catch (err) {
      toast(gpsUserMessage((err as Error).message), 'error');
    } finally {
      setLocating(false);
    }
  };

  if (isLoading || !form) return <LoadingState message="Loading settings..." />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  const admin = isAdminUser(user);
  const captureMode =
    form.attendance_capture_mode || (form.require_gps ? 'GEO' : 'MANUAL');
  const isGeoMode = captureMode === 'GEO';
  const isHardwareMode = captureMode === 'HARDWARE';
  const deltaMinutes = Number(form.machine_time_delta_minutes ?? 0);
  const serverTimeLabel = formatClockTime(serverNow);
  // Example: if machine clock is `delta` minutes behind server, a punch "now" on device → stored + delta.
  const machinePreview = new Date(serverNow.getTime() - deltaMinutes * 60_000);
  const machineTimeLabel = formatClockTime(machinePreview);
  const storedAfterDeltaPreview = new Date(
    machinePreview.getTime() + deltaMinutes * 60_000
  );
  const storedAfterDeltaLabel = formatClockTime(storedAfterDeltaPreview);

  return (
    <>
    <form
      className="space-y-4 lg:max-w-3xl"
      onSubmit={(e) => {
        e.preventDefault();
        requestSave();
      }}
    >
      <h1 className="text-xl lg:text-2xl font-bold">Settings</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Select
        label="Salary Calculation Method"
        value={form.salary_calculation_method}
        onChange={(e) =>
          setForm({ ...form, salary_calculation_method: e.target.value as SalaryBookSettings['salary_calculation_method'] })
        }
      >
        <option value="CALENDAR_DAYS">Calendar Days</option>
        <option value="FIXED_WORKING_DAYS">Fixed Working Days</option>
      </Select>
      {form.salary_calculation_method === 'FIXED_WORKING_DAYS' && (
        <Input
          label="Fixed Working Days"
          inputMode="numeric"
          value={String(form.fixed_working_days)}
          onChange={(e) => setForm({ ...form, fixed_working_days: Number(e.target.value) })}
        />
      )}
      <Input
        label="Default check-in"
        type="time"
        value={String(form.default_check_in || '').slice(0, 5)}
        onChange={(e) => setForm({ ...form, default_check_in: e.target.value })}
      />
      <Input
        label="Default check-out"
        type="time"
        value={String(form.default_check_out || '').slice(0, 5)}
        onChange={(e) => setForm({ ...form, default_check_out: e.target.value })}
      />
      {isGeoMode && (
        <Input
          label="Maximum GPS Accuracy (meters)"
          inputMode="numeric"
          value={String(form.max_gps_accuracy_meters)}
          onChange={(e) => setForm({ ...form, max_gps_accuracy_meters: Number(e.target.value) })}
        />
      )}

      </div>
      {isGeoMode && (
      <div className="bg-white rounded-xl border border-emerald-100 p-4 space-y-3 lg:col-span-2">
        <h2 className="font-semibold">Workplace geofence</h2>
        <p className="text-xs text-gray-500">
          When Geo capture mode is on, attendance can only be marked inside this radius.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Input
          label="Office latitude"
          value={String(form.office_latitude ?? '')}
          onChange={(e) => setForm({ ...form, office_latitude: e.target.value })}
        />
        <Input
          label="Office longitude"
          value={String(form.office_longitude ?? '')}
          onChange={(e) => setForm({ ...form, office_longitude: e.target.value })}
        />
        <Input
          label="Allowed radius (meters)"
          inputMode="numeric"
          value={String(form.geofence_radius_meters)}
          onChange={(e) => setForm({ ...form, geofence_radius_meters: Number(e.target.value) })}
        />
        </div>
        <Button type="button" variant="outline" className="w-full lg:w-auto min-h-12" loading={locating} onClick={useCurrentLocation}>
          Use my current location as office
        </Button>
      </div>
      )}

      <div className="bg-white rounded-xl border border-emerald-100 p-4 space-y-3 text-sm">
        <h2 className="font-semibold text-gray-900">Attendance capture</h2>
        {admin ? (
          <Select
            label="Capture mode"
            value={captureMode}
            onChange={(e) =>
              setForm({
                ...form,
                attendance_capture_mode: e.target.value as SalaryBookSettings['attendance_capture_mode'],
              })
            }
          >
            <option value="HARDWARE">Hardware (fingerprint / card)</option>
            <option value="GEO">Geo (GPS + selfie)</option>
            <option value="MANUAL">Manual</option>
          </Select>
        ) : (
          <div className="flex justify-between">
            <span>Capture mode</span>
            <span className="font-medium">
              {captureMode === 'HARDWARE'
                ? 'Hardware'
                : captureMode === 'MANUAL'
                  ? 'Manual'
                  : 'Geo'}
            </span>
          </div>
        )}
        <p className="text-xs text-gray-500">
          {captureMode === 'HARDWARE'
            ? 'Punches from the biometric device create attendance automatically. Map device PINs under More → Devices, then push name+PIN to the K45 (no fingerprint/password).'
            : captureMode === 'MANUAL'
              ? 'Admins mark attendance without GPS or geofence.'
              : 'Employees must be inside the workplace geofence and provide a selfie when required.'}
        </p>
        {isHardwareMode && (
          <div className="rounded-lg border border-emerald-50 bg-emerald-50/40 p-3 space-y-3">
            <div>
              <h3 className="font-medium text-gray-900">Machine time delta</h3>
              <p className="text-xs text-gray-500 mt-1">
                Correct biometric clock skew. If the machine is behind server time, enter a positive
                value (e.g. +10). If ahead, enter negative (e.g. −10).
                {' '}
                This can only be changed once. Saving updates existing hardware attendance and can
                affect late / salary calculations.
              </p>
            </div>
            {deltaLocked ? (
              <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Locked at {formatDeltaLabel(savedDelta)}. Machine time delta can only be set once.
              </p>
            ) : null}
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
              <div className="space-y-3">
                <Input
                  label="Delta (minutes)"
                  inputMode="numeric"
                  disabled={deltaLocked}
                  value={String(form.machine_time_delta_minutes ?? 0)}
                  onChange={(e) => {
                    if (deltaLocked) return;
                    const raw = e.target.value.trim();
                    if (raw === '' || raw === '-' || raw === '+') {
                      setForm({ ...form, machine_time_delta_minutes: 0 });
                      return;
                    }
                    const next = Number(raw);
                    if (Number.isNaN(next)) return;
                    setForm({ ...form, machine_time_delta_minutes: Math.trunc(next) });
                  }}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 px-3"
                    disabled={deltaLocked}
                    onClick={() =>
                      setForm({
                        ...form,
                        machine_time_delta_minutes: deltaMinutes - 1,
                      })
                    }
                  >
                    −1
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 px-3"
                    disabled={deltaLocked}
                    onClick={() =>
                      setForm({
                        ...form,
                        machine_time_delta_minutes: deltaMinutes + 1,
                      })
                    }
                  >
                    +1
                  </Button>
                </div>
              </div>
              {!deltaLocked ? (
                <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2.5 sm:min-w-[13.5rem] sm:mb-0 mb-1">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                    Punch now → saved time
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-sm tabular-nums">
                    <span className="text-gray-600" title="Estimated machine clock">
                      {machineTimeLabel}
                    </span>
                    <span className="text-gray-400 shrink-0" aria-hidden>
                      →
                    </span>
                    <span
                      className="font-semibold text-emerald-800"
                      title="Time stored in attendance after delta"
                    >
                      {storedAfterDeltaLabel}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-gray-500 leading-snug">
                    Updates as you change delta. Match this saved time to server (
                    {serverTimeLabel}) when the machine is that far off.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-100 bg-amber-50/80 px-3 py-2.5 sm:min-w-[13.5rem]">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-amber-900/70">
                    Saved time (locked)
                  </p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-amber-950">
                    {formatDeltaLabel(savedDelta)} on each machine punch
                  </p>
                </div>
              )}
            </div>
            <div className="text-xs text-gray-600 space-y-1">
              <div className="flex justify-between gap-3">
                <span>Server time (correct)</span>
                <span className="font-medium tabular-nums">{serverTimeLabel}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>Adjustment</span>
                <span className="font-medium">{formatDeltaLabel(deltaMinutes)}</span>
              </div>
            </div>
          </div>
        )}
        {isGeoMode && (
          <>
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span>Require selfie for present / half day</span>
              <input
                type="checkbox"
                className="h-5 w-5 rounded border-gray-300 text-emerald-600"
                checked={form.require_photo}
                onChange={(e) => setForm({ ...form, require_photo: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span>Require selfie for check-out</span>
              <input
                type="checkbox"
                className="h-5 w-5 rounded border-gray-300 text-emerald-600"
                checked={form.require_checkout_gps_photo}
                onChange={(e) => setForm({ ...form, require_checkout_gps_photo: e.target.checked })}
              />
            </label>
          </>
        )}
      </div>
      <Button type="submit" className="w-full lg:w-auto min-h-12 px-8 bg-emerald-600 hover:bg-emerald-700" loading={mutation.isPending}>
        Save Settings
      </Button>
    </form>
    <ConfirmDialog
      open={deltaConfirmOpen}
      title="Change machine time delta?"
      message={
        `You are changing the machine time delta from ${formatDeltaLabel(savedDelta)} to ${formatDeltaLabel(formDelta)}.\n\n` +
        'Existing hardware attendance entries will be updated, and late / worked-time / salary calculations may change.\n\n' +
        'This can only be changed once. After you confirm, the delta will be locked permanently.'
      }
      confirmLabel="Confirm & lock"
      danger
      loading={mutation.isPending}
      onCancel={() => setDeltaConfirmOpen(false)}
      onConfirm={() => mutation.mutate({ confirmMachineTimeDelta: true })}
    />
    </>
  );
}
