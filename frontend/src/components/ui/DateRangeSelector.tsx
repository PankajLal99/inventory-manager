import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import DatePicker from './DatePicker';
import Button from './Button';
import {
  DateRangePreset,
  DateRangeValue,
  formatDateDDMMYYYY,
  getDateRangeByPreset,
  getTodayDateString,
  normalizeDateRange,
} from '../../lib/utils';

interface DateRangeSelectorProps {
  value: DateRangeValue;
  preset: DateRangePreset;
  onChange: (next: { preset: DateRangePreset; range: DateRangeValue }) => void;
  className?: string;
}

const PRESET_OPTIONS: Array<{ key: Exclude<DateRangePreset, 'custom'>; label: string }> = [
  { key: 'one_day', label: '1 day' },
  { key: 'last_7_days', label: '7 days' },
  { key: 'last_30_days', label: '30 days' },
];

const getPresetLabel = (preset: DateRangePreset): string => {
  if (preset === 'one_day') return '1 day';
  if (preset === 'last_7_days') return 'Last 7 days';
  if (preset === 'last_30_days') return 'Last 30 days';
  return 'Custom';
};

type CustomDateMode = 'single' | 'between';

const isBetweenRange = (startDate: string, endDate: string) =>
  Boolean(startDate && endDate && startDate !== endDate);

const inferCustomDateMode = (startDate: string, endDate: string): CustomDateMode =>
  isBetweenRange(startDate, endDate) ? 'between' : 'single';

export default function DateRangeSelector({
  value,
  preset,
  onChange,
  className = '',
}: DateRangeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftStartDate, setDraftStartDate] = useState(value.startDate);
  const [draftEndDate, setDraftEndDate] = useState(value.endDate);
  const [customDateMode, setCustomDateMode] = useState<CustomDateMode>(() =>
    inferCustomDateMode(value.startDate, value.endDate),
  );
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraftStartDate(value.startDate);
    setDraftEndDate(value.endDate);
  }, [value.startDate, value.endDate]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const displayRange = useMemo(() => {
    if (!value.startDate && !value.endDate) return 'Select date range';
    if (value.startDate && value.endDate) {
      if (value.startDate === value.endDate) {
        return formatDateDDMMYYYY(value.startDate);
      }
      return `${formatDateDDMMYYYY(value.startDate)} - ${formatDateDDMMYYYY(value.endDate)}`;
    }
    if (value.startDate) return formatDateDDMMYYYY(value.startDate);
    return formatDateDDMMYYYY(value.endDate);
  }, [value.endDate, value.startDate]);

  const applyPreset = (nextPreset: Exclude<DateRangePreset, 'custom'>) => {
    onChange({
      preset: nextPreset,
      range: getDateRangeByPreset(nextPreset),
    });
    setIsOpen(false);
  };

  const applyCustomRange = () => {
    let nextRange: DateRangeValue;

    if (customDateMode === 'single') {
      const day = draftStartDate || draftEndDate;
      nextRange = { startDate: day, endDate: day };
    } else {
      nextRange = {
        startDate: draftStartDate,
        endDate: draftEndDate,
      };
      if (nextRange.startDate && !nextRange.endDate) {
        nextRange = { startDate: nextRange.startDate, endDate: nextRange.startDate };
      } else if (!nextRange.startDate && nextRange.endDate) {
        nextRange = { startDate: nextRange.endDate, endDate: nextRange.endDate };
      }
    }

    const normalized = normalizeDateRange(nextRange);
    onChange({
      preset: 'custom',
      range: normalized,
    });
    setIsOpen(false);
  };

  const selectCustomMode = () => {
    const day = value.endDate || value.startDate || getTodayDateString();
    setCustomDateMode('single');
    setDraftStartDate(day);
    setDraftEndDate(day);
    onChange({
      preset: 'custom',
      range: { startDate: day, endDate: day },
    });
  };

  const setCustomMode = (mode: CustomDateMode) => {
    setCustomDateMode(mode);
    if (mode === 'single') {
      const day = draftStartDate || draftEndDate || value.startDate || value.endDate;
      setDraftStartDate(day);
      setDraftEndDate(day);
    }
  };

  const resetRange = () => {
    setDraftStartDate('');
    setDraftEndDate('');
    setCustomDateMode('single');
    onChange({
      preset: 'custom',
      range: { startDate: '', endDate: '' },
    });
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full h-[42px] px-3 py-2.5 border border-gray-300 rounded-lg bg-white shadow-sm hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex items-center gap-2 text-sm text-gray-800">
            <CalendarDays className="h-4 w-4 text-gray-500 flex-shrink-0" />
            <span className="truncate">{displayRange}</span>
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 flex-shrink-0">
            {getPresetLabel(preset)}
            <ChevronDown className="h-3.5 w-3.5" />
          </span>
        </span>
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,420px)] rounded-xl border border-gray-200 bg-white shadow-xl p-4 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 mb-2">Quick ranges</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PRESET_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => applyPreset(option.key)}
                  className={`rounded-lg border px-2.5 py-2 text-sm font-medium transition-colors ${preset === option.key
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                    }`}
                >
                  {option.label}
                </button>
              ))}
              <button
                type="button"
                onClick={selectCustomMode}
                className={`rounded-lg border px-2.5 py-2 text-sm font-medium transition-colors ${preset === 'custom'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                  }`}
              >
                Custom
              </button>
            </div>
          </div>

          {preset === 'custom' && (
            <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-wide font-semibold text-gray-500">Custom</p>
                <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => setCustomMode('single')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${customDateMode === 'single'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                      }`}
                  >
                    One day
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomMode('between')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${customDateMode === 'between'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                      }`}
                  >
                    Between
                  </button>
                </div>
              </div>
              {customDateMode === 'single' ? (
                <DatePicker
                  label="Date"
                  value={draftStartDate || draftEndDate}
                  onChange={(nextDate) => {
                    setDraftStartDate(nextDate);
                    setDraftEndDate(nextDate);
                  }}
                  aria-label="Custom date"
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <DatePicker
                    label="Start date"
                    value={draftStartDate}
                    onChange={setDraftStartDate}
                    aria-label="Custom start date"
                  />
                  <DatePicker
                    label="End date"
                    value={draftEndDate}
                    onChange={setDraftEndDate}
                    aria-label="Custom end date"
                  />
                </div>
              )}
              {customDateMode === 'between' && draftStartDate && draftEndDate && draftEndDate < draftStartDate && (
                <p className="text-xs text-amber-700">
                  End date is before start date. It will be fixed automatically on apply.
                </p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" size="sm" onClick={applyCustomRange}>
                  Apply
                </Button>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <Button type="button" variant="outline" size="sm" onClick={resetRange}>
              Reset
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
