import * as React from 'react';
import { Search, X, Sparkles, History } from 'lucide-react';
import { FilterState } from '../../../types';

interface SearchBarProps {
    filters: FilterState;
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    searchProps: {
        isAiSearchEnabled: boolean;
        isSearchingAi: boolean;
        inputRef: React.RefObject<HTMLInputElement>;
        toggleAiSearch: () => void;
        submitSearch: (query: string) => void;
        isFocused: boolean;
        onFocus: () => void;
        onBlur: () => void;
    };
    recentSearches: string[];
    setRecentSearches: React.Dispatch<React.SetStateAction<string[]>>;
}

export const SearchBar = React.memo(({
    filters,
    setFilters,
    searchProps,
    recentSearches,
    setRecentSearches
}: SearchBarProps) => {
    // 1. ISOLATED STATE: Typing here will NOT re-render the parent (App.tsx)
    const [localValue, setLocalValue] = React.useState(filters.searchQuery);
    const [suggestions, setSuggestions] = React.useState<string[]>([]);
    const [activeSuggestionIndex, setActiveSuggestionIndex] = React.useState(-1);

    // 2. EXTERNAL SYNC: If filters.searchQuery changes from outside (e.g. clear button), update local
    React.useEffect(() => {
        if (filters.searchQuery !== localValue) {
            setLocalValue(filters.searchQuery);
        }
    }, [filters.searchQuery]);

    // 3. DEBOUNCED GLOBAL SYNC: Only update parent app after typing stops
    React.useEffect(() => {
        if (localValue === filters.searchQuery) return;

        const timer = setTimeout(() => {
            setFilters(f => ({ ...f, searchQuery: localValue }));
        }, 500); // 500ms for safety on large libraries

        return () => clearTimeout(timer);
    }, [localValue, filters.searchQuery, setFilters]);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setLocalValue(val);
        setActiveSuggestionIndex(-1);

        // Suggestions logic (isolated)
        const lastToken = val.split(' ').pop()?.toLowerCase() || '';
        if (lastToken.length >= 1) {
            const operators = ['model:', 'tool:', 'steps:', 'cfg:', 'seed:', 'neg:', 'sampler:', 'lora:', 'w:', 'h:', 'upscaled:'];
            const opMatches = operators.filter(op => op.startsWith(lastToken) && op !== lastToken);
            // In a real app we'd get tags from props, but for now we'll stick to operators to avoid excessive re-renders
            setSuggestions(opMatches);
        } else {
            setSuggestions([]);
        }
    };

    const selectSuggestion = (index: number) => {
        if (index < 0 || index >= suggestions.length) return;
        const s = suggestions[index];
        const lastSpace = localValue.lastIndexOf(' ');
        const prefix = lastSpace >= 0 ? localValue.substring(0, lastSpace + 1) : '';
        const newVal = prefix + s + ' ';
        setLocalValue(newVal);
        setSuggestions([]);
        // Immediate sync on selection
        setFilters(f => ({ ...f, searchQuery: newVal }));
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (suggestions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveSuggestionIndex(prev => (prev + 1) % suggestions.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                if (activeSuggestionIndex >= 0) {
                    e.preventDefault();
                    selectSuggestion(activeSuggestionIndex);
                    return;
                }
            }
        }

        if (e.key === 'Enter') {
            // Immediate sync and submit
            setFilters(f => ({ ...f, searchQuery: localValue }));
            searchProps.submitSearch(localValue);
        }
    };

    const clearSearch = () => {
        setLocalValue('');
        setFilters(f => ({ ...f, searchQuery: '' }));
        setSuggestions([]);
        setActiveSuggestionIndex(-1);
        searchProps.inputRef.current?.focus();
    };

    return (
        <div className={`relative w-full max-w-lg group flex items-center gap-2 transition-all duration-300 ${searchProps.isFocused ? 'z-[70] scale-105' : 'z-30'}`}>
            <div className="relative flex-1">
                <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${searchProps.isSearchingAi ? 'text-amethyst-600 dark:text-amethyst-400 animate-pulse' : 'text-gray-400 dark:text-zinc-500 group-focus-within:text-sage-600 dark:group-focus-within:text-sage-400'}`} />
                <input
                    ref={searchProps.inputRef}
                    type="text"
                    placeholder={searchProps.isAiSearchEnabled ? "Ask Ambit..." : "Search prompts..."}
                    className={`w-full bg-gray-100 dark:bg-zinc-800/50 border rounded-xl py-2 pl-10 pr-10 text-sm focus:outline-none transition-all text-gray-900 dark:text-gray-100 placeholder-gray-500 ${searchProps.isAiSearchEnabled ? 'border-amethyst-300 dark:border-amethyst-800 focus:border-amethyst-500/50 focus:ring-1 focus:ring-amethyst-500/30' : 'border-gray-200 dark:border-white/10 focus:border-sage-500/50 focus:ring-1 focus:ring-sage-500/30'}`}
                    value={localValue}
                    onChange={handleSearchChange}
                    onFocus={searchProps.onFocus}
                    onBlur={searchProps.onBlur}
                    onKeyDown={handleKeyDown}
                    autoComplete="off"
                />
                {localValue && (
                    <button
                        onClick={clearSearch}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-900 dark:text-zinc-500 dark:hover:text-white"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}

                {searchProps.isFocused && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                        {suggestions.length > 0 && (
                            <div className="py-2">
                                <div className="px-4 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Suggestions</div>
                                {suggestions.map((s, idx) => (
                                    <button
                                        key={s}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            selectSuggestion(idx);
                                        }}
                                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${activeSuggestionIndex === idx ? 'bg-sage-100 dark:bg-sage-900/40 text-sage-900 dark:text-sage-100' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'}`}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        )}
                        {!localValue && recentSearches.length > 0 && (
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
                                            setTimeout(() => searchProps.submitSearch(s), 0);
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
                className={`p-2 rounded-xl transition-all border ${searchProps.isAiSearchEnabled ? 'bg-amethyst-100 dark:bg-amethyst-600/20 border-amethyst-500/50 text-amethyst-600 dark:text-amethyst-300 shadow-[0_0_15px_rgba(139,92,246,0.2)]' : 'bg-gray-100 dark:bg-zinc-800/50 border-gray-200 dark:border-white/10 text-gray-500 dark:text-zinc-500 hover:text-sage-600 dark:hover:text-sage-400 hover:border-gray-300 dark:hover:border-white/10'}`}
                title={searchProps.isAiSearchEnabled ? "Disable AI Search" : "Enable AI Search"}
            >
                <Sparkles className="w-4 h-4" />
            </button>
        </div>
    );
});
