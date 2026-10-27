import { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cx } from './tokens';

type Variant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface SalaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:ring-emerald-600',
  secondary: 'bg-white text-slate-800 border border-slate-200 hover:bg-slate-50 focus-visible:ring-slate-400',
  outline: 'bg-white text-emerald-800 border border-emerald-200 hover:bg-emerald-50 focus-visible:ring-emerald-600',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400',
};

const SIZES: Record<Size, string> = {
  sm: 'min-h-9 px-3 text-sm rounded-lg',
  md: 'min-h-11 px-4 text-sm rounded-xl',
  lg: 'min-h-12 px-5 text-sm rounded-xl',
};

export default function SalaryButton({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...props
}: SalaryButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />}
      {children}
    </button>
  );
}
