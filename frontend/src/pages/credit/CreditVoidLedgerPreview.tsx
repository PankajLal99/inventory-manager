import { formatNumber } from '../../lib/utils';

type VoidKind = 'sale' | 'return';

type CreditVoidLedgerPreviewProps = {
  kind: VoidKind;
  label: string;
  total: number;
  customerName?: string;
};

/** Preview ledger impact before voiding a credit invoice or return. */
export default function CreditVoidLedgerPreview({
  kind,
  label,
  total,
  customerName,
}: CreditVoidLedgerPreviewProps) {
  const isSale = kind === 'sale';
  const ledgerDelta = isSale ? -total : total;
  const balanceHint = isSale
    ? 'Customer balance will decrease — less outstanding receivable.'
    : 'Customer balance will increase — more outstanding receivable.';

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 leading-relaxed">
        {isSale
          ? 'This voids the invoice and posts a reversing credit entry. No stock is changed.'
          : 'This voids the return and posts a reversing debit entry. Linked invoice return quantities are restored.'}
      </p>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-4 space-y-3 text-sm">
        <div className="flex items-start justify-between gap-6">
          <span className="text-gray-600 shrink-0">{isSale ? 'Invoice' : 'Return'}</span>
          <span className="font-medium text-gray-900 text-right break-all">{label}</span>
        </div>
        {customerName ? (
          <div className="flex items-start justify-between gap-6">
            <span className="text-gray-600 shrink-0">Customer</span>
            <span className="font-medium text-gray-900 text-right break-words">{customerName}</span>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-6">
          <span className="text-gray-600 shrink-0">{isSale ? 'Invoice total' : 'Return total'}</span>
          <span className="font-medium tabular-nums shrink-0">₹{formatNumber(total)}</span>
        </div>
        <div className="flex items-start justify-between gap-6">
          <span className="text-gray-600 leading-snug pr-2">
            {isSale ? 'Reversing credit' : 'Reversing debit'}
            <span className="block text-xs text-gray-500 mt-0.5">
              {isSale ? 'Offsets original sale debit' : 'Offsets original return credit'}
            </span>
          </span>
          <span className="font-medium tabular-nums shrink-0">₹{formatNumber(total)}</span>
        </div>
        <div className="flex items-center justify-between gap-6 pt-3 border-t border-amber-200">
          <span className="text-amber-900 font-medium shrink-0">Ledger delta</span>
          <span
            className={`font-bold tabular-nums shrink-0 ${
              ledgerDelta > 0
                ? 'text-red-700'
                : ledgerDelta < 0
                  ? 'text-green-700'
                  : 'text-gray-700'
            }`}
          >
            {ledgerDelta > 0 ? '+' : ''}₹{formatNumber(ledgerDelta)}
          </span>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">{balanceHint}</p>
      </div>
    </div>
  );
}
