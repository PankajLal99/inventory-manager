import { useEffect, useState } from 'react';
import { Share, Smartphone, X } from 'lucide-react';
import { isStandaloneApp } from '../../../lib/salaryBookPwa';

export default function AddToHomeHint() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isStandaloneApp()) return;
    if (sessionStorage.getItem('sb_hide_a2hs') === '1') return;
    setOpen(true);
  }, []);

  if (!open) return null;

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);

  return (
    <div className="rounded-xl border border-emerald-200 bg-white p-4 text-sm text-gray-700">
      <div className="flex items-start gap-3">
        <Smartphone className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900">Add to Home Screen</div>
          {ios ? (
            <p className="mt-1 text-gray-600">
              Tap <Share className="inline h-3.5 w-3.5" /> Share, then <strong>Add to Home Screen</strong>.
              Open from your home screen for the full app.
            </p>
          ) : (
            <p className="mt-1 text-gray-600">
              Use your browser menu and choose <strong>Add to Home screen</strong> / <strong>Install app</strong>.
            </p>
          )}
        </div>
        <button
          type="button"
          className="p-1 text-gray-400"
          aria-label="Dismiss"
          onClick={() => {
            sessionStorage.setItem('sb_hide_a2hs', '1');
            setOpen(false);
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
