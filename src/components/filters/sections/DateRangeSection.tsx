import * as React from 'react';
import { Calendar } from 'lucide-react';
import { FilterState } from '../../../types';

interface DateRangeSectionProps {
    filters: FilterState;
    setFilters: (update: (prev: FilterState) => FilterState) => void;
}

export const DateRangeSection: React.FC<DateRangeSectionProps> = ({
    filters,
    setFilters
}) => {
    return (
        <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-white/10">
            <h3 className="flex items-center gap-2 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                <Calendar className="w-3 h-3" /> Date Range
            </h3>
            <div className="grid grid-cols-2 gap-2">
                {(['all', 'today', 'week', 'month'] as const).map((range) => (
                    <button
                        key={range}
                        onClick={() => {
                            if (filters.dateRange !== range) {
                                setFilters(prev => ({ ...prev, dateRange: range }));
                            }
                        }}
                        className={`px-3 py-2 text-xs rounded-lg capitalize transition-all ease-spring duration-300 border ${filters.dateRange === range
                                ? 'bg-sage-600 text-white border-sage-500 shadow-lg shadow-sage-500/20'
                                : 'bg-gray-100 dark:bg-zinc-800/50 text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10'
                            }`}
                    >
                        {range}
                    </button>
                ))}
            </div>
        </div>
    );
};
