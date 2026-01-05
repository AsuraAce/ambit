import * as React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { HashRouter } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { AppLayout } from './components/AppLayout';
import { GlobalModals } from './components/GlobalModals';
import { AppContextMenu } from './components/ui/AppContextMenu';
import { OnboardingWizard } from './components/ui/OnboardingWizard';
import { ImageViewer } from './features/viewer/components/ImageViewer';
import { LoadingScreen } from './components/ui/LoadingScreen';
import { TitleBar } from './components/ui/TitleBar';
import { DragOverlay } from './components/ui/DragOverlay';
import { useToast } from './hooks/useToast';
import { useSearchStore } from './stores/searchStore';
import { useSettingsStore } from './stores/settingsStore';
import { useCollectionStore } from './stores/collectionStore';
import { useAppHandlers } from './hooks/useAppHandlers';
import { VirtualGridHandle } from './features/library/components/VirtualGrid';
import { ViewMode, LayoutMode, AIImage, ContextMenuState, Collection, SmartCollection } from './types';

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
import { useAppActions } from './hooks/useAppActions';

export default function App() {
    const { addToast } = useToast();
    const modals = useModalManager();

    // --- Interaction State ---
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const [layoutMode, setLayoutMode] = useState<LayoutMode>('masonry');
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(true);
    const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
    const [viewingImageId, setViewingImageId] = useState<string | null>(null);
    const [showSupportPulse, setShowSupportPulse] = useState(true);
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [exportIds, setExportIds] = useState<Set<string>>(new Set());
    const [gridLayout, setGridLayout] = useState<{ columns: number, rowHeight: number }>({ columns: 1, rowHeight: 200 });

    // --- Store Subscriptions ---
    const isSettingsLoaded = useSettingsStore(s => s.isLoaded);
    const settings = useSettingsStore(s => s.settings);
    const setSettings = useSettingsStore(s => s.setSettings);

    const isCollectionsLoaded = useCollectionStore(s => s.isLoaded);
    const allCollections = useCollectionStore(s => s.collections);
    const collections = React.useMemo(() => allCollections.filter(c => !c.filters), [allCollections]);
    const smartCollections = React.useMemo(() => allCollections.filter(c => !!c.filters) as SmartCollection[], [allCollections]);
    const refreshCollections = useCollectionStore(s => s.refreshCollections);

    const images = useSearchStore(s => s.images);
    const setImages = useSearchStore(s => s.setImages);
    const filters = useSearchStore(s => s.filters);
    const setFilters = useSearchStore(s => s.setFilters);
    const sortOption = useSearchStore(s => s.sortOption);
    const setSortOption = useSearchStore(s => s.setSortOption);
    const totalImages = useSearchStore(s => s.totalImages);
    const globalTotal = useSearchStore(s => s.globalTotal);
    const isFiltering = useSearchStore(s => s.isFiltering);
    const toggleFavorite = useSearchStore(s => s.toggleFavorite);
    const clearAllFilters = useSearchStore(s => s.clearAllFilters);
    const recentSearches = useSearchStore(s => s.recentSearches);
    const setRecentSearches = useSearchStore(s => s.setRecentSearches);

    const isLoaded = isSettingsLoaded && isCollectionsLoaded;

    // --- UI Logic Hooks ---
    const { toggleTheme } = useTheme(settings.theme, setSettings);
    const {
        selectedIds, setSelectedIds, lastSelectedId, setLastSelectedId,
        handleImageClick, handleSelectionToggle, handleRangeSelection, clearSelection
    } = useSelection(images);

    const setAllCollections = useCollectionStore(s => s.setCollections);
    const refreshCollectionThumbnails = useCollectionStore(s => s.refreshCollections);
    const refreshMaintenanceCounts = useCallback(() => { }, []); // Placeholder

    const handlers = useAppHandlers({ images, setImages, refreshMaintenanceCounts });

    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const { toggleAiSearch, submitSearch, inputRef, isAiSearchEnabled, isSearchingAi } = useSearch({
        filters,
        setFilters,
        settings,
        setRecentSearches,
        availableTags: availableTags,
        onOpenSettings: useCallback(() => { modals.setInitialSettingsTab('experiments'); modals.openModal('settings'); }, [modals])
    });

    const fileOps = useFileOperations({
        images,
        setImages,
        refreshCollectionThumbnails,
        settings
    });

    const colOps = useCollectionOperations({
        collections,
        smartCollections,
        setAllCollections,
        refreshCollections,
        setFilters,
        setImages,
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
        modalManager: modals
    });

    const { isDraggingExternal } = useDragDrop({
        onImportPaths: fileOps.handleImportPaths,
        onImportFiles: (files) => fileOps.handleImportFiles(Array.from(files))
    });

    useFolderMonitor({
        isLoaded,
        monitoredFolders: settings.monitoredFolders,
        onScan: (folders) => fileOps.handleImportFolders(folders),
        addToast
    });

    // --- Callbacks ---
    const loadMoreImages = React.useCallback(() => {
        useSearchStore.getState().fetchData(true, [...collections, ...smartCollections]);
    }, [collections, smartCollections]);

    const changeViewMode = useCallback((newMode: ViewMode) => {
        if (newMode === viewMode) return;
        setViewMode(newMode);
        clearSelection();
    }, [viewMode, clearSelection]);

    const handleLayoutChange = useCallback((c: number, h: number) => {
        setGridLayout(prev => {
            if (prev.columns === c && prev.rowHeight === h) return prev;
            return { columns: c, rowHeight: h };
        });
    }, []);

    const onMoveToCollection = useCallback(() => {
        if (filters.collectionId) {
            modals.setAddToCollectionMode('move');
            modals.setSourceCollectionId(filters.collectionId);
            modals.openModal('addToCollection');
        }
        setContextMenu(null);
    }, [filters.collectionId, modals]);

    const handleRemoveFromCollection = useCallback(async () => {
        if (filters.collectionId && selectedIds.size > 0) {
            await colOps.removeImagesFromCollection(Array.from(selectedIds), filters.collectionId);
            clearSelection();
            addToast(`Removed ${selectedIds.size} images from collection`, 'info');
        }
    }, [filters.collectionId, selectedIds, colOps, clearSelection, addToast]);

    const handleOpenCollectionModal = useCallback((mode: 'add' | 'move' = 'add') => {
        modals.setAddToCollectionMode(mode);
        if (mode === 'add') modals.setSourceCollectionId(null);
        modals.openModal('addToCollection');
    }, [modals]);

    // --- Derived Memos ---
    const searchProps = React.useMemo(() => ({
        isAiSearchEnabled,
        isSearchingAi,
        inputRef,
        toggleAiSearch,
        submitSearch,
        isFocused: isSearchFocused,
        onFocus: () => setIsSearchFocused(true),
        onBlur: () => setTimeout(() => setIsSearchFocused(false), 200)
    }), [isAiSearchEnabled, isSearchingAi, inputRef, toggleAiSearch, submitSearch, isSearchFocused]);

    const activeCollection = filters.collectionId ? collections.find(c => c.id === filters.collectionId) : null;
    const activeSmartCollection = !activeCollection && filters.collectionId ? smartCollections.find(c => c.id === filters.collectionId) : null;
    const scopeName = activeCollection ? activeCollection.name : (activeSmartCollection ? activeSmartCollection.name : "Library");
    const scopeTotal = Math.max(
        activeCollection ? (activeCollection.count ?? activeCollection.imageIds.length) :
            (activeSmartCollection ? totalImages : globalTotal),
        totalImages
    );

    const displayedViewerImage = viewingImageId
        ? images.find(i => i.id === viewingImageId)
        : (selectedImageIndex !== null ? images[selectedImageIndex] : null);

    // --- Effects ---
    useEffect(() => {
        const timer = setTimeout(() => {
            const tags = new Set<string>();
            images.slice(0, 500).forEach(img => {
                if (typeof img.metadata.positivePrompt === 'string') {
                    img.metadata.positivePrompt.split(',').forEach(t => {
                        const clean = t.trim().toLowerCase();
                        if (clean.length > 2 && clean.length < 40) tags.add(clean);
                    });
                }
            });
            setAvailableTags(Array.from(tags).sort());
        }, 1000);
        return () => clearTimeout(timer);
    }, [images]);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<VirtualGridHandle>(null);

    useEffect(() => {
        const timer = setTimeout(() => setShowSupportPulse(false), 5000);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        clearSelection();
    }, [filters.collectionId, clearSelection]);

    // --- Global Shortcuts Hook ---
    useGlobalShortcuts({
        viewMode,
        selectedIds,
        filteredImages: images,
        lastSelectedId,
        selectedImageIndex,
        gridRef,
        searchInputRef: inputRef,
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
        openCollection: () => handleOpenCollectionModal('add'),
        isModalOpen: modals.isAnyModalOpen,
        closeAllModals: modals.closeAllModals,
        toggleShortcuts: () => { modals.setShortcutsModalTab('shortcuts'); modals.openModal('shortcuts'); },
        toggleCommandPalette: () => modals.openModal('commandPalette'),
        onCloseViewer: () => setSelectedImageIndex(null),
        handleRemoveFromCollection: handleRemoveFromCollection,
    });

    if (!isLoaded) return <LoadingScreen />;


    return (
        <HashRouter>
            <div className="h-screen bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-white flex flex-col overflow-hidden font-sans selection:bg-sage-500/30">
                <TitleBar />

                <AppLayout

                    filters={filters}
                    setFilters={setFilters}
                    isFilterPanelOpen={isFilterPanelOpen}
                    setIsFilterPanelOpen={setIsFilterPanelOpen}
                    colOps={colOps}
                    setExportIds={setExportIds}
                    modals={modals}
                    addToast={addToast}
                    viewMode={viewMode}
                    changeViewMode={changeViewMode}
                    searchProps={searchProps}
                    layoutMode={layoutMode}
                    setLayoutMode={setLayoutMode}
                    sortOption={sortOption}
                    setSortOption={setSortOption}
                    totalImages={totalImages}
                    scopeTotal={scopeTotal}
                    scopeName={scopeName}
                    isFiltering={isFiltering}
                    fileOps={fileOps}
                    clearAllFilters={clearAllFilters}
                    scrollContainerRef={scrollContainerRef}
                    images={images}
                    handlers={{ ...handlers, setImages, setContextMenu }}
                    setViewingImageId={setViewingImageId}

                    toggleFavorite={toggleFavorite}
                    actions={actions}
                    availableTags={availableTags}
                    selectedIds={selectedIds}
                    handleImageClick={handleImageClick}
                    setSelectedImageIndex={setSelectedImageIndex}
                    handleSelectionToggle={handleSelectionToggle}
                    activeCollection={activeCollection}
                    activeSmartCollection={activeSmartCollection}
                    handleRangeSelection={handleRangeSelection}
                    clearSelection={clearSelection}
                    gridRef={gridRef}
                    loadMoreImages={loadMoreImages}
                    handleLayoutChange={handleLayoutChange}
                    isSearchFocused={isSearchFocused}
                    setIsSearchFocused={setIsSearchFocused}
                    lastSelectedId={lastSelectedId}
                    handleRemoveFromCollection={handleRemoveFromCollection}
                    handleOpenCollectionModal={handleOpenCollectionModal}
                />

                {/* Overlays & Portals */}
                <OnboardingWizard
                    isOpen={!settings.hasCompletedOnboarding}
                    onComplete={(s) => { setSettings(p => ({ ...p, ...s })); addToast("Setup complete!", "success"); }}
                    initialApiKey={settings.googleGeminiApiKey || process.env.API_KEY}
                />
                <input
                    type="file"
                    ref={fileOps.fileInputRef}
                    className="hidden"
                    multiple
                    accept="image/png,image/jpeg,image/webp"
                    onChange={fileOps.importImages}
                />
                <DragOverlay isVisible={isDraggingExternal} />

                <GlobalModals
                    modals={modals.modals}
                    setModals={modals.setModals}
                    selectedIds={selectedIds}
                    filteredImages={images}
                    onSettingsSave={(s) => { setSettings(s); addToast('Settings saved', 'success'); }}
                    onExportConfirm={(name, folder) => {
                        actions.handleExportConfirm(name, folder, exportIds.size > 0 ? exportIds : undefined);
                        setExportIds(new Set());
                    }}
                    onRename={(pattern: string, startNum: number) => actions.handleRename(pattern, startNum)}
                    onDeleteConfirm={actions.executeDelete}
                    onDeleteCollectionConfirm={() => {
                        if (modals.collectionToDelete) colOps.deleteCollection(modals.collectionToDelete);
                        modals.closeModal('deleteCollection');
                        modals.setCollectionToDelete(null);
                    }}
                    onRecoverMetadata={actions.executeMetadataRecovery}
                    onCollectionAction={async (ids, targetId, mode, sourceId) => {
                        if (mode === 'move' && sourceId) {
                            await colOps.moveImagesBetweenCollections(ids, sourceId, targetId);
                        } else {
                            await colOps.addImagesToCollection(ids, targetId);
                        }
                        clearSelection();
                    }}
                    onCloseExport={() => setExportIds(new Set())}
                    exportIds={exportIds}
                    pendingViewerDeleteId={modals.pendingViewerDeleteId}
                    collectionToDeleteId={modals.collectionToDelete}
                    addToCollectionMode={modals.addToCollectionMode}
                    sourceCollectionId={modals.sourceCollectionId}
                    isRecoveringMetadata={fileOps.isRecoveringMetadata}
                    isExporting={fileOps.isExporting}
                    slideshowShuffle={modals.slideshowShuffle}
                    initialSettingsTab={modals.initialSettingsTab}
                    shortcutsModalTab={modals.shortcutsModalTab}
                    commandPaletteProps={{
                        onNavigate: changeViewMode,
                        onToggleTheme: toggleTheme,
                        onOpenSettings: () => { modals.setInitialSettingsTab('general'); modals.openModal('settings'); },
                        onImport: () => fileOps.fileInputRef.current?.click(),
                        onCreateCollection: () => { setIsFilterPanelOpen(true); setTimeout(() => document.getElementById('create-col-btn')?.click(), 100); },
                        onToggleAI: toggleAiSearch,
                        settings: settings
                    }}
                    collections={collections}
                    smartCollections={smartCollections}
                    toggleFavorite={toggleFavorite}
                    settings={settings}
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
                            onUpdateNegativePrompt={(id, neg) => handlers.handleUpdateNegativePrompt(id, neg)}
                            onUpdateModel={(id, model) => handlers.handleUpdateModel(id, model)}
                            onUpdateTool={(id, tool) => handlers.handleUpdateTool(id, tool)}
                            onToggleFavorite={(id) => toggleFavorite(id)}
                            onTogglePin={(id, p) => actions.handlePinImage(id, p)}
                            onDelete={(id) => actions.handleDeleteViewerImage(id)}
                            onOpenSettings={() => { modals.setInitialSettingsTab('experiments'); modals.openModal('settings'); }}
                            onUpdateNotes={(id, n) => handlers.handleUpdateNotes(id, n)}
                            onSearch={(term) => {
                                import('./utils/filterUtils').then(({ parseAndApplyFilter }) => {
                                    parseAndApplyFilter(term, setFilters);
                                });
                                setRecentSearches(prev => [term, ...prev.filter(s => s !== term)].slice(0, 8));
                            }}
                            onRevertMetadata={(id) => handlers.handleRevertMetadata(id)}
                            onAddToCollection={(id) => handleOpenCollectionModal('add')}
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
                    onMoveToCollection={onMoveToCollection}
                    modals={modals}
                    filters={filters}
                />
            </div>
        </HashRouter >
    );
}
