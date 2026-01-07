import * as React from 'react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArrowUpDown, Search, Pin, Check, LayoutGrid, List as ListIcon } from 'lucide-react';
import { Collection, FilterState } from '../../../types';
import { SearchInput } from './FilterPrimitives';
import { CollectionContextMenu } from '../../collections/components/CollectionContextMenu';
import { CollectionItem } from './CollectionItem';
import { useSettings } from '../../../contexts/SettingsContext';

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
    emptyMessage?: string;
}

export type CollectionSort = 'name_asc' | 'name_desc' | 'count_asc' | 'count_desc' | 'date_asc' | 'date_desc';

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
    const sort = (settings.resourceSortOptions?.['collections'] as CollectionSort) || 'date_desc';

    const setSort = (newSort: CollectionSort) => {
        setSettings(prev => ({
            ...prev,
            resourceSortOptions: {
                ...(prev.resourceSortOptions || {}),
                collections: newSort as any
            }
        }));
    };
    const [showSortMenu, setShowSortMenu] = useState(false);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);

    const viewMode = settings.resourceViewModes?.['collections'] || 'list';

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
        setDropTargetId(colId);
    };
    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDropTargetId(null);
    };
    const handleDrop = (e: React.DragEvent, colId: string) => {
        e.preventDefault(); e.stopPropagation();
        setDropTargetId(null);
        const data = e.dataTransfer.getData('text/plain');
        if (data && onDropOnCollection) onDropOnCollection(colId, data);
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
                case 'date_desc': default: return b.createdAt - a.createdAt;
            }
        });

    const pinned = filtered.filter(c => c.isPinned);
    const others = filtered.filter(c => !c.isPinned);

    const activeCol = collections.find(c => c.id === contextMenu?.collectionId);

    return (
        <div className="space-y-1 animate-in slide-in-from-top-2 duration-300 ease-spring">
            <div className="flex items-center gap-1.5 px-2 pb-2">
                <button
                    onClick={(e) => { e.stopPropagation(); setShowArchived(!showArchived); }}
                    className={`transition-colors p-1.5 rounded-lg border ${showArchived ? 'text-sage-600 dark:text-sage-400 bg-sage-50 dark:bg-sage-900/40 border-sage-200 dark:border-sage-500/30' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/5'}`}
                    title={showArchived ? "Hide Archived" : "Include Archived"}
                >
                    <Archive className="w-3.5 h-3.5" />
                </button>
                <div className="relative">
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowSortMenu(!showSortMenu); }}
                        className={`transition-colors p-1.5 rounded-lg border ${showSortMenu ? 'text-sage-600 dark:text-sage-400 bg-sage-50 dark:bg-sage-900/40 border-sage-200 dark:border-sage-500/30' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/5'}`}
                        title="Sort Collections"
                    >
                        <ArrowUpDown className="w-3.5 h-3.5" />
                    </button>
                    {showSortMenu && (
                        <div className="absolute left-0 top-full mt-1 w-48 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-white/10 rounded-xl shadow-xl z-50 overflow-hidden py-1">
                            {[
                                { id: 'date_desc', label: 'Newest Created' },
                                { id: 'date_asc', label: 'Oldest Created' },
                                { id: 'name_asc', label: 'Name (A-Z)' },
                                { id: 'name_desc', label: 'Name (Z-A)' },
                                { id: 'count_desc', label: 'Most Images' },
                                { id: 'count_asc', label: 'Fewest Images' },
                            ].map(opt => (
                                <button
                                    key={opt.id}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSort(opt.id as any);
                                        setShowSortMenu(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-gray-100 dark:hover:bg-white/5 transition-colors ${sort === opt.id ? 'text-sage-600 dark:text-sage-400 font-medium' : 'text-gray-600 dark:text-gray-400'}`}
                                >
                                    {opt.label}
                                    {sort === opt.id && <Check className="w-3 h-3" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <button
                    onClick={(e) => { e.stopPropagation(); setIsSearchOpen(!isSearchOpen); if (isSearchOpen) setSearchQuery(''); }}
                    className={`transition-colors p-1.5 rounded-lg border ${isSearchOpen ? 'text-sage-600 dark:text-sage-400 bg-sage-50 dark:bg-sage-900/40 border-sage-200 dark:border-sage-500/30' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/5'}`}
                    title="Search Collections"
                >
                    <Search className="w-3.5 h-3.5" />
                </button>
                <button
                    onClick={toggleViewMode}
                    className={`transition-colors p-1.5 rounded-lg border ${viewMode === 'grid' ? 'text-sage-600 dark:text-sage-400 bg-sage-50 dark:bg-sage-900/40 border-sage-200 dark:border-sage-500/30' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/5'}`}
                    title={viewMode === 'list' ? "Switch to Grid View" : "Switch to List View"}
                >
                    {viewMode === 'list' ? <LayoutGrid className="w-3.5 h-3.5" /> : <ListIcon className="w-3.5 h-3.5" />}
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
                        <div className={viewMode === 'grid' ? 'grid grid-cols-3 gap-2' : 'space-y-1'}>
                            {pinned.map(col => (
                                <CollectionItem
                                    key={col.id}
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
                                />
                            ))}
                        </div>
                        <div className="h-px bg-gray-200 dark:bg-white/5 my-2 mx-1" />
                    </div>
                )}

                <div className={viewMode === 'grid' ? 'grid grid-cols-3 gap-2' : 'space-y-1'}>
                    {others.map(col => (
                        <CollectionItem
                            key={col.id}
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
                        />
                    ))}
                </div>

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
