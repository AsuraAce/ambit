import * as React from 'react';
import { AppSidebar } from '../features/collections/components/AppSidebar';
import { AppHeader } from './ui/AppHeader';
import { SelectionBar } from '../features/library/components/SelectionBar';
import { FilterPanel } from '../features/filters/components/FilterPanel';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { StatsDashboard } from './ui/Charts';
import { MaintenanceView } from '../features/maintenance/components/MaintenanceView';
import { GridSkeleton } from '../features/library/components/GridSkeleton';
import { PinnedShelf } from '../features/library/components/PinnedShelf';
import { TimelineView } from '../features/library/components/TimelineView';
import { VirtualGrid } from '../features/library/components/VirtualGrid';
import { GridItem } from '../features/library/components/GridItem';
import { AIImage, FilterState, ViewMode, LayoutMode, SortOption, AppSettings } from '../types';
import { Import, Search } from 'lucide-react';

interface AppLayoutProps {
    // Sidebar Props
    collections: any[];
    smartCollections: any[];
    filters: FilterState;
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    isFilterPanelOpen: boolean;
    setIsFilterPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
    onRefreshCollections: () => void;
    colOps: any;
    setExportIds: React.Dispatch<React.SetStateAction<Set<string>>>;
    modals: any;
    addToast: any;

    // Header & Main View Props
    viewMode: ViewMode;
    changeViewMode: (mode: ViewMode) => void;
    searchProps: any;
    layoutMode: LayoutMode;
    setLayoutMode: React.Dispatch<React.SetStateAction<LayoutMode>>;
    sortOption: SortOption;
    setSortOption: (opt: SortOption) => void;
    totalImages: number;
    scopeTotal: number;
    scopeName: string;
    isFiltering: boolean;
    fileOps: any;
    clearAllFilters: () => void;

    // Grid/View Props
    scrollContainerRef: React.RefObject<HTMLDivElement | null>;
    images: AIImage[];
    handlers: any;
    setViewingImageId: (id: string | null) => void;
    settings: AppSettings;
    privacyEnabled: boolean;
    toggleFavorite: (id: string) => void;
    actions: any;
    availableTags: string[];
    selectedIds: Set<Set<string> | any>; // selectedIds is a Set<string>
    handleImageClick: (e: any, id: string, index: number, callback: any) => void;
    setSelectedImageIndex: (index: number | null) => void;
    handleSelectionToggle: (e: any, id: string) => void;
    activeCollection: any;
    activeSmartCollection: any;
    handleRangeSelection: (indices: number[], isAdditive: boolean) => void;
    clearSelection: () => void;
    gridRef: React.RefObject<any>;
    loadMoreImages: () => void;
    handleLayoutChange: (c: number, h: number) => void;
    isSearchFocused: boolean;
    setIsSearchFocused: (f: boolean) => void;
    lastSelectedId: string | null;
    handleRemoveFromCollection: () => void;
    handleOpenCollectionModal: (mode: 'add' | 'move') => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
    collections, smartCollections, filters, setFilters, isFilterPanelOpen, setIsFilterPanelOpen,
    onRefreshCollections, colOps, setExportIds, modals, addToast,
    viewMode, changeViewMode, searchProps, layoutMode, setLayoutMode,
    sortOption, setSortOption, totalImages, scopeTotal, scopeName,
    isFiltering, fileOps, clearAllFilters, scrollContainerRef,
    images, handlers, setViewingImageId, settings, privacyEnabled,
    toggleFavorite, actions, availableTags, selectedIds,
    handleImageClick, setSelectedImageIndex, handleSelectionToggle,
    activeCollection, activeSmartCollection, handleRangeSelection,
    clearSelection, gridRef, loadMoreImages, handleLayoutChange,
    isSearchFocused, setIsSearchFocused, lastSelectedId,
    handleRemoveFromCollection, handleOpenCollectionModal
}) => {
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
                onOpenSlideshow={() => { modals.setSlideshowShuffle(false); modals.openModal('slideshow'); }}
                showSupportPulse={true}
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
                isVisible={isFilterPanelOpen}
            />

            <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-zinc-950 rounded-2xl shadow-2xl shadow-black/20 border border-zinc-200 dark:border-zinc-800/50 overflow-hidden relative">
                <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_0%,rgba(139,174,124,0.08),transparent_70%)] dark:bg-[radial-gradient(circle_at_50%_0%,rgba(139,174,124,0.15),transparent_60%)] z-10" />

                {isSearchFocused && <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setIsSearchFocused(false)} />}

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
                    onImport={() => fileOps.fileInputRef.current?.click()}
                    onSlideshow={() => { modals.setSlideshowShuffle(false); modals.openModal('slideshow'); }}
                    clearAllFilters={clearAllFilters}
                />

                <div className="flex-1 flex overflow-hidden min-h-0 relative">
                    <div ref={scrollContainerRef} className={`flex-1 ${viewMode === 'grid' ? 'overflow-y-auto overflow-x-hidden custom-scrollbar' : 'overflow-hidden'}`}>
                        <ErrorBoundary>
                            {viewMode === 'dashboard' ? (
                                <StatsDashboard images={images} onFilter={(t, v) => { if (t === 'model') setFilters(p => ({ ...p, models: [...p.models, v] })); changeViewMode('grid'); }} />
                            ) : viewMode === 'maintenance' ? (
                                <MaintenanceView
                                    images={images}
                                    onResolveDuplicate={handlers.handleResolveDuplicate}
                                    onRestoreImages={handlers.handleRestoreImages}
                                    onMoveToTrash={handlers.handleMoveToTrash}
                                    onDeleteForever={handlers.handleDeleteForever}
                                    onEmptyTrash={handlers.handleEmptyTrash}
                                    onGroupImages={handlers.handleGroupImages}
                                    onViewImage={(id) => setViewingImageId(id)}
                                    onRegenerateThumbnails={fileOps.regenerateThumbnails}
                                    maskedKeywords={settings.maskedKeywords}
                                    privacyEnabled={privacyEnabled}
                                    onUpdatePrompt={handlers.handleUpdatePrompt}
                                    onUpdateModel={handlers.handleUpdateModel}
                                    onUpdateTool={handlers.handleUpdateTool}
                                    onUpdateNotes={(id, n) => { handlers.handleUpdateNotes(id, n); }}
                                    onRecoverMetadata={() => { if (!settings.enableAI) { addToast("Enable AI features first", "error"); modals.openModal('settings'); } else { modals.openModal('recovery'); } }}
                                    onToggleFavorite={(id) => toggleFavorite(id)}
                                    onTogglePin={actions.handlePinImage}
                                    availableTags={availableTags}
                                />
                            ) : (images.length > 0 || isFiltering) ? (
                                <>
                                    {isFiltering ? (
                                        <GridSkeleton layout={layoutMode} />
                                    ) : (
                                        <>
                                            {(filters.collectionId && viewMode !== 'timeline' && !filters.pinnedOnly) && (
                                                <PinnedShelf
                                                    images={images.filter(i => i.isPinned)}
                                                    isCollapsed={modals.isPinnedShelfCollapsed}
                                                    onToggleCollapse={() => modals.setIsPinnedShelfCollapsed((p: boolean) => !p)}
                                                    selectedIds={selectedIds}
                                                    maskedKeywords={settings.maskedKeywords}
                                                    privacyEnabled={privacyEnabled}
                                                    setImages={handlers.setImages}
                                                    onImageClick={(e, id, index) => handleImageClick(e, id, index, setSelectedImageIndex)}
                                                    onToggleSelection={handleSelectionToggle}
                                                    onToggleFavorite={(e, id) => toggleFavorite(id)}
                                                    onTogglePin={async (e, id) => {
                                                        const img = images.find(i => i.id === id);
                                                        if (img) await actions.handlePinImage(id, !img.isPinned);
                                                    }}
                                                    onContextMenu={(e, id) => handlers.setContextMenu({ x: e.clientX, y: e.clientY, imageId: id })}
                                                    thumbnailSize={settings.thumbnailSize}
                                                    activeThumbnailUrl={activeCollection?.thumbnail || activeSmartCollection?.thumbnail}
                                                    onRangeSelection={handleRangeSelection}
                                                    onBackgroundClick={clearSelection}
                                                />
                                            )}
                                            {viewMode === 'timeline' ? (
                                                <TimelineView
                                                    images={images}
                                                    selectedIds={selectedIds}
                                                    thumbnailSize={settings.thumbnailSize}
                                                    sortOption={sortOption}
                                                    maskedKeywords={settings.maskedKeywords}
                                                    privacyEnabled={privacyEnabled}
                                                    onImageClick={(e, id, index) => handleImageClick(e, id, index, setSelectedImageIndex)}
                                                    onSelectionToggle={handleSelectionToggle}
                                                    onToggleFavorite={(e, id) => { toggleFavorite(id); }}
                                                    onTogglePin={async (e, id) => {
                                                        const img = images.find(i => i.id === id);
                                                        if (img) await actions.handlePinImage(id, !img.isPinned);
                                                    }}
                                                    onContextMenu={(e, id) => handlers.setContextMenu({ x: e.clientX, y: e.clientY, imageId: id })}
                                                    onRangeSelection={handleRangeSelection}
                                                    onBackgroundClick={clearSelection}
                                                />
                                            ) : (
                                                <VirtualGrid<AIImage>
                                                    ref={gridRef}
                                                    items={(filters.collectionId && !filters.pinnedOnly) ? images.filter(i => !i.isPinned) : images}
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
                                                        const itemsInGrid = (filters.collectionId && !filters.pinnedOnly) ? images.filter(i => !i.isPinned) : images;
                                                        const pinnedInShelf = (filters.collectionId && !filters.pinnedOnly) ? images.filter(i => i.isPinned) : [];
                                                        const pinnedCount = pinnedInShelf.length;
                                                        const globalIndices = indices.map(idx => idx + pinnedCount);
                                                        handleRangeSelection(globalIndices, isAdditive);
                                                    }}
                                                    onBackgroundClick={clearSelection}
                                                    renderItem={(img, style, index, layout) => {
                                                        const pinnedInShelf = (filters.collectionId && !filters.pinnedOnly) ? images.filter(i => i.isPinned) : [];
                                                        const pinnedCount = pinnedInShelf.length;
                                                        return (
                                                            <GridItem
                                                                key={img.id}
                                                                image={img}
                                                                style={style}
                                                                layoutPos={layout}
                                                                index={index + pinnedCount}
                                                                isSelected={selectedIds.has(img.id)}
                                                                selectedIds={selectedIds}
                                                                maskedKeywords={settings.maskedKeywords}
                                                                privacyEnabled={privacyEnabled}
                                                                setImages={handlers.setImages}
                                                                onClick={(e, id, idx) => handleImageClick(e, id, idx, setSelectedImageIndex)}
                                                                onToggleSelection={handleSelectionToggle}
                                                                onToggleFavorite={(e, id) => toggleFavorite(id)}
                                                                onTogglePin={async (e, id) => {
                                                                    const img = images.find(i => i.id === id);
                                                                    if (img) await actions.handlePinImage(id, !img.isPinned);
                                                                }}
                                                                onContextMenu={(e, id) => handlers.setContextMenu({ x: e.clientX, y: e.clientY, imageId: id })}
                                                                isThumbnail={((activeCollection?.customThumbnail || activeSmartCollection?.customThumbnail) === img.id || (activeCollection?.thumbnail || activeSmartCollection?.thumbnail) === img.id)}
                                                            />
                                                        );
                                                    }}
                                                />
                                            )}
                                        </>
                                    )}
                                </>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-gray-500">
                                    {totalImages === 0 && !isFiltering ? (
                                        <>
                                            <div className="p-6 bg-slate-100 dark:bg-slate-800/50 rounded-full mb-6 border border-gray-200 dark:border-white/5 animate-in zoom-in duration-500">
                                                <Import className="w-12 h-12 text-sage-500 opacity-50" />
                                            </div>
                                            <h3 className="text-xl font-bold mb-2 text-gray-800 dark:text-gray-300">Your Ambit is empty</h3>
                                            <button onClick={() => fileOps.fileInputRef.current?.click()} className="px-6 py-3 bg-sage-600 hover:bg-sage-500 text-white rounded-xl font-bold shadow-lg shadow-sage-500/20 transition-all hover:scale-105">Import Images</button>
                                        </>
                                    ) : (
                                        <>
                                            <Search className="w-12 h-12 mb-4 opacity-20" />
                                            <p className="text-gray-500 dark:text-gray-400">No images match your current filters.</p>
                                            <button onClick={clearAllFilters} className="mt-4 text-sage-600 dark:text-sage-400 hover:text-sage-800 dark:hover:text-sage-300 text-sm underline">Clear all filters</button>
                                        </>
                                    )}
                                </div>
                            )}
                        </ErrorBoundary>
                    </div>
                </div>

                <SelectionBar
                    selectedIds={selectedIds}
                    filteredImages={images}
                    lastSelectedId={lastSelectedId}
                    isExporting={fileOps.isExporting}
                    confirmDelete={settings.confirmDelete}
                    privacyEnabled={privacyEnabled}
                    maskedKeywords={settings.maskedKeywords}
                    onClearSelection={clearSelection}
                    onDelete={settings.confirmDelete ? () => modals.openModal('deleteConfirm') : actions.executeDelete}
                    onExport={() => modals.openModal('export')}
                    onRename={() => modals.openModal('rename')}
                    onAddToCollection={() => handleOpenCollectionModal('add')}
                    onToggleFavorite={actions.handleBulkFavorite}
                    onTogglePin={actions.handleBulkPin}
                    onToggleMask={actions.handleBulkMask}
                    onCompare={() => modals.openModal('compare')}
                    activeCollectionId={filters.collectionId}
                    onRemoveFromCollection={handleRemoveFromCollection}
                />
            </main>
        </div>
    );
};
