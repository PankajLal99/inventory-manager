import { format } from 'date-fns';
import { formatAmountINR } from '../../lib/utils';

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

export function formatCreditInvoiceDate(value?: string | null) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    return `${format(d, 'dd-MM-yyyy')} ( ${format(d, 'hh:mm a')} )`;
  } catch {
    return '—';
  }
}

export type CreditInvoiceLike = {
  invoice_number?: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  store_name?: string | null;
  status?: string;
  total?: string | number;
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
  /** Optional wrapper class for print/PDF targeting */
  className?: string;
};

export default function CreditInvoiceDocument({ invoice, className = '' }: Props) {
  const items = invoice.items || [];
  const totalQty = items.reduce((sum, item) => sum + (parseFloat(String(item.quantity || 0)) || 0), 0);
  const totalAmt = parseFloat(String(invoice.total ?? 0)) || 0;

  return (
    <div
      className={`bg-white text-gray-900 border border-gray-800 shadow-sm print:shadow-none ${className}`}
      data-credit-invoice-doc
    >
      {/* Header: Party + Invoice meta */}
      <div className="grid grid-cols-1 sm:grid-cols-2 border-b border-gray-800">
        <div className="p-4 sm:border-r border-gray-800">
          <div className="text-sm font-semibold mb-2">Party Details :</div>
          <div className="text-base font-bold uppercase tracking-wide">
            {invoice.customer_name || '—'}
          </div>
          {invoice.customer_phone ? (
            <div className="text-sm text-gray-600 mt-1">{invoice.customer_phone}</div>
          ) : null}
          {invoice.store_name ? (
            <div className="text-xs text-gray-500 mt-2">Store: {invoice.store_name}</div>
          ) : null}
          {invoice.status === 'void' ? (
            <div className="mt-2 inline-flex px-2 py-0.5 text-xs font-bold uppercase bg-red-100 text-red-700 border border-red-300">
              Void
            </div>
          ) : null}
        </div>
        <div className="p-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="font-semibold whitespace-nowrap">Invoice No. :</span>
            <span className="font-bold text-right">{invoice.invoice_number || '—'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="font-semibold whitespace-nowrap">Dated :</span>
            <span className="text-right">{formatCreditInvoiceDate(invoice.created_at)}</span>
          </div>
        </div>
      </div>

      {/* Items table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-100 border-b border-gray-800">
              <th className="border-r border-gray-300 px-2 py-2 text-left font-semibold w-12">S.N.</th>
              <th className="border-r border-gray-300 px-3 py-2 text-left font-semibold">Description of Goods</th>
              <th className="border-r border-gray-300 px-2 py-2 text-right font-semibold w-20">Qty.</th>
              <th className="border-r border-gray-300 px-2 py-2 text-center font-semibold w-16">Unit</th>
              <th className="border-r border-gray-300 px-2 py-2 text-right font-semibold w-24">Price</th>
              <th className="px-2 py-2 text-right font-semibold w-28">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-gray-400 border-b border-gray-300">
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
                  <tr key={item.id ?? idx} className="border-b border-gray-200 align-top">
                    <td className="border-r border-gray-200 px-2 py-2 text-center">{idx + 1}</td>
                    <td className="border-r border-gray-200 px-3 py-2 font-medium">
                      {item.product_name || '—'}
                    </td>
                    <td className="border-r border-gray-200 px-2 py-2 text-right tabular-nums">
                      {Number.isInteger(qty) ? qty : formatAmountINR(qty)}
                    </td>
                    <td className="border-r border-gray-200 px-2 py-2 text-center">Pcs.</td>
                    <td className="border-r border-gray-200 px-2 py-2 text-right tabular-nums">
                      {formatAmountINR(price)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium">
                      {formatAmountINR(amount)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-800 bg-gray-50 font-bold">
              <td className="border-r border-gray-300 px-2 py-2" />
              <td className="border-r border-gray-300 px-3 py-2">Grand Total</td>
              <td className="border-r border-gray-300 px-2 py-2 text-right tabular-nums" colSpan={2}>
                {Number.isInteger(totalQty) ? totalQty : formatAmountINR(totalQty)} Pcs.
              </td>
              <td className="border-r border-gray-300 px-2 py-2" />
              <td className="px-2 py-2 text-right tabular-nums">
                ₹ {formatAmountINR(totalAmt)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Amount in words + footer */}
      <div className="border-t border-gray-800 p-4 space-y-4">
        <div className="text-sm">
          <span className="font-semibold">Amount in Words: </span>
          <span>{creditAmountInWords(totalAmt)}</span>
        </div>
        {invoice.notes ? (
          <div className="text-sm text-gray-600">
            <span className="font-semibold">Notes: </span>
            {invoice.notes}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-4 pt-8 text-sm">
          <div>
            <div className="font-semibold">Terms &amp; Conditions</div>
            <div className="text-xs text-gray-500 mt-1">Credit sale — payable as per account ledger.</div>
          </div>
          <div className="text-center">
            <div className="h-12" />
            <div className="font-semibold border-t border-gray-400 inline-block pt-1 px-4">
              Receiver&apos;s Signature
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
