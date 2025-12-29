import * as React from 'react';
import { useState } from 'react';
import { Save } from 'lucide-react';
import { FilterState, SmartCollection } from '../../../types';
import { SectionHeader } from '../FilterPrimitives';
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
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);

    // Renaming state
    const [editingColId, setEditingColId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

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

    return (
        <div className="space-y-2">
            <SectionHeader
                title="Smart Collections"
                isOpen={isOpen}
                onToggle={onToggle}
                action={isDirty && !isCreatingSmart ? (
                    <button
                        onClick={(e) => { e.stopPropagation(); setIsCreatingSmart(true); }}
                        className="text-sage-600 dark:text-sage-400 hover:text-sage-800 dark:hover:text-sage-300 transition-colors text-[10px] flex items-center gap-1 font-medium bg-sage-100 dark:bg-sage-900/30 border border-sage-500/30 px-1.5 py-0.5 rounded"
                        title="Save current filters"
                    >
                        <Save className="w-3 h-3" /> Save
                    </button>
                ) : undefined}
            />

            {isOpen && (
                <div className="space-y-1 animate-in slide-in-from-top-2 duration-300 ease-spring">
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

                    {smartCollections.map(sc => (
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
                            handleContextMenu={() => { }} // App.tsx wires up context menu via portal
                            dropTargetId={dropTargetId}
                        />
                    ))}
                    {smartCollections.length === 0 && !isCreatingSmart && (
                        <div className="px-3 py-2 text-xs text-gray-500 dark:text-zinc-600 italic">No smart collections saved.</div>
                    )}
                </div>
            )}
        </div>
    );
};
