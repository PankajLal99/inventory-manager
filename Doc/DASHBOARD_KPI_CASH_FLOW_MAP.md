# Dashboard KPI Cash Flow Map

This note maps each dashboard money KPI to its exact source and conditions used in `GET /api/v1/reports/dashboard-kpis/`.

## Date Scope

- If no dates are passed, dashboard uses **today** for both `date_from` and `date_to`.
- Invoice filters use `Invoice.created_at` date.
- POS payment filters use `Payment.created_at` date (not invoice date).
- Expense filters use `Expenses.expense_date`.
- Manual ledger receipt filters use `LedgerEntry.created_at`.

## One-Line Formula Map

- `total_cash = sum(Payment.amount where payment_method='cash') + sum(LedgerEntry.amount where entry_type='credit' and payment_mode='cash' and invoice is null)`
- `total_online = sum(Payment.amount where payment_method='upi') + sum(LedgerEntry.amount where entry_type='credit' and payment_mode='upi' and invoice is null)`
- `total_expenses = sum(Expenses.expense_amount in selected date range)`
- `total_inhand = total_cash - total_expenses`

## POS Payment Contribution Rules

- Included only if payment date is inside selected range.
- Excluded if linked invoice has `status='void'`.
- Excluded if linked invoice customer name is exactly `Manish Traders Loss` (case-insensitive exact match).
- Store filter is applied via `invoice__store_id` when `store` is selected in dashboard filters.

## Manual Ledger Contribution Rules

- Included only `LedgerEntry` rows with `entry_type='credit'`.
- Included only when `invoice` is null (manual receipts from Payments page).
- Added to `total_cash` only when `payment_mode='cash'`.
- Added to `total_online` only when `payment_mode='upi'`.
- Current code does **not** apply store filter to these manual ledger credits.

## Expense Contribution Rules

- Uses all `Expenses` rows in selected date range.
- Current code does **not** apply store filter to expenses.
- Expense payment type (`CASH`/`ONLINE`) does not split KPI; all expenses go into `total_expenses`.

## Invoice/Payment Sum Clarification

- Cash/online KPIs are based on **Payment rows + manual ledger credits**, not invoice totals.
- Invoice totals (`Invoice.total`) are used for other KPIs (profit/loss/pending), not directly for `total_cash`/`total_online`.
- A single mixed invoice contributes through two `Payment` rows (`cash` + `upi`) if created that way.

## Repair Cash/UPI Clarity (New)

- `repair_invoice_cash_total`: Sum of `Invoice.total` for repair-store invoices where `invoice_type='cash'` (within selected date range).
- `repair_invoice_upi_total`: Sum of `Invoice.total` for repair-store invoices where `invoice_type='upi'` (within selected date range).
- `repair_payment_cash_total`: Sum of `Payment.amount` where payment method is `cash` and linked invoice is from repair store (payment date based).
- `repair_payment_upi_total`: Sum of `Payment.amount` where payment method is `upi` and linked invoice is from repair store (payment date based).
- Counts are exposed too (`repair_invoice_cash_count`, `repair_invoice_upi_count`, `repair_payment_cash_count`, `repair_payment_upi_count`).
- These repair KPIs use the same exclusion rules as dashboard payments/invoices: exclude `void` and exact `Manish Traders Loss`.

## Why Cash Can Look "Wrong" (Common Reasons)

- Payment date and invoice date are different; dashboard uses payment date for cash/online.
- Manual cash receipt was saved with `payment_mode='other'` or with non-null `invoice`, so it does not enter `total_cash`.
- `void` or `Manish Traders Loss` invoices are intentionally excluded from cash/online.
- Expenses reduce in-hand but do not reduce `total_cash`; only `total_inhand` is net of expenses.
- Store-wise dashboard may still include global manual ledger credits/expenses because those queries are not store-scoped.
