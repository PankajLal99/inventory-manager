// More hub screen tests
import '../helpers/mockApiClient';
import '../helpers/mockContexts';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('MoreScreen', () => {
  it('exports and uses router', () => {
    const { useRouter } = require('expo-router');
    const Screen = require('../../app/(tabs)/more/index').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useRouter).toHaveBeenCalled();
  });
});

describe('DashboardScreen', () => {
  it('exports and fetches sales/top-products', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/dashboard').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('dashboard-today');
    expect(keys).toContain('dashboard-week');
    expect(keys).toContain('top-products');
  });
});

describe('ReportsScreen', () => {
  it('exports and fetches report data', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/reports').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('report-summary');
    expect(keys).toContain('report-by-type');
    expect(keys).toContain('report-by-payment');
  });
});

describe('SearchScreen', () => {
  it('exports and uses router/query', () => {
    const { useRouter } = require('expo-router');
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/search').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useRouter).toHaveBeenCalled();
    expect(useQuery).toHaveBeenCalled();
  });
});

describe('SettingsScreen', () => {
  it('exports and uses auth/toast', () => {
    const { useAuth } = require('../../src/contexts/AuthContext');
    const { useToast } = require('../../src/contexts/ToastContext');
    const Screen = require('../../app/(tabs)/more/settings').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useAuth).toHaveBeenCalled();
    expect(useToast).toHaveBeenCalled();
  });
});

describe('ExpensesScreen', () => {
  it('exports and fetches expenses with add mutation', () => {
    const { useQuery, useMutation } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/expenses').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useMutation).toHaveBeenCalled();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('expenses');
  });
});

describe('PaymentsScreen', () => {
  it('exports and fetches payments', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/payments').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('payments');
  });
});

describe('PaymentRemindersScreen', () => {
  it('exports and fetches reminders', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/payment-reminders').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('payment-reminders');
  });
});

describe('DefectiveScreen', () => {
  it('exports and fetches defective move-outs', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/defective').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('defective-moveouts');
  });
});

describe('HistoryScreen', () => {
  it('exports and fetches audit logs', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/history').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('audit-logs');
  });
});

describe('StoresScreen', () => {
  it('exports and fetches stores/warehouses', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/stores').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('stores');
    expect(keys).toContain('warehouses');
  });
});

describe('CustomersScreen', () => {
  it('exports and fetches customers', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/customers/index').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('customers');
  });
});

describe('PersonalCustomersScreen', () => {
  it('exports and fetches personal customers', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/personal-customers').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('personal-customers');
  });
});

describe('VendorsScreen', () => {
  it('exports and fetches suppliers', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/vendors').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('suppliers');
  });
});

describe('RepairsScreen', () => {
  it('exports and fetches repairs', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/repairs').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('repairs');
  });
});

describe('CustomerLedgerScreen', () => {
  it('exports and fetches ledger data with mutation', () => {
    const { useLocalSearchParams } = require('expo-router');
    const { useQuery, useMutation } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/ledger/[id]').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useLocalSearchParams).toHaveBeenCalled();
    expect(useMutation).toHaveBeenCalled();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('ledger-summary');
    expect(keys).toContain('ledger-entries');
  });
});

describe('PersonalLedgerScreen', () => {
  it('exports and fetches personal ledger with mutation', () => {
    const { useLocalSearchParams } = require('expo-router');
    const { useQuery, useMutation } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/personal-ledger/[id]').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useLocalSearchParams).toHaveBeenCalled();
    expect(useMutation).toHaveBeenCalled();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('personal-ledger-summary');
    expect(keys).toContain('personal-ledger-entries');
  });
});

describe('InternalLedgerScreen', () => {
  it('exports and fetches internal ledger', () => {
    const { useLocalSearchParams } = require('expo-router');
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/internal-ledger/[id]').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useLocalSearchParams).toHaveBeenCalled();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('internal-ledger-summary');
    expect(keys).toContain('internal-ledger-entries');
  });
});

describe('ReplacementHubScreen', () => {
  it('exports and uses router', () => {
    const { useRouter } = require('expo-router');
    const Screen = require('../../app/(tabs)/more/replacements/index').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useRouter).toHaveBeenCalled();
  });
});

describe('ProcessReplacementScreen', () => {
  it('exports and sets up process mutation', () => {
    const { useMutation } = require('@tanstack/react-query');
    const { useToast } = require('../../src/contexts/ToastContext');
    const Screen = require('../../app/(tabs)/more/replacements/process').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    expect(useMutation).toHaveBeenCalled();
    expect(useToast).toHaveBeenCalled();
  });
});

describe('ReplacementRequestsScreen', () => {
  it('exports and fetches replacement requests', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/replacements/requests').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('replacement-requests');
  });
});

describe('ReplacementHistoryScreen', () => {
  it('exports and fetches replacement history', () => {
    const { useQuery } = require('@tanstack/react-query');
    const Screen = require('../../app/(tabs)/more/replacements/history').default;
    expect(Screen).toBeDefined();
    expect(typeof Screen).toBe('function');
    Screen();
    const keys = useQuery.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0]);
    expect(keys).toContain('replacement-history');
  });
});
