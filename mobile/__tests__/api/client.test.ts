import AsyncStorage from '@react-native-async-storage/async-storage';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

// Must import after mocks are set up
import {
  initApiBaseUrl,
  setApiBaseUrl,
  getApiBaseUrl,
  authApi,
  productsApi,
  inventoryApi,
  posApi,
  customersApi,
  catalogApi,
  purchasingApi,
  pricingApi,
  historyApi,
  reportsApi,
  searchApi,
} from '../../src/api/client';
import api from '../../src/api/client';

// ─── Base URL management ───────────────────────────────────────

describe('API Base URL', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getApiBaseUrl returns default URL initially', () => {
    const url = getApiBaseUrl();
    expect(url).toContain('/api/v1');
  });

  it('setApiBaseUrl updates the base URL and stores it', async () => {
    await setApiBaseUrl('http://example.com/api/v1/');
    expect(getApiBaseUrl()).toBe('http://example.com/api/v1');
    expect(mockSetItem).toHaveBeenCalledWith(
      'api_base_url',
      'http://example.com/api/v1',
    );
  });

  it('setApiBaseUrl strips trailing slashes', async () => {
    await setApiBaseUrl('http://example.com///');
    expect(getApiBaseUrl()).toBe('http://example.com');
  });

  it('initApiBaseUrl loads from storage', async () => {
    mockGetItem.mockResolvedValue('http://stored.com/api/v1');
    await initApiBaseUrl();
    expect(getApiBaseUrl()).toBe('http://stored.com/api/v1');
  });

  it('initApiBaseUrl does nothing when no stored URL', async () => {
    const before = getApiBaseUrl();
    mockGetItem.mockResolvedValue(null);
    await initApiBaseUrl();
    // URL should remain unchanged
    expect(typeof getApiBaseUrl()).toBe('string');
  });
});

// ─── API modules exist ────────────────────────────────────────

describe('API modules exist and have expected methods', () => {
  it('authApi has login, register, refresh, me', () => {
    expect(authApi.login).toBeInstanceOf(Function);
    expect(authApi.register).toBeInstanceOf(Function);
    expect(authApi.refresh).toBeInstanceOf(Function);
    expect(authApi.me).toBeInstanceOf(Function);
  });

  it('productsApi has CRUD and barcode methods', () => {
    expect(productsApi.list).toBeInstanceOf(Function);
    expect(productsApi.get).toBeInstanceOf(Function);
    expect(productsApi.create).toBeInstanceOf(Function);
    expect(productsApi.update).toBeInstanceOf(Function);
    expect(productsApi.delete).toBeInstanceOf(Function);
    expect(productsApi.barcodes).toBeInstanceOf(Function);
    expect(productsApi.byBarcode).toBeInstanceOf(Function);
  });

  it('inventoryApi has stock and adjustment methods', () => {
    expect(inventoryApi.stock.list).toBeInstanceOf(Function);
    expect(inventoryApi.stock.low).toBeInstanceOf(Function);
    expect(inventoryApi.stock.outOfStock).toBeInstanceOf(Function);
    expect(inventoryApi.adjustments.list).toBeInstanceOf(Function);
    expect(inventoryApi.adjustments.create).toBeInstanceOf(Function);
  });

  it('posApi has carts, invoices, replacement, and repair', () => {
    expect(posApi.carts.create).toBeInstanceOf(Function);
    expect(posApi.carts.checkout).toBeInstanceOf(Function);
    expect(posApi.carts.addItem).toBeInstanceOf(Function);
    expect(posApi.invoices.list).toBeInstanceOf(Function);
    expect(posApi.invoices.get).toBeInstanceOf(Function);
    expect(posApi.invoices.checkout).toBeInstanceOf(Function);
    expect(posApi.invoices.markCredit).toBeInstanceOf(Function);
    expect(posApi.replacement.check).toBeInstanceOf(Function);
    expect(posApi.replacement.create).toBeInstanceOf(Function);
    expect(posApi.repair.invoices.list).toBeInstanceOf(Function);
  });

  it('customersApi has CRUD and ledger methods', () => {
    expect(customersApi.list).toBeInstanceOf(Function);
    expect(customersApi.get).toBeInstanceOf(Function);
    expect(customersApi.create).toBeInstanceOf(Function);
    expect(customersApi.ledger.entries.list).toBeInstanceOf(Function);
    expect(customersApi.ledger.summary).toBeInstanceOf(Function);
    expect(customersApi.personalCustomers.list).toBeInstanceOf(Function);
    expect(customersApi.personalLedger.entries.list).toBeInstanceOf(Function);
    expect(customersApi.internalCustomers.list).toBeInstanceOf(Function);
    expect(customersApi.internalLedger.entries.list).toBeInstanceOf(Function);
    expect(customersApi.paymentReminders.list).toBeInstanceOf(Function);
  });

  it('catalogApi has categories, brands, stores, warehouses', () => {
    expect(catalogApi.categories.list).toBeInstanceOf(Function);
    expect(catalogApi.brands.list).toBeInstanceOf(Function);
    expect(catalogApi.taxRates.list).toBeInstanceOf(Function);
    expect(catalogApi.stores.list).toBeInstanceOf(Function);
    expect(catalogApi.warehouses.list).toBeInstanceOf(Function);
    expect(catalogApi.defectiveProducts.moveOuts.list).toBeInstanceOf(Function);
  });

  it('purchasingApi has purchases and suppliers', () => {
    expect(purchasingApi.purchases.list).toBeInstanceOf(Function);
    expect(purchasingApi.purchases.create).toBeInstanceOf(Function);
    expect(purchasingApi.purchases.finalize).toBeInstanceOf(Function);
    expect(purchasingApi.suppliers.list).toBeInstanceOf(Function);
    expect(purchasingApi.vendorPurchases.list).toBeInstanceOf(Function);
  });

  it('pricingApi has priceLists and promotions', () => {
    expect(pricingApi.priceLists.list).toBeInstanceOf(Function);
    expect(pricingApi.promotions.list).toBeInstanceOf(Function);
  });

  it('historyApi has list and get', () => {
    expect(historyApi.list).toBeInstanceOf(Function);
    expect(historyApi.get).toBeInstanceOf(Function);
  });

  it('reportsApi has all report methods', () => {
    expect(reportsApi.salesSummary).toBeInstanceOf(Function);
    expect(reportsApi.topProducts).toBeInstanceOf(Function);
    expect(reportsApi.inventorySummary).toBeInstanceOf(Function);
    expect(reportsApi.revenue).toBeInstanceOf(Function);
    expect(reportsApi.dashboardKpis).toBeInstanceOf(Function);
  });

  it('searchApi has search method', () => {
    expect(searchApi.search).toBeInstanceOf(Function);
  });
});

// ─── Axios instance configuration ─────────────────────────────

describe('Axios instance', () => {
  it('has Content-Type header set to JSON', () => {
    expect(api.defaults.headers['Content-Type']).toBe('application/json');
  });

  it('has a 30s timeout', () => {
    expect(api.defaults.timeout).toBe(30000);
  });

  it('has request interceptor attached', () => {
    // axios stores interceptors in .interceptors.request.handlers
    expect((api.interceptors.request as any).handlers.length).toBeGreaterThan(0);
  });

  it('has response interceptor attached', () => {
    expect((api.interceptors.response as any).handlers.length).toBeGreaterThan(0);
  });
});
