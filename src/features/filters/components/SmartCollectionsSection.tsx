import * as React from 'react';
import { useState } from 'react';
import { Save } from 'lucide-react';
import { FilterState, SmartCollection } from '../../../types';
import { SectionHeader } from './FilterPrimitives';
import { CollectionList } from './CollectionList';

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

    const handleSaveSmartCollection = (e: React.FormEvent) => {
        e.preventDefault();
        if (newName.trim()) {
            onSaveSmartCollection(newName, filters);
            setNewName('');
            setIsCreatingSmart(false);
        }
    };

    return (
        <div className="space-y-2">
            <SectionHeader
                title="Smart Collections"
                isOpen={isOpen}
                onToggle={onToggle}
            />

            {isOpen && (
                <CollectionList
                    collections={smartCollections}
                    filters={filters}
                    setFilters={setFilters}
                    onDeleteCollection={onDeleteSmartCollection}
                    onRenameCollection={onRenameCollection}
                    onDropOnCollection={onDropOnCollection}
                    onToggleArchiveCollection={onToggleArchiveCollection}
                    onTogglePinCollection={onTogglePinCollection}
                    onSetCollectionColor={onSetCollectionColor}
                    onPlayCollection={onPlayCollection}
                    onExportCollection={onExportCollection}
                    onResetCollectionThumbnail={onResetCollectionThumbnail}
                    emptyMessage="No smart collections found."
                    renderToolbarExtras={() => (
                        isDirty && !isCreatingSmart && (
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsCreatingSmart(true); }}
                                className="ml-auto text-sage-600 dark:text-sage-400 hover:text-white hover:bg-sage-500 transition-all bg-sage-50 dark:bg-sage-900/40 border border-sage-500/30 p-1.5 rounded-lg shadow-sm"
                                title="Save current filters"
                            >
                                <Save className="w-3.5 h-3.5" />
                            </button>
                        )
                    )}
                    renderCreationForm={() => isCreatingSmart && (
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
                />
            )}
        </div>
    );
};
