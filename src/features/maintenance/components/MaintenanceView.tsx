import * as React from 'react';
import { useState, useMemo, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AIImage, GeneratorTool } from '../../../types';
import { DuplicateFinder } from './DuplicateFinder';
import { Loader2 } from 'lucide-react';
import { ImageViewer } from '../../../features/viewer/components/ImageViewer';
import { useMaintenanceData, MaintenanceTab } from '../../../hooks/useMaintenanceData';
import { TrashTab } from './TrashTab';
import { UntaggedTab } from './UntaggedTab';
import { MissingTab } from './MissingTab';
import { ThumbnailsTab } from './ThumbnailsTab';
import { IntermediatesTab } from './IntermediatesTab';
import { MaintenanceTabs } from './MaintenanceTabs';
import { ScanPlaceholder } from './ScanPlaceholder';
import { useSelection } from '../../../hooks/useSelection';

interface MaintenanceViewProps {
    images: AIImage[];
    onResolveDuplicate: (keepId: string, deleteIds: string[]) => void;
    onRestoreImages: (ids: string[]) => void;
    onMoveToTrash: (ids: string[]) => void;
    onDeleteForever: (ids: string[]) => void;
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
    onMoveToTrash,
    onDeleteForever,
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

    // Scopes
    const [thumbnailsScope, setThumbnailsScope] = useState<'global' | 'filtered'>('global');
    const [untaggedScope, setUntaggedScope] = useState<'global' | 'filtered'>('global');
    const [duplicatesScope, setDuplicatesScope] = useState<'global' | 'filtered'>('global');
    const [intermediatesScope, setIntermediatesScope] = useState<'global' | 'filtered'>('global');

    const [viewingImageId, setViewingImageId] = useState<string | null>(null);
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
        localIntermediateImages,
        refreshData,
    } = useMaintenanceData(activeTab, thumbnailsScope);

    // --- Computed Data ---
    const activeImages = useMemo(() => images.filter(img => !img.isDeleted), [images]);

    const missingImages = useMemo(() => {
        const uniquePool = Array.from(new Map([...images, ...fetchedMissingImages].map(item => [item.id, item])).values());
        if (scanMissingIds.size > 0) {
            return uniquePool.filter(img => scanMissingIds.has(img.id) && !img.isDeleted);
        }
        return uniquePool.filter(img => img.isMissing && !img.isDeleted);
    }, [images, fetchedMissingImages, scanMissingIds]);

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

    const handleScanComplete = async (ids: string[]) => {
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
    };

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
        await onRestoreImages(ids);
        await refreshData('trash', false);
        clearSelection();
    };

    const handleDeleteSelected = async () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;

        if (activeTab === 'untagged' || activeTab === 'missing') {
            await onMoveToTrash(ids);
        } else {
            await onDeleteForever(ids);
        }

        const scope = activeTab === 'untagged' ? untaggedScope :
            activeTab === 'thumbnails' ? thumbnailsScope :
                activeTab === 'duplicates' ? duplicatesScope :
                    activeTab === 'intermediates' ? intermediatesScope : 'global';

        await refreshData(activeTab, false, { scope: scope as any });

        if (activeTab === 'missing') {
            setScanMissingIds(prev => {
                const next = new Set(prev);
                ids.forEach(id => next.delete(id));
                return next;
            });
            setFetchedMissingImages(prev => prev.filter(img => !ids.includes(img.id)));
        }
        clearSelection();
    };

    const handlePurgeMissing = async () => {
        const ids = missingImages.map(i => i.id);
        await onMoveToTrash(ids);
        await refreshData('missing', false);
        setScanMissingIds(new Set());
        setFetchedMissingImages([]);
    };

    const handleRegenerate = async (ids?: string[]) => {
        if (!onRegenerateThumbnails) return;

        // If specific IDs not passed, assume "Regenerate All" from the current unoptimized list
        const targets = ids || localUnoptimizedImages.map(i => i.id);

        await onRegenerateThumbnails(targets);
        if (ids) {
            clearSelection();
        }
        await refreshData('thumbnails', false, { scope: thumbnailsScope });
    };

    const handleResolveDuplicate = useCallback(async (keepId: string, deleteIds: string[]) => {
        await onResolveDuplicate(keepId, deleteIds);
        await refreshData('duplicates', false, { scope: duplicatesScope });
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


    const handleBackgroundClick = useCallback(() => {
        clearSelection();
    }, [clearSelection]);


    return (
        <div className="h-full flex flex-col overflow-hidden">
            <MaintenanceTabs activeTab={activeTab} onTabChange={setActiveTab} />

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
                                    refreshData('duplicates', true, { scope });
                                }}
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
                                onMoveToTrash={handleDeleteSelected}
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
                                onStartScan={(tab, scope) => refreshData(tab, true, { scope })}
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
                    onDelete={() => {
                        if (viewingImageId) {
                            onDeleteForever([viewingImageId]);
                            setViewingImageId(null);
                            refreshData(activeTab);
                        }
                    }}
                />
            )}
        </div>
    );
};
