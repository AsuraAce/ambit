import * as React from 'react';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Collection, FilterState } from '../../../types';
import { SectionHeader } from '../FilterPrimitives';
import { CollectionList } from './CollectionList';

interface CollectionsSectionProps {
    collections: Collection[];
    filters: FilterState;
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
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

    const handleCreate = (e: React.FormEvent) => {
        e.preventDefault();
        if (newName.trim()) {
            onCreateCollection(newName);
            setNewName('');
            setIsCreating(false);
        }
    };

    return (
        <div className="space-y-2">
            <SectionHeader
                title="Collections"
                isOpen={isOpen}
                onToggle={onToggle}
            />

            {isOpen && (
                <CollectionList
                    collections={collections}
                    filters={filters}
                    setFilters={setFilters}
                    onDeleteCollection={onDeleteCollection || (() => { })}
                    onRenameCollection={onRenameCollection}
                    onDropOnCollection={onDropOnCollection}
                    onToggleArchiveCollection={onToggleArchiveCollection}
                    onTogglePinCollection={onTogglePinCollection}
                    onSetCollectionColor={onSetCollectionColor}
                    onPlayCollection={onPlayCollection}
                    onExportCollection={onExportCollection}
                    onResetCollectionThumbnail={onResetCollectionThumbnail}
                    emptyMessage="No collections found."
                    renderToolbarExtras={() => (
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsCreating(true); }}
                            className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/5 p-1.5 rounded-lg shadow-sm"
                            title="New Collection"
                        >
                            <Plus className="w-3.5 h-3.5" />
                        </button>
                    )}
                    renderCreationForm={() => isCreating && (
                        <form onSubmit={handleCreate} className="mb-2 flex items-center gap-1 animate-in fade-in">
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
                />
            )}
        </div>
    );
};
