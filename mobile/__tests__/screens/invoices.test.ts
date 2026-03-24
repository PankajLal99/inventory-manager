// Invoice screen tests
import '../helpers/mockApiClient';
import '../helpers/mockContexts';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('InvoiceListScreen', () => {
  it('exports and fetches invoices with auth/router', () => {
    const { useRouter } = require('expo-router');
    const { useQuery } = require('@tanstack/react-query');
    const { useAuth } = require('../../src/contexts/AuthContext');
    const Screen = require('../../app/(tabs)/invoices/index').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useQuery).toHaveBeenCalled();
    expect(useAuth).toHaveBeenCalled();
    expect(useRouter).toHaveBeenCalled();
    const qcall = useQuery.mock.calls.find(
      (c: any[]) => c[0]?.queryKey?.[0] === 'invoices',
    );
    expect(qcall).toBeDefined();
  });
});

describe('InvoiceDetailScreen', () => {
  it('exports and sets up mutations with toast', () => {
    const { useLocalSearchParams } = require('expo-router');
    const { useMutation } = require('@tanstack/react-query');
    const { useToast } = require('../../src/contexts/ToastContext');
    const Screen = require('../../app/(tabs)/invoices/[id]').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useLocalSearchParams).toHaveBeenCalled();
    expect(useMutation).toHaveBeenCalled();
    expect(useToast).toHaveBeenCalled();
  });
});

describe('InvoiceEditScreen', () => {
  it('exports and sets up edit mutations', () => {
    const { useLocalSearchParams } = require('expo-router');
    const { useMutation } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/invoices/edit').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useLocalSearchParams).toHaveBeenCalled();
    expect(useMutation.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe('CreditNotesScreen', () => {
  it('exports and fetches credit notes', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/invoices/credit-notes/index').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useQuery).toHaveBeenCalled();
    const qcall = useQuery.mock.calls.find(
      (c: any[]) => c[0]?.queryKey?.[0] === 'credit-notes',
    );
    expect(qcall).toBeDefined();
  });
});

describe('CreditNoteDetailScreen', () => {
  it('exports and reads id with mutation/toast', () => {
    const { useLocalSearchParams } = require('expo-router');
    const { useMutation } = require('@tanstack/react-query');
    const { useToast } = require('../../src/contexts/ToastContext');
    const Screen = require('../../app/(tabs)/invoices/credit-notes/[id]').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useLocalSearchParams).toHaveBeenCalled();
    expect(useMutation).toHaveBeenCalled();
    expect(useToast).toHaveBeenCalled();
  });
});
