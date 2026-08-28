import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { auth } from '../../lib/auth';
import { applySalaryBookPwa, initials } from '../../lib/salaryBookPwa';
import SalaryBookSplash from '../../pages/salary-book/components/SalaryBookSplash';
import {
  Home,
  Users,
  ClipboardCheck,
  MoreHorizontal,
  LogOut,
  BookOpen,
  Wallet,
  CalendarDays,
  Umbrella,
  BarChart3,
  Settings,
  UserRound,
  X,
} from 'lucide-react';

const PRIMARY: Array<{
  path: string;
  label: string;
  icon: typeof Home;
  exact?: boolean;
}> = [
  { path: '/salary-book', label: 'Home', icon: Home, exact: true },
  { path: '/salary-book/employees', label: 'Employees', icon: Users },
  { path: '/salary-book/attendance', label: 'Attendance', icon: ClipboardCheck },
  { path: '/salary-book/calendar', label: 'Calendar', icon: CalendarDays },
];

const MORE = [
  { path: '/salary-book/leaves', label: 'Leaves', icon: Umbrella },
  { path: '/salary-book/advances', label: 'Advances', icon: Wallet },
  { path: '/salary-book/salaries', label: 'Salary Book', icon: BookOpen },
  { path: '/salary-book/reports', label: 'Reports', icon: BarChart3 },
  { path: '/salary-book/settings', label: 'Settings', icon: Settings },
  { path: '/salary-book/profile', label: 'Profile', icon: UserRound },
];

const SIDEBAR = [...PRIMARY, ...MORE];

function isActive(pathname: string, path: string, exact?: boolean) {
  if (exact) return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

function NavLink({
  path,
  label,
  icon: Icon,
  exact,
  onClick,
  sidebar,
}: {
  path: string;
  label: string;
  icon: typeof Home;
  exact?: boolean;
  onClick?: () => void;
  sidebar?: boolean;
}) {
  const location = useLocation();
  const active = isActive(location.pathname, path, exact);
  if (sidebar) {
    return (
      <Link
        to={path}
        onClick={onClick}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium min-h-11 ${
          active ? 'bg-emerald-100 text-emerald-900' : 'text-gray-600 hover:bg-emerald-50'
        }`}
      >
        <Icon className="h-5 w-5 shrink-0" />
        {label}
      </Link>
    );
  }
  return (
    <Link
      to={path}
      onClick={onClick}
      className={`flex flex-col items-center justify-center py-2 min-h-14 text-xs font-medium ${
        active ? 'text-emerald-700' : 'text-gray-500'
      }`}
    >
      <Icon className="h-5 w-5 mb-0.5" />
      {label}
    </Link>
  );
}

export default function SalaryBookLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(auth.getUser('salary_book'));
  const [ready, setReady] = useState(Boolean(auth.getUser('salary_book')));
  const [moreOpen, setMoreOpen] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);

  useEffect(() => {
    applySalaryBookPwa();
  }, []);

  useEffect(() => {
    setRouteLoading(true);
    const t = window.setTimeout(() => setRouteLoading(false), 450);
    return () => window.clearTimeout(t);
  }, [location.pathname]);

  useEffect(() => {
    const load = async () => {
      if (!auth.isSalaryBookAuthenticated()) {
        navigate('/salary-book/login');
        return;
      }
      try {
        const loaded = await auth.loadUser('salary_book');
        setUser(loaded);
      } catch (err: any) {
        if (err?.response?.status === 401) {
          auth.logout('salary_book');
          navigate('/salary-book/login');
          return;
        }
      } finally {
        setReady(true);
      }
    };
    load();

    const keepAlive = async () => {
      try {
        await auth.keepSalaryBookSessionAlive();
      } catch (err: any) {
        if (err?.response?.status === 401) {
          auth.logout('salary_book');
          navigate('/salary-book/login');
        }
      }
    };
    void keepAlive();
    const id = window.setInterval(keepAlive, 10 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void keepAlive();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [navigate]);

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    auth.logout('salary_book');
    navigate('/salary-book/login');
  };

  const moreActive = MORE.some((item) => isActive(location.pathname, item.path));

  if (!ready) {
    return <SalaryBookSplash message="Opening your workspace…" />;
  }

  return (
    <div className="min-h-[100dvh] bg-emerald-50/80 flex">
      {routeLoading && (
        <div className="fixed top-0 left-0 right-0 z-50 h-0.5 bg-emerald-100">
          <div className="h-full w-2/3 bg-emerald-600 animate-pulse" />
        </div>
      )}

      <aside className="hidden lg:flex lg:flex-col w-60 xl:w-64 bg-white border-r border-emerald-100 sticky top-0 h-screen shrink-0">
        <Link to="/salary-book/profile" className="px-5 h-16 flex items-center gap-3 border-b border-emerald-100">
          <span className="h-9 w-9 rounded-full bg-emerald-700 text-white text-sm font-semibold flex items-center justify-center">
            {initials(user)}
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 truncate">{user?.first_name || user?.username || 'Salary Book'}</div>
            <div className="text-xs text-gray-500 truncate">Profile</div>
          </div>
        </Link>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {SIDEBAR.map((item) => (
            <NavLink key={item.path} {...item} sidebar />
          ))}
        </nav>
        <div className="p-3 border-t border-emerald-100">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full inline-flex items-center gap-2 px-3 py-2.5 text-sm text-gray-600 hover:text-red-600 rounded-xl min-h-11"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-white/95 backdrop-blur border-b border-emerald-200 sticky top-0 z-30 lg:hidden pt-[env(safe-area-inset-top)]">
          <div className="max-w-lg mx-auto w-full px-4 h-14 flex items-center justify-between">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900">Salary Book</div>
              <div className="text-xs text-gray-500 truncate">{user?.username || '…'}</div>
            </div>
            <Link
              to="/salary-book/profile"
              className="h-10 w-10 rounded-full bg-emerald-700 text-white text-sm font-semibold flex items-center justify-center"
              aria-label="Open profile"
            >
              {initials(user)}
            </Link>
          </div>
        </header>

        <main className="flex-1 w-full pb-24 lg:pb-8">
          <div className="w-full max-w-lg mx-auto lg:max-w-7xl px-3 py-4 lg:px-8 lg:py-6">
            <Outlet />
          </div>
        </main>
      </div>

      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-gray-900/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-4 pb-[max(2rem,env(safe-area-inset-bottom))] max-w-lg mx-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">More</h3>
              <button type="button" className="p-2" onClick={() => setMoreOpen(false)} aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-1">
              {MORE.map((item) => (
                <NavLink key={item.path} {...item} sidebar onClick={() => setMoreOpen(false)} />
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-emerald-100 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-lg mx-auto grid grid-cols-5">
          {PRIMARY.map((item) => (
            <NavLink key={item.path} {...item} />
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={`flex flex-col items-center justify-center py-2 min-h-14 text-xs font-medium ${
              moreActive ? 'text-emerald-700' : 'text-gray-500'
            }`}
          >
            <MoreHorizontal className="h-5 w-5 mb-0.5" />
            More
          </button>
        </div>
      </nav>
    </div>
  );
}
