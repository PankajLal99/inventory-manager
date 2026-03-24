import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_API_URL = 'https://mtims-api.intratechnosolutions.com/api/v1';

let API_BASE_URL = DEFAULT_API_URL;

export async function initApiBaseUrl() {
  const stored = await AsyncStorage.getItem('api_base_url');
  if (stored) {
    API_BASE_URL = stored.replace(/\/+$/, '');
    api.defaults.baseURL = API_BASE_URL;
  }
}

export async function setApiBaseUrl(url: string) {
  API_BASE_URL = url.replace(/\/+$/, '');
  api.defaults.baseURL = API_BASE_URL;
  await AsyncStorage.setItem('api_base_url', API_BASE_URL);
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Request interceptor — attach access token
api.interceptors.request.use(
  async (config) => {
    const token = await SecureStore.getItemAsync('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor — auto-refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = await SecureStore.getItemAsync('refresh_token');
        if (refreshToken) {
          const response = await axios.post(`${API_BASE_URL}/auth/refresh/`, {
            refresh: refreshToken,
          });
          const { access } = response.data;
          await SecureStore.setItemAsync('access_token', access);
          originalRequest.headers.Authorization = `Bearer ${access}`;
          return api(originalRequest);
        }
      } catch {
        await SecureStore.deleteItemAsync('access_token');
        await SecureStore.deleteItemAsync('refresh_token');
      }
    }
    return Promise.reject(error);
  },
);

export default api;

// ─── Auth API ──────────────────────────────────────────────────
export const authApi = {
  register: (data: any) => api.post('/auth/register/', data),
  login: (username: string, password: string) =>
    api.post('/auth/login/', { username, password }),
  refresh: (refresh: string) => api.post('/auth/refresh/', { refresh }),
  me: () => api.get('/auth/me/'),
};

// ─── Products API ──────────────────────────────────────────────
export const productsApi = {
  list: (params?: any) => api.get('/products/', { params }),
  get: (id: number) => api.get(`/products/${id}/`),
  create: (data: any) => api.post('/products/', data),
  update: (id: number, data: any) => api.patch(`/products/${id}/`, data),
  delete: (id: number) => api.delete(`/products/${id}/`),
  variants: (id: number) => api.get(`/products/${id}/variants/`),
  barcodes: (id: number, params?: any) =>
    api.get(`/products/${id}/barcodes/`, { params }),
  barcodesFull: (id: number) => api.get(`/products/${id}/barcodes-full/`),
  invoices: (id: number) => api.get(`/products/${id}/invoices/`),
  byBarcode: (barcode: string, barcodeOnly = false, noCache = false) => {
    const params: Record<string, string> = {};
    if (barcodeOnly) params.barcode_only = 'true';
    if (noCache) params.no_cache = 'true';
    return api.get(`/barcodes/by-barcode/${barcode}/`, { params });
  },
  generateLabel: (zplCode: string) =>
    api.post('/products/generate-label/', { zpl_code: zplCode }),
  generateLabels: (productId: number, purchaseId?: number, supplierId?: string) => {
    const data = purchaseId ? { purchase_id: purchaseId } : {};
    const params = supplierId ? { supplier: supplierId } : {};
    return api.post(`/products/${productId}/generate-labels/`, data, { params });
  },
  getLabels: (productId: number, purchaseId?: number, supplierId?: string) => {
    const params: Record<string, number | string> = {};
    if (purchaseId) params.purchase_id = purchaseId;
    if (supplierId) params.supplier = supplierId;
    return api.get(`/products/${productId}/labels/`, { params });
  },
  labelsStatus: (productId: number, purchaseId?: number, supplierId?: string) => {
    const params: Record<string, number | string> = {};
    if (purchaseId) params.purchase_id = purchaseId;
    if (supplierId) params.supplier = supplierId;
    return api.get(`/products/${productId}/labels-status/`, { params });
  },
  regenerateLabels: (productId: number, purchaseId?: number) => {
    const data = purchaseId ? { purchase_id: purchaseId } : {};
    return api.post(`/products/${productId}/regenerate-labels/`, data);
  },
};

// ─── Inventory API ─────────────────────────────────────────────
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

// ─── POS API ───────────────────────────────────────────────────
export const posApi = {
  carts: {
    create: (data: any) => api.post('/pos/carts/', data),
    get: (id: number) => api.get(`/pos/carts/${id}/`),
    getActive: () => api.get('/pos/carts/?active=true&single=true'),
    getAllActive: () => api.get('/pos/carts/?active=true'),
    getOverview: (params?: { store?: number }) =>
      api.get('/pos/carts/overview/', { params }),
    update: (id: number, data: any) => api.patch(`/pos/carts/${id}/`, data),
    delete: (id: number) => api.delete(`/pos/carts/${id}/`),
    addItem: (id: number, data: any) =>
      api.post(`/pos/carts/${id}/items/`, data),
    bulkBarcodesCheck: (barcodes: string[]) =>
      api.post('/pos/carts/bulk-barcodes-check/', { barcodes }),
    updateItem: (cartId: number, itemId: number, data: any) =>
      api.patch(`/pos/carts/${cartId}/items/${itemId}/`, data),
    deleteItem: (cartId: number, itemId: number) =>
      api.delete(`/pos/carts/${cartId}/items/${itemId}/`),
    removeSku: (cartId: number, itemId: number, barcode: string) =>
      api.post(`/pos/carts/${cartId}/items/${itemId}/remove-sku/`, { barcode }),
    checkout: (id: number, data: any) =>
      api.post(`/pos/carts/${id}/checkout/`, data),
  },
  invoices: {
    list: (params?: any) => api.get('/pos/invoices/', { params }),
    get: (id: number) => api.get(`/pos/invoices/${id}/`),
    create: (data: any) => api.post('/pos/invoices/', data),
    update: (id: number, data: any) => api.patch(`/pos/invoices/${id}/`, data),
    delete: (id: number, force?: boolean, restoreStock?: boolean) => {
      const url = `/pos/invoices/${id}/`;
      const params = new URLSearchParams();
      if (force) params.append('force', 'true');
      if (restoreStock !== undefined)
        params.append('restore_stock', restoreStock ? 'true' : 'false');
      const qs = params.toString();
      return api.delete(qs ? `${url}?${qs}` : url);
    },
    void: (id: number) => api.post(`/pos/invoices/${id}/void/`),
    checkout: (id: number, data?: any) =>
      api.post(`/pos/invoices/${id}/checkout/`, data),
    markCredit: (id: number, data?: any) =>
      api.post(`/pos/invoices/${id}/mark-credit/`, data),
    payments: (id: number, data: any) =>
      api.post(`/pos/invoices/${id}/payments/`, data),
    updatePayment: (id: number, data: any) =>
      api.patch(`/pos/invoices/${id}/payments/`, data),
    addItem: (id: number, data: any) =>
      api.post(`/pos/invoices/${id}/items/`, data),
    updateItem: (id: number, itemId: number, data: any) =>
      api.patch(`/pos/invoices/${id}/items/${itemId}/`, data),
    deleteItem: (id: number, itemId: number) =>
      api.delete(`/pos/invoices/${id}/items/${itemId}/`),
    edit: (id: number) => api.post(`/pos/invoices/${id}/edit/`),
    updateFromCart: (id: number, cartId: number) =>
      api.post(`/pos/invoices/${id}/update/`, { cart_id: cartId }),
  },
  replacement: {
    check: (data: any) => api.post('/pos/replacement/check/', data),
    create: (data: any) => api.post('/pos/replacement/create/', data),
    reserveBarcode: (data: {
      barcode_id: number;
      action?: 'reserve' | 'release';
      restore_tag?: 'new' | 'returned';
    }) => api.post('/pos/replacement/reserve-barcode/', data),
    updateTag: (barcodeId: number, data: any) =>
      api.post(`/pos/replacement/barcode/${barcodeId}/update-tag/`, data),
    replace: (data: any) => api.post('/pos/replacement/replace/', data),
    return: (data: any) => api.post('/pos/replacement/return/', data),
    defective: (data: any) => api.post('/pos/replacement/defective/', data),
    findInvoiceByBarcode: (data: any) =>
      api.post('/pos/replacement/find-invoice/', data),
    bulkBarcodesCheck: (barcodes: string[]) =>
      api.post('/pos/replacement/bulk-barcodes-check/', { barcodes }),
    searchInvoices: (search: string) =>
      api.get('/pos/replacement/search-invoices/', { params: { search } }),
    processReplacement: (invoiceId: number, data: any) =>
      api.post(`/pos/replacement/${invoiceId}/process/`, data),
    creditNote: (invoiceId: number, data: any) =>
      api.post(`/pos/replacement/${invoiceId}/credit-note/`, data),
  },
  repair: {
    invoices: {
      list: (params?: any) => api.get('/pos/repair/invoices/', { params }),
      findByBarcode: (repairBarcode: string) =>
        api.get('/pos/repair/invoices/find-by-barcode/', {
          params: { repair_barcode: repairBarcode },
        }),
    },
    getStatusChoices: () =>
      api.get<{ value: string; label: string }[]>(
        '/pos/repair/status-choices/',
      ),
    getDeviceModels: (search?: string) =>
      api.get<{ models: string[] }>('/pos/repair/device-models/', {
        params: search ? { search } : {},
      }),
    updateStatus: (invoiceId: number, data: { repair_status: string }) =>
      api.patch(`/pos/invoices/${invoiceId}/update-repair-status/`, data),
    update: (
      invoiceId: number,
      data: {
        contact_no?: string;
        model_name?: string;
        description?: string;
        booking_amount?: string | null;
      },
    ) => api.patch(`/pos/invoices/${invoiceId}/update-repair/`, data),
    generateLabel: (invoiceId: number) =>
      api.post(`/pos/invoices/${invoiceId}/generate-repair-label/`),
  },
  creditNotes: {
    list: (params?: any) => api.get('/credit-notes/', { params }),
    get: (id: number) => api.get(`/credit-notes/${id}/`),
  },
  expenses: {
    list: (params?: any) => api.get('/expenses/', { params }),
    types: (params?: any) => api.get('/expenses/types/', { params }),
    borrowers: (params?: any) => api.get('/expenses/borrowers/', { params }),
    get: (id: number) => api.get(`/expenses/${id}/`),
    create: (data: any) => api.post('/expenses/', data),
    update: (id: number, data: any) => api.patch(`/expenses/${id}/`, data),
    delete: (id: number) => api.delete(`/expenses/${id}/`),
  },
};

// ─── Customers API ─────────────────────────────────────────────
export const customersApi = {
  list: (params?: any) => api.get('/customers/', { params }),
  get: (id: number) => api.get(`/customers/${id}/`),
  create: (data: any) => api.post('/customers/', data),
  update: (id: number, data: any) => api.patch(`/customers/${id}/`, data),
  delete: (id: number) => api.delete(`/customers/${id}/`),
  groups: {
    list: () => api.get('/customer-groups/'),
    create: (data: any) => api.post('/customer-groups/', data),
  },
  ledger: {
    entries: {
      list: (params?: any) => api.get('/ledger/entries/', { params }),
      create: (data: any) => api.post('/ledger/entries/', data),
      get: (id: number) => api.get(`/ledger/entries/${id}/`),
      update: (id: number, data: any) =>
        api.patch(`/ledger/entries/${id}/`, data),
      delete: (id: number) => api.delete(`/ledger/entries/${id}/`),
    },
    byCustomer: (params?: any) => api.get('/ledger/by-customer/', { params }),
    summary: (params?: any) => api.get('/ledger/summary/', { params }),
    customerDetail: (customerId: number, params?: any) =>
      api.get(`/ledger/customers/${customerId}/`, { params }),
    invoiceItemsByCategory: (
      customerId: number,
      params?: {
        store?: number;
        categories?: number[];
        date_from?: string;
        date_to?: string;
      },
    ) => {
      const p: any = { ...params };
      if (p.categories?.length) p.categories = p.categories.join(',');
      return api.get(
        `/ledger/customers/${customerId}/invoice-items-by-category/`,
        { params: p },
      );
    },
  },
  personalCustomers: {
    list: (params?: any) => api.get('/personal-customers/', { params }),
    get: (id: number) => api.get(`/personal-customers/${id}/`),
    create: (data: any) => api.post('/personal-customers/', data),
    update: (id: number, data: any) =>
      api.patch(`/personal-customers/${id}/`, data),
    delete: (id: number) => api.delete(`/personal-customers/${id}/`),
  },
  personalLedger: {
    entries: {
      list: (params?: any) => api.get('/personal-ledger/entries/', { params }),
      create: (data: any) => api.post('/personal-ledger/entries/', data),
      get: (id: number) => api.get(`/personal-ledger/entries/${id}/`),
      update: (id: number, data: any) =>
        api.patch(`/personal-ledger/entries/${id}/`, data),
      delete: (id: number) => api.delete(`/personal-ledger/entries/${id}/`),
    },
    summary: (params?: any) => api.get('/personal-ledger/summary/', { params }),
    customerDetail: (customerId: number, params?: any) =>
      api.get(`/personal-ledger/customers/${customerId}/`, { params }),
  },
  internalCustomers: {
    list: (params?: any) => api.get('/internal-customers/', { params }),
    get: (id: number) => api.get(`/internal-customers/${id}/`),
    create: (data: any) => api.post('/internal-customers/', data),
    update: (id: number, data: any) =>
      api.patch(`/internal-customers/${id}/`, data),
    delete: (id: number) => api.delete(`/internal-customers/${id}/`),
  },
  internalLedger: {
    entries: {
      list: (params?: any) => api.get('/internal-ledger/entries/', { params }),
      create: (data: any) => api.post('/internal-ledger/entries/', data),
      get: (id: number) => api.get(`/internal-ledger/entries/${id}/`),
      update: (id: number, data: any) =>
        api.patch(`/internal-ledger/entries/${id}/`, data),
      delete: (id: number) => api.delete(`/internal-ledger/entries/${id}/`),
    },
    summary: (params?: any) =>
      api.get('/internal-ledger/summary/', { params }),
    customerDetail: (customerId: number, params?: any) =>
      api.get(`/internal-ledger/customers/${customerId}/`, { params }),
  },
  paymentReminders: {
    list: (params?: any) => api.get('/payment-reminders/', { params }),
    get: (id: number) => api.get(`/payment-reminders/${id}/`),
    calendar: (params?: any) =>
      api.get('/payment-reminders/calendar/', { params }),
    create: (data: any) => api.post('/payment-reminders/', data),
    update: (id: number, data: any) =>
      api.patch(`/payment-reminders/${id}/`, data),
    delete: (id: number) => api.delete(`/payment-reminders/${id}/`),
  },
};

// ─── Catalog API ───────────────────────────────────────────────
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
    updateTag: (barcodeId: number, data: any) =>
      api.patch(`/barcodes/${barcodeId}/update-tag/`, data),
    bulkUpdateTags: (data: any) => api.post('/barcodes/bulk-update-tags/', data),
  },
  defectiveProducts: {
    moveOut: (data: any) => api.post('/defective-products/move-out/', data),
    moveOuts: {
      list: (params?: any) =>
        api.get('/defective-products/move-outs/', { params }),
      get: (id: number) => api.get(`/defective-products/move-outs/${id}/`),
      updateAdjustment: (id: number, data: { total_adjustment: number }) =>
        api.patch(`/defective-products/move-outs/${id}/`, data),
    },
  },
};

// ─── Purchasing API ────────────────────────────────────────────
export const purchasingApi = {
  purchases: {
    list: (params?: any) => api.get('/purchases/', { params }),
    get: (id: number) => api.get(`/purchases/${id}/`),
    create: (data: any) => api.post('/purchases/', data),
    update: (id: number, data: any) => api.patch(`/purchases/${id}/`, data),
    delete: (id: number) => api.delete(`/purchases/${id}/`),
    finalize: (id: number, data?: any) =>
      api.post(`/purchases/${id}/finalize/`, data || {}),
    redistributeStock: (id: number, items: any[]) =>
      api.post(`/purchases/${id}/redistribute-stock/`, { items }),
    items: {
      list: (purchaseId: number) =>
        api.get(`/purchases/${purchaseId}/items/`),
      create: (purchaseId: number, data: any) =>
        api.post(`/purchases/${purchaseId}/items/`, data),
      update: (purchaseId: number, data: any) =>
        api.put(`/purchases/${purchaseId}/items/`, data),
      delete: (purchaseId: number, itemId: number) =>
        api.delete(`/purchases/${purchaseId}/items/?item_id=${itemId}`),
      updatePrinted: (itemId: number, printed: boolean) =>
        api.patch(`/purchases/items/${itemId}/update-printed/`, { printed }),
    },
  },
  vendorPurchases: {
    list: (supplierId: string, params?: any) =>
      api.get('/vendor-purchases/', {
        params: { supplier: supplierId, ...params },
      }),
    get: (supplierId: string, id: number) =>
      api.get(`/vendor-purchases/${id}/`, {
        params: { supplier: supplierId },
      }),
    create: (supplierId: string, data: any) =>
      api.post('/vendor-purchases/', data, {
        params: { supplier: supplierId },
      }),
    update: (supplierId: string, id: number, data: any) =>
      api.patch(`/vendor-purchases/${id}/`, data, {
        params: { supplier: supplierId },
      }),
    cancel: (supplierId: string, id: number) =>
      api.post(
        `/vendor-purchases/${id}/cancel/`,
        {},
        { params: { supplier: supplierId } },
      ),
  },
  suppliers: {
    list: (params?: any) => api.get('/suppliers/', { params }),
    get: (id: number) => api.get(`/suppliers/${id}/`),
    create: (data: any) => api.post('/suppliers/', data),
    update: (id: number, data: any) => api.patch(`/suppliers/${id}/`, data),
    delete: (id: number) => api.delete(`/suppliers/${id}/`),
  },
};

// ─── Pricing API ───────────────────────────────────────────────
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

// ─── History API ───────────────────────────────────────────────
export const historyApi = {
  list: (params?: any) => api.get('/audit-logs/', { params }),
  get: (id: number) => api.get(`/audit-logs/${id}/`),
};

// ─── Reports API ───────────────────────────────────────────────
export const reportsApi = {
  salesSummary: (params?: any) =>
    api.get('/reports/sales-summary/', { params }),
  topProducts: (params?: any) =>
    api.get('/reports/top-products/', { params }),
  inventorySummary: (params?: any) =>
    api.get('/reports/inventory-summary/', { params }),
  revenue: (params?: any) => api.get('/reports/revenue/', { params }),
  customers: (params?: any) => api.get('/reports/customers/', { params }),
  stockOrdering: (params?: any) =>
    api.get('/reports/stock-ordering/', { params }),
  dashboardKpis: (params?: any) =>
    api.get('/reports/dashboard-kpis/', { params }),
};

// ─── Search API ────────────────────────────────────────────────
export const searchApi = {
  search: (
    query: string,
    type = 'all',
    params?: { product_limit?: number },
  ) => api.get('/search/', { params: { q: query, type, ...params } }),
};
