import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import ToastContainer from '../components/ui/Toast';
import type { Toast } from '../components/ui/Toast';

interface ToastContextType {
  toast: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Global toast handler for use outside React components
let globalToastHandler: ((message: string, type?: 'success' | 'error' | 'info', duration?: number) => void) | null = null;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success', duration = 4000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value: ToastContextType = {
    toast: showToast,
    success: (message: string, duration?: number) => showToast(message, 'success', duration),
    error: (message: string, duration?: number) => showToast(message, 'error', duration),
    info: (message: string, duration?: number) => showToast(message, 'info', duration),
  };

  // Set global handler
  useEffect(() => {
    globalToastHandler = showToast;
    return () => {
      globalToastHandler = null;
    };
  }, [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// Simple toast function that can be used anywhere (replaces alert)
// This works both inside and outside React components
export function toast(message: string, type: 'success' | 'error' | 'info' = 'info', duration = 4000) {
  if (globalToastHandler) {
    globalToastHandler(message, type, duration);
  } else {
    // Fallback to alert if toast context not available (shouldn't happen in normal use)
    console.warn('Toast not available, falling back to alert');
    alert(message);
  }
}

