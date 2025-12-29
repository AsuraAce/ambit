import * as React from 'react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Save, Search, Archive, ArrowUpDown, Check, Pin } from 'lucide-react';
import { FilterState, SmartCollection } from '../../../types';
import { SectionHeader, SearchInput } from '../FilterPrimitives';
import { CollectionContextMenu } from '../../CollectionContextMenu';
import { CollectionItem } from './CollectionItem';

interface SmartCollectionsSectionProps {
    filters: FilterState;
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    smartCollections: SmartCollection[];
    isOpen: boolean;
    onToggle: () => void;
    onSaveSmartCollection: (name: string, filters: FilterState) => void;
    onDeleteSmartCollection: (id: string) => void;
    onDropOnCollection?: (collectionId: string, data: string) => void;
    onRenameCollection?: (colId: string, newName: string) => void;
    onToggleArchiveCollection?: (colId: string) => void;
    onTogglePinCollection?: (colId: string) => void;
    onSetCollectionColor?: (colId: string, color: string | undefined) => void;
    onPlayCollection?: (colId: string) => void;
    onExportCollection?: (colId: string) => void;
    onResetCollectionThumbnail?: (colId: string) => void;
    isDirty: boolean;
}

export const SmartCollectionsSection: React.FC<SmartCollectionsSectionProps> = ({
    filters,
    setFilters,
    smartCollections,
    isOpen,
    onToggle,
    onSaveSmartCollection,
    onDeleteSmartCollection,
    onDropOnCollection,
    onRenameCollection,
    onToggleArchiveCollection,
    onTogglePinCollection,
    onSetCollectionColor,
    onPlayCollection,
    onExportCollection,
    onResetCollectionThumbnail,
    isDirty
}) => {
    const [isCreatingSmart, setIsCreatingSmart] = useState(false);
    const [newName, setNewName] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showArchived, setShowArchived] = useState(false);
    const [sort, setSort] = useState<'name_asc' | 'name_desc' | 'count_asc' | 'count_desc' | 'date_asc' | 'date_desc'>('date_desc');
    const [showSortMenu, setShowSortMenu] = useState(false);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);

    // Renaming state
    const [editingColId, setEditingColId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

    // Context Menu state
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, collectionId: string } | null>(null);

    const handleSaveSmartCollection = (e: React.FormEvent) => {
        e.preventDefault();
        if (newName.trim()) {
            onSaveSmartCollection(newName, filters);
            setNewName('');
            setIsCreatingSmart(false);
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

    const handleContextMenu = (e: React.MouseEvent, colId: string) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, collectionId: colId });
    };

    const filtered = smartCollections
        .filter(sc => {
            const matchesSearch = sc.name.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesArchive = showArchived ? true : !sc.isArchived;
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

    const pinned = filtered.filter(sc => sc.isPinned);
    const others = filtered.filter(sc => !sc.isPinned);

    return (
        <div className="space-y-2">
            <SectionHeader
                title="Smart Collections"
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
                        {isDirty && !isCreatingSmart && (
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsCreatingSmart(true); }}
                                className="text-sage-600 dark:text-sage-400 hover:text-sage-500 dark:hover:text-sage-300 transition-colors bg-sage-100 dark:bg-sage-900/30 border border-sage-500/30 p-1 rounded-md"
                                title="Save current filters"
                            >
                                <Save className="w-3 h-3" />
                            </button>
                        )}
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
                            className="pb-3"
                        />
                    )}

                    {isCreatingSmart && (
                        <form onSubmit={handleSaveSmartCollection} className="mb-2 flex items-center gap-1 animate-in fade-in">
                            <input
                                autoFocus
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="Save filter as..."
                                className="w-full bg-white dark:bg-zinc-900 border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1 text-xs focus:border-sage-500 outline-none text-gray-900 dark:text-white"
                                onBlur={() => !newName && setIsCreatingSmart(false)}
                            />
                        </form>
                    )}

                    {pinned.length > 0 && (
                        <div className="mb-2">
                            <div className="px-2 pb-1.5 text-[10px] font-bold text-gray-400 dark:text-gray-600 uppercase tracking-wider flex items-center gap-1">
                                <Pin className="w-3 h-3" /> Pinned
                            </div>
                            <div className="space-y-1">
                                {pinned.map(sc => (
                                    <CollectionItem
                                        key={sc.id}
                                        col={sc}
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
                                        onDelete={onDeleteSmartCollection}
                                    />
                                ))}
                            </div>
                            <div className="h-px bg-gray-200 dark:bg-white/5 my-2 mx-1" />
                        </div>
                    )}

                    <div className="space-y-1">
                        {others.map(sc => (
                            <CollectionItem
                                key={sc.id}
                                col={sc}
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
                                onDelete={onDeleteSmartCollection}
                            />
                        ))}
                    </div>
                    {filtered.length === 0 && !isCreatingSmart && (
                        <div className="px-3 py-2 text-xs text-gray-400 dark:text-zinc-600 italic text-center">No smart collections found.</div>
                    )}
                </div>
            )}

            {contextMenu && createPortal(
                <CollectionContextMenu
                    x={contextMenu.x} y={contextMenu.y} collectionId={contextMenu.collectionId}
                    isArchived={smartCollections.find(c => c.id === contextMenu.collectionId)?.isArchived}
                    isPinned={smartCollections.find(c => c.id === contextMenu.collectionId)?.isPinned}
                    hasCustomThumbnail={!!smartCollections.find(c => c.id === contextMenu.collectionId)?.customThumbnail}
                    currentColor={smartCollections.find(c => c.id === contextMenu.collectionId)?.color}
                    onClose={() => setContextMenu(null)}
                    onRename={() => {
                        const col = smartCollections.find(c => c.id === contextMenu.collectionId);
                        if (col) { setEditingColId(col.id); setEditName(col.name); }
                        setContextMenu(null);
                    }}
                    onToggleArchive={() => { onToggleArchiveCollection?.(contextMenu.collectionId); setContextMenu(null); }}
                    onTogglePin={() => { onTogglePinCollection?.(contextMenu.collectionId); setContextMenu(null); }}
                    onDelete={() => { onDeleteSmartCollection?.(contextMenu.collectionId); setContextMenu(null); }}
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
