import * as React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { HashRouter } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Search, Import, Loader2 } from 'lucide-react';
import { AIImage, ViewMode, LayoutMode, ContextMenuState, GeneratorTool } from './types';
import { FilterPanel } from './components/FilterPanel';
import { ImageViewer } from './components/ImageViewer';
import { StatsDashboard } from './components/Charts';
import { TimelineView } from './components/TimelineView';
import { AppContextMenu } from './components/AppContextMenu';
import { VirtualGrid, VirtualGridHandle } from './components/VirtualGrid';
import { GridItem } from './components/GridItem';
import { MaintenanceView } from './components/MaintenanceView';
import { OnboardingWizard } from './components/OnboardingWizard';
import { GlobalModals } from './components/GlobalModals';
import { AppSidebar } from './components/AppSidebar';
import { AppHeader } from './components/AppHeader';
import { TitleBar } from './components/TitleBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SelectionBar } from './components/SelectionBar';
import { PinnedShelf } from './components/PinnedShelf';
import { LoadingScreen } from './components/LoadingScreen';
import { GridSkeleton } from './components/GridSkeleton';
import { DragOverlay } from './components/DragOverlay';
import { useToast } from './hooks/useToast';
import { useLibraryContext } from './hooks/useLibraryContext';
import { isImageMasked } from './utils/maskingUtils';

// Hooks
import { useSelection } from './hooks/useSelection';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useSearch } from './hooks/useSearch';
import { useFileOperations } from './hooks/useFileOperations';
import { useCollectionOperations } from './hooks/useCollectionOperations';
import { useTheme } from './hooks/useTheme';
import { useDragDrop } from './hooks/useDragDrop';
import { useFolderMonitor } from './hooks/useFolderMonitor';
import { useModalManager } from './hooks/useModalManager';
import { useAppHandlers } from './hooks/useAppHandlers';
import { useAppActions } from './hooks/useAppActions';

export default function App() {
    const { addToast } = useToast();

    // --- Global Data Context ---
    const {
        isLoaded, images, setImages, collections, setCollections,
        smartCollections, setSmartCollections, settings, setSettings,
        setRecentSearches, refreshCollectionThumbnails,
        filters, setFilters, sortOption, setSortOption, clearAllFilters,
        totalImages, loadMoreImages,
        privacyEnabled, setPrivacyEnabled,
        isFiltering, toggleFavorite,
        refreshMaintenanceCounts
    } = useLibraryContext();

    // --- Theme Hook ---
    const { toggleTheme } = useTheme(settings.theme, setSettings);

    // Generate Tags from currently loaded images (View-based tags)
    const availableTags = React.useMemo(() => {
        const tags = new Set<string>();
        // Only scan a subset to avoid lag if view is large
        images.slice(0, 500).forEach(img => {
            if (typeof img.metadata.positivePrompt === 'string') {
                img.metadata.positivePrompt.split(',').forEach(t => {
                    const clean = t.trim().toLowerCase();
                    if (clean.length > 2 && clean.length < 40) tags.add(clean);
                });
            }
        });
        return Array.from(tags).sort();
    }, [images]);

    const {
        selectedIds, setSelectedIds, lastSelectedId, setLastSelectedId,
        handleImageClick, handleSelectionToggle, handleRangeSelection, clearSelection
    } = useSelection(images); // Selection now works on the "View" (images)


    // --- UI State ---
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const [layoutMode, setLayoutMode] = useState<LayoutMode>('masonry');
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(true);
    const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
    const [viewingImageId, setViewingImageId] = useState<string | null>(null);
    const [showSupportPulse, setShowSupportPulse] = useState(true);
    const [isSearchFocused, setIsSearchFocused] = useState(false);

    // Interaction State
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [gridLayout, setGridLayout] = useState<{ columns: number, rowHeight: number }>({ columns: 1, rowHeight: 200 });

    const handleLayoutChange = useCallback((c: number, h: number) => {
        setGridLayout(prev => {
            if (prev.columns === c && prev.rowHeight === h) return prev;
            return { columns: c, rowHeight: h };
        });
    }, []);

    // --- UI Hooks ---
    const modals = useModalManager();
    const handlers = useAppHandlers({ setImages, refreshMaintenanceCounts });

    // --- Specialized Logic Hooks ---
    const search = useSearch({
        filters,
        setFilters,
        settings,
        setRecentSearches,
        availableTags: availableTags,
        onOpenSettings: () => { modals.setInitialSettingsTab('experiments'); modals.openModal('settings'); }
    });

    const fileOps = useFileOperations({
        images,
        setImages,
        refreshCollectionThumbnails,
        settings
    });

    const colOps = useCollectionOperations({
        collections,
        setCollections,
        smartCollections,
        setSmartCollections,
        images,
        refreshCollectionThumbnails,
        setFilters,
        activeCollectionId: filters.collectionId
    });

    const actions = useAppActions({
        viewingImageId,
        selectedImageIndex,
        setSelectedImageIndex,
        fileOps,
        selectedIds,
        setSelectedIds,
        lastSelectedId,
        modalManager: modals // Pass shared modal state
    });

    // Calculate Scope Total for Smart Counter
    const scopeTotal = filters.collectionId && collections.find(c => c.id === filters.collectionId)
        ? collections.find(c => c.id === filters.collectionId)!.imageIds.length
        : totalImages;

    // --- Extracted Hooks ---
    const { isDraggingExternal } = useDragDrop({
        onImportPaths: fileOps.handleImportPaths,
        onImportFiles: (files) => fileOps.handleImportFiles(Array.from(files))
    });

    useFolderMonitor({
        isLoaded,
        monitoredFolders: settings.monitoredFolders,
        onScan: fileOps.scanDirectory,
        addToast
    });

    // Refs
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<VirtualGridHandle>(null);

    useEffect(() => {
        const timer = setTimeout(() => setShowSupportPulse(false), 5000);
        return () => clearTimeout(timer);
    }, []);

    // --- Global Shortcuts Hook ---
    useGlobalShortcuts({
        viewMode,
        selectedIds,
        filteredImages: images, // Map to images
        lastSelectedId,
        selectedImageIndex,
        gridRef,
        searchInputRef: search.inputRef,
        setSelectedImageIndex,
        setSelectedIds,
        setLastSelectedId,
        clearSelection,
        handleDeleteViewerImage: actions.handleDeleteViewerImage,
        handleBulkDelete: () => settings.confirmDelete ? modals.openModal('deleteConfirm') : actions.executeDelete(),
        togglePrivacyMode: actions.handleTogglePrivacy,
        toggleMasking: () => actions.handleBulkMask(),
        toggleFavorite: actions.handleShortcutFavorite,
        togglePin: actions.handleShortcutPin,
        openRename: () => modals.openModal('rename'),
        openCollection: () => modals.openModal('addToCollection'),
        isModalOpen: modals.isAnyModalOpen,
        closeAllModals: modals.closeAllModals,
        toggleShortcuts: () => { modals.setShortcutsModalTab('shortcuts'); modals.openModal('shortcuts'); },
        toggleCommandPalette: () => modals.openModal('commandPalette'),
        onCloseViewer: () => setSelectedImageIndex(null)
    });

    const activeCollection = filters.collectionId ? collections.find(c => c.id === filters.collectionId) : undefined;

    // Determine which image to show in viewer
    const displayedViewerImage = viewingImageId
        ? images.find(i => i.id === viewingImageId)
        : (selectedImageIndex !== null ? images[selectedImageIndex] : null);

    // --- Render ---
    if (!isLoaded) return <LoadingScreen />;

    return (
        <HashRouter>
            <div className="h-screen bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-gray-100 font-sans selection:bg-sage-500/30 selection:text-white transition-colors duration-300 overflow-hidden flex flex-col">
                <TitleBar />

                <div className="flex-1 flex overflow-hidden min-h-0 pt-10 pb-4 px-4 gap-4">

                    {/* --- Sidebar --- */}
                    <AppSidebar
                        viewMode={viewMode}
                        setViewMode={setViewMode}
                        filters={filters}
                        setFilters={setFilters}
                        isFilterPanelOpen={isFilterPanelOpen}
                        setIsFilterPanelOpen={setIsFilterPanelOpen}
                        onOpenSettings={() => { modals.setInitialSettingsTab('general'); modals.openModal('settings'); }}
                        onOpenShortcuts={() => { modals.setShortcutsModalTab('shortcuts'); modals.openModal('shortcuts'); }}
                        onOpenDonation={() => modals.openModal('donation')}
                        onOpenSlideshow={() => { modals.setSlideshowShuffle(false); modals.openModal('slideshow'); }}
                        showSupportPulse={showSupportPulse}
                    />

                    <FilterPanel
                        isVisible={isFilterPanelOpen}
                        filters={filters}
                        setFilters={setFilters}
                        filteredImages={images}
                        onCreateCollection={colOps.createCollection}
                        onSaveSmartCollection={colOps.saveSmartCollection}
                        onDeleteSmartCollection={colOps.deleteSmartCollection}
                        onDropOnCollection={(colId, data) => {
                            try {
                                const ids = JSON.parse(data);
                                colOps.addImagesToCollection(ids, colId);
                                const col = collections.find(c => c.id === colId);
                                addToast(`Added ${ids.length} images to ${col?.name || 'collection'}`, 'success');
                            } catch { }
                        }}
                        onRenameCollection={colOps.renameCollection}
                        onDeleteCollection={(id) => {
                            modals.setCollectionToDelete(id);
                            modals.openModal('deleteCollection');
                        }}
                        onToggleArchiveCollection={colOps.toggleArchiveCollection}
                        onTogglePinCollection={colOps.togglePinCollection}
                        onSetCollectionColor={colOps.setCollectionColor}
                        onResetCollectionThumbnail={colOps.resetCollectionThumbnail}
                        onPlayCollection={(id) => {
                            setFilters(prev => ({ ...prev, collectionId: id }));
                            modals.setSlideshowShuffle(false);
                            modals.openModal('slideshow');
                        }}
                        onExportCollection={(id) => {
                            const col = collections.find(c => c.id === id);
                            if (col && col.imageIds.length > 0) {
                                setSelectedIds(new Set(col.imageIds));
                                modals.openModal('export');
                            }
                        }}
                    />

                    <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-zinc-950 rounded-2xl shadow-2xl shadow-black/20 border border-zinc-200 dark:border-zinc-800/50 overflow-hidden relative">
                        {/* Spotlight Effect */}
                        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_0%,rgba(139,174,124,0.08),transparent_70%)] dark:bg-[radial-gradient(circle_at_50%_0%,rgba(139,174,124,0.15),transparent_60%)] z-10" />

                        {isSearchFocused && <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setIsSearchFocused(false)} />}

                        <AppHeader
                            viewMode={viewMode}
                            filters={filters}
                            setFilters={setFilters}
                            searchProps={{
                                ...search,
                                isFocused: isSearchFocused,
                                onFocus: () => setIsSearchFocused(true),
                                onBlur: () => setTimeout(() => setIsSearchFocused(false), 200)
                            }}
                            layoutMode={layoutMode}
                            setLayoutMode={setLayoutMode}
                            sortOption={sortOption}
                            setSortOption={setSortOption}
                            displayedCount={images.length}
                            totalCount={scopeTotal}
                            onImport={() => fileOps.fileInputRef.current?.click()}
                            onSlideshow={() => { modals.setSlideshowShuffle(false); modals.openModal('slideshow'); }}
                            clearAllFilters={clearAllFilters}
                            isImporting={fileOps.isImporting}
                        />

                        <div className="flex-1 flex overflow-hidden min-h-0 relative">


                            <div ref={scrollContainerRef} className={`flex-1 ${viewMode === 'grid' ? 'overflow-y-auto overflow-x-hidden custom-scrollbar' : 'overflow-hidden'}`}>
                                <ErrorBoundary>
                                    {viewMode === 'dashboard' ? (
                                        <StatsDashboard images={images} onFilter={(t, v) => { if (t === 'model') setFilters(p => ({ ...p, models: [...p.models, v] })); setViewMode('grid'); }} />
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
                                            onUpdateNotes={(id, n) => { setImages(p => p.map(i => i.id === id ? { ...i, notes: n } : i)); addToast('Saved', 'success'); }}
                                            onRecoverMetadata={() => { if (!settings.enableAI) { addToast("Enable AI features first", "error"); modals.openModal('settings'); } else { modals.openModal('recovery'); } }}
                                            onToggleFavorite={(id) => toggleFavorite(id)}
                                            onTogglePin={actions.handlePinImage}
                                            availableTags={availableTags}
                                        />
                                    ) : images.length > 0 ? (
                                        <>
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
                                                    onContextMenu={(e, id) => { setContextMenu({ x: e.clientX, y: e.clientY, imageId: id }); }}
                                                    onRangeSelection={handleRangeSelection}
                                                    onBackgroundClick={clearSelection}
                                                />
                                            ) : (
                                                <>
                                                    <PinnedShelf
                                                        images={images.filter(i => i.isPinned)}
                                                        isCollapsed={modals.isPinnedShelfCollapsed}
                                                        onToggleCollapse={() => modals.setIsPinnedShelfCollapsed(p => !p)}
                                                        selectedIds={selectedIds}
                                                        maskedKeywords={settings.maskedKeywords}
                                                        privacyEnabled={privacyEnabled}
                                                        setImages={setImages}
                                                        onImageClick={(e, id, index) => handleImageClick(e, id, index, setSelectedImageIndex)}
                                                        onToggleSelection={handleSelectionToggle}
                                                        onToggleFavorite={(e, id) => toggleFavorite(id)}
                                                        onTogglePin={async (e, id) => {
                                                            const img = images.find(i => i.id === id);
                                                            if (img) await actions.handlePinImage(id, !img.isPinned);
                                                        }}
                                                        onContextMenu={(e, id) => setContextMenu({ x: e.clientX, y: e.clientY, imageId: id })}
                                                        thumbnailSize={settings.thumbnailSize}
                                                        activeThumbnailUrl={activeCollection?.thumbnail}
                                                        onRangeSelection={handleRangeSelection}
                                                        onBackgroundClick={clearSelection}
                                                    />
                                                    {isFiltering ? (
                                                        <GridSkeleton layout={layoutMode} />
                                                    ) : (
                                                        <VirtualGrid<AIImage>
                                                            ref={gridRef}
                                                            items={images.filter(i => !i.isPinned)}
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
                                                                const pinnedCount = images.filter(i => i.isPinned).length;
                                                                const globalIndices = indices.map(idx => idx + pinnedCount);
                                                                handleRangeSelection(globalIndices, isAdditive);
                                                            }}
                                                            onBackgroundClick={clearSelection}
                                                            renderItem={(img, style, index, layout) => (
                                                                <GridItem
                                                                    key={img.id}
                                                                    image={img}
                                                                    style={style}
                                                                    layoutPos={layout}
                                                                    index={index + (images.filter(i => i.isPinned).length)}
                                                                    isSelected={selectedIds.has(img.id)}
                                                                    selectedIds={selectedIds}
                                                                    maskedKeywords={settings.maskedKeywords}
                                                                    privacyEnabled={privacyEnabled}
                                                                    setImages={setImages}
                                                                    onClick={(e, id, idx) => handleImageClick(e, id, idx, setSelectedImageIndex)}
                                                                    onToggleSelection={handleSelectionToggle}
                                                                    onToggleFavorite={(e, id) => toggleFavorite(id)}
                                                                    onTogglePin={async (e, id) => {
                                                                        const img = images.find(i => i.id === id);
                                                                        if (img) await actions.handlePinImage(id, !img.isPinned);
                                                                    }}
                                                                    onContextMenu={(e, id) => setContextMenu({ x: e.clientX, y: e.clientY, imageId: id })}
                                                                    isThumbnail={activeCollection ? (activeCollection.customThumbnail === img.id || activeCollection.thumbnail === img.id) : false}
                                                                />
                                                            )}
                                                        />
                                                    )}
                                                </>
                                            )}
                                        </>
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center text-gray-500">
                                            {(!filters.searchQuery && filters.models.length === 0 && !filters.collectionId && !filters.favoritesOnly && filters.dateRange === 'all') ? (
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
                            onAddToCollection={() => modals.openModal('addToCollection')}
                            onToggleFavorite={actions.handleBulkFavorite}
                            onTogglePin={actions.handleBulkPin}
                            onToggleMask={actions.handleBulkMask}
                            onCompare={() => modals.openModal('compare')}
                        />
                    </main>
                </div>

                {/* Overlays & Portals */}
                <OnboardingWizard isOpen={!settings.hasCompletedOnboarding} onComplete={(s) => { setSettings(p => ({ ...p, ...s })); addToast("Setup complete!", "success"); }} initialApiKey={settings.googleGeminiApiKey || process.env.API_KEY} />
                <input type="file" ref={fileOps.fileInputRef} className="hidden" multiple accept="image/png,image/jpeg,image/webp" onChange={fileOps.importImages} />
                <DragOverlay isVisible={isDraggingExternal} />

                <GlobalModals
                    modals={modals.modals}
                    setModals={modals.setModals}
                    selectedIds={selectedIds}
                    filteredImages={images}
                    onSettingsSave={(s) => { setSettings(s); addToast('Settings saved', 'success'); }}
                    onExportConfirm={actions.handleExportConfirm}
                    onRename={actions.handleRename}
                    onDeleteConfirm={actions.executeDelete}
                    onDeleteCollectionConfirm={() => {
                        if (modals.collectionToDelete) colOps.deleteCollection(modals.collectionToDelete);
                        modals.closeModal('deleteCollection');
                        modals.setCollectionToDelete(null);
                    }}
                    onRecoverMetadata={actions.executeMetadataRecovery}
                    onAddImagesToCollection={colOps.addImagesToCollection}
                    pendingViewerDeleteId={modals.pendingViewerDeleteId}
                    collectionToDeleteId={modals.collectionToDelete}
                    isRecoveringMetadata={fileOps.isRecoveringMetadata}
                    isExporting={fileOps.isExporting}
                    slideshowShuffle={modals.slideshowShuffle}
                    initialSettingsTab={modals.initialSettingsTab}
                    shortcutsModalTab={modals.shortcutsModalTab}
                    commandPaletteProps={{
                        onNavigate: (mode: any) => setViewMode(mode),
                        onToggleTheme: toggleTheme,
                        onOpenSettings: () => { modals.setInitialSettingsTab('general'); modals.openModal('settings'); },
                        onImport: () => fileOps.fileInputRef.current?.click(),
                        onCreateCollection: () => { setIsFilterPanelOpen(true); setTimeout(() => document.getElementById('create-col-btn')?.click(), 100); },
                        onToggleAI: search.toggleAiSearch
                    }}
                />

                <AnimatePresence>
                    {displayedViewerImage && (
                        <ImageViewer
                            key="image-viewer"
                            image={displayedViewerImage}
                            isOpen={true}
                            onClose={() => { setSelectedImageIndex(null); setViewingImageId(null); }}
                            onNext={() => {
                                if (selectedImageIndex !== null && selectedImageIndex < images.length - 1) {
                                    setSelectedImageIndex(selectedImageIndex + 1);
                                }
                            }}
                            onPrev={() => {
                                if (selectedImageIndex !== null && selectedImageIndex > 0) {
                                    setSelectedImageIndex(selectedImageIndex - 1);
                                }
                            }}
                            onUpdatePrompt={(id, prompt) => handlers.handleUpdatePrompt(id, prompt)}
                            onUpdateModel={(id, model) => handlers.handleUpdateModel(id, model)}
                            onUpdateTool={(id, tool) => handlers.handleUpdateTool(id, tool)}
                            onToggleFavorite={(id) => toggleFavorite(id)}
                            onTogglePin={(id, p) => actions.handlePinImage(id, p)}
                            onDelete={(id) => actions.handleDeleteViewerImage(id)}
                            onOpenSettings={() => { modals.setInitialSettingsTab('experiments'); modals.openModal('settings'); }}
                            onUpdateNotes={(id, n) => { setImages(p => p.map(i => i.id === id ? { ...i, notes: n } : i)); addToast('Saved', 'success'); }}
                            onSearch={(term) => { setFilters(p => ({ ...p, searchQuery: term })); setRecentSearches(prev => [term, ...prev.filter(s => s !== term)].slice(0, 8)); }}
                            onRevertMetadata={(id) => { setImages(p => p.map(i => i.id === id && i.originalMetadata ? { ...i, metadata: i.originalMetadata, originalMetadata: undefined } : i)); addToast('Reverted', 'success'); }}
                            onAddToCollection={(id, colId) => colOps.addImagesToCollection([id], colId)}
                            availableTags={availableTags}
                            isSidebarOpen={!settings.defaultTheaterMode}
                            onToggleSidebar={() => setSettings(p => ({ ...p, defaultTheaterMode: !p.defaultTheaterMode }))}
                        />
                    )}
                </AnimatePresence>

                <AppContextMenu
                    contextMenu={contextMenu}
                    onClose={() => setContextMenu(null)}
                    images={images}
                    actions={actions}
                    fileOps={fileOps}
                    colOps={colOps}
                    modals={modals}
                    filters={filters}
                    privacyEnabled={privacyEnabled}
                    refreshCollectionThumbnails={refreshCollectionThumbnails}
                    setCollections={setCollections}
                />
            </div>
        </HashRouter >
    );
}
