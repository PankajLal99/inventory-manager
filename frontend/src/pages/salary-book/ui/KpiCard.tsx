import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CARD_CLASS, cx } from './tokens';

const TONE: Record<string, string> = {
  default: 'text-slate-900',
  success: 'text-emerald-800',
  warning: 'text-amber-800',
  danger: 'text-red-700',
  info: 'text-sky-800',
};

export default function KpiCard({
  label,
  value,
  hint,
  tone = 'default',
  to,
  onClick,
  active,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: keyof typeof TONE;
  to?: string;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  const inner = (
    <>
      <div className="text-xs font-medium text-slate-500 leading-tight">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums tracking-tight', TONE[tone])}>{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-slate-500">{hint}</div> : null}
    </>
  );

  const box = cx(
    CARD_CLASS,
    'p-3 sm:p-4 text-left w-full block transition-colors',
    active && 'ring-2 ring-emerald-600 border-emerald-300',
    (to || onClick) && 'hover:border-emerald-200 hover:bg-emerald-50/40 cursor-pointer',
    className
  );

  if (to) {
    return (
      <Link to={to} className={box} onClick={onClick}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className={box} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return <div className={box}>{inner}</div>;
}
