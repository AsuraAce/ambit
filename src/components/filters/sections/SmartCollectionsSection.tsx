import * as React from 'react';
import { useState } from 'react';
import { Save, Sparkles, Trash2 } from 'lucide-react';
import { FilterState, SmartCollection } from '../../../types';
import { SectionHeader } from '../FilterPrimitives';

interface SmartCollectionsSectionProps {
    filters: FilterState;
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    smartCollections: SmartCollection[];
    isOpen: boolean;
    onToggle: () => void;
    onSaveSmartCollection: (name: string, filters: FilterState) => void;
    onDeleteSmartCollection: (id: string) => void;
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
                        <div key={sc.id} className="group relative flex items-center">
                            <button
                                onClick={() => setFilters(sc.filters)}
                                className="flex-1 text-left px-3 py-2 rounded-xl text-sm text-gray-500 dark:text-zinc-400 hover:bg-white/40 dark:hover:bg-white/5 hover:text-sage-700 dark:hover:text-sage-300 truncate flex items-center gap-2 transition-colors"
                            >
                                <Sparkles className="w-3.5 h-3.5 text-sage-500" />
                                {sc.name}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); onDeleteSmartCollection(sc.id); }}
                                className="absolute right-2 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ))}
                    {smartCollections.length === 0 && !isCreatingSmart && (
                        <div className="px-3 py-2 text-xs text-gray-500 dark:text-zinc-600 italic">No smart collections saved.</div>
                    )}
                </div>
            )}
        </div>
    );
};
