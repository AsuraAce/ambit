import * as React from 'react';
import { LoaderCircle, Search, Sparkles, X } from 'lucide-react';
import { FilterState } from '../../../types';
import { APP_NAME } from '../../../constants/app';
import { useSearch } from '../../../contexts/SearchContext';
import { getAdvancedDateSearchReadiness } from '../../../utils/dateFilters';
import { TooltipButton } from '../../../components/ui/InfoTooltip';
import type { SearchBarOption } from './SearchBarPopover';

const SearchBarPopover = React.lazy(() => import('./SearchBarPopover').then(module => ({ default: module.SearchBarPopover })));

interface SearchBarProps {
    filters: FilterState;
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    searchProps: {
        isAiSearchEnabled: boolean;
        isSearchingAi: boolean;
        inputRef: React.RefObject<HTMLInputElement | null>;
        toggleAiSearch: () => void;
        submitSearch: (query: string) => void;
        isFocused: boolean;
        onFocus: () => void;
        onBlur: () => void;
        onOpenSearchHelp: () => void;
    };
    recentSearches: string[];
    setRecentSearches: React.Dispatch<React.SetStateAction<string[]>>;
    scopeName: string;
    displayedCount: number;
    isFiltering: boolean;
    submitNavigatesToGrid: boolean;
}

export const SearchBar = React.memo(({
    searchProps,
    recentSearches,
    setRecentSearches,
    scopeName,
    displayedCount,
    isFiltering,
    submitNavigatesToGrid,
}: SearchBarProps) => {
    const { filters, setFilters } = useSearch();
    const [localValue, setLocalValue] = React.useState(filters.searchQuery);
    const [activeOptionIndex, setActiveOptionIndex] = React.useState(-1);
    const [areOptionsDismissed, setAreOptionsDismissed] = React.useState(false);
    const [operatorSuggestions, setOperatorSuggestions] = React.useState<readonly { value: string; description: string }[]>([]);
    const listboxId = React.useId();
    const statusId = React.useId();
    const trimmedValue = localValue.trim();
    const dateSearchReadiness = React.useMemo(
        () => getAdvancedDateSearchReadiness(localValue),
        [localValue]
    );
    const dateSearchHint = dateSearchReadiness.isReady
        ? null
        : 'Use ISO dates like date:2026-04 or before:2025';
    const liveSearchEnabled = !searchProps.isAiSearchEnabled && !submitNavigatesToGrid;

    React.useEffect(() => {
        if (!searchProps.isFocused || searchProps.isAiSearchEnabled || operatorSuggestions.length > 0) return;

        let isCurrent = true;
        void import('../../../constants/searchOperators').then(module => {
            if (isCurrent) setOperatorSuggestions(module.SEARCH_OPERATOR_SUGGESTIONS);
        });

        return () => {
            isCurrent = false;
        };
    }, [operatorSuggestions.length, searchProps.isAiSearchEnabled, searchProps.isFocused]);

    const matchingOperators = React.useMemo(() => {
        if (searchProps.isAiSearchEnabled) return [];
        const lastToken = localValue.split(' ').pop()?.toLowerCase() || '';
        if (!lastToken) return [];

        return operatorSuggestions.filter(operator => {
            const normalized = operator.value.toLowerCase();
            return normalized.startsWith(lastToken) && normalized !== lastToken;
        });
    }, [localValue, operatorSuggestions, searchProps.isAiSearchEnabled]);

    const options = React.useMemo<SearchBarOption[]>(() => {
        if (areOptionsDismissed) return [];

        if (matchingOperators.length > 0) {
            return matchingOperators.map((operator, index) => ({
                id: `${listboxId}-option-${index}`,
                kind: 'operator',
                value: operator.value,
                description: operator.description,
            }));
        }

        if (!localValue && recentSearches.length > 0) {
            return recentSearches.map((value, index) => ({
                id: `${listboxId}-option-${index}`,
                kind: 'recent',
                value,
            }));
        }

        return [];
    }, [areOptionsDismissed, listboxId, localValue, matchingOperators, recentSearches]);

    const activeOption = activeOptionIndex >= 0 ? options[activeOptionIndex] : undefined;

    React.useEffect(() => {
        setLocalValue(filters.searchQuery);
        setActiveOptionIndex(-1);
        setAreOptionsDismissed(false);
    }, [filters.searchQuery]);

    React.useEffect(() => {
        if (!liveSearchEnabled) return;
        if (localValue === filters.searchQuery) return;
        if (!dateSearchReadiness.isReady) return;

        const timer = setTimeout(() => {
            setFilters(previous => ({ ...previous, searchQuery: localValue }));
        }, 500);

        return () => clearTimeout(timer);
    }, [dateSearchReadiness.isReady, filters.searchQuery, liveSearchEnabled, localValue, setFilters]);

    const statusMessage = React.useMemo(() => {
        if (dateSearchHint) return null;
        if (searchProps.isSearchingAi) return 'Analyzing with Gemini…';
        if (!trimmedValue) return null;
        if (searchProps.isAiSearchEnabled) return 'Press Enter to analyze and apply filters.';
        if (submitNavigatesToGrid) return 'Press Enter to view matching images in Grid.';
        if (localValue !== filters.searchQuery || isFiltering) return `Searching ${scopeName}…`;
        if (displayedCount === 0) return `No matches in ${scopeName}.`;
        return `${displayedCount.toLocaleString()} ${displayedCount === 1 ? 'match' : 'matches'} in ${scopeName}.`;
    }, [
        dateSearchHint,
        displayedCount,
        filters.searchQuery,
        isFiltering,
        localValue,
        scopeName,
        searchProps.isAiSearchEnabled,
        searchProps.isSearchingAi,
        submitNavigatesToGrid,
        trimmedValue,
    ]);

    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setLocalValue(event.target.value);
        setActiveOptionIndex(-1);
        setAreOptionsDismissed(false);
    };

    const selectOperator = (value: string) => {
        const lastSpace = localValue.lastIndexOf(' ');
        const prefix = lastSpace >= 0 ? localValue.substring(0, lastSpace + 1) : '';
        const nextValue = `${prefix}${value} `;
        setLocalValue(nextValue);
        setActiveOptionIndex(-1);
        setAreOptionsDismissed(true);

        if (liveSearchEnabled && getAdvancedDateSearchReadiness(nextValue).isReady) {
            setFilters(previous => ({ ...previous, searchQuery: nextValue }));
        }
    };

    const selectRecentSearch = (value: string) => {
        setLocalValue(value);
        setActiveOptionIndex(-1);
        setAreOptionsDismissed(true);
        searchProps.submitSearch(value);
    };

    const selectOption = (option: SearchBarOption) => {
        if (option.kind === 'operator') {
            selectOperator(option.value);
        } else {
            selectRecentSearch(option.value);
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Escape' && options.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            setActiveOptionIndex(-1);
            setAreOptionsDismissed(true);
            return;
        }

        if (options.length > 0) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveOptionIndex(previous => (previous + 1) % options.length);
                return;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveOptionIndex(previous => (previous - 1 + options.length) % options.length);
                return;
            }
            if (event.key === 'Enter' && activeOption) {
                event.preventDefault();
                selectOption(activeOption);
                return;
            }
            if (event.key === 'Tab' && activeOption?.kind === 'operator') {
                event.preventDefault();
                selectOperator(activeOption.value);
                return;
            }
        }

        if (event.key === 'Enter') {
            if (!dateSearchReadiness.isReady || searchProps.isSearchingAi) {
                event.preventDefault();
                return;
            }
            searchProps.submitSearch(localValue);
        }
    };

    const clearSearch = () => {
        setLocalValue('');
        setFilters(previous => ({ ...previous, searchQuery: '' }));
        setActiveOptionIndex(-1);
        setAreOptionsDismissed(false);
        searchProps.inputRef.current?.focus();
    };

    const clearRecentSearches = () => {
        setRecentSearches([]);
        setActiveOptionIndex(-1);
        searchProps.inputRef.current?.focus();
    };

    const handleFocusCapture = (event: React.FocusEvent<HTMLDivElement>) => {
        const previousTarget = event.relatedTarget as Node | null;
        if (!previousTarget || !event.currentTarget.contains(previousTarget)) {
            setAreOptionsDismissed(false);
            searchProps.onFocus();
        }
    };

    const handleBlurCapture = (event: React.FocusEvent<HTMLDivElement>) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
            searchProps.onBlur();
        }
    };

    const listLabel = options[0]?.kind === 'recent' ? 'Recent searches' : 'Search operator suggestions';
    const accessibleName = searchProps.isAiSearchEnabled
        ? `Ask ${APP_NAME} with AI`
        : `Search in ${scopeName}`;

    return (
        <div
            className={`relative w-full max-w-lg group flex items-center gap-2 transition-all duration-300 ${searchProps.isFocused ? 'z-[70] scale-105' : 'z-30'}`}
            onFocusCapture={handleFocusCapture}
            onBlurCapture={handleBlurCapture}
        >
            <div className="relative flex-1">
                {searchProps.isSearchingAi ? (
                    <LoaderCircle aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amethyst-600 dark:text-amethyst-400 animate-spin" />
                ) : (
                    <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors text-gray-400 dark:text-zinc-500 group-focus-within:text-sage-600 dark:group-focus-within:text-sage-400" />
                )}
                <input
                    ref={searchProps.inputRef}
                    type="text"
                    role="combobox"
                    aria-label={accessibleName}
                    aria-autocomplete="list"
                    aria-expanded={searchProps.isFocused && options.length > 0}
                    aria-controls={searchProps.isFocused && options.length > 0 ? listboxId : undefined}
                    aria-activedescendant={searchProps.isFocused ? activeOption?.id : undefined}
                    aria-describedby={searchProps.isFocused && (dateSearchHint || statusMessage) ? statusId : undefined}
                    aria-busy={searchProps.isSearchingAi}
                    readOnly={searchProps.isSearchingAi}
                    placeholder={searchProps.isAiSearchEnabled ? `Ask ${APP_NAME}...` : `Search in ${scopeName}...`}
                    className={`w-full bg-gray-100 dark:bg-zinc-800/50 border rounded-xl py-2 pl-10 pr-10 text-sm focus:outline-none transition-all text-gray-900 dark:text-gray-100 placeholder-gray-500 ${searchProps.isAiSearchEnabled ? 'border-amethyst-300 dark:border-amethyst-800 focus:border-amethyst-500/50 focus:ring-1 focus:ring-amethyst-500/30' : 'border-gray-200 dark:border-white/10 focus:border-sage-500/50 focus:ring-1 focus:ring-sage-500/30'}`}
                    value={localValue}
                    onChange={handleSearchChange}
                    onKeyDown={handleKeyDown}
                    autoComplete="off"
                />
                {localValue && !searchProps.isSearchingAi ? (
                    <button
                        type="button"
                        aria-label="Clear Search"
                        onClick={clearSearch}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-900 dark:text-zinc-500 dark:hover:text-white"
                    >
                        <X aria-hidden="true" className="w-3.5 h-3.5" />
                    </button>
                ) : null}

                {searchProps.isFocused ? (
                    <React.Suspense fallback={null}>
                        <SearchBarPopover
                            activeOptionIndex={activeOptionIndex}
                            dateSearchHint={dateSearchHint}
                            listboxId={listboxId}
                            listLabel={listLabel}
                            options={options}
                            statusId={statusId}
                            statusMessage={statusMessage}
                            onClearRecentSearches={clearRecentSearches}
                            onOpenSearchHelp={searchProps.onOpenSearchHelp}
                            onSelectOption={selectOption}
                        />
                    </React.Suspense>
                ) : null}
            </div>
            <TooltipButton
                label={searchProps.isAiSearchEnabled ? 'Disable AI Search' : 'Enable AI Search'}
                content={searchProps.isAiSearchEnabled ? 'Return to standard library search.' : 'Use natural-language AI search.'}
                aria-pressed={searchProps.isAiSearchEnabled}
                disabled={searchProps.isSearchingAi}
                onClick={searchProps.toggleAiSearch}
                className={`p-2 rounded-xl transition-all border disabled:cursor-wait disabled:opacity-60 ${searchProps.isAiSearchEnabled ? 'bg-amethyst-100 dark:bg-amethyst-600/20 border-amethyst-500/50 text-amethyst-600 dark:text-amethyst-300 shadow-[0_0_15px_rgba(139,92,246,0.2)]' : 'bg-gray-100 dark:bg-zinc-800/50 border-gray-200 dark:border-white/10 text-gray-500 dark:text-zinc-500 hover:text-sage-600 dark:hover:text-sage-400 hover:border-gray-300 dark:hover:border-white/10'}`}
            >
                <Sparkles aria-hidden="true" className="w-4 h-4" />
            </TooltipButton>
        </div>
    );
});
