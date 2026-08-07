import { useEffect, useRef, useState } from 'react';
import { Palette, RotateCcw, X } from 'lucide-react';
import {
  DEFAULT_INVOICE_THEME,
  DEFAULT_LEDGER_THEME,
  useCreditDocThemes,
  type CreditDocKind,
} from '../pages/credit/creditDocTheme';

const INVOICE_PRESETS = [
  '#d97706', // amber (default)
  '#ea580c', // orange
  '#dc2626', // red
  '#c026d3', // fuchsia
  '#7c3aed', // violet
];

const LEDGER_PRESETS = [
  '#0f766e', // teal (default)
  '#0369a1', // sky
  '#1d4ed8', // blue
  '#4338ca', // indigo
  '#166534', // green
];

type Props = {
  /** Restrict picker to one document kind (omit for both). */
  kinds?: CreditDocKind[];
  className?: string;
};

function ColorRow({
  label,
  kind,
  primary,
  presets,
  defaultPrimary,
  onChange,
  onReset,
}: {
  label: string;
  kind: CreditDocKind;
  primary: string;
  presets: string[];
  defaultPrimary: string;
  onChange: (kind: CreditDocKind, hex: string) => void;
  onReset: (kind: CreditDocKind) => void;
}) {
  const isCustom = primary.toLowerCase() !== defaultPrimary.toLowerCase();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10 shrink-0"
            style={{ background: primary }}
            aria-hidden
          />
          <span className="text-sm font-semibold text-stone-800 truncate">{label}</span>
        </div>
        {isCustom ? (
          <button
            type="button"
            onClick={() => onReset(kind)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-stone-500 hover:text-stone-800"
            title={`Reset ${label} to default`}
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((hex) => {
          const active = primary.toLowerCase() === hex.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              title={hex}
              onClick={() => onChange(kind, hex)}
              className={`h-7 w-7 rounded-md ring-offset-1 transition ${
                active ? 'ring-2 ring-stone-800 scale-105' : 'ring-1 ring-black/10 hover:scale-105'
              }`}
              style={{ background: hex }}
              aria-label={`${label} ${hex}`}
            />
          );
        })}
        <label
          className="relative h-7 w-7 rounded-md ring-1 ring-black/10 overflow-hidden cursor-pointer hover:ring-stone-400"
          title="Custom color"
        >
          <span
            className="absolute inset-0"
            style={{
              background:
                'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
            }}
          />
          <input
            type="color"
            value={primary}
            onChange={(e) => onChange(kind, e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
            aria-label={`${label} custom color`}
          />
        </label>
      </div>
    </div>
  );
}

/**
 * Floating corner control to pick document chrome colors for credit invoice / ledger.
 * Persists via localStorage and refreshes live previews / PDF / snapshots.
 */
export default function CreditDocColorPicker({ kinds, className = '' }: Props) {
  const { invoice, ledger, setPrimary, reset, resetAll } = useCreditDocThemes();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const showInvoice = !kinds || kinds.includes('invoice');
  const showLedger = !kinds || kinds.includes('ledger');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  return (
    <div
      ref={panelRef}
      className={`fixed bottom-4 right-4 z-50 print:hidden ${className}`}
    >
      {open ? (
        <div className="mb-2 w-[260px] rounded-xl border border-stone-200 bg-white shadow-xl shadow-stone-900/10 ring-1 ring-black/[0.04] p-3.5 space-y-3.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-stone-900">Document colors</div>
              <div className="text-[11px] text-stone-500 mt-0.5 leading-snug">
                Invoice and ledger use separate schemes. Changes apply to preview, PDF, and copy.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100"
              aria-label="Close color picker"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {showInvoice ? (
            <ColorRow
              label="Invoice"
              kind="invoice"
              primary={invoice.primary}
              presets={INVOICE_PRESETS}
              defaultPrimary={DEFAULT_INVOICE_THEME.primary}
              onChange={setPrimary}
              onReset={reset}
            />
          ) : null}

          {showLedger ? (
            <ColorRow
              label="Ledger"
              kind="ledger"
              primary={ledger.primary}
              presets={LEDGER_PRESETS}
              defaultPrimary={DEFAULT_LEDGER_THEME.primary}
              onChange={setPrimary}
              onReset={reset}
            />
          ) : null}

          {showInvoice && showLedger ? (
            <button
              type="button"
              onClick={() => resetAll()}
              className="w-full text-center text-[11px] font-medium text-stone-500 hover:text-stone-800 py-1"
            >
              Reset all to defaults
            </button>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative ml-auto flex h-11 w-11 items-center justify-center rounded-full shadow-lg ring-1 ring-black/10 transition ${
          open
            ? 'bg-stone-900 text-white'
            : 'bg-white text-stone-700 hover:bg-stone-50'
        }`}
        title="Document colors"
        aria-label="Open document color picker"
        aria-expanded={open}
      >
        <Palette className="h-5 w-5" />
        <span
          className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 overflow-hidden rounded-full ring-2 ring-white"
          aria-hidden
        >
          <span className="w-1/2 h-full" style={{ background: invoice.primary }} />
          <span className="w-1/2 h-full" style={{ background: ledger.primary }} />
        </span>
      </button>
    </div>
  );
}
