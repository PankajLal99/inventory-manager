import { formatAmountINR } from '../../lib/utils';
import type { CreditLedgerDeleteSummary } from './creditLedgerUtils';

type CreditLedgerDeletePreviewProps = {
  customerName: string;
  summary: CreditLedgerDeleteSummary | null;
  isLoading?: boolean;
  error?: string | null;
};

function countLine(count: number, singular: string, plural: string): string | null {
  if (!count) return null;
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function CreditLedgerDeletePreview({
  customerName,
  summary,
  isLoading,
  error,
}: CreditLedgerDeletePreviewProps) {
  if (isLoading) {
    return <p className="text-sm text-stone-500 py-2">Loading deletion summary…</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600 py-2">{error}</p>;
  }

  if (!summary) return null;

  const balance = parseFloat(String(summary.customer?.balance ?? 0)) || 0;
  const lines: string[] = [];

  const invoiceLine = countLine(summary.invoice_count, 'invoice', 'invoices');
  if (invoiceLine) {
    const parts: string[] = [];
    if (summary.open_invoice_count) {
      parts.push(`${summary.open_invoice_count} open`);
    }
    if (summary.void_invoice_count) {
      parts.push(`${summary.void_invoice_count} void`);
    }
    lines.push(`${invoiceLine}${parts.length ? ` (${parts.join(', ')})` : ''}`);
  }

  const returnLine = countLine(summary.return_count, 'return', 'returns');
  if (returnLine) {
    const parts: string[] = [];
    if (summary.completed_return_count) {
      parts.push(`${summary.completed_return_count} completed`);
    }
    if (summary.void_return_count) {
      parts.push(`${summary.void_return_count} void`);
    }
    lines.push(`${returnLine}${parts.length ? ` (${parts.join(', ')})` : ''}`);
  }

  const paymentLine = countLine(summary.payment_count, 'payment', 'payments');
  if (paymentLine) lines.push(paymentLine);

  const entryLine = countLine(summary.ledger_entry_count, 'ledger entry', 'ledger entries');
  if (entryLine) lines.push(entryLine);

  const cartLine = countLine(summary.cart_count, 'open cart', 'open carts');
  if (cartLine) lines.push(cartLine);

  const eventLine = countLine(
    summary.collection_event_count,
    'collection note',
    'collection notes'
  );
  if (eventLine) lines.push(eventLine);

  if (!lines.length) {
    lines.push('No invoices, returns, or ledger entries — only the customer record');
  }

  lines.push('The credit customer account');

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 leading-relaxed">
        This permanently deletes the entire credit ledger for{' '}
        <span className="font-semibold text-gray-900">{customerName}</span>. This cannot be undone.
      </p>

      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-4 space-y-3 text-sm">
        <p className="font-semibold text-red-900">The following will be deleted:</p>
        <ul className="space-y-1.5 text-stone-800">
          {lines.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5 shrink-0">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        {balance !== 0 ? (
          <div className="flex items-center justify-between gap-6 pt-3 border-t border-red-200">
            <span className="text-red-900 font-medium shrink-0">Current outstanding</span>
            <span className="font-bold tabular-nums text-red-800 shrink-0">
              ₹{formatAmountINR(Math.abs(balance))}
              <span className="ml-1 text-xs font-bold opacity-80">
                {balance < 0 ? 'Cr' : balance > 0 ? 'Dr' : ''}
              </span>
            </span>
          </div>
        ) : null}
      </div>

      <p className="text-xs text-stone-500 leading-relaxed">
        All ledger history, invoices, and returns for this customer will be removed from the credit
        system. Linked main-ledger payments are not deleted.
      </p>
    </div>
  );
}
