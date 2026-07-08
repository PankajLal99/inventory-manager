import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { auth } from '../../lib/auth';
import { Coins, Eye, EyeOff } from 'lucide-react';

export default function CreditLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Credit login page is not under /pos-credit*, so check credit tokens explicitly
    if (auth.isCreditAuthenticated()) {
      navigate('/pos-credit', { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Credit session only — main POS login (if any) stays active
      await auth.login(username, password, { creditPortal: true });
      navigate('/pos-credit');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 via-orange-50 to-stone-100">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-2xl shadow-lg border border-amber-100">
        <div className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-amber-100 flex items-center justify-center">
            <Coins className="h-8 w-8 text-amber-700" />
          </div>
          <h2 className="mt-6 text-3xl font-bold text-gray-900">POS Credit</h2>
          <p className="mt-2 text-sm text-gray-600">
            Sign in to credit sales, returns, invoices &amp; ledger
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label htmlFor="credit-username" className="block text-sm font-medium text-gray-700">
                Username
              </label>
              <input
                id="credit-username"
                name="username"
                type="text"
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-amber-500 focus:border-amber-500"
              />
            </div>
            <div>
              <label htmlFor="credit-password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="relative mt-1">
                <input
                  id="credit-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-amber-500 focus:border-amber-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus:outline-none"
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
            className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in to Credit'}
          </button>
          <div className="text-center text-sm text-gray-500">
            Full inventory app?{' '}
            <Link to="/login" className="text-amber-700 hover:text-amber-900 font-medium">
              Main login
            </Link>
            <span className="block mt-1 text-xs text-gray-400">
              Both logins can stay active at once.
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
