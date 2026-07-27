import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Undo2 } from 'lucide-react';

type Mode = 'sale' | 'return';

type Props = {
  mode: Mode;
  /** When set, toggles in-place instead of navigating between POS routes. */
  onChange?: (mode: Mode) => void;
  ariaLabel?: string;
};

export default function CreditPOSModeToggle({
  mode,
  onChange,
  ariaLabel = 'POS mode',
}: Props) {
  const navigate = useNavigate();
  const isReturn = mode === 'return';

  const handleToggle = () => {
    const next: Mode = isReturn ? 'sale' : 'return';
    if (onChange) {
      onChange(next);
      return;
    }
    navigate(isReturn ? '/pos-credit' : '/pos-credit-return');
  };

  return (
    <div
      className="inline-flex items-center gap-2 sm:gap-3 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm"
      role="group"
      aria-label={ariaLabel}
    >
      <ShoppingCart
        className={`h-4 w-4 flex-shrink-0 ${!isReturn ? 'text-amber-700' : 'text-gray-400'}`}
      />
      <span
        className={`text-sm font-semibold whitespace-nowrap ${!isReturn ? 'text-amber-900' : 'text-gray-500'}`}
      >
        Sales
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={isReturn}
        aria-label={isReturn ? 'Switch to sales' : 'Switch to return'}
        onClick={handleToggle}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 ${
          isReturn ? 'bg-amber-600' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            isReturn ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
      <span
        className={`text-sm font-semibold whitespace-nowrap ${isReturn ? 'text-amber-900' : 'text-gray-500'}`}
      >
        Return
      </span>
      <Undo2
        className={`h-4 w-4 flex-shrink-0 ${isReturn ? 'text-amber-700' : 'text-gray-400'}`}
      />
    </div>
  );
}
