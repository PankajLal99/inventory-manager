import { ComponentType } from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'default' | 'secondary' | 'outline';
  className?: string;
}

export default function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  const variants = {
    success: 'bg-green-100 text-green-700 border-green-200',
    warning: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    danger: 'bg-red-100 text-red-700 border-red-200',
    info: 'bg-blue-100 text-blue-700 border-blue-200',
    default: 'bg-gray-100 text-gray-700 border-gray-200',
    secondary: 'bg-gray-100 text-gray-700 border-gray-200',
    outline: 'bg-white text-gray-700 border-gray-300',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}

interface StatusBadgeProps {
  status: string;
  icon?: ComponentType<{ className?: string }>;
  label: string;
  className?: string;
}

export function StatusBadge({ status, icon: Icon, label, className = '' }: StatusBadgeProps) {
  const statusConfig: Record<string, { bgColor: string; textColor: string; borderColor: string }> = {
    paid: { bgColor: 'bg-green-50', textColor: 'text-green-700', borderColor: 'border-green-200' },
    partial: { bgColor: 'bg-yellow-50', textColor: 'text-yellow-700', borderColor: 'border-yellow-200' },
    credit: { bgColor: 'bg-blue-50', textColor: 'text-blue-700', borderColor: 'border-blue-200' },
    draft: { bgColor: 'bg-gray-50', textColor: 'text-gray-700', borderColor: 'border-gray-200' },
    void: { bgColor: 'bg-red-50', textColor: 'text-red-700', borderColor: 'border-red-200' },
    pending: { bgColor: 'bg-orange-50', textColor: 'text-orange-700', borderColor: 'border-orange-200' },
    sale: { bgColor: 'bg-green-50', textColor: 'text-green-700', borderColor: 'border-green-200' },
  };

  const config = statusConfig[status.toLowerCase()] || statusConfig.draft;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border ${config.bgColor} ${config.textColor} ${config.borderColor} ${className}`}>
      {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" />}
      <span>{label}</span>
    </span>
  );
}

