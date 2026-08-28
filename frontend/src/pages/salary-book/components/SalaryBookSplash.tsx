import { Loader2 } from 'lucide-react';

export default function SalaryBookSplash({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="min-h-[100dvh] bg-emerald-50 flex flex-col items-center justify-center px-6">
      <div className="h-16 w-16 rounded-2xl bg-emerald-700 shadow-lg flex items-center justify-center">
        <svg viewBox="0 0 32 32" className="h-9 w-9" aria-hidden>
          <path fill="#fff" d="M5.5 9.2 15.2 7.4v17.4L5.5 26.4z" />
          <path fill="#ecfdf5" d="M26.5 9.2 16.8 7.4v17.4l9.7 1.6z" />
          <rect x="15.2" y="7.2" width="1.6" height="17.8" fill="#10b981" />
        </svg>
      </div>
      <h1 className="mt-5 text-xl font-bold text-gray-900 tracking-wide">SALARY BOOK</h1>
      <Loader2 className="mt-5 h-7 w-7 animate-spin text-emerald-600" />
      <p className="mt-2 text-sm text-gray-500">{message}</p>
    </div>
  );
}
