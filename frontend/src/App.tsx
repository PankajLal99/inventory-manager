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
import Customers from './pages/customers/Customers';
import PersonalCustomers from './pages/customers/PersonalCustomers';
import Purchases from './pages/purchases/Purchases';
import PurchaseDetail from './pages/purchases/PurchaseDetail';
import Pricing from './pages/pricing/Pricing';
import History from './pages/history/History';
import Invoices from './pages/invoices/Invoices';
import InvoiceDetail from './pages/invoices/InvoiceDetail';
import Reports from './pages/reports/Reports';
import Replacement from './pages/replacement/Replacement';
import ReplaceProduct from './pages/replacement/ReplaceProduct';
import ReturnToStock from './pages/replacement/ReturnToStock';
import CreditNoteReplacement from './pages/replacement/CreditNoteReplacement';
import CreditNotes from './pages/credit-notes/CreditNotes';
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      // Default cache settings: 5 minutes stale time, 30 minutes garbage collection
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 30 * 60 * 1000, // 30 minutes (formerly cacheTime)
    },
  },
});

// Helper to get cache settings for specific query types
export const getCacheConfig = (queryType: 'products' | 'customers' | 'barcodes' | 'purchases' | 'dashboard' | 'default') => {
  const configs = {
    products: {
      staleTime: 2 * 60 * 1000, // 2 minutes - products change frequently
      gcTime: 15 * 60 * 1000, // 15 minutes
    },
    customers: {
      staleTime: 5 * 60 * 1000, // 5 minutes - customers change less frequently
      gcTime: 30 * 60 * 1000, // 30 minutes
    },
    barcodes: {
      staleTime: 1 * 60 * 1000, // 1 minute - barcodes change very frequently
      gcTime: 10 * 60 * 1000, // 10 minutes
    },
    purchases: {
      staleTime: 3 * 60 * 1000, // 3 minutes - purchases change moderately
      gcTime: 20 * 60 * 1000, // 20 minutes
    },
    dashboard: {
      staleTime: 1 * 60 * 1000, // 1 minute - dashboard KPIs change frequently with new transactions
      gcTime: 10 * 60 * 1000, // 10 minutes
    },
    default: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
    },
  };
  return configs[queryType] || configs.default;
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
                <Route path="products" element={<Products />} />
                <Route path="products/:id" element={<ProductDetail />} />
                <Route path="pos" element={<POS />} />
                <Route path="pos-repair" element={<POSRepair />} />
                <Route path="customers" element={<Customers />} />
                <Route path="personal-customers" element={<PersonalCustomers />} />
                <Route path="purchases" element={<Purchases />} />
                <Route path="purchases/:id" element={<PurchaseDetail />} />
                <Route path="pricing" element={<Pricing />} />
                <Route path="invoices" element={<Invoices />} />
                <Route path="invoices/:id" element={<InvoiceDetail />} />
                <Route path="credit-notes" element={<CreditNotes />} />
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
