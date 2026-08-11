import Button from '../../../components/ui/Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  loading,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-gray-900/40" onClick={onCancel} aria-hidden />
      <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <p className="mt-2 text-sm text-gray-600 whitespace-pre-line">{message}</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button type="button" variant="outline" className="min-h-12" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={danger ? 'danger' : 'primary'}
            className={`min-h-12 ${danger ? '' : 'bg-emerald-600 hover:bg-emerald-700'}`}
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
