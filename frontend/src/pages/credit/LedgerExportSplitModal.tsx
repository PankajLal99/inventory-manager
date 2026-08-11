import { useEffect, useMemo, useState } from 'react';
import { Camera, FileText, ClipboardCopy } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import {
  LEDGER_EXPORT_DAY_PRESETS,
  LEDGER_EXPORT_ROW_PRESETS,
  ledgerExportSplitLabel,
  normalizeLedgerExportSplit,
  type LedgerExportSplit,
} from './ledgerExportSettings';

export type LedgerExportAction = 'picture' | 'pdf-download' | 'pdf-copy';

type Props = {
  isOpen: boolean;
  action: LedgerExportAction;
  initial: LedgerExportSplit;
  previewPageCount: (split: LedgerExportSplit) => number;
  busy?: boolean;
  onClose: () => void;
  onSave: (split: LedgerExportSplit) => void;
  onConfirm: (split: LedgerExportSplit, save: boolean) => void;
};

const ACTION_META: Record<
  LedgerExportAction,
  { title: string; confirm: string; icon: typeof Camera }
> = {
  picture: { title: 'Copy ledger picture', confirm: 'Copy picture', icon: Camera },
  'pdf-download': { title: 'Download ledger PDF', confirm: 'Download PDF', icon: FileText },
  'pdf-copy': { title: 'Copy ledger PDF', confirm: 'Copy PDF', icon: ClipboardCopy },
};

export default function LedgerExportSplitModal({
  isOpen,
  action,
  initial,
  previewPageCount,
  busy = false,
  onClose,
  onSave,
  onConfirm,
}: Props) {
  const [draft, setDraft] = useState<LedgerExportSplit>(() => normalizeLedgerExportSplit(initial));
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(normalizeLedgerExportSplit(initial));
    setRemember(true);
  }, [isOpen, initial]);

  const meta = ACTION_META[action];
  const ConfirmIcon = meta.icon;
  const normalized = useMemo(() => normalizeLedgerExportSplit(draft), [draft]);
  const pageCount = previewPageCount(normalized);

  const toggle = (key: 'useRows' | 'useDays') => {
    setDraft((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (!next.useRows && !next.useDays) {
        return key === 'useRows' ? { ...next, useDays: true } : { ...next, useRows: true };
      }
      return next;
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={meta.title} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-stone-600">
          Use rows, days, or both. Example: 1 day + 1 row → each entry is its own WhatsApp image.
          25 rows on 25 days = 25 copy buttons.
        </p>

        <label className="flex items-center gap-2 text-sm font-medium text-stone-800 cursor-pointer">
          <input
            type="checkbox"
            className="rounded border-stone-300 text-amber-700 focus:ring-amber-600"
            checked={normalized.useRows}
            onChange={() => toggle('useRows')}
          />
          Split by rows
        </label>
        {normalized.useRows ? (
          <div className="-mt-2">
            <Input
              label="Rows per image"
              type="number"
              min={1}
              max={200}
              value={String(draft.rowsPerPage)}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, rowsPerPage: Number(e.target.value) || 0 }))
              }
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {LEDGER_EXPORT_ROW_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, rowsPerPage: n, useRows: true }))}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                    normalized.rowsPerPage === n
                      ? 'border-amber-800 bg-amber-800 text-white'
                      : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <label className="flex items-center gap-2 text-sm font-medium text-stone-800 cursor-pointer">
          <input
            type="checkbox"
            className="rounded border-stone-300 text-amber-700 focus:ring-amber-600"
            checked={normalized.useDays}
            onChange={() => toggle('useDays')}
          />
          Split by days
        </label>
        {normalized.useDays ? (
          <div className="-mt-2">
            <Input
              label="Days per image"
              type="number"
              min={1}
              max={366}
              value={String(draft.daysPerPage)}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, daysPerPage: Number(e.target.value) || 0 }))
              }
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {LEDGER_EXPORT_DAY_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, daysPerPage: n, useDays: true }))}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                    normalized.daysPerPage === n
                      ? 'border-amber-800 bg-amber-800 text-white'
                      : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {n}d
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-950">
          <div>
            This copy: <span className="font-semibold">{ledgerExportSplitLabel(normalized)}</span>
          </div>
          <div className="font-semibold mt-0.5">
            {pageCount === 1
              ? '1 image'
              : `${pageCount} separate images — one Copy button per image`}
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm text-stone-700 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-stone-300 text-amber-700 focus:ring-amber-600"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>Remember this for the next picture copy and PDF</span>
        </label>

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => onSave(normalized)} disabled={busy}>
            Save
          </Button>
          <Button onClick={() => onConfirm(normalized, remember)} disabled={busy}>
            <ConfirmIcon className="h-4 w-4" />
            {busy ? 'Working…' : meta.confirm}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
