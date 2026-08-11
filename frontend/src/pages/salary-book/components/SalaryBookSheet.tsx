import type { ReactNode } from 'react';

export default function SalaryBookSheet({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4">
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} aria-hidden />
      <div className="relative bg-white w-full max-w-lg lg:max-w-xl rounded-t-2xl lg:rounded-2xl p-5 shadow-xl max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
