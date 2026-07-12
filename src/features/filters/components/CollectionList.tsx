import * as React from 'react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Archive, ArrowUpDown, Search, Pin, Check, LayoutGrid, List as ListIcon, Calendar, Clock, ArrowDownWideNarrow, ArrowUpWideNarrow, SortDesc, SortAsc } from 'lucide-react';
import type { Collection, CollectionSortOption, FilterState } from '../../../types';
import { SearchInput, SortDropdown } from './FilterPrimitives';
import { CollectionContextMenu } from '../../collections/components/CollectionContextMenu';
import { CollectionItem } from './CollectionItem';
import { useSettings } from '../../../contexts/SettingsContext';
import { useCollectionStore } from '../../../stores/collectionStore';

interface CollectionListProps<T extends Collection> {
    collections: T[];
    filters: FilterState;
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    onDeleteCollection: (id: string) => void;
    onRenameCollection?: (colId: string, newName: string) => void;
    onDropOnCollection?: (collectionId: string, data: string) => void;
    onToggleArchiveCollection?: (colId: string) => void;
    onTogglePinCollection?: (colId: string) => void;
    onSetCollectionColor?: (colId: string, color: string | undefined) => void;
    onPlayCollection?: (colId: string) => void;
    onExportCollection?: (colId: string) => void;
    onResetCollectionThumbnail?: (colId: string) => void;
    onEditCollection?: (colId: string) => void;
    renderToolbarExtras?: () => React.ReactNode;
    renderCreationForm?: () => React.ReactNode;
    emptyMessage?: React.ReactNode;
}

const collectionSortIds: CollectionSortOption[] = [
    'name_asc',
    'name_desc',
    'count_asc',
    'count_desc',
    'date_asc',
    'date_desc',
    'recent_desc',
    'recent_asc'
];

const isCollectionSort = (id: unknown): id is CollectionSortOption => (
    typeof id === 'string' && collectionSortIds.includes(id as CollectionSortOption)
);

export function CollectionList<T extends Collection>({
    collections,
    filters,
    setFilters,
    onDeleteCollection,
    onRenameCollection,
    onDropOnCollection,
    onToggleArchiveCollection,
    onTogglePinCollection,
    onSetCollectionColor,
    onPlayCollection,
    onExportCollection,
    onResetCollectionThumbnail,
    onEditCollection,
    renderToolbarExtras,
    renderCreationForm,
    emptyMessage = "No collections found."
}: CollectionListProps<T>) {
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showArchived, setShowArchived] = useState(false);
    const { settings, setSettings } = useSettings();
    const refreshSmartCounts = useCollectionStore(s => s.refreshSmartCounts);
    const thumbnailHydrationPendingIds = useCollectionStore(s => s.thumbnailHydrationPendingIds);
    const smartSummaryPendingIds = useCollectionStore(s => s.smartSummaryPendingIds);
    const persistedSort = settings.resourceSortOptions?.collections;
    const sort: CollectionSortOption = isCollectionSort(persistedSort) ? persistedSort : 'recent_desc';

    const setSort = (newSort: CollectionSortOption) => {
        setSettings(prev => ({
            ...prev,
            resourceSortOptions: {
                ...(prev.resourceSortOptions || {}),
                collections: newSort
            }
        }));
    };
    const handleSortSelect = (id: string) => {
        setSort(id as CollectionSortOption);
    };
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);

    const viewMode = settings.resourceViewModes?.['collections'] || 'list';

    // Pagination State
    const [renderLimit, setRenderLimit] = useState(60);

    // Reset pagination when search changes
    React.useEffect(() => {
        setRenderLimit(60);
    }, [searchQuery, showArchived]);

    React.useEffect(() => {
        if (showArchived) {
            void refreshSmartCounts({ includeArchived: true, markPending: true });
        }
    }, [showArchived, refreshSmartCounts]);

    const lastSelectedSmartRefresh = React.useRef<string | null>(null);
    React.useEffect(() => {
        const selectedSmartCollection = collections.find(collection =>
            collection.id === filters.collectionId && !!collection.filters
        );
        if (!selectedSmartCollection || lastSelectedSmartRefresh.current === selectedSmartCollection.id) return;

        lastSelectedSmartRefresh.current = selectedSmartCollection.id;
        void refreshSmartCounts({
            collectionIds: [selectedSmartCollection.id],
            includeArchived: true,
            includePromptSearch: true,
            markPending: true
        });
    }, [collections, filters.collectionId, refreshSmartCounts]);

    const toggleViewMode = (e: React.MouseEvent) => {
        e.stopPropagation();
        setSettings(prev => ({
            ...prev,
            resourceViewModes: {
                ...(prev.resourceViewModes || {}),
                collections: viewMode === 'list' ? 'grid' : 'list'
            }
        }));
    };

    // Renaming state
    const [editingColId, setEditingColId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

    // Context Menu state
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, collectionId: string } | null>(null);

    const handleRenameSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (editingColId && editName.trim() && onRenameCollection) {
            onRenameCollection(editingColId, editName);
            setEditingColId(null);
            setEditName('');
        }
    };

    // Drag & Drop Handlers
    const handleDragEnter = (e: React.DragEvent, colId: string) => {
        e.preventDefault(); e.stopPropagation();
        setDropTargetId(colId);
    };
    const handleDragOver = (e: React.DragEvent, colId: string) => {
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy'; // Visual feedback
        setDropTargetId(colId);

        // Diagnostic log
        if (Math.random() < 0.1) {
            console.log('[CollectionList] handleDragOver on:', colId, 'Types:', Array.from(e.dataTransfer.types));
        }
    };
    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDropTargetId(null);
    };
    const handleDrop = (e: React.DragEvent, colId: string) => {
        e.preventDefault(); e.stopPropagation();
        setDropTargetId(null);
        console.log('[CollectionList] Drop event on:', colId);
        const data = e.dataTransfer.getData('application/x-ambit-image-ids') || e.dataTransfer.getData('text/plain');
        if (data && onDropOnCollection) {
            console.log('[CollectionList] Dropped data:', data);
            onDropOnCollection(colId, data);
        }
    };

    const handleContextMenu = (e: React.MouseEvent, colId: string) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, collectionId: colId });
    };

    const filtered = collections
        .filter(c => {
            const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesArchive = showArchived ? true : !c.isArchived;
            return matchesSearch && matchesArchive;
        })
        .sort((a, b) => {
            switch (sort) {
                case 'name_asc': return a.name.localeCompare(b.name);
                case 'name_desc': return b.name.localeCompare(a.name);
                case 'count_asc': return (a.count ?? a.imageIds.length) - (b.count ?? b.imageIds.length);
                case 'count_desc': return (b.count ?? b.imageIds.length) - (a.count ?? a.imageIds.length);
                case 'date_asc': return a.createdAt - b.createdAt;
                case 'date_desc': return b.createdAt - a.createdAt;
                case 'recent_asc': return (a.updatedAt || a.createdAt) - (b.updatedAt || b.createdAt);
                case 'recent_desc': default: return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
            }
        });

    const pinned = filtered.filter(c => c.isPinned);
    const others = filtered.filter(c => !c.isPinned);

    const visibleOthers = others.slice(0, renderLimit);
    const hasMore = others.length > renderLimit;

    const activeCol = collections.find(c => c.id === contextMenu?.collectionId);

    return (
        <div className="space-y-1 animate-in slide-in-from-top-2 duration-300 ease-spring">
            <div className="flex items-center gap-1.5 px-2 pb-2">
                <SortDropdown
                    title="Sort Collections"
                    options={[
                        { id: 'recent_desc', label: 'Recently Used', icon: Clock },
                        { id: 'recent_asc', label: 'Least Recently Used', icon: Clock },
                        { id: 'date_desc', label: 'Newest Created', icon: Calendar },
                        { id: 'date_asc', label: 'Oldest Created', icon: Calendar },
                        { id: 'name_asc', label: 'Name (A-Z)', icon: ArrowUpWideNarrow },
                        { id: 'name_desc', label: 'Name (Z-A)', icon: ArrowDownWideNarrow },
                        { id: 'count_desc', label: 'Most Images', icon: SortDesc },
                        { id: 'count_asc', label: 'Fewest Images', icon: SortAsc },
                    ]}
                    currentValue={sort}
                    onSelect={handleSortSelect}
                    align="left"
                    triggerClassName={(isOpen) => `transition-colors p-1.5 rounded-lg border ${isOpen ? 'text-sage-600 dark:text-sage-400 bg-sage-50 dark:bg-sage-900/40 border-sage-200 dark:border-sage-500/30' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/5'}`}
                />
                <button
                    onClick={toggleViewMode}
                    className={`transition-colors p-1.5 rounded-lg border ${viewMode === 'grid' ? 'text-sage-600 dark:text-sage-400 bg-sage-50 dark:bg-sage-900/40 border-sage-200 dark:border-sage-500/30' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/5'}`}
                    title={viewMode === 'list' ? "Switch to Grid View" : "Switch to List View"}
                >
                    {viewMode === 'list' ? <LayoutGrid className="w-3.5 h-3.5" /> : <ListIcon className="w-3.5 h-3.5" />}
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); setShowArchived(!showArchived); }}
                    className={`transition-colors p-1.5 rounded-lg border ${showArchived ? 'text-sage-600 dark:text-sage-400 bg-sage-50 dark:bg-sage-900/40 border-sage-200 dark:border-sage-500/30' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/5'}`}
                    title={showArchived ? "Hide Archived" : "Include Archived"}
                >
                    <Archive className="w-3.5 h-3.5" />
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); setIsSearchOpen(!isSearchOpen); if (isSearchOpen) setSearchQuery(''); }}
                    className={`transition-colors p-1.5 rounded-lg border ${isSearchOpen ? 'text-sage-600 dark:text-sage-400 bg-sage-50 dark:bg-sage-900/40 border-sage-200 dark:border-sage-500/30' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/5'}`}
                    title="Search Collections"
                >
                    <Search className="w-3.5 h-3.5" />
                </button>
                {renderToolbarExtras?.()}
            </div>
            {isSearchOpen && (
                <SearchInput
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Find collection..."
                    className="pb-3"
                />
            )}

            {renderCreationForm?.()}

            <div className="space-y-1 pr-1">
                {pinned.length > 0 && (
                    <div className="mb-2">
                        <div className="px-2 pb-1.5 text-[10px] font-bold text-gray-400 dark:text-gray-600 uppercase tracking-wider flex items-center gap-1">
                            <Pin className="w-3 h-3" /> Pinned
                        </div>
                        <div className={viewMode === 'grid' ? 'grid grid-cols-3 gap-2 relative' : 'space-y-1 relative'}>
                            <AnimatePresence mode="popLayout" initial={false}>
                                {pinned.map(col => (
                                    <motion.div
                                        key={col.id}
                                        layout
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        className={viewMode === 'grid' ? '' : 'relative'}
                                        transition={{
                                            layout: { duration: 0.2, ease: 'easeInOut' },
                                            opacity: { duration: 0.15 },
                                            scale: { duration: 0.15 }
                                        }}
                                    >
                                        <CollectionItem
                                            col={col}
                                            filters={filters}
                                            setFilters={setFilters}
                                            editingColId={editingColId}
                                            editName={editName}
                                            setEditName={setEditName}
                                            setEditingColId={setEditingColId}
                                            handleRenameSubmit={handleRenameSubmit}
                                            handleDragEnter={handleDragEnter}
                                            handleDragOver={handleDragOver}
                                            handleDragLeave={handleDragLeave}
                                            handleDrop={handleDrop}
                                            handleContextMenu={handleContextMenu}
                                            dropTargetId={dropTargetId}
                                            onToggleArchive={onToggleArchiveCollection}
                                            onTogglePin={onTogglePinCollection}
                                            onSetColor={onSetCollectionColor}
                                            onPlay={onPlayCollection}
                                            onExport={onExportCollection}
                                            onResetThumbnail={onResetCollectionThumbnail}
                                            onDelete={onDeleteCollection}
                                            viewMode={viewMode}
                                            isThumbnailPending={!!thumbnailHydrationPendingIds[col.id] || !!smartSummaryPendingIds[col.id]}
                                        />
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                        <div className="h-px bg-gray-200 dark:bg-white/5 my-2 mx-1" />
                    </div>
                )}

                <div className={viewMode === 'grid' ? 'grid grid-cols-3 gap-2 relative' : 'space-y-1 relative'}>
                    <AnimatePresence mode="popLayout" initial={false}>
                        {visibleOthers.map(col => (
                            <motion.div
                                key={col.id}
                                layout
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className={viewMode === 'grid' ? '' : 'relative'}
                                transition={{
                                    layout: { duration: 0.2, ease: 'easeInOut' },
                                    opacity: { duration: 0.15 },
                                    scale: { duration: 0.15 }
                                }}
                            >
                                <CollectionItem
                                    col={col}
                                    filters={filters}
                                    setFilters={setFilters}
                                    editingColId={editingColId}
                                    editName={editName}
                                    setEditName={setEditName}
                                    setEditingColId={setEditingColId}
                                    handleRenameSubmit={handleRenameSubmit}
                                    handleDragEnter={handleDragEnter}
                                    handleDragOver={handleDragOver}
                                    handleDragLeave={handleDragLeave}
                                    handleDrop={handleDrop}
                                    handleContextMenu={handleContextMenu}
                                    dropTargetId={dropTargetId}
                                    onToggleArchive={onToggleArchiveCollection}
                                    onTogglePin={onTogglePinCollection}
                                    onSetColor={onSetCollectionColor}
                                    onPlay={onPlayCollection}
                                    onExport={onExportCollection}
                                    onResetThumbnail={onResetCollectionThumbnail}
                                    onDelete={onDeleteCollection}
                                    viewMode={viewMode}
                                    isThumbnailPending={!!thumbnailHydrationPendingIds[col.id] || !!smartSummaryPendingIds[col.id]}
                                />
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>

                {hasMore && (
                    <button
                        onClick={() => setRenderLimit(prev => prev + 60)}
                        className={`w-full py-2 text-xs font-medium text-sage-600 dark:text-sage-400 bg-sage-50 dark:bg-sage-900/20 hover:bg-sage-100 dark:hover:bg-sage-900/40 rounded-lg transition-colors border border-sage-200 dark:border-sage-500/30 ${viewMode === 'grid' ? 'col-span-3' : ''}`}
                    >
                        Show More ({others.length - renderLimit} remaining)
                    </button>
                )}

                {filtered.length === 0 && (
                    <div className="text-xs text-gray-400 text-center py-2 italic">{emptyMessage}</div>
                )}
            </div>

            {contextMenu && createPortal(
                <CollectionContextMenu
                    x={contextMenu.x} y={contextMenu.y} collectionId={contextMenu.collectionId}
                    isArchived={activeCol?.isArchived}
                    isPinned={activeCol?.isPinned}
                    hasCustomThumbnail={!!activeCol?.customThumbnail}
                    currentColor={activeCol?.color}
                    onClose={() => setContextMenu(null)}
                    onRename={() => {
                        if (activeCol) { setEditingColId(activeCol.id); setEditName(activeCol.name); }
                        setContextMenu(null);
                    }}
                    onToggleArchive={() => { onToggleArchiveCollection?.(contextMenu.collectionId); setContextMenu(null); }}
                    onTogglePin={() => { onTogglePinCollection?.(contextMenu.collectionId); setContextMenu(null); }}
                    onDelete={() => { onDeleteCollection?.(contextMenu.collectionId); setContextMenu(null); }}
                    onPlaySlideshow={() => { onPlayCollection?.(contextMenu.collectionId); setContextMenu(null); }}
                    onExport={() => { onExportCollection?.(contextMenu.collectionId); setContextMenu(null); }}
                    onResetThumbnail={() => { onResetCollectionThumbnail?.(contextMenu.collectionId); setContextMenu(null); }}
                    onColorChange={(color) => { onSetCollectionColor?.(contextMenu.collectionId, color); setContextMenu(null); }}
                    onEditCollection={() => { onEditCollection?.(contextMenu.collectionId); setContextMenu(null); }}
                />,
                document.body
            )}
        </div>
    );
}
