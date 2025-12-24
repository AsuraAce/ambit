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
        handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
        submitSearch: () => void;
        suggestions: string[];
        activeSuggestionIndex: number;
        selectSuggestion: (index: number) => void;
        clearSearch: () => void;
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
    const { settings, setSettings, collections, recentSearches, loadMoreImages, hasMoreImages, isLiveWatching, setIsLiveWatching } = useLibraryContext();
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
                <div className="flex items-center gap-4 flex-1">
                    <div className="relative w-full max-w-lg group z-30 flex items-center gap-2">
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
                                onKeyDown={searchProps.handleKeyDown}
                                autoComplete="off"
                            />
                            {filters.searchQuery && <button onClick={searchProps.clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-900 dark:text-zinc-500 dark:hover:text-white"><X className="w-3.5 h-3.5" /></button>}

                            {/* Search Dropdown: Suggestions & History */}
                            {isSearchFocused && (
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

                    <div className="flex items-center gap-1">
                        <button onClick={onImport} className={`p-2 rounded-xl transition-all border relative group ${isImporting ? 'animate-pulse text-sage-600 bg-sage-500/20' : 'bg-gray-100 dark:bg-zinc-800/50 border-gray-200 dark:border-white/10 text-gray-500 hover:text-gray-900 dark:hover:text-white'}`} title="Import Images"><Import className="w-4 h-4" /></button>
                        <button
                            onClick={() => setIsLiveWatching(!isLiveWatching)}
                            className={`p-2 rounded-xl transition-all border relative group ${isLiveWatching ? 'bg-red-500 text-white border-red-600 shadow-md shadow-red-500/20 animate-pulse' : 'bg-gray-100 dark:bg-zinc-800/50 border-gray-200 dark:border-white/10 text-gray-400 hover:text-red-500'}`}
                            title={isLiveWatching ? "Live Watch Active" : "Enable Live Watch"}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                        </button>
                    </div>

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
                        <button onClick={() => setShowSortMenu(!showSortMenu)} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-zinc-800/50 rounded-xl border border-gray-200 dark:border-white/5 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
                            <ArrowUpDown className="w-3 h-3 text-gray-500" />
                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                {{
                                    'date_desc': 'Newest',
                                    'date_asc': 'Oldest',
                                    'name_asc': 'Name (A-Z)',
                                    'name_desc': 'Name (Z-A)',
                                    'size_desc': 'Largest (Size)',
                                    'size_asc': 'Smallest (Size)'
                                }[sortOption] || 'Sort'}
                            </span>
                        </button>
                        {showSortMenu && (
                            <div className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200" onClick={() => setShowSortMenu(false)}>
                                {[
                                    { val: 'date_desc', label: 'Newest' },
                                    { val: 'date_asc', label: 'Oldest' },
                                    { val: 'name_asc', label: 'Name (A-Z)' },
                                    { val: 'name_desc', label: 'Name (Z-A)' },
                                    { val: 'size_desc', label: 'Largest (Size)' },
                                    { val: 'size_asc', label: 'Smallest (Size)' }
                                ].map(opt => (
                                    <button
                                        key={opt.val}
                                        onClick={() => setSortOption(opt.val as SortOption)}
                                        className={`w-full text-left px-3 py-2 text-xs transition-colors flex justify-between items-center ${sortOption === opt.val ? 'bg-sage-50 text-sage-600 dark:bg-sage-900/40 dark:text-sage-300' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'}`}
                                    >
                                        {opt.label}
                                        {sortOption === opt.val && <Check className="w-3 h-3" />}
                                    </button>
                                ))}
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
            {(filters.dateRange !== 'all' || filters.favoritesOnly || filters.models.length > 0 || filters.tools.length > 0 || filters.loras.length > 0 || filters.searchQuery !== '') && (
                <div className="mt-4 flex items-center gap-2 overflow-x-auto custom-scrollbar px-1 animate-in fade-in slide-in-from-top-2 duration-500">
                    <span className="text-xs font-bold text-gray-600 uppercase tracking-wider mr-2 flex-shrink-0">Active Filters:</span>
                    {filters.dateRange !== 'all' && <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-sage-100 dark:bg-sage-500/20 text-sage-700 dark:text-sage-200 text-xs border border-sage-200"><span>{filters.dateRange}</span><button onClick={() => setFilters(f => ({ ...f, dateRange: 'all' }))}><X className="w-3 h-3" /></button></div>}
                    {filters.favoritesOnly && <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs border border-red-200"><div className="w-3 h-3 text-red-500">❤️</div><span>Favorites</span></div>}

                    {filters.models.map(m => (
                        <div key={m} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-200 text-xs border border-blue-200 dark:border-blue-500/30">
                            <span className="truncate max-w-[100px]">{m}</span>
                            <button onClick={() => setFilters(f => ({ ...f, models: f.models.filter(x => x !== m) }))}><X className="w-3 h-3" /></button>
                        </div>
                    ))}
                    {filters.tools.map(t => (
                        <div key={t} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-200 text-xs border border-amber-200 dark:border-amber-500/30">
                            <span>{t}</span>
                            <button onClick={() => setFilters(f => ({ ...f, tools: f.tools.filter(x => x !== t) }))}><X className="w-3 h-3" /></button>
                        </div>
                    ))}
                    {filters.loras.map(l => (
                        <div key={l} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-200 text-xs border border-purple-200 dark:border-purple-500/30">
                            <span className="truncate max-w-[100px]">{l}</span>
                            <button onClick={() => setFilters(f => ({ ...f, loras: f.loras.filter(x => x !== l) }))}><X className="w-3 h-3" /></button>
                        </div>
                    ))}

                    <button onClick={clearAllFilters} className="ml-auto text-xs text-sage-600 hover:text-sage-800 font-medium flex items-center gap-1"><FilterX className="w-3 h-3" /> Clear All</button>
                </div>
            )}
        </header>
    );
};