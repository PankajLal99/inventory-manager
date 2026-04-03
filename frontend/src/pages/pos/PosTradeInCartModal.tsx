import { useState, useCallback } from 'react';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import BarcodeScanner from '../../components/BarcodeScanner';
import { posApi } from '../../lib/api';
import { formatNumber } from '../../lib/utils';
import { Camera, Trash2, AlertTriangle, Search, Package } from 'lucide-react';

export type PosTradeInReturnTag = 'returned' | 'defective' | 'unknown';

export interface PosTradeInLine {
  id: string;
  invoice_item_id: number;
  source_invoice_id: number;
  source_invoice_number: string;
  product_name: string;
  barcode: string | null;
  credit: number;
  return_tag: PosTradeInReturnTag | null;
}

function customersAlignForTradeIn(
  invoiceCustomerId: number | null | undefined,
  selectedCustomerId: number | null | undefined
): boolean {
  const a = invoiceCustomerId ?? null;
  const b = selectedCustomerId ?? null;
  return a === b;
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  selectedCustomerId: number | null;
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
    }));
}

export function posTradeInCreditTotal(lines: PosTradeInLine[]): number {
  return lines.filter((l) => l.return_tag).reduce((s, l) => s + l.credit, 0);
}

export default function PosTradeInCartModal({
  open,
  onClose,
  selectedCustomerId,
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
      if (!selectedCustomerId) {
        onError('Select a customer first — trade-ins must match the same customer as this sale.');
        return;
      }
      setLoading(true);
      try {
        const { data } = await posApi.replacement.findInvoiceByBarcode({ barcode: trimmed });
        const inv = data?.invoice;
        if (!inv?.items?.length) {
          onError('No matching sold item found for this barcode.');
          return;
        }
        if (!customersAlignForTradeIn(inv.customer, selectedCustomerId)) {
          onError('This item was sold to a different customer. Select the correct customer or remove the trade-in.');
          return;
        }
        const item = inv.items[0];
        const invoiceItemId = item.id;
        if (lines.some((l) => l.invoice_item_id === invoiceItemId)) {
          onError('This item is already in the trade-in list.');
          return;
        }
        const credit = parseFloat(item.line_total || '0') || 0;
        const line: PosTradeInLine = {
          id: randomId(),
          invoice_item_id: invoiceItemId,
          source_invoice_id: inv.id,
          source_invoice_number: inv.invoice_number || '',
          product_name: item.product_name || item.product?.name || 'Item',
          barcode: item.barcode_value || item.barcode_full || trimmed,
          credit,
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
    [lines, onError, onLinesChange, selectedCustomerId]
  );

  const setTag = (id: string, tag: PosTradeInReturnTag) => {
    onLinesChange(lines.map((l) => (l.id === id ? { ...l, return_tag: tag } : l)));
  };

  const removeLine = (id: string) => {
    onLinesChange(lines.filter((l) => l.id !== id));
  };

  const creditApplied = posTradeInCreditTotal(lines);

  return (
    <>
      <Modal isOpen={open} onClose={onClose} title="Trade-in / exchange (same customer)" size="xl">
        <div className="space-y-5 max-h-[70vh] overflow-y-auto -mx-1 min-w-0">
          <p className="text-sm text-gray-600 leading-relaxed">
            Scan a <span className="font-medium text-gray-800">sold</span> barcode to add a return line. Then pick{' '}
            <span className="font-medium">Returned</span>, <span className="font-medium">Unknown</span>, or{' '}
            <span className="font-medium">Defective</span>. Credit follows the original sale line until checkout.
          </p>
          {!selectedCustomerId && (
            <div className="flex items-start gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <span>Select a customer on the POS before adding trade-ins.</span>
            </div>
          )}
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
              <p className="text-xs text-gray-500 max-w-sm">Search above to attach items sold to this customer.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {lines.map((line) => (
                <li key={line.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <div className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{line.product_name}</p>
                      <p className="text-xs text-gray-500 font-mono">{line.barcode || '—'}</p>
                      <p className="text-xs text-gray-500">From {line.source_invoice_number}</p>
                    </div>
                    <div className="flex items-start gap-1 flex-shrink-0">
                      <span className="text-sm font-semibold text-gray-900">₹{formatNumber(line.credit)}</span>
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        className="p-1 text-red-600 hover:bg-red-50 rounded"
                        title="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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
          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={onClose}>
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
