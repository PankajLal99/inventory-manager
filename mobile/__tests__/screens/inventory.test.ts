// Inventory screen tests
import '../helpers/mockApiClient';
import '../helpers/mockContexts';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ProductListScreen', () => {
  it('exports and fetches products/categories/brands', () => {
    const { useRouter } = require('expo-router');
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/inventory/index').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useRouter).toHaveBeenCalled();
    expect(useQuery).toHaveBeenCalled();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('products');
    expect(keys).toContain('categories');
    expect(keys).toContain('brands');
  });
});

describe('ProductDetailScreen', () => {
  it('exports and fetches product data', () => {
    const { useLocalSearchParams } = require('expo-router');
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/inventory/[id]').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useLocalSearchParams).toHaveBeenCalled();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('product');
    expect(keys).toContain('product-barcodes-full');
    expect(keys).toContain('product-invoices');
  });
});

describe('ProductFormScreen', () => {
  it('exports and sets up form with mutations', () => {
    const { useQuery, useMutation } = require('@tanstack/react-query');
    const { useToast } = require('../../src/contexts/ToastContext');
    const Screen = require('../../app/(tabs)/inventory/form').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useToast).toHaveBeenCalled();
    expect(useMutation).toHaveBeenCalled();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('product');
    expect(keys).toContain('categories');
    expect(keys).toContain('brands');
  });
});

describe('PricingScreen', () => {
  it('exports and fetches price lists and promotions', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/inventory/pricing').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('price-lists');
    expect(keys).toContain('promotions');
  });
});

describe('StockOverviewScreen', () => {
  it('exports and fetches stock data', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/inventory/stock').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    const qcall = useQuery.mock.calls.find(
      (c: any[]) => c[0]?.queryKey?.[0] === 'stock',
    );
    expect(qcall).toBeDefined();
  });
});

describe('PurchasesListScreen', () => {
  it('exports and fetches purchases', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/inventory/purchases/index').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    const qcall = useQuery.mock.calls.find(
      (c: any[]) => c[0]?.queryKey?.[0] === 'purchases',
    );
    expect(qcall).toBeDefined();
  });
});

describe('PurchaseDetailScreen', () => {
  it('exports and reads id to fetch purchase', () => {
    const { useLocalSearchParams } = require('expo-router');
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/inventory/purchases/[id]').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useLocalSearchParams).toHaveBeenCalled();
    const qcall = useQuery.mock.calls.find(
      (c: any[]) => c[0]?.queryKey?.[0] === 'purchase',
    );
    expect(qcall).toBeDefined();
  });
});
