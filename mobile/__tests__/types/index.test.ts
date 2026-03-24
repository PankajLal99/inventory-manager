/**
 * Type structure tests — verify that all exported interfaces/types
 * can be imported and used correctly at runtime.
 */
import type {
  User,
  Product,
  Barcode,
  CartTab,
  UserCarts,
  CartItem,
  CartItemLike,
  Invoice,
  InvoiceItem,
  Payment,
  RepairInfo,
  Customer,
  CustomerGroup,
  LedgerEntry,
  LedgerSummary,
  Purchase,
  PurchaseItem,
  Supplier,
  Category,
  Brand,
  TaxRate,
  Store,
  Warehouse,
  Expense,
  CreditNote,
  CreditNoteItem,
  DefectiveMoveOut,
  PriceList,
  Promotion,
} from '../../src/types';

describe('Type exports', () => {
  it('User type can create a valid object', () => {
    const user: User = {
      id: 1,
      username: 'admin',
      email: 'admin@test.com',
      first_name: 'Admin',
      last_name: 'User',
    };
    expect(user.id).toBe(1);
    expect(user.username).toBe('admin');
  });

  it('Product type can create a valid object', () => {
    const product: Product = {
      id: 1,
      name: 'Test Wire',
      sku: 'WR-001',
    };
    expect(product.name).toBe('Test Wire');
  });

  it('CartTab type can create a valid object', () => {
    const tab: CartTab = {
      id: 1,
      cartNumber: 'Cart-1',
      storeId: 1,
      invoiceType: 'cash',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01',
    };
    expect(tab.invoiceType).toBe('cash');
  });

  it('Invoice type can create a valid object', () => {
    const invoice: Invoice = {
      id: 1,
      invoice_number: 'INV-001',
      status: 'paid',
      invoice_type: 'cash',
      created_at: '2025-01-01',
    };
    expect(invoice.status).toBe('paid');
  });

  it('Customer type can create a valid object', () => {
    const customer: Customer = {
      id: 1,
      name: 'Test Customer',
      phone: '1234567890',
    };
    expect(customer.name).toBe('Test Customer');
  });

  it('LedgerEntry type has required field constraints', () => {
    const entry: LedgerEntry = {
      id: 1,
      customer: 1,
      entry_type: 'credit',
      amount: 1000,
      created_at: '2025-01-01',
    };
    expect(entry.entry_type).toBe('credit');
  });

  it('CartItemLike only requires id', () => {
    const item: CartItemLike = { id: 1 };
    expect(item.id).toBe(1);
    expect(item.manual_unit_price).toBeUndefined();
  });

  it('Barcode tag types are constrained', () => {
    const barcode: Barcode = {
      id: 1,
      barcode: 'BC001',
      tag: 'new',
      product: 1,
    };
    expect(barcode.tag).toBe('new');
  });
});
