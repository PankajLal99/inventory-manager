import { formatAmountINR } from '../../lib/utils';
import { formatCreditInvoiceDate } from './creditLedgerUtils';
import { CREDIT_SHOP_NAME } from './creditInvoiceHtml';

/** Indian-style amount in words for credit invoices. */
export function creditAmountInWords(num: number): string {
  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  if (!Number.isFinite(num) || num === 0) return 'Rupees Zero Only';

  const convertHundreds = (n: number): string => {
    if (n === 0) return '';
    let result = '';
    if (n >= 100) {
      result += ones[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 20) {
      result += tens[Math.floor(n / 10)] + ' ';
      n %= 10;
    }
    if (n > 0) result += ones[n] + ' ';
    return result.trim();
  };

  const convert = (n: number): string => {
    if (n === 0) return '';
    if (n >= 10000000) {
      const crores = Math.floor(n / 10000000);
      return convertHundreds(crores) + 'Crore ' + convert(n % 10000000);
    }
    if (n >= 100000) {
      const lakhs = Math.floor(n / 100000);
      return convertHundreds(lakhs) + 'Lakh ' + convert(n % 100000);
    }
    if (n >= 1000) {
      const thousands = Math.floor(n / 1000);
      return convertHundreds(thousands) + 'Thousand ' + convert(n % 1000);
    }
    return convertHundreds(n);
  };

  const integerPart = Math.floor(Math.abs(num));
  const decimalPart = Math.round((Math.abs(num) % 1) * 100);
  let result = convert(integerPart).trim();
  result = result ? `Rupees ${result}` : 'Rupees Zero';
  if (decimalPart > 0) {
    const paise = convert(decimalPart).trim();
    if (paise) result += ` and ${paise} Paise`;
  }
  return `${result} Only`;
}

export { formatCreditInvoiceDate } from './creditLedgerUtils';

export type CreditInvoiceLike = {
  invoice_number?: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  store_name?: string | null;
  shop_name?: string | null;
  status?: string;
  subtotal?: string | number;
  total?: string | number;
  customer_balance?: string | number | null;
  previous_balance?: string | number | null;
  created_at?: string;
  notes?: string;
  items?: Array<{
    id?: number;
    product_name?: string;
    quantity?: string | number;
    unit_price?: string | number;
    line_total?: string | number;
  }>;
};

type Props = {
  invoice: CreditInvoiceLike;
  className?: string;
};

function parseAmount(value: string | number | null | undefined): number {
  return parseFloat(String(value ?? 0)) || 0;
}

export default function CreditInvoiceDocument({ invoice, className = '' }: Props) {
  const items = invoice.items || [];
  const totalQty = items.reduce((sum, item) => sum + (parseFloat(String(item.quantity || 0)) || 0), 0);
  const totalItems = items.length;
  const totalAmt = parseAmount(invoice.total);
  const subtotalAmt = parseAmount(invoice.subtotal) || totalAmt;
  const shopName = invoice.shop_name?.trim() || CREDIT_SHOP_NAME;
  // Previous/old balance is intentionally hidden on credit invoice documents.
  const closingBal =
    invoice.customer_balance != null ? parseAmount(invoice.customer_balance) : null;
  const hasClosingBalance = closingBal != null;

  return (
    <div
      className={`bg-white text-stone-900 border-[3px] border-amber-600 shadow-lg print:shadow-none flex flex-col min-h-[297mm] text-xs leading-snug ${className}`}
      data-credit-invoice-doc
    >
      {/* Shop header — flat colour + abstract shapes */}
      <div className="relative overflow-hidden bg-amber-600 text-white px-7 py-5">
        <div className="pointer-events-none absolute -top-12 left-10 h-32 w-32 rounded-full bg-white/15" />
        <div className="pointer-events-none absolute -bottom-8 left-[28%] h-16 w-16 rounded-full bg-amber-400/50" />
        <div className="relative z-[1] flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold uppercase tracking-wide leading-tight text-white">
              {shopName}
            </h1>
            <p className="text-[11px] font-semibold uppercase tracking-wider mt-1 text-white">
              Credit Sale Invoice
            </p>
          </div>
          <div className="text-right shrink-0 text-white">
            <div className="text-[11px] font-bold uppercase tracking-wide">Invoice No.</div>
            <div className="text-[15px] font-extrabold mt-1">{invoice.invoice_number || '—'}</div>
          </div>
        </div>
      </div>

      {/* Party + meta */}
      <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr] border-b-2 border-amber-300 bg-amber-50 text-xs">
        <div className="p-4 sm:border-r border-amber-300">
          <div className="text-[11px] font-bold uppercase tracking-wide text-amber-900 mb-1.5">
            Bill To
          </div>
          <div className="text-[15px] font-extrabold uppercase tracking-wide leading-tight">
            {invoice.customer_name || '—'}
          </div>
          {invoice.customer_phone ? (
            <div className="text-xs text-stone-600 mt-1 font-semibold">{invoice.customer_phone}</div>
          ) : null}
          {invoice.status === 'void' ? (
            <div className="mt-2 inline-flex px-2 py-0.5 text-[11px] font-bold uppercase bg-red-100 text-red-700 border border-red-300 rounded">
              Void
            </div>
          ) : null}
        </div>
        <div className="p-4 space-y-1.5 text-xs">
          <div className="flex justify-between gap-4">
            <span className="font-semibold text-amber-900">Invoice No.</span>
            <span className="font-extrabold text-amber-950 text-right">{invoice.invoice_number || '—'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="font-semibold text-amber-900">Dated</span>
            <span className="font-bold text-right">{formatCreditInvoiceDate(invoice.created_at)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="font-semibold text-amber-900">Payment</span>
            <span className="font-bold text-amber-600 text-right">On Credit</span>
          </div>
        </div>
      </div>

      {/* Items table */}
      <div className="overflow-x-auto flex-shrink-0">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-amber-100">
              <th className="border border-amber-800/30 px-2 py-2 text-center font-bold text-amber-900 w-12 text-[11px]">
                S.N.
              </th>
              <th className="border border-amber-800/30 px-3 py-2 text-left font-bold text-amber-900 text-[11px]">
                Description of Goods
              </th>
              <th className="border border-amber-800/30 px-2 py-2 text-right font-bold text-amber-900 w-20 text-[11px]">
                Qty.
              </th>
              <th className="border border-amber-800/30 px-2 py-2 text-center font-bold text-amber-900 w-16 text-[11px]">
                Unit
              </th>
              <th className="border border-amber-800/30 px-2 py-2 text-right font-bold text-amber-900 w-24 text-[11px]">
                Rate (₹)
              </th>
              <th className="border border-amber-800/30 px-2 py-2 text-right font-bold text-amber-900 w-28 text-[11px]">
                Amount (₹)
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-stone-400 border border-amber-300 text-xs">
                  No line items
                </td>
              </tr>
            ) : (
              items.map((item, idx) => {
                const qty = parseFloat(String(item.quantity || 0)) || 0;
                const price = parseFloat(String(item.unit_price || 0)) || 0;
                const amount =
                  parseFloat(String(item.line_total ?? qty * price)) || 0;
                return (
                  <tr
                    key={item.id ?? idx}
                    className={`border-b border-amber-200 align-top ${idx % 2 === 1 ? 'bg-orange-50/60' : ''}`}
                  >
                    <td className="border border-amber-300 px-2 py-1.5 text-center font-semibold text-amber-900">
                      {idx + 1}
                    </td>
                    <td className="border border-amber-300 px-3 py-1.5 font-semibold">
                      {item.product_name || '—'}
                    </td>
                    <td className="border border-amber-300 px-2 py-1.5 text-right tabular-nums font-semibold">
                      {Number.isInteger(qty) ? qty : formatAmountINR(qty)}
                    </td>
                    <td className="border border-amber-300 px-2 py-1.5 text-center text-stone-500">Pcs.</td>
                    <td className="border border-amber-300 px-2 py-1.5 text-right tabular-nums">
                      {formatAmountINR(price)}
                    </td>
                    <td className="border border-amber-300 px-2 py-1.5 text-right tabular-nums font-bold text-amber-900">
                      {formatAmountINR(amount)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-amber-800 bg-amber-100 font-bold text-xs">
              <td className="border border-amber-800/30 px-2 py-1.5" />
              <td className="border border-amber-800/30 px-3 py-1.5 text-amber-900">Total Quantity</td>
              <td className="border border-amber-800/30 px-2 py-1.5 text-right tabular-nums text-amber-900" colSpan={2}>
                {Number.isInteger(totalQty) ? totalQty : formatAmountINR(totalQty)} Pcs.
              </td>
              <td className="border border-amber-800/30 px-2 py-1.5" />
              <td className="border border-amber-800/30 px-2 py-1.5" />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex-1 min-h-4" />

      {/* Summary + footer */}
      <div className="relative overflow-hidden border-t-[3px] border-amber-600 bg-amber-50 px-5 py-4 mt-auto">
        <div className="pointer-events-none absolute bottom-0 right-6 h-14 w-14 rounded-full bg-amber-400/35" />
        <div className="pointer-events-none absolute top-3 -left-2 h-9 w-9 rotate-[20deg] rounded-lg bg-amber-600/10" />

        <div className="relative border-2 border-amber-600 text-xs">
          <div className="bg-amber-600 text-white px-3.5 py-2 font-bold uppercase tracking-wide text-[11px]">
            Invoice Summary
          </div>
          <div className="divide-y divide-amber-200 bg-white">
            <div className="flex justify-between px-3.5 py-2">
              <span className="font-semibold text-stone-500">Total Items</span>
              <span className="font-bold">
                {totalItems} {totalItems === 1 ? 'Line' : 'Lines'} ·{' '}
                {Number.isInteger(totalQty) ? totalQty : formatAmountINR(totalQty)} Pcs.
              </span>
            </div>
            <div className="flex justify-between px-3.5 py-2">
              <span className="font-semibold text-stone-500">Sub Total</span>
              <span className="font-bold">₹ {formatAmountINR(subtotalAmt)}</span>
            </div>
            <div className="flex justify-between px-3.5 py-2 bg-amber-600 text-white">
              <span className="font-bold">Total</span>
              <span className="font-extrabold">₹ {formatAmountINR(totalAmt)}</span>
            </div>
            {hasClosingBalance ? (
              <div className="flex justify-between px-3.5 py-2 bg-amber-900 text-white">
                <span className="font-bold">Balance (Ledger)</span>
                <span className="font-extrabold">₹ {formatAmountINR(closingBal ?? 0)}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="relative mt-3 text-xs p-2.5 bg-white border border-amber-300 border-l-4 border-l-amber-600 leading-relaxed">
          <span className="font-bold text-amber-900">Amount in Words: </span>
          <span className="font-semibold">{creditAmountInWords(totalAmt)}</span>
        </div>

        {invoice.notes ? (
          <div className="relative text-xs text-stone-600 mt-2.5">
            <span className="font-bold text-amber-900">Notes: </span>
            {invoice.notes}
          </div>
        ) : null}

        <div className="relative grid grid-cols-2 gap-4 pt-4 text-xs">
          <div>
            <div className="font-bold text-amber-900 uppercase text-[11px] tracking-wide">
              Terms &amp; Conditions
            </div>
            <div className="text-xs text-stone-500 mt-1 leading-relaxed">
              Credit sale — payable as per account ledger. Goods once sold will not be taken back without prior approval.
            </div>
          </div>
          <div className="text-center">
            <div className="h-8" />
            <div className="font-bold border-t-2 border-amber-800 inline-block pt-1 px-4 text-amber-900 text-xs">
              Receiver&apos;s Signature
            </div>
          </div>
        </div>
        <p className="relative text-center text-[11px] text-stone-500 mt-3">
          Thank you for your business · {shopName}
        </p>
      </div>
    </div>
  );
}
