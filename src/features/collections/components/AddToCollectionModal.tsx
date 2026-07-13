import * as React from 'react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Folder, ArrowUpDown, Check, X, Plus, Archive, Sparkles } from 'lucide-react';
import { Collection } from '../../../types';
import { SearchInput } from '../../filters/components/FilterPrimitives';
import { PrivacyAwareThumbnail } from '../../../components/ui/PrivacyAwareThumbnail';
import { CollectionThumbnailSkeleton } from '../../../components/ui/CollectionThumbnailSkeleton';
import { useCollectionStore } from '../../../stores/collectionStore';
import { TooltipButton } from '../../../components/ui/InfoTooltip';

interface AddToCollectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    collections: Collection[];
    smartCollections?: Collection[]; // It's actually SmartCollection[] but Collection works too
    selectedIds: string[];
    onConfirm: (ids: string[], targetColId: string, mode: 'add' | 'move', sourceColId?: string) => void;
    mode?: 'add' | 'move';
    sourceCollectionId?: string;
}

type CollectionSort = 'name_asc' | 'name_desc' | 'count_asc' | 'count_desc' | 'date_asc' | 'date_desc';

const getColorClass = (colorName?: string) => {
    if (!colorName) return '';
    switch (colorName) {
        case 'red': return 'bg-red-500';
        case 'orange': return 'bg-orange-500';
        case 'green': return 'bg-green-500';
        case 'blue': return 'bg-blue-500';
        case 'purple': return 'bg-purple-500';
        default: return '';
    }
};

export const AddToCollectionModal: React.FC<AddToCollectionModalProps> = ({
    isOpen,
    onClose,
    collections,
    smartCollections = [],
    selectedIds,
    onConfirm,
    mode = 'add',
    sourceCollectionId
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [sort, setSort] = useState<CollectionSort>('date_desc');
    const [showSortMenu, setShowSortMenu] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const closeButtonRef = React.useRef<HTMLButtonElement>(null);
    const thumbnailHydrationPendingIds = useCollectionStore(s => s.thumbnailHydrationPendingIds);
    const smartSummaryPendingIds = useCollectionStore(s => s.smartSummaryPendingIds);

    React.useEffect(() => {
        if (!isOpen) return;

        const previousFocus = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        closeButtonRef.current?.focus();

        return () => {
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [isOpen]);

    const allCollections = [...collections, ...smartCollections];

    const filtered = allCollections
        .filter(c => {
            const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesArchive = showArchived ? true : !c.isArchived;
            const isNotSource = c.id !== sourceCollectionId;
            return matchesSearch && matchesArchive && isNotSource;
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

    const sortOptions: Array<{ id: CollectionSort; label: string }> = [
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
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                            {mode === 'move' ? 'Move to Collection' : 'Add to Collection'}
                        </h3>
                        <p className="text-xs text-gray-500">{selectedIds.length} images selected</p>
                    </div>
                    <button ref={closeButtonRef} type="button" aria-label="Close Add to Collection" onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full transition-colors">
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
                        <TooltipButton
                            label="Sort Collections"
                            content="Sort Collections"
                            aria-expanded={showSortMenu}
                            onClick={() => setShowSortMenu(!showSortMenu)}
                            className={`p-2 rounded-lg border transition-all ${showSortMenu ? 'bg-sage-600 text-white border-sage-600' : 'bg-white dark:bg-zinc-800 border-gray-200 dark:border-white/10 text-gray-500'}`}
                        >
                            <ArrowUpDown className="w-4 h-4" />
                        </TooltipButton>

                        <TooltipButton
                            label={showArchived ? "Hide Archived Collections" : "Show Archived Collections"}
                            content={showArchived ? "Hide Archived Collections" : "Show Archived Collections"}
                            aria-pressed={showArchived}
                            onClick={() => setShowArchived(!showArchived)}
                            className={`p-2 rounded-lg border transition-all ${showArchived ? 'bg-sage-600 text-white border-sage-600' : 'bg-white dark:bg-zinc-800 border-gray-200 dark:border-white/10 text-gray-500'}`}
                        >
                            <Archive className="w-4 h-4" />
                        </TooltipButton>

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
                                                    setSort(opt.id);
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
                            {filtered.map(col => {
                                const showThumbnailSkeleton = (!!thumbnailHydrationPendingIds[col.id] || !!smartSummaryPendingIds[col.id]) && !col.thumbnail;

                                return (
                                    <button
                                        key={col.id}
                                        onClick={() => onConfirm(selectedIds, col.id, mode, sourceCollectionId)}
                                        className="w-full group text-left px-4 py-3 rounded-xl hover:bg-sage-50 dark:hover:bg-sage-900/10 flex items-center justify-between transition-all border border-transparent hover:border-sage-200/50 dark:hover:border-sage-500/20"
                                    >
                                        <div className="flex items-center gap-3">
                                            {col.thumbnail ? (
                                                <div className="w-10 h-10 flex-shrink-0 relative">
                                                    <PrivacyAwareThumbnail
                                                        src={col.thumbnail}
                                                        safeSrc={col.safeThumbnail}
                                                        alt=""
                                                        isSensitive={col.thumbnailIsSensitive}
                                                        wrapperClassName="w-full h-full rounded-lg"
                                                        imgClassName="w-full h-full object-cover shadow-sm border border-gray-200 dark:border-white/5"
                                                        fallback={col.filters ? <Sparkles className="w-5 h-5 text-sage-500 opacity-20" /> : <Folder className="w-5 h-5 opacity-20" />}
                                                    />
                                                    {col.color && (
                                                        <div
                                                            className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900 shadow-sm ${getColorClass(col.color)}`}
                                                        />
                                                    )}
                                                </div>
                                            ) : showThumbnailSkeleton ? (
                                                <div className="w-10 h-10 flex-shrink-0 relative">
                                                    <CollectionThumbnailSkeleton className="w-full h-full rounded-lg" />
                                                    {col.color && (
                                                        <div
                                                            className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900 shadow-sm ${getColorClass(col.color)}`}
                                                        />
                                                    )}
                                                </div>
                                            ) : (
                                                <div
                                                    data-testid="collection-thumbnail-fallback"
                                                    className={`w-10 h-10 rounded-lg flex items-center justify-center border border-gray-200 dark:border-white/5 flex-shrink-0 relative ${col.isArchived ? 'bg-sage-100/50 dark:bg-zinc-800/50' : 'bg-gray-100 dark:bg-zinc-800'}`}
                                                >
                                                    {col.isArchived ? <Archive className="w-5 h-5 text-gray-400" /> : (col.filters ? <Sparkles className="w-5 h-5 text-sage-500" /> : <Folder className="w-5 h-5 text-gray-400 dark:text-zinc-500" />)}
                                                    {col.color && (
                                                        <div
                                                            className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900 shadow-sm ${getColorClass(col.color)}`}
                                                        />
                                                    )}
                                                </div>
                                            )}
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-sage-700 dark:group-hover:text-sage-300 transition-colors">
                                                        {col.name}
                                                    </div>
                                                    {col.isArchived && (
                                                        <span className="text-[8px] bg-gray-200 dark:bg-white/10 text-gray-500 px-1 rounded uppercase tracking-tighter">Archived</span>
                                                    )}
                                                </div>
                                                <div className="text-[10px] text-gray-500 dark:text-gray-500 uppercase tracking-wider">{col.count ?? col.imageIds.length} images</div>
                                            </div>
                                        </div>
                                        <div className="opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0 transition-all text-sage-600">
                                            <Plus className="w-4 h-4" />
                                        </div>
                                    </button>
                                );
                            })}
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
