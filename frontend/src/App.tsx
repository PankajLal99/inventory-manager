import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './lib/toast';
import { auth } from './lib/auth';
import Login from './pages/auth/Login';
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
import StockTransfers from './pages/stock/StockTransfers';
import RoleManagement from './pages/admin/RoleManagement';
import OnboardingSetup from './pages/onboarding/OnboardingSetup';
import SelfCheckout from './pages/checkout/SelfCheckout';

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

function PermissionRoute({
  children,
  permission,
  fallbackAllowed: _fallbackAllowed,
}: {
  children: React.ReactNode;
  permission: string;
  fallbackAllowed: (groups: string[]) => boolean;
}) {
  const user = auth.getUser();
  if (!user) {
    return <>{children}</>;
  }
  const effective = user.permissions;
  const hasAccess = Array.isArray(effective) && effective.includes(permission);
  if (!hasAccess) {
    return <Navigate to="/" replace />;
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
              <Route path="/register" element={<Navigate to="/login" replace />} />
              <Route path="/onboarding" element={<OnboardingSetup />} />
              {/* Public vendor routes (no auth required) */}
              <Route path="/vendor-purchases" element={<VendorPurchases />} />
              <Route path="/vendor-purchases/:id" element={<VendorPurchaseDetail />} />
              <Route path="/self-checkout" element={<PermissionRoute permission="nav.self_checkout" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale'].some((x) => g.includes(x))}><SelfCheckout /></PermissionRoute>} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<PermissionRoute permission="nav.pos" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale'].some((x) => g.includes(x))}><POS /></PermissionRoute>} />
                <Route path="dashboard" element={<PermissionRoute permission="nav.dashboard" fallbackAllowed={(g) => ['Admin', 'RetailAdmin'].some((x) => g.includes(x))}><Dashboard /></PermissionRoute>} />
                <Route
                  path="dashboard/overall-profit-billing-details"
                  element={<PermissionRoute permission="nav.dashboard" fallbackAllowed={(g) => ['Admin', 'RetailAdmin'].some((x) => g.includes(x))}><OverallProfitBillingDetails /></PermissionRoute>}
                />
                <Route
                  path="dashboard/overall-pending-invoice-details"
                  element={<PermissionRoute permission="nav.dashboard" fallbackAllowed={(g) => ['Admin', 'RetailAdmin'].some((x) => g.includes(x))}><OverallPendingInvoiceDetails /></PermissionRoute>}
                />
                <Route
                  path="dashboard/wholesale-pending-cleared-details"
                  element={<PermissionRoute permission="nav.dashboard" fallbackAllowed={(g) => ['Admin', 'RetailAdmin'].some((x) => g.includes(x))}><WholesalePendingClearedDetails /></PermissionRoute>}
                />
                <Route path="products" element={<PermissionRoute permission="nav.products" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale', 'Repair'].some((x) => g.includes(x))}><Products /></PermissionRoute>} />
                <Route path="products/:id" element={<PermissionRoute permission="nav.products" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale', 'Repair'].some((x) => g.includes(x))}><ProductDetail /></PermissionRoute>} />
                <Route path="pos" element={<PermissionRoute permission="nav.pos" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale'].some((x) => g.includes(x))}><POS /></PermissionRoute>} />
                <Route path="active-carts" element={<PermissionRoute permission="nav.active_carts" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale'].some((x) => g.includes(x))}><ActiveCartsOverview /></PermissionRoute>} />
                <Route path="pos-repair" element={<PermissionRoute permission="nav.repairs" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'WholesaleAdmin', 'Repair', 'Retail', 'Wholesale'].some((x) => g.includes(x))}><POSRepair /></PermissionRoute>} />
                <Route path="pos-repair-new" element={<PermissionRoute permission="nav.repair_register" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'WholesaleAdmin', 'Repair', 'Retail', 'Wholesale'].some((x) => g.includes(x))}><RepairRegistration /></PermissionRoute>} />
                <Route path="customers" element={<PermissionRoute permission="nav.customers" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'WholesaleAdmin'].some((x) => g.includes(x))}><Customers /></PermissionRoute>} />
                <Route path="personal-customers" element={<PersonalCustomers />} />
                <Route path="purchases" element={<PermissionRoute permission="nav.purchases" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale'].some((x) => g.includes(x))}><Purchases /></PermissionRoute>} />
                <Route path="purchases/:id" element={<PermissionRoute permission="nav.purchases" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale'].some((x) => g.includes(x))}><PurchaseDetail /></PermissionRoute>} />
                <Route path="pricing" element={<Pricing />} />
                <Route path="invoices" element={<PermissionRoute permission="nav.invoices" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale'].some((x) => g.includes(x))}><Invoices /></PermissionRoute>} />
                <Route path="invoices/:id" element={<PermissionRoute permission="nav.invoices" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale'].some((x) => g.includes(x))}><InvoiceDetail /></PermissionRoute>} />
                <Route path="invoices/:id/edit" element={<PermissionRoute permission="nav.invoices" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale'].some((x) => g.includes(x))}><InvoiceEdit /></PermissionRoute>} />
                <Route path="credit-notes" element={<PermissionRoute permission="nav.credit_notes" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail'].some((x) => g.includes(x))}><CreditNotes /></PermissionRoute>} />
                <Route path="credit-notes/:id" element={<PermissionRoute permission="nav.credit_notes" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail'].some((x) => g.includes(x))}><CreditNoteShowcase /></PermissionRoute>} />
                <Route path="history" element={<PermissionRoute permission="nav.history" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'WholesaleAdmin'].some((x) => g.includes(x))}><History /></PermissionRoute>} />
                <Route path="reports" element={<PermissionRoute permission="nav.reports" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'WholesaleAdmin'].some((x) => g.includes(x))}><Reports /></PermissionRoute>} />
                <Route path="replacement" element={<PermissionRoute permission="nav.replacement" fallbackAllowed={(g) => ['Admin', 'Retail', 'RetailAdmin', 'WholesaleAdmin', 'Wholesale'].some((x) => g.includes(x))}><Replacement /></PermissionRoute>} />
                <Route path="replacement/pos" element={<PermissionRoute permission="nav.replacement" fallbackAllowed={(g) => ['Admin', 'Retail', 'RetailAdmin', 'WholesaleAdmin', 'Wholesale'].some((x) => g.includes(x))}><ReplacementPOS /></PermissionRoute>} />
                <Route path="replacement/replace-product" element={<PermissionRoute permission="nav.replacement" fallbackAllowed={(g) => ['Admin', 'Retail', 'RetailAdmin', 'WholesaleAdmin', 'Wholesale'].some((x) => g.includes(x))}><ReplaceProduct /></PermissionRoute>} />
                <Route path="replacement/return-to-stock" element={<PermissionRoute permission="nav.replacement" fallbackAllowed={(g) => ['Admin', 'Retail', 'RetailAdmin', 'WholesaleAdmin', 'Wholesale'].some((x) => g.includes(x))}><ReturnToStock /></PermissionRoute>} />
                <Route path="replacement/credit-note" element={<PermissionRoute permission="nav.replacement" fallbackAllowed={(g) => ['Admin', 'Retail', 'RetailAdmin', 'WholesaleAdmin', 'Wholesale'].some((x) => g.includes(x))}><CreditNoteReplacement /></PermissionRoute>} />
                <Route path="repairs" element={<PermissionRoute permission="nav.repairs" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'WholesaleAdmin', 'Repair', 'Retail', 'Wholesale'].some((x) => g.includes(x))}><Repairs /></PermissionRoute>} />
                <Route path="ledger" element={<PermissionRoute permission="nav.ledger" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail'].some((x) => g.includes(x))}><Ledger /></PermissionRoute>} />
                <Route path="ledger/:customerId" element={<PermissionRoute permission="nav.ledger" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail'].some((x) => g.includes(x))}><LedgerDetail /></PermissionRoute>} />
                <Route path="personal-ledger" element={<PermissionRoute permission="nav.personal_ledger" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'WholesaleAdmin'].some((x) => g.includes(x))}><PersonalLedger /></PermissionRoute>} />
                <Route path="personal-ledger/:customerId" element={<PersonalLedgerDetail />} />
                <Route path="internal-ledger" element={<PermissionRoute permission="nav.internal_ledger" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail', 'Repair'].some((x) => g.includes(x))}><InternalLedger /></PermissionRoute>} />
                <Route path="internal-ledger/:customerId" element={<PermissionRoute permission="nav.internal_ledger" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail', 'Repair'].some((x) => g.includes(x))}><InternalLedgerDetail /></PermissionRoute>} />
                <Route path="payment-reminders" element={<PermissionRoute permission="nav.payment_reminders" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'WholesaleAdmin'].some((x) => g.includes(x))}><PaymentReminders /></PermissionRoute>} />
                <Route path="expenses" element={<PermissionRoute permission="nav.expenses" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'WholesaleAdmin', 'Temp', 'Retail', 'Wholesale'].some((x) => g.includes(x))}><Expenses /></PermissionRoute>} />
                <Route path="payments" element={<PermissionRoute permission="nav.payments" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail'].some((x) => g.includes(x))}><Payments /></PermissionRoute>} />
                <Route path="stock" element={<PermissionRoute permission="nav.stock_overview" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale'].some((x) => g.includes(x))}><StockOverview /></PermissionRoute>} />
                <Route path="stock-transfers" element={<PermissionRoute permission="nav.stock_transfers" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale'].some((x) => g.includes(x))}><StockTransfers /></PermissionRoute>} />
                <Route path="stores" element={<PermissionRoute permission="nav.stores" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'WholesaleAdmin'].some((x) => g.includes(x))}><Stores /></PermissionRoute>} />
                <Route path="search" element={<PermissionRoute permission="nav.search" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'Retail', 'WholesaleAdmin', 'Wholesale', 'Repair', 'Temp'].some((x) => g.includes(x))}><Search /></PermissionRoute>} />
                <Route path="vendors" element={<PermissionRoute permission="nav.vendors" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'WholesaleAdmin'].some((x) => g.includes(x))}><Vendors /></PermissionRoute>} />
                <Route path="defective-move-outs" element={<PermissionRoute permission="nav.defective_move_outs" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'WholesaleAdmin'].some((x) => g.includes(x))}><DefectiveMoveOuts /></PermissionRoute>} />
                <Route path="role-management" element={<PermissionRoute permission="nav.role_management" fallbackAllowed={(g) => ['Admin', 'RetailAdmin', 'WholesaleAdmin'].some((x) => g.includes(x))}><RoleManagement /></PermissionRoute>} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
