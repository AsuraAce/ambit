import * as React from 'react';
import { Import, MoreHorizontal, Play } from 'lucide-react';
import { AppSettings, FilterState, LayoutMode, SortOption, ViewMode, type LibraryScopeCounts, type SourceKindCounts } from '../../types';
import { useLibraryContext } from '../../hooks/useLibraryContext';
import { useLibraryStore } from '../../stores/libraryStore';
import { SortOptionList, ViewControls } from '../../features/library/components/ViewControls';
import { ActiveFilters } from '../../features/filters/components/ActiveFilters';
import { isBrowserMockMode } from '../../services/runtime';
import { ToastContext } from '../../contexts/ToastContext';
import { TooltipButton } from './InfoTooltip';
import { LibraryScopeDropdown } from '../../features/filters/components/ImageKindScopeDropdown';
import { useInvokeOwnerScopeStore } from '../../stores/invokeOwnerScopeStore';
import { getInvokeOwnerQueryScopeKey } from '../../utils/invokeOwnerQueryScope';

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
    totalCount: number | null;
    scopeName: string;
    scopeCounts?: LibraryScopeCounts;
    scopeAvailability?: LibraryScopeCounts;
    scopeResultCount?: number;
    scopeCountsLoading?: boolean;
    scopeCountsError?: boolean;
    retryScopeCounts?: () => Promise<void>;
    /** @deprecated Replaced by scopeCounts.imageKinds. */
    sourceKindCounts?: SourceKindCounts;
    onImport: () => void;
    onSlideshow: () => void;
    clearAllFilters: () => void;
    isFiltering?: boolean;
    onSearchDraftPendingChange: (isPending: boolean) => void;
}

type ToolbarDensity = 'normal' | 'actionsOverflow' | 'compact';

const getToolbarDensity = (width: number): ToolbarDensity => {
    if (width < 700) return 'compact';
    if (width < 900) return 'actionsOverflow';
    return 'normal';
};

const useToolbarDensity = (elementRef: React.RefObject<HTMLElement | null>) => {
    const [density, setDensity] = React.useState<ToolbarDensity>('normal');

    React.useLayoutEffect(() => {
        const element = elementRef.current;
        if (!element || typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(([entry]) => setDensity(getToolbarDensity(entry.contentRect.width)));
        observer.observe(element);
        return () => observer.disconnect();
    }, [elementRef]);

    return density;
};

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
    scopeCounts,
    scopeAvailability,
    scopeResultCount,
    scopeCountsLoading,
    scopeCountsError,
    retryScopeCounts,
    onImport,
    onSlideshow,
    clearAllFilters,
    isFiltering,
    onSearchDraftPendingChange,
}: AppHeaderProps) => {
    const headerRef = React.useRef<HTMLElement>(null);
    const actionsMenuRef = React.useRef<HTMLDivElement>(null);
    const actionsTriggerRef = React.useRef<HTMLButtonElement>(null);
    const [showActionsMenu, setShowActionsMenu] = React.useState(false);
    const toolbarDensity = useToolbarDensity(headerRef);
    const {
        settings, setSettings,
        recentSearches, setRecentSearches,
    } = useLibraryContext();
    const toast = React.useContext(ToastContext);
    const addToast = toast?.addToast ?? ((message: string) => console.info(message));
    const browserMockMode = isBrowserMockMode();
    const invokeOwnerPresentationKey = useInvokeOwnerScopeStore(state => (
        getInvokeOwnerQueryScopeKey(settings.invokeAiPath, state.ownerScopeState)
    ));

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
        ? { bar: 'bg-harbor-500', shadow: 'shadow-[0_0_10px_rgba(104,127,140,0.3)]', bg: 'bg-harbor-500/10' }
        : { bar: 'bg-sage-500', shadow: 'shadow-[0_0_10px_rgba(110,121,107,0.5)]', bg: 'bg-sage-500/10' };
    const shouldHighlightImport = isNonLiveTaskActive || isBackgroundHealingActive;
    const liveWatchButtonClass = isLiveWatching
        ? `bg-sage-500/10 border-sage-500/30 text-sage-600 shadow-sm shadow-sage-500/10 hover:border-red-500/30 hover:text-red-500 dark:bg-sage-500/15 dark:border-sage-400/30 dark:text-sage-300 ${isLiveWatchWorkActive ? 'ring-1 ring-sage-500/20' : ''}`
        : 'bg-gray-100 dark:bg-zinc-800/50 border-gray-200 dark:border-white/10 text-gray-400 hover:text-sage-600 hover:border-sage-500/30 dark:hover:text-sage-300';

    // Determine visibility of middle controls
    const showLayoutSwitcher = viewMode === 'grid';
    const showSlideshowButton = viewMode === 'grid' || viewMode === 'timeline';

    React.useEffect(() => {
        if (!showActionsMenu) return;

        const handlePointerDown = (event: PointerEvent) => {
            if (!actionsMenuRef.current?.contains(event.target as Node)) setShowActionsMenu(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setShowActionsMenu(false);
                actionsTriggerRef.current?.focus();
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [showActionsMenu]);

    const toggleLiveWatch = () => {
        if (browserMockMode) {
            addToast('Unavailable in browser mock mode.', 'info');
            return;
        }
        setIsLiveWatching(!isLiveWatching);
    };
    const selectOverflowSort = (option: SortOption) => {
        setSortOption(option);
        setShowActionsMenu(false);
        actionsTriggerRef.current?.focus();
    };

    const actionButtons = (
        <>
            <TooltipButton
                label="Import Images"
                content="Import images. For automatic sync with favorites and boards, set up an Integration in Settings."
                onClick={onImport}
                className={`p-2 rounded-xl transition-all border relative group ${shouldHighlightImport ? 'animate-pulse text-sage-600 bg-sage-500/20' : 'bg-gray-100 dark:bg-zinc-800/50 border-gray-200 dark:border-white/10 text-gray-500 hover:text-gray-900 dark:hover:text-white'}`}
            >
                <Import className="w-4 h-4" />
            </TooltipButton>
            <TooltipButton
                label={isLiveWatching ? 'Disable Live Watch' : 'Enable Live Watch'}
                content={isLiveWatching ? 'Disable automatic monitoring of generator output folders.' : 'Automatically detect and import new images from generator output folders.'}
                aria-pressed={isLiveWatching}
                onClick={toggleLiveWatch}
                className={`p-2 rounded-xl transition-all border relative group ${liveWatchButtonClass}`}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
            </TooltipButton>
        </>
    );

    return (
        <header ref={headerRef} className="flex-shrink-0 sticky top-0 z-50 transition-colors duration-200">
            <div className={`relative z-20 flex min-h-16 flex-nowrap items-center gap-3 rounded-2xl border border-gray-200 bg-white/90 py-3 shadow-lg backdrop-blur-xl animate-in slide-in-from-top-4 duration-500 ease-spring dark:border-white/10 dark:bg-zinc-900/95 ${toolbarDensity === 'compact' ? 'px-3' : 'px-6'}`}>
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

                <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="min-w-0 max-w-lg flex-1">
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
                    </div>
                    {(viewMode === 'grid' || viewMode === 'timeline') && (
                        <LibraryScopeDropdown
                            mediaType={filters.mediaType ?? 'all'}
                            sourceKind={filters.sourceKind ?? 'all'}
                            displayedCount={scopeResultCount}
                            scopeCounts={scopeCounts}
                            scopeAvailability={scopeAvailability}
                            countsLoading={scopeCountsLoading}
                            countsError={scopeCountsError}
                            onRetryCounts={retryScopeCounts}
                            onScopeChange={(scope) => setFilters(previous => ({ ...previous, ...scope }))}
                        />
                    )}
                    {browserMockMode && (
                        <span className="shrink-0 rounded-md border border-ember-500/30 bg-ember-500/10 px-2 py-1 text-[11px] font-semibold text-ember-600 dark:text-ember-300">
                            Browser Mock
                        </span>
                    )}
                </div>

                <div className="ml-auto flex shrink-0 items-center gap-3">
                    {toolbarDensity === 'normal' ? (
                        <div className="ml-1 flex items-center gap-1">{actionButtons}</div>
                    ) : (
                        <div ref={actionsMenuRef} className="relative">
                            <button ref={actionsTriggerRef} type="button" aria-expanded={showActionsMenu} aria-label={`Library actions; Live Watch ${isLiveWatching ? 'on' : 'off'}`} onClick={() => setShowActionsMenu(open => !open)} className="flex h-9 items-center gap-1 rounded-xl border border-gray-200 bg-gray-100 px-2 text-gray-600 transition-colors hover:text-gray-900 dark:border-white/10 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:text-white">
                                <MoreHorizontal className="h-4 w-4" />
                                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${isLiveWatching ? 'bg-sage-500' : 'bg-gray-400 dark:bg-zinc-500'}`} />
                                <span className="sr-only">Library actions; Live Watch {isLiveWatching ? 'on' : 'off'}</span>
                            </button>
                            {showActionsMenu && (
                                <div className="absolute right-0 top-full z-[100] mt-2 w-52 rounded-xl border border-gray-200 bg-white p-2 shadow-2xl dark:border-white/10 dark:bg-zinc-900">
                                    <div className="flex items-center justify-between gap-2 px-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400"><span>Library actions</span><span className={isLiveWatching ? 'text-sage-600 dark:text-sage-300' : undefined}>{isLiveWatching ? 'Live Watch on' : 'Live Watch off'}</span></div>
                                    <div className="flex items-center gap-2">{actionButtons}</div>
                                    {showSlideshowButton && <TooltipButton label="Start Slideshow" content="Start Slideshow" onClick={() => { setShowActionsMenu(false); onSlideshow(); }} className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs text-gray-600 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-white/5"><Play aria-hidden className="h-3.5 w-3.5" />Start Slideshow</TooltipButton>}
                                    {toolbarDensity === 'compact' && (
                                        <div className="mt-3 border-t border-gray-100 pt-2 dark:border-white/5">
                                            <span className="px-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">Sort</span>
                                            <div className="mt-1 flex flex-col gap-1"><SortOptionList sortOption={sortOption} onSelect={selectOverflowSort} compact /></div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <ViewControls
                        showLayoutSwitcher={showLayoutSwitcher}
                        layoutMode={layoutMode}
                        setLayoutMode={setLayoutMode}
                        showSlideshowButton={showSlideshowButton && toolbarDensity === 'normal'}
                        showThumbnailSize={showSlideshowButton}
                        compact={toolbarDensity !== 'normal'}
                        onSlideshow={onSlideshow}
                        sortOption={sortOption}
                        setSortOption={setSortOption}
                        thumbnailSize={settings.thumbnailSize}
                        setThumbnailSize={(size) => setSettings((p: AppSettings) => ({ ...p, thumbnailSize: size }))}
                        displayedCount={displayedCount}
                        totalCount={totalCount}
                        scopeName={scopeName}
                        ownerPresentationKey={invokeOwnerPresentationKey}
                        isFiltering={isFiltering}
                        showSortButton={toolbarDensity !== 'compact'}
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
