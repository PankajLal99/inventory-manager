import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { auth } from '../../lib/auth';
import { isAccountsOnlyUser } from '../../pages/credit/creditLedgerUtils';
import {
  Coins,
  FileText,
  BookOpen,
  LogOut,
  Menu,
  ShoppingCart,
  X,
} from 'lucide-react';

const NAV: Array<{
  path: string;
  label: string;
  icon: typeof ShoppingCart;
  mainOnly?: boolean;
}> = [
  { path: '/pos', label: 'POS', icon: ShoppingCart, mainOnly: true },
  { path: '/pos-credit', label: 'POS Credit', icon: Coins },
  { path: '/credit-invoices', label: 'Invoices', icon: FileText },
  { path: '/credit-ledger', label: 'Credit Ledger', icon: BookOpen },
];

function isActive(pathname: string, path: string) {
  if (path === '/credit-invoices') {
    return (
      pathname === '/credit-invoices' ||
      pathname.startsWith('/credit-invoices/') ||
      pathname.startsWith('/credit-returns/')
    );
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

export default function CreditLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(auth.getUser('credit'));
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

  const { pathname } = location;
  const accountsOnly = isAccountsOnlyUser(user);
  const navItems = useMemo(
    () => NAV.filter((item) => !(item.mainOnly && accountsOnly)),
    [accountsOnly]
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-100 to-stone-50 flex flex-col">
      <header className="bg-white/95 backdrop-blur border-b border-amber-200/80 sticky top-0 z-30 shadow-sm">
        <div className="max-w-[1800px] mx-auto w-full px-3 sm:px-5 lg:px-6 flex items-center justify-between h-14 gap-3">
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
            {navItems.map(({ path, label, icon: Icon }) => {
              const active =
                path === '/pos-credit'
                  ? pathname === '/pos-credit' || pathname === '/pos-credit-return'
                  : isActive(pathname, path);
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
          <div className="md:hidden border-t border-amber-100 bg-white">
            <div className="max-w-[1800px] mx-auto w-full px-3 sm:px-5 lg:px-6 py-2 space-y-1">
            {navItems.map(({ path, label, icon: Icon }) => {
              const active =
                path === '/pos-credit'
                  ? pathname === '/pos-credit' || pathname === '/pos-credit-return'
                  : isActive(pathname, path);
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
          </div>
        )}
      </header>

      <main className="flex-1 w-full">
        <div className="max-w-[1800px] mx-auto w-full px-3 sm:px-5 lg:px-6 py-4 sm:py-6">
          <div className="bg-white rounded-xl border border-gray-200/90 shadow-sm ring-1 ring-black/[0.03] min-h-[calc(100vh-6.5rem)] p-3 sm:p-5 lg:p-6">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
