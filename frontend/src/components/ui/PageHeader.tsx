import { ReactNode, ComponentType } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
  className?: string;
}

export default function PageHeader({
  title,
  subtitle,
  icon: Icon,
  action,
  className = '',
}: PageHeaderProps) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 ${className}`}>
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2 sm:gap-3">
          {Icon && <Icon className="h-6 w-6 sm:h-8 sm:w-8 text-blue-600 flex-shrink-0" />}
          <span className="truncate">{title}</span>
        </h1>
        {subtitle && <p className="text-sm sm:text-base text-gray-600 mt-1.5 truncate">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

