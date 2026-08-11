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

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['salary-book', 'settings'],
    queryFn: async () => (await salaryBookApi.settings.get()).data as SalaryBookSettings,
  });
  const [form, setForm] = useState<SalaryBookSettings | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const mutation = useMutation({
    mutationFn: async () =>
      salaryBookApi.settings.update({
        salary_calculation_method: form?.salary_calculation_method,
        fixed_working_days: Number(form?.fixed_working_days),
        max_gps_accuracy_meters: Number(form?.max_gps_accuracy_meters),
        office_latitude: form?.office_latitude,
        office_longitude: form?.office_longitude,
        geofence_radius_meters: Number(form?.geofence_radius_meters),
        require_photo: form?.require_photo,
        require_checkout_gps_photo: form?.require_checkout_gps_photo,
      }),
    onSuccess: async () => {
      toast('Settings saved', 'success');
      await queryClient.invalidateQueries({ queryKey: ['salary-book'] });
    },
    onError: (err) => toast(apiError(err, 'Unable to save settings.'), 'error'),
  });

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

  return (
    <form
      className="space-y-4 lg:max-w-3xl"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
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
        label="Maximum GPS Accuracy (meters)"
        inputMode="numeric"
        value={String(form.max_gps_accuracy_meters)}
        onChange={(e) => setForm({ ...form, max_gps_accuracy_meters: Number(e.target.value) })}
      />

      </div>
      <div className="bg-white rounded-xl border border-emerald-100 p-4 space-y-3 lg:col-span-2">
        <h2 className="font-semibold">Workplace geofence</h2>
        <p className="text-xs text-gray-500">
          No attendance of any kind can be marked outside this radius. Present also requires a live selfie.
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

      <div className="bg-white rounded-xl border border-emerald-100 p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span>Require selfie</span>
          <span className="font-medium">{form.require_photo ? 'ON' : 'OFF'}</span>
        </div>
        <div className="flex justify-between">
          <span>Require GPS</span>
          <span className="font-medium">ALWAYS ON</span>
        </div>
        <p className="text-xs text-gray-500">GPS cannot be turned off for attendance.</p>
      </div>
      <Button type="submit" className="w-full lg:w-auto min-h-12 px-8 bg-emerald-600 hover:bg-emerald-700" loading={mutation.isPending}>
        Save Settings
      </Button>
    </form>
  );
}
