import * as React from 'react';
import { Import } from 'lucide-react';
import { AppSettings, FilterState, LayoutMode, SortOption, ViewMode } from '../../types';
import { useLibraryContext } from '../../hooks/useLibraryContext';
import { useLibraryStore } from '../../stores/libraryStore';
import { ViewControls } from '../../features/library/components/ViewControls';
import { ActiveFilters } from '../../features/filters/components/ActiveFilters';
import { isBrowserMockMode } from '../../services/runtime';
import { ToastContext } from '../../contexts/ToastContext';
import { TooltipButton } from './InfoTooltip';

const SearchBar = React.lazy(() => import('../../features/filters/components/SearchBar').then(module => ({ default: module.SearchBar })));

const SearchBarFallback = () => (
    <div aria-hidden className="h-10 w-full max-w-lg rounded-xl bg-gray-100 dark:bg-zinc-800/50 animate-pulse" />
);

interface AppHeaderProps {
    viewMode: ViewMode;
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
    onSearchDraftPendingChange: (isPending: boolean) => void;
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
    isFiltering,
    onSearchDraftPendingChange,
}: AppHeaderProps) => {
    const {
        settings, setSettings,
        recentSearches, setRecentSearches,
    } = useLibraryContext();
    const toast = React.useContext(ToastContext);
    const addToast = toast?.addToast ?? ((message: string) => console.info(message));
    const browserMockMode = isBrowserMockMode();

    const {
        isLiveWatching, setIsLiveWatching,
        isImporting, importProgress,
        liveWatchSession,
        syncStatus, syncProgress,
        isResolvingModels, modelResolutionProgress,
        isScanningDiscovery, discoveryScanProgress, // Added
        isBackgroundHealingActive, backgroundHealingProgress // Added
    } = useLibraryStore();

    const isManualSyncing = syncStatus === 'syncing';
    const isLiveWatchActive = liveWatchSession.active;
    const isLiveWatchWorkActive = isLiveWatchActive && (liveWatchSession.phase === 'syncing' || liveWatchSession.phase === 'importing');
    const isNonLiveTaskActive = isImporting || isManualSyncing || isResolvingModels || isScanningDiscovery;
    const active = isNonLiveTaskActive || isBackgroundHealingActive;

    const progress = (isImporting && importProgress)
        ? importProgress
        : (isManualSyncing
            ? syncProgress
            : (isResolvingModels
                ? modelResolutionProgress
                : (isScanningDiscovery ? discoveryScanProgress : (isBackgroundHealingActive ? backgroundHealingProgress : null))));

    // Determine color
    const isBackgroundOnly = isBackgroundHealingActive && !isNonLiveTaskActive;
    const progressColorInfo = isBackgroundOnly
        ? { bar: 'bg-violet-500', shadow: 'shadow-[0_0_10px_rgba(139,92,246,0.3)]', bg: 'bg-violet-500/10' }
        : { bar: 'bg-sage-500', shadow: 'shadow-[0_0_10px_rgba(110,121,107,0.5)]', bg: 'bg-sage-500/10' };
    const shouldHighlightImport = isNonLiveTaskActive || isBackgroundHealingActive;
    const liveWatchButtonClass = isLiveWatching
        ? `bg-sage-500/10 border-sage-500/30 text-sage-600 shadow-sm shadow-sage-500/10 hover:border-red-500/30 hover:text-red-500 dark:bg-sage-500/15 dark:border-sage-400/30 dark:text-sage-300 ${isLiveWatchWorkActive ? 'ring-1 ring-sage-500/20' : ''}`
        : 'bg-gray-100 dark:bg-zinc-800/50 border-gray-200 dark:border-white/10 text-gray-400 hover:text-sage-600 hover:border-sage-500/30 dark:hover:text-sage-300';

    // Determine visibility of middle controls
    const showLayoutSwitcher = viewMode === 'grid';
    const showSlideshowButton = viewMode === 'grid' || viewMode === 'timeline';

    return (
        <header className="flex-shrink-0 sticky top-0 z-50 transition-colors duration-200">
            <div className="h-16 flex items-center justify-between px-6 bg-white/90 dark:bg-zinc-900/95 backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-2xl shadow-lg animate-in slide-in-from-top-4 duration-500 ease-spring relative z-20">
                {/* Background clip layer for elements that need rounding (like progress bar) */}
                <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
                    {active && (
                        <div data-testid="app-header-progress-rail" className={`absolute top-0 left-0 right-0 h-1 ${progressColorInfo.bg} overflow-hidden`}>
                            <div
                                className={`h-full ${progressColorInfo.bar} ${progressColorInfo.shadow} transition-all duration-300 ease-out`}
                                style={{
                                    width: progress && progress.total > 0
                                        ? `${(progress.current / progress.total) * 100}%`
                                        : '100%'
                                }}
                            />
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-4 flex-1">
                    <React.Suspense fallback={<SearchBarFallback />}>
                        <SearchBar
                            filters={filters}
                            setFilters={setFilters}
                            searchProps={searchProps}
                            recentSearches={recentSearches}
                            setRecentSearches={setRecentSearches}
                            scopeName={scopeName}
                            displayedCount={displayedCount}
                            isFiltering={isFiltering ?? false}
                            submitNavigatesToGrid={viewMode === 'dashboard' || viewMode === 'maintenance'}
                            onDraftPendingChange={onSearchDraftPendingChange}
                        />
                    </React.Suspense>
                    {browserMockMode && (
                        <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                            Browser Mock
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                        <TooltipButton
                            label="Import Images"
                            content="Import images. For automatic sync with favorites and boards, set up an Integration in Settings."
                            onClick={onImport}
                            className={`p-2 rounded-xl transition-all border relative group ${shouldHighlightImport ? 'animate-pulse text-sage-600 bg-sage-500/20' : 'bg-gray-100 dark:bg-zinc-800/50 border-gray-200 dark:border-white/10 text-gray-500 hover:text-gray-900 dark:hover:text-white'}`}
                        >
                            <Import className="w-4 h-4" />
                        </TooltipButton>
                        <TooltipButton
                            label={isLiveWatching ? "Disable Live Watch" : "Enable Live Watch"}
                            content={isLiveWatching ? "Disable automatic monitoring of generator output folders." : "Automatically detect and import new images from generator output folders."}
                            aria-pressed={isLiveWatching}
                            onClick={() => {
                                if (browserMockMode) {
                                    addToast('Unavailable in browser mock mode.', 'info');
                                    return;
                                }
                                setIsLiveWatching(!isLiveWatching);
                            }}
                            className={`p-2 rounded-xl transition-all border relative group ${liveWatchButtonClass}`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                        </TooltipButton>
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
                        setThumbnailSize={(size) => setSettings((p: AppSettings) => ({ ...p, thumbnailSize: size }))}
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
