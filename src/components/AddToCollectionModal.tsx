import * as React from 'react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Folder, ArrowUpDown, Check, X, Plus } from 'lucide-react';
import { Collection } from '../types';
import { SearchInput } from './filters/FilterPrimitives';

interface AddToCollectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    collections: Collection[];
    selectedIds: string[];
    onAddImagesToCollection: (ids: string[], colId: string) => void;
}

type CollectionSort = 'name_asc' | 'name_desc' | 'count_asc' | 'count_desc' | 'date_asc' | 'date_desc';

export const AddToCollectionModal: React.FC<AddToCollectionModalProps> = ({
    isOpen,
    onClose,
    collections,
    selectedIds,
    onAddImagesToCollection
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [sort, setSort] = useState<CollectionSort>('date_desc');
    const [showSortMenu, setShowSortMenu] = useState(false);

    const filtered = collections
        .filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
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

    const sortOptions = [
        { id: 'date_desc', label: 'Recently Created' },
        { id: 'date_asc', label: 'Oldest Created' },
        { id: 'name_asc', label: 'Name (A-Z)' },
        { id: 'name_desc', label: 'Name (Z-A)' },
        { id: 'count_desc', label: 'Most Images' },
        { id: 'count_asc', label: 'Fewest Images' },
    ];

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={onClose}
            />

            <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 10 }}
                className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden shadow-sage-500/10"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 dark:border-white/5 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Add to Collection</h3>
                        <p className="text-xs text-gray-500">{selectedIds.length} images selected</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full transition-colors">
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                {/* Toolbar: Search and Sort */}
                <div className="px-6 py-3 bg-gray-50/50 dark:bg-white/[0.02] flex items-center gap-2 border-b border-gray-100 dark:border-white/5">
                    <SearchInput
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder="Search collections..."
                        className="flex-1"
                    />

                    <div className="relative">
                        <button
                            onClick={() => setShowSortMenu(!showSortMenu)}
                            className={`p-2 rounded-lg border transition-all ${showSortMenu ? 'bg-sage-600 text-white border-sage-600' : 'bg-white dark:bg-zinc-800 border-gray-200 dark:border-white/10 text-gray-500'}`}
                        >
                            <ArrowUpDown className="w-4 h-4" />
                        </button>

                        <AnimatePresence>
                            {showSortMenu && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setShowSortMenu(false)} />
                                    <motion.div
                                        initial={{ opacity: 0, y: 5, scale: 0.95 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: 5, scale: 0.95 }}
                                        className="absolute right-0 mt-2 w-48 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl z-20 py-1 overflow-hidden"
                                    >
                                        {sortOptions.map(opt => (
                                            <button
                                                key={opt.id}
                                                onClick={() => {
                                                    setSort(opt.id as any);
                                                    setShowSortMenu(false);
                                                }}
                                                className={`w-full text-left px-4 py-2 text-xs flex items-center justify-between hover:bg-gray-100 dark:hover:bg-white/5 transition-colors ${sort === opt.id ? 'text-sage-600 dark:text-sage-400 font-bold bg-sage-50/50 dark:bg-sage-900/10' : 'text-gray-600 dark:text-gray-400'}`}
                                            >
                                                {opt.label}
                                                {sort === opt.id && <Check className="w-3 h-3" />}
                                            </button>
                                        ))}
                                    </motion.div>
                                </>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* List */}
                <div className="max-h-[350px] overflow-y-auto custom-scrollbar p-2">
                    {filtered.length > 0 ? (
                        <div className="grid grid-cols-1 gap-1">
                            {filtered.map(col => (
                                <button
                                    key={col.id}
                                    onClick={() => onAddImagesToCollection(selectedIds, col.id)}
                                    className="w-full group text-left px-4 py-3 rounded-xl hover:bg-sage-50 dark:hover:bg-sage-900/10 flex items-center justify-between transition-all border border-transparent hover:border-sage-200/50 dark:hover:border-sage-500/20"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`p-2 rounded-lg ${col.color ? '' : 'bg-gray-100 dark:bg-zinc-800 text-gray-400 group-hover:bg-sage-100 dark:group-hover:bg-sage-900/30 group-hover:text-sage-600'}`} style={col.color ? { backgroundColor: `${col.color}20`, color: col.color } : {}}>
                                            <Folder className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-sage-700 dark:group-hover:text-sage-300 transition-colors">{col.name}</div>
                                            <div className="text-[10px] text-gray-500 dark:text-gray-500 uppercase tracking-wider">{col.count ?? col.imageIds.length} images</div>
                                        </div>
                                    </div>
                                    <div className="opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0 transition-all text-sage-600">
                                        <Plus className="w-4 h-4" />
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="py-12 flex flex-col items-center justify-center text-gray-400">
                            <Folder className="w-12 h-12 mb-2 opacity-20" />
                            <p className="text-sm italic">No matching collections found</p>
                        </div>
                    )}
                </div>

                {/* Footer Tips */}
                <div className="px-6 py-3 bg-gray-50 dark:bg-white/[0.02] border-t border-gray-100 dark:border-white/5">
                    <p className="text-[10px] text-gray-400 text-center uppercase tracking-widest">Tip: You can also drag and drop images directly onto the sidebar</p>
                </div>
            </motion.div>
        </div>
    );
};
