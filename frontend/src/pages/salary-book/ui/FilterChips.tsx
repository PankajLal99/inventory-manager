import { cx } from './tokens';

export type FilterChip<T extends string> = { key: T; label: string };

export default function FilterChips<T extends string>({
  chips,
  value,
  onChange,
  className,
}: {
  chips: ReadonlyArray<FilterChip<T>>;
  value: T;
  onChange: (key: T) => void;
  className?: string;
}) {
  return (
    <div className={cx('flex gap-2 overflow-x-auto pb-1 -mx-1 px-1', className)}>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onChange(chip.key)}
          className={cx(
            'px-3 py-1.5 rounded-full text-sm whitespace-nowrap min-h-9 border transition-colors',
            value === chip.key
              ? 'bg-emerald-700 text-white border-emerald-700'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          )}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
