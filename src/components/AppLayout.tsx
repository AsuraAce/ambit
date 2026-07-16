import * as React from 'react';
import { APP_NAME } from '../constants/app';
import { AppSidebar } from '../features/collections/components/AppSidebar';
import { AppHeader } from './ui/AppHeader';
import { SelectionBar } from '../features/library/components/SelectionBar';
import { FilterPanel } from '../features/filters/components/FilterPanel';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { GridSkeleton } from '../features/library/components/GridSkeleton';
import { PinnedShelf } from '../features/library/components/PinnedShelf';
import { TimelineView } from '../features/library/components/TimelineView';
import { VirtualGrid, type VirtualGridHandle } from '../features/library/components/VirtualGrid';
import { GridItem } from '../features/library/components/GridItem';
import { ActivityDock } from './ui/ActivityDock';
import { AIImage, Collection, ContextMenuState, FilterState, LayoutMode, SmartCollection, SortOption, ToastMessage, ViewMode } from '../types';
import { Import, Search } from 'lucide-react';
import { useSearch } from '../contexts/SearchContext';
import { useSettingsStore } from '../stores/settingsStore';
import { useCollectionStore } from '../stores/collectionStore';
import { useProgressListeners } from '../hooks/useProgressListeners';
import { setupGlobalLogging } from '../utils/logger';
import { isCollectionThumbnailImage } from '../utils/thumbnailUtils';
import type { useAppActions } from '../hooks/useAppActions';
import type { useAppHandlers } from '../hooks/useAppHandlers';
import type { useCollectionOperations } from '../hooks/useCollectionOperations';
import type { useFileOperations } from '../hooks/useFileOperations';
import type { useModalManager } from '../hooks/useModalManager';
import { PrivacyProtectionGate } from './ui/PrivacyProtectionGate';

setupGlobalLogging();

const StatsDashboard = React.lazy(() => import('./ui/Charts').then(module => ({ default: module.StatsDashboard })));
const MaintenanceView = React.lazy(() => import('../features/maintenance/components/MaintenanceView').then(module => ({ default: module.MaintenanceView })));
const FILTER_PANEL_LAYOUT_TRANSITION_MS = 540;

const ViewLoadingFallback = () => (
    <div className="h-full w-full flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-sage-500/20 border-t-sage-500 animate-spin" />
    </div>
);

interface GridLayoutPosition {
    x: number;
    y: number;
    width: number;
    height: number;
}

type AddToast = (message: string, type?: ToastMessage['type']) => void;
type AppHandlers = ReturnType<typeof useAppHandlers> & {
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
};

interface AppLayoutProps {
    // Sidebar Props
    filters: FilterState;
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    isFilterPanelOpen: boolean;
    setIsFilterPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
    colOps: ReturnType<typeof useCollectionOperations>;
    setExportIds: React.Dispatch<React.SetStateAction<Set<string>>>;
    modals: ReturnType<typeof useModalManager>;
    addToast: AddToast;

    // Header & Main View Props
    viewMode: ViewMode;
    changeViewMode: (mode: ViewMode) => void;
    searchProps: React.ComponentProps<typeof AppHeader>['searchProps'];
    layoutMode: LayoutMode;
    setLayoutMode: (mode: LayoutMode) => void;
    sortOption: SortOption;
    setSortOption: (opt: SortOption) => void;
    totalImages: number;
    scopeTotal: number;
    scopeName: string;
    isFiltering: boolean;
    fileOps: ReturnType<typeof useFileOperations>;
    onOpenImportModal: () => void;
    clearAllFilters: () => void;

    // Grid/View Props
    // Grid/View Props
    scrollContainerRef: React.RefObject<HTMLDivElement | null>;
    images: AIImage[];
    handlers: AppHandlers;
    setViewingImageId: (id: string | null) => void;
    onMaintenanceViewerOpenChange: (isOpen: boolean) => void;
    isViewerShortcutBlocked: boolean;
    toggleFavorite: (id: string) => void | Promise<void>;
    actions: ReturnType<typeof useAppActions>;
    availableTags: string[];
    selectedIds: Set<string>;
    handleImageClick: (e: React.MouseEvent, id: string, index: number, callback: (index: number) => void) => void;
    setSelectedImageIndex: (index: number | null) => void;
    handleSelectionToggle: (e: React.MouseEvent | undefined, id: string) => void;
    activeCollection: Collection | null | undefined;
    activeSmartCollection: SmartCollection | null | undefined;
    handleRangeSelection: (indices: number[], isAdditive: boolean) => void;
    clearSelection: () => void;
    gridRef: React.RefObject<VirtualGridHandle | null>;
    loadMoreImages: () => void | Promise<void>;
    handleLayoutChange: (c: number, h: number) => void;
    isSearchFocused: boolean;
    setIsSearchFocused: (f: boolean) => void;
    lastSelectedId: string | null;
    handleRemoveFromCollection: () => void;

    handleOpenCollectionModal: (mode: 'add' | 'move') => void;
    onSetCollectionMembership: (imageId: string, collectionId: string, shouldBelong: boolean) => Promise<boolean>;
    onEditCollection: (colId: string) => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
    filters, setFilters, isFilterPanelOpen, setIsFilterPanelOpen,
    colOps, setExportIds, modals, addToast,
    viewMode, changeViewMode, searchProps, layoutMode, setLayoutMode,
    sortOption, setSortOption, scopeTotal, scopeName,
    fileOps, onOpenImportModal, scrollContainerRef,
    handlers, setViewingImageId, onMaintenanceViewerOpenChange, isViewerShortcutBlocked,
    actions, availableTags, selectedIds,
    handleImageClick, setSelectedImageIndex, handleSelectionToggle,
    activeCollection, activeSmartCollection, handleRangeSelection,
    clearSelection, gridRef, handleLayoutChange,
    isSearchFocused, setIsSearchFocused, lastSelectedId,

    handleRemoveFromCollection, handleOpenCollectionModal, onSetCollectionMembership, onEditCollection
}) => {
    // Hooks
    useProgressListeners();

    // Stores
    const settings = useSettingsStore(s => s.settings);
    const geminiApiKey = useSettingsStore(s => s.geminiApiKey);
    const privacyEnabled = useSettingsStore(s => s.privacyEnabled);
    const privacyMaskIndexStatus = useSettingsStore(s => s.privacyMaskIndexStatus);
    const privacyExposureBlocked = privacyEnabled && privacyMaskIndexStatus !== 'ready';

    const allCollections = useCollectionStore(s => s.collections);

    // Local State
    const [showSupportPulse, setShowSupportPulse] = React.useState(true);
    const [isFilterPanelLayoutTransitioning, setIsFilterPanelLayoutTransitioning] = React.useState(false);
    const previousFilterPanelOpenRef = React.useRef(isFilterPanelOpen);
    const filterPanelTransitionTimerRef = React.useRef<number | null>(null);

    React.useEffect(() => {
        const timer = setTimeout(() => {
            setShowSupportPulse(false);
        }, 30000);
        return () => clearTimeout(timer);
    }, []);

    React.useEffect(() => {
        const filterPanelChanged = previousFilterPanelOpenRef.current !== isFilterPanelOpen;
        previousFilterPanelOpenRef.current = isFilterPanelOpen;

        if (!filterPanelChanged) {
            return;
        }

        setIsFilterPanelLayoutTransitioning(true);
        filterPanelTransitionTimerRef.current = window.setTimeout(() => {
            filterPanelTransitionTimerRef.current = null;
            setIsFilterPanelLayoutTransitioning(false);
        }, FILTER_PANEL_LAYOUT_TRANSITION_MS);

        return () => {
            if (filterPanelTransitionTimerRef.current !== null) {
                window.clearTimeout(filterPanelTransitionTimerRef.current);
                filterPanelTransitionTimerRef.current = null;
            }
        };
    }, [isFilterPanelOpen]);

    // Derived
    // Store Access
    const {
        images,
        totalImages,
        globalTotal,
        isFiltering,
        clearAllFilters,
        toggleFavorite,
        hasMoreImages,
        loadMoreImages,
        isLoadingMore
    } = useSearch();
    // const images = useSearchStore(s => s.images); // Images available in context
    // const totalImages = useSearchStore(s => s.totalImages);
    // const isFiltering = useSearchStore(s => s.isFiltering);
    // const clearAllFilters = useSearchStore(s => s.clearAllFilters);
    // const storeToggleFavorite = useSearchStore(s => s.toggleFavorite);
    // const fetchData = useSearchStore(s => s.fetchData);

    // Expose actions for debugging/maintenance
    React.useEffect(() => {
        // @ts-ignore
        if (!window.app) window.app = {};
        // @ts-ignore
        window.app.actions = actions;
    }, [actions]);

    // Derived loadMore
    // const loadMoreImages = React.useCallback(() => {
    //    fetchData(true, [...collections, ...smartCollections]);
    // }, [collections, smartCollections, fetchData]);

    // Override props with store values
    //     const toggleFavorite = storeToggleFavorite;

    // --- Performance Logic (Moved from JSX to resolve Rules of Hooks violation) ---
    const showPinnedInShelf = React.useMemo(() => (
        filters.collectionId !== null && viewMode !== 'timeline' && !filters.pinnedOnly
    ), [filters.collectionId, viewMode, filters.pinnedOnly]);

    const pinnedImages = React.useMemo(() => showPinnedInShelf ? images.filter(i => i.isPinned) : [], [showPinnedInShelf, images]);
    const gridItems = React.useMemo(() => showPinnedInShelf ? images.filter(i => !i.isPinned) : images, [showPinnedInShelf, images]);
    const pinnedCount = pinnedImages.length;
    const activeThumbnailCollection = activeCollection || activeSmartCollection;
    const isActiveThumbnail = React.useCallback(
        (img: AIImage) => isCollectionThumbnailImage(img, activeThumbnailCollection),
        [activeThumbnailCollection]
    );

    const galleryTransitionKey = React.useMemo(() => [
        layoutMode,
        settings.thumbnailSize ?? 'default-size',
        sortOption,
        filters.collectionId ?? 'library',
        filters.favoritesOnly ? 'favorites' : 'all-images',
        filters.pinnedOnly ? 'pinned-only' : 'unpinned-scope',
        filters.showGrids ? 'show-grids' : 'hide-grids',
        filters.showIntermediates ? 'show-intermediates' : 'hide-intermediates'
    ].join('|'), [
        layoutMode,
        settings.thumbnailSize,
        sortOption,
        filters.collectionId,
        filters.favoritesOnly,
        filters.pinnedOnly,
        filters.showGrids,
        filters.showIntermediates
    ]);

    const renderGridItem = React.useCallback((img: AIImage, style: React.CSSProperties, index: number, layout?: GridLayoutPosition) => (
        <GridItem
            key={img.id}
            image={img}
            style={style}
            layoutPos={layout}
            index={index + pinnedCount}
            isSelected={selectedIds.has(img.id)}
            selectedIds={selectedIds}
            maskedKeywords={settings.maskedKeywords}
            setImages={handlers.setImages}
            onClick={(e, id, idx) => handleImageClick(e, id, idx, setSelectedImageIndex)}
            onToggleSelection={handleSelectionToggle}
            onToggleFavorite={(e, id) => toggleFavorite(id)}
            onTogglePin={(e, id) => {
                const imgFound = images.find(i => i.id === id);
                if (imgFound) actions.handlePinImage(id, !imgFound.isPinned);
            }}
            onContextMenu={(e, id) => handlers.setContextMenu({ x: e.clientX, y: e.clientY, imageId: id })}
            isThumbnail={isActiveThumbnail(img)}
        />
    ), [pinnedCount, selectedIds, settings.maskedKeywords, handlers, handleImageClick, setSelectedImageIndex, handleSelectionToggle, toggleFavorite, images, actions, isActiveThumbnail]);

    return (
        <div className="flex flex-1 overflow-hidden p-3 gap-3">
            <AppSidebar
                viewMode={viewMode}
                setViewMode={changeViewMode}
                filters={filters}
                setFilters={setFilters}
                isFilterPanelOpen={isFilterPanelOpen}
                setIsFilterPanelOpen={setIsFilterPanelOpen}
                onOpenSettings={() => { modals.setInitialSettingsTab('general'); modals.openModal('settings'); }}
                onOpenShortcuts={() => { modals.setShortcutsModalTab('shortcuts'); modals.openModal('shortcuts'); }}
                onOpenDonation={() => modals.openModal('donation')}
                showSupportPulse={showSupportPulse}
            />

            <FilterPanel
                filters={filters}
                setFilters={setFilters}
                filteredImages={images}
                onCreateCollection={colOps.createCollection}
                onSaveSmartCollection={colOps.saveSmartCollection}
                onDeleteSmartCollection={colOps.deleteSmartCollection}
                onDropOnCollection={async (colId, data) => {
                    try {
                        const ids = JSON.parse(data);
                        if (Array.isArray(ids)) {
                            await colOps.addImagesToCollection(ids, colId);
                        }
                    } catch (e) {
                        console.error("Drop failed", e);
                    }
                }}
                onRenameCollection={colOps.renameCollection}
                onDeleteCollection={colOps.deleteCollection}
                onToggleArchiveCollection={colOps.toggleArchiveCollection}
                onTogglePinCollection={colOps.togglePinCollection}
                onSetCollectionColor={colOps.setCollectionColor}
                onPlayCollection={(id) => {
                    setFilters(f => ({ ...f, collectionId: id }));
                    modals.setSlideshowShuffle(false);
                    modals.openModal('slideshow');
                }}
                onExportCollection={(id) => {
                    setFilters(f => ({ ...f, collectionId: id }));
                    modals.openModal('export');
                }}
                onResetCollectionThumbnail={colOps.resetCollectionThumbnail}
                onEditCollection={onEditCollection}
                onUpdateCollectionFilters={colOps.updateCollectionFilters}
                onOpenResourceFolders={() => {
                    modals.setInitialSettingsTab('folders');
                    modals.openModal('settings');
                }}
                isVisible={isFilterPanelOpen}
            />

            <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-zinc-900/95 backdrop-blur-xl rounded-2xl shadow-2xl shadow-black/20 border border-zinc-200 dark:border-white/10 overflow-hidden relative">
                <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_0%,rgba(139,174,124,0.08),transparent_70%)] dark:bg-[radial-gradient(circle_at_50%_0%,rgba(139,174,124,0.15),transparent_60%)] z-10" />

                {isSearchFocused && (
                    <div
                        className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
                        onClick={() => {
                            searchProps.inputRef.current?.blur();
                            setIsSearchFocused(false);
                        }}
                    />
                )}

                <AppHeader
                    viewMode={viewMode}
                    filters={filters}
                    setFilters={setFilters}
                    searchProps={searchProps}
                    layoutMode={layoutMode}
                    setLayoutMode={setLayoutMode}
                    sortOption={sortOption}
                    setSortOption={setSortOption}
                    displayedCount={totalImages}
                    totalCount={scopeTotal}
                    scopeName={scopeName}
                    isFiltering={isFiltering}
                    onImport={onOpenImportModal}
                    onSlideshow={() => { modals.setSlideshowShuffle(false); modals.openModal('slideshow'); }}
                    clearAllFilters={clearAllFilters}
                />

                <div className="flex-1 flex overflow-hidden min-h-0 relative">
                    <div ref={scrollContainerRef} className={`flex-1 ${viewMode === 'grid' ? 'overflow-y-scroll overflow-x-hidden custom-scrollbar' : 'overflow-hidden'}`}>
                        {privacyExposureBlocked ? (
                            <PrivacyProtectionGate onOpenSettings={() => {
                                modals.setInitialSettingsTab('privacy');
                                modals.openModal('settings');
                            }} />
                        ) : <ErrorBoundary>
                            {viewMode === 'dashboard' ? (
                                <React.Suspense fallback={<ViewLoadingFallback />}>
                                    <StatsDashboard images={images} onFilter={(t, v) => {
                                        if (t === 'model') {
                                            setFilters(p => ({
                                                ...p,
                                                models: p.models.includes(v) ? p.models : [...p.models, v]
                                            }));
                                        }
                                        changeViewMode('grid');
                                    }} />
                                </React.Suspense>
                            ) : viewMode === 'maintenance' ? (
                                <React.Suspense fallback={<ViewLoadingFallback />}>
                                    <MaintenanceView
                                        images={images}
                                        onResolveDuplicate={handlers.handleResolveDuplicate}
                                        onRestoreImages={handlers.handleRestoreImages}
                                        onRemoveFromLibrary={handlers.handleRemoveFromLibrary}
                                        onDeleteFile={handlers.handleDeleteFile}
                                        onEmptyTrash={handlers.handleEmptyTrash}
                                        onGroupImages={handlers.handleGroupImages}
                                        onViewImage={(id) => setViewingImageId(id)}
                                        onRegenerateThumbnails={fileOps.regenerateThumbnails}
                                        maskedKeywords={settings.maskedKeywords}
                                        onUpdatePrompt={handlers.handleUpdatePrompt}
                                        onUpdateModel={handlers.handleUpdateModel}
                                        onUpdateTool={handlers.handleUpdateTool}
                                        onUpdateNotes={(id, n) => { handlers.handleUpdateNotes(id, n); }}
                                        onRecoverMetadata={() => {
                                            if (!settings.enableAI || !geminiApiKey) {
                                                addToast("Enable AI features and configure a Gemini API key first", "error");
                                                modals.setInitialSettingsTab('intelligence');
                                                modals.openModal('settings');
                                            } else {
                                                modals.openModal('recovery');
                                            }
                                        }}
                                        onToggleFavorite={(id) => toggleFavorite(id)}
                                        onTogglePin={actions.handlePinImage}
                                        onSetCollectionMembership={onSetCollectionMembership}
                                        availableTags={availableTags}
                                        onViewerOpenChange={onMaintenanceViewerOpenChange}
                                        isShortcutBlocked={isViewerShortcutBlocked}
                                    />
                                </React.Suspense>
                            ) : (images.length > 0 || isFiltering) ? (
                                <>
                                    {isFiltering ? (
                                        <GridSkeleton layout={layoutMode} />
                                    ) : viewMode === 'timeline' ? (
                                        <TimelineView
                                            images={images}
                                            selectedIds={selectedIds}
                                            thumbnailSize={settings.thumbnailSize}
                                            sortOption={sortOption}
                                            maskedKeywords={settings.maskedKeywords}
                                            onImageClick={(e, id, index) => handleImageClick(e, id, index, setSelectedImageIndex)}
                                            onSelectionToggle={handleSelectionToggle}
                                            onToggleFavorite={(e, id) => { toggleFavorite(id); }}
                                            onTogglePin={(e, id) => {
                                                const img = images.find(i => i.id === id);
                                                if (img) actions.handlePinImage(id, !img.isPinned);
                                            }}
                                            onContextMenu={(e, id) => handlers.setContextMenu({ x: e.clientX, y: e.clientY, imageId: id })}
                                            onRangeSelection={handleRangeSelection}
                                            onBackgroundClick={clearSelection}
                                            hasMoreImages={hasMoreImages}
                                            isLoadingMore={isLoadingMore}
                                            onLoadMore={loadMoreImages}
                                        />
                                    ) : (
                                        <>
                                            {showPinnedInShelf && (
                                                <PinnedShelf
                                                    images={pinnedImages}
                                                    isCollapsed={modals.isPinnedShelfCollapsed}
                                                    onToggleCollapse={() => modals.setIsPinnedShelfCollapsed((p: boolean) => !p)}
                                                    selectedIds={selectedIds}
                                                    maskedKeywords={settings.maskedKeywords}
                                                    setImages={handlers.setImages}
                                                    onImageClick={(e, id, index) => handleImageClick(e, id, index, setSelectedImageIndex)}
                                                    onToggleSelection={handleSelectionToggle}
                                                    onToggleFavorite={(e, id) => toggleFavorite(id)}
                                                    onTogglePin={(e, id) => {
                                                        const img = images.find(i => i.id === id);
                                                        if (img) actions.handlePinImage(id, !img.isPinned);
                                                    }}
                                                    onContextMenu={(e, id) => handlers.setContextMenu({ x: e.clientX, y: e.clientY, imageId: id })}
                                                    thumbnailSize={settings.thumbnailSize}
                                                    isActiveThumbnail={isActiveThumbnail}
                                                    onRangeSelection={handleRangeSelection}
                                                    onBackgroundClick={clearSelection}
                                                />
                                            )}
                                            <VirtualGrid<AIImage>
                                                ref={gridRef}
                                                items={gridItems}
                                                layout={layoutMode}
                                                minItemWidth={settings.thumbnailSize}
                                                gap={16}
                                                padding={24}
                                                scrollContainerRef={scrollContainerRef}
                                                onEndReached={loadMoreImages}
                                                getItemRatio={(img) => {
                                                    const w = img.width || 1;
                                                    const h = img.height || 1;
                                                    return w / h;
                                                }}
                                                onLayoutChange={handleLayoutChange}
                                                onRangeSelection={(indices, isAdditive) => {
                                                    const globalIndices = indices.map(idx => idx + pinnedCount);
                                                    handleRangeSelection(globalIndices, isAdditive);
                                                }}
                                                onBackgroundClick={clearSelection}
                                                renderItem={renderGridItem}
                                                transitionKey={galleryTransitionKey}
                                                suspendResizeLayout={isFilterPanelLayoutTransitioning}
                                            />
                                            {isLoadingMore && (
                                                <div className="w-full py-8 flex justify-center items-center">
                                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sage-500"></div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-gray-500 p-8 text-center max-w-md mx-auto">
                                    {globalTotal === 0 ? (
                                        <>
                                            <div className="p-6 bg-sage-100 dark:bg-sage-500/10 rounded-full mb-6 border border-sage-200 dark:border-sage-500/20 animate-in zoom-in duration-500">
                                                <Import className="w-12 h-12 text-sage-600 dark:text-sage-400 opacity-70" />
                                            </div>
                                            <h3 className="text-2xl font-bold mb-3 text-gray-800 dark:text-gray-100">Your Library is Empty</h3>
                                            <p className="text-gray-500 dark:text-gray-400 mb-8 leading-relaxed">
                                                Import your images to start organizing, searching, and exploring your AI creations with {APP_NAME}.
                                            </p>
                                            <button
                                                onClick={onOpenImportModal}
                                                className="px-8 py-3.5 bg-sage-600 hover:bg-sage-500 text-white rounded-2xl font-bold shadow-xl shadow-sage-500/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
                                            >
                                                <Import className="w-5 h-5" />
                                                Import Images
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <div className="p-6 bg-zinc-100 dark:bg-white/5 rounded-full mb-6 border border-zinc-200 dark:border-white/5 opacity-50">
                                                <Search className="w-12 h-12 text-zinc-400 dark:text-zinc-500" />
                                            </div>
                                            <h3 className="text-2xl font-bold mb-3 text-gray-800 dark:text-gray-100">No Matches Found</h3>
                                            <p className="text-gray-500 dark:text-gray-400 mb-8 leading-relaxed">
                                                We couldn't find any images matching your current filters. Try adjusting your search or clearing filters.
                                            </p>
                                            <button
                                                onClick={clearAllFilters}
                                                className="px-8 py-3.5 bg-zinc-800 dark:bg-white/10 hover:bg-zinc-700 dark:hover:bg-white/20 text-white rounded-2xl font-bold transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
                                            >
                                                Clear All Filters
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                        </ErrorBoundary>}
                    </div>
                </div>

                {!privacyExposureBlocked && <SelectionBar
                    selectedIds={selectedIds}
                    filteredImages={images}
                    lastSelectedId={lastSelectedId}
                    isExporting={fileOps.isExporting}
                    confirmDelete={settings.confirmDelete}
                    maskedKeywords={settings.maskedKeywords}
                    onClearSelection={clearSelection}
                    onDelete={settings.confirmDelete ? () => modals.openModal('deleteConfirm') : actions.executeDelete}
                    onExport={() => modals.openModal('export')}

                    onAddToCollection={() => handleOpenCollectionModal('add')}
                    onToggleFavorite={actions.handleBulkFavorite}
                    onTogglePin={actions.handleBulkPin}
                    onToggleMask={actions.handleBulkMask}
                    onCompare={() => modals.openModal('compare')}
                    activeCollectionId={filters.collectionId}
                    onRemoveFromCollection={handleRemoveFromCollection}
                />}

                <ActivityDock />
            </main>
        </div>
    );
};
