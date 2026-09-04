import { useState, useCallback } from 'react';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import BarcodeScanner from '../../components/BarcodeScanner';
import { posApi } from '../../lib/api';
import { formatNumber } from '../../lib/utils';
import ProductName from '../../components/ProductName';
import { Camera, Trash2, Search, Package } from 'lucide-react';

export type PosTradeInReturnTag = 'returned' | 'defective' | 'unknown';

export interface PosTradeInLine {
  id: string;
  invoice_item_id: number;
  source_invoice_id: number;
  source_invoice_number: string;
  product_name: string;
  barcode: string | null;
  /** Sticker used when adding this line (sent to checkout as scanned_barcode for barcode resolution). */
  scanned_barcode?: string;
  /** Original sale line total (reference; not editable) */
  original_line_credit: number;
  /** Credit to apply against this new sale (≤ original_line_credit) */
  accepted_credit: number;
  return_tag: PosTradeInReturnTag | null;
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  lines: PosTradeInLine[];
  onLinesChange: (lines: PosTradeInLine[]) => void;
  onError: (message: string) => void;
}

export function posTradeInPayload(lines: PosTradeInLine[]) {
  return lines
    .filter((l) => l.return_tag)
    .map((l) => ({
      invoice_item_id: l.invoice_item_id,
      return_tag: l.return_tag as PosTradeInReturnTag,
      accepted_credit: Number(l.accepted_credit.toFixed(2)),
      ...(l.scanned_barcode ? { scanned_barcode: l.scanned_barcode } : {}),
    }));
}

export function posTradeInCreditTotal(lines: PosTradeInLine[]): number {
  return lines.filter((l) => l.return_tag).reduce((s, l) => s + (l.accepted_credit || 0), 0);
}

/** Resolve selling-price credit from find-invoice item payload (not purchase cost). */
export function soldLineCreditFromInvoiceItem(item: Record<string, unknown>): number {
  const soldCredit = parseFloat(String(item.sold_line_credit ?? ''));
  if (Number.isFinite(soldCredit) && soldCredit > 0) {
    return soldCredit;
  }
  const qty = parseFloat(String(item.quantity ?? '1')) || 1;
  const manual = parseFloat(String(item.manual_unit_price ?? '0'));
  const unit = parseFloat(String(item.unit_price ?? '0'));
  const catalogSell = parseFloat(String(item.product_selling_price ?? '0'));
  let unitPrice = 0;
  if (Number.isFinite(manual) && manual > 0) unitPrice = manual;
  else if (Number.isFinite(unit) && unit > 0) unitPrice = unit;
  else if (Number.isFinite(catalogSell) && catalogSell > 0) unitPrice = catalogSell;
  if (unitPrice > 0) {
    const disc = parseFloat(String(item.discount_amount ?? '0')) || 0;
    const tax = parseFloat(String(item.tax_amount ?? '0')) || 0;
    return unitPrice * qty - disc + tax;
  }
  const lineTotal = parseFloat(String(item.line_total ?? '0'));
  return Number.isFinite(lineTotal) && lineTotal > 0 ? lineTotal : 0;
}

/** Empty list can close; otherwise every line needs condition + credit in (0, original_line_credit]. */
export function isTradeInModalComplete(lines: PosTradeInLine[]): boolean {
  if (lines.length === 0) return true;
  return lines.every(
    (l) =>
      l.return_tag != null &&
      Number.isFinite(l.accepted_credit) &&
      l.accepted_credit > 0 &&
      l.accepted_credit <= l.original_line_credit
  );
}

export default function PosTradeInCartModal({
  open,
  onClose,
  lines,
  onLinesChange,
  onError,
}: Props) {
  const [scan, setScan] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [loading, setLoading] = useState(false);

  const addFromBarcode = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      setLoading(true);
      try {
        const { data } = await posApi.replacement.findInvoiceByBarcode({ barcode: trimmed });
        const inv = data?.invoice;
        if (!inv?.items?.length) {
          onError('No matching sold item found for this barcode.');
          return;
        }
        const item = inv.items[0];
        const invoiceItemId = item.id;
        if (lines.some((l) => l.invoice_item_id === invoiceItemId)) {
          onError('This item is already in the trade-in list.');
          return;
        }
        const original = soldLineCreditFromInvoiceItem(item);
        const line: PosTradeInLine = {
          id: randomId(),
          invoice_item_id: invoiceItemId,
          source_invoice_id: inv.id,
          source_invoice_number: inv.invoice_number || '',
          product_name: item.product_name || item.product?.name || 'Item',
          barcode: item.barcode_value || item.barcode_full || trimmed,
          scanned_barcode: trimmed.toUpperCase(),
          original_line_credit: original,
          accepted_credit: original,
          return_tag: null,
        };
        onLinesChange([...lines, line]);
        setScan('');
      } catch (e: any) {
        const msg =
          e?.response?.data?.message ||
          e?.response?.data?.error ||
          e?.message ||
          'Could not look up barcode';
        onError(typeof msg === 'string' ? msg : 'Could not look up barcode');
      } finally {
        setLoading(false);
      }
    },
    [lines, onError, onLinesChange]
  );

  const setTag = (id: string, tag: PosTradeInReturnTag) => {
    onLinesChange(lines.map((l) => (l.id === id ? { ...l, return_tag: tag } : l)));
  };

  const setAcceptedCredit = (id: string, value: string) => {
    onLinesChange(
      lines.map((l) => {
        if (l.id !== id) return l;
        const cap = l.original_line_credit;
        if (value === '' || value === '.') {
          return { ...l, accepted_credit: 0 };
        }
        const n = parseFloat(value);
        if (Number.isNaN(n)) return l;
        const clamped = Math.min(Math.max(0, n), cap);
        return { ...l, accepted_credit: clamped };
      })
    );
  };

  const removeLine = (id: string) => {
    onLinesChange(lines.filter((l) => l.id !== id));
  };

  const creditApplied = posTradeInCreditTotal(lines);
  const canClose = isTradeInModalComplete(lines);

  const requestClose = () => {
    if (!canClose) {
      onError(
        'Before closing: pick Returned, Unknown, or Defective for each line, and enter Credit this sale (greater than zero, max original line). Or remove lines you do not need.'
      );
      return;
    }
    onClose();
  };

  return (
    <>
      <Modal
        isOpen={open}
        onClose={requestClose}
        title="Trade-in / exchange"
        size="xl"
        closeOnBackdropClick={canClose}
      >
        <div className="space-y-5 max-h-[70vh] overflow-y-auto -mx-1 min-w-0">
          <p className="text-sm text-gray-600 leading-relaxed">
            Scan a <span className="font-medium text-gray-800">sold</span> barcode to add a return line. Pick{' '}
            <span className="font-medium">Returned</span>, <span className="font-medium">Unknown</span>, or{' '}
            <span className="font-medium">Defective</span>. Set <span className="font-medium">Credit this sale</span> (cannot
            exceed the original line total).
          </p>
          <div className="w-full rounded-xl border border-gray-200 bg-gradient-to-b from-slate-50/90 to-white px-3 py-3 sm:px-4 sm:py-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-2">Find sold item</p>
            <div className="relative w-full min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <Input
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                placeholder="Type barcode, short code, or scan…"
                className="w-full min-w-0 pl-10 pr-3 py-2.5 text-base border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500/30"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void addFromBarcode(scan);
                  }
                }}
                disabled={loading}
                autoComplete="off"
                autoFocus
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 w-full">
              <Button
                type="button"
                variant="outline"
                className="flex-1 min-w-[7rem] sm:flex-initial"
                onClick={() => setShowScanner(true)}
                disabled={loading}
              >
                <Camera className="h-4 w-4 mr-2 shrink-0" />
                Camera
              </Button>
              <Button
                type="button"
                className="flex-1 min-w-[7rem] sm:flex-initial sm:min-w-[5.5rem]"
                onClick={() => void addFromBarcode(scan)}
                disabled={loading}
              >
                {loading ? '…' : 'Add line'}
              </Button>
            </div>
          </div>

          {lines.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center rounded-lg border border-dashed border-gray-200 bg-gray-50/50">
              <Package className="h-10 w-10 text-gray-300" />
              <p className="text-sm font-medium text-gray-600">No exchange lines yet</p>
              <p className="text-xs text-gray-500 max-w-sm">Search above to attach previously sold items.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {lines.map((line) => (
                <li key={line.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <div className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <ProductName as="p"
                        className="font-medium text-gray-900 truncate"
                        
                       name={line.product_name} />
                      <p className="text-xs text-gray-500 font-mono">{line.barcode || '—'}</p>
                      <p className="text-xs text-gray-500">From {line.source_invoice_number}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      className="p-1 text-red-600 hover:bg-red-50 rounded flex-shrink-0"
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-xs text-gray-500 block">Original sale (line)</span>
                      <span className="font-medium text-gray-700">₹{formatNumber(line.original_line_credit)}</span>
                      <span className="text-[10px] text-gray-400 block">Reference only</span>
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 block mb-0.5" htmlFor={`ti-credit-${line.id}`}>
                        Credit this sale
                      </label>
                      <Input
                        id={`ti-credit-${line.id}`}
                        type="number"
                        min={0}
                        max={line.original_line_credit}
                        step="0.01"
                        value={String(line.accepted_credit)}
                        onChange={(e) => setAcceptedCredit(line.id, e.target.value)}
                        className="h-9 text-sm"
                      />
                      <span className="text-[10px] text-gray-500 block mt-0.5">Max ₹{formatNumber(line.original_line_credit)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500 w-full sm:w-auto">Condition:</span>
                    <button
                      type="button"
                      onClick={() => setTag(line.id, 'returned')}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-colors ${
                        line.return_tag === 'returned'
                          ? 'bg-green-600 border-green-600 text-white'
                          : 'bg-white border-green-300 text-green-800 hover:bg-green-50'
                      }`}
                    >
                      Returned
                    </button>
                    <button
                      type="button"
                      onClick={() => setTag(line.id, 'unknown')}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-colors ${
                        line.return_tag === 'unknown'
                          ? 'bg-amber-500 border-amber-500 text-white'
                          : 'bg-white border-amber-300 text-amber-900 hover:bg-amber-50'
                      }`}
                    >
                      Unknown
                    </button>
                    <button
                      type="button"
                      onClick={() => setTag(line.id, 'defective')}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-colors ${
                        line.return_tag === 'defective'
                          ? 'bg-red-600 border-red-600 text-white'
                          : 'bg-white border-red-300 text-red-800 hover:bg-red-50'
                      }`}
                    >
                      Defective
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {lines.length > 0 && (
            <div className="flex justify-between text-sm border-t border-gray-200 pt-3">
              <span className="text-gray-600">Credit applied (tagged lines)</span>
              <span className="font-semibold text-gray-900">₹{formatNumber(creditApplied)}</span>
            </div>
          )}
          <div className="flex flex-col items-end gap-2 pt-2">
            {lines.length > 0 && !canClose && (
              <p className="text-xs text-amber-800 text-right max-w-md">
                Set <span className="font-medium">Credit this sale</span> and{' '}
                <span className="font-medium">Condition</span> for each line, or remove lines you do not need.
              </p>
            )}
            <Button variant="outline" onClick={requestClose}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
      {showScanner && (
        <BarcodeScanner
          isOpen={showScanner}
          onScan={async (c) => {
            setShowScanner(false);
            await addFromBarcode(c);
          }}
          onClose={() => setShowScanner(false)}
        />
      )}
    </>
  );
}
