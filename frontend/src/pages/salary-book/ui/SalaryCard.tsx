import { HTMLAttributes, ReactNode } from 'react';
import { CARD_CLASS, cx } from './tokens';

export default function SalaryCard({
  children,
  className,
  padding = true,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode; padding?: boolean }) {
  return (
    <div className={cx(CARD_CLASS, padding && 'p-4 lg:p-5', className)} {...props}>
      {children}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <SalaryCard className={className} padding={false}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 px-4 pt-4 lg:px-5 lg:pt-5">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold text-slate-900">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
          </div>
          {actions}
        </div>
      )}
      <div className="p-4 lg:p-5">{children}</div>
    </SalaryCard>
  );
}
