import { FormEvent, ReactNode, useState } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';

const STORAGE_KEY = 'salary_book_salary_page_unlocked';
const SALARY_PAGE_PASSWORD = '098098';

function isUnlocked() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function SalaryPageGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(isUnlocked);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (unlocked) return <>{children}</>;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password === SALARY_PAGE_PASSWORD) {
      try {
        sessionStorage.setItem(STORAGE_KEY, '1');
      } catch {
        // ignore storage failures; unlock for this render only
      }
      setUnlocked(true);
      setError('');
      return;
    }
    setError('Wrong password.');
  };

  return (
    <div className="min-h-[50vh] flex items-center justify-center px-3">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-white rounded-2xl border border-emerald-100 p-5 space-y-4 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-bold text-gray-900">Salary Book</h1>
          <p className="text-sm text-gray-500 mt-1">Enter password to view salary details.</p>
        </div>
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError('');
          }}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full min-h-12 bg-emerald-600 hover:bg-emerald-700">
          Unlock
        </Button>
      </form>
    </div>
  );
}
