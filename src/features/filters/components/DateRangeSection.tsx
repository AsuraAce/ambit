import * as React from 'react';
import { Calendar, X } from 'lucide-react';
import { FilterState } from '../../../types';
import { DATE_PRESETS, getDateFilterLabel, normalizeDateInputPair } from '../../../utils/dateFilters';

interface DateRangeSectionProps {
    filters: FilterState;
    setFilters: (update: (prev: FilterState) => FilterState) => void;
}

export const DateRangeSection: React.FC<DateRangeSectionProps> = ({
    filters,
    setFilters
}) => {
    const rootRef = React.useRef<HTMLDivElement>(null);
    const [isCustomOpen, setIsCustomOpen] = React.useState(false);
    const [draftFrom, setDraftFrom] = React.useState(filters.dateFrom ?? '');
    const [draftTo, setDraftTo] = React.useState(filters.dateTo ?? '');

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
        setIsCustomOpen(true);
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
                        <div className="grid grid-cols-2 gap-2">
                            <label className="space-y-1">
                                <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                                    From
                                </span>
                                <input
                                    type="date"
                                    value={draftFrom}
                                    onChange={(event) => setDraftFrom(event.target.value)}
                                    aria-label="Filter from date"
                                    className="w-full min-w-0 rounded-lg border border-gray-200 bg-gray-100 px-2 py-2 text-xs text-gray-700 outline-none transition-colors focus:border-sage-500/50 focus:ring-1 focus:ring-sage-500/30 dark:border-white/5 dark:bg-zinc-800/50 dark:text-zinc-200"
                                />
                            </label>
                            <label className="space-y-1">
                                <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                                    To
                                </span>
                                <input
                                    type="date"
                                    value={draftTo}
                                    onChange={(event) => setDraftTo(event.target.value)}
                                    aria-label="Filter to date"
                                    className="w-full min-w-0 rounded-lg border border-gray-200 bg-gray-100 px-2 py-2 text-xs text-gray-700 outline-none transition-colors focus:border-sage-500/50 focus:ring-1 focus:ring-sage-500/30 dark:border-white/5 dark:bg-zinc-800/50 dark:text-zinc-200"
                                />
                            </label>
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
