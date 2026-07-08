import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { auth } from '../../lib/auth';
import {
  Coins,
  FileText,
  BookOpen,
  LogOut,
  RefreshCw,
  Menu,
  X,
} from 'lucide-react';

const NAV = [
  { path: '/pos-credit', label: 'POS Credit', icon: Coins },
  { path: '/pos-credit-return', label: 'Credit Return', icon: RefreshCw },
  { path: '/credit-invoices', label: 'Credit Invoices', icon: FileText },
  { path: '/credit-ledger', label: 'Credit Ledger', icon: BookOpen },
] as const;

function isActive(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export default function CreditLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(auth.getUser());
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const loadUser = async () => {
      if (!auth.isCreditAuthenticated()) {
        navigate('/credit-login');
        return;
      }
      try {
        const loaded = await auth.loadUser('credit');
        setUser(loaded);
      } catch {
        auth.logout('credit');
        navigate('/credit-login');
      }
    };
    loadUser();
  }, [navigate]);

  const handleLogout = () => {
    auth.logout('credit');
    navigate('/credit-login');
  };

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <header className="bg-white border-b border-amber-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 flex items-center justify-between h-14 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex-shrink-0 h-9 w-9 rounded-xl bg-amber-100 flex items-center justify-center">
              <Coins className="h-5 w-5 text-amber-700" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 truncate">POS Credit</div>
              <div className="text-xs text-gray-500 truncate hidden sm:block">
                {user?.username || '…'}
              </div>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            {NAV.map(({ path, label, icon: Icon }) => {
              const active = isActive(location.pathname, path);
              return (
                <Link
                  key={path}
                  to={path}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'bg-amber-100 text-amber-900'
                      : 'text-gray-600 hover:bg-amber-50 hover:text-amber-900'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleLogout}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
            <button
              type="button"
              className="md:hidden p-2 rounded-lg text-gray-600 hover:bg-amber-50"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Menu"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-amber-100 bg-white px-3 py-2 space-y-1">
            {NAV.map(({ path, label, icon: Icon }) => {
              const active = isActive(location.pathname, path);
              return (
                <Link
                  key={path}
                  to={path}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium ${
                    active ? 'bg-amber-100 text-amber-900' : 'text-gray-700 hover:bg-amber-50'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        )}
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <Outlet />
      </main>
    </div>
  );
}
