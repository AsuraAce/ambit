import * as React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { HashRouter } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Search, Import } from 'lucide-react';
import { AIImage, ViewMode, LayoutMode, ContextMenuState, GeneratorTool } from './types';
import { FilterPanel } from './components/FilterPanel';
import { ImageViewer } from './components/ImageViewer';
import { StatsDashboard } from './components/Charts';
import { TimelineView } from './components/TimelineView';
import { ContextMenu } from './components/ContextMenu';
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

// Hooks
import { useSelection } from './hooks/useSelection';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useSearch } from './hooks/useSearch';
import { useFileOperations } from './hooks/useFileOperations';
import { useCollectionOperations } from './hooks/useCollectionOperations';
import { useTheme } from './hooks/useTheme';
import { useDragDrop } from './hooks/useDragDrop';
import { useFolderMonitor } from './hooks/useFolderMonitor';

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
        isFiltering
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

    // Interaction State
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [gridLayout, setGridLayout] = useState<{ columns: number, rowHeight: number }>({ columns: 1, rowHeight: 200 });

    const handleLayoutChange = useCallback((c: number, h: number) => {
        setGridLayout(prev => {
            if (prev.columns === c && prev.rowHeight === h) return prev;
            return { columns: c, rowHeight: h };
        });
    }, []);

    // Modal State Grouping
    const [modals, setModals] = useState({
        settings: false,
        addToCollection: false,
        deleteConfirm: false,
        deleteCollection: false,
        rename: false,
        compare: false,
        shortcuts: false,
        recovery: false,
        slideshow: false,
        donation: false,
        export: false,
        commandPalette: false
    });

    const [pendingViewerDeleteId, setPendingViewerDeleteId] = useState<string | null>(null);
    const [collectionToDelete, setCollectionToDelete] = useState<string | null>(null);
    const [initialSettingsTab, setInitialSettingsTab] = useState<'general' | 'experiments'>('general');
    const [shortcutsModalTab, setShortcutsModalTab] = useState<'shortcuts' | 'search'>('shortcuts');
    const [slideshowShuffle, setSlideshowShuffle] = useState(false);
    const [isPinnedShelfCollapsed, setIsPinnedShelfCollapsed] = useState(true);

    const openModal = (key: keyof typeof modals) => setModals(p => ({ ...p, [key]: true }));

    // --- Specialized Logic Hooks ---
    const search = useSearch({
        filters,
        setFilters,
        settings,
        setRecentSearches,
        availableTags: availableTags,
        onOpenSettings: () => { setInitialSettingsTab('experiments'); openModal('settings'); }
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

    // --- Extracted Hooks ---
    const { isDraggingExternal } = useDragDrop({
        onImportPaths: fileOps.handleImportPaths,
        onImportFiles: fileOps.handleImportFiles
    });

    useFolderMonitor({
        isLoaded,
        monitoredFolders: settings.monitoredFolders,
        onScan: fileOps.scanDirectory,
        addToast
    });

    // State Handlers for Metadata Updates (Moved logic here to support source tracking)
    const handleUpdatePrompt = (id: string, prompt: string) => {
        setImages(prev => prev.map(i => {
            if (i.id !== id) return i;
            // Snapshot original if not already done (Critical for "Edited" indicator)
            const originalMetadata = i.originalMetadata || { ...i.metadata };
            return {
                ...i,
                originalMetadata,
                metadata: { ...i.metadata, positivePrompt: prompt }
            };
        }));
        addToast('Updated', 'success');
    };

    const handleUpdateModel = (id: string, model: string) => {
        setImages(prev => prev.map(i => {
            if (i.id !== id) return i;
            // Snapshot original if not already done (Critical for "Edited" indicator)
            const originalMetadata = i.originalMetadata || { ...i.metadata };
            return {
                ...i,
                originalMetadata,
                metadata: { ...i.metadata, overrideModel: model }
            };
        }));
        addToast('Updated', 'success');
    };

    const handleUpdateTool = (id: string, tool: GeneratorTool) => {
        setImages(prev => prev.map(i => {
            if (i.id !== id) return i;
            const originalMetadata = i.originalMetadata || { ...i.metadata };
            return {
                ...i,
                originalMetadata,
                metadata: { ...i.metadata, tool }
            };
        }));
        addToast('Updated', 'success');
    };

    const handleGroupImages = (ids: string[]) => {
        const groupId = `stack_${Date.now()}`;
        setImages(prev => prev.map(img =>
            ids.includes(img.id) ? { ...img, groupId } : img
        ));
        addToast(`Grouped ${ids.length} images into a stack`, 'success');
    };

    // Refs
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<VirtualGridHandle>(null);

    useEffect(() => {
        const timer = setTimeout(() => setShowSupportPulse(false), 5000);
        return () => clearTimeout(timer);
    }, []);

    // --- Handlers (Action Layer) ---
    const executeDelete = () => {
        const ids = pendingViewerDeleteId ? [pendingViewerDeleteId] : Array.from(selectedIds);
        fileOps.deleteImages(ids);

        if (pendingViewerDeleteId) {
            const idx = images.findIndex(img => img.id === pendingViewerDeleteId);
            if (idx !== -1) {
                let nextIndex: number | null = idx;
                if (images.length === 1) nextIndex = null;
                else if (idx === images.length - 1) nextIndex = idx - 1;
                setSelectedImageIndex(nextIndex);
            }
        } else {
            setSelectedIds(new Set());
        }
        setModals(p => ({ ...p, deleteConfirm: false }));
        setPendingViewerDeleteId(null);
    };

    const handleDeleteViewerImage = (id: string) => {
        if (settings.confirmDelete) {
            setPendingViewerDeleteId(id);
            openModal('deleteConfirm');
        } else {
            setPendingViewerDeleteId(id);
            setTimeout(() => executeDelete(), 0);
        }
    };

    const handleExportConfirm = async (filename: string) => {
        await fileOps.exportImages(filename, selectedIds, () => {
            setSelectedIds(new Set());
            setModals(p => ({ ...p, export: false }));
        });
    };

    const handleBulkFavorite = () => {
        const anyUnfavorite = images.some(img => selectedIds.has(img.id) && !img.isFavorite);
        setImages(prev => prev.map(img => selectedIds.has(img.id) ? { ...img, isFavorite: anyUnfavorite } : img));
        addToast(`${anyUnfavorite ? 'Favorited' : 'Unfavorited'} ${selectedIds.size} images`, 'success');
    };

    const handleBulkPin = async () => {
        const anyUnpinned = images.some(img => selectedIds.has(img.id) && !img.isPinned);
        setImages(prev => {
            const updated = prev.map(img => selectedIds.has(img.id) ? { ...img, isPinned: anyUnpinned } : img);
            // Local re-sort to move pinned items to top immediately
            return [...updated].sort((a, b) => {
                if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
                return (b.timestamp || 0) - (a.timestamp || 0);
            });
        });

        // Clean up Custom Thumbnail if we are in a collection (restore dynamic behavior)
        if (filters.collectionId) {
            setCollections(prev => prev.map(c => c.id === filters.collectionId ? { ...c, customThumbnail: undefined } : c));
        }

        const ids = Array.from(selectedIds);
        const db = await import('./services/db');
        await Promise.all(ids.map(id => db.toggleImagePin(id, anyUnpinned)));

        refreshCollectionThumbnails();
        addToast(`${anyUnpinned ? 'Pinned' : 'Unpinned'} ${selectedIds.size} images`, 'info');
    };

    const handleBulkMask = (targetId?: string) => {
        let idsToToggle = new Set<string>();

        if (targetId) {
            if (selectedIds.has(targetId)) {
                idsToToggle = new Set(selectedIds);
            } else {
                idsToToggle = new Set([targetId]);
            }
        } else {
            if (selectedIds.size > 0) idsToToggle = new Set(selectedIds);
            else if (lastSelectedId) idsToToggle.add(lastSelectedId);
        }

        if (idsToToggle.size === 0) return;

        setImages(prev => prev.map(img => {
            if (idsToToggle.has(img.id)) {
                return { ...img, userMasked: !img.userMasked };
            }
            return img;
        }));
        addToast(`${idsToToggle.size} images mask toggled`, 'info');
    };

    const handleTogglePrivacy = () => {
        setPrivacyEnabled(p => !p);
        addToast(privacyEnabled ? "Privacy Mode Disabled (Hidden/Blurred items revealed)" : "Privacy Mode Enabled", "info");
    };

    const executeMetadataRecovery = async (style: any) => {
        const targetId = contextMenu?.imageId || (selectedIds.size > 0 ? Array.from(selectedIds)[0] : null) || (selectedImageIndex !== null ? images[selectedImageIndex]?.id : null) || viewingImageId;
        if (!targetId) return;
        fileOps.recoverMetadata(targetId, style, () => setModals(p => ({ ...p, recovery: false })));
    };

    // --- Shortcut Action Wrappers ---
    // --- Consolidated Pin Handler ---
    const handlePinImage = async (id: string, newPinned: boolean) => {
        setImages(prev => {
            const updated = prev.map(i => i.id === id ? { ...i, isPinned: newPinned } : i);
            return [...updated].sort((a, b) => {
                if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
                return (b.timestamp || 0) - (a.timestamp || 0);
            });
        });

        // Clean up Custom Thumbnail if we are in a collection (restore dynamic behavior)
        if (filters.collectionId) {
            setCollections(prev => prev.map(c => c.id === filters.collectionId ? { ...c, customThumbnail: undefined } : c));
        }

        await import('./services/db').then(db => db.toggleImagePin(id, newPinned));
        refreshCollectionThumbnails();
        addToast(newPinned ? "Pinned to top" : "Unpinned", "info");
    };

    // --- Shortcut Action Wrappers ---
    const handleShortcutFavorite = () => {
        if (selectedImageIndex !== null && images[selectedImageIndex]) {
            const id = images[selectedImageIndex].id;
            setImages(prev => prev.map(i => i.id === id ? { ...i, isFavorite: !i.isFavorite } : i));
        } else {
            handleBulkFavorite();
        }
    };

    const handleShortcutPin = async () => {
        if (selectedImageIndex !== null && images[selectedImageIndex]) {
            await handlePinImage(images[selectedImageIndex].id, !images[selectedImageIndex].isPinned);
        } else {
            handleBulkPin();
        }
    };

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
        handleDeleteViewerImage,
        handleBulkDelete: () => settings.confirmDelete ? openModal('deleteConfirm') : executeDelete(),
        togglePrivacyMode: handleTogglePrivacy,
        toggleMasking: () => handleBulkMask(),
        toggleFavorite: handleShortcutFavorite,
        togglePin: handleShortcutPin,
        openRename: () => openModal('rename'),
        openCollection: () => openModal('addToCollection'),
        isModalOpen: Object.values(modals).some(v => v),
        toggleShortcuts: () => { setShortcutsModalTab('shortcuts'); setModals(p => ({ ...p, shortcuts: !p.shortcuts })); },
        toggleCommandPalette: () => setModals(p => ({ ...p, commandPalette: !p.commandPalette })),
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
            <div className="flex h-screen text-gray-900 dark:text-gray-100 font-sans selection:bg-sage-500/30 selection:text-white transition-colors duration-300 overflow-hidden pt-12 pb-4 px-4">
                <TitleBar />
                <OnboardingWizard isOpen={!settings.hasCompletedOnboarding} onComplete={(s) => { setSettings(p => ({ ...p, ...s })); addToast("Setup complete!", "success"); }} initialApiKey={settings.googleGeminiApiKey || process.env.API_KEY} />
                <input type="file" ref={fileOps.fileInputRef} className="hidden" multiple accept="image/png,image/jpeg,image/webp" onChange={fileOps.importImages} />

                <DragOverlay isVisible={isDraggingExternal} />

                {/* Modals */}
                <GlobalModals
                    modals={modals}
                    setModals={setModals}
                    selectedIds={selectedIds}
                    filteredImages={images} // map to images
                    onSettingsSave={(s) => { setSettings(s); addToast('Settings saved', 'success'); }}
                    onExportConfirm={handleExportConfirm}
                    onRename={(pattern, start) => {
                        let current = start;
                        setImages(prev => prev.map(img => selectedIds.has(img.id) ? { ...img, filename: pattern.replace(/#+/g, (m) => String(current++).padStart(m.length, '0')) + '.png' } : img));
                        addToast(`Renamed ${selectedIds.size} images`, 'success');
                        setSelectedIds(new Set());
                    }}
                    onDeleteConfirm={executeDelete}
                    onDeleteCollectionConfirm={() => {
                        if (collectionToDelete) colOps.deleteCollection(collectionToDelete);
                        setModals(p => ({ ...p, deleteCollection: false }));
                        setCollectionToDelete(null);
                    }}
                    onToggleFavorite={(id) => setImages(prev => prev.map(i => i.id === id ? { ...i, isFavorite: !i.isFavorite } : i))}
                    onRecoverMetadata={executeMetadataRecovery}
                    onAddImagesToCollection={colOps.addImagesToCollection}
                    pendingViewerDeleteId={pendingViewerDeleteId}
                    collectionToDeleteId={collectionToDelete}
                    isRecoveringMetadata={fileOps.isRecoveringMetadata}
                    isExporting={fileOps.isExporting}
                    slideshowShuffle={slideshowShuffle}
                    initialSettingsTab={initialSettingsTab}
                    shortcutsModalTab={shortcutsModalTab}
                    commandPaletteProps={{
                        onNavigate: (mode: any) => setViewMode(mode),
                        onToggleTheme: toggleTheme,
                        onOpenSettings: () => { setInitialSettingsTab('general'); openModal('settings'); },
                        onImport: () => fileOps.fileInputRef.current?.click(),
                        onCreateCollection: () => { setIsFilterPanelOpen(true); setTimeout(() => document.getElementById('create-col-btn')?.click(), 100); },
                        onToggleAI: search.toggleAiSearch
                    }}
                />

                {contextMenu && (
                    <ContextMenu
                        x={contextMenu.x} y={contextMenu.y}
                        isPinned={images.find(i => i.id === contextMenu.imageId)?.isPinned}
                        enableAI={settings.enableAI}
                        activeCollectionName={activeCollection?.name}
                        onClose={() => setContextMenu(null)}
                        onCopyPrompt={() => { navigator.clipboard.writeText(images.find(i => i.id === contextMenu.imageId)?.metadata.positivePrompt || ''); addToast('Prompt copied', 'success'); setContextMenu(null); }}
                        onAddToCollection={() => { openModal('addToCollection'); setContextMenu(null); }}
                        onRemoveFromCollection={() => {
                            if (filters.collectionId && contextMenu.imageId) {
                                colOps.removeImagesFromCollection([contextMenu.imageId], filters.collectionId);
                                setContextMenu(null);
                            }
                        }}
                        onTogglePin={async () => {
                            const id = contextMenu.imageId;
                            const img = images.find(i => i.id === id);
                            if (img) {
                                await handlePinImage(id, !img.isPinned);
                            }
                            setContextMenu(null);
                        }}
                        onToggleMask={() => { handleBulkMask(contextMenu.imageId); setContextMenu(null); }}
                        onDelete={() => { settings.confirmDelete ? openModal('deleteConfirm') : executeDelete(); setContextMenu(null); }}
                        onShowInFolder={() => { addToast('Opening folder...', 'info'); setContextMenu(null); }}
                        onRecoverMetadata={() => { if (!settings.enableAI) { addToast("Enable AI first", "error"); openModal('settings'); } else { openModal('recovery'); } setContextMenu(null); }}
                        onSetThumbnail={() => {
                            if (filters.collectionId) {
                                const thumbUrl = images.find(i => i.id === contextMenu.imageId)?.thumbnailUrl;
                                setCollections(prev => prev.map(c =>
                                    c.id === filters.collectionId
                                        ? { ...c, customThumbnail: thumbUrl, thumbnail: thumbUrl }
                                        : c
                                ));
                                addToast("Thumbnail updated", "success");
                            }
                            setContextMenu(null);
                        }}
                        onUnsetThumbnail={() => { if (filters.collectionId) { setCollections(prev => prev.map(c => c.id === filters.collectionId ? { ...c, customThumbnail: undefined } : c)); refreshCollectionThumbnails(); addToast("Thumbnail reset", "info"); } setContextMenu(null); }}
                    />
                )}

                {/* --- Sidebar --- */}
                <AppSidebar
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    filters={filters}
                    setFilters={setFilters}
                    isFilterPanelOpen={isFilterPanelOpen}
                    setIsFilterPanelOpen={setIsFilterPanelOpen}
                    onOpenSettings={() => { setInitialSettingsTab('general'); openModal('settings'); }}
                    onOpenShortcuts={() => { setShortcutsModalTab('shortcuts'); openModal('shortcuts'); }}
                    onOpenDonation={() => openModal('donation')}
                    onOpenSlideshow={() => { clearAllFilters(); setSlideshowShuffle(true); openModal('slideshow'); addToast("Rediscovering...", "success"); }}
                    showSupportPulse={showSupportPulse}
                />

                <div className={`flex flex-1 h-full ml-0 md:ml-28 transition-all duration-300 relative`}>
                    {(viewMode === 'grid' || viewMode === 'timeline' || viewMode === 'dashboard') && (
                        <FilterPanel
                            isVisible={isFilterPanelOpen}
                            filters={filters} setFilters={setFilters}
                            filteredImages={images} // map to images
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
                                setCollectionToDelete(id);
                                openModal('deleteCollection');
                            }}
                            onToggleArchiveCollection={colOps.toggleArchiveCollection}
                            onTogglePinCollection={colOps.togglePinCollection}
                            onSetCollectionColor={colOps.setCollectionColor}
                            onResetCollectionThumbnail={(id) => {
                                setCollections(prev => prev.map(c => c.id === id ? { ...c, customThumbnail: undefined } : c));
                                refreshCollectionThumbnails();
                                addToast("Thumbnail reset", "info");
                            }}
                            onPlayCollection={(id) => {
                                setFilters(prev => ({ ...prev, collectionId: id }));
                                setSlideshowShuffle(false);
                                openModal('slideshow');
                            }}
                            onExportCollection={(id) => {
                                const col = collections.find(c => c.id === id);
                                if (col && col.imageIds.length > 0) {
                                    setSelectedIds(new Set(col.imageIds));
                                    openModal('export');
                                } else {
                                    addToast("Collection is empty", "error");
                                }
                            }}
                            className="hidden lg:flex"
                        />
                    )}

                    <main className="flex-1 flex flex-col h-full overflow-hidden relative rounded-l-3xl bg-transparent transition-all duration-200">
                        {(viewMode === 'grid' || viewMode === 'timeline' || viewMode === 'dashboard') && (
                            <AppHeader
                                viewMode={viewMode}
                                filters={filters}
                                setFilters={setFilters}
                                searchProps={{
                                    isAiSearchEnabled: search.isAiSearchEnabled,
                                    isSearchingAi: search.isSearchingAi,
                                    inputRef: search.inputRef,
                                    toggleAiSearch: search.toggleAiSearch,
                                    handleSearchChange: search.handleSearchChange,
                                    submitSearch: search.submitSearch,
                                    suggestions: search.suggestions
                                }}
                                layoutMode={layoutMode}
                                setLayoutMode={setLayoutMode}
                                sortOption={sortOption}
                                setSortOption={setSortOption}
                                displayedCount={images.length} // Map to images.length
                                totalCount={totalImages} // Use true DB count
                                onImport={() => fileOps.fileInputRef.current?.click()}
                                onSlideshow={() => { setSlideshowShuffle(false); openModal('slideshow'); }}
                                clearAllFilters={clearAllFilters}
                                isImporting={fileOps.isImporting}
                            />
                        )}

                        <div
                            ref={scrollContainerRef}
                            className={`flex-1 ${viewMode === 'grid' ? 'overflow-y-auto overflow-x-hidden custom-scrollbar px-2' : 'overflow-hidden'}`}
                        >
                            <ErrorBoundary>
                                {viewMode === 'dashboard' ? (
                                    <StatsDashboard images={images} onFilter={(t, v) => { if (t === 'model') setFilters(p => ({ ...p, models: [...p.models, v] })); setViewMode('grid'); }} />
                                ) : viewMode === 'maintenance' ? (
                                    <MaintenanceView
                                        images={images}
                                        onResolveDuplicate={(k, d) => { setImages(p => p.map(i => d.includes(i.id) ? { ...i, isDeleted: true } : i)); addToast(`Resolved ${d.length} duplicates`, 'success'); }}
                                        onRestoreImages={(ids) => { setImages(p => p.map(i => ids.includes(i.id) ? { ...i, isDeleted: false } : i)); addToast('Restored', 'success'); }}
                                        onDeleteForever={(ids) => { setImages(p => p.filter(i => !ids.includes(i.id))); addToast('Deleted forever', 'success'); }}
                                        onEmptyTrash={() => { setImages(p => p.filter(i => !i.isDeleted)); addToast('Trash emptied', 'success'); }}
                                        onGroupImages={handleGroupImages}
                                        onViewImage={(id) => setViewingImageId(id)}
                                        onRegenerateThumbnails={fileOps.regenerateThumbnails}
                                    />
                                ) : images.length > 0 ? (
                                    viewMode === 'timeline' ? (
                                        <TimelineView
                                            images={images}
                                            selectedIds={selectedIds}
                                            thumbnailSize={settings.thumbnailSize}
                                            sortOption={sortOption}
                                            onImageClick={(e, id, index) => handleImageClick(e, id, index, setSelectedImageIndex)}
                                            onSelectionToggle={handleSelectionToggle}
                                            onToggleFavorite={(e, id) => { setImages(p => p.map(i => i.id === id ? { ...i, isFavorite: !i.isFavorite } : i)); }}
                                            onContextMenu={(e, id) => { setContextMenu({ x: e.clientX, y: e.clientY, imageId: id }); }}
                                        />
                                    ) : (
                                        <>
                                            <PinnedShelf
                                                images={images.filter(i => i.isPinned)}
                                                isCollapsed={isPinnedShelfCollapsed}
                                                onToggleCollapse={() => setIsPinnedShelfCollapsed(p => !p)}
                                                selectedIds={selectedIds}
                                                maskedKeywords={settings.maskedKeywords}
                                                privacyEnabled={privacyEnabled}
                                                setImages={setImages}
                                                onImageClick={(e, id, index) => handleImageClick(e, id, index, setSelectedImageIndex)}
                                                onToggleSelection={handleSelectionToggle}
                                                onTogglePin={async (e, id) => {
                                                    const img = images.find(i => i.id === id);
                                                    if (img) {
                                                        await handlePinImage(id, !img.isPinned);
                                                    }
                                                }}
                                                onContextMenu={(e, id) => setContextMenu({ x: e.clientX, y: e.clientY, imageId: id })}
                                                thumbnailSize={settings.thumbnailSize}
                                                activeThumbnailUrl={activeCollection?.thumbnail}
                                            />
                                            {isFiltering ? (
                                                <GridSkeleton />
                                            ) : (
                                                <VirtualGrid<AIImage>
                                                    ref={gridRef}
                                                    items={images.filter(i => !i.isPinned)}
                                                    layout={layoutMode}
                                                    minItemWidth={settings.thumbnailSize}
                                                    gap={16}
                                                    padding={24}
                                                    scrollContainerRef={scrollContainerRef}
                                                    onEndReached={loadMoreImages} // Infinite Scroll connection
                                                    getItemRatio={(img) => {
                                                        const w = img.width || 1;
                                                        const h = img.height || 1;
                                                        return w / h;
                                                    }}
                                                    onLayoutChange={handleLayoutChange}
                                                    onRangeSelection={handleRangeSelection}
                                                    onBackgroundClick={clearSelection}
                                                    renderItem={(img, style, index, layout) => (
                                                        <GridItem
                                                            key={img.id}
                                                            image={img}
                                                            style={style}
                                                            layoutPos={layout}
                                                            index={index + (images.filter(i => i.isPinned).length)} // OFFSET INDEX for global navigation
                                                            isSelected={selectedIds.has(img.id)}
                                                            selectedIds={selectedIds}
                                                            maskedKeywords={settings.maskedKeywords}
                                                            privacyEnabled={privacyEnabled}
                                                            setImages={setImages}
                                                            onClick={(e, id, idx) => handleImageClick(e, id, idx, setSelectedImageIndex)}
                                                            onToggleSelection={handleSelectionToggle}
                                                            onTogglePin={async (e, id) => {
                                                                const img = images.find(i => i.id === id);
                                                                if (img) {
                                                                    await handlePinImage(id, !img.isPinned);
                                                                }
                                                            }}
                                                            onContextMenu={(e, id) => setContextMenu({ x: e.clientX, y: e.clientY, imageId: id })}
                                                            isThumbnail={activeCollection ? activeCollection.thumbnail === img.thumbnailUrl : false}
                                                        />
                                                    )}
                                                />
                                            )}
                                        </>
                                    )
                                ) : (
                                    isFiltering ? <GridSkeleton /> : (
                                        <div className="h-full flex flex-col items-center justify-center text-gray-500">
                                            {/* TODO: Better Empty Status checking using totalImages instead of images.length */}
                                            {/* Logic: If we have NO active filters, it's an empty library. 
                                                If we have filters active (even just a collection selected), it's "No Matches". 
                                            */}
                                            {(!filters.searchQuery && filters.models.length === 0 && !filters.collectionId && !filters.favoritesOnly && filters.dateRange === 'all') ? (
                                                <><div className="p-6 bg-slate-100 dark:bg-slate-800/50 rounded-full mb-6 border border-gray-200 dark:border-white/5 animate-in zoom-in duration-500"><Import className="w-12 h-12 text-sage-500 opacity-50" /></div><h3 className="text-xl font-bold mb-2 text-gray-800 dark:text-gray-300">Your Ambit is empty</h3><button onClick={() => fileOps.fileInputRef.current?.click()} className="px-6 py-3 bg-sage-600 hover:bg-sage-500 text-white rounded-xl font-bold shadow-lg shadow-sage-500/20 transition-all hover:scale-105">Import Images</button></>
                                            ) : (
                                                <><Search className="w-12 h-12 mb-4 opacity-20" /><p className="text-gray-500 dark:text-gray-400">No images match your current filters.</p><button onClick={clearAllFilters} className="mt-4 text-sage-600 dark:text-sage-400 hover:text-sage-800 dark:hover:text-sage-300 text-sm underline">Clear all filters</button></>
                                            )}
                                        </div>
                                    )
                                )}
                            </ErrorBoundary>
                        </div>

                        <SelectionBar
                            selectedIds={selectedIds}
                            filteredImages={images} // map to images
                            lastSelectedId={lastSelectedId}
                            isExporting={fileOps.isExporting}
                            confirmDelete={settings.confirmDelete}
                            onClearSelection={clearSelection}
                            onDelete={settings.confirmDelete ? () => openModal('deleteConfirm') : executeDelete}
                            onExport={() => openModal('export')}
                            onRename={() => openModal('rename')}
                            onAddToCollection={() => openModal('addToCollection')}
                            onToggleFavorite={handleBulkFavorite}
                            onTogglePin={handleBulkPin}
                            onToggleMask={handleBulkMask}
                            onCompare={() => openModal('compare')}
                        />
                    </main>
                </div>
                <AnimatePresence>
                    {displayedViewerImage && (
                        <ImageViewer
                            key="image-viewer" // Important for AnimatePresence
                            image={displayedViewerImage} availableTags={availableTags} isOpen={true}
                            onAddToCollection={(id, colId) => colOps.addImagesToCollection([id], colId)}
                            onClose={() => { setSelectedImageIndex(null); setViewingImageId(null); }}
                            onNext={!viewingImageId ? () => setSelectedImageIndex(p => p !== null && p < images.length - 1 ? p + 1 : 0) : () => { }}
                            onPrev={!viewingImageId ? () => setSelectedImageIndex(p => p !== null && p > 0 ? p - 1 : images.length - 1) : () => { }}
                            onSearch={(t) => { setFilters(p => ({ ...p, searchQuery: t })); setRecentSearches(prev => [t, ...prev.filter(s => s !== t)].slice(0, 8)); }}
                            onUpdateNotes={(id, n) => { setImages(p => p.map(i => i.id === id ? { ...i, notes: n } : i)); addToast('Saved', 'success'); }}
                            onUpdatePrompt={handleUpdatePrompt}
                            onUpdateModel={handleUpdateModel}
                            onUpdateTool={handleUpdateTool}
                            onToggleFavorite={(id) => setImages(p => p.map(i => i.id === id ? { ...i, isFavorite: !i.isFavorite } : i))}
                            onRecoverMetadata={() => { if (!settings.enableAI) { addToast("Enable AI features first", "error"); openModal('settings'); } else { openModal('recovery'); } }}
                            onRevertMetadata={(id) => { setImages(p => p.map(i => i.id === id && i.originalMetadata ? { ...i, metadata: i.originalMetadata, originalMetadata: undefined } : i)); addToast('Reverted', 'success'); }}
                            onOpenSettings={() => { setInitialSettingsTab('experiments'); openModal('settings'); }}
                            onDelete={handleDeleteViewerImage}
                            isSidebarOpen={!settings.defaultTheaterMode} onToggleSidebar={() => setSettings(p => ({ ...p, defaultTheaterMode: !p.defaultTheaterMode }))}
                        />
                    )}
                </AnimatePresence>


            </div >
        </HashRouter >
    );
}