import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../lib/auth';
import { applySalaryBookPwa } from '../../lib/salaryBookPwa';
import { BookOpen, Eye, EyeOff, Loader2 } from 'lucide-react';
import { apiError } from './utils';
import AddToHomeHint from './components/AddToHomeHint';
import SalaryBookSplash from './components/SalaryBookSplash';

export default function SalaryBookLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const alreadyIn = auth.isSalaryBookAuthenticated();

  useEffect(() => {
    applySalaryBookPwa();
    if (auth.isSalaryBookAuthenticated()) {
      navigate('/salary-book', { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await auth.login(username, password, { salaryBook: true });
      navigate('/salary-book');
    } catch (err: unknown) {
      setError(apiError(err, 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  if (alreadyIn) {
    return <SalaryBookSplash message="Signing you in…" />;
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-br from-emerald-50 via-teal-50 to-stone-100 px-4 lg:px-8 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-md lg:max-w-5xl grid grid-cols-1 lg:grid-cols-2 bg-white rounded-2xl shadow-lg border border-emerald-100 overflow-hidden">
        <div className="hidden lg:flex flex-col justify-between bg-emerald-700 text-white p-10">
          <div>
            <div className="h-14 w-14 rounded-2xl bg-white/15 flex items-center justify-center">
              <BookOpen className="h-8 w-8" />
            </div>
            <h2 className="mt-8 text-3xl font-bold">Salary Book</h2>
            <p className="mt-3 text-emerald-100 max-w-sm">
              Manage attendance, leaves, advances, and payroll from a desktop workspace or on the floor.
            </p>
          </div>
          <p className="text-sm text-emerald-200">You stay signed in until logout or a password change.</p>
        </div>
      <div className="space-y-8 p-8">
        <div className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-emerald-100 flex items-center justify-center">
            <BookOpen className="h-8 w-8 text-emerald-700" />
          </div>
          <h1 className="mt-6 text-3xl font-bold tracking-wide text-gray-900">SALARY BOOK</h1>
          <p className="mt-2 text-sm text-gray-600">Sign in to manage employees and payroll</p>
        </div>
        <AddToHomeHint />
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label htmlFor="sb-username" className="block text-sm font-medium text-gray-700">
                User ID
              </label>
              <input
                id="sb-username"
                name="username"
                type="text"
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 block w-full px-3 py-3 min-h-12 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
            <div>
              <label htmlFor="sb-password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="relative mt-1">
                <input
                  id="sb-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full px-3 py-3 pr-10 min-h-12 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-emerald-500 focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-12 flex justify-center py-3 px-4 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in…
              </span>
            ) : (
              'LOGIN'
            )}
          </button>
          <button
            type="button"
            onClick={() => setForgotOpen(true)}
            className="w-full text-center text-sm text-emerald-700"
          >
            Forgot Password
          </button>
        </form>
      </div>
      </div>

      {forgotOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40" onClick={() => setForgotOpen(false)} />
          <div className="relative bg-white rounded-2xl p-5 max-w-sm w-full shadow-xl">
            <h2 className="font-semibold text-gray-900">Forgot Password</h2>
            <p className="mt-2 text-sm text-gray-600">
              Contact your administrator to reset your password.
            </p>
            <button
              type="button"
              className="mt-4 w-full min-h-12 rounded-lg bg-emerald-600 text-white font-medium"
              onClick={() => setForgotOpen(false)}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
