import { useState, useCallback } from 'react';
import { Search, Puzzle, Check, LayoutGrid, List as ListIcon, SortAsc, SortDesc, Clock, Calendar, ArrowDownWideNarrow, ArrowUpWideNarrow } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { FilterState } from '../../../types';
import { useSettings } from '../../../contexts/SettingsContext';
import { SectionHeader, SearchInput } from './FilterPrimitives';
import { formatCountCompact } from '../../../utils/formatUtils';

interface ResourceItem {
    name: string;
    count: number;
    lastUsedAt?: number;
    createdAt?: number;
    thumbnailPath?: string;
    previewUrl?: string;
    hash?: string;
}

interface ResourceSectionProps {
    title: string;
    /**
     * Resource type for filtering. Note: 'checkpoints' maps to FilterState.models
     * for historical reasons, but aligns with Facets.checkpoints for consistency.
     */
    type: 'loras' | 'embeddings' | 'hypernetworks' | 'checkpoints';
    filters: FilterState;
    setFilters: (update: (prev: FilterState) => FilterState) => void;
    data: ResourceItem[];
    isOpen: boolean;
    onToggle: () => void;
    isLoading?: boolean;
}

export const ResourceSection: React.FC<ResourceSectionProps> = ({
    title,
    type,
    filters,
    setFilters,
    data,
    isOpen,
    onToggle,
    isLoading
}) => {
    const { settings, setSettings } = useSettings();
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isSortOpen, setIsSortOpen] = useState(false);

    // Get view mode from settings, default to 'list'
    const viewMode = settings.resourceViewModes?.[type] || 'list';
    // Get sort option from settings, default to 'count_desc'
    const sortOption = settings.resourceSortOptions?.[type] || 'count_desc';

    const toggleViewMode = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const nextMode = viewMode === 'list' ? 'grid' : 'list';
        setSettings(prev => ({
            ...prev,
            resourceViewModes: {
                ...prev.resourceViewModes,
                [type]: nextMode
            }
        }));
    }, [type, viewMode, setSettings]);

    const setSortOption = useCallback((option: typeof sortOption) => {
        setSettings(prev => ({
            ...prev,
            resourceSortOptions: {
                ...prev.resourceSortOptions,
                [type]: option
            }
        }));
        setIsSortOpen(false);
    }, [type, setSettings]);

    // Map UI type to FilterState key (checkpoints uses 'models' in FilterState for historical reasons)
    const filterKey = type === 'checkpoints' ? 'models' : type;

    const toggleItem = (name: string) => {
        setFilters(prev => {
            const currentList = (prev[filterKey] as string[]) || [];
            const newList = currentList.includes(name)
                ? currentList.filter(l => l !== name)
                : [...currentList, name];
            return { ...prev, [filterKey]: newList };
        });
    };

    const filteredItems = (data || [])
        .filter(l =>
            l.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
            (l.count > 0 || (filters[filterKey] || []).includes(l.name))
        )
        .sort((a, b) => {
            switch (sortOption) {
                case 'count_desc': return b.count - a.count;
                case 'count_asc': return a.count - b.count;
                case 'name_asc': return a.name.localeCompare(b.name);
                case 'name_desc': return b.name.localeCompare(a.name);
                case 'recent_desc': return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
                case 'recent_asc': return (a.lastUsedAt || 0) - (b.lastUsedAt || 0);
                case 'added_desc': return (b.createdAt || 0) - (a.createdAt || 0);
                case 'added_asc': return (a.createdAt || 0) - (b.createdAt || 0);
                default: return b.count - a.count;
            }
        });

    const singularType = type === 'loras' ? 'LoRA' : type === 'embeddings' ? 'Embedding' : type === 'checkpoints' ? 'Checkpoint' : 'Hypernetwork';

    const renderGridItem = (item: ResourceItem) => {
        const isSelected = (filters[filterKey] || []).includes(item.name);
        const thumbUrl = item.thumbnailPath ? convertFileSrc(item.thumbnailPath) : item.previewUrl;

        return (
            <div
                key={`${item.name}-${item.hash || 'no-hash'}`}
                onClick={() => toggleItem(item.name)}
                className={`group relative aspect-square rounded-xl overflow-hidden cursor-pointer border transition-all duration-300 ease-spring ${isSelected
                    ? 'border-sage-500 ring-2 ring-sage-500/20 shadow-lg shadow-sage-500/10'
                    : 'border-gray-200 dark:border-white/10 hover:border-sage-400/50 hover:shadow-md'
                    }`}
            >
                {/* Thumbnail */}
                <div className={`absolute inset-0 bg-gray-100 dark:bg-zinc-800 transition-colors ${isSelected ? 'bg-sage-50 dark:bg-sage-900/10' : ''}`}>
                    {thumbUrl ? (
                        <img
                            src={thumbUrl}
                            alt={item.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center opacity-10">
                            <Puzzle className="w-8 h-8" />
                        </div>
                    )}
                </div>

                {/* Overlay Info */}
                <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                    <p className="text-[10px] font-medium text-white line-clamp-2 leading-tight drop-shadow-sm">
                        {item.name}
                    </p>
                </div>

                {/* Selection Indicator */}
                {isSelected && (
                    <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-sage-500 flex items-center justify-center shadow-sm animate-in zoom-in-50 duration-200">
                        <Check className="w-2.5 h-2.5 text-white" />
                    </div>
                )}

                {/* Count Badge */}
                <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/40 backdrop-blur-sm text-[9px] font-medium text-white/90">
                    {item.count}
                </div>
            </div>
        );
    };


    const renderListItem = (item: ResourceItem) => {
        const isSelected = (filters[filterKey] || []).includes(item.name);
        const thumbUrl = item.thumbnailPath ? convertFileSrc(item.thumbnailPath) : item.previewUrl;

        return (
            <div
                key={`${item.name}-${item.hash || 'no-hash'}`}
                onClick={() => toggleItem(item.name)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm transition-all ease-spring border group relative overflow-hidden ${isSelected
                    ? 'bg-gradient-to-r from-sage-100 to-transparent dark:from-sage-600/20 dark:to-transparent border-sage-200 dark:border-sage-500/30 text-sage-800 dark:text-sage-300 font-medium'
                    : 'bg-transparent border-transparent text-gray-500 dark:text-zinc-400 hover:bg-white/40 dark:hover:bg-white/5'
                    }`}
            >
                {/* Left Accent Bar */}
                {isSelected && (
                    <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-sage-500 rounded-full" />
                )}

                <div className="flex items-center gap-3 overflow-hidden">
                    {/* Tiny Avatar Thumbnail */}
                    <div className={`w-6 h-6 rounded bg-gray-100 dark:bg-white/10 flex-shrink-0 flex items-center justify-center overflow-hidden border ${isSelected ? 'border-sage-200 dark:border-sage-500/30' : 'border-transparent'}`}>
                        {thumbUrl ? (
                            <img
                                src={thumbUrl}
                                alt={item.name}
                                className="w-full h-full object-cover"
                                loading="lazy"
                            />
                        ) : (
                            <Puzzle className="w-3 h-3 opacity-30" />
                        )}
                    </div>

                    <span className="truncate" title={item.name}>{item.name}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded-md transition-opacity group-hover:opacity-100 opacity-60">
                        {formatCountCompact(item.count)}
                    </span>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-2">
            <SectionHeader
                title={title}
                isOpen={isOpen}
                onToggle={onToggle}
                isLoading={isLoading}
                action={isOpen && (
                    <div className="flex items-center gap-1">
                        {/* Sort Dropdown */}
                        <div className="relative">
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsSortOpen(!isSortOpen); }}
                                className={`p-1 rounded transition-colors ${isSortOpen ? 'text-sage-500 bg-sage-50 dark:bg-sage-900/30' : 'text-gray-400 hover:text-gray-600'}`}
                                title="Sort Options"
                            >
                                <ArrowDownWideNarrow className="w-3.5 h-3.5" />
                            </button>

                            {isSortOpen && (
                                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-zinc-800 border border-gray-100 dark:border-white/10 rounded-xl shadow-2xl z-50 p-1 animate-in zoom-in-95 duration-200">
                                    <div className="text-[9px] font-bold text-gray-400 dark:text-zinc-500 px-3 py-1.5 uppercase tracking-wider">Sort {singularType}s</div>

                                    <button onClick={(e) => { e.stopPropagation(); setSortOption('count_desc'); }} className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg ${sortOption === 'count_desc' ? 'bg-sage-50 dark:bg-sage-900/40 text-sage-700 dark:text-sage-300' : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                                        <div className="flex items-center gap-2 font-medium"><SortDesc className="w-3 h-3" /> Usage (High)</div>
                                        {sortOption === 'count_desc' && <Check className="w-3 h-3" />}
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); setSortOption('count_asc'); }} className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg ${sortOption === 'count_asc' ? 'bg-sage-50 dark:bg-sage-900/40 text-sage-700 dark:text-sage-300' : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                                        <div className="flex items-center gap-2 font-medium"><SortAsc className="w-3 h-3" /> Usage (Low)</div>
                                        {sortOption === 'count_asc' && <Check className="w-3 h-3" />}
                                    </button>

                                    <div className="h-px bg-gray-100 dark:bg-white/5 my-1 mx-1" />

                                    <button onClick={(e) => { e.stopPropagation(); setSortOption('name_asc'); }} className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg ${sortOption === 'name_asc' ? 'bg-sage-50 dark:bg-sage-900/40 text-sage-700 dark:text-sage-300' : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                                        <div className="flex items-center gap-2 font-medium"><ArrowUpWideNarrow className="w-3 h-3" /> Name (A-Z)</div>
                                        {sortOption === 'name_asc' && <Check className="w-3 h-3" />}
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); setSortOption('name_desc'); }} className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg ${sortOption === 'name_desc' ? 'bg-sage-50 dark:bg-sage-900/40 text-sage-700 dark:text-sage-300' : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                                        <div className="flex items-center gap-2 font-medium"><ArrowDownWideNarrow className="w-3 h-3" /> Name (Z-A)</div>
                                        {sortOption === 'name_desc' && <Check className="w-3 h-3" />}
                                    </button>

                                    <div className="h-px bg-gray-100 dark:bg-white/5 my-1 mx-1" />

                                    <button onClick={(e) => { e.stopPropagation(); setSortOption('recent_desc'); }} className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg ${sortOption === 'recent_desc' ? 'bg-sage-50 dark:bg-sage-900/40 text-sage-700 dark:text-sage-300' : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                                        <div className="flex items-center gap-2 font-medium"><Clock className="w-3 h-3" /> Recently Used</div>
                                        {sortOption === 'recent_desc' && <Check className="w-3 h-3" />}
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); setSortOption('added_desc'); }} className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg ${sortOption === 'added_desc' ? 'bg-sage-50 dark:bg-sage-900/40 text-sage-700 dark:text-sage-300' : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                                        <div className="flex items-center gap-2 font-medium"><Calendar className="w-3 h-3" /> Newest Added</div>
                                        {sortOption === 'added_desc' && <Check className="w-3 h-3" />}
                                    </button>
                                </div>
                            )}
                        </div>

                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const nextMode = viewMode === 'list' ? 'grid' : 'list';
                                setSettings(prev => ({
                                    ...prev,
                                    resourceViewModes: {
                                        ...prev.resourceViewModes,
                                        [type]: nextMode
                                    }
                                }));
                            }}
                            className={`p-1 rounded transition-colors ${viewMode === 'grid' ? 'text-sage-600 dark:text-sage-400 bg-sage-50 dark:bg-sage-900/30' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
                            title={viewMode === 'list' ? "Switch to Grid View" : "Switch to List View"}
                        >
                            {viewMode === 'list' ? <LayoutGrid className="w-3.5 h-3.5" /> : <ListIcon className="w-3.5 h-3.5" />}
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsSearchOpen(!isSearchOpen); }}
                            className={`p-1 rounded ${isSearchOpen ? 'text-sage-500' : 'text-gray-400 hover:text-gray-600'}`}
                            title={`Filter ${singularType}s`}
                        >
                            <Search className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
            />
            {isOpen && (
                <div className="space-y-3 animate-in slide-in-from-top-2 duration-300 ease-spring">
                    {isSearchOpen && (
                        <SearchInput
                            value={searchQuery}
                            onChange={setSearchQuery}
                            placeholder={`Search ${singularType}s...`}
                            className="px-1"
                        />
                    )}

                    <div className={`pr-1 ${viewMode === 'grid' ? 'grid grid-cols-3 gap-2' : 'space-y-1'}`}>
                        {filteredItems.map(item => viewMode === 'grid' ? renderGridItem(item) : renderListItem(item))}

                        {filteredItems.length === 0 && !isLoading && (
                            <div className={`${viewMode === 'grid' ? 'col-span-3' : ''} text-xs text-gray-400 text-center py-8 italic border border-dashed border-gray-200 dark:border-white/10 rounded-xl`}>
                                {data.length === 0 ? `No ${singularType}s found` : `No matching ${singularType}s`}
                            </div>
                        )}

                        {filteredItems.length === 0 && isLoading && (
                            <div className={`${viewMode === 'grid' ? 'col-span-3' : ''} flex flex-col items-center justify-center py-8 space-y-3 border border-dashed border-gray-200 dark:border-white/10 rounded-xl`}>
                                <div className="w-4 h-4 border-2 border-sage-500/30 border-t-sage-500 rounded-full animate-spin" />
                                <span className="text-[10px] text-gray-400 font-medium animate-pulse">Loading {singularType}s...</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
