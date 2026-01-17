import { ReactNode } from 'react';

interface TableHeader {
  label: string;
  align?: 'left' | 'right' | 'center';
}

interface TableProps {
  headers: (string | TableHeader)[];
  children: ReactNode;
  className?: string;
}

export default function Table({ headers, children, className = '' }: TableProps) {
  const normalizedHeaders = headers.map(header => 
    typeof header === 'string' ? { label: header, align: 'left' as const } : header
  );

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden ${className}`}>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {normalizedHeaders.map((header, index) => {
                const alignClass = {
                  left: 'text-left',
                  right: 'text-right',
                  center: 'text-center',
                }[header.align || 'left'];

                return (
                  <th
                    key={index}
                    className={`px-6 py-3 ${alignClass} text-xs font-semibold text-gray-700 uppercase tracking-wider`}
                  >
                    {header.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {children}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface TableRowProps {
  children: ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLTableRowElement>) => void;
}

export function TableRow({ children, className = '', onClick }: TableRowProps) {
  return (
    <tr
      className={`transition-colors ${onClick ? 'cursor-pointer hover:bg-gray-50' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

interface TableCellProps {
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  colSpan?: number;
}

export function TableCell({ children, className = '', align = 'left', colSpan }: TableCellProps) {
  const alignClass = {
    left: 'text-left',
    right: 'text-right',
    center: 'text-center',
  }[align];

  return (
    <td colSpan={colSpan} className={`px-6 py-4 whitespace-nowrap text-sm text-gray-900 ${alignClass} ${className}`}>
      {children}
    </td>
  );
}
