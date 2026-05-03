import * as React from 'react';
import { Calendar } from 'lucide-react';
import { FilterState } from '../../../types';
import { DATE_PRESETS, normalizeDateInputPair } from '../../../utils/dateFilters';

interface DateRangeSectionProps {
    filters: FilterState;
    setFilters: (update: (prev: FilterState) => FilterState) => void;
}

export const DateRangeSection: React.FC<DateRangeSectionProps> = ({
    filters,
    setFilters
}) => {
    const handlePresetClick = (range: FilterState['dateRange']) => {
        if (filters.dateRange !== range || filters.dateFrom || filters.dateTo) {
            setFilters(prev => ({
                ...prev,
                dateRange: range,
                dateFrom: undefined,
                dateTo: undefined
            }));
        }
    };

    const handleCustomDateChange = (field: 'dateFrom' | 'dateTo', value: string) => {
        setFilters(prev => {
            const nextRaw = {
                dateFrom: field === 'dateFrom' ? value || undefined : prev.dateFrom,
                dateTo: field === 'dateTo' ? value || undefined : prev.dateTo
            };
            const normalized = normalizeDateInputPair(nextRaw.dateFrom, nextRaw.dateTo);

            return {
                ...prev,
                dateRange: normalized.dateFrom || normalized.dateTo ? 'custom' : 'all',
                ...normalized
            };
        });
    };

    return (
        <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-white/10">
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
            <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                        From
                    </span>
                    <input
                        type="date"
                        value={filters.dateFrom ?? ''}
                        max={filters.dateTo}
                        onChange={(event) => handleCustomDateChange('dateFrom', event.target.value)}
                        aria-label="Filter from date"
                        className="w-full min-w-0 rounded-lg border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-zinc-800/50 px-2 py-2 text-xs text-gray-700 dark:text-zinc-200 outline-none transition-colors focus:border-sage-500/50 focus:ring-1 focus:ring-sage-500/30"
                    />
                </label>
                <label className="space-y-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                        To
                    </span>
                    <input
                        type="date"
                        value={filters.dateTo ?? ''}
                        min={filters.dateFrom}
                        onChange={(event) => handleCustomDateChange('dateTo', event.target.value)}
                        aria-label="Filter to date"
                        className="w-full min-w-0 rounded-lg border border-gray-200 dark:border-white/5 bg-gray-100 dark:bg-zinc-800/50 px-2 py-2 text-xs text-gray-700 dark:text-zinc-200 outline-none transition-colors focus:border-sage-500/50 focus:ring-1 focus:ring-sage-500/30"
                    />
                </label>
            </div>
        </div>
    );
};
