import * as React from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { FilterState } from '../../../types';
import { DATE_PRESETS, formatDateInputValue, getDateFilterLabel, normalizeDateInputPair } from '../../../utils/dateFilters';

interface DateRangeSectionProps {
    filters: FilterState;
    setFilters: (update: (prev: FilterState) => FilterState) => void;
}

interface CalendarDay {
    date: Date;
    value: string;
    isCurrentMonth: boolean;
    isToday: boolean;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const createLocalDate = (year: number, monthIndex: number, day: number): Date =>
    new Date(year, monthIndex, day);

const parseDateInput = (value: string | undefined): Date | null => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

    const [year, month, day] = value.split('-').map(Number);
    const date = createLocalDate(year, month - 1, day);

    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
        ? date
        : null;
};

const startOfMonth = (date: Date): Date =>
    createLocalDate(date.getFullYear(), date.getMonth(), 1);

const addMonths = (date: Date, months: number): Date =>
    createLocalDate(date.getFullYear(), date.getMonth() + months, 1);

const getWeekStartsOn = (): number => {
    try {
        const locale = typeof navigator === 'undefined' ? undefined : navigator.language;
        const firstDay = locale
            ? (new Intl.Locale(locale) as Intl.Locale & { weekInfo?: { firstDay?: number } }).weekInfo?.firstDay
            : undefined;
        return typeof firstDay === 'number' ? firstDay % 7 : 0;
    } catch {
        return 0;
    }
};

const getOrderedWeekdayLabels = (weekStartsOn: number): string[] =>
    Array.from({ length: 7 }, (_, index) => WEEKDAY_LABELS[(weekStartsOn + index) % 7]);

const getMonthGrid = (month: Date, weekStartsOn: number): CalendarDay[] => {
    const monthStart = startOfMonth(month);
    const firstGridOffset = (monthStart.getDay() - weekStartsOn + 7) % 7;
    const gridStart = createLocalDate(monthStart.getFullYear(), monthStart.getMonth(), 1 - firstGridOffset);
    const todayValue = formatDateInputValue(new Date());

    return Array.from({ length: 42 }, (_, index) => {
        const date = createLocalDate(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
        const value = formatDateInputValue(date);

        return {
            date,
            value,
            isCurrentMonth: date.getMonth() === monthStart.getMonth(),
            isToday: value === todayValue
        };
    });
};

const getInitialOpenMonth = (dateFrom: string | undefined, dateTo: string | undefined): Date => {
    const fromDate = parseDateInput(dateFrom);
    if (fromDate) return startOfMonth(fromDate);

    const toDate = parseDateInput(dateTo);
    if (toDate) return startOfMonth(toDate);

    return startOfMonth(new Date());
};

const monthLabelFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric'
});

const getMonthLabel = (date: Date): string => monthLabelFormatter.format(date);

const isWithinDraftRange = (value: string, dateFrom: string, dateTo: string): boolean =>
    !!dateFrom && !!dateTo && value >= dateFrom && value <= dateTo;

export const DateRangeSection: React.FC<DateRangeSectionProps> = ({
    filters,
    setFilters
}) => {
    const rootRef = React.useRef<HTMLDivElement>(null);
    const [isCustomOpen, setIsCustomOpen] = React.useState(false);
    const [draftFrom, setDraftFrom] = React.useState(filters.dateFrom ?? '');
    const [draftTo, setDraftTo] = React.useState(filters.dateTo ?? '');
    const [openMonth, setOpenMonth] = React.useState(() => getInitialOpenMonth(filters.dateFrom, filters.dateTo));

    const weekStartsOn = React.useMemo(() => getWeekStartsOn(), []);
    const weekdayLabels = React.useMemo(() => getOrderedWeekdayLabels(weekStartsOn), [weekStartsOn]);
    const calendarDays = React.useMemo(() => getMonthGrid(openMonth, weekStartsOn), [openMonth, weekStartsOn]);
    const monthLabel = React.useMemo(() => getMonthLabel(openMonth), [openMonth]);

    const customLabel = React.useMemo(() => {
        if (filters.dateRange !== 'custom') return null;
        return getDateFilterLabel(filters)?.replace(/^Date:\s*/, '') ?? null;
    }, [filters]);

    const handlePresetClick = (range: FilterState['dateRange']) => {
        setIsCustomOpen(false);
        if (filters.dateRange !== range || filters.dateFrom || filters.dateTo) {
            setFilters(prev => ({
                ...prev,
                dateRange: range,
                dateFrom: undefined,
                dateTo: undefined
            }));
        }
    };

    const openCustomRange = () => {
        setDraftFrom(filters.dateFrom ?? '');
        setDraftTo(filters.dateTo ?? '');
        setOpenMonth(getInitialOpenMonth(filters.dateFrom, filters.dateTo));
        setIsCustomOpen(true);
    };

    const handleDayClick = (value: string) => {
        if (!draftFrom || draftTo) {
            setDraftFrom(value);
            setDraftTo('');
            return;
        }

        const normalized = normalizeDateInputPair(draftFrom, value);
        setDraftFrom(normalized.dateFrom ?? '');
        setDraftTo(normalized.dateTo ?? '');
    };

    const applyCustomRange = () => {
        const normalized = normalizeDateInputPair(draftFrom || undefined, draftTo || undefined);

        setFilters(prev => ({
            ...prev,
            dateRange: normalized.dateFrom || normalized.dateTo ? 'custom' : 'all',
            ...normalized
        }));
        setIsCustomOpen(false);
    };

    const clearCustomRange = () => {
        setDraftFrom('');
        setDraftTo('');
        setFilters(prev => ({
            ...prev,
            dateRange: 'all',
            dateFrom: undefined,
            dateTo: undefined
        }));
        setIsCustomOpen(false);
    };

    React.useEffect(() => {
        if (!isCustomOpen) return;

        const handlePointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setIsCustomOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsCustomOpen(false);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isCustomOpen]);

    return (
        <div ref={rootRef} className="space-y-3 pt-4 border-t border-gray-200 dark:border-white/10">
            <h3 className="flex items-center gap-2 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                <Calendar className="w-3 h-3" /> Date Range
            </h3>
            <div className="grid grid-cols-2 gap-2">
                {DATE_PRESETS.map((range) => (
                    <button
                        key={range}
                        onClick={() => handlePresetClick(range)}
                        className={`px-3 py-2 text-xs rounded-lg capitalize transition-all ease-spring duration-300 border ${filters.dateRange === range
                                ? 'bg-sage-600 text-white border-sage-500 shadow-lg shadow-sage-500/20'
                                : 'bg-gray-100 dark:bg-zinc-800/50 text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10'
                            }`}
                    >
                        {range}
                    </button>
                ))}
            </div>
            <div className="relative">
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={openCustomRange}
                        aria-expanded={isCustomOpen}
                        aria-controls="date-range-popover"
                        className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all ease-spring duration-300 ${customLabel
                                ? 'border-sage-500 bg-sage-600 text-white shadow-lg shadow-sage-500/20'
                                : 'border-gray-200 bg-gray-100 text-gray-500 hover:border-gray-300 dark:border-white/5 dark:bg-zinc-800/50 dark:text-zinc-400 dark:hover:border-white/10'
                            }`}
                    >
                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{customLabel ?? 'Custom range'}</span>
                    </button>
                    {customLabel && (
                        <button
                            type="button"
                            onClick={clearCustomRange}
                            aria-label="Clear custom date range"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sage-500/50 bg-sage-600 text-white shadow-lg shadow-sage-500/20 transition-colors hover:bg-sage-700 focus:outline-none focus:ring-1 focus:ring-sage-500/40"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>

                {isCustomOpen && (
                    <div
                        id="date-range-popover"
                        role="dialog"
                        aria-label="Custom date range"
                        className="absolute bottom-full left-0 z-30 mb-2 w-full rounded-lg border border-gray-200 bg-white p-3 shadow-xl shadow-black/10 dark:border-white/10 dark:bg-zinc-900 dark:shadow-black/40"
                    >
                        <div className="mb-3 flex items-center justify-between">
                            <button
                                type="button"
                                onClick={() => setOpenMonth(prev => addMonths(prev, -1))}
                                aria-label="Previous month"
                                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-sage-500/30 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-200"
                            >
                                <ChevronLeft className="h-3.5 w-3.5" />
                            </button>
                            <div
                                aria-label="Current calendar month"
                                className="text-xs font-semibold text-gray-700 dark:text-zinc-200"
                            >
                                {monthLabel}
                            </div>
                            <button
                                type="button"
                                onClick={() => setOpenMonth(prev => addMonths(prev, 1))}
                                aria-label="Next month"
                                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-sage-500/30 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-200"
                            >
                                <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                        </div>

                        <div className="grid grid-cols-7 gap-1" aria-hidden="true">
                            {weekdayLabels.map((label) => (
                                <div
                                    key={label}
                                    className="flex h-5 items-center justify-center text-[10px] font-semibold uppercase text-gray-400 dark:text-zinc-500"
                                >
                                    {label.slice(0, 2)}
                                </div>
                            ))}
                        </div>

                        <div className="mt-1 grid grid-cols-7 gap-1" role="group" aria-label={`${monthLabel} calendar dates`}>
                            {calendarDays.map((day) => {
                                const isStart = day.value === draftFrom;
                                const isEnd = day.value === draftTo;
                                const isInRange = isWithinDraftRange(day.value, draftFrom, draftTo);
                                const isSelected = isStart || isEnd;

                                return (
                                    <button
                                        key={day.value}
                                        type="button"
                                        onClick={() => handleDayClick(day.value)}
                                        aria-label={day.date.toLocaleDateString(undefined, {
                                            month: 'long',
                                            day: 'numeric',
                                            year: 'numeric'
                                        })}
                                        aria-pressed={isSelected}
                                        className={`flex h-7 min-w-0 items-center justify-center rounded-md text-xs transition-colors focus:outline-none focus:ring-1 focus:ring-sage-500/40 ${isSelected
                                                ? 'bg-sage-600 font-semibold text-white shadow-sm shadow-sage-500/20'
                                                : isInRange
                                                    ? 'bg-sage-500/15 text-sage-700 dark:bg-sage-500/15 dark:text-sage-200'
                                                    : day.isCurrentMonth
                                                        ? 'text-gray-700 hover:bg-gray-100 dark:text-zinc-200 dark:hover:bg-white/5'
                                                        : 'text-gray-300 hover:bg-gray-100/60 dark:text-zinc-700 dark:hover:bg-white/5'
                                            } ${day.isToday && !isSelected ? 'ring-1 ring-sage-500/30' : ''}`}
                                    >
                                        {day.date.getDate()}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="mt-3 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={clearCustomRange}
                                className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-200"
                            >
                                Clear
                            </button>
                            <button
                                type="button"
                                onClick={applyCustomRange}
                                className="rounded-md bg-sage-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-sage-500/20 transition-colors hover:bg-sage-700 focus:outline-none focus:ring-1 focus:ring-sage-500/40"
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
