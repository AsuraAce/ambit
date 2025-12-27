import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArrowUpDown, Search, Plus, Check, Pin } from 'lucide-react';
import { Collection, FilterState } from '../../../types';
import { SectionHeader, SearchInput } from '../FilterPrimitives';
import { CollectionContextMenu } from '../../CollectionContextMenu';
import { CollectionItem } from './CollectionItem';

interface CollectionsSectionProps {
    collections: Collection[];
    filters: FilterState;
    setFilters: (update: (prev: FilterState) => FilterState) => void;
    isOpen: boolean;
    onToggle: () => void;
    onCreateCollection: (name: string) => void;
    onDropOnCollection?: (collectionId: string, data: string) => void;
    onRenameCollection?: (colId: string, newName: string) => void;
    onDeleteCollection?: (colId: string) => void;
    onToggleArchiveCollection?: (colId: string) => void;
    onTogglePinCollection?: (colId: string) => void;
    onSetCollectionColor?: (colId: string, color: string | undefined) => void;
    onPlayCollection?: (colId: string) => void;
    onExportCollection?: (colId: string) => void;
    onResetCollectionThumbnail?: (colId: string) => void;
}

type CollectionSort = 'name_asc' | 'name_desc' | 'count_asc' | 'count_desc' | 'date_asc' | 'date_desc';

export const CollectionsSection: React.FC<CollectionsSectionProps> = ({
    collections,
    filters,
    setFilters,
    isOpen,
    onToggle,
    onCreateCollection,
    onDropOnCollection,
    onRenameCollection,
    onDeleteCollection,
    onToggleArchiveCollection,
    onTogglePinCollection,
    onSetCollectionColor,
    onPlayCollection,
    onExportCollection,
    onResetCollectionThumbnail,
}) => {
    const [isCreating, setIsCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showArchived, setShowArchived] = useState(false);
    const [sort, setSort] = useState<CollectionSort>('date_desc');
    const [showSortMenu, setShowSortMenu] = useState(false);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);

    // Renaming state
    const [editingColId, setEditingColId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

    // Context Menu state
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, collectionId: string } | null>(null);

    const handleCreate = (e: React.FormEvent) => {
        e.preventDefault();
        if (newName.trim()) {
            onCreateCollection(newName);
            setNewName('');
            setIsCreating(false);
        }
    };

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

    // Context Menu Actions
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

    return (
        <div className="space-y-2">
            <SectionHeader
                title="Collections"
                isOpen={isOpen}
                onToggle={onToggle}
                action={
                    <div className="flex items-center gap-1">
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowArchived(!showArchived); }}
                            className={`transition-colors p-1 rounded-md ${showArchived ? 'text-sage-600 dark:text-sage-400 bg-sage-100 dark:bg-sage-900/30' : 'text-gray-400 hover:text-sage-500 dark:hover:text-sage-400'}`}
                            title={showArchived ? "Hide Archived" : "Include Archived"}
                        >
                            <Archive className="w-3 h-3" />
                        </button>
                        <div className="relative">
                            <button
                                onClick={(e) => { e.stopPropagation(); setShowSortMenu(!showSortMenu); }}
                                className={`transition-colors p-1 rounded-md ${showSortMenu ? 'text-sage-600 dark:text-sage-400 bg-sage-100 dark:bg-sage-900/30' : 'text-gray-400 hover:text-sage-500 dark:hover:text-sage-400'}`}
                                title="Sort Collections"
                            >
                                <ArrowUpDown className="w-3 h-3" />
                            </button>
                            {showSortMenu && (
                                <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-white/10 rounded-xl shadow-xl z-50 overflow-hidden py-1">
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
                            className={`transition-colors p-1 rounded-md ${isSearchOpen ? 'text-sage-600 dark:text-sage-400 bg-sage-100 dark:bg-sage-900/30' : 'text-gray-400 hover:text-sage-500 dark:hover:text-sage-400'}`}
                            title="Search Collections"
                        >
                            <Search className="w-3 h-3" />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsCreating(true); }}
                            className="text-gray-400 hover:text-sage-500 dark:hover:text-sage-400 transition-colors p-1"
                            title="New Collection"
                        >
                            <Plus className="w-3 h-3" />
                        </button>
                    </div>
                }
            />

            {isOpen && (
                <div className="space-y-1 animate-in slide-in-from-top-2 duration-300 ease-spring">
                    {isSearchOpen && (
                        <SearchInput
                            value={searchQuery}
                            onChange={setSearchQuery}
                            placeholder="Find collection..."
                            className="px-1 pb-2"
                        />
                    )}

                    {isCreating && (
                        <form onSubmit={handleCreate} className="mb-2 flex items-center gap-1">
                            <input
                                autoFocus
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="Name..."
                                className="w-full bg-white dark:bg-zinc-900 border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs focus:border-sage-500 outline-none text-gray-900 dark:text-white"
                                onBlur={() => !newName && setIsCreating(false)}
                            />
                        </form>
                    )}

                    <div className="max-h-[35vh] overflow-y-auto custom-scrollbar space-y-1 pr-1">
                        {pinned.length > 0 && (
                            <div className="mb-2">
                                <div className="px-2 pb-1.5 text-[10px] font-bold text-gray-400 dark:text-gray-600 uppercase tracking-wider flex items-center gap-1">
                                    <Pin className="w-3 h-3" /> Pinned
                                </div>
                                <div className="space-y-1">
                                    {pinned.map(col => (
                                        <CollectionItem
                                            key={col.id} col={col} filters={filters} setFilters={setFilters}
                                            editingColId={editingColId} editName={editName} setEditName={setEditName}
                                            setEditingColId={setEditingColId} handleRenameSubmit={handleRenameSubmit}
                                            handleDragEnter={handleDragEnter} handleDragOver={handleDragOver}
                                            handleDragLeave={handleDragLeave} handleDrop={handleDrop}
                                            handleContextMenu={handleContextMenu} dropTargetId={dropTargetId}
                                        />
                                    ))}
                                </div>
                                <div className="h-px bg-gray-200 dark:bg-white/5 my-2 mx-1" />
                            </div>
                        )}

                        <div className="space-y-1">
                            {others.map(col => (
                                <CollectionItem
                                    key={col.id} col={col} filters={filters} setFilters={setFilters}
                                    editingColId={editingColId} editName={editName} setEditName={setEditName}
                                    setEditingColId={setEditingColId} handleRenameSubmit={handleRenameSubmit}
                                    handleDragEnter={handleDragEnter} handleDragOver={handleDragOver}
                                    handleDragLeave={handleDragLeave} handleDrop={handleDrop}
                                    handleContextMenu={handleContextMenu} dropTargetId={dropTargetId}
                                />
                            ))}
                        </div>

                        {filtered.length === 0 && (
                            <div className="text-xs text-gray-400 text-center py-2 italic">No collections found.</div>
                        )}
                    </div>
                </div>
            )}

            {contextMenu && createPortal(
                <CollectionContextMenu
                    x={contextMenu.x} y={contextMenu.y} collectionId={contextMenu.collectionId}
                    isArchived={collections.find(c => c.id === contextMenu.collectionId)?.isArchived}
                    isPinned={collections.find(c => c.id === contextMenu.collectionId)?.isPinned}
                    hasCustomThumbnail={!!collections.find(c => c.id === contextMenu.collectionId)?.customThumbnail}
                    currentColor={collections.find(c => c.id === contextMenu.collectionId)?.color}
                    onClose={() => setContextMenu(null)}
                    onRename={() => {
                        const col = collections.find(c => c.id === contextMenu.collectionId);
                        if (col) { setEditingColId(col.id); setEditName(col.name); }
                        setContextMenu(null);
                    }}
                    onToggleArchive={() => { onToggleArchiveCollection?.(contextMenu.collectionId); setContextMenu(null); }}
                    onTogglePin={() => { onTogglePinCollection?.(contextMenu.collectionId); setContextMenu(null); }}
                    onDelete={() => { onDeleteCollection?.(contextMenu.collectionId); setContextMenu(null); }}
                    onPlaySlideshow={() => { onPlayCollection?.(contextMenu.collectionId); setContextMenu(null); }}
                    onExport={() => { onExportCollection?.(contextMenu.collectionId); setContextMenu(null); }}
                    onResetThumbnail={() => { onResetCollectionThumbnail?.(contextMenu.collectionId); setContextMenu(null); }}
                    onColorChange={(color) => { onSetCollectionColor?.(contextMenu.collectionId, color); setContextMenu(null); }}
                />,
                document.body
            )}
        </div>
    );
};
