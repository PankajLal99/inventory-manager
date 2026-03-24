// ─── User & Auth ───────────────────────────────────────────────
export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role?: { id: number; name: string };
  groups?: string[];
  store?: { id: number; name: string; shop_type: string };
  can_access_dashboard?: boolean;
  can_access_reports?: boolean;
  can_access_customers?: boolean;
  can_access_ledger?: boolean;
  can_access_history?: boolean;
  is_admin?: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
}

// ─── Products ──────────────────────────────────────────────────
export interface Product {
  id: number;
  name: string;
  sku: string;
  category_id?: number;
  category_name?: string;
  brand_id?: number;
  brand_name?: string;
  tax_rate?: number;
  selling_price?: number | string;
  purchase_price?: number | string;
  stock_quantity?: number;
  available_quantity?: number;
  shop_stock?: number;
  warehouse_stock?: number;
  low_stock_threshold?: number;
  track_inventory?: boolean;
  track_batches?: boolean;
  can_go_below_purchase_price?: boolean;
  is_active?: boolean;
  supplier_breakdown?: SupplierStock[];
  description?: string;
}

export interface SupplierStock {
  supplier: string;
  purchase_date: string;
  warehouse_stock: number;
  shop_barcode_count: number;
  price: string;
}

export interface Barcode {
  id: number;
  barcode: string;
  short_code?: string;
  tag: 'new' | 'sold' | 'returned' | 'defective' | 'unknown' | 'in-cart';
  tag_display?: string;
  product: number;
  invoice_id?: number;
  invoice_number?: string;
  invoice_date?: string;
  customer_name?: string;
  invoice_type_display?: string;
  sold_price?: number;
  selling_price?: number;
  purchase_price?: number;
}

// ─── Cart & POS ────────────────────────────────────────────────
export interface CartTab {
  id: number;
  cartNumber: string;
  storeId: number;
  customerId?: number | null;
  customerName?: string | null;
  invoiceType: 'cash' | 'upi' | 'pending' | 'mixed' | 'credit';
  itemCount?: number;
  createdAt: string;
  updatedAt: string;
  locked?: boolean;
}

export interface UserCarts {
  username: string;
  tabs: CartTab[];
  activeTabId: number | null;
}

export interface CartItem {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  manual_unit_price?: number | string | null;
  product_selling_price?: number | string | null;
  product_purchase_price?: number | string | null;
  product_can_go_below_purchase_price?: boolean;
  purchase_price?: number;
  barcodes?: string[];
  barcode_count?: number;
}

export interface CartItemLike {
  id: number;
  manual_unit_price?: number | string | null;
  product_selling_price?: number | string | null;
  product_purchase_price?: number | string | null;
  product_can_go_below_purchase_price?: boolean;
}

// ─── Invoices ──────────────────────────────────────────────────
export interface Invoice {
  id: number;
  invoice_number: string;
  store?: { id: number; name: string };
  customer?: { id: number; name: string };
  status: 'draft' | 'paid' | 'partial' | 'credit' | 'void';
  invoice_type: 'cash' | 'upi' | 'pending' | 'mixed' | 'credit' | 'defective';
  totals?: {
    subtotal: number;
    discount: number;
    tax: number;
    total: number;
    transport?: number;
  };
  total?: number;
  payments?: Payment[];
  created_at: string;
  created_by?: string;
  is_edited?: boolean;
  edited_on?: string;
  repair?: RepairInfo;
  items?: InvoiceItem[];
  old_balance?: number;
  outstanding?: number;
}

export interface InvoiceItem {
  id: number;
  product_id: number;
  product_name: string;
  brand_name?: string;
  quantity: number;
  unit_price: number;
  manual_unit_price?: number;
  total: number;
  barcodes?: string[];
  product_selling_price?: number;
  product_purchase_price?: number;
  product_can_go_below_purchase_price?: boolean;
}

export interface Payment {
  id: number;
  amount: number;
  payment_type: 'cash' | 'upi' | 'mixed';
  cash_amount?: number;
  upi_amount?: number;
  created_at: string;
  note?: string;
}

// ─── Repairs ───────────────────────────────────────────────────
export interface RepairInfo {
  status: string;
  status_display?: string;
  contact_no?: string;
  model_name?: string;
  description?: string;
  booking_amount?: number | string;
  delivery_date?: string;
  repair_barcode?: string;
}

export interface RepairStatusChoice {
  value: string;
  label: string;
}

// ─── Customers ─────────────────────────────────────────────────
export interface Customer {
  id: number;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  group?: { id: number; name: string };
  credit_limit?: number;
  credit_balance?: number;
  is_active?: boolean;
}

export interface CustomerGroup {
  id: number;
  name: string;
}

// ─── Ledger ────────────────────────────────────────────────────
export interface LedgerEntry {
  id: number;
  customer: number;
  customer_name?: string;
  entry_type: 'credit' | 'debit';
  amount: number | string;
  description?: string;
  invoice?: number | null;
  invoice_number?: string;
  created_at: string;
  running_balance?: number;
}

export interface LedgerSummary {
  customer_id: number;
  customer_name: string;
  total_credit: number;
  total_debit: number;
  balance: number;
}

// ─── Purchasing ────────────────────────────────────────────────
export interface Purchase {
  id: number;
  supplier?: { id: number; name: string };
  supplier_name?: string;
  bill_number?: string;
  date: string;
  total?: number;
  status?: string;
  is_finalized?: boolean;
  items?: PurchaseItem[];
}

export interface PurchaseItem {
  id: number;
  product_id: number;
  product_name?: string;
  quantity: number;
  purchase_price: number;
  total?: number;
  printed?: boolean;
}

export interface Supplier {
  id: number;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  purchase_count?: number;
}

// ─── Catalog ───────────────────────────────────────────────────
export interface Category {
  id: number;
  name: string;
}

export interface Brand {
  id: number;
  name: string;
}

export interface TaxRate {
  id: number;
  name: string;
  rate: number;
}

export interface Store {
  id: number;
  name: string;
  shop_type?: string;
  is_active?: boolean;
  address?: string;
}

export interface Warehouse {
  id: number;
  name: string;
}

// ─── Expenses ──────────────────────────────────────────────────
export interface Expense {
  id: number;
  expense_type: string;
  amount: number | string;
  description?: string;
  payment_method?: string;
  borrower?: string;
  date: string;
  created_at: string;
}

// ─── Credit Notes ──────────────────────────────────────────────
export interface CreditNote {
  id: number;
  credit_note_number: string;
  invoice?: number;
  invoice_number?: string;
  customer_name?: string;
  total_amount: number;
  items?: CreditNoteItem[];
  notes?: string;
  created_at: string;
}

export interface CreditNoteItem {
  id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  refund_amount: number;
}

// ─── Defective ─────────────────────────────────────────────────
export interface DefectiveMoveOut {
  id: number;
  product_name?: string;
  store_name?: string;
  reason: string;
  quantity: number;
  total_loss: number;
  total_adjustment: number;
  invoice_number?: string;
  created_at: string;
}

// ─── Pricing ───────────────────────────────────────────────────
export interface PriceList {
  id: number;
  name: string;
  description?: string;
  is_active?: boolean;
  customer_group?: number;
}

export interface Promotion {
  id: number;
  name: string;
  discount_type?: string;
  discount_value?: number;
  start_date?: string;
  end_date?: string;
  is_active?: boolean;
}

// ─── Reports ───────────────────────────────────────────────────
export interface SalesSummary {
  total_revenue: number;
  total_invoices: number;
  total_paid: number;
  total_pending: number;
}

// ─── History / Audit ───────────────────────────────────────────
export interface AuditLog {
  id: number;
  action: string;
  model: string;
  object_id?: number;
  object_repr?: string;
  changes?: any;
  user?: string;
  timestamp: string;
}

// ─── Payment Reminders ─────────────────────────────────────────
export interface PaymentReminder {
  id: number;
  customer: number;
  customer_name?: string;
  amount: number;
  due_date: string;
  is_settled?: boolean;
  settled_payment?: number;
  notes?: string;
}

// ─── Search ────────────────────────────────────────────────────
export interface SearchResults {
  products?: Product[];
  barcodes?: Barcode[];
  customers?: Customer[];
  invoices?: Invoice[];
  suppliers?: Supplier[];
  categories?: Category[];
  brands?: Brand[];
  stores?: Store[];
  purchases?: Purchase[];
}

// ─── Generic API responses ─────────────────────────────────────
export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ProductStockInfo {
  available: number;
  total: number;
  isLowStock: boolean;
  isOutOfStock: boolean;
  lowStockThreshold: number;
  displayAvailable: string;
  displayTotal: string;
}

export type DateRangePreset = 'one_day' | 'last_7_days' | 'last_30_days' | 'custom';

export interface DateRangeValue {
  startDate: string;
  endDate: string;
}
