import { useEffect, useState } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';

export type ManualAttendanceTarget = {
  employeeId: number;
  employeeName: string;
  date: string;
};

type Props = {
  target: ManualAttendanceTarget | null;
  loading?: boolean;
  defaultCheckIn?: string;
  defaultCheckOut?: string;
  onClose: () => void;
  onSave: (payload: { checkIn: string; checkOut: string }) => void;
};

function formatDayLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function ManualAttendanceDialog({
  target,
  loading,
  defaultCheckIn = '',
  defaultCheckOut = '',
  onClose,
  onSave,
}: Props) {
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!target) return;
    setCheckIn(defaultCheckIn.slice(0, 5));
    setCheckOut(defaultCheckOut.slice(0, 5));
    setError('');
  }, [target, defaultCheckIn, defaultCheckOut]);

  if (!target) return null;

  const submit = () => {
    if (!checkIn || !checkOut) {
      setError('Enter both check-in and check-out times.');
      return;
    }
    if (checkOut <= checkIn) {
      setError('Check-out must be after check-in.');
      return;
    }
    setError('');
    onSave({ checkIn, checkOut });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} aria-hidden />
      <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">Add attendance times</h3>
        <p className="mt-1 text-sm text-gray-600">
          {target.employeeName} · {formatDayLabel(target.date)}
        </p>
        <p className="mt-2 text-xs text-gray-500">
          Only unmarked days can be filled. Existing attendance cannot be edited here.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Input
            label="Check-in"
            type="time"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
          />
          <Input
            label="Check-out"
            type="time"
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button type="button" variant="outline" className="min-h-12" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            className="min-h-12 bg-emerald-600 hover:bg-emerald-700"
            loading={loading}
            onClick={submit}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
