import * as React from 'react';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AIImage, GeneratorTool } from '../../../types';
import { DuplicateFinder } from './DuplicateFinder';
import { Loader2 } from 'lucide-react';
import { ImageViewer } from '../../../features/viewer/components/ImageViewer';
import { CompareModal } from '../../../features/viewer/components/CompareModal';
import { useMaintenanceData, MaintenanceTab } from '../../../hooks/useMaintenanceData';
import { TrashTab } from './TrashTab';
import { UntaggedTab } from './UntaggedTab';
import { MissingTab } from './MissingTab';
import { ThumbnailsTab } from './ThumbnailsTab';
import { IntermediatesTab } from './IntermediatesTab';
import { MaintenanceTabs } from './MaintenanceTabs';
import { ScanPlaceholder } from './ScanPlaceholder';
import { useSelection } from '../../../hooks/useSelection';
import { useLibraryStore } from '../../../stores/libraryStore';
import { useLibraryContext } from '../../../contexts/LibraryContext';

interface MaintenanceViewProps {
    images: AIImage[];
    onResolveDuplicate: (keepId: string, deleteIds: string[]) => void;
    onRestoreImages: (ids: string[]) => void;
    onRemoveFromLibrary: (ids: string[]) => void;
    onDeleteFile: (ids: string[]) => void;
    onEmptyTrash: () => Promise<void>;
    onGroupImages?: (ids: string[]) => void;
    onViewImage: (id: string) => void;
    onRegenerateThumbnails?: (ids?: string[]) => void;
    maskedKeywords: string[];
    onUpdatePrompt?: (id: string, prompt: string) => void;
    onUpdateModel?: (id: string, model: string) => void;
    onUpdateTool?: (id: string, tool: GeneratorTool) => void;
    onUpdateNotes?: (id: string, notes: string) => void;
    onRecoverMetadata?: () => void;
    onToggleFavorite?: (id: string) => void;
    onTogglePin?: (id: string, isPinned: boolean) => void;
    availableTags?: string[];
}

// Lazy load LibraryHealth
const LibraryHealth = React.lazy(() => import('./LibraryHealth').then(m => ({ default: m.LibraryHealth })));

export const MaintenanceView: React.FC<MaintenanceViewProps> = ({
    images,
    onResolveDuplicate,
    onRestoreImages,
    onRemoveFromLibrary,
    onDeleteFile,
    onRegenerateThumbnails,
    maskedKeywords,
    onUpdatePrompt,
    onUpdateModel,
    onUpdateTool,
    onUpdateNotes,
    onRecoverMetadata,
    onToggleFavorite,
    onTogglePin,
    availableTags
}) => {
    // --- State ---
    const [activeTab, setActiveTabOriginal] = useState<MaintenanceTab>('missing');
    const intermediatesCount = useLibraryStore(s => s.maintenanceCounts.intermediates);
    const isScanningDuplicates = useLibraryStore(s => s.isScanningDuplicates);
    const duplicateScanProgress = useLibraryStore(s => s.duplicateScanProgress);
    const storedDuplicateScanScope = useLibraryStore(s => s.duplicateScanScope);
    const lastDuplicateScanResult = useLibraryStore(s => s.lastDuplicateScanResult);
    const cancelDuplicateScan = useLibraryStore(s => s.cancelDuplicateScan);
    const lastMissingScanResult = useLibraryStore(s => s.lastMissingScanResult);
    const { activeSqlWhere, activeSqlParams } = useLibraryContext();

    // Scopes
    const [thumbnailsScope, setThumbnailsScope] = useState<'global' | 'filtered'>('global');
    const [untaggedScope, setUntaggedScope] = useState<'global' | 'filtered'>('global');
    const [duplicatesScope, setDuplicatesScope] = useState<'global' | 'filtered'>('global');
    const [intermediatesScope, setIntermediatesScope] = useState<'global' | 'filtered'>('global');
    const [includeUpgradeable, setIncludeUpgradeable] = useState(false);

    const [viewingImageId, setViewingImageId] = useState<string | null>(null);
    const [compareImages, setCompareImages] = useState<[AIImage, AIImage] | null>(null);
    const [removedAction, setRemovedAction] = useState<'restoring' | 'deleting' | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Missing Scan Special State
    const [scanMissingIds, setScanMissingIds] = useState<Set<string>>(new Set());
    const [fetchedMissingImages, setFetchedMissingImages] = useState<AIImage[]>([]);

    // --- Data Hooks ---
    const {
        isLoading,
        initializedTabs,
        localDeletedImages,
        localUntaggedImages,
        localUnoptimizedImages,
        localDuplicateCandidates,
        localMissingImages,
        localIntermediateImages,
        unoptimizedTotalCount,
        refreshData,
        setLocalMissingImages
    } = useMaintenanceData(activeTab, thumbnailsScope);

    // --- Computed Data ---
    const activeImages = useMemo(() => images.filter(img => !img.isDeleted), [images]);

    const missingImages = useMemo(() => {
        const uniquePool = Array.from(new Map([...localMissingImages, ...fetchedMissingImages].map(item => [item.id, item])).values());
        return uniquePool.filter(img => !img.isDeleted);
    }, [localMissingImages, fetchedMissingImages]);

    // Define the current list for selection logic
    const currentList = useMemo(() => {
        switch (activeTab) {
            case 'trash': return localDeletedImages;
            case 'untagged': return localUntaggedImages;
            case 'thumbnails': return localUnoptimizedImages;
            case 'missing': return missingImages;
            case 'intermediates': return localIntermediateImages;
            case 'duplicates': return localDuplicateCandidates; // Note: duplicates view is complex, often handles groups
            default: return [];
        }
    }, [activeTab, localDeletedImages, localUntaggedImages, localUnoptimizedImages, missingImages, localIntermediateImages, localDuplicateCandidates]);

    const targetImage = useMemo(() => {
        if (!viewingImageId) return null;
        // Search in all pools to find the image object
        const allPool = [
            ...missingImages,
            ...localUntaggedImages,
            ...localDeletedImages,
            ...localUnoptimizedImages,
            ...localDuplicateCandidates,
            ...localIntermediateImages,
            ...activeImages
        ];
        return allPool.find(i => i.id === viewingImageId) || null;
    }, [viewingImageId, missingImages, localUntaggedImages, localDeletedImages, localUnoptimizedImages, localDuplicateCandidates, localIntermediateImages, activeImages]);

    // --- Selection Hook ---
    const {
        selectedIds,
        setSelectedIds,
        handleImageClick,
        handleRangeSelection: selectionRangeHandler,
        clearSelection,
        setLastSelectedId
    } = useSelection(currentList);

    // --- Handlers ---

    const setActiveTab = useCallback((tab: MaintenanceTab) => {
        setActiveTabOriginal(tab);
        clearSelection();
    }, [clearSelection]);

    useEffect(() => {
        if (activeTab === 'duplicates' && (isScanningDuplicates || lastDuplicateScanResult)) {
            setDuplicatesScope(storedDuplicateScanScope);
        }
    }, [activeTab, isScanningDuplicates, lastDuplicateScanResult, storedDuplicateScanScope]);

    const handleScanComplete = useCallback(async (ids: string[]) => {
        setScanMissingIds(new Set(ids));
        if (ids.length > 0) {
            try {
                const { getImagesByIds } = await import('../../../services/db/imageRepo');
                const fetched = await getImagesByIds(ids);
                setFetchedMissingImages(fetched);
            } catch (e) {
                console.error('Failed to fetch missing images', e);
            }
        } else {
            setFetchedMissingImages([]);
        }
    }, []);

    useEffect(() => {
        if (!lastMissingScanResult) return;
        void handleScanComplete(lastMissingScanResult.missingIds);
    }, [lastMissingScanResult, handleScanComplete]);

    // Wrapper for selection to match expected signature in sub-components if needed
    // Most subcomponents expect `onItemClick: (id, index, e) => void`
    // useSelection.handleImageClick expects `(e, id, index, setViewerIndex)`
    const handleItemClickAdapter = useCallback((id: string, index: number, e: React.MouseEvent) => {
        handleImageClick(e, id, index, () => {
            setViewingImageId(id);
        });
    }, [handleImageClick, setViewingImageId]);

    const handleSelectAll = useCallback(() => {
        const ids = currentList.map(i => i.id);
        setSelectedIds(new Set(ids));
    }, [currentList, setSelectedIds]);

    // Range selection adapter
    const handleRangeAdapter = useCallback((indexes: number[], isAdditive: boolean) => {
        selectionRangeHandler(indexes, isAdditive);
    }, [selectionRangeHandler]);


    // --- Actions ---

    const handleRestoreSelected = async () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        setRemovedAction('restoring');
        try {
            await onRestoreImages(ids);
            await refreshData('trash', false);
            clearSelection();
        } finally {
            setRemovedAction(null);
        }
    };

    const handleDeleteSelected = async () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;

        if (activeTab === 'trash') {
            setRemovedAction('deleting');
        }

        try {
            if (activeTab === 'untagged' || activeTab === 'missing') {
                await onRemoveFromLibrary(ids);
            } else {
                await onDeleteFile(ids);
            }

            const scope: 'global' | 'filtered' = activeTab === 'untagged' ? untaggedScope :
                activeTab === 'thumbnails' ? thumbnailsScope :
                    activeTab === 'duplicates' ? duplicatesScope :
                        activeTab === 'intermediates' ? intermediatesScope : 'global';

            await refreshData(activeTab, false, { scope });

            if (activeTab === 'missing') {
                setScanMissingIds(prev => {
                    const next = new Set(prev);
                    ids.forEach(id => next.delete(id));
                    return next;
                });
                setFetchedMissingImages(prev => prev.filter(img => !ids.includes(img.id)));
                setLocalMissingImages(prev => prev.filter(img => !ids.includes(img.id)));
            }
            clearSelection();
        } finally {
            if (activeTab === 'trash') {
                setRemovedAction(null);
            }
        }
    };

    const handlePurgeMissing = async () => {
        const ids = missingImages.map(i => i.id);
        await onRemoveFromLibrary(ids);
        await refreshData('missing', false);
        setScanMissingIds(new Set());
        setFetchedMissingImages([]);
    };

    const handleViewerCleanup = useCallback(async () => {
        if (!viewingImageId || activeTab === 'trash') return;

        const id = viewingImageId;
        await onRemoveFromLibrary([id]);
        setViewingImageId(null);

        if (activeTab === 'missing') {
            setScanMissingIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
            setFetchedMissingImages(prev => prev.filter(img => img.id !== id));
            setLocalMissingImages(prev => prev.filter(img => img.id !== id));
        }

        const scope: 'global' | 'filtered' = activeTab === 'untagged' ? untaggedScope :
            activeTab === 'thumbnails' ? thumbnailsScope :
                activeTab === 'duplicates' ? duplicatesScope :
                    activeTab === 'intermediates' ? intermediatesScope : 'global';

        await refreshData(activeTab, false, {
            scope,
            includeUpgradeable: activeTab === 'thumbnails' ? includeUpgradeable : undefined,
            runHashBackfill: false
        });
    }, [
        activeTab,
        duplicatesScope,
        includeUpgradeable,
        intermediatesScope,
        onRemoveFromLibrary,
        refreshData,
        setLocalMissingImages,
        thumbnailsScope,
        untaggedScope,
        viewingImageId
    ]);

    const handleRegenerate = async (ids?: string[]) => {
        if (!onRegenerateThumbnails) return;

        if (ids && ids.length > 0) {
            // Regenerate specific selected images - uses existing callback
            await onRegenerateThumbnails(ids);
            clearSelection();
        } else {
            // Regenerate ALL unoptimized images using paginated background function
            const { setIsRegeneratingThumbnails, setThumbnailProgress, setThumbnailAbortController } = useLibraryStore.getState();

            const where = thumbnailsScope === 'filtered' ? activeSqlWhere : '';
            const params = thumbnailsScope === 'filtered' ? [...activeSqlParams] : [];

            const abortCtrl = new AbortController();
            setThumbnailAbortController(abortCtrl);
            setIsRegeneratingThumbnails(true);
            setThumbnailProgress({ current: 0, total: unoptimizedTotalCount });

            try {
                const { regenerateAllUnoptimized } = await import('../../../services/thumbnailService');
                await regenerateAllUnoptimized(
                    (current, total) => setThumbnailProgress({ current, total }),
                    abortCtrl.signal,
                    where,
                    params,
                    includeUpgradeable
                );
            } finally {
                setIsRegeneratingThumbnails(false);
                setThumbnailProgress(null);
                setThumbnailAbortController(null);
            }
        }
        await refreshData('thumbnails', false, { scope: thumbnailsScope, includeUpgradeable });
    };

    const handleResolveDuplicate = useCallback(async (keepId: string, deleteIds: string[]) => {
        await onResolveDuplicate(keepId, deleteIds);
        await refreshData('duplicates', false, { scope: duplicatesScope, runHashBackfill: false });
    }, [onResolveDuplicate, refreshData, duplicatesScope]);

    const handleUnmarkIntermediates = async () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        const { toggleImageIntermediate } = await import('../../../services/db/imageRepo');
        for (const id of ids) {
            await toggleImageIntermediate(id, false);
        }
        await refreshData('intermediates', false, { scope: intermediatesScope });
        clearSelection();
    };

    // --- Scopes ---

    const handleThumbnailsScopeChange = useCallback((scope: 'global' | 'filtered') => {
        setThumbnailsScope(scope);
        refreshData('thumbnails', false, { scope });
    }, [refreshData]);

    const handleUntaggedScopeChange = useCallback((scope: 'global' | 'filtered') => {
        setUntaggedScope(scope);
        refreshData('untagged', false, { scope });
    }, [refreshData]);

    const handleIntermediatesScopeChange = useCallback((scope: 'global' | 'filtered') => {
        setIntermediatesScope(scope);
        refreshData('intermediates', false, { scope });
    }, [refreshData]);

    const handleIncludeUpgradeableChange = useCallback((include: boolean) => {
        setIncludeUpgradeable(include);
        refreshData('thumbnails', true, { scope: thumbnailsScope, includeUpgradeable: include });
    }, [refreshData, thumbnailsScope]);


    const handleBackgroundClick = useCallback(() => {
        clearSelection();
    }, [clearSelection]);


    return (
        <div className="h-full flex flex-col overflow-hidden">
            <MaintenanceTabs activeTab={activeTab} onTabChange={setActiveTab} intermediatesCount={intermediatesCount} />

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto relative custom-scrollbar px-6 pb-8" ref={scrollContainerRef}>
                <AnimatePresence mode="wait">
                    {isLoading && (
                        <motion.div
                            key="loader"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 z-50 flex items-center justify-center bg-white/60 dark:bg-zinc-950/60 backdrop-blur-sm pointer-events-none"
                        >
                            <div className="flex flex-col items-center gap-4">
                                <Loader2 className="w-10 h-10 text-sage-600 dark:text-sage-400 animate-spin" />
                                <p className="text-sm font-bold text-gray-500 dark:text-gray-400 animate-pulse uppercase tracking-widest">
                                    Loading Tab Data...
                                </p>
                            </div>
                        </motion.div>
                    )}

                    {(activeTab === 'thumbnails' && initializedTabs.has('thumbnails')) && (
                        <motion.div
                            key="thumbnails"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                        >
                            <ThumbnailsTab
                                images={localUnoptimizedImages}
                                totalCount={unoptimizedTotalCount}
                                selectedIds={selectedIds}
                                onItemClick={handleItemClickAdapter}
                                onSelectAll={handleSelectAll}
                                onClearSelection={clearSelection}
                                onRegenerate={handleRegenerate}
                                thumbnailsScope={thumbnailsScope}
                                onScopeChange={handleThumbnailsScopeChange}
                                maskedKeywords={maskedKeywords}
                                scrollContainerRef={scrollContainerRef as any}
                                onRangeSelection={handleRangeAdapter}
                                onBackgroundClick={handleBackgroundClick}
                                includeUpgradeable={includeUpgradeable}
                                onIncludeUpgradeableChange={handleIncludeUpgradeableChange}
                            />
                        </motion.div>
                    )}

                    {(activeTab === 'duplicates' && initializedTabs.has('duplicates')) && (
                        <motion.div
                            key="duplicates"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                        >
                            <DuplicateFinder
                                images={localDuplicateCandidates}
                                onResolve={handleResolveDuplicate}
                                maskedKeywords={maskedKeywords}
                                onRefresh={(scope) => {
                                    setDuplicatesScope(scope);
                                    refreshData('duplicates', true, { scope, runHashBackfill: true });
                                }}
                                scope={duplicatesScope}
                                isScanning={isScanningDuplicates}
                                scanProgress={duplicateScanProgress}
                                onCancelScan={cancelDuplicateScan}
                                onViewImage={setViewingImageId}
                                onCompareImages={(imageA, imageB) => setCompareImages([imageA, imageB])}
                                scrollContainerRef={scrollContainerRef}
                                onRangeSelection={handleRangeAdapter}
                                onBackgroundClick={handleBackgroundClick}
                            />
                        </motion.div>
                    )}

                    {(activeTab === 'untagged' && initializedTabs.has('untagged')) && (
                        <motion.div
                            key="untagged"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                        >
                            <UntaggedTab
                                images={localUntaggedImages}
                                selectedIds={selectedIds}
                                onItemClick={handleItemClickAdapter}
                                onSelectAll={handleSelectAll}
                                onClearSelection={clearSelection}
                                onRemoveFromLibrary={handleDeleteSelected}
                                onViewImage={setViewingImageId}
                                maskedKeywords={maskedKeywords}
                                scrollContainerRef={scrollContainerRef as any}
                                onRangeSelection={handleRangeAdapter}
                                onBackgroundClick={handleBackgroundClick}
                                untaggedScope={untaggedScope}
                                onScopeChange={handleUntaggedScopeChange}
                            />
                        </motion.div>
                    )}

                    {activeTab === 'missing' && (
                        <motion.div
                            key="missing"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                            className="flex flex-col gap-6"
                        >
                            <React.Suspense fallback={<div className="h-20 flex items-center justify-center"><Loader2 className="animate-spin" /></div>}>
                                <LibraryHealth onScanComplete={handleScanComplete} />
                            </React.Suspense>

                            <MissingTab
                                images={missingImages}
                                selectedIds={selectedIds}
                                onItemClick={handleItemClickAdapter}
                                onSelectAll={handleSelectAll}
                                onClearSelection={clearSelection}
                                onDeleteSelected={handleDeleteSelected}
                                onPurgeMissing={handlePurgeMissing}
                                onViewImage={setViewingImageId}
                                scrollContainerRef={scrollContainerRef as any}
                                onRangeSelection={handleRangeAdapter}
                                onBackgroundClick={handleBackgroundClick}
                            />
                        </motion.div>
                    )}

                    {activeTab === 'trash' && (
                        <motion.div
                            key="trash"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                        >
                            <TrashTab
                                images={localDeletedImages}
                                selectedIds={selectedIds}
                                onItemClick={handleItemClickAdapter}
                                onSelectAll={handleSelectAll}
                                onClearSelection={clearSelection}
                                onRestoreSelected={handleRestoreSelected}
                                onDeleteSelected={handleDeleteSelected}
                                maskedKeywords={maskedKeywords}
                                scrollContainerRef={scrollContainerRef as any}
                                onRangeSelection={handleRangeAdapter}
                                onBackgroundClick={handleBackgroundClick}
                                busyAction={removedAction}
                            />
                        </motion.div>
                    )}

                    {(activeTab === 'intermediates' && initializedTabs.has('intermediates')) && (
                        <motion.div
                            key="intermediates"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                        >
                            <IntermediatesTab
                                images={localIntermediateImages}
                                selectedIds={selectedIds}
                                onItemClick={handleItemClickAdapter}
                                onSelectAll={handleSelectAll}
                                onClearSelection={clearSelection}
                                onDeleteSelected={handleDeleteSelected}
                                onUnmarkSelected={handleUnmarkIntermediates}
                                onViewImage={setViewingImageId}
                                maskedKeywords={maskedKeywords}
                                scrollContainerRef={scrollContainerRef as any}
                                onRangeSelection={handleRangeAdapter}
                                onBackgroundClick={handleBackgroundClick}
                                scope={intermediatesScope}
                                onScopeChange={handleIntermediatesScopeChange}
                            />
                        </motion.div>
                    )}

                    {/* Scan Placeholders */}
                    {activeTab !== 'trash' && activeTab !== 'missing' && !initializedTabs.has(activeTab) && (
                        <motion.div
                            key={`${activeTab}-placeholder`}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            <ScanPlaceholder
                                tab={activeTab}
                                onStartScan={(tab, scope) => {
                                    if (tab === 'duplicates') {
                                        setDuplicatesScope(scope);
                                    }
                                    refreshData(tab, true, {
                                        scope,
                                        includeUpgradeable: tab === 'thumbnails' ? includeUpgradeable : undefined,
                                        runHashBackfill: tab === 'duplicates'
                                    });
                                }}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Global Image Viewer Portal */}
            {viewingImageId && targetImage && (
                <ImageViewer
                    image={targetImage}
                    isOpen={true}
                    onClose={() => setViewingImageId(null)}
                    onNext={() => {
                        const list = currentList; // Use memoized current list
                        const idx = list.findIndex(i => i.id === viewingImageId);
                        if (idx !== -1 && idx < list.length - 1) setViewingImageId(list[idx + 1].id);
                    }}
                    onPrev={() => {
                        const list = currentList;
                        const idx = list.findIndex(i => i.id === viewingImageId);
                        if (idx > 0) setViewingImageId(list[idx - 1].id);
                    }}
                    onAddToCollection={() => { }}
                    onSearch={() => { }}
                    onToggleFavorite={(id) => onToggleFavorite?.(id)}
                    onTogglePin={onTogglePin}
                    onUpdatePrompt={onUpdatePrompt}
                    onUpdateModel={onUpdateModel}
                    onUpdateTool={onUpdateTool}
                    onUpdateNotes={onUpdateNotes}
                    onRecoverMetadata={onRecoverMetadata}
                    availableTags={availableTags}
                    onOpenSettings={() => { }}
                    onDelete={activeTab === 'trash' ? undefined : handleViewerCleanup}
                />
            )}

            {compareImages && (
                <CompareModal
                    imageA={compareImages[0]}
                    imageB={compareImages[1]}
                    onClose={() => setCompareImages(null)}
                    onToggleFavorite={(id) => onToggleFavorite?.(id)}
                />
            )}
        </div>
    );
};
