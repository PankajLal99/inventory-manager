import { useQuery } from '@tanstack/react-query';
import { useNavigate, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { reportsApi } from '../../lib/api';
import { formatNumber } from '../../lib/utils';
import { auth } from '../../lib/auth';
import {
  Package, FileText, ShoppingBag, Calendar,
  DollarSign, CreditCard, Wallet, TrendingUp, TrendingDown, Wrench, Store, Clock,
  BarChart3, Box, RefreshCw, ArrowUp, ArrowDown
} from 'lucide-react';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(auth.getUser());
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    if (!user) {
      auth.loadUser().then((loadedUser) => {
        setUser(loadedUser);
      });
    }
  }, [user]);

  // Check if user can access dashboard
  const canAccessDashboard = user?.can_access_dashboard !== false;

  if (user && !canAccessDashboard) {
    return <Navigate to="/" replace />;
  }

  // Fetch dashboard KPIs
  const { data: kpisData, isLoading: kpisLoading } = useQuery({
    queryKey: ['dashboard-kpis', dateFrom, dateTo],
    queryFn: async () => {
      const response = await reportsApi.dashboardKpis({
        date_from: dateFrom,
        date_to: dateTo
      });
      return response.data;
    },
    retry: false,
  });



  // Calculate custom month period (10th to 10th)
  const getCustomMonthPeriod = () => {
    const now = new Date();
    const currentDay = now.getDate();

    let startDate: Date;
    let endDate: Date;

    if (currentDay < 10) {
      // Before 10th: use previous month's 10th to current month's 10th
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 10);
      endDate = new Date(now.getFullYear(), now.getMonth(), 10);
    } else {
      // On or after 10th: use current month's 10th to next month's 10th
      startDate = new Date(now.getFullYear(), now.getMonth(), 10);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 10);
    }

    const formatMonthDay = (date: Date) => {
      return date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
      });
    };

    return `${formatMonthDay(startDate)} - ${formatMonthDay(endDate)}`;
  };

  const kpis = kpisData?.kpis || {};
  const comparisons = kpisData?.comparisons?.yesterday || {};

  // Calculate percentage changes
  const getChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  const cashChange = getChange(kpis.total_cash || 0, comparisons.total_cash || 0);
  const onlineChange = getChange(kpis.total_online || 0, comparisons.total_online || 0);
  const inhandChange = getChange(kpis.total_inhand || 0, comparisons.total_inhand || 0);
  const profitChange = getChange(kpis.overall_profit || 0, comparisons.overall_profit || 0);

  const KpiCard = ({
    title,
    value,
    icon: Icon,
    bgColor,
    iconColor,
    borderColor,
    change,
    yesterdayValue,
    formatValue = (val: number | string) => `₹${formatNumber(val, 0)}`,
    suffix = ''
  }: {
    title: string;
    value: number | string;
    icon: any;
    bgColor: string;
    iconColor: string;
    borderColor: string;
    change?: number;
    yesterdayValue?: number;
    formatValue?: (val: number | string) => string;
    suffix?: string;
  }) => {
    const displayValue = typeof value === 'number' ? formatValue(value) : value;
    const isPositive = change !== undefined && change >= 0;

    return (
      <div className={`${bgColor} rounded-xl shadow-sm border ${borderColor} p-4 sm:p-5 transition-transform hover:shadow-md`}>
        <div className="flex items-start justify-between mb-2">
          <div className={`p-2 rounded-lg ${iconColor.replace('text-', 'bg-').replace('-600', '-100')}`}>
            <Icon className={`h-5 w-5 sm:h-6 sm:w-6 ${iconColor}`} />
          </div>
          {change !== undefined && (
            <div className={`flex items-center gap-1 text-xs font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
              {isPositive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
              {Math.abs(change) < 0.1 ? '0' : formatNumber(Math.abs(change), 1)}%
            </div>
          )}
        </div>
        <p className="text-xs sm:text-sm text-gray-600 font-medium mb-1">{title}</p>
        <p className="text-lg sm:text-2xl font-bold text-gray-900 leading-tight">
          {displayValue}{suffix}
        </p>
        {yesterdayValue !== undefined && (
          <p className="text-xs text-gray-500 mt-1">
            Yesterday: {formatValue(yesterdayValue)}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      {/* Header with Date Range */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 px-4 py-4 sm:px-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">From:</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full sm:w-auto"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">To:</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full sm:w-auto"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const today = new Date().toISOString().split('T')[0];
                setDateFrom(today);
                setDateTo(today);
              }}
              className="whitespace-nowrap"
            >
              Today
            </Button>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 pt-6 space-y-6">
        {kpisLoading ? (
          <div className="text-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-gray-400" />
            <p className="text-gray-500">Loading dashboard data...</p>
          </div>
        ) : (
          <>
            {/* KPI Grid - 13 Boxes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* 1. Total Cash */}
              <KpiCard
                title="Total Cash"
                value={kpis.total_cash || 0}
                icon={DollarSign}
                bgColor="bg-gradient-to-br from-green-50 to-green-100"
                iconColor="text-green-600"
                borderColor="border-green-200"
                change={cashChange}
                yesterdayValue={comparisons.total_cash}
              />

              {/* 2. Total Online */}
              <KpiCard
                title="Total Online"
                value={kpis.total_online || 0}
                icon={CreditCard}
                bgColor="bg-gradient-to-br from-blue-50 to-blue-100"
                iconColor="text-blue-600"
                borderColor="border-blue-200"
                change={onlineChange}
                yesterdayValue={comparisons.total_online}
              />

              {/* 3. Total Expenses */}
              <KpiCard
                title="Total Expenses"
                value={kpis.total_expenses || 0}
                icon={TrendingUp}
                bgColor="bg-gradient-to-br from-red-50 to-red-100"
                iconColor="text-red-600"
                borderColor="border-red-200"
              />

              {/* 4. Total Inhand */}
              <KpiCard
                title="Total Inhand"
                value={kpis.total_inhand || 0}
                icon={Wallet}
                bgColor="bg-gradient-to-br from-purple-50 to-purple-100"
                iconColor="text-purple-600"
                borderColor="border-purple-200"
                change={inhandChange}
                yesterdayValue={comparisons.total_inhand}
              />

              {/* 5. Repairing Profit */}
              <KpiCard
                title="Repairing Profit"
                value={kpis.repairing_profit || 0}
                icon={Wrench}
                bgColor="bg-gradient-to-br from-orange-50 to-orange-100"
                iconColor="text-orange-600"
                borderColor="border-orange-200"
              />

              {/* 6. Counter Profit */}
              <KpiCard
                title="Counter Profit"
                value={kpis.counter_profit || 0}
                icon={Store}
                bgColor="bg-gradient-to-br from-indigo-50 to-indigo-100"
                iconColor="text-indigo-600"
                borderColor="border-indigo-200"
              />

              {/* 7. Pending Profit */}
              <KpiCard
                title="Pending Profit"
                value={kpis.pending_profit || 0}
                icon={Clock}
                bgColor="bg-gradient-to-br from-yellow-50 to-yellow-100"
                iconColor="text-yellow-600"
                borderColor="border-yellow-200"
              />

              {/* 8. Overall Profit */}
              <KpiCard
                title="Overall Profit"
                value={kpis.overall_profit || 0}
                icon={BarChart3}
                bgColor="bg-gradient-to-br from-emerald-50 to-emerald-100"
                iconColor="text-emerald-600"
                borderColor="border-emerald-200"
                change={profitChange}
                yesterdayValue={comparisons.overall_profit}
              />

              {/* 9. Monthly Profit */}
              <KpiCard
                title={`Monthly Profit (${getCustomMonthPeriod()})`}
                value={kpis.monthly_profit || 0}
                icon={Calendar}
                bgColor="bg-gradient-to-br from-cyan-50 to-cyan-100"
                iconColor="text-cyan-600"
                borderColor="border-cyan-200"
              />

              {/* 10. Total Stock */}
              <KpiCard
                title="Total Stock"
                value={kpis.total_stock || 0}
                icon={Box}
                bgColor="bg-gradient-to-br from-slate-50 to-slate-100"
                iconColor="text-slate-600"
                borderColor="border-slate-200"
                formatValue={(val) => String(val)}
                suffix=" units"
              />

              {/* 11. Total Stock Value */}
              <KpiCard
                title="Total Stock Value"
                value={kpis.total_stock_value || 0}
                icon={Package}
                bgColor="bg-gradient-to-br from-teal-50 to-teal-100"
                iconColor="text-teal-600"
                borderColor="border-teal-200"
              />

              {/* 12. Pending Invoices */}
              <KpiCard
                title="Pending Invoices"
                value={kpis.pending_invoices_total || 0}
                icon={FileText}
                bgColor="bg-gradient-to-br from-amber-50 to-amber-100"
                iconColor="text-amber-600"
                borderColor="border-amber-200"
              />

              {/* 13. Total Replacement */}
              <KpiCard
                title="Total Replacement"
                value={kpis.total_replacement || 0}
                icon={RefreshCw}
                bgColor="bg-gradient-to-br from-pink-50 to-pink-100"
                iconColor="text-pink-600"
                borderColor="border-pink-200"
              />

              {/* 14. Today's Loss (Manish Traders Loss Loss Loss) */}
              <KpiCard
                title="Today's Loss"
                value={kpis.todays_loss || 0}
                icon={TrendingDown}
                bgColor="bg-gradient-to-br from-rose-50 to-rose-100"
                iconColor="text-rose-600"
                borderColor="border-rose-200"
              />

              {/* 15. Monthly Loss (Manish Traders Loss) */}
              <KpiCard
                title={`Monthly Loss (${getCustomMonthPeriod()})`}
                value={kpis.monthly_loss || 0}
                icon={TrendingDown}
                bgColor="bg-gradient-to-br from-red-50 to-red-100"
                iconColor="text-red-600"
                borderColor="border-red-200"
              />

              {/* 16. Total Loss (Manish Traders Loss) */}
              <KpiCard
                title="Total Loss"
                value={kpis.total_loss || 0}
                icon={TrendingDown}
                bgColor="bg-gradient-to-br from-orange-50 to-orange-100"
                iconColor="text-orange-600"
                borderColor="border-orange-200"
              />
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
              <button
                onClick={() => navigate('/pos')}
                className="bg-white border-2 border-blue-200 rounded-xl p-4 sm:p-5 hover:bg-blue-50 hover:border-blue-300 active:scale-95 transition-all touch-manipulation"
              >
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 bg-blue-100 rounded-lg flex items-center justify-center mb-3">
                    <ShoppingBag className="h-6 w-6 sm:h-7 sm:w-7 text-blue-600" />
                  </div>
                  <p className="text-sm sm:text-base font-semibold text-gray-900">POS</p>
                  <p className="text-xs text-gray-500 mt-1">New Sale</p>
                </div>
              </button>

              <button
                onClick={() => navigate('/products')}
                className="bg-white border-2 border-green-200 rounded-xl p-4 sm:p-5 hover:bg-green-50 hover:border-green-300 active:scale-95 transition-all touch-manipulation"
              >
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 bg-green-100 rounded-lg flex items-center justify-center mb-3">
                    <Package className="h-6 w-6 sm:h-7 sm:w-7 text-green-600" />
                  </div>
                  <p className="text-sm sm:text-base font-semibold text-gray-900">Products</p>
                  <p className="text-xs text-gray-500 mt-1">Manage</p>
                </div>
              </button>

              <button
                onClick={() => navigate('/invoices')}
                className="bg-white border-2 border-purple-200 rounded-xl p-4 sm:p-5 hover:bg-purple-50 hover:border-purple-300 active:scale-95 transition-all touch-manipulation sm:col-span-1 col-span-2"
              >
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 bg-purple-100 rounded-lg flex items-center justify-center mb-3">
                    <FileText className="h-6 w-6 sm:h-7 sm:w-7 text-purple-600" />
                  </div>
                  <p className="text-sm sm:text-base font-semibold text-gray-900">Invoices</p>
                  <p className="text-xs text-gray-500 mt-1">View All</p>
                </div>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
