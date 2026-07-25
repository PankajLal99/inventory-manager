import { useState, useEffect, useRef, forwardRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  format,
  isValid,
  parse,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  addMonths,
  subMonths,
  isSameDay,
  isToday,
} from 'date-fns';

interface DatePickerProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  label?: string;
  error?: string;
  value?: string; // ISO date string (yyyy-mm-dd)
  onChange?: (date: string) => void; // Returns ISO date string
}

type PopupPos = { top: number; left: number; openUp: boolean };

const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(
  ({ label, error, className = '', value, onChange, ...props }, ref) => {
    const [inputValue, setInputValue] = useState('');
    const [showCalendar, setShowCalendar] = useState(false);
    const [viewDate, setViewDate] = useState(new Date());
    const [popupPos, setPopupPos] = useState<PopupPos>({ top: 0, left: 0, openUp: false });
    const containerRef = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const inputWrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (value) {
        try {
          const date = parse(value, 'yyyy-MM-dd', new Date());
          if (isValid(date)) {
            setInputValue(format(date, 'dd/MM/yyyy'));
            setViewDate(date);
          } else {
            setInputValue('');
          }
        } catch {
          setInputValue('');
        }
      } else {
        setInputValue('');
      }
    }, [value]);

    const updatePopupPosition = () => {
      const anchor = inputWrapRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const popupHeight = 320;
      const popupWidth = 256;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < popupHeight && rect.top > spaceBelow;
      let left = rect.left;
      if (left + popupWidth > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - popupWidth - 8);
      }
      setPopupPos({
        top: openUp ? rect.top - 4 : rect.bottom + 4,
        left,
        openUp,
      });
    };

    useLayoutEffect(() => {
      if (!showCalendar) return;
      updatePopupPosition();
      const onReposition = () => updatePopupPosition();
      window.addEventListener('resize', onReposition);
      window.addEventListener('scroll', onReposition, true);
      return () => {
        window.removeEventListener('resize', onReposition);
        window.removeEventListener('scroll', onReposition, true);
      };
    }, [showCalendar]);

    useEffect(() => {
      if (!showCalendar) return;
      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        const inInput = containerRef.current?.contains(target);
        const inPopup = popupRef.current?.contains(target);
        if (!inInput && !inPopup) {
          setShowCalendar(false);
          validateAndSync();
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showCalendar, inputValue, value]);

    const validateAndSync = () => {
      if (!inputValue) {
        if (value) onChange?.('');
        return;
      }

      if (inputValue.length === 10) {
        const parsedDate = parse(inputValue, 'dd/MM/yyyy', new Date());
        if (isValid(parsedDate)) {
          const isoDate = format(parsedDate, 'yyyy-MM-dd');
          if (isoDate !== value) {
            onChange?.(isoDate);
          }
        } else if (value) {
          const date = parse(value, 'yyyy-MM-dd', new Date());
          if (isValid(date)) {
            setInputValue(format(date, 'dd/MM/yyyy'));
          } else {
            setInputValue('');
          }
        } else {
          setInputValue('');
        }
      } else if (value) {
        const date = parse(value, 'yyyy-MM-dd', new Date());
        if (isValid(date)) {
          setInputValue(format(date, 'dd/MM/yyyy'));
        } else {
          setInputValue('');
        }
      } else {
        setInputValue('');
      }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      let val = e.target.value;
      val = val.replace(/[^\d/]/g, '');

      if (val.length > inputValue.length) {
        if (val.length === 2 && !val.includes('/')) {
          val = val + '/';
        } else if (val.length === 5 && val.split('/').length === 2) {
          val = val + '/';
        }
      }

      if (val.length <= 10) {
        setInputValue(val);

        if (val.length === 10) {
          const parsedDate = parse(val, 'dd/MM/yyyy', new Date());
          if (isValid(parsedDate) && parsedDate.getFullYear() > 1900) {
            const isoDate = format(parsedDate, 'yyyy-MM-dd');
            onChange?.(isoDate);
            setViewDate(parsedDate);
          }
        } else if (val === '') {
          onChange?.('');
        }
      }
    };

    const handleCalendarSelect = (date: Date) => {
      const isoDate = format(date, 'yyyy-MM-dd');
      setInputValue(format(date, 'dd/MM/yyyy'));
      onChange?.(isoDate);
      setShowCalendar(false);
    };

    const toggleCalendar = () => {
      setShowCalendar((prev) => !prev);
    };

    const nextMonth = () => setViewDate(addMonths(viewDate, 1));
    const prevMonth = () => setViewDate(subMonths(viewDate, 1));

    const monthStart = startOfMonth(viewDate);
    const monthEnd = endOfMonth(viewDate);
    const startDay = monthStart.getDay();
    const paddingDays = Array(startDay).fill(null);
    const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

    const weeks: (Date | null)[][] = [];
    let currentWeek: (Date | null)[] = [...paddingDays];

    daysInMonth.forEach((day) => {
      currentWeek.push(day);
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    });

    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      weeks.push(currentWeek);
    }

    const calendarPopup =
      showCalendar && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popupRef}
              className="fixed z-[9999] w-64 bg-white border border-gray-200 rounded-lg shadow-xl p-4"
              style={{
                top: popupPos.openUp ? undefined : popupPos.top,
                bottom: popupPos.openUp ? window.innerHeight - popupPos.top : undefined,
                left: popupPos.left,
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <button type="button" onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded-full">
                  <ChevronLeft className="h-4 w-4 text-gray-600" />
                </button>
                <div className="font-semibold text-gray-900">{format(viewDate, 'MMMM yyyy')}</div>
                <button type="button" onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded-full">
                  <ChevronRight className="h-4 w-4 text-gray-600" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                  <div key={day} className="text-center text-xs font-medium text-gray-500 py-1">
                    {day}
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                {weeks.map((week, weekIndex) => (
                  <div key={weekIndex} className="grid grid-cols-7 gap-1">
                    {week.map((date, dayIndex) => {
                      if (!date) return <div key={dayIndex} className="h-7" />;

                      const isSelected = value
                        ? isSameDay(date, parse(value, 'yyyy-MM-dd', new Date()))
                        : false;
                      const isTodayDate = isToday(date);

                      return (
                        <button
                          key={dayIndex}
                          type="button"
                          onClick={() => handleCalendarSelect(date)}
                          className={`
                            h-7 w-7 rounded-full text-sm flex items-center justify-center transition-colors
                            ${
                              isSelected
                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                : isTodayDate
                                  ? 'bg-blue-50 text-blue-600 font-semibold hover:bg-blue-100'
                                  : 'text-gray-900 hover:bg-gray-100'
                            }
                          `}
                        >
                          {format(date, 'd')}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setInputValue('');
                    onChange?.('');
                    setShowCalendar(false);
                  }}
                  className="text-xs text-red-600 hover:text-red-700 font-medium"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => handleCalendarSelect(new Date())}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  Today
                </button>
              </div>
            </div>,
            document.body
          )
        : null;

    return (
      <div className="relative" ref={containerRef}>
        {label && (
          <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        )}
        <div className="relative" ref={inputWrapRef}>
          <input
            ref={ref}
            type="text"
            className={`block w-full pl-3 pr-10 py-2.5 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${
              error
                ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                : 'border-gray-300'
            } ${className}`}
            placeholder="dd/mm/yyyy"
            value={inputValue}
            onChange={handleInputChange}
            onFocus={() => setShowCalendar(true)}
            onBlur={() => {
              // Close handled via outside click so calendar clicks work
            }}
            {...props}
          />
          <button
            type="button"
            onClick={toggleCalendar}
            className="absolute inset-y-0 right-0 px-3 flex items-center cursor-pointer text-gray-400 hover:text-blue-600"
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </div>
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
        {calendarPopup}
      </div>
    );
  }
);

DatePicker.displayName = 'DatePicker';

export default DatePicker;
