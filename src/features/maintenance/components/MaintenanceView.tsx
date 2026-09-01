import * as React from 'react';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AIImage, GeneratorTool, isVideoAsset, type VideoGenerationMode } from '../../../types';
import { DuplicateFinder } from './DuplicateFinder';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { ImageViewer } from '../../../features/viewer/components/ImageViewer';
import { VideoViewer } from '../../../features/viewer/components/VideoViewer';
import { CompareModal } from '../../../features/viewer/components/CompareModal';
import { useMaintenanceData, MaintenanceTab } from '../../../hooks/useMaintenanceData';
import { TrashTab } from './TrashTab';
import { UntaggedTab } from './UntaggedTab';
import { MissingTab } from './MissingTab';
import { ThumbnailsTab } from './ThumbnailsTab';
import { IntermediatesTab } from './IntermediatesTab';
import { MAINTENANCE_TABS, MaintenanceTabs } from './MaintenanceTabs';
import { ScanPlaceholder } from './ScanPlaceholder';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useSelection } from '../../../hooks/useSelection';
import { useLibraryStore } from '../../../stores/libraryStore';
import { useLibraryContext } from '../../../contexts/LibraryContext';
import { getImagesByIds, toggleImageIntermediate } from '../../../services/db/imageRepo';
import { regenerateAllUnoptimized } from '../../../services/thumbnailService';
import type { DeleteRemovedImagesResult, ExactDuplicateResolution } from '../../../bindings';
import { isImageMasked } from '../../../utils/maskingUtils';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useQueryClient } from '@tanstack/react-query';
import { useCollectionStore } from '../../../stores/collectionStore';
import { refreshThumbnailConsumers } from '../../../services/thumbnailConsumerRefresh';

interface MaintenanceViewProps {
    images: AIImage[];
    onResolveDuplicate: (resolutions: ExactDuplicateResolution[]) => Promise<void>;
    onRestoreImages: (ids: string[]) => Promise<void>;
    onRemoveFromLibrary: (ids: string[]) => Promise<void>;
    onDeleteFile: (ids: string[]) => Promise<DeleteRemovedImagesResult>;
    onEmptyTrash: () => Promise<void>;
    onGroupImages?: (ids: string[]) => void;
    onViewImage: (id: string) => void;
    onRegenerateThumbnails?: (ids?: string[]) => void;
    maskedKeywords: string[];
    onUpdatePrompt?: (id: string, prompt: string) => void;
    onUpdateNegativePrompt?: (id: string, prompt: string) => void;
    onUpdateModel?: (id: string, model: string) => void;
    onUpdateTool?: (id: string, tool: GeneratorTool) => void;
    onUpdateGenerationMode?: (id: string, mode: VideoGenerationMode) => void;
    onUpdateNotes?: (id: string, notes: string) => void;
    onRevertMetadata?: (id: string) => void;
    onSearch: (term: string) => void;
    onOpenSettings: () => void;
    onRecoverMetadata?: (targetId: string, onRecovered: (image: AIImage) => void) => void;
    onToggleFavorite?: (id: string) => void;
    onTogglePin?: (id: string, isPinned: boolean) => void;
    onSetCollectionMembership: (imageId: string, collectionId: string, shouldBelong: boolean) => Promise<boolean>;
    availableTags?: string[];
    onViewerOpenChange: (isOpen: boolean) => void;
    onOpenReferencedImage: (imageId: string) => Promise<boolean>;
    isShortcutBlocked: boolean;
    modelOptions?: readonly string[];
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
    onUpdateNegativePrompt,
    onUpdateModel,
    onUpdateTool,
    onUpdateGenerationMode,
    onUpdateNotes,
    onRevertMetadata,
    onSearch,
    onOpenSettings,
    onRecoverMetadata,
    onToggleFavorite,
    onTogglePin,
    onSetCollectionMembership,
    availableTags,
    onViewerOpenChange,
    onOpenReferencedImage,
    isShortcutBlocked,
    modelOptions = []
}) => {
    // --- State ---
    const [activeTab, setActiveTabOriginal] = useState<MaintenanceTab>('missing');
    const intermediatesCount = useLibraryStore(s => s.maintenanceCounts.intermediates);
    const isScanningDuplicates = useLibraryStore(s => s.isScanningDuplicates);
    const duplicateScanProgress = useLibraryStore(s => s.duplicateScanProgress);
    const lastDuplicateScanResult = useLibraryStore(s => s.lastDuplicateScanResult);
    const cancelDuplicateScan = useLibraryStore(s => s.cancelDuplicateScan);
    const lastMissingScanResult = useLibraryStore(s => s.lastMissingScanResult);
    const { activeSqlWhere, activeSqlParams } = useLibraryContext();
    const queryClient = useQueryClient();
    const refreshCollectionThumbnails = useCollectionStore(state => state.refreshCollectionThumbnails);

    // Scopes
    const [thumbnailsScope, setThumbnailsScope] = useState<'global' | 'filtered'>('global');
    const [untaggedScope, setUntaggedScope] = useState<'global' | 'filtered'>('global');
    const [intermediatesScope, setIntermediatesScope] = useState<'global' | 'filtered'>('global');
    const [includeUpgradeable, setIncludeUpgradeable] = useState(false);

    const [viewingImageId, setViewingImageId] = useState<string | null>(null);
    const [viewerRevealGrantId, setViewerRevealGrantId] = useState<string | null>(null);
    const [compareImages, setCompareImages] = useState<[AIImage, AIImage] | null>(null);
    const [recoveredImages, setRecoveredImages] = useState<Map<string, AIImage>>(() => new Map());
    const [removedAction, setRemovedAction] = useState<'restoring' | 'deleting' | null>(null);
    const privacyEnabled = useSettingsStore(state => state.privacyEnabled);
    const [deleteConfirmationIds, setDeleteConfirmationIds] = useState<string[] | null>(null);
    const [deleteConfirmationSource, setDeleteConfirmationSource] = useState<'removed' | 'intermediates'>('removed');
    const [deleteConfirmationError, setDeleteConfirmationError] = useState(false);
    const deleteInFlightRef = useRef(false);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Missing Scan Special State
    const [scanMissingIds, setScanMissingIds] = useState<Set<string>>(new Set());
    const [fetchedMissingImages, setFetchedMissingImages] = useState<AIImage[]>([]);

    useEffect(() => {
        onViewerOpenChange(viewingImageId !== null || compareImages !== null);
    }, [viewingImageId, compareImages, onViewerOpenChange]);

    useEffect(() => () => onViewerOpenChange(false), [onViewerOpenChange]);

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
        hasActiveLoadError,
        hasLoadedActiveTab,
        refreshData,
        retryActiveTab,
        setLocalDeletedImages,
        setLocalUntaggedImages,
        setLocalUnoptimizedImages,
        setLocalMissingImages,
        setLocalDuplicateCandidates,
        setLocalIntermediateImages,
    } = useMaintenanceData(activeTab, thumbnailsScope);

    // --- Computed Data ---
    const activeImages = useMemo(() => images.filter(img => !img.isDeleted), [images]);

    const missingImages = useMemo(() => {
        const uniquePool = Array.from(new Map([...localMissingImages, ...fetchedMissingImages].map(item => [item.id, item])).values());
        return uniquePool.filter(img => !img.isDeleted);
    }, [localMissingImages, fetchedMissingImages]);

    // Define the current list for selection logic
    const currentList = useMemo(() => {
        const lists: Record<MaintenanceTab, AIImage[]> = {
            trash: localDeletedImages,
            untagged: localUntaggedImages,
            thumbnails: localUnoptimizedImages,
            missing: missingImages,
            intermediates: localIntermediateImages,
            duplicates: localDuplicateCandidates
        };
        return lists[activeTab];
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
        const image = allPool.find(i => i.id === viewingImageId) || null;
        return image ? recoveredImages.get(image.id) ?? image : null;
    }, [viewingImageId, missingImages, localUntaggedImages, localDeletedImages, localUnoptimizedImages, localDuplicateCandidates, localIntermediateImages, activeImages, recoveredImages]);

    const handleRecoveredImage = useCallback((image: AIImage) => {
        setRecoveredImages(previous => {
            const next = new Map(previous);
            next.set(image.id, image);
            return next;
        });
    }, []);

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
        if (tab === activeTab) return;
        setActiveTabOriginal(tab);
        clearSelection();
        scrollContainerRef.current?.scrollTo?.({ top: 0 });
    }, [activeTab, clearSelection]);

    const handleScanComplete = useCallback(async (ids: string[]) => {
        setScanMissingIds(new Set(ids));
        if (ids.length > 0) {
            try {
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
    const openViewer = useCallback((id: string, revealGranted = false) => {
        setViewerRevealGrantId(revealGranted ? id : null);
        setViewingImageId(id);
    }, []);

    const handleItemClickAdapter = useCallback((id: string, index: number, e: React.MouseEvent, revealGranted = false) => {
        handleImageClick(e, id, index, () => {
            openViewer(id, revealGranted);
        });
    }, [handleImageClick, openViewer]);

    const handleOpenReferencedImage = useCallback(async (imageId: string): Promise<boolean> => {
        const opened = await onOpenReferencedImage(imageId);
        if (opened) setViewingImageId(null);
        return opened;
    }, [onOpenReferencedImage]);

    const handleSelectAll = useCallback(() => {
        const ids = currentList.map(i => i.id);
        setSelectedIds(new Set(ids));
    }, [currentList, setSelectedIds]);

    // Range selection adapter
    const handleRangeAdapter = useCallback((indexes: number[], isAdditive: boolean) => {
        selectionRangeHandler(indexes, isAdditive);
    }, [selectionRangeHandler]);

    const handleCompareTogglePin = useCallback((id: string, isPinned: boolean) => {
        setCompareImages(prev => {
            return [
                prev![0].id === id ? { ...prev![0], isPinned } : prev![0],
                prev![1].id === id ? { ...prev![1], isPinned } : prev![1]
            ];
        });
        onTogglePin!(id, isPinned);
    }, [onTogglePin]);


    // --- Actions ---

    const handleRestoreSelected = async () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
        setRemovedAction('restoring');
        try {
            await onRestoreImages(ids);
            const restoredIds = new Set(ids);
            setLocalDeletedImages(previous => previous.filter(image => !restoredIds.has(image.id)));
            clearSelection();
        } catch (error) {
            console.error('[Maintenance] Restore failed', error);
            return;
        } finally {
            setRemovedAction(null);
        }
        try {
            await refreshData('trash', false);
        } catch (error) {
            console.error('[Maintenance] Restore completed, but the view failed to refresh', error);
        }
    };

    const handleDeleteSelected = async () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;

        if (activeTab === 'trash') {
            setDeleteConfirmationSource('removed');
            setDeleteConfirmationError(false);
            setDeleteConfirmationIds(ids);
            return;
        }

        if (activeTab === 'intermediates') {
            setDeleteConfirmationSource('intermediates');
            setDeleteConfirmationError(false);
            setDeleteConfirmationIds(ids);
            return;
        }

        try {
            await onRemoveFromLibrary(ids);
        } catch (error) {
            console.error('[Maintenance] Remove from library failed', error);
            return;
        }

        const removedIds = new Set(ids);
        if (activeTab === 'missing') {
            setScanMissingIds(prev => {
                const next = new Set(prev);
                ids.forEach(id => next.delete(id));
                return next;
            });
            setFetchedMissingImages(prev => prev.filter(img => !removedIds.has(img.id)));
            setLocalMissingImages(prev => prev.filter(img => !removedIds.has(img.id)));
        } else if (activeTab === 'untagged') {
            setLocalUntaggedImages(prev => prev.filter(img => !removedIds.has(img.id)));
        } else if (activeTab === 'thumbnails') {
            setLocalUnoptimizedImages(prev => prev.filter(img => !removedIds.has(img.id)));
        }
        clearSelection();

        const scope: 'global' | 'filtered' = activeTab === 'untagged' ? untaggedScope : 'global';
        try {
            await refreshData(activeTab, false, { scope });
        } catch (error) {
            console.error('[Maintenance] Removal completed, but the view failed to refresh', error);
        }
    };

    const handleConfirmDeleteRemoved = async () => {
        const ids = deleteConfirmationIds;
        if (!ids || ids.length === 0 || deleteInFlightRef.current) return;

        deleteInFlightRef.current = true;
        setRemovedAction('deleting');
        setDeleteConfirmationError(false);
        try {
            if (deleteConfirmationSource === 'intermediates') {
                await onRemoveFromLibrary(ids);
                const removedIds = new Set(ids);
                setLocalIntermediateImages(previous => previous.filter(image => !removedIds.has(image.id)));
            }
            const result = await onDeleteFile(ids);
            if (deleteConfirmationSource === 'removed' && result.clearedIds.length > 0) {
                const clearedIds = new Set(result.clearedIds);
                setLocalDeletedImages(previous => previous.filter(image => !clearedIds.has(image.id)));
            }
            const unresolvedIds = new Set([...result.failedIds, ...result.cleanupPendingIds]);
            setSelectedIds(unresolvedIds);
            setDeleteConfirmationIds(null);
            try {
                await refreshData(
                    deleteConfirmationSource === 'removed' ? 'trash' : 'intermediates',
                    false,
                    { scope: deleteConfirmationSource === 'removed' ? 'global' : intermediatesScope }
                );
            } catch (error) {
                console.error('[Maintenance] Deletion completed, but the view failed to refresh', error);
            }
        } catch (error) {
            console.error('[Maintenance] Removed deletion failed', error);
            setDeleteConfirmationError(true);
        } finally {
            deleteInFlightRef.current = false;
            setRemovedAction(null);
        }
    };

    const handlePurgeMissing = async () => {
        const ids = missingImages.map(i => i.id);
        try {
            await onRemoveFromLibrary(ids);
        } catch (error) {
            console.error('[Maintenance] Missing-image purge failed', error);
            return;
        }
        setScanMissingIds(new Set());
        setFetchedMissingImages([]);
        setLocalMissingImages([]);
        try {
            await refreshData('missing', false);
        } catch (error) {
            console.error('[Maintenance] Missing-image purge completed, but the view failed to refresh', error);
        }
    };

    const handleViewerCleanup = useCallback(async () => {
        const id = viewingImageId!;
        try {
            await onRemoveFromLibrary([id]);
        } catch (error) {
            console.error('[Maintenance] Viewer cleanup failed', error);
            return;
        }
        setViewerRevealGrantId(null);
        setViewingImageId(null);

        if (activeTab === 'missing') {
            setScanMissingIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
            setFetchedMissingImages(prev => prev.filter(img => img.id !== id));
            setLocalMissingImages(prev => prev.filter(img => img.id !== id));
        } else if (activeTab === 'untagged') {
            setLocalUntaggedImages(prev => prev.filter(img => img.id !== id));
        } else if (activeTab === 'thumbnails') {
            setLocalUnoptimizedImages(prev => prev.filter(img => img.id !== id));
        } else if (activeTab === 'intermediates') {
            setLocalIntermediateImages(prev => prev.filter(img => img.id !== id));
        }

        const scope: 'global' | 'filtered' = activeTab === 'untagged' ? untaggedScope :
            activeTab === 'thumbnails' ? thumbnailsScope :
                activeTab === 'intermediates' ? intermediatesScope : 'global';

        try {
            await refreshData(activeTab, false, {
                scope,
                includeUpgradeable: activeTab === 'thumbnails' ? includeUpgradeable : undefined,
                runHashBackfill: false
            });
        } catch (error) {
            console.error('[Maintenance] Viewer cleanup completed, but the view failed to refresh', error);
        }
    }, [
        activeTab,
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
                await regenerateAllUnoptimized(
                    (current, total) => setThumbnailProgress({ current, total }),
                    abortCtrl.signal,
                    where,
                    params,
                    includeUpgradeable
                );
                await refreshThumbnailConsumers({
                    queryClient,
                    refreshCollectionThumbnails,
                    logPrefix: '[Maintenance]',
                });
            } finally {
                setIsRegeneratingThumbnails(false);
                setThumbnailProgress(null);
                setThumbnailAbortController(null);
            }
        }
        await refreshData('thumbnails', false, { scope: thumbnailsScope, includeUpgradeable });
    };

    const handleResolveDuplicate = useCallback(async (resolutions: ExactDuplicateResolution[]) => {
        await onResolveDuplicate(resolutions);
        const removedIds = new Set(resolutions.flatMap(resolution => resolution.removeIds));
        setLocalDuplicateCandidates(previous => previous.filter(image => !removedIds.has(image.id)));
        await refreshData('duplicates', false, { runHashBackfill: false });
    }, [onResolveDuplicate, refreshData, setLocalDuplicateCandidates]);

    const handleUnmarkIntermediates = async () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;
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

    const activeTabLabel = MAINTENANCE_TABS.find(tab => tab.id === activeTab)?.label ?? activeTab;
    const showsScanPlaceholder = activeTab !== 'trash' && activeTab !== 'missing' && !initializedTabs.has(activeTab);
    const showsInitialLoadError = hasActiveLoadError && !hasLoadedActiveTab;
    const activePanelState = showsInitialLoadError ? 'error' : showsScanPlaceholder ? 'placeholder' : 'content';


    return (
        <div className="h-full flex flex-col overflow-hidden">
            <MaintenanceTabs activeTab={activeTab} onTabChange={setActiveTab} intermediatesCount={intermediatesCount} />

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto relative custom-scrollbar px-6 pb-8" ref={scrollContainerRef}>
                <AnimatePresence mode="wait">
                    <motion.div
                        key={`${activeTab}-${activePanelState}`}
                        id={`maintenance-panel-${activeTab}`}
                        role="tabpanel"
                        aria-labelledby={`maintenance-tab-${activeTab}`}
                        aria-busy={isLoading}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                    >
                        {showsInitialLoadError ? (
                            <div role="alert" className="flex min-h-64 flex-col items-center justify-center gap-4 text-center">
                                <AlertTriangle className="h-10 w-10 text-ember-600 dark:text-ember-300" aria-hidden="true" />
                                <div>
                                    <h3 className="font-bold text-gray-900 dark:text-white">Couldn&apos;t load {activeTabLabel} data</h3>
                                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Your library was not changed. Try loading this section again.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void retryActiveTab()}
                                    className="inline-flex items-center gap-2 rounded-lg bg-sage-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-sage-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950"
                                >
                                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                                    Retry
                                </button>
                            </div>
                        ) : (
                            <div inert={isLoading ? true : undefined}>
                                {hasActiveLoadError && (
                                    <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ember-200 bg-ember-50 px-4 py-3 text-sm text-ember-600 dark:border-ember-500/30 dark:bg-ember-500/10 dark:text-ember-300">
                                        <span className="flex items-center gap-2">
                                            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                                            Refresh failed. Showing the last loaded {activeTabLabel.toLowerCase()} data.
                                        </span>
                                        <button type="button" onClick={() => void retryActiveTab()} className="inline-flex items-center gap-2 font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-500">
                                            <RefreshCw className="h-4 w-4" aria-hidden="true" />
                                            Retry
                                        </button>
                                    </div>
                                )}

                                {(activeTab === 'thumbnails' && initializedTabs.has('thumbnails')) && (
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
                                        scrollContainerRef={scrollContainerRef as React.RefObject<HTMLElement | null>}
                                        onRangeSelection={handleRangeAdapter}
                                        onBackgroundClick={handleBackgroundClick}
                                        includeUpgradeable={includeUpgradeable}
                                        onIncludeUpgradeableChange={handleIncludeUpgradeableChange}
                                        onRepairComplete={() => refreshData('thumbnails', false, { scope: thumbnailsScope, includeUpgradeable })}
                                    />
                                )}

                                {(activeTab === 'duplicates' && initializedTabs.has('duplicates')) && (
                                    <DuplicateFinder
                                        images={localDuplicateCandidates}
                                        onResolve={handleResolveDuplicate}
                                        maskedKeywords={maskedKeywords}
                                        onRefresh={() => refreshData('duplicates', true, { runHashBackfill: true })}
                                        isScanning={isScanningDuplicates}
                                        scanProgress={duplicateScanProgress}
                                        scanResult={lastDuplicateScanResult}
                                        onCancelScan={cancelDuplicateScan}
                                        onViewImage={openViewer}
                                        onCompareImages={(imageA, imageB) => setCompareImages([imageA, imageB])}
                                        scrollContainerRef={scrollContainerRef}
                                        onRangeSelection={handleRangeAdapter}
                                        onBackgroundClick={handleBackgroundClick}
                                    />
                                )}

                                {(activeTab === 'untagged' && initializedTabs.has('untagged')) && (
                                    <UntaggedTab
                                        images={localUntaggedImages}
                                        selectedIds={selectedIds}
                                        onItemClick={handleItemClickAdapter}
                                        onSelectAll={handleSelectAll}
                                        onClearSelection={clearSelection}
                                        onRemoveFromLibrary={handleDeleteSelected}
                                        onViewImage={openViewer}
                                        maskedKeywords={maskedKeywords}
                                        scrollContainerRef={scrollContainerRef as React.RefObject<HTMLElement | null>}
                                        onRangeSelection={handleRangeAdapter}
                                        onBackgroundClick={handleBackgroundClick}
                                        untaggedScope={untaggedScope}
                                        onScopeChange={handleUntaggedScopeChange}
                                    />
                                )}

                                {activeTab === 'missing' && (
                                    <div className="flex flex-col gap-6">
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
                                            onViewImage={openViewer}
                                            maskedKeywords={maskedKeywords}
                                            scrollContainerRef={scrollContainerRef as React.RefObject<HTMLElement | null>}
                                            onRangeSelection={handleRangeAdapter}
                                            onBackgroundClick={handleBackgroundClick}
                                        />
                                    </div>
                                )}

                                {activeTab === 'trash' && (
                                    <TrashTab
                                        images={localDeletedImages}
                                        selectedIds={selectedIds}
                                        onItemClick={handleItemClickAdapter}
                                        onSelectAll={handleSelectAll}
                                        onClearSelection={clearSelection}
                                        onRestoreSelected={handleRestoreSelected}
                                        onDeleteSelected={handleDeleteSelected}
                                        maskedKeywords={maskedKeywords}
                                        scrollContainerRef={scrollContainerRef as React.RefObject<HTMLElement | null>}
                                        onRangeSelection={handleRangeAdapter}
                                        onBackgroundClick={handleBackgroundClick}
                                        busyAction={removedAction}
                                    />
                                )}

                                {(activeTab === 'intermediates' && initializedTabs.has('intermediates')) && (
                                    <IntermediatesTab
                                        images={localIntermediateImages}
                                        selectedIds={selectedIds}
                                        onItemClick={handleItemClickAdapter}
                                        onSelectAll={handleSelectAll}
                                        onClearSelection={clearSelection}
                                        onDeleteSelected={handleDeleteSelected}
                                        onUnmarkSelected={handleUnmarkIntermediates}
                                        onViewImage={openViewer}
                                        maskedKeywords={maskedKeywords}
                                        scrollContainerRef={scrollContainerRef as React.RefObject<HTMLElement | null>}
                                        onRangeSelection={handleRangeAdapter}
                                        onBackgroundClick={handleBackgroundClick}
                                        scope={intermediatesScope}
                                        onScopeChange={handleIntermediatesScopeChange}
                                    />
                                )}

                                {showsScanPlaceholder && (
                                    <ScanPlaceholder
                                        tab={activeTab}
                                        onStartScan={(tab, scope) => {
                                            refreshData(tab, true, {
                                                scope: tab === 'duplicates' ? 'global' : scope,
                                                includeUpgradeable: tab === 'thumbnails' ? includeUpgradeable : undefined,
                                                runHashBackfill: tab === 'duplicates'
                                            });
                                        }}
                                    />
                                )}
                            </div>
                        )}
                    </motion.div>
                </AnimatePresence>

                <AnimatePresence>
                    {isLoading && (
                        <motion.div
                            key={`loader-${activeTab}`}
                            role="status"
                            aria-live="polite"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur-sm dark:bg-zinc-950/70"
                        >
                            <div className="flex flex-col items-center gap-4">
                                <Loader2 className="h-10 w-10 animate-spin text-sage-600 dark:text-sage-400" aria-hidden="true" />
                                <p className="animate-pulse text-sm font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                                    Loading {activeTabLabel} data...
                                </p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Global media viewer portal */}
            {viewingImageId && targetImage && (
                isVideoAsset(targetImage) ? (
                    <VideoViewer
                        video={targetImage}
                        isMasked={isImageMasked(targetImage, privacyEnabled, maskedKeywords)}
                        initiallyRevealed={viewerRevealGrantId === targetImage.id}
                        onClose={() => { setViewerRevealGrantId(null); setViewingImageId(null); }}
                        onNext={() => {
                            const idx = currentList.findIndex(item => item.id === viewingImageId);
                            if (idx !== -1 && idx < currentList.length - 1) {
                                setViewerRevealGrantId(null);
                                setViewingImageId(currentList[idx + 1].id);
                            }
                        }}
                        onPrev={() => {
                            const idx = currentList.findIndex(item => item.id === viewingImageId);
                            if (idx > 0) {
                                setViewerRevealGrantId(null);
                                setViewingImageId(currentList[idx - 1].id);
                            }
                        }}
                        onToggleFavorite={activeTab === 'trash' || !onToggleFavorite ? undefined : onToggleFavorite}
                        onTogglePin={activeTab === 'trash' ? undefined : onTogglePin}
                        onDelete={activeTab === 'trash' ? undefined : () => { void handleViewerCleanup(); }}
                        onUpdateNotes={activeTab === 'trash' ? undefined : onUpdateNotes}
                        onUpdatePrompt={activeTab === 'trash' ? undefined : onUpdatePrompt}
                        onUpdateNegativePrompt={activeTab === 'trash' ? undefined : onUpdateNegativePrompt}
                        onUpdateModel={activeTab === 'trash' ? undefined : onUpdateModel}
                        onUpdateTool={activeTab === 'trash' ? undefined : onUpdateTool}
                        onUpdateGenerationMode={activeTab === 'trash' ? undefined : onUpdateGenerationMode}
                        onRevertMetadata={activeTab === 'trash' ? undefined : onRevertMetadata}
                        onSearch={onSearch}
                        onSetCollectionMembership={activeTab === 'trash' ? undefined : onSetCollectionMembership}
                        modelOptions={modelOptions}
                        isShortcutBlocked={isShortcutBlocked}
                        canNavigatePrevious={currentList.findIndex(item => item.id === viewingImageId) > 0}
                        canNavigateNext={currentList.findIndex(item => item.id === viewingImageId) < currentList.length - 1}
                    />
                ) : (
                    <ImageViewer
                        image={targetImage}
                        isOpen={true}
                        isMasked={isImageMasked(targetImage, privacyEnabled, maskedKeywords)}
                        initiallyRevealed={viewerRevealGrantId === targetImage.id}
                        isShortcutBlocked={isShortcutBlocked}
                        onClose={() => { setViewerRevealGrantId(null); setViewingImageId(null); }}
                        onNext={() => {
                            const idx = currentList.findIndex(i => i.id === viewingImageId);
                            if (idx !== -1 && idx < currentList.length - 1) {
                                setViewerRevealGrantId(null);
                                setViewingImageId(currentList[idx + 1].id);
                            }
                        }}
                        onPrev={() => {
                            const idx = currentList.findIndex(i => i.id === viewingImageId);
                            if (idx > 0) {
                                setViewerRevealGrantId(null);
                                setViewingImageId(currentList[idx - 1].id);
                            }
                        }}
                        onSetCollectionMembership={activeTab === 'trash' ? undefined : onSetCollectionMembership}
                        onSearch={onSearch}
                        onToggleFavorite={activeTab === 'trash' || !onToggleFavorite ? undefined : onToggleFavorite}
                        onTogglePin={activeTab === 'trash' ? undefined : onTogglePin}
                        onUpdatePrompt={activeTab === 'trash' ? undefined : onUpdatePrompt}
                        onUpdateNegativePrompt={activeTab === 'trash' ? undefined : onUpdateNegativePrompt}
                        onUpdateModel={activeTab === 'trash' ? undefined : onUpdateModel}
                        onUpdateTool={activeTab === 'trash' ? undefined : onUpdateTool}
                        onUpdateNotes={activeTab === 'trash' ? undefined : onUpdateNotes}
                        onRevertMetadata={activeTab === 'trash' ? undefined : onRevertMetadata}
                        onRecoverMetadata={activeTab === 'trash' || !onRecoverMetadata
                            ? undefined
                            : () => onRecoverMetadata(viewingImageId, handleRecoveredImage)}
                        availableTags={availableTags}
                        modelOptions={modelOptions}
                        onOpenSettings={onOpenSettings}
                        onDelete={activeTab === 'trash' ? undefined : handleViewerCleanup}
                        onOpenReferencedImage={handleOpenReferencedImage}
                    />
                )
            )}

            {compareImages && (
                <CompareModal
                    imageA={compareImages[0]}
                    imageB={compareImages[1]}
                    onClose={() => setCompareImages(null)}
                    onToggleFavorite={(id) => onToggleFavorite?.(id)}
                    onTogglePin={onTogglePin ? handleCompareTogglePin : undefined}
                />
            )}

            <ConfirmDialog
                isOpen={deleteConfirmationIds !== null}
                title={deleteConfirmationSource === 'removed'
                    ? 'Move files to OS Trash?'
                    : 'Delete intermediate files?'}
                message={deleteConfirmationError
                    ? 'The deletion could not be completed. Any recoverable Removed entries were kept; you can safely try again.'
                    : deleteConfirmationSource === 'removed'
                        ? `${deleteConfirmationIds?.length ?? 0} selected ${deleteConfirmationIds?.length === 1 ? 'file' : 'files'} will be moved to OS Trash and their generation data will be removed from Ambit. Already-missing files will have their remaining Ambit entries cleared.`
                        : `${deleteConfirmationIds?.length ?? 0} intermediate ${deleteConfirmationIds?.length === 1 ? 'file' : 'files'} will be removed from Ambit and moved to OS Trash. Failed moves remain recoverable in Maintenance > Removed.`}
                confirmLabel="Move to OS Trash"
                isDangerous
                isLoading={removedAction === 'deleting'}
                onConfirm={handleConfirmDeleteRemoved}
                onCancel={() => {
                    setDeleteConfirmationError(false);
                    setDeleteConfirmationIds(null);
                }}
            />
        </div>
    );
};
