/** Yield to the browser so long exports don't freeze the UI. */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export function ExportProgressOverlay({
  open,
  title,
  label,
  percent,
}: {
  open: boolean;
  title: string;
  label: string;
  percent: number;
}) {
  if (!open) return null;
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[1px]"
      role="alertdialog"
      aria-busy="true"
      aria-live="polite"
      aria-label={title}
    >
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-[min(420px,92vw)] p-5">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-8 w-8 rounded-full border-2 border-green-500 border-t-transparent animate-spin shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">{title}</p>
            <p className="text-xs text-gray-500 mt-0.5 truncate">{label || 'Working…'}</p>
          </div>
        </div>
        <div className="mt-4 h-2.5 w-full rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-400 transition-[width] duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-xs font-medium text-gray-600 text-right tabular-nums">{Math.round(pct)}%</p>
        <p className="mt-3 text-[11px] text-gray-400 text-center">
          Please keep this tab open — large catalogs can take a minute.
        </p>
      </div>
    </div>
  );
}
