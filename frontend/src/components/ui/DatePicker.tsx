
import { useState, useEffect, useRef, forwardRef } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, isValid, parse, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, isSameDay, isToday } from 'date-fns';

interface DatePickerProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
    label?: string;
    error?: string;
    value?: string; // ISO date string (yyyy-mm-dd)
    onChange?: (date: string) => void; // Returns ISO date string
}

const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(
    ({ label, error, className = '', value, onChange, ...props }, ref) => {
        // Internal state for the text input (dd/mm/yyyy)
        const [inputValue, setInputValue] = useState('');
        const [showCalendar, setShowCalendar] = useState(false);
        const [viewDate, setViewDate] = useState(new Date()); // Date currently visible in calendar
        const containerRef = useRef<HTMLDivElement>(null);

        // Initialize input value from prop
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
                } catch (e) {
                    setInputValue('');
                }
            } else {
                setInputValue('');
            }
        }, [value]);

        // Handle clicking outside to close calendar
        useEffect(() => {
            const handleClickOutside = (event: MouseEvent) => {
                if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                    setShowCalendar(false);
                    // On blur/close, validate and revert if needed
                    validateAndSync();
                }
            };

            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }, [inputValue, value]);

        const validateAndSync = () => {
            if (!inputValue) {
                if (value) onChange?.('');
                return;
            }

            // Check if it's a complete date
            if (inputValue.length === 10) {
                const parsedDate = parse(inputValue, 'dd/MM/yyyy', new Date());
                if (isValid(parsedDate)) {
                    const isoDate = format(parsedDate, 'yyyy-MM-dd');
                    if (isoDate !== value) {
                        onChange?.(isoDate);
                    }
                } else {
                    // Revert to valid value if invalid
                    if (value) {
                        const date = parse(value, 'yyyy-MM-dd', new Date());
                        if (isValid(date)) {
                            setInputValue(format(date, 'dd/MM/yyyy'));
                        } else {
                            setInputValue('');
                        }
                    } else {
                        setInputValue('');
                    }
                }
            } else {
                // Incomplete date, revert
                if (value) {
                    const date = parse(value, 'yyyy-MM-dd', new Date());
                    if (isValid(date)) {
                        setInputValue(format(date, 'dd/MM/yyyy'));
                    } else {
                        setInputValue('');
                    }
                } else {
                    setInputValue('');
                }
            }
        };

        const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            let val = e.target.value;

            // Allow only numbers and slashes
            val = val.replace(/[^\d/]/g, '');

            // Auto-add slashes
            if (val.length > inputValue.length) { // Only when typing forward
                if (val.length === 2 && !val.includes('/')) {
                    val = val + '/';
                } else if (val.length === 5 && val.split('/').length === 2) {
                    val = val + '/';
                }
            }

            if (val.length <= 10) {
                setInputValue(val);

                // Auto-save if valid full date
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
            setShowCalendar(!showCalendar);
        };

        // Calendar navigation
        const nextMonth = () => setViewDate(addMonths(viewDate, 1));
        const prevMonth = () => setViewDate(subMonths(viewDate, 1));

        // Generate calendar days
        const monthStart = startOfMonth(viewDate);
        const monthEnd = endOfMonth(viewDate);
        const startDate = monthStart; // Start from 1st of month

        // We need to pad the start to align with days of week (Su Mo Tu We Th Fr Sa)
        const startDay = startDate.getDay(); // 0 is Sunday
        const paddingDays = Array(startDay).fill(null);

        const daysInMonth = eachDayOfInterval({
            start: monthStart,
            end: monthEnd,
        });

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
            // Pad end of last week
            while (currentWeek.length < 7) {
                currentWeek.push(null);
            }
            weeks.push(currentWeek);
        }

        return (
            <div className="relative" ref={containerRef}>
                {label && (
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        {label}
                    </label>
                )}
                <div className="relative">
                    <input
                        ref={ref}
                        type="text"
                        className={`block w-full pl-3 pr-10 py-2.5 border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${error ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : 'border-gray-300'
                            } ${className}`}
                        placeholder="dd/mm/yyyy"
                        value={inputValue}
                        onChange={handleInputChange}
                        onFocus={() => setShowCalendar(true)}
                        onBlur={() => {
                            // We handle blur via click outside to avoid closing when clicking calendar
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

                {/* Calendar Popup */}
                {showCalendar && (
                    <div className="absolute z-50 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                            <button
                                type="button"
                                onClick={prevMonth}
                                className="p-1 hover:bg-gray-100 rounded-full"
                            >
                                <ChevronLeft className="h-4 w-4 text-gray-600" />
                            </button>
                            <div className="font-semibold text-gray-900">
                                {format(viewDate, 'MMMM yyyy')}
                            </div>
                            <button
                                type="button"
                                onClick={nextMonth}
                                className="p-1 hover:bg-gray-100 rounded-full"
                            >
                                <ChevronRight className="h-4 w-4 text-gray-600" />
                            </button>
                        </div>

                        <div className="grid grid-cols-7 gap-1 mb-2">
                            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
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

                                        const isSelected = value ? isSameDay(date, parse(value, 'yyyy-MM-dd', new Date())) : false;
                                        const isTodayDate = isToday(date);

                                        return (
                                            <button
                                                key={dayIndex}
                                                type="button"
                                                onClick={() => handleCalendarSelect(date)}
                                                className={`
                          h-7 w-7 rounded-full text-sm flex items-center justify-center transition-colors
                          ${isSelected
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
                    </div>
                )}
            </div>
        );
    }
);

DatePicker.displayName = 'DatePicker';

export default DatePicker;
