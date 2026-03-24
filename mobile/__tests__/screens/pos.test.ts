// POS screen tests
import '../helpers/mockApiClient';
import '../helpers/mockContexts';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POSScreen', () => {
  it('exports and renders with correct hooks', () => {
    const { useRouter } = require('expo-router');
    const { useQueryClient } = require('@tanstack/react-query');
    const { useAuth } = require('../../src/contexts/AuthContext');
    const { useToast } = require('../../src/contexts/ToastContext');
    const Screen = require('../../app/(tabs)/pos/index').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useAuth).toHaveBeenCalled();
    expect(useToast).toHaveBeenCalled();
    expect(useRouter).toHaveBeenCalled();
    expect(useQueryClient).toHaveBeenCalled();
  });
});

describe('ActiveCartsScreen', () => {
  it('exports and queries active carts', () => {
    const { useQuery, useMutation } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/pos/active-carts').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useQuery).toHaveBeenCalled();
    expect(useMutation).toHaveBeenCalled();
    const qcall = useQuery.mock.calls.find(
      (c: any[]) => c[0]?.queryKey?.[0] === 'active-carts',
    );
    expect(qcall).toBeDefined();
  });
});

describe('CheckoutScreen', () => {
  it('exports and reads params for checkout', () => {
    const { useLocalSearchParams } = require('expo-router');
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/pos/checkout').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useLocalSearchParams).toHaveBeenCalled();
    expect(useQuery).toHaveBeenCalled();
  });
});

describe('ScannerScreen', () => {
  it('exports and uses router', () => {
    const { useRouter } = require('expo-router');
    const Screen = require('../../app/(tabs)/pos/scanner').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useRouter).toHaveBeenCalled();
  });
});

describe('RepairBookingScreen', () => {
  it('exports a default component', () => {
    const Screen = require('../../app/(tabs)/pos/repair-booking').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
  });
});
