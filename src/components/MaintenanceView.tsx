import * as React from 'react';
import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AIImage } from '../types';
import { DuplicateFinder } from './DuplicateFinder';
import { StackGroup } from './StackGroup';
import { useStacking } from '../hooks/useStacking';
import { Trash2, CheckSquare, XSquare, ArchiveRestore, Eraser, Unlink, FileWarning, Layers, Wand2, Tag, EyeOff, Eye, Loader2 } from 'lucide-react';
import { VirtualGrid } from './VirtualGrid';
import { isImageMasked } from '../utils/maskingUtils';
import { ImageViewer } from './ImageViewer';
import { useLibraryContext } from '../hooks/useLibraryContext';

// --- Sub-Components for Reveal State ---

const TrashItem: React.FC<{
    img: AIImage;
    style: React.CSSProperties;
    isSelected: boolean;
    onClick: (e: React.MouseEvent) => void;
    privacyEnabled: boolean;
    maskedKeywords: string[];
}> = ({ img, style, isSelected, onClick, privacyEnabled, maskedKeywords }) => {
    const [isRevealed, setRevealed] = useState(false);
    const isMasked = !isRevealed && isImageMasked(img, privacyEnabled, maskedKeywords);

    return (
        <div style={style} className="p-1">
            <div
                onClick={onClick}
                className={`h-full w-full rounded-xl overflow-hidden border-2 transition-all cursor-pointer relative ${isSelected ? 'border-sage-500 ring-2 ring-sage-500/30' : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600 bg-gray-100 dark:bg-slate-800'}`}
                onMouseLeave={() => isRevealed && setRevealed(false)}
            >
                <div className="relative w-full h-full">
                    <img
                        src={img.thumbnailUrl}
                        loading="lazy"
                        className={`w-full h-full object-cover transition-all ${isSelected ? 'opacity-100' : 'opacity-70 grayscale'} ${isMasked ? 'blur-xl scale-110' : ''}`}
                        alt=""
                    />

                    {/* Mask Overlay */}
                    {isMasked && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100/50 dark:bg-slate-950/20 backdrop-blur-sm z-10">
                            <EyeOff className="w-8 h-8 text-gray-500 dark:text-gray-400 drop-shadow-md mb-2" />
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setRevealed(true);
                                }}
                                className="px-3 py-1 bg-black/50 hover:bg-black/70 text-white text-[10px] font-bold uppercase tracking-wider rounded-full backdrop-blur-md transition-colors flex items-center gap-1"
                            >
                                <Eye className="w-3 h-3" /> Reveal
                            </button>
                        </div>
                    )}

                    {isSelected && (
                        <div className="absolute top-2 left-2 w-5 h-5 bg-sage-500 rounded-full flex items-center justify-center shadow-md z-20">
                            <CheckSquare className="w-3 h-3 text-white" />
                        </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent text-[10px] text-white truncate z-20">
                        {img.filename}
                    </div>
                </div>
            </div>
        </div>
    );
};

const UntaggedItem: React.FC<{
    img: AIImage;
    style: React.CSSProperties;
    onView: (id: string) => void;
    privacyEnabled: boolean;
    maskedKeywords: string[];
}> = ({ img, style, onView, privacyEnabled, maskedKeywords }) => {
    const [isRevealed, setRevealed] = useState(false);
    const isMasked = !isRevealed && isImageMasked(img, privacyEnabled, maskedKeywords);

    return (
        <div style={style} className="p-1">
            <div
                onClick={() => onView(img.id)}
                className="h-full w-full relative group rounded-xl overflow-hidden border-2 border-transparent hover:border-orange-300 dark:hover:border-orange-500/50 cursor-pointer bg-gray-100 dark:bg-slate-800"
                onMouseLeave={() => isRevealed && setRevealed(false)}
            >
                <div className="relative w-full h-full">
                    <img
                        src={img.thumbnailUrl}
                        className={`w-full h-full object-cover ${isMasked ? 'blur-xl scale-110' : ''}`}
                        alt=""
                    />
                    {isMasked && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100/50 dark:bg-slate-950/20 backdrop-blur-sm z-10">
                            <EyeOff className="w-8 h-8 text-gray-500 dark:text-gray-400 drop-shadow-md mb-2" />
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setRevealed(true);
                                }}
                                className="px-3 py-1 bg-black/50 hover:bg-black/70 text-white text-[10px] font-bold uppercase tracking-wider rounded-full backdrop-blur-md transition-colors flex items-center gap-1"
                            >
                                <Eye className="w-3 h-3" /> Reveal
                            </button>
                        </div>
                    )}

                    {!isMasked && (
                        <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center z-20">
                            <span className="opacity-0 group-hover:opacity-100 bg-black/60 text-white text-[10px] px-2 py-1 rounded backdrop-blur-md font-bold flex items-center gap-1">
                                <Wand2 className="w-3 h-3" /> Recover
                            </span>
                        </div>
                    )}

                    <div className="absolute bottom-0 left-0 right-0 p-2 bg-white dark:bg-slate-900 text-[10px] text-gray-500 truncate border-t border-gray-100 dark:border-white/5 z-20">
                        {img.filename}
                    </div>
                </div>
            </div>
        </div>
    );
};

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
        settings,
        maintenanceCounts,
        refreshMaintenanceCounts,
        activeSqlWhere,
        activeSqlParams
    } = useLibraryContext();
    const [scanMissingIds, setScanMissingIds] = useState<Set<string>>(new Set());
    const [fetchedMissingImages, setFetchedMissingImages] = useState<AIImage[]>([]);
    const [viewingImageId, setViewingImageId] = useState<string | null>(null);

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

    // 1. Memoize basic filters (Fast O(N))
    const [activeTab, setActiveTabOriginal] = useState<'duplicates' | 'trash' | 'missing' | 'untagged' | 'thumbnails'>('missing');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

    // Wrapper to clear selection on tab change
    const setActiveTab = useCallback((tab: 'duplicates' | 'trash' | 'missing' | 'untagged' | 'thumbnails') => {
        setActiveTabOriginal(tab);
        setSelectedIds(new Set());
        setLastSelectedIndex(null);
    }, []);

    const prevTabRef = useRef(activeTab); // Track previous tab to prevent loops

    // --- Local Data State ---
    const [localDeletedImages, setLocalDeletedImages] = useState<AIImage[]>([]);
    const [localUntaggedImages, setLocalUntaggedImages] = useState<AIImage[]>([]);
    const [localUnoptimizedImages, setLocalUnoptimizedImages] = useState<AIImage[]>([]);
    const [localDuplicateCandidates, setLocalDuplicateCandidates] = useState<AIImage[]>([]);

    const [isLoading, setIsLoading] = useState(false);
    const [initializedTabs, setInitializedTabs] = useState<Set<string>>(new Set());

    const activeImages = useMemo(() => images.filter(img => !img.isDeleted), [images]);

    // --- Data Fetchers ---
    const refreshData = useCallback(async (tab: string, showLoader: boolean = true, options: { scope?: 'global' | 'filtered' } = {}) => {
        if (showLoader) setIsLoading(true);
        try {
            const db = await import('../services/db');

            // Always refresh counts in background
            refreshMaintenanceCounts();

            if (tab === 'trash') {
                const data = await db.getDeletedImages();
                setLocalDeletedImages(data);
            } else if (tab === 'untagged') {
                const data = await db.getUntaggedImages();
                setLocalUntaggedImages(data);
            } else if (tab === 'thumbnails') {
                const data = await db.getUnoptimizedImages();
                setLocalUnoptimizedImages(data);
            } else if (tab === 'duplicates') {
                // Fetch potential duplicates
                // If scope is 'filtered', we use the context's SQL
                const where = options.scope === 'filtered' ? activeSqlWhere : '';
                const params = options.scope === 'filtered' ? activeSqlParams : [];

                const data = await db.getDuplicateCandidates(where, params);
                setLocalDuplicateCandidates(data);
            }

            setInitializedTabs(prev => new Set(prev).add(tab));
        } catch (e) {
            console.error("Failed to refresh maintenance data", e);
        } finally {
            if (showLoader) setIsLoading(false);
        }
    }, [refreshMaintenanceCounts, activeSqlWhere, activeSqlParams]);

    // Initial load of counts
    useEffect(() => {
        refreshMaintenanceCounts();
    }, [refreshMaintenanceCounts]);

    // Tab switch trigger

    useEffect(() => {
        // Only trigger if tab actually changed (or first run) to prevent loops
        // since refreshData updates state which might re-trigger if dependencies were loose
        // But mainly we want to avoid re-fetching just because 'maintenanceCounts' updated.

        // We allow re-fetching if activeTab changed OR if it's the first mount (prevTabRef init matches but we want 1st run).
        // Actually simplest is just to run logic, but guard against maintenanceCounts updates triggering it.
        // We do that by NOT having maintenanceCounts in the dependency array for the TRIGGER,
        // but we need it for the loader logic.

        // BETTER APPROACH: Check if we need to fetch.

        // Accessing current state via refs or ensuring `refreshData` is stable.
        // For `initializedTabs`, `maintenanceCounts`, `localDeletedImages`, etc.,
        // if they are not in the dependency array, the effect will close over their initial values.
        // To get the *latest* values without adding them to dependencies, one would typically use `useRef`
        // to store the latest state, or ensure the functions (`refreshData`) themselves
        // use functional updates or `useRef` internally.

        // Given the explicit instruction to remove dependencies, we proceed with that.
        // This implies that `refreshData` (which is a useCallback) is expected to be stable
        // enough, and the state values (`initializedTabs`, `maintenanceCounts`, etc.)
        // are either stable enough for the loader calculation or their staleness is accepted.

        const isInitialized = initializedTabs.has(activeTab);
        const count = activeTab === 'thumbnails' ? maintenanceCounts.unoptimized :
            activeTab === 'untagged' ? maintenanceCounts.untagged :
                activeTab === 'trash' ? maintenanceCounts.trash :
                    activeTab === 'missing' ? maintenanceCounts.missing : -1;

        const hasLocalData = (activeTab === 'trash' && localDeletedImages.length > 0) ||
            (activeTab === 'untagged' && localUntaggedImages.length > 0) ||
            (activeTab === 'thumbnails' && localUnoptimizedImages.length > 0) ||
            (activeTab === 'duplicates' && localDuplicateCandidates.length > 0) ||
            (activeTab === 'missing');

        const shouldShowLoader = !hasLocalData && !isInitialized && count !== 0;

        // Execute fetch
        refreshData(activeTab, shouldShowLoader);

    }, [activeTab]); // <--- CRITICAL: Only run when activeTab changes.
    // We removed 'refreshData', 'maintenanceCounts', 'initializedTabs' etc from deps to BREAK THE LOOP.
    // This is safe because 'activeTab' is the only "event" we care about.
    // The values used inside (maintenanceCounts, etc.) will be stale closure?
    // Yes, potentially.
    // BUT 'refreshData' is stable (useCallback with empty deps? No, it has deps).

    // To do this correctly with hooks we should use a Ref for the "Latest Props"
    // OR just use the ref strategy for the Trigger.

    /*
       Ref Strategy Implementation:
       We want to run this effect whenever `activeTab` changes.
       We DO NOT want to run it when `maintenanceCounts` changes.
    */

    // Active Images for Duplicates (still uses prop for now as it's complex, or we can fetch all)
    // For now, Duplicates tab still relies on loaded images OR we can fetch all Active images?
    // User requested "Whole Data", so DuplicateFinder needs 'activeImages'.
    // Passing pagination-limited 'images' to DuplicateFinder is still the bottleneck there.
    // However, fixing DuplicateFinder is a larger task (logic is inside it). 
    // For now, we fix Trash/Untagged/Thumbnails as promised.

    const missingImages = useMemo(() => {
        const pool = [...localDeletedImages, ...activeImages, ...fetchedMissingImages]; // Use localDeleted to help find missing? No.
        // Actually missing logic is separate.
        // We rely on 'fetchedMissingImages' from the scan mainly.
        // But let's keep the existing logic:
        const uniquePool = Array.from(new Map([...images, ...fetchedMissingImages].map(item => [item.id, item])).values());
        if (scanMissingIds.size > 0) {
            return uniquePool.filter(img => scanMissingIds.has(img.id) && !img.isDeleted);
        }
        return uniquePool.filter(img => img.isMissing && !img.isDeleted);
    }, [images, fetchedMissingImages, scanMissingIds, localDeletedImages, activeImages]);

    // Safe accessor for viewer image - Defined AFTER missingImages
    // Safe accessor for viewer image - Dynamic based on active tab
    // This ensures we always show the image from the locally fetched list without relying on global state.
    const targetImage = useMemo(() => {
        if (!viewingImageId) return null;

        // Search in all local lists order by likelihood
        const allPool = [
            ...missingImages,
            ...localUntaggedImages,
            ...localDeletedImages,
            ...localUnoptimizedImages,
            ...localDuplicateCandidates
            // Active images if needed?
        ];
        return allPool.find(i => i.id === viewingImageId) || null;
    }, [viewingImageId, missingImages, localUntaggedImages, localDeletedImages, localUnoptimizedImages, localDuplicateCandidates]);

    // 3. Removed Lazy Stacking Calculation
    // const shouldCalculateStacks = activeTab === 'stacks';
    // const emptyImages = useMemo<AIImage[]>(() => [], []);
    // const { suggestedStacks } = useStacking(shouldCalculateStacks ? activeImages : emptyImages);

    // --- Improved Selection Logic ---

    // Toggle single item
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

    // Handle range selection (Drag Box or Shift+Click)
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

    // Shift+Click handler for individual items
    const handleItemClick = useCallback((id: string, index: number, e: React.MouseEvent) => {
        if (e.shiftKey && lastSelectedIndex !== null) {
            // Range selection
            const start = Math.min(lastSelectedIndex, index);
            const end = Math.max(lastSelectedIndex, index);
            const rangeIndexes = Array.from({ length: end - start + 1 }, (_, i) => start + i);
            handleRangeSelection(rangeIndexes, true);
        } else {
            // Normal toggle
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

        if (activeTab === 'untagged') {
            await onMoveToTrash(ids);
        } else if (activeTab === 'missing') {
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
        await refreshData('thumbnails', false);
    };

    const handleGroupConfirm = (baseId: string, relatedIds: string[]) => {
        if (onGroupImages) {
            onGroupImages([baseId, ...relatedIds]);
        }
    };

    // VirtualGrid ref
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // --- VirtualGrid Renderers ---
    // Memoized individually to ensure stability for the VirtualGrid engine

    const renderTrashItem = useCallback((img: AIImage, style: React.CSSProperties, index: number) => {
        return (
            <TrashItem
                key={img.id}
                img={img}
                style={style}
                isSelected={selectedIds.has(img.id)}
                onClick={(e) => handleItemClick(img.id, index, e)}
                privacyEnabled={privacyEnabled}
                maskedKeywords={maskedKeywords}
            />
        );
    }, [selectedIds, handleItemClick, privacyEnabled, maskedKeywords]);

    const renderUntaggedItem = useCallback((img: AIImage, style: React.CSSProperties, index: number) => {
        const isSelected = selectedIds.has(img.id);
        return (
            <div
                style={style}
                className="p-1"
                onClick={(e) => handleItemClick(img.id, index, e)}
            >
                <div className={`h-full w-full relative group rounded-xl overflow-hidden border-2 transition-all cursor-pointer bg-gray-100 dark:bg-slate-800 ${isSelected ? 'border-sage-500 ring-2 ring-sage-500/30 shadow-lg shadow-sage-500/10' : 'border-transparent hover:border-orange-300 dark:hover:border-orange-500/50'}`}>
                    <UntaggedItem
                        img={img}
                        style={{ width: '100%', height: '100%' }}
                        onView={setViewingImageId}
                        privacyEnabled={privacyEnabled}
                        maskedKeywords={maskedKeywords}
                    />

                    {/* Overlay Actions */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setViewingImageId(img.id);
                            }}
                            className="px-4 py-2 bg-white/90 dark:bg-zinc-900/90 text-gray-900 dark:text-white rounded-full text-xs font-bold shadow-xl transform scale-90 group-hover:scale-100 transition-all flex items-center gap-2 hover:bg-white dark:hover:bg-zinc-800"
                        >
                            <Eye className="w-4 h-4" /> View Image
                        </button>
                    </div>

                    {isSelected && (
                        <div className="absolute top-2 left-2 w-6 h-6 bg-sage-500 rounded-full flex items-center justify-center shadow-md z-30">
                            <CheckSquare className="w-3.5 h-3.5 text-white" />
                        </div>
                    )}
                </div>
            </div>
        );
    }, [selectedIds, handleItemClick, privacyEnabled, maskedKeywords]);

    const renderMissingItem = useCallback((img: AIImage, style: React.CSSProperties, index: number) => {
        const isSelected = selectedIds.has(img.id);
        return (
            <div
                key={img.id}
                style={style}
                className="p-2"
                onClick={(e) => handleItemClick(img.id, index, e)}
            >
                <div
                    className={`h-full w-full flex flex-col bg-white dark:bg-slate-900 border transition-all rounded-xl shadow-sm relative group hover:shadow-md cursor-pointer overflow-hidden ${isSelected ? 'border-sage-500 ring-2 ring-sage-500/30' : 'border-red-200 dark:border-red-900/30'}`}
                >
                    <div className="relative flex-1 bg-gray-100 dark:bg-black/50 overflow-hidden">
                        {img.thumbnailUrl ? (
                            <img
                                src={img.thumbnailUrl}
                                loading="lazy"
                                className={`w-full h-full object-cover opacity-60 grayscale group-hover:grayscale-0 transition-all duration-500 ${isSelected ? 'grayscale-0 opacity-100' : ''}`}
                                alt={img.filename}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                <FileWarning className="w-8 h-8 text-gray-400 opacity-50" />
                            </div>
                        )}
                        {isSelected && (
                            <div className="absolute top-2 left-2 w-5 h-5 bg-sage-500 rounded-full flex items-center justify-center shadow-md z-30">
                                <CheckSquare className="w-3 h-3 text-white" />
                            </div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 backdrop-blur-[2px]">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setViewingImageId(img.id);
                                }}
                                className="px-3 py-1.5 bg-black/70 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg flex items-center gap-2 transform scale-90 group-hover:scale-100 transition-transform"
                            >
                                <Eye className="w-3 h-3" /> Inspect Metadata
                            </button>
                        </div>
                    </div>

                    <div className="p-3 border-t border-red-100 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10">
                        <div className="flex items-start gap-2">
                            <FileWarning className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                                <div className="text-xs font-bold text-gray-700 dark:text-gray-300 truncate" title={img.filename}>{img.filename}</div>
                                <div className="text-[10px] text-red-500 font-medium">Source File Missing</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }, [selectedIds, handleItemClick, onViewImage]);


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
                        <button onClick={() => setActiveTab('thumbnails')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all duration-200 flex items-center gap-2 whitespace-nowrap ${activeTab === 'thumbnails' ? 'bg-white dark:bg-zinc-700 text-blue-500 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}>
                            Thumbnails
                            <AnimatePresence>
                                {maintenanceCounts.unoptimized > 0 && (
                                    <motion.span
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.8 }}
                                        className={`px-1.5 py-0.5 rounded-md text-[10px] ${activeTab === 'thumbnails' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'bg-gray-200 dark:bg-zinc-900 text-gray-500'}`}
                                    >
                                        {maintenanceCounts.unoptimized}
                                    </motion.span>
                                )}
                            </AnimatePresence>
                        </button>

                        <button onClick={() => setActiveTab('duplicates')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all duration-200 whitespace-nowrap ${activeTab === 'duplicates' ? 'bg-white dark:bg-zinc-700 text-sage-600 dark:text-sage-400 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}>
                            Duplicates
                        </button>

                        <button onClick={() => setActiveTab('untagged')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all duration-200 flex items-center gap-2 whitespace-nowrap ${activeTab === 'untagged' ? 'bg-white dark:bg-zinc-700 text-orange-500 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}>
                            Untagged
                            <AnimatePresence>
                                {maintenanceCounts.untagged > 0 && (
                                    <motion.span
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.8 }}
                                        className={`px-1.5 py-0.5 rounded-md text-[10px] ${activeTab === 'untagged' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600' : 'bg-gray-200 dark:bg-zinc-900 text-gray-500'}`}
                                    >
                                        {maintenanceCounts.untagged}
                                    </motion.span>
                                )}
                            </AnimatePresence>
                        </button>

                        <button onClick={() => setActiveTab('missing')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all duration-200 flex items-center gap-2 whitespace-nowrap ${activeTab === 'missing' ? 'bg-white dark:bg-zinc-700 text-red-500 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}>
                            Missing
                            <AnimatePresence>
                                {maintenanceCounts.missing > 0 && (
                                    <motion.span
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.8 }}
                                        className={`px-1.5 py-0.5 rounded-md text-[10px] ${activeTab === 'missing' ? 'bg-red-100 dark:bg-red-900/30 text-red-600' : 'bg-gray-200 dark:bg-zinc-900 text-gray-500'}`}
                                    >
                                        {maintenanceCounts.missing}
                                    </motion.span>
                                )}
                            </AnimatePresence>
                        </button>

                        <button onClick={() => setActiveTab('trash')} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all duration-200 flex items-center gap-2 whitespace-nowrap ${activeTab === 'trash' ? 'bg-white dark:bg-zinc-700 text-sage-600 dark:text-sage-400 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}>
                            Trash
                            <AnimatePresence>
                                {maintenanceCounts.trash > 0 && (
                                    <motion.span
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.8 }}
                                        className={`px-1.5 py-0.5 rounded-md text-[10px] ${activeTab === 'trash' ? 'bg-sage-100 dark:bg-sage-900/30 text-sage-600' : 'bg-gray-200 dark:bg-zinc-900 text-gray-500'}`}
                                    >
                                        {maintenanceCounts.trash}
                                    </motion.span>
                                )}
                            </AnimatePresence>
                        </button>
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative custom-scrollbar px-6 pb-8" style={{ scrollbarGutter: 'stable' }}>
                <AnimatePresence>
                    {isLoading && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 z-50 flex items-center justify-center bg-white/60 dark:bg-zinc-950/60 backdrop-blur-sm pointer-events-none"
                        >
                            <div className="flex flex-col items-center gap-4">
                                <div className="relative">
                                    <div className="absolute inset-0 bg-sage-500/20 blur-xl rounded-full animate-pulse" />
                                    <Loader2 className="w-10 h-10 text-sage-600 dark:text-sage-400 animate-spin relative z-10" />
                                </div>
                                <p className="text-sm font-bold text-gray-500 dark:text-gray-400 animate-pulse uppercase tracking-widest">
                                    Loading Tab Data...
                                </p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>


                {activeTab === 'thumbnails' && (
                    <div className="w-full pb-24 h-full flex flex-col">
                        <div className="flex-shrink-0 mb-6 bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-white/5 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                    <Layers className="w-5 h-5 text-blue-500" /> Optimize Thumbnails
                                </h3>
                                {maintenanceCounts.unoptimized > 0 && (
                                    <div className="flex items-center gap-2">
                                        <button onClick={selectAll} className="text-xs font-bold text-gray-500 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                                            <CheckSquare className="w-4 h-4" /> Select All
                                        </button>
                                        {selectedIds.size > 0 && (
                                            <button onClick={() => setSelectedIds(new Set())} className="text-xs font-bold text-gray-500 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                                                <XSquare className="w-4 h-4" /> Clear
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                            <p className="text-sm text-gray-500 mt-1 max-w-2xl">
                                Found {maintenanceCounts.unoptimized} images using full-resolution files as thumbnails.
                                Regenerating them will significantly improve gallery scroll smoothness.
                            </p>
                            {maintenanceCounts.unoptimized > 0 ? (
                                <div className="flex items-center gap-3 mt-4">
                                    {selectedIds.size > 0 ? (
                                        <button onClick={() => handleRegenerate(Array.from(selectedIds))} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-500/20 flex items-center gap-2 transition-all hover:scale-105 whitespace-nowrap">
                                            <Wand2 className="w-4 h-4" /> Regenerate Selected ({selectedIds.size})
                                        </button>
                                    ) : (
                                        onRegenerateThumbnails && (
                                            <button onClick={() => handleRegenerate()} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-500/20 flex items-center gap-2 transition-all hover:scale-105 whitespace-nowrap">
                                                <Wand2 className="w-4 h-4" /> Generate All Thumbnails
                                            </button>
                                        )
                                    )}
                                </div>
                            ) : (
                                <div className="mt-4 flex items-center gap-2 text-green-600 dark:text-green-400 font-medium text-sm">
                                    <CheckSquare className="w-4 h-4" /> All thumbnails optimized
                                </div>
                            )}
                        </div>
                        {localUnoptimizedImages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                                <p>All items optimized!</p>
                            </div>
                        ) : (
                            <div className="flex-1 min-h-[500px]">
                                <VirtualGrid
                                    items={localUnoptimizedImages}
                                    layout="masonry"
                                    minItemWidth={200}
                                    gap={16}
                                    padding={0}
                                    scrollContainerRef={scrollContainerRef}
                                    renderItem={renderUntaggedItem} // Reuse simple renderer
                                    getItemRatio={(img) => img.width / img.height}
                                    onRangeSelection={handleRangeSelection}
                                    onBackgroundClick={() => setSelectedIds(new Set())}
                                />
                            </div>
                        )}
                    </div>
                )}



                {/* Stacks removed (hidden) */}
                {/* 
                {activeTab === 'stacks' && ( ... )} 
                */}

                {activeTab === 'duplicates' && (
                    <DuplicateFinder
                        images={localDuplicateCandidates}
                        onResolve={async (keepId, deleteIds) => {
                            await onResolveDuplicate(keepId, deleteIds);
                            // Refresh local candidates after resolution (keeping same scope)
                            await refreshData('duplicates', false);
                        }}
                        maskedKeywords={maskedKeywords}
                        privacyEnabled={privacyEnabled}
                        onRefresh={(scope) => refreshData('duplicates', true, { scope })}
                        scrollContainerRef={scrollContainerRef}
                    />
                )}

                {activeTab === 'untagged' && (
                    <div className="w-full pb-24 h-full flex flex-col">
                        <div className="flex-shrink-0 mb-6 bg-white dark:bg-slate-900 p-6 rounded-xl border border-gray-200 dark:border-white/5 shadow-sm">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                    <Tag className="w-5 h-5 text-orange-500" /> Untagged Images
                                </h3>
                                <div className="flex items-center gap-2">
                                    <button onClick={selectAll} className="text-xs font-bold text-gray-500 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                                        <CheckSquare className="w-4 h-4" /> Select All
                                    </button>
                                    {selectedIds.size > 0 && (
                                        <button onClick={() => setSelectedIds(new Set())} className="text-xs font-bold text-gray-500 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                                            <XSquare className="w-4 h-4" /> Clear
                                        </button>
                                    )}
                                </div>
                            </div>
                            <p className="text-xs text-gray-500 mt-1 max-w-2xl">
                                These images have no generation metadata. They are likely imported manually or from sources without embedded data.
                            </p>
                            {selectedIds.size > 0 && (
                                <div className="flex items-center gap-3 mt-4">
                                    <button onClick={handleDeleteSelected} className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-bold shadow flex items-center gap-2 transition-colors">
                                        <Trash2 className="w-4 h-4" /> Move Selected to Trash ({selectedIds.size})
                                    </button>
                                    <span className="text-[10px] text-gray-400 italic">This will NOT delete the original files.</span>
                                </div>
                            )}
                        </div>
                        {localUntaggedImages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                                <p>All Metadata Present!</p>
                            </div>
                        ) : (
                            <div className="flex-1 min-h-[500px]">
                                <VirtualGrid
                                    items={localUntaggedImages}
                                    layout="masonry"
                                    minItemWidth={200}
                                    gap={16}
                                    padding={0}
                                    scrollContainerRef={scrollContainerRef}
                                    renderItem={renderUntaggedItem}
                                    getItemRatio={(img) => img.width / img.height}
                                    onRangeSelection={handleRangeSelection}
                                    onBackgroundClick={() => setSelectedIds(new Set())}
                                />
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'missing' && (
                    <div className="w-full pb-24 h-full flex flex-col">
                        <div className="flex-shrink-0 flex flex-col gap-6 mb-6">
                            {/* Proactive Health Scan */}
                            <React.Suspense fallback={<div className="h-32 bg-gray-100 dark:bg-white/5 rounded-2xl animate-pulse" />}>
                                <LibraryHealth mode="detailed" onScanComplete={handleScanComplete} />
                            </React.Suspense>

                            {/* Bulk Actions for Missing */}
                            {missingImages.length > 0 && (
                                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-gray-200 dark:border-white/5 shadow-sm flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <button onClick={selectAll} className="text-xs font-bold text-gray-500 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                                            <CheckSquare className="w-4 h-4" /> Select All
                                        </button>
                                        {selectedIds.size > 0 && (
                                            <button onClick={() => setSelectedIds(new Set())} className="text-xs font-bold text-gray-500 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                                                <XSquare className="w-4 h-4" /> Clear
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {selectedIds.size > 0 ? (
                                            <>
                                                <span className="text-xs font-medium text-orange-600 dark:text-orange-400 mr-2">{selectedIds.size} selected</span>
                                                <button onClick={handleDeleteSelected} className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-bold shadow flex items-center gap-2 transition-colors">
                                                    <Trash2 className="w-4 h-4" /> Move to Trash
                                                </button>
                                            </>
                                        ) : (
                                            <button onClick={handlePurgeMissing} className="px-4 py-2 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-300 border border-orange-200 dark:border-orange-800 rounded-lg text-xs font-bold shadow-sm flex items-center gap-2 transition-colors hover:bg-orange-200 dark:hover:bg-orange-900/50">
                                                <Trash2 className="w-4 h-4" /> Move Missing to Trash
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                            <p className="text-[10px] text-gray-500 italic px-4 -mt-4">
                                Missing items moved to trash can be permanently deleted from there. Original files are not affected.
                            </p>
                        </div>

                        {missingImages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                                <p>No missing files detected in current view.</p>
                            </div>
                        ) : (
                            <div className="flex-1 min-h-[500px]">
                                <VirtualGrid
                                    items={missingImages}
                                    layout="grid"
                                    minItemWidth={250}
                                    gap={16}
                                    padding={0}
                                    scrollContainerRef={scrollContainerRef}
                                    renderItem={renderMissingItem}
                                    getItemRatio={() => 0.5}
                                    onRangeSelection={handleRangeSelection}
                                    onBackgroundClick={() => setSelectedIds(new Set())}
                                />
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'trash' && (
                    <div className="w-full pb-24 h-full flex flex-col">
                        <div className="flex-shrink-0 flex items-center justify-between mb-6 bg-white dark:bg-slate-900 p-4 rounded-xl border border-gray-200 dark:border-white/5 shadow-sm">
                            <div className="flex items-center gap-3">
                                <button onClick={selectAll} className="text-xs font-bold text-gray-500 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                                    <CheckSquare className="w-4 h-4" /> Select All
                                </button>
                                {selectedIds.size > 0 && (
                                    <button onClick={() => setSelectedIds(new Set())} className="text-xs font-bold text-gray-500 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                                        <XSquare className="w-4 h-4" /> Clear
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                {selectedIds.size > 0 ? (
                                    <>
                                        <span className="text-xs font-medium text-sage-600 dark:text-sage-400 mr-2">{selectedIds.size} selected</span>
                                        <button onClick={handleRestoreSelected} className="px-4 py-2 bg-sage-600 hover:bg-sage-500 text-white rounded-lg text-xs font-bold shadow flex items-center gap-2 transition-colors">
                                            <ArchiveRestore className="w-4 h-4" /> Restore
                                        </button>
                                        <button onClick={handleDeleteSelected} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold shadow flex items-center gap-2 transition-colors" title="This will only ever remove the image from Ambit, not from your disk.">
                                            <Trash2 className="w-4 h-4" /> Remove from Library
                                        </button>
                                    </>
                                ) : (
                                    localDeletedImages.length > 0 && (
                                        <button onClick={async () => { await onEmptyTrash(); await refreshData('trash', false); }} className="px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-lg text-xs font-bold shadow-sm flex items-center gap-2 transition-colors hover:bg-red-200 dark:hover:bg-red-900/50" title="Clear your library trash bin. Files remain on disk.">
                                            <Trash2 className="w-4 h-4" /> Clear All Trash
                                        </button>
                                    )
                                )}
                            </div>
                        </div>

                        {localDeletedImages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                                <Trash2 className="w-10 h-10 opacity-30 mb-4" />
                                <p>Trash is empty.</p>
                            </div>
                        ) : (
                            <div className="flex-1 min-h-[500px]">
                                <VirtualGrid
                                    items={localDeletedImages}
                                    layout="masonry"
                                    minItemWidth={180}
                                    gap={16}
                                    padding={0}
                                    scrollContainerRef={scrollContainerRef}
                                    renderItem={renderTrashItem}
                                    getItemRatio={(img) => img.width / img.height}
                                    onRangeSelection={handleRangeSelection}
                                    onBackgroundClick={() => setSelectedIds(new Set())}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Local ImageViewer via Portal */}
            {
                createPortal(
                    <AnimatePresence>
                        {targetImage && (
                            <ImageViewer
                                image={targetImage}
                                isOpen={true}
                                onClose={() => setViewingImageId(null)}
                                onNext={() => {
                                    // Determine current list based on active tab
                                    let list: AIImage[] = [];
                                    if (activeTab === 'missing') list = missingImages;
                                    else if (activeTab === 'untagged') list = localUntaggedImages;
                                    else if (activeTab === 'thumbnails') list = localUnoptimizedImages;
                                    else if (activeTab === 'trash') list = localDeletedImages;

                                    const idx = list.findIndex(i => i.id === viewingImageId);
                                    if (idx !== -1 && idx < list.length - 1) setViewingImageId(list[idx + 1].id);
                                }}
                                onPrev={() => {
                                    let list: AIImage[] = [];
                                    if (activeTab === 'missing') list = missingImages;
                                    else if (activeTab === 'untagged') list = localUntaggedImages;
                                    else if (activeTab === 'thumbnails') list = localUnoptimizedImages;
                                    else if (activeTab === 'trash') list = localDeletedImages;

                                    const idx = list.findIndex(i => i.id === viewingImageId);
                                    if (idx > 0) setViewingImageId(list[idx - 1].id);
                                }}
                                onAddToCollection={() => { }}
                                onSearch={() => { }} // No-op
                                onToggleFavorite={() => { }}
                                onOpenSettings={() => { }}
                                // Actions for Maintenance
                                onDelete={() => {
                                    if (viewingImageId) {
                                        onDeleteForever([viewingImageId]);
                                        setViewingImageId(null);
                                        refreshData(activeTab); // Immediately refresh list
                                    }
                                }}
                            />
                        )}
                    </AnimatePresence>,
                    document.body
                )
            }
        </div >
    );
};
