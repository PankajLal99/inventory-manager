import { statusLabel } from '../utils';
import { cx, STATUS_PILL } from './tokens';

export default function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  const key = status || 'UNMARKED';
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        STATUS_PILL[key] || STATUS_PILL.UNMARKED,
        className
      )}
    >
      {label || statusLabel(key)}
    </span>
  );
}
