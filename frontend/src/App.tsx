import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './lib/toast';
import { auth } from './lib/auth';
import { isCreditAppPath } from './lib/authPaths';
import Login from './pages/auth/Login';
import CreditLogin from './pages/auth/CreditLogin';
import Register from './pages/auth/Register';
import Dashboard from './pages/dashboard/Dashboard';
import Products from './pages/products/Products';
import ProductDetail from './pages/products/ProductDetail';
import POS from './pages/pos/POS';
import POSRepair from './pages/pos/POSRepair';
import RepairRegistration from './pages/pos/RepairRegistration';
import ActiveCartsOverview from './pages/pos/ActiveCartsOverview';
import Customers from './pages/customers/Customers';
import PersonalCustomers from './pages/customers/PersonalCustomers';
import Purchases from './pages/purchases/Purchases';
import PurchaseDetail from './pages/purchases/PurchaseDetail';
import Pricing from './pages/pricing/Pricing';
import History from './pages/history/History';
import Invoices from './pages/invoices/Invoices';
import InvoiceDetail from './pages/invoices/InvoiceDetail';
import InvoiceEdit from './pages/invoices/InvoiceEdit';
import Reports from './pages/reports/Reports';
import Replacement from './pages/replacement/Replacement';
import ReplacementPOS from './pages/replacement/ReplacementPOS';
import ReplaceProduct from './pages/replacement/ReplaceProduct';
import ReturnToStock from './pages/replacement/ReturnToStock';
import CreditNoteReplacement from './pages/replacement/CreditNoteReplacement';
import CreditNotes from './pages/credit-notes/CreditNotes';
import CreditNoteShowcase from './pages/credit-notes/CreditNoteShowcase';
import Repairs from './pages/repair/Repairs';
import Ledger from './pages/ledger/Ledger';
import LedgerDetail from './pages/ledger/LedgerDetail';
import PersonalLedger from './pages/ledger/PersonalLedger';
import PersonalLedgerDetail from './pages/ledger/PersonalLedgerDetail';
import InternalLedger from './pages/ledger/InternalLedger';
import InternalLedgerDetail from './pages/ledger/InternalLedgerDetail';
import Stores from './pages/stores/Stores';
import Search from './pages/search/Search';
import Layout from './components/layout/Layout';
import CreditLayout from './components/layout/CreditLayout';
import VendorPurchases from './pages/purchases/VendorPurchases';
import VendorPurchaseDetail from './pages/purchases/VendorPurchaseDetail';
import Vendors from './pages/vendors/Vendors';
import DefectiveMoveOuts from './pages/defective/DefectiveMoveOuts';
import PaymentReminders from './pages/payment-reminders/PaymentReminders';
import Expenses from './pages/expenses/Expenses';
import Payments from './pages/payments/Payments';
import StockOverview from './pages/stock/StockOverview';
import OverallProfitBillingDetails from './pages/dashboard/OverallProfitBillingDetails';
import OverallPendingInvoiceDetails from './pages/dashboard/OverallPendingInvoiceDetails';
import WholesalePendingClearedDetails from './pages/dashboard/WholesalePendingClearedDetails';
import DashboardMetricDetails from './pages/dashboard/DashboardMetricDetails';
import POSCredit from './pages/credit/POSCredit';
import POSCreditReturn from './pages/credit/POSCreditReturn';
import CreditInvoices from './pages/credit/CreditInvoices';
import CreditInvoiceDetail from './pages/credit/CreditInvoiceDetail';
import CreditLedger from './pages/credit/CreditLedger';
import CreditLedgerDetail from './pages/credit/CreditLedgerDetail';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 0,
      gcTime: 0,
    },
  },
});

export const getCacheConfig = () => ({
  staleTime: 0,
  gcTime: 0,
});

/**
 * Main + credit can be logged in at the same time (separate tokens).
 * Credit URLs are credit-session only (not shown in the main app).
 */
function AppShell() {
  const location = useLocation();
  const onCredit = isCreditAppPath(location.pathname);

  if (onCredit) {
    if (!auth.isCreditAuthenticated()) {
      return <Navigate to="/credit-login" replace />;
    }
    return <CreditLayout />;
  }

  if (!auth.isMainAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <Layout />;
}

function FullAppOnly({ children }: { children: React.ReactNode }) {
  if (!auth.isMainAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/credit-login" element={<CreditLogin />} />
              <Route path="/register" element={<Register />} />
              <Route path="/vendor-purchases" element={<VendorPurchases />} />
              <Route path="/vendor-purchases/:id" element={<VendorPurchaseDetail />} />

              <Route path="/" element={<AppShell />}>
                {/* Credit apps — /credit-login session only */}
                <Route path="pos-credit" element={<POSCredit />} />
                <Route path="pos-credit-return" element={<POSCreditReturn />} />
                <Route path="credit-invoices" element={<CreditInvoices />} />
                <Route path="credit-invoices/:id" element={<CreditInvoiceDetail />} />
                <Route path="credit-ledger" element={<CreditLedger />} />
                <Route path="credit-ledger/:customerId" element={<CreditLedgerDetail />} />

                {/* Full inventory app */}
                <Route index element={<FullAppOnly><POS /></FullAppOnly>} />
                <Route path="dashboard" element={<FullAppOnly><Dashboard /></FullAppOnly>} />
                <Route
                  path="dashboard/overall-profit-billing-details"
                  element={<FullAppOnly><OverallProfitBillingDetails /></FullAppOnly>}
                />
                <Route
                  path="dashboard/overall-pending-invoice-details"
                  element={<FullAppOnly><OverallPendingInvoiceDetails /></FullAppOnly>}
                />
                <Route
                  path="dashboard/wholesale-pending-cleared-details"
                  element={<FullAppOnly><WholesalePendingClearedDetails /></FullAppOnly>}
                />
                <Route
                  path="dashboard/metric-details"
                  element={<FullAppOnly><DashboardMetricDetails /></FullAppOnly>}
                />
                <Route path="products" element={<FullAppOnly><Products /></FullAppOnly>} />
                <Route path="products/:id" element={<FullAppOnly><ProductDetail /></FullAppOnly>} />
                <Route path="pos" element={<FullAppOnly><POS /></FullAppOnly>} />
                <Route path="active-carts" element={<FullAppOnly><ActiveCartsOverview /></FullAppOnly>} />
                <Route path="pos-repair" element={<FullAppOnly><POSRepair /></FullAppOnly>} />
                <Route path="pos-repair-new" element={<FullAppOnly><RepairRegistration /></FullAppOnly>} />
                <Route path="customers" element={<FullAppOnly><Customers /></FullAppOnly>} />
                <Route path="personal-customers" element={<FullAppOnly><PersonalCustomers /></FullAppOnly>} />
                <Route path="purchases" element={<FullAppOnly><Purchases /></FullAppOnly>} />
                <Route path="purchases/:id" element={<FullAppOnly><PurchaseDetail /></FullAppOnly>} />
                <Route path="pricing" element={<FullAppOnly><Pricing /></FullAppOnly>} />
                <Route path="invoices" element={<FullAppOnly><Invoices /></FullAppOnly>} />
                <Route path="invoices/:id" element={<FullAppOnly><InvoiceDetail /></FullAppOnly>} />
                <Route path="invoices/:id/edit" element={<FullAppOnly><InvoiceEdit /></FullAppOnly>} />
                <Route path="credit-notes" element={<FullAppOnly><CreditNotes /></FullAppOnly>} />
                <Route path="credit-notes/:id" element={<FullAppOnly><CreditNoteShowcase /></FullAppOnly>} />
                <Route path="history" element={<FullAppOnly><History /></FullAppOnly>} />
                <Route path="reports" element={<FullAppOnly><Reports /></FullAppOnly>} />
                <Route path="replacement" element={<FullAppOnly><Replacement /></FullAppOnly>} />
                <Route path="replacement/pos" element={<FullAppOnly><ReplacementPOS /></FullAppOnly>} />
                <Route path="replacement/replace-product" element={<FullAppOnly><ReplaceProduct /></FullAppOnly>} />
                <Route path="replacement/return-to-stock" element={<FullAppOnly><ReturnToStock /></FullAppOnly>} />
                <Route path="replacement/credit-note" element={<FullAppOnly><CreditNoteReplacement /></FullAppOnly>} />
                <Route path="repairs" element={<FullAppOnly><Repairs /></FullAppOnly>} />
                <Route path="ledger" element={<FullAppOnly><Ledger /></FullAppOnly>} />
                <Route path="ledger/:customerId" element={<FullAppOnly><LedgerDetail /></FullAppOnly>} />
                <Route path="personal-ledger" element={<FullAppOnly><PersonalLedger /></FullAppOnly>} />
                <Route path="personal-ledger/:customerId" element={<FullAppOnly><PersonalLedgerDetail /></FullAppOnly>} />
                <Route path="internal-ledger" element={<FullAppOnly><InternalLedger /></FullAppOnly>} />
                <Route path="internal-ledger/:customerId" element={<FullAppOnly><InternalLedgerDetail /></FullAppOnly>} />
                <Route path="payment-reminders" element={<FullAppOnly><PaymentReminders /></FullAppOnly>} />
                <Route path="expenses" element={<FullAppOnly><Expenses /></FullAppOnly>} />
                <Route path="payments" element={<FullAppOnly><Payments /></FullAppOnly>} />
                <Route path="stock" element={<FullAppOnly><StockOverview /></FullAppOnly>} />
                <Route path="stores" element={<FullAppOnly><Stores /></FullAppOnly>} />
                <Route path="search" element={<FullAppOnly><Search /></FullAppOnly>} />
                <Route path="vendors" element={<FullAppOnly><Vendors /></FullAppOnly>} />
                <Route path="defective-move-outs" element={<FullAppOnly><DefectiveMoveOuts /></FullAppOnly>} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
