import axios from 'axios';

// Get API URL from runtime config (for production) or build-time env (for development)
// Priority: window.__ENV__ > import.meta.env.VITE_API_URL > default
const getApiBaseUrl = (): string => {
  let baseUrl: string;

  // Check for runtime config injected by server.js
  if (typeof window !== 'undefined') {
    // Check for window.__ENV__ (injected by server.js)
    const windowEnv = (window as any).__ENV__;
    if (windowEnv?.VITE_API_URL) {
      baseUrl = windowEnv.VITE_API_URL;
    } else {
      // Fall back to build-time env variable (works in dev, but hardcoded in production build)
      const buildTimeUrl = import.meta.env.VITE_API_URL;
      baseUrl = buildTimeUrl || 'http://localhost:8765/api/v1';
    }
  } else {
    // Fall back to build-time env variable
    const buildTimeUrl = import.meta.env.VITE_API_URL;
    baseUrl = buildTimeUrl || 'http://localhost:8765/api/v1';
  }

  // Normalize URL: remove trailing slash to prevent double slashes
  return baseUrl.replace(/\/+$/, '');
};

const API_BASE_URL = getApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle token refresh and errors
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Handle 401 Unauthorized - try to refresh token
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = localStorage.getItem('refresh_token');
        if (refreshToken) {
          const response = await axios.post(`${API_BASE_URL}/auth/refresh/`, {
            refresh: refreshToken,
          });
          const { access } = response.data;
          localStorage.setItem('access_token', access);
          originalRequest.headers.Authorization = `Bearer ${access}`;
          return api(originalRequest);
        }
      } catch (refreshError: any) {
        // Clear invalid tokens regardless of error type (401, 500, etc.)
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        // Silently handle invalid tokens - don't log errors or redirect unnecessarily
        if (refreshError.response?.status === 401 || refreshError.response?.status === 500) {
          // Token is invalid or user doesn't exist - clear and continue
          // Only redirect if not already on login/register page
          if (!window.location.pathname.includes('/login') && !window.location.pathname.includes('/register')) {
            window.location.href = '/login';
          }
        }
        return Promise.reject(refreshError);
      }
    }

    // Handle 403 Forbidden
    if (error.response?.status === 403) {
    }

    // Handle 404 Not Found
    if (error.response?.status === 404) {
    }

    return Promise.reject(error);
  }
);

export default api;

// Auth API
export const authApi = {
  register: (data: any) => api.post('/auth/register/', data),
  login: (username: string, password: string) =>
    api.post('/auth/login/', { username, password }),
  refresh: (refresh: string) => api.post('/auth/refresh/', { refresh }),
  me: () => api.get('/auth/me/'),
};

// Products API
export const productsApi = {
  list: (params?: any) => api.get('/products/', { params }),
  get: (id: number) => api.get(`/products/${id}/`),
  create: (data: any) => api.post('/products/', data),
  update: (id: number, data: any) => api.patch(`/products/${id}/`, data),
  delete: (id: number) => api.delete(`/products/${id}/`),
  variants: (id: number) => api.get(`/products/${id}/variants/`),
  barcodes: (id: number, params?: any) => api.get(`/products/${id}/barcodes/`, { params }),
  byBarcode: (barcode: string, barcodeOnly: boolean = false) => {
    const params = barcodeOnly ? { barcode_only: 'true' } : {};
    return api.get(`/barcodes/by-barcode/${barcode}/`, { params });
  },
  generateLabel: (zplCode: string) => api.post('/products/generate-label/', { zpl_code: zplCode }),
  generateLabels: (productId: number, purchaseId?: number) => {
    const data = purchaseId ? { purchase_id: purchaseId } : {};
    return api.post(`/products/${productId}/generate-labels/`, data);
  },
  getLabels: (productId: number, purchaseId?: number) => {
    const params = purchaseId ? { purchase_id: purchaseId } : {};
    return api.get(`/products/${productId}/labels/`, { params });
  },
  labelsStatus: (productId: number, purchaseId?: number) => {
    const params = purchaseId ? { purchase_id: purchaseId } : {};
    return api.get(`/products/${productId}/labels-status/`, { params });
  },
  regenerateLabels: (productId: number, purchaseId?: number) => {
    const data = purchaseId ? { purchase_id: purchaseId } : {};
    return api.post(`/products/${productId}/regenerate-labels/`, data);
  },
};

// Inventory API
export const inventoryApi = {
  stock: {
    list: (params?: any) => api.get('/stock/', { params }),
    get: (productId: number) => api.get(`/stock/${productId}/`),
    low: () => api.get('/stock/low/'),
    outOfStock: () => api.get('/stock/out-of-stock/'),
  },
  adjustments: {
    list: () => api.get('/stock-adjustments/'),
    create: (data: any) => api.post('/stock-adjustments/', data),
  },
  transfers: {
    list: () => api.get('/stock-transfers/'),
    create: (data: any) => api.post('/stock-transfers/', data),
  },
};

// POS API
export const posApi = {
  carts: {
    create: (data: any) => api.post('/pos/carts/', data),
    get: (id: number) => api.get(`/pos/carts/${id}/`),
    getActive: () => api.get('/pos/carts/?active=true&single=true'), // Backward compatible
    getAllActive: () => api.get('/pos/carts/?active=true'), // Get all active carts
    update: (id: number, data: any) => api.patch(`/pos/carts/${id}/`, data),
    delete: (id: number) => api.delete(`/pos/carts/${id}/`),
    addItem: (id: number, data: any) => api.post(`/pos/carts/${id}/items/`, data),
    updateItem: (cartId: number, itemId: number, data: any) => api.patch(`/pos/carts/${cartId}/items/${itemId}/`, data),
    deleteItem: (cartId: number, itemId: number) => api.delete(`/pos/carts/${cartId}/items/${itemId}/`),
    removeSku: (cartId: number, itemId: number, barcode: string) => api.post(`/pos/carts/${cartId}/items/${itemId}/remove-sku/`, { barcode }),
    checkout: (id: number, data: any) => api.post(`/pos/carts/${id}/checkout/`, data),
  },
  invoices: {
    list: (params?: any) => api.get('/pos/invoices/', { params }),
    get: (id: number) => api.get(`/pos/invoices/${id}/`),
    create: (data: any) => api.post('/pos/invoices/', data),
    update: (id: number, data: any) => api.patch(`/pos/invoices/${id}/`, data),
    delete: (id: number, force?: boolean, restoreStock?: boolean) => {
      const url = `/pos/invoices/${id}/`;
      const params = new URLSearchParams();
      if (force) {
        params.append('force', 'true');
      }
      if (restoreStock !== undefined) {
        params.append('restore_stock', restoreStock ? 'true' : 'false');
      }
      const queryString = params.toString();
      return api.delete(queryString ? `${url}?${queryString}` : url);
    },
    void: (id: number) => api.post(`/pos/invoices/${id}/void/`),
    checkout: (id: number, data?: any) => api.post(`/pos/invoices/${id}/checkout/`, data),
    markCredit: (id: number, data?: any) => api.post(`/pos/invoices/${id}/mark-credit/`, data),
    payments: (id: number, data: any) => api.post(`/pos/invoices/${id}/payments/`, data),
    addItem: (id: number, data: any) => api.post(`/pos/invoices/${id}/items/`, data),
    updateItem: (id: number, itemId: number, data: any) => api.patch(`/pos/invoices/${id}/items/${itemId}/`, data),
    deleteItem: (id: number, itemId: number) => api.delete(`/pos/invoices/${id}/items/${itemId}/`),
  },
  replacement: {
    check: (data: any) => api.post('/pos/replacement/check/', data),
    create: (data: any) => api.post('/pos/replacement/create/', data),
    updateTag: (barcodeId: number, data: any) => api.post(`/pos/replacement/barcode/${barcodeId}/update-tag/`, data),
    replace: (data: any) => api.post('/pos/replacement/replace/', data),
    return: (data: any) => api.post('/pos/replacement/return/', data),
    defective: (data: any) => api.post('/pos/replacement/defective/', data),
    findInvoiceByBarcode: (data: any) => api.post('/pos/replacement/find-invoice/', data),
    searchInvoices: (search: string) => api.get('/pos/replacement/search-invoices/', { params: { search } }),
    processReplacement: (invoiceId: number, data: any) => api.post(`/pos/replacement/${invoiceId}/process/`, data),
    creditNote: (invoiceId: number, data: any) => api.post(`/pos/replacement/${invoiceId}/credit-note/`, data),
  },
  repair: {
    invoices: {
      list: (params?: any) => api.get('/pos/repair/invoices/', { params }),
      findByBarcode: (repairBarcode: string) => api.get('/pos/repair/invoices/find-by-barcode/', { params: { repair_barcode: repairBarcode } }),
    },
    updateStatus: (invoiceId: number, data: { repair_status: string }) => api.patch(`/pos/invoices/${invoiceId}/update-repair-status/`, data),
    generateLabel: (invoiceId: number) => api.post(`/pos/invoices/${invoiceId}/generate-repair-label/`),
  },
  creditNotes: {
    list: (params?: any) => api.get('/credit-notes/', { params }),
    get: (id: number) => api.get(`/credit-notes/${id}/`),
  },
};

// Customers API
export const customersApi = {
  list: (params?: any) => api.get('/customers/', { params }),
  get: (id: number) => api.get(`/customers/${id}/`),
  create: (data: any) => api.post('/customers/', data),
  update: (id: number, data: any) => api.patch(`/customers/${id}/`, data),
  delete: (id: number) => api.delete(`/customers/${id}/`),
  groups: {
    list: () => api.get('/customer-groups/'),
    get: (id: number) => api.get(`/customer-groups/${id}/`),
    create: (data: any) => api.post('/customer-groups/', data),
  },
  ledger: {
    entries: {
      list: (params?: any) => api.get('/ledger/entries/', { params }),
      create: (data: any) => api.post('/ledger/entries/', data),
    },
    summary: (params?: any) => api.get('/ledger/summary/', { params }),
    customerDetail: (customerId: number, params?: any) => api.get(`/ledger/customers/${customerId}/`, { params }),
  },
  personalCustomers: {
    list: (params?: any) => api.get('/personal-customers/', { params }),
    get: (id: number) => api.get(`/personal-customers/${id}/`),
    create: (data: any) => api.post('/personal-customers/', data),
    update: (id: number, data: any) => api.patch(`/personal-customers/${id}/`, data),
    delete: (id: number) => api.delete(`/personal-customers/${id}/`),
  },
  personalLedger: {
    entries: {
      list: (params?: any) => api.get('/personal-ledger/entries/', { params }),
      create: (data: any) => api.post('/personal-ledger/entries/', data),
    },
    summary: (params?: any) => api.get('/personal-ledger/summary/', { params }),
    customerDetail: (customerId: number, params?: any) => api.get(`/personal-ledger/customers/${customerId}/`, { params }),
  },
  internalCustomers: {
    list: (params?: any) => api.get('/internal-customers/', { params }),
    get: (id: number) => api.get(`/internal-customers/${id}/`),
    create: (data: any) => api.post('/internal-customers/', data),
    update: (id: number, data: any) => api.patch(`/internal-customers/${id}/`, data),
    delete: (id: number) => api.delete(`/internal-customers/${id}/`),
  },
  internalLedger: {
    entries: {
      list: (params?: any) => api.get('/internal-ledger/entries/', { params }),
      create: (data: any) => api.post('/internal-ledger/entries/', data),
    },
    summary: (params?: any) => api.get('/internal-ledger/summary/', { params }),
    customerDetail: (customerId: number, params?: any) => api.get(`/internal-ledger/customers/${customerId}/`, { params }),
  },
};

// Categories, Brands, etc.
export const catalogApi = {
  categories: {
    list: () => api.get('/categories/'),
    create: (data: any) => api.post('/categories/', data),
  },
  brands: {
    list: () => api.get('/brands/'),
    create: (data: any) => api.post('/brands/', data),
  },
  taxRates: {
    list: () => api.get('/tax-rates/'),
    get: (id: number) => api.get(`/tax-rates/${id}/`),
    create: (data: any) => api.post('/tax-rates/', data),
  },
  stores: {
    list: () => api.get('/stores/'),
    get: (id: number) => api.get(`/stores/${id}/`),
    create: (data: any) => api.post('/stores/', data),
    update: (id: number, data: any) => api.patch(`/stores/${id}/`, data),
    delete: (id: number) => api.delete(`/stores/${id}/`),
  },
  warehouses: {
    list: () => api.get('/warehouses/'),
  },
  barcodes: {
    updateTag: (barcodeId: number, data: any) => api.patch(`/barcodes/${barcodeId}/update-tag/`, data),
    bulkUpdateTags: (data: any) => api.post('/barcodes/bulk-update-tags/', data),
  },
  defectiveProducts: {
    moveOut: (data: any) => api.post('/defective-products/move-out/', data),
    moveOuts: {
      list: (params?: any) => api.get('/defective-products/move-outs/', { params }),
      get: (id: number) => api.get(`/defective-products/move-outs/${id}/`),
      updateAdjustment: (id: number, data: { total_adjustment: number }) => api.patch(`/defective-products/move-outs/${id}/`, data),
    },
  },
};

// Purchasing API
export const purchasingApi = {
  purchases: {
    list: (params?: any) => api.get('/purchases/', { params }),
    get: (id: number) => api.get(`/purchases/${id}/`),
    create: (data: any) => api.post('/purchases/', data),
    update: (id: number, data: any) => api.patch(`/purchases/${id}/`, data),
    delete: (id: number) => api.delete(`/purchases/${id}/`),
    finalize: (id: number, data?: any) => api.post(`/purchases/${id}/finalize/`, data || {}),
    items: {
      list: (purchaseId: number) => api.get(`/purchases/${purchaseId}/items/`),
      create: (purchaseId: number, data: any) => api.post(`/purchases/${purchaseId}/items/`, data),
      update: (purchaseId: number, data: any) => api.put(`/purchases/${purchaseId}/items/`, data),
      delete: (purchaseId: number, itemId: number) => api.delete(`/purchases/${purchaseId}/items/?item_id=${itemId}`),
      updatePrinted: (itemId: number, printed: boolean) => api.patch(`/purchases/items/${itemId}/update-printed/`, { printed }),
    },
  },
  vendorPurchases: {
    list: (supplierId: string, params?: any) => api.get('/vendor-purchases/', { params: { supplier: supplierId, ...params } }),
    get: (supplierId: string, id: number) => api.get(`/vendor-purchases/${id}/`, { params: { supplier: supplierId } }),
    create: (supplierId: string, data: any) => api.post('/vendor-purchases/', data, { params: { supplier: supplierId } }),
    update: (supplierId: string, id: number, data: any) => api.patch(`/vendor-purchases/${id}/`, data, { params: { supplier: supplierId } }),
    cancel: (supplierId: string, id: number) => api.post(`/vendor-purchases/${id}/cancel/`, {}, { params: { supplier: supplierId } }),
  },
  suppliers: {
    list: (params?: any) => api.get('/suppliers/', { params }),
    get: (id: number) => api.get(`/suppliers/${id}/`),
    create: (data: any) => api.post('/suppliers/', data),
    update: (id: number, data: any) => api.patch(`/suppliers/${id}/`, data),
    delete: (id: number) => api.delete(`/suppliers/${id}/`),
  },
};

// Pricing API
export const pricingApi = {
  priceLists: {
    list: () => api.get('/price-lists/'),
    get: (id: number) => api.get(`/price-lists/${id}/`),
    create: (data: any) => api.post('/price-lists/', data),
    update: (id: number, data: any) => api.patch(`/price-lists/${id}/`, data),
    delete: (id: number) => api.delete(`/price-lists/${id}/`),
  },
  promotions: {
    list: () => api.get('/promotions/'),
    get: (id: number) => api.get(`/promotions/${id}/`),
    create: (data: any) => api.post('/promotions/', data),
    update: (id: number, data: any) => api.patch(`/promotions/${id}/`, data),
    delete: (id: number) => api.delete(`/promotions/${id}/`),
  },
};

// History/Audit Logs API
export const historyApi = {
  list: (params?: any) => api.get('/audit-logs/', { params }),
  get: (id: number) => api.get(`/audit-logs/${id}/`),
};

// Reports API
export const reportsApi = {
  salesSummary: (params?: any) => api.get('/reports/sales-summary/', { params }),
  topProducts: (params?: any) => api.get('/reports/top-products/', { params }),
  inventorySummary: (params?: any) => api.get('/reports/inventory-summary/', { params }),
  revenue: (params?: any) => api.get('/reports/revenue/', { params }),
  customers: (params?: any) => api.get('/reports/customers/', { params }),
  stockOrdering: (params?: any) => api.get('/reports/stock-ordering/', { params }),
  dashboardKpis: (params?: any) => api.get('/reports/dashboard-kpis/', { params }),
};

// Global Search API
export const searchApi = {
  search: (query: string) => api.get('/search/', { params: { q: query } }),
};

