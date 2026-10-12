import { useEffect, useMemo, useState } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Textarea from '../../../components/ui/Textarea';
import { todayISO } from '../utils';
import SalaryBookSheet from './SalaryBookSheet';

export type AddAmountTarget = {
  employeeId: number;
  employeeName: string;
};

export type AddAmountSavePayload = {
  employee: number;
  date: string;
  reason: string;
  remarks: string;
  /** One or more mode splits (Cash, UPI, or both). */
  splits: Array<{ amount: string; payment_mode: 'CASH' | 'UPI' }>;
};

type Props = {
  target: AddAmountTarget | null;
  loading?: boolean;
  onClose: () => void;
  onSave: (payload: AddAmountSavePayload) => void;
};

export default function AddAmountDialog({ target, loading, onClose, onSave }: Props) {
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [upiAmount, setUpiAmount] = useState('');
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [useCash, setUseCash] = useState(true);
  const [useUpi, setUseUpi] = useState(false);
  const [error, setError] = useState('');

  const isMixed = useCash && useUpi;

  useEffect(() => {
    if (!target) return;
    setDate(todayISO());
    setAmount('');
    setCashAmount('');
    setUpiAmount('');
    setReason('');
    setRemarks('');
    setUseCash(true);
    setUseUpi(false);
    setError('');
  }, [target]);

  const mixedTotal = useMemo(() => {
    const cash = Number(cashAmount) || 0;
    const upi = Number(upiAmount) || 0;
    return cash + upi;
  }, [cashAmount, upiAmount]);

  if (!target) return null;

  const toggleCash = () => {
    if (useCash && !useUpi) return; // keep at least one mode
    setUseCash((v) => !v);
    setError('');
  };

  const toggleUpi = () => {
    if (useUpi && !useCash) return;
    setUseUpi((v) => !v);
    setError('');
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!useCash && !useUpi) {
      setError('Select Cash, UPI, or both.');
      return;
    }

    const splits: AddAmountSavePayload['splits'] = [];

    if (isMixed) {
      const cash = Number(cashAmount);
      const upi = Number(upiAmount);
      if (!(cash > 0) && !(upi > 0)) {
        setError('Enter Cash and/or UPI amounts.');
        return;
      }
      if (cash > 0) splits.push({ amount: cash.toFixed(2), payment_mode: 'CASH' });
      if (upi > 0) splits.push({ amount: upi.toFixed(2), payment_mode: 'UPI' });
    } else {
      const total = Number(amount);
      if (!(total > 0)) {
        setError('Enter a valid amount.');
        return;
      }
      splits.push({
        amount: total.toFixed(2),
        payment_mode: useCash ? 'CASH' : 'UPI',
      });
    }

    onSave({
      employee: target.employeeId,
      date,
      reason,
      remarks,
      splits,
    });
  };

  return (
    <SalaryBookSheet onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <h2 className="font-semibold text-lg">Add Amount</h2>
        <p className="text-sm text-gray-600">{target.employeeName}</p>
        <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />

        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">Taken via</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={toggleCash}
              className={`min-h-11 rounded-xl border text-sm font-medium ${
                useCash
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                  : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              Cash{useCash && useUpi ? ' ✓' : ''}
            </button>
            <button
              type="button"
              onClick={toggleUpi}
              className={`min-h-11 rounded-xl border text-sm font-medium ${
                useUpi
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                  : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              UPI{useCash && useUpi ? ' ✓' : ''}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-gray-500">
            Tap both for Cash + UPI mix.
          </p>
        </div>

        {isMixed ? (
          <div className="space-y-3">
            <Input
              label="Cash amount"
              required
              inputMode="decimal"
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
            />
            <Input
              label="UPI amount"
              required
              inputMode="decimal"
              value={upiAmount}
              onChange={(e) => setUpiAmount(e.target.value)}
            />
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-sm flex justify-between">
              <span className="text-gray-600">Total Taken</span>
              <span className="font-semibold tabular-nums">
                ₹{mixedTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        ) : (
          <Input
            label="Amount"
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        )}

        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Textarea label="Remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="outline" className="min-h-12" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" className="min-h-12 bg-emerald-600 hover:bg-emerald-700" loading={loading}>
            Save
          </Button>
        </div>
      </form>
    </SalaryBookSheet>
  );
}
