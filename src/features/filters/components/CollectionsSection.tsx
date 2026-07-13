import * as React from 'react';
import { useState } from 'react';
import { Plus, Save, FolderOpen } from 'lucide-react';
import { Collection, FilterState } from '../../../types';
import { SectionHeader } from './FilterPrimitives';
import { CollectionList } from './CollectionList';
import { TooltipButton } from '../../../components/ui/InfoTooltip';

interface CollectionsSectionProps {
    collections: Collection[];
    filters: FilterState;
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    isOpen: boolean;
    onToggle: () => void;
    onCreateCollection: (name: string, filters?: FilterState) => void;
    onDropOnCollection?: (collectionId: string, data: string) => void;
    onRenameCollection?: (colId: string, newName: string) => void;
    onDeleteCollection?: (colId: string) => void;
    onToggleArchiveCollection?: (colId: string) => void;
    onTogglePinCollection?: (colId: string) => void;
    onSetCollectionColor?: (colId: string, color: string | undefined) => void;
    onPlayCollection?: (colId: string) => void;
    onExportCollection?: (colId: string) => void;
    onResetCollectionThumbnail?: (colId: string) => void;
    isDirty?: boolean;
    onEditCollection?: (colId: string) => void;
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
    isDirty,
    onEditCollection
}) => {
    const [isCreating, setIsCreating] = useState(false);
    const [isSavingSearch, setIsSavingSearch] = useState(false);
    const [newName, setNewName] = useState('');

    const handleCreate = (e: React.FormEvent) => {
        e.preventDefault();
        if (newName.trim()) {
            // If isSavingSearch is true, we pass the current filters. Otherwise undefined.
            onCreateCollection(newName, isSavingSearch ? filters : undefined);
            setNewName('');
            setIsCreating(false);
            setIsSavingSearch(false);
        }
    };

    const startCreation = (saveSearch: boolean) => {
        setIsCreating(true);
        setIsSavingSearch(saveSearch);
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
                    onEditCollection={onEditCollection}
                    emptyMessage={
                        <div className="flex flex-col items-center justify-center py-6 px-4 text-center space-y-3">
                            <div className="w-10 h-10 rounded-full bg-sage-50 dark:bg-white/5 flex items-center justify-center">
                                <FolderOpen className="w-5 h-5 text-sage-400 dark:text-zinc-500" />
                            </div>
                            <div className="space-y-1">
                                <p className="text-xs font-medium text-gray-600 dark:text-gray-300">No collections yet</p>
                                <p className="text-[10px] text-gray-400 dark:text-gray-500 max-w-[180px]">
                                    Organize your generations into collections for easy access.
                                </p>
                            </div>
                            <button
                                onClick={() => startCreation(false)}
                                className="text-xs bg-sage-500 hover:bg-sage-600 text-white px-3 py-1.5 rounded-lg shadow-sm shadow-sage-500/20 transition-all flex items-center gap-1.5"
                            >
                                <Plus className="w-3 h-3" />
                                <span>Create Collection</span>
                            </button>
                        </div>
                    }
                    renderToolbarExtras={() => (
                        <div className="ml-auto flex items-center gap-1">
                            {isDirty && !isCreating && (
                                <TooltipButton
                                    label="Save Filters as Collection"
                                    content="Save the current filters as a smart collection"
                                    onClick={(e) => { e.stopPropagation(); startCreation(true); }}
                                    className="text-sage-600 dark:text-sage-400 hover:text-white hover:bg-sage-500 transition-all bg-sage-50 dark:bg-sage-900/40 border border-sage-500/30 p-1.5 rounded-lg shadow-sm"
                                >
                                    <Save className="w-3.5 h-3.5" />
                                </TooltipButton>
                            )}
                            <TooltipButton
                                label="New Empty Collection"
                                content="Create a collection without saving the current filters"
                                onClick={(e) => { e.stopPropagation(); startCreation(false); }}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/5 p-1.5 rounded-lg shadow-sm"
                            >
                                <Plus className="w-3.5 h-3.5" />
                            </TooltipButton>
                        </div>
                    )}
                    renderCreationForm={() => isCreating && (
                        <form onSubmit={handleCreate} className="mb-2 flex items-center gap-1 animate-in fade-in">
                            <input
                                autoFocus
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder={isSavingSearch ? "Save search as..." : "New collection name..."}
                                className="w-full bg-white dark:bg-zinc-900 border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs focus:border-sage-500 outline-none text-gray-900 dark:text-white"
                                onBlur={() => { !newName && setIsCreating(false); setIsSavingSearch(false); }}
                            />
                        </form>
                    )}
                />
            )}
        </div>
    );
};
