import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  message?: string;
  className?: string;
}

export default function LoadingState({
  message = 'Loading...',
  className = '',
}: LoadingStateProps) {
  const salaryBook =
    typeof window !== 'undefined' && window.location.pathname.includes('/salary-book');
  return (
    <div className={`flex flex-col items-center justify-center p-12 ${className}`}>
      <Loader2
        className={`h-8 w-8 animate-spin mb-4 ${salaryBook ? 'text-emerald-600' : 'text-blue-600'}`}
      />
      <p className="text-gray-600">{message}</p>
    </div>
  );
}

