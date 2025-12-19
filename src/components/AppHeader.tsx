import * as React from 'react';
import { useState } from 'react';
import { Search, X, Sparkles, Import, LayoutGrid, Columns, AlignJustify, Play, ArrowUpDown, Check, Sliders, Folder, FilterX, History } from 'lucide-react';
import { FilterState, LayoutMode, SortOption, ViewMode } from '../types';
import { useLibraryContext } from '../hooks/useLibraryContext';

interface AppHeaderProps {
    viewMode: ViewMode;
    filters: FilterState;
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    searchProps: {
        isAiSearchEnabled: boolean;
        isSearchingAi: boolean;
        inputRef: React.RefObject<HTMLInputElement>;
        toggleAiSearch: () => void;
        handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
        submitSearch: () => void;
        suggestions: string[];
    };
    layoutMode: LayoutMode;
    setLayoutMode: (mode: LayoutMode) => void;
    sortOption: SortOption;
    setSortOption: (opt: SortOption) => void;
    displayedCount: number;
    totalCount: number;
    onImport: () => void;
    onSlideshow: () => void;
    clearAllFilters: () => void;
    isImporting: boolean;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
    viewMode,
    filters,
    setFilters,
    searchProps,
    layoutMode,
    setLayoutMode,
    sortOption,
    setSortOption,
    displayedCount,
    totalCount,
    onImport,
    onSlideshow,
    clearAllFilters,
    isImporting
}) => {
    const { settings, setSettings, collections, recentSearches, loadMoreImages, hasMoreImages } = useLibraryContext();
    const [showSortMenu, setShowSortMenu] = useState(false);
    const [isSearchFocused, setIsSearchFocused] = useState(false);

    const activeCollection = collections.find(c => c.id === filters.collectionId);

    // Determine visibility of middle controls
    const showLayoutSwitcher = viewMode === 'grid';
    const showSlideshowButton = viewMode === 'grid' || viewMode === 'timeline';
    const showMiddleSection = showLayoutSwitcher || showSlideshowButton;

    return (
        <header className="flex-shrink-0 pl-6 pr-8 pb-4 sticky top-0 z-50 transition-colors duration-200">
            <div className="h-16 flex items-center justify-between px-6 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-2xl shadow-lg animate-in slide-in-from-top-4 duration-500 ease-spring">
                <div className="flex items-center gap-4 flex-1 max-w-3xl">
                    <div className="relative w-full max-w-2xl group z-30 flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${searchProps.isSearchingAi ? 'text-amethyst-600 dark:text-amethyst-400 animate-pulse' : 'text-gray-400 dark:text-zinc-500 group-focus-within:text-sage-600 dark:group-focus-within:text-sage-400'}`} />
                            <input
                                ref={searchProps.inputRef}
                                type="text"
                                placeholder={searchProps.isAiSearchEnabled ? "Ask Ambit (e.g. 'Show me cyberpunk cities')" : "Search prompts..."}
                                className={`w-full bg-gray-100 dark:bg-zinc-800/50 border rounded-xl py-2 pl-10 pr-10 text-sm focus:outline-none transition-all text-gray-900 dark:text-gray-100 placeholder-gray-500 ${searchProps.isAiSearchEnabled ? 'border-amethyst-300 dark:border-amethyst-800 focus:border-amethyst-500/50 focus:ring-1 focus:ring-amethyst-500/30' : 'border-gray-200 dark:border-white/10 focus:border-sage-500/50 focus:ring-1 focus:ring-sage-500/30'}`}
                                value={filters.searchQuery}
                                onChange={searchProps.handleSearchChange}
                                onFocus={() => setIsSearchFocused(true)}
                                onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                                onKeyDown={(e) => { if (e.key === 'Enter') searchProps.submitSearch(); }}
                                autoComplete="off"
                            />
                            {filters.searchQuery && <button onClick={() => { setFilters(p => ({ ...p, searchQuery: '' })); searchProps.inputRef.current?.focus(); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-900 dark:text-zinc-500 dark:hover:text-white"><X className="w-3.5 h-3.5" /></button>}

                            {/* Search Dropdown: Suggestions & History */}
                            {isSearchFocused && (
                                <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                                    {searchProps.suggestions.length > 0 && (
                                        <div className="py-2">
                                            <div className="px-4 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Suggestions</div>
                                            {searchProps.suggestions.map(s => (
                                                <button
                                                    key={s}
                                                    onMouseDown={(e) => {
                                                        e.preventDefault();
                                                        // Append suggestion to current query if it ends in space, else replace last token
                                                        const current = filters.searchQuery;
                                                        const lastSpace = current.lastIndexOf(' ');
                                                        const prefix = lastSpace >= 0 ? current.substring(0, lastSpace + 1) : '';
                                                        setFilters(f => ({ ...f, searchQuery: prefix + s + ' ' }));
                                                        searchProps.inputRef.current?.focus();
                                                    }}
                                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
                                                >
                                                    {s}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {!filters.searchQuery && recentSearches.length > 0 && (
                                        <div className="py-2 border-t border-gray-100 dark:border-white/5 first:border-0">
                                            <div className="px-4 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Recent</div>
                                            {recentSearches.map(s => (
                                                <button
                                                    key={s}
                                                    onMouseDown={(e) => {
                                                        e.preventDefault();
                                                        setFilters(f => ({ ...f, searchQuery: s }));
                                                        // Defer submission slightly to ensure state update
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
                        <button onClick={searchProps.toggleAiSearch} className={`p-2 rounded-xl transition-all border ${searchProps.isAiSearchEnabled ? 'bg-amethyst-100 dark:bg-amethyst-600/20 border-amethyst-500/50 text-amethyst-600 dark:text-amethyst-300 shadow-[0_0_15px_rgba(139,92,246,0.2)]' : 'bg-gray-100 dark:bg-zinc-800/50 border-gray-200 dark:border-white/5 text-gray-500 dark:text-zinc-500 hover:text-sage-600 dark:hover:text-sage-400 hover:border-gray-300 dark:hover:border-white/10'}`} title={searchProps.isAiSearchEnabled ? "Disable AI Search" : "Enable AI Search"}><Sparkles className="w-4 h-4" /></button>
                    </div>

                    <button onClick={onImport} className={`p-2 rounded-xl transition-all border relative group ${isImporting ? 'animate-pulse text-sage-600 bg-sage-500/20' : 'bg-gray-100 dark:bg-zinc-800/50 border-gray-200 dark:border-white/10 text-gray-500 hover:text-gray-900 dark:hover:text-white'}`} title="Import Images"><Import className="w-4 h-4" /></button>

                    <div className="h-6 w-px bg-gray-300 dark:bg-white/10 mx-2" />

                    {showLayoutSwitcher && (
                        <div className="flex bg-gray-100 dark:bg-zinc-800/50 rounded-xl p-1 border border-gray-200 dark:border-white/5">
                            <button onClick={() => setLayoutMode('grid')} className={`p-1.5 rounded-lg transition-all ${layoutMode === 'grid' ? 'bg-white dark:bg-white/10 text-sage-600 dark:text-sage-300 shadow-sm' : 'text-gray-400'}`} title="Grid Layout"><LayoutGrid className="w-4 h-4" /></button>
                            <button onClick={() => setLayoutMode('masonry')} className={`p-1.5 rounded-lg transition-all ${layoutMode === 'masonry' ? 'bg-white dark:bg-white/10 text-sage-600 dark:text-sage-300 shadow-sm' : 'text-gray-400'}`} title="Masonry Layout"><Columns className="w-4 h-4" /></button>
                            <button onClick={() => setLayoutMode('justified')} className={`p-1.5 rounded-lg transition-all ${layoutMode === 'justified' ? 'bg-white dark:bg-white/10 text-sage-600 dark:text-sage-300 shadow-sm' : 'text-gray-400'}`} title="Justified Layout"><AlignJustify className="w-4 h-4" /></button>
                        </div>
                    )}

                    {showSlideshowButton && (
                        <button onClick={onSlideshow} className="p-2 rounded-xl bg-gray-100 dark:bg-zinc-800/50 border border-gray-200 dark:border-white/5 text-gray-500 hover:text-sage-600 transition-colors" title="Play Slideshow">
                            <Play className="w-4 h-4 fill-current" />
                        </button>
                    )}

                    {/* Second Separator: Only show if middle section controls are present to avoid double lines */}
                    {showMiddleSection && <div className="h-6 w-px bg-gray-300 dark:bg-white/10 mx-2" />}

                    <div className="relative">
                        <button onClick={() => setShowSortMenu(!showSortMenu)} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-zinc-800/50 rounded-xl border border-gray-200 dark:border-white/5"><ArrowUpDown className="w-3 h-3 text-gray-500" /><span className="text-xs font-medium text-gray-700 dark:text-gray-300">{sortOption === 'date_desc' ? 'Newest' : 'Sort'}</span></button>
                        {showSortMenu && (
                            <div className="absolute top-full right-0 mt-2 w-40 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden" onClick={() => setShowSortMenu(false)}>
                                {[{ val: 'date_desc', label: 'Newest' }, { val: 'date_asc', label: 'Oldest' }, { val: 'name_asc', label: 'Name (A-Z)' }].map(opt => <button key={opt.val} onClick={() => setSortOption(opt.val as SortOption)} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300 flex justify-between">{opt.label} {sortOption === opt.val && <Check className="w-3 h-3" />}</button>)}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2 text-gray-500 ml-2"><Sliders className="w-3 h-3" /><input type="range" min="100" max="400" value={settings.thumbnailSize} onChange={(e) => setSettings(p => ({ ...p, thumbnailSize: Number(e.target.value) }))} className="w-20 h-1 bg-gray-300 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sage-500" /></div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-xs font-medium text-gray-500">{totalCount.toLocaleString()} {totalCount === 1 ? 'Image' : 'Images'}</div>
                    {activeCollection && <div className="flex items-center gap-2 px-4 py-1 bg-sage-100 dark:bg-sage-500/20 border border-sage-200 dark:border-sage-500/30 rounded-full text-sage-700 dark:text-sage-300 text-sm"><Folder className="w-3 h-3" />{activeCollection.name}<button onClick={() => setFilters(p => ({ ...p, collectionId: null }))}><X className="w-3 h-3" /></button></div>}
                </div>
            </div>
            {(filters.dateRange !== 'all' || filters.favoritesOnly || filters.models.length > 0 || filters.tools.length > 0 || filters.searchQuery !== '') && (
                <div className="mt-4 flex items-center gap-2 overflow-x-auto custom-scrollbar px-1 animate-in fade-in slide-in-from-top-2 duration-500">
                    <span className="text-xs font-bold text-gray-600 uppercase tracking-wider mr-2 flex-shrink-0">Active Filters:</span>
                    {filters.dateRange !== 'all' && <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-sage-100 dark:bg-sage-500/20 text-sage-700 dark:text-sage-200 text-xs border border-sage-200"><span>{filters.dateRange}</span><button onClick={() => setFilters(f => ({ ...f, dateRange: 'all' }))}><X className="w-3 h-3" /></button></div>}
                    {filters.favoritesOnly && <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs border border-red-200"><div className="w-3 h-3 text-red-500">❤️</div><span>Favorites</span></div>}
                    <button onClick={clearAllFilters} className="ml-auto text-xs text-sage-600 hover:text-sage-800 font-medium flex items-center gap-1"><FilterX className="w-3 h-3" /> Clear All</button>
                </div>
            )}
        </header>
    );
};