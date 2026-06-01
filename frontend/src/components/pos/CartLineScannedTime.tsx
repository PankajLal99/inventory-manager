import { Clock } from 'lucide-react';
import { formatScannedTime } from '../../lib/utils';

export type CartLineScanEntry = {
  barcode_display?: string | null;
  scanned_at?: string | null;
};

export type CartLineScanItem = {
  scanned_barcodes?: string[];
  scanned_barcodes_display?: string[];
  scanned_times?: (string | null)[];
  scanned_at?: string | null;
  scan_entries?: CartLineScanEntry[];
};

function buildScanEntries(item: CartLineScanItem): CartLineScanEntry[] {
  if (item.scan_entries && item.scan_entries.length > 0) {
    return item.scan_entries.filter((e) => e.scanned_at);
  }
  const barcodes = item.scanned_barcodes || [];
  const displays = item.scanned_barcodes_display || barcodes;
  const times = item.scanned_times || [];
  if (barcodes.length > 0) {
    return barcodes
      .map((bc, i) => ({
        barcode_display: displays[i] ?? bc,
        scanned_at: times[i] ?? null,
      }))
      .filter((e) => e.scanned_at);
  }
  if (item.scanned_at) {
    return [{ barcode_display: null, scanned_at: item.scanned_at }];
  }
  return [];
}

export function getCartLineScanSummary(item: CartLineScanItem) {
  const entries = buildScanEntries(item);
  const times = entries
    .map((e) => e.scanned_at)
    .filter((t): t is string => Boolean(t));
  const latest =
    times.length > 0
      ? times.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
      : null;
  const first = times[0] ?? null;
  return {
    entries,
    firstTime: first,
    latestTime: latest,
    hasMultiple: entries.length > 1,
  };
}

type CartLineScannedTimeProps = {
  item: CartLineScanItem;
  /** Inline next to product name */
  variant?: 'badge' | 'row' | 'chip';
  className?: string;
};

/** Labeled scan time(s) for a POS cart line. */
export default function CartLineScannedTime({
  item,
  variant = 'badge',
  className = '',
}: CartLineScannedTimeProps) {
  const summary = getCartLineScanSummary(item);
  if (summary.entries.length === 0) {
    return null;
  }

  if (variant === 'chip') {
    return (
      <span className={`text-[10px] text-gray-600 whitespace-nowrap ${className}`}>
        {formatScannedTime(summary.entries[0].scanned_at)}
      </span>
    );
  }

  if (variant === 'row') {
    return (
      <div
        className={`flex items-start gap-1.5 text-xs text-gray-600 mt-1 ${className}`}
        title="When this item was scanned and locked into the cart"
      >
        <Clock className="h-3.5 w-3.5 text-gray-400 flex-shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0">
          {summary.hasMultiple && summary.latestTime ? (
            <>
              <span className="font-medium text-gray-700">Last scanned: </span>
              <span>{formatScannedTime(summary.latestTime)}</span>
              {summary.firstTime && summary.firstTime !== summary.latestTime && (
                <span className="block text-[11px] text-gray-500 mt-0.5">
                  First: {formatScannedTime(summary.firstTime)}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="font-medium text-gray-700">Scanned: </span>
              <span>{formatScannedTime(summary.firstTime)}</span>
            </>
          )}
        </div>
      </div>
    );
  }

  const label =
    summary.hasMultiple && summary.latestTime
      ? `Last scanned: ${formatScannedTime(summary.latestTime)}`
      : `Scanned: ${formatScannedTime(summary.firstTime)}`;

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] sm:text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5 whitespace-nowrap ${className}`}
      title="When this item was scanned and locked into the cart"
    >
      <Clock className="h-3 w-3 text-gray-400 flex-shrink-0" aria-hidden />
      <span>{label}</span>
    </span>
  );
}

export function CartLineScanEntryList({
  item,
  className = '',
}: {
  item: CartLineScanItem;
  className?: string;
}) {
  const summary = getCartLineScanSummary(item);
  if (summary.entries.length === 0) return null;

  return (
    <ul className={`space-y-1 text-xs text-gray-600 ${className}`}>
      {summary.entries.map((entry, idx) => (
        <li key={`${entry.barcode_display ?? 'line'}-${idx}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {entry.barcode_display ? (
            <span className="font-mono font-medium text-gray-800">{entry.barcode_display}</span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3 text-gray-400" aria-hidden />
            <span className="font-medium text-gray-700">Scanned:</span>
            <span>{formatScannedTime(entry.scanned_at)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
