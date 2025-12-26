import * as React from 'react';
import { useState, useMemo, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AIImage } from '../types';
import { DuplicateFinder } from './DuplicateFinder';
import {
    Eraser,
    Loader2,
    CheckSquare,
    Eye,
    Wand2,
    Copy,
    Tag,
    Zap,
    Search,
    Globe,
    Filter,
    Play
} from 'lucide-react';
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

interface ScanPlaceholderProps {
    tab: MaintenanceTab;
    onStartScan: (tab: MaintenanceTab, scope: 'global' | 'filtered') => void;
}

const ScanPlaceholder: React.FC<ScanPlaceholderProps> = ({
    tab,
    onStartScan
}) => {
    const [scanScope, setScanScope] = useState<'global' | 'filtered'>('global');

    const metadata: Record<string, { title: string, description: string, icon: React.ReactNode, hasScope: boolean }> = {
        thumbnails: {
            title: "Thumbnail Optimization",
            description: "Check for images that need high-quality thumbnail regeneration to improve browsing speed.",
            icon: <Zap className="w-12 h-12" />,
            hasScope: true
        },
        duplicates: {
            title: "Duplicate Finder",
            description: "Scan your library for visually identical or exact duplicate images using strict metadata matching.",
            icon: <Copy className="w-12 h-12" />,
            hasScope: true
        },
        untagged: {
            title: "Untagged Images",
            description: "Identify images that are missing prompts or relevant metadata for better organization.",
            icon: <Tag className="w-12 h-12" />,
            hasScope: true
        },
        missing: {
            title: "Missing Files Integrity",
            description: "Verify that all database records point to actual files on your disk. This will scan your entire collection.",
            icon: <Search className="w-12 h-12" />,
            hasScope: false
        }
    };

    const config = metadata[tab];
    if (!config) return null;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-20 px-6 text-center max-w-2xl mx-auto"
        >
            <div className="p-8 bg-sage-500/5 dark:bg-sage-400/5 rounded-full mb-8 border border-sage-500/10 shadow-inner">
                <div className="text-sage-600 dark:text-sage-400">
                    {config.icon}
                </div>
            </div>

            <h2 className="text-3xl font-black text-gray-900 dark:text-white mb-4 tracking-tight">{config.title}</h2>
            <p className="text-gray-500 dark:text-gray-400 mb-10 leading-relaxed text-sm">
                {config.description}
            </p>

            <div className="flex flex-col items-center gap-6 w-full max-w-xs">
                {config.hasScope && (
                    <div className="flex items-center gap-1 p-1.5 bg-gray-100 dark:bg-zinc-800 rounded-2xl w-full border border-gray-200 dark:border-white/5 shadow-sm">
                        <button
                            onClick={() => setScanScope('filtered')}
                            className={`flex-1 px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${scanScope === 'filtered' ? 'bg-white dark:bg-zinc-700 text-sage-600 shadow-md' : 'text-gray-400'}`}
                        >
                            <Filter className="w-3.5 h-3.5" /> Current Filter
                        </button>
                        <button
                            onClick={() => setScanScope('global')}
                            className={`flex-1 px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${scanScope === 'global' ? 'bg-white dark:bg-zinc-700 text-sage-600 shadow-md' : 'text-gray-400'}`}
                        >
                            <Globe className="w-3.5 h-3.5" /> Global
                        </button>
                    </div>
                )}

                <button
                    onClick={() => onStartScan(tab, scanScope)}
                    className="w-full py-4 bg-sage-600 hover:bg-sage-500 text-white rounded-2xl text-sm font-black shadow-xl shadow-sage-500/30 transition-all active:scale-95 flex items-center justify-center gap-3 group"
                >
                    <Play className="w-5 h-5 fill-current group-hover:scale-110 transition-transform" />
                    Start Maintenance Scan
                </button>

                <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">
                    Intentionally triggered scan
                </p>
            </div>
        </motion.div>
    );
};

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
        activeSqlWhere,
        activeSqlParams
    } = useLibraryContext();

    const [activeTab, setActiveTabOriginal] = useState<MaintenanceTab>('missing');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
    const [thumbnailsScope, setThumbnailsScope] = useState<'global' | 'filtered'>('global');
    const [untaggedScope, setUntaggedScope] = useState<'global' | 'filtered'>('global');

    const [viewingImageId, setViewingImageId] = useState<string | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Missing scan state
    const [scanMissingIds, setScanMissingIds] = useState<Set<string>>(new Set());
    const [fetchedMissingImages, setFetchedMissingImages] = useState<AIImage[]>([]);

    const {
        isLoading,
        initializedTabs,
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


    const handleThumbnailsScopeChange = useCallback((scope: 'global' | 'filtered') => {
        setThumbnailsScope(scope);
        refreshData('thumbnails', false, { scope });
    }, [refreshData]);

    const handleUntaggedScopeChange = useCallback((scope: 'global' | 'filtered') => {
        setUntaggedScope(scope);
        refreshData('untagged', false, { scope });
    }, [refreshData]);

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
                            { id: 'thumbnails', label: 'Thumbnails', color: 'text-blue-500' },
                            { id: 'duplicates', label: 'Duplicates', color: 'text-sage-600 dark:text-sage-400' },
                            { id: 'untagged', label: 'Untagged', color: 'text-amber-500' },
                            { id: 'missing', label: 'Missing', color: 'text-orange-500' },
                            { id: 'trash', label: 'Trash', color: 'text-red-500' },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as MaintenanceTab)}
                                className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-black transition-all whitespace-nowrap ${activeTab === tab.id
                                    ? 'bg-white dark:bg-zinc-700 text-sage-600 shadow-md transform scale-105 z-10'
                                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
                                    }`}
                            >
                                <span className={activeTab === tab.id ? tab.color : 'text-current'}>{tab.label}</span>
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

                {(activeTab === 'thumbnails' && initializedTabs.has('thumbnails')) && (
                    <ThumbnailsTab
                        images={localUnoptimizedImages}
                        selectedIds={selectedIds}
                        onItemClick={handleItemClick}
                        onSelectAll={selectAll}
                        onClearSelection={() => setSelectedIds(new Set())}
                        onRegenerate={handleRegenerate}
                        thumbnailsScope={thumbnailsScope}
                        onScopeChange={handleThumbnailsScopeChange}
                        privacyEnabled={privacyEnabled}
                        maskedKeywords={maskedKeywords}
                        scrollContainerRef={scrollContainerRef as any}
                        onRangeSelection={handleRangeSelection}
                        onBackgroundClick={() => {
                            setSelectedIds(new Set());
                            setLastSelectedIndex(null);
                        }}
                    />
                )}

                {(activeTab === 'duplicates' && initializedTabs.has('duplicates')) && (
                    <DuplicateFinder
                        images={localDuplicateCandidates}
                        onResolve={onResolveDuplicate}
                        maskedKeywords={maskedKeywords}
                        privacyEnabled={privacyEnabled}
                        onRefresh={(scope) => refreshData('duplicates', true, { scope })}
                        scrollContainerRef={scrollContainerRef}
                        onRangeSelection={handleRangeSelection}
                        onBackgroundClick={() => {
                            setSelectedIds(new Set());
                            setLastSelectedIndex(null);
                        }}
                    />
                )}

                {(activeTab === 'untagged' && initializedTabs.has('untagged')) && (
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
                        scrollContainerRef={scrollContainerRef as any}
                        onRangeSelection={handleRangeSelection}
                        onBackgroundClick={() => {
                            setSelectedIds(new Set());
                            setLastSelectedIndex(null);
                        }}
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
                            onItemClick={handleItemClick}
                            onSelectAll={selectAll}
                            onClearSelection={() => setSelectedIds(new Set())}
                            onDeleteSelected={handleDeleteSelected}
                            onPurgeMissing={handlePurgeMissing}
                            onViewImage={setViewingImageId}
                            scrollContainerRef={scrollContainerRef as any}
                            onRangeSelection={handleRangeSelection}
                            onBackgroundClick={() => {
                                setSelectedIds(new Set());
                                setLastSelectedIndex(null);
                            }}
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
                        scrollContainerRef={scrollContainerRef as any}
                        onRangeSelection={handleRangeSelection}
                        onBackgroundClick={() => {
                            setSelectedIds(new Set());
                            setLastSelectedIndex(null);
                        }}
                    />
                )}

                {/* Scan Placeholders */}
                {activeTab !== 'trash' && activeTab !== 'missing' && !initializedTabs.has(activeTab) && (
                    <ScanPlaceholder
                        key={activeTab}
                        tab={activeTab}
                        onStartScan={(tab, scope) => refreshData(tab, true, { scope })}
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
