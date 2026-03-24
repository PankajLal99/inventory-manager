// Layout tests — root layout, auth layout, tabs layout
import '../helpers/mockApiClient';
import '../helpers/mockContexts';

describe('Root Layout', () => {
  it('exports a default component', () => {
    const RootLayout = require('../../app/_layout').default;
    expect(RootLayout).toBeDefined();
    expect(typeof RootLayout).toBe('function');
  });
});

describe('Auth Layout', () => {
  it('exports a default component', () => {
    const AuthLayout = require('../../app/(auth)/_layout').default;
    expect(AuthLayout).toBeDefined();
    expect(typeof AuthLayout).toBe('function');
  });
});

describe('Tabs Layout', () => {
  it('exports a default component', () => {
    const TabLayout = require('../../app/(tabs)/_layout').default;
    expect(TabLayout).toBeDefined();
    expect(typeof TabLayout).toBe('function');
  });
});

describe('POS Layout', () => {
  it('exports a default component', () => {
    const POSLayout = require('../../app/(tabs)/pos/_layout').default;
    expect(POSLayout).toBeDefined();
    expect(typeof POSLayout).toBe('function');
  });
});

describe('Invoices Layout', () => {
  it('exports a default component', () => {
    const InvoicesLayout = require('../../app/(tabs)/invoices/_layout').default;
    expect(InvoicesLayout).toBeDefined();
    expect(typeof InvoicesLayout).toBe('function');
  });
});

describe('Inventory Layout', () => {
  it('exports a default component', () => {
    const InventoryLayout = require('../../app/(tabs)/inventory/_layout').default;
    expect(InventoryLayout).toBeDefined();
    expect(typeof InventoryLayout).toBe('function');
  });
});

describe('More Layout', () => {
  it('exports a default component', () => {
    const MoreLayout = require('../../app/(tabs)/more/_layout').default;
    expect(MoreLayout).toBeDefined();
    expect(typeof MoreLayout).toBe('function');
  });
});
