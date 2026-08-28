import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { salaryBookApi } from '../../lib/api';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { toast } from '../../lib/toast';
import {
  apiError,
  appendGps,
  compressImage,
  formatTime,
  geofenceStatus,
  getCurrentGps,
  GPS_POLL_MS,
  GPS_STALE_MS,
  gpsAgeMs,
  gpsUserMessage,
  statusLabel,
  todayISO,
} from './utils';
import type { Attendance, Employee, GpsFix, Paginated, SalaryBookSettings } from './types';
import { ClipboardCheck, MapPin, RefreshCw, Users } from 'lucide-react';

const STATUSES = [
  { value: 'PRESENT', label: 'Present', photo: true },
  { value: 'HALF_DAY', label: 'Half Day', photo: true },
  { value: 'ABSENT', label: 'Absent', photo: false },
  { value: 'HOLIDAY', label: 'Holiday', photo: false },
  { value: 'PAID_LEAVE', label: 'Paid Leave', photo: false },
  { value: 'UNPAID_LEAVE', label: 'Unpaid Leave', photo: false },
] as const;

export default function AttendancePage() {
  const queryClient = useQueryClient();
  const [gps, setGps] = useState<GpsFix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsLoading, setGpsLoading] = useState(true);
  const [gpsSyncing, setGpsSyncing] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const syncingRef = useRef(false);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [status, setStatus] = useState<(typeof STATUSES)[number]['value']>('PRESENT');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attendanceDate, setAttendanceDate] = useState(todayISO());
  const date = attendanceDate;

  const settingsQuery = useQuery({
    queryKey: ['salary-book', 'settings'],
    queryFn: async () => (await salaryBookApi.settings.get()).data as SalaryBookSettings,
  });

  const locationRequired = settingsQuery.data?.require_gps ?? true;

  const requestGps = async (opts?: { silent?: boolean }) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (!opts?.silent) setGpsLoading(true);
    setGpsSyncing(true);
    try {
      const fix = await getCurrentGps(10000);
      setGps(fix);
      setGpsError(null);
    } catch (err) {
      if (!opts?.silent) {
        setGps(null);
        setGpsError(gpsUserMessage((err as Error).message));
      }
    } finally {
      syncingRef.current = false;
      setGpsLoading(false);
      setGpsSyncing(false);
    }
  };

  useEffect(() => {
    if (!locationRequired) {
      setGpsLoading(false);
      return;
    }
    requestGps();
    const poll = window.setInterval(() => requestGps({ silent: true }), GPS_POLL_MS);
    const tick = window.setInterval(() => setClock(Date.now()), 500);
    let watchId: number | null = null;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setGps({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            capturedAt: new Date().toISOString(),
          });
          setGpsError(null);
        },
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    }
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [locationRequired]);

  const maxAccuracy = settingsQuery.data?.max_gps_accuracy_meters ?? 100;
  const accuracyTooLow = Boolean(locationRequired && gps && gps.accuracy > maxAccuracy);
  const fence = locationRequired && gps && settingsQuery.data ? geofenceStatus(gps, settingsQuery.data) : null;
  const stale = locationRequired && gpsAgeMs(gps, clock) > GPS_STALE_MS;
  const locationBlocked = locationRequired && Boolean(!gps || stale || (fence && !fence.inside));
  const blockedReason = !gps
    ? 'Location required. Sync GPS to continue.'
    : stale
      ? 'Location is stale. Sync GPS to continue.'
      : `You are outside the workplace. Attendance can only be marked within ${fence?.radius ?? 150}m.`;

  const listReady = !locationRequired || (Boolean(gps) && !accuracyTooLow);

  const employeesQuery = useQuery({
    queryKey: ['salary-book', 'employees', 'ACTIVE'],
    queryFn: async () =>
      (await salaryBookApi.employees.list({ status: 'ACTIVE', page_size: 100 })).data as Paginated<Employee>,
    enabled: listReady,
  });

  const todayQuery = useQuery({
    queryKey: ['salary-book', 'attendance', date],
    queryFn: async () =>
      (await salaryBookApi.attendance.list({ date, page_size: 100 })).data as Paginated<Attendance>,
    enabled: listReady,
  });

  const byEmployee = useMemo(() => {
    const map = new Map<number, Attendance>();
    todayQuery.data?.results.forEach((row) => map.set(row.employee, row));
    return map;
  }, [todayQuery.data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    todayQuery.data?.results.forEach((row) => {
      c[row.status] = (c[row.status] || 0) + 1;
    });
    return c;
  }, [todayQuery.data]);

  const needsPhoto = locationRequired && STATUSES.find((s) => s.value === status)?.photo;

  const onPickPhoto = async (file: File) => {
    const blob = await compressImage(file);
    setPhoto(blob);
    setPhotoPreview(URL.createObjectURL(blob));
  };

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selected || !gps) throw new Error('Missing data');
      if (gpsAgeMs(gps) > GPS_STALE_MS) throw new Error('STALE_GPS');
      if (locationBlocked) throw new Error('OUTSIDE_GEOFENCE');
      const form = new FormData();
      form.append('employee', String(selected.id));
      form.append('date', date);
      form.append('status', status);
      appendGps(form, gps);
      if (needsPhoto && photo) {
        form.append('photo', photo, 'attendance.jpg');
      }
      return salaryBookApi.attendance.create(form);
    },
    onSuccess: async (res) => {
      const saved = res.data as Attendance;
      if (saved.rule_penalty_applied) {
        toast(saved.rule_remarks || 'Marked absent due to consecutive late arrivals.', 'error');
      } else {
        toast('Attendance saved', 'success');
      }
      setSelected(null);
      setPhoto(null);
      setPhotoPreview(null);
      setStatus('PRESENT');
      await invalidate();
    },
    onError: (err) => {
      const code = (err as Error).message;
      if (code === 'OUTSIDE_GEOFENCE' || code === 'STALE_GPS') {
        toast(blockedReason, 'error');
        return;
      }
      toast(apiError(err, 'Unable to save attendance.'), 'error');
    },
  });

  const manualMutation = useMutation({
    mutationFn: async ({ employee, attStatus, existing }: { employee: Employee; attStatus: string; existing?: Attendance }) => {
      if (existing) {
        return salaryBookApi.attendance.update(existing.id, { status: attStatus });
      }
      return salaryBookApi.attendance.create({
        employee: employee.id,
        date,
        status: attStatus,
      });
    },
    onSuccess: async () => {
      toast('Attendance saved', 'success');
      setSelected(null);
      setStatus('PRESENT');
      await invalidate();
    },
    onError: (err) => toast(apiError(err, 'Unable to save attendance.'), 'error'),
  });

  const checkoutMutation = useMutation({
    mutationFn: async (row: Attendance) => {
      if (locationRequired) {
        if (!gps || !photo) throw new Error('GPS and photo required');
        if (gpsAgeMs(gps) > GPS_STALE_MS) throw new Error('STALE_GPS');
        if (locationBlocked) throw new Error('OUTSIDE_GEOFENCE');
        const form = new FormData();
        form.append('action', 'checkout');
        appendGps(form, gps, 'check_out_');
        form.append('check_out_photo', photo, 'checkout.jpg');
        return salaryBookApi.attendance.update(row.id, form);
      }
      return salaryBookApi.attendance.update(row.id, { action: 'checkout' });
    },
    onSuccess: async () => {
      toast('Check-out saved', 'success');
      setSelected(null);
      setPhoto(null);
      setPhotoPreview(null);
      await invalidate();
    },
    onError: (err) => toast(apiError(err, 'Unable to save check-out.'), 'error'),
  });

  if (settingsQuery.isLoading) {
    return <LoadingState message="Loading attendance settings..." />;
  }

  if (locationRequired && gpsLoading) {
    return <LoadingState message="Getting your location..." />;
  }

  if (locationRequired && (gpsError || !gps)) {
    return (
      <div className="bg-white rounded-xl border border-red-100 p-6 text-center space-y-4">
        <MapPin className="h-10 w-10 text-red-400 mx-auto" />
        <h1 className="text-xl font-bold">Location Required</h1>
        <p className="text-sm text-gray-600">
          We need your current location to mark attendance. Please enable location permission and try again.
        </p>
        <p className="text-sm text-red-600">{gpsError}</p>
        <SyncGpsButton syncing={gpsSyncing} onClick={() => requestGps()} />
      </div>
    );
  }

  if (locationRequired && accuracyTooLow && gps) {
    return (
      <div className="bg-white rounded-xl border border-amber-100 p-6 text-center space-y-4">
        <MapPin className="h-10 w-10 text-amber-500 mx-auto" />
        <h1 className="text-xl font-bold">Accuracy too low</h1>
        <p className="text-sm text-gray-600">
          Your location accuracy is too low. Please move to an area with better GPS signal and try again.
        </p>
        <p className="text-sm text-gray-500">Accuracy: {Math.round(gps.accuracy)}m (max {maxAccuracy}m)</p>
        <SyncGpsButton syncing={gpsSyncing} onClick={() => requestGps()} />
      </div>
    );
  }

  const ageSec = gps ? Math.round(gpsAgeMs(gps, clock) / 1000) : 0;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold text-gray-900">Attendance</h1>
          {locationRequired && <SyncGpsButton compact syncing={gpsSyncing} onClick={() => requestGps()} />}
        </div>
        {!locationRequired ? (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Manual attendance mode is on. Location is not required — pick a date, employee, and status to mark attendance.
            </p>
            <Input
              label="Attendance date"
              type="date"
              value={attendanceDate}
              onChange={(e) => setAttendanceDate(e.target.value)}
            />
          </div>
        ) : (
          <>
            <p className={`text-sm mt-1 flex items-center gap-1 ${stale ? 'text-red-600' : 'text-emerald-700'}`}>
              <MapPin className="h-4 w-4" />
              {stale ? 'Stale location' : 'Live location'} · Accuracy {Math.round(gps!.accuracy)}m · synced {ageSec}s ago
            </p>
            {fence && (
              <p className={`text-sm mt-1 ${fence.inside && !stale ? 'text-emerald-700' : 'text-red-600'}`}>
                {fence.inside
                  ? `Inside workplace (${Math.round(fence.distance ?? 0)}m of ${fence.radius}m allowed)`
                  : `Outside workplace — ${Math.round(fence.distance ?? 0)}m away. No attendance until you are inside ${fence.radius}m.`}
              </p>
            )}
            {locationBlocked && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {blockedReason}
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-3 lg:grid-cols-5 gap-2">
        {[
          ['Present', counts.PRESENT || 0],
          ['Absent', counts.ABSENT || 0],
          ['Paid Leave', counts.PAID_LEAVE || 0],
          ['Unpaid', counts.UNPAID_LEAVE || 0],
          ['Half Day', counts.HALF_DAY || 0],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-white rounded-xl border border-emerald-100 p-3">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-xl font-semibold">{value}</div>
          </div>
        ))}
      </div>

      {employeesQuery.isLoading && <LoadingState message="Loading employees..." />}
      {employeesQuery.isError && <ErrorState onRetry={() => employeesQuery.refetch()} />}
      {!employeesQuery.isLoading && (employeesQuery.data?.results.length ?? 0) === 0 && (
        <EmptyState icon={Users} title="No active employees" message="Add an employee before marking attendance." />
      )}

      <div className="space-y-2 lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-3 lg:space-y-0">
        {employeesQuery.data?.results.map((emp) => {
          const row = byEmployee.get(emp.id);
          return (
            <button
              key={emp.id}
              type="button"
              onClick={() => {
                if (locationBlocked) {
                  toast(blockedReason, 'error');
                  return;
                }
                setSelected(emp);
                setStatus((row?.status as (typeof STATUSES)[number]['value']) || 'PRESENT');
                setPhoto(null);
                setPhotoPreview(null);
              }}
              className={`w-full text-left bg-white rounded-xl border p-4 ${
                locationBlocked ? 'border-gray-200 opacity-60' : 'border-emerald-100'
              }`}
            >
              <div className="font-semibold">{emp.name}</div>
              {row ? (
                <div className="text-sm text-gray-600">
                  {statusLabel(row.status)}
                  {row.check_in_time ? ` · ${formatTime(row.check_in_time)}` : ''}
                  {row.check_out_time ? ' · Out' : ''}
                  {row.is_late && row.minutes_late ? ` · Late ${row.minutes_late}m` : ''}
                  {row.rule_penalty_applied ? ' · Penalty absent' : ''}
                </div>
              ) : (
                <div className="text-sm text-gray-400">Not marked</div>
              )}
            </button>
          );
        })}
      </div>

      {selected && (
        <MarkSheet
          employee={selected}
          existing={byEmployee.get(selected.id)}
          status={status}
          setStatus={setStatus}
          manualMode={!locationRequired}
          locationBlocked={locationBlocked}
          blockedReason={blockedReason}
          fence={fence}
          gpsSyncing={gpsSyncing}
          onSyncGps={() => requestGps()}
          needsPhoto={Boolean(needsPhoto) || Boolean(byEmployee.get(selected.id) && !byEmployee.get(selected.id)?.check_out_time)}
          photoPreview={photoPreview}
          fileRef={fileRef}
          onPickPhoto={onPickPhoto}
          loading={mutation.isPending || checkoutMutation.isPending || manualMutation.isPending}
          onClose={() => {
            setSelected(null);
            setPhoto(null);
            setPhotoPreview(null);
          }}
          onSave={() => {
            const existing = byEmployee.get(selected.id);
            if (!locationRequired) {
              manualMutation.mutate({ employee: selected, attStatus: status, existing });
              return;
            }
            if (locationBlocked) {
              toast(blockedReason, 'error');
              return;
            }
            if (existing && ['PRESENT', 'HALF_DAY'].includes(existing.status) && !existing.check_out_time) {
              if (settingsQuery.data?.require_checkout_gps_photo && !photo) {
                toast('A selfie is required to check out.', 'error');
                return;
              }
              checkoutMutation.mutate(existing);
              return;
            }
            if (existing) {
              toast('Attendance for this employee today already exists.', 'error');
              return;
            }
            if (needsPhoto && !photo) {
              toast('Take a selfie to mark present.', 'error');
              return;
            }
            mutation.mutate();
          }}
        />
      )}
    </div>
  );
}

function SyncGpsButton({
  onClick,
  syncing,
  compact,
}: {
  onClick: () => void;
  syncing: boolean;
  compact?: boolean;
}) {
  return (
    <Button
      type="button"
      variant={compact ? 'outline' : 'primary'}
      className={`${compact ? 'min-h-11 px-3' : 'w-full min-h-12'} ${compact ? '' : 'bg-emerald-600 hover:bg-emerald-700'}`}
      loading={syncing}
      onClick={onClick}
    >
      <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
      Sync GPS
    </Button>
  );
}

function MarkSheet(props: {
  employee: Employee;
  existing?: Attendance;
  status: string;
  setStatus: (s: (typeof STATUSES)[number]['value']) => void;
  manualMode: boolean;
  locationBlocked: boolean;
  blockedReason: string;
  fence: { inside: boolean; distance: number | null; radius: number } | null;
  gpsSyncing: boolean;
  onSyncGps: () => void;
  needsPhoto: boolean;
  photoPreview: string | null;
  fileRef: RefObject<HTMLInputElement | null>;
  onPickPhoto: (file: File) => void;
  loading: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const checkoutMode = Boolean(
    !props.manualMode
    && props.existing
    && ['PRESENT', 'HALF_DAY'].includes(props.existing.status)
    && !props.existing.check_out_time
  );
  const photoNeeded = !props.manualMode && (checkoutMode || STATUSES.find((s) => s.value === props.status)?.photo);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-gray-900/40" onClick={props.onClose} />
      <div className="absolute bottom-0 left-0 right-0 lg:bottom-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 bg-white rounded-t-2xl lg:rounded-2xl p-5 max-w-lg mx-auto w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <h2 className="font-semibold text-lg">{props.employee.name}</h2>
        <p className="text-sm text-gray-500">{props.employee.employee_id}</p>

        {checkoutMode ? (
          <p className="mt-3 text-sm text-gray-700">Record check-out with GPS and photograph.</p>
        ) : (
          <>
            {props.existing && (
              <p className="mt-3 text-sm text-gray-600">
                Currently {statusLabel(props.existing.status)}
                {props.manualMode ? ' — choose a new status to update.' : '.'}
              </p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => props.setStatus(s.value)}
                  className={`min-h-12 rounded-xl border text-sm ${
                    props.status === s.value ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </>
        )}

        {photoNeeded && !props.existing?.check_out_time && (
          <div className="mt-4 space-y-3">
            {props.photoPreview ? (
              <img src={props.photoPreview} alt="Attendance preview" className="w-full rounded-xl max-h-64 object-cover" />
            ) : (
              <div className="h-40 rounded-xl bg-gray-100 flex items-center justify-center text-sm text-gray-500">
                No selfie yet
              </div>
            )}
            {props.locationBlocked && (
              <p className="text-sm text-red-600">{props.blockedReason}</p>
            )}
            <input
              ref={props.fileRef}
              type="file"
              accept="image/*"
              capture="user"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) props.onPickPhoto(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full min-h-12"
              onClick={() => props.fileRef.current?.click()}
            >
              {props.photoPreview ? 'Retake selfie' : 'Take selfie'}
            </Button>
          </div>
        )}

        {!props.manualMode && (
          <div className="mt-4">
            <SyncGpsButton syncing={props.gpsSyncing} onClick={props.onSyncGps} />
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Button type="button" variant="outline" className="min-h-12" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            className="min-h-12 bg-emerald-600 hover:bg-emerald-700"
            loading={props.loading}
            disabled={!props.manualMode && (props.locationBlocked || (Boolean(props.existing) && !checkoutMode))}
            onClick={props.onSave}
          >
            <ClipboardCheck className="h-4 w-4" />
            {checkoutMode ? 'Confirm Check-out' : props.existing && props.manualMode ? 'Update Attendance' : 'Confirm Attendance'}
          </Button>
        </div>
      </div>
    </div>
  );
}
