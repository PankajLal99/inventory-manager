import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './lib/toast';
import { auth } from './lib/auth';
import Login from './pages/auth/Login';
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
import VendorPurchases from './pages/purchases/VendorPurchases';
import VendorPurchaseDetail from './pages/purchases/VendorPurchaseDetail';
import Vendors from './pages/vendors/Vendors';
import DefectiveMoveOuts from './pages/defective/DefectiveMoveOuts';
import PaymentReminders from './pages/payment-reminders/PaymentReminders';
import Expenses from './pages/expenses/Expenses';
import Payments from './pages/payments/Payments';
import StockOverview from './pages/stock/StockOverview';
import OverallProfitBillingDetails from './pages/dashboard/OverallProfitBillingDetails';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      // No caching: Always fetch fresh data on navigation
      staleTime: 0,
      gcTime: 0,
    },
  },
});

// Helper to get cache settings for specific query types
export const getCacheConfig = () => {
  // All caching disabled per request: Always return zero stale and GC time
  return {
    staleTime: 0,
    gcTime: 0,
  };
};

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!auth.isAuthenticated()) {
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
              <Route path="/register" element={<Register />} />
              {/* Public vendor routes (no auth required) */}
              <Route path="/vendor-purchases" element={<VendorPurchases />} />
              <Route path="/vendor-purchases/:id" element={<VendorPurchaseDetail />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<POS />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route
                  path="dashboard/overall-profit-billing-details"
                  element={<OverallProfitBillingDetails />}
                />
                <Route path="products" element={<Products />} />
                <Route path="products/:id" element={<ProductDetail />} />
                <Route path="pos" element={<POS />} />
                <Route path="active-carts" element={<ActiveCartsOverview />} />
                <Route path="pos-repair" element={<POSRepair />} />
                <Route path="pos-repair-new" element={<RepairRegistration />} />
                <Route path="customers" element={<Customers />} />
                <Route path="personal-customers" element={<PersonalCustomers />} />
                <Route path="purchases" element={<Purchases />} />
                <Route path="purchases/:id" element={<PurchaseDetail />} />
                <Route path="pricing" element={<Pricing />} />
                <Route path="invoices" element={<Invoices />} />
                <Route path="invoices/:id" element={<InvoiceDetail />} />
                <Route path="invoices/:id/edit" element={<InvoiceEdit />} />
                <Route path="credit-notes" element={<CreditNotes />} />
                <Route path="credit-notes/:id" element={<CreditNoteShowcase />} />
                <Route path="history" element={<History />} />
                <Route path="reports" element={<Reports />} />
                <Route path="replacement" element={<Replacement />} />
                <Route path="replacement/replace-product" element={<ReplaceProduct />} />
                <Route path="replacement/return-to-stock" element={<ReturnToStock />} />
                <Route path="replacement/credit-note" element={<CreditNoteReplacement />} />
                <Route path="repairs" element={<Repairs />} />
                <Route path="ledger" element={<Ledger />} />
                <Route path="ledger/:customerId" element={<LedgerDetail />} />
                <Route path="personal-ledger" element={<PersonalLedger />} />
                <Route path="personal-ledger/:customerId" element={<PersonalLedgerDetail />} />
                <Route path="internal-ledger" element={<InternalLedger />} />
                <Route path="internal-ledger/:customerId" element={<InternalLedgerDetail />} />
                <Route path="payment-reminders" element={<PaymentReminders />} />
                <Route path="expenses" element={<Expenses />} />
                <Route path="payments" element={<Payments />} />
                <Route path="stock" element={<StockOverview />} />
                <Route path="stores" element={<Stores />} />
                <Route path="search" element={<Search />} />
                <Route path="vendors" element={<Vendors />} />
                <Route path="defective-move-outs" element={<DefectiveMoveOuts />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
