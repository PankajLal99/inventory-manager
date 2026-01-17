import { ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'wide';
}

export default function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  if (!isOpen) return null;

  const sizes = {
    sm: 'sm:max-w-md',
    md: 'sm:max-w-lg',
    lg: 'sm:max-w-2xl',
    xl: 'sm:max-w-4xl',
    wide: 'sm:max-w-[70%]', // 70% width on desktop, full width on mobile
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-gray-900/10 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Container */}
      <div className="flex min-h-full h-full sm:min-h-full sm:items-center sm:justify-center p-0 sm:p-4">
        <div
          className={`relative bg-white rounded-none sm:rounded-lg shadow-xl transform transition-all w-full ${sizes[size]} min-h-full h-full sm:h-auto sm:max-h-[90vh] flex flex-col`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-4 sm:p-6 h-full flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between mb-6 flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-500 focus:outline-none transition-colors p-1 rounded-lg hover:bg-gray-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 px-1 pb-4">
              <div className="pr-2">
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

