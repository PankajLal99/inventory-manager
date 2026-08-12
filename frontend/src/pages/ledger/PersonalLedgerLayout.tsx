import { useState, useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { Lock } from 'lucide-react';

const PIN_LENGTH = 6;
const PERSONAL_LEDGER_PIN = '980980';

export default function PersonalLedgerLayout() {
  const [unlocked, setUnlocked] = useState(false);
  const [pinDigits, setPinDigits] = useState<string[]>(() => Array(PIN_LENGTH).fill(''));
  const [pinError, setPinError] = useState('');
  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!unlocked) {
      const t = setTimeout(() => pinInputRefs.current[0]?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [unlocked]);

  const clearPin = () => {
    setPinDigits(Array(PIN_LENGTH).fill(''));
    setPinError('');
    pinInputRefs.current[0]?.focus();
  };

  const handlePinChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...pinDigits];
    next[index] = digit;
    setPinDigits(next);
    setPinError('');
    if (digit && index < PIN_LENGTH - 1) pinInputRefs.current[index + 1]?.focus();
    if (next.every(Boolean)) {
      const pin = next.join('');
      if (pin === PERSONAL_LEDGER_PIN) {
        setUnlocked(true);
      } else {
        setPinError('Wrong PIN');
        clearPin();
      }
    }
  };

  const handlePinKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      clearPin();
    }
  };

  if (!unlocked) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
          <div className="flex flex-col items-center">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-6">
              <Lock className="h-7 w-7 text-gray-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-1">Personal Ledger locked</h2>
            <p className="text-sm text-gray-500 mb-6">Enter 6-digit PIN</p>
            <div className="flex gap-2 justify-center mb-2">
              {Array.from({ length: PIN_LENGTH }, (_, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    pinInputRefs.current[i] = el;
                  }}
                  type="password"
                  inputMode="numeric"
                  maxLength={1}
                  autoFocus={i === 0}
                  value={pinDigits[i]}
                  onChange={(e) => handlePinChange(i, e.target.value)}
                  onKeyDown={handlePinKeyDown}
                  className="w-14 h-14 text-center text-lg font-semibold border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 border-gray-300"
                />
              ))}
            </div>
            {pinError ? <p className="text-sm text-red-600 font-medium mt-2">{pinError}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
