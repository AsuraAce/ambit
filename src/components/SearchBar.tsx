import * as React from 'react';
import { Search, X, Sparkles, History } from 'lucide-react';
import { FilterState } from '../types';

interface SearchBarProps {
    filters: FilterState;
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    searchProps: {
        isAiSearchEnabled: boolean;
        isSearchingAi: boolean;
        inputRef: React.RefObject<HTMLInputElement>;
        toggleAiSearch: () => void;
        handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
        handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
        submitSearch: () => void;
        suggestions: string[];
        activeSuggestionIndex: number;
        selectSuggestion: (index: number) => void;
        clearSearch: () => void;
        isFocused: boolean;
        onFocus: () => void;
        onBlur: () => void;
    };
    recentSearches: string[];
    setRecentSearches: React.Dispatch<React.SetStateAction<string[]>>;
}

export const SearchBar: React.FC<SearchBarProps> = ({
    filters,
    setFilters,
    searchProps,
    recentSearches,
    setRecentSearches
}) => {
    return (
        <div className={`relative w-full max-w-lg group flex items-center gap-2 transition-all duration-300 ${searchProps.isFocused ? 'z-[70] scale-105' : 'z-30'}`}>
            <div className="relative flex-1">
                <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${searchProps.isSearchingAi ? 'text-amethyst-600 dark:text-amethyst-400 animate-pulse' : 'text-gray-400 dark:text-zinc-500 group-focus-within:text-sage-600 dark:group-focus-within:text-sage-400'}`} />
                <input
                    ref={searchProps.inputRef}
                    type="text"
                    placeholder={searchProps.isAiSearchEnabled ? "Ask Ambit..." : "Search prompts..."}
                    className={`w-full bg-gray-100 dark:bg-zinc-800/50 border rounded-xl py-2 pl-10 pr-10 text-sm focus:outline-none transition-all text-gray-900 dark:text-gray-100 placeholder-gray-500 ${searchProps.isAiSearchEnabled ? 'border-amethyst-300 dark:border-amethyst-800 focus:border-amethyst-500/50 focus:ring-1 focus:ring-amethyst-500/30' : 'border-gray-200 dark:border-white/10 focus:border-sage-500/50 focus:ring-1 focus:ring-sage-500/30'}`}
                    value={filters.searchQuery}
                    onChange={searchProps.handleSearchChange}
                    onFocus={searchProps.onFocus}
                    onBlur={searchProps.onBlur}
                    onKeyDown={searchProps.handleKeyDown}
                    autoComplete="off"
                />
                {filters.searchQuery && (
                    <button
                        onClick={searchProps.clearSearch}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-900 dark:text-zinc-500 dark:hover:text-white"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}

                {searchProps.isFocused && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                        {searchProps.suggestions.length > 0 && (
                            <div className="py-2">
                                <div className="px-4 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Suggestions</div>
                                {searchProps.suggestions.map((s, idx) => (
                                    <button
                                        key={s}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            searchProps.selectSuggestion(idx);
                                        }}
                                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${searchProps.activeSuggestionIndex === idx ? 'bg-sage-100 dark:bg-sage-900/40 text-sage-900 dark:text-sage-100' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'}`}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        )}
                        {!filters.searchQuery && recentSearches.length > 0 && (
                            <div className="py-2 border-t border-gray-100 dark:border-white/5 first:border-0">
                                <div className="px-4 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider flex justify-between items-center">
                                    <span>Recent Searches</span>
                                    <button
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            setRecentSearches([]);
                                        }}
                                        className="hover:text-red-500 transition-colors uppercase"
                                    >
                                        Clear
                                    </button>
                                </div>
                                {recentSearches.map(s => (
                                    <button
                                        key={s}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            setFilters(f => ({ ...f, searchQuery: s }));
                                            setTimeout(() => searchProps.submitSearch(), 0);
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors flex items-center gap-2"
                                    >
                                        <History className="w-3 h-3 text-gray-400" /> {s}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
            <button
                onClick={searchProps.toggleAiSearch}
                className={`p-2 rounded-xl transition-all border ${searchProps.isAiSearchEnabled ? 'bg-amethyst-100 dark:bg-amethyst-600/20 border-amethyst-500/50 text-amethyst-600 dark:text-amethyst-300 shadow-[0_0_15px_rgba(139,92,246,0.2)]' : 'bg-gray-100 dark:bg-zinc-800/50 border-gray-200 dark:border-white/5 text-gray-500 dark:text-zinc-500 hover:text-sage-600 dark:hover:text-sage-400 hover:border-gray-300 dark:hover:border-white/10'}`}
                title={searchProps.isAiSearchEnabled ? "Disable AI Search" : "Enable AI Search"}
            >
                <Sparkles className="w-4 h-4" />
            </button>
        </div>
    );
};
