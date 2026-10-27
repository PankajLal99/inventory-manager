import { ReactNode } from 'react';
import { CARD_CLASS, cx } from './tokens';

export type SalaryTableColumn = {
  key: string;
  label: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
};

export function SalaryTable({
  columns,
  children,
  className,
}: {
  columns: SalaryTableColumn[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx(CARD_CLASS, 'overflow-x-auto hidden lg:block', className)}>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cx(
                  'px-4 py-3 font-medium text-slate-500 whitespace-nowrap',
                  col.align === 'right' && 'text-right',
                  col.align === 'center' && 'text-center',
                  col.align !== 'right' && col.align !== 'center' && 'text-left',
                  col.className
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function SalaryTd({
  children,
  align,
  className,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <td
      className={cx(
        'px-4 py-3 text-slate-800',
        align === 'right' && 'text-right tabular-nums',
        align === 'center' && 'text-center',
        className
      )}
    >
      {children}
    </td>
  );
}

export function MoneyCell({ value }: { value: ReactNode }) {
  return <SalaryTd align="right">{value}</SalaryTd>;
}
