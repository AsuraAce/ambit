import * as React from 'react';
import { Import } from 'lucide-react';
import { FilterState, LayoutMode, SortOption, ViewMode } from '../../types';
import { useLibraryContext } from '../../hooks/useLibraryContext';
import { SearchBar } from '../../features/filters/components/SearchBar';
import { ViewControls } from '../../features/library/components/ViewControls';
import { ActiveFilters } from '../../features/filters/components/ActiveFilters';

interface AppHeaderProps {
    viewMode: ViewMode;
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
    layoutMode: LayoutMode;
    setLayoutMode: (mode: LayoutMode) => void;
    sortOption: SortOption;
    setSortOption: (opt: SortOption) => void;
    displayedCount: number;
    totalCount: number;
    scopeName: string;
    onImport: () => void;
    onSlideshow: () => void;
    clearAllFilters: () => void;
    isFiltering?: boolean;
}

export const AppHeader = React.memo(({
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
    scopeName,
    onImport,
    onSlideshow,
    clearAllFilters,
    isFiltering
}: AppHeaderProps) => {
    const {
        settings, setSettings,
        recentSearches, setRecentSearches,
        isLiveWatching, setIsLiveWatching,
        isImporting, importProgress,
        isLiveSyncing, syncState,
        isResolvingModels, modelResolutionProgress
    } = useLibraryContext() as any;

    const isSyncing = syncState?.status === 'syncing' || isLiveSyncing;
    const active = isImporting || isSyncing || isResolvingModels;
    const progress = (isImporting && importProgress)
        ? importProgress
        : (isSyncing ? syncState?.progress : (isResolvingModels ? modelResolutionProgress : null));

    // Determine visibility of middle controls
    const showLayoutSwitcher = viewMode === 'grid';
    const showSlideshowButton = viewMode === 'grid' || viewMode === 'timeline';

    return (
        <header className="flex-shrink-0 sticky top-0 z-50 transition-colors duration-200">
            <div className="h-16 flex items-center justify-between px-6 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-2xl shadow-lg animate-in slide-in-from-top-4 duration-500 ease-spring relative">
                {/* Background clip layer for elements that need rounding (like progress bar) */}
                <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
                    {active && (
                        <div className="absolute top-0 left-0 right-0 h-1 bg-sage-500/10 overflow-hidden">
                            <div
                                className="h-full bg-sage-500 shadow-[0_0_10px_rgba(110,121,107,0.5)] transition-all duration-300 ease-out"
                                style={{
                                    width: progress && progress.total > 0
                                        ? `${(progress.current / progress.total) * 100}%`
                                        : (active ? '100%' : '0%')
                                }}
                            />
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-4 flex-1">
                    <SearchBar
                        filters={filters}
                        setFilters={setFilters}
                        searchProps={searchProps}
                        recentSearches={recentSearches}
                        setRecentSearches={setRecentSearches}
                    />
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                        <button
                            onClick={onImport}
                            className={`p-2 rounded-xl transition-all border relative group ${active ? 'animate-pulse text-sage-600 bg-sage-500/20' : 'bg-gray-100 dark:bg-zinc-800/50 border-gray-200 dark:border-white/10 text-gray-500 hover:text-gray-900 dark:hover:text-white'}`}
                            title="Import Images"
                        >
                            <Import className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setIsLiveWatching(!isLiveWatching)}
                            className={`p-2 rounded-xl transition-all border relative group ${isLiveWatching ? 'bg-red-500 text-white border-red-600 shadow-md shadow-red-500/20 animate-pulse' : 'bg-gray-100 dark:bg-zinc-800/50 border-gray-200 dark:border-white/10 text-gray-400 hover:text-red-500'}`}
                            title={isLiveWatching ? "Live Sync Active (Click to pause)" : "Enable Live Sync"}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                        </button>
                    </div>

                    <div className="h-6 w-px bg-gray-300 dark:bg-white/10 mx-2" />

                    <ViewControls
                        showLayoutSwitcher={showLayoutSwitcher}
                        layoutMode={layoutMode}
                        setLayoutMode={setLayoutMode}
                        showSlideshowButton={showSlideshowButton}
                        onSlideshow={onSlideshow}
                        sortOption={sortOption}
                        setSortOption={setSortOption}
                        thumbnailSize={settings.thumbnailSize}
                        setThumbnailSize={(size) => setSettings(p => ({ ...p, thumbnailSize: size }))}
                        displayedCount={displayedCount}
                        totalCount={totalCount}
                        scopeName={scopeName}
                        isFiltering={isFiltering}
                    />
                </div>
            </div>

            <ActiveFilters
                filters={filters}
                setFilters={setFilters}
                clearAllFilters={clearAllFilters}
            />
        </header>
    );
});
