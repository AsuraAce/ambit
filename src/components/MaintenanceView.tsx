import * as React from 'react';
import { useState, useMemo, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AIImage } from '../types';
import { DuplicateFinder } from './DuplicateFinder';
import { Eraser, Loader2 } from 'lucide-react';
import { ImageViewer } from './ImageViewer';
import { useLibraryContext } from '../hooks/useLibraryContext';
import { MaintenanceTab, useMaintenanceData } from '../hooks/useMaintenanceData';
import { TrashTab } from './maintenance/TrashTab';
import { UntaggedTab } from './maintenance/UntaggedTab';
import { MissingTab } from './maintenance/MissingTab';
import { ThumbnailsTab } from './maintenance/ThumbnailsTab';


interface MaintenanceViewProps {
    images: AIImage[];
    onResolveDuplicate: (keepId: string, deleteIds: string[]) => void;
    onRestoreImages: (ids: string[]) => void;
    onMoveToTrash: (ids: string[]) => void; // Added for non-destructive safety
    onDeleteForever: (ids: string[]) => void;
    onEmptyTrash: () => Promise<void>;
    onGroupImages?: (ids: string[]) => void;
    onViewImage: (id: string) => void;
    onRegenerateThumbnails?: (ids?: string[]) => void;
    maskedKeywords: string[];
    privacyEnabled: boolean;
}

// Lazy load LibraryHealth outside component to prevent re-creation on render
const LibraryHealth = React.lazy(() => import('./maintenance/LibraryHealth').then(m => ({ default: m.LibraryHealth })));

export const MaintenanceView: React.FC<MaintenanceViewProps> = ({
    images,
    onResolveDuplicate,
    onRestoreImages,
    onMoveToTrash,
    onDeleteForever,
    onEmptyTrash,
    onGroupImages,
    onViewImage,
    onRegenerateThumbnails,
    maskedKeywords,
    privacyEnabled
}) => {
    const {
        maintenanceCounts,
        refreshMaintenanceCounts,
        activeSqlWhere,
        activeSqlParams
    } = useLibraryContext();

    const [activeTab, setActiveTabOriginal] = useState<MaintenanceTab>('missing');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
    const [thumbnailsScope, setThumbnailsScope] = useState<'global' | 'filtered'>('global');
    const [viewingImageId, setViewingImageId] = useState<string | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Missing scan state
    const [scanMissingIds, setScanMissingIds] = useState<Set<string>>(new Set());
    const [fetchedMissingImages, setFetchedMissingImages] = useState<AIImage[]>([]);

    const {
        isLoading,
        localDeletedImages,
        localUntaggedImages,
        localUnoptimizedImages,
        localDuplicateCandidates,
        refreshData,
    } = useMaintenanceData(activeTab, thumbnailsScope);

    const setActiveTab = useCallback((tab: MaintenanceTab) => {
        setActiveTabOriginal(tab);
        setSelectedIds(new Set());
        setLastSelectedIndex(null);
    }, []);

    const handleScanComplete = async (ids: string[]) => {
        setScanMissingIds(new Set(ids));
        if (ids.length > 0) {
            try {
                const { getImagesByIds } = await import('../services/db');
                const fetched = await getImagesByIds(ids);
                setFetchedMissingImages(fetched);
            } catch (e) {
                console.error('Failed to fetch missing images', e);
            }
        } else {
            setFetchedMissingImages([]);
        }
    };

    const activeImages = useMemo(() => images.filter(img => !img.isDeleted), [images]);

    const missingImages = useMemo(() => {
        const uniquePool = Array.from(new Map([...images, ...fetchedMissingImages].map(item => [item.id, item])).values());
        if (scanMissingIds.size > 0) {
            return uniquePool.filter(img => scanMissingIds.has(img.id) && !img.isDeleted);
        }
        return uniquePool.filter(img => img.isMissing && !img.isDeleted);
    }, [images, fetchedMissingImages, scanMissingIds]);

    const targetImage = useMemo(() => {
        if (!viewingImageId) return null;
        const allPool = [
            ...missingImages,
            ...localUntaggedImages,
            ...localDeletedImages,
            ...localUnoptimizedImages,
            ...localDuplicateCandidates
        ];
        return allPool.find(i => i.id === viewingImageId) || null;
    }, [viewingImageId, missingImages, localUntaggedImages, localDeletedImages, localUnoptimizedImages, localDuplicateCandidates]);

    // Selection Handlers
    const handleSelect = useCallback((id: string, index?: number, isAdditive: boolean = false) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                if (!isAdditive) next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
        if (typeof index === 'number') setLastSelectedIndex(index);
    }, []);

    const handleRangeSelection = useCallback((indexes: number[], isAdditive: boolean = false) => {
        let currentList: AIImage[] = [];
        if (activeTab === 'trash') currentList = localDeletedImages;
        else if (activeTab === 'untagged') currentList = localUntaggedImages;
        else if (activeTab === 'thumbnails') currentList = localUnoptimizedImages;
        else if (activeTab === 'missing') currentList = missingImages;
        else if (activeTab === 'duplicates') currentList = activeImages;

        const idsToProcess = indexes.map(idx => currentList[idx]?.id).filter(Boolean);

        setSelectedIds(prev => {
            const next = isAdditive ? new Set(prev) : new Set<string>();
            idsToProcess.forEach(id => next.add(id));
            return next;
        });
    }, [activeTab, localDeletedImages, localUntaggedImages, localUnoptimizedImages, missingImages, activeImages]);

    const handleItemClick = useCallback((id: string, index: number, e: React.MouseEvent) => {
        if (e.shiftKey && lastSelectedIndex !== null) {
            const start = Math.min(lastSelectedIndex, index);
            const end = Math.max(lastSelectedIndex, index);
            const rangeIndexes = Array.from({ length: end - start + 1 }, (_, i) => start + i);
            handleRangeSelection(rangeIndexes, true);
        } else {
            const isAdditive = e.ctrlKey || e.metaKey;
            handleSelect(id, index, isAdditive);
        }
    }, [lastSelectedIndex, handleSelect, handleRangeSelection]);

    const selectAll = () => {
        let currentList: AIImage[] = [];
        if (activeTab === 'trash') currentList = localDeletedImages;
        else if (activeTab === 'untagged') currentList = localUntaggedImages;
        else if (activeTab === 'thumbnails') currentList = localUnoptimizedImages;
        else if (activeTab === 'missing') currentList = missingImages;
        setSelectedIds(new Set(currentList.map(i => i.id)));
    };

    const handleRestoreSelected = async () => {
        await onRestoreImages(Array.from(selectedIds));
        await refreshData('trash', false);
        setSelectedIds(new Set());
        setLastSelectedIndex(null);
    };

    const handleDeleteSelected = async () => {
        const ids = Array.from(selectedIds);
        if (activeTab === 'untagged' || activeTab === 'missing') {
            await onMoveToTrash(ids);
        } else {
            await onDeleteForever(ids);
        }
        await refreshData(activeTab, false);

        if (activeTab === 'missing') {
            setScanMissingIds(prev => {
                const next = new Set(prev);
                ids.forEach(id => next.delete(id));
                return next;
            });
            setFetchedMissingImages(prev => prev.filter(img => !ids.includes(img.id)));
        }
        setSelectedIds(new Set());
        setLastSelectedIndex(null);
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
        await onRegenerateThumbnails(ids);
        if (ids) {
            setSelectedIds(new Set());
            setLastSelectedIndex(null);
        }
        await refreshData('thumbnails', false, { scope: thumbnailsScope });
    };

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 pt-4 pl-6 pr-8 pb-4 z-20">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-2xl shadow-lg">
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <div className="p-2 bg-sage-100 dark:bg-sage-900/30 rounded-lg text-sage-600 dark:text-sage-400">
                                <Eraser className="w-5 h-5" />
                            </div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Gallery Maintenance</h2>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 pl-1">Organize your library, resolve conflicts, and manage deleted items.</p>
                    </div>

                    <div className="bg-gray-100 dark:bg-zinc-800 p-1 rounded-xl flex items-center shadow-inner self-start md:self-auto overflow-x-auto max-w-full">
                        {[
                            { id: 'thumbnails', label: 'Thumbnails', count: maintenanceCounts.unoptimized, color: 'text-blue-500' },
                            { id: 'duplicates', label: 'Duplicates', color: 'text-sage-600 dark:text-sage-400' },
                            { id: 'untagged', label: 'Untagged', count: maintenanceCounts.untagged, color: 'text-orange-500' },
                            { id: 'missing', label: 'Missing', count: maintenanceCounts.missing, color: 'text-red-500' },
                            { id: 'trash', label: 'Trash', count: maintenanceCounts.trash, color: 'text-sage-600 dark:text-sage-400' }
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as MaintenanceTab)}
                                className={`px-4 py-2 text-sm font-bold rounded-lg transition-all duration-200 flex items-center gap-2 whitespace-nowrap ${activeTab === tab.id ? `bg-white dark:bg-zinc-700 ${tab.color} shadow-sm` : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                            >
                                {tab.label}
                                {tab.count !== undefined && tab.count > 0 && (
                                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${activeTab === tab.id ? 'bg-black/5 dark:bg-white/5 backdrop-blur-sm' : 'bg-gray-200 dark:bg-zinc-900'}`}>
                                        {tab.count}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto relative custom-scrollbar px-6 pb-8" ref={scrollContainerRef}>
                <AnimatePresence mode="wait">
                    {isLoading && (
                        <motion.div
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
                </AnimatePresence>

                {activeTab === 'thumbnails' && (
                    <ThumbnailsTab
                        images={localUnoptimizedImages}
                        selectedIds={selectedIds}
                        onItemClick={handleItemClick}
                        onSelectAll={selectAll}
                        onClearSelection={() => setSelectedIds(new Set())}
                        onRegenerate={handleRegenerate}
                        thumbnailsScope={thumbnailsScope}
                        onScopeChange={setThumbnailsScope}
                        unoptimizedCount={maintenanceCounts.unoptimized}
                        privacyEnabled={privacyEnabled}
                        maskedKeywords={maskedKeywords}
                        scrollContainerRef={scrollContainerRef}
                        onRangeSelection={handleRangeSelection}
                        onBackgroundClick={() => setSelectedIds(new Set())}
                    />
                )}

                {activeTab === 'duplicates' && (
                    <DuplicateFinder
                        images={localDuplicateCandidates}
                        onResolve={onResolveDuplicate}
                        maskedKeywords={maskedKeywords}
                        privacyEnabled={privacyEnabled}
                        onRefresh={(scope) => refreshData('duplicates', true, { scope })}
                        scrollContainerRef={scrollContainerRef}
                        onRangeSelection={handleRangeSelection}
                        onBackgroundClick={() => setSelectedIds(new Set())}
                    />
                )}

                {activeTab === 'untagged' && (
                    <UntaggedTab
                        images={localUntaggedImages}
                        selectedIds={selectedIds}
                        onItemClick={handleItemClick}
                        onSelectAll={selectAll}
                        onClearSelection={() => setSelectedIds(new Set())}
                        onMoveToTrash={handleDeleteSelected}
                        onViewImage={setViewingImageId}
                        privacyEnabled={privacyEnabled}
                        maskedKeywords={maskedKeywords}
                        scrollContainerRef={scrollContainerRef}
                        onRangeSelection={handleRangeSelection}
                        onBackgroundClick={() => setSelectedIds(new Set())}
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
                            onItemClick={handleItemClick}
                            onSelectAll={selectAll}
                            onClearSelection={() => setSelectedIds(new Set())}
                            onDeleteSelected={handleDeleteSelected}
                            onPurgeMissing={handlePurgeMissing}
                            onViewImage={setViewingImageId}
                            scrollContainerRef={scrollContainerRef}
                            onRangeSelection={handleRangeSelection}
                            onBackgroundClick={() => setSelectedIds(new Set())}
                        />
                    </div>
                )}

                {activeTab === 'trash' && (
                    <TrashTab
                        images={localDeletedImages}
                        selectedIds={selectedIds}
                        onItemClick={handleItemClick}
                        onSelectAll={selectAll}
                        onClearSelection={() => setSelectedIds(new Set())}
                        onRestoreSelected={handleRestoreSelected}
                        onDeleteSelected={handleDeleteSelected}
                        privacyEnabled={privacyEnabled}
                        maskedKeywords={maskedKeywords}
                        scrollContainerRef={scrollContainerRef}
                        onRangeSelection={handleRangeSelection}
                        onBackgroundClick={() => setSelectedIds(new Set())}
                    />
                )}
            </div>

            {/* Global Image Viewer Portal */}
            {viewingImageId && targetImage && (
                <ImageViewer
                    image={targetImage}
                    isOpen={true}
                    onClose={() => setViewingImageId(null)}
                    onNext={() => {
                        let list: AIImage[] = [];
                        if (activeTab === 'missing') list = fetchedMissingImages;
                        else if (activeTab === 'untagged') list = localUntaggedImages;
                        else if (activeTab === 'thumbnails') list = localUnoptimizedImages;
                        else if (activeTab === 'trash') list = localDeletedImages;

                        const idx = list.findIndex(i => i.id === viewingImageId);
                        if (idx !== -1 && idx < list.length - 1) setViewingImageId(list[idx + 1].id);
                    }}
                    onPrev={() => {
                        let list: AIImage[] = [];
                        if (activeTab === 'missing') list = fetchedMissingImages;
                        else if (activeTab === 'untagged') list = localUntaggedImages;
                        else if (activeTab === 'thumbnails') list = localUnoptimizedImages;
                        else if (activeTab === 'trash') list = localDeletedImages;

                        const idx = list.findIndex(i => i.id === viewingImageId);
                        if (idx > 0) setViewingImageId(list[idx - 1].id);
                    }}
                    onAddToCollection={() => { }}
                    onSearch={() => { }}
                    onToggleFavorite={() => { }}
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
