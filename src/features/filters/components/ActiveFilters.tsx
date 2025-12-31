import * as React from 'react';
import { X, FilterX } from 'lucide-react';
import { FilterState } from '../../../types';
import { useLibraryContext } from '../../../hooks/useLibraryContext';

interface ActiveFiltersProps {
    filters: FilterState;
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    clearAllFilters: () => void;
}

export const ActiveFilters: React.FC<ActiveFiltersProps> = ({
    filters,
    setFilters,
    clearAllFilters
}) => {
    const { collections, smartCollections } = useLibraryContext();
    const allCols = React.useMemo(() => [...collections, ...smartCollections], [collections, smartCollections]);
    const activeSmartCol = filters.collectionId ? allCols.find(sc => sc.id === filters.collectionId) : undefined;

    // Merge visible filters with smart collection implicit filters for display
    const hasActiveFilters =
        filters.dateRange !== 'all' ||
        filters.favoritesOnly ||
        filters.models.length > 0 ||
        filters.tools.length > 0 ||
        filters.loras.length > 0 ||
        filters.searchQuery !== '' ||
        !!activeSmartCol;

    // Deduplicate logic: Filter out manual chips that are already in the smart collection
    const smartModels = activeSmartCol?.filters?.models || [];
    const smartTools = activeSmartCol?.filters?.tools || [];

    const visibleModels = Array.from(new Set(filters.models)).filter(m => !smartModels.includes(m));
    const visibleTools = Array.from(new Set(filters.tools)).filter(t => !smartTools.includes(t));
    const visibleLoras = Array.from(new Set(filters.loras));

    if (!hasActiveFilters) return null;

    return (
        <div className="mt-4 flex items-center gap-2 overflow-x-auto custom-scrollbar px-1 animate-in fade-in slide-in-from-top-2 duration-500">
            <span className="text-xs font-bold text-gray-600 uppercase tracking-wider mr-2 flex-shrink-0">Active Filters:</span>

            {/* Smart Collection Implicit Filters (Locked) */}
            {activeSmartCol && activeSmartCol.filters && (
                <>
                    {activeSmartCol.filters.models?.map(m => (
                        <div key={`smart-model-${m}`} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 text-xs border border-gray-200 dark:border-zinc-700 opacity-80 cursor-not-allowed" title="Smart Collection Rule">
                            <span className="truncate max-w-[100px]">{m}</span>
                            <div className="w-3 h-3 flex items-center justify-center text-[10px]">🔒</div>
                        </div>
                    ))}
                    {activeSmartCol.filters.tools?.map(t => (
                        <div key={`smart-tool-${t}`} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 text-xs border border-gray-200 dark:border-zinc-700 opacity-80 cursor-not-allowed" title="Smart Collection Rule">
                            <span>{t}</span>
                            <div className="w-3 h-3 flex items-center justify-center text-[10px]">🔒</div>
                        </div>
                    ))}
                    {activeSmartCol.filters.searchQuery && (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 text-xs border border-gray-200 dark:border-zinc-700 opacity-80 cursor-not-allowed" title="Smart Collection Rule">
                            <span className="truncate max-w-[150px]">"{activeSmartCol.filters.searchQuery}"</span>
                            <div className="w-3 h-3 flex items-center justify-center text-[10px]">🔒</div>
                        </div>
                    )}
                    {activeSmartCol.filters.dateRange && activeSmartCol.filters.dateRange !== 'all' && (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 text-xs border border-gray-200 dark:border-zinc-700 opacity-80 cursor-not-allowed" title="Smart Collection Rule">
                            <span className="capitalize">{activeSmartCol.filters.dateRange}</span>
                            <div className="w-3 h-3 flex items-center justify-center text-[10px]">🔒</div>
                        </div>
                    )}
                </>
            )}

            {filters.dateRange !== 'all' && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-sage-100 dark:bg-sage-500/20 text-sage-700 dark:text-sage-200 text-xs border border-sage-200">
                    <span>{filters.dateRange}</span>
                    <button onClick={() => setFilters(f => ({ ...f, dateRange: 'all' }))}><X className="w-3 h-3" /></button>
                </div>
            )}

            {filters.favoritesOnly && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs border border-red-200">
                    <div className="w-3 h-3 text-red-500">❤️</div>
                    <span>Favorites</span>
                </div>
            )}

            {visibleModels.map(m => (
                <div key={m} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-200 text-xs border border-blue-200 dark:border-blue-500/30">
                    <span className="truncate max-w-[100px]">{m}</span>
                    <button onClick={() => setFilters(f => ({ ...f, models: f.models.filter(x => x !== m) }))}><X className="w-3 h-3" /></button>
                </div>
            ))}

            {visibleTools.map(t => (
                <div key={t} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-200 text-xs border border-amber-200 dark:border-amber-500/30">
                    <span>{t}</span>
                    <button onClick={() => setFilters(f => ({ ...f, tools: f.tools.filter(x => x !== t) }))}><X className="w-3 h-3" /></button>
                </div>
            ))}

            {visibleLoras.map(l => (
                <div key={l} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-200 text-xs border border-purple-200 dark:border-purple-500/30">
                    <span className="truncate max-w-[100px]">{l}</span>
                    <button onClick={() => setFilters(f => ({ ...f, loras: f.loras.filter(x => x !== l) }))}><X className="w-3 h-3" /></button>
                </div>
            ))}

            <button
                onClick={clearAllFilters}
                className="ml-auto text-xs text-sage-600 hover:text-sage-800 font-medium flex items-center gap-1"
            >
                <FilterX className="w-3 h-3" /> Clear All
            </button>
        </div>
    );
};
