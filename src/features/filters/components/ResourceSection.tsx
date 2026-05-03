import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Puzzle, Check, LayoutGrid, List as ListIcon, SortAsc, SortDesc, Clock, Calendar, ArrowDownWideNarrow, ArrowUpWideNarrow, Pin, Circle, CircleDot, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { FilterState } from '../../../types';
import { useSettings } from '../../../contexts/SettingsContext';
import { SectionHeader, SearchInput, SortDropdown } from './FilterPrimitives';
import { formatCountCompact, formatModelName } from '../../../utils/formatUtils';
import { useQueryClient } from '@tanstack/react-query';
import { PrivacyAwareThumbnail } from '../../../components/ui/PrivacyAwareThumbnail';
import { commands } from '../../../bindings';
import { uniqueAssetAliases } from '../../../utils/assetIdentity';

export type AssetScope = 'used' | 'local' | 'all';

type ResourceSectionType = 'loras' | 'embeddings' | 'hypernetworks' | 'checkpoints' | 'controlNets' | 'ipAdapters';
type ResourceFilterKey = 'models' | 'loras' | 'embeddings' | 'hypernetworks' | 'controlNets' | 'ipAdapters';

interface ResourceItem {
    name: string;
    count: number;
    lastUsedAt?: number;
    createdAt?: number;
    thumbnailPath?: string;
    previewUrl?: string;
    hash?: string;
    isManual?: number;
    hasSidecar?: number;
    isUserOverride?: number;
    safeThumbnailPath?: string;
    thumbnailImageId?: string;
    thumbnailIsSensitive?: number;
    thumbnailSensitivityOverride?: number | null;
    isLocalDisk?: boolean;
    assetMatchKey?: string;
    filterAliases?: string[];
}

interface ResourceSectionProps {
    title: string;
    /**
     * Resource type for filtering. Note: 'checkpoints' maps to FilterState.models
     * for historical reasons, but aligns with Facets.checkpoints for consistency.
     */
    type: ResourceSectionType;
    filters: FilterState;
    setFilters: (update: (prev: FilterState) => FilterState) => void;
    data: ResourceItem[];
    isOpen: boolean;
    onToggle: () => void;
    isLoading?: boolean;
    /**
     * Valid facet names for drill-down filtering.
     * - null: Show all items (no drill-down filtering active)
     * - string[]: Only show items in this list (+ always show selected items)
     */
    validNames?: string[] | null;
    assetScope?: AssetScope;
}

export const ResourceSection: React.FC<ResourceSectionProps> = ({
    title,
    type,
    filters,
    setFilters,
    data,
    isOpen,
    onToggle,
    isLoading,
    validNames,
    assetScope = 'used'
}) => {
    const { settings, setSettings } = useSettings();
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [renderLimit, setRenderLimit] = useState(30); // Pagination limit for performance

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
    }, [type, setSettings]);

    // Map UI type to FilterState key (checkpoints uses 'models' in FilterState for historical reasons)
    const filterKey: ResourceFilterKey = type === 'checkpoints' ? 'models' : type;
    const selectedNames = useMemo(() => new Set((filters[filterKey] || []) as string[]), [filters, filterKey]);
    const validNameSet = useMemo(() => validNames ? new Set(validNames) : null, [validNames]);

    const getItemAliases = useCallback((item: ResourceItem) => (
        uniqueAssetAliases([item.name, ...(item.filterAliases || [])])
    ), []);

    const isItemSelected = useCallback((item: ResourceItem) => (
        getItemAliases(item).some(alias => selectedNames.has(alias))
    ), [getItemAliases, selectedNames]);

    const toggleItem = (item: ResourceItem) => {
        if (item.count === 0 && item.isLocalDisk) return;
        setFilters(prev => {
            const currentList = (prev[filterKey] as string[]) || [];
            const itemAliases = getItemAliases(item);
            const itemAliasSet = new Set(itemAliases);
            const selected = currentList.some(value => itemAliasSet.has(value));
            const nextAliasGroups: NonNullable<FilterState['assetFilterAliases']> = {
                ...(prev.assetFilterAliases || {})
            };
            const aliasGroup = { ...(prev.assetFilterAliases?.[filterKey] || {}) };
            nextAliasGroups[filterKey] = aliasGroup;

            if (selected) {
                for (const alias of itemAliases) {
                    delete aliasGroup[alias];
                }
                return {
                    ...prev,
                    [filterKey]: currentList.filter(value => !itemAliasSet.has(value)),
                    assetFilterAliases: nextAliasGroups
                };
            }

            aliasGroup[item.name] = itemAliases;
            return {
                ...prev,
                [filterKey]: currentList.includes(item.name) ? currentList : [...currentList, item.name],
                assetFilterAliases: nextAliasGroups
            };
        });
    };

    const filteredItems = useMemo(() => (data || [])
        .filter(item => {
            const aliases = getItemAliases(item);
            const query = searchQuery.toLowerCase();
            if (!aliases.some(alias => alias.toLowerCase().includes(query))) return false;

            const isSelected = aliases.some(alias => selectedNames.has(alias));
            const isUnusedLocal = item.count === 0 && item.isLocalDisk;
            const isUsed = item.count > 0 || isSelected;

            if (assetScope === 'used' && !isUsed) return false;
            if (assetScope === 'local' && !item.isLocalDisk) return false;
            if (assetScope === 'all' && !isUsed && !item.isLocalDisk) return false;

            if (assetScope === 'used' && validNameSet) {
                if (!isSelected && !aliases.some(alias => validNameSet.has(alias))) return false;
            }

            return assetScope !== 'used' || !isUnusedLocal;
        })
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
        }), [assetScope, data, getItemAliases, searchQuery, selectedNames, sortOption, validNameSet]);

    const singularType = type === 'loras'
        ? 'LoRA'
        : type === 'embeddings'
            ? 'Embedding'
            : type === 'checkpoints'
                ? 'Checkpoint'
                : type === 'controlNets'
                    ? 'ControlNet'
                    : type === 'ipAdapters'
                        ? 'IP-Adapter'
                        : 'Hypernetwork';

    const visibleItems = filteredItems.slice(0, renderLimit);
    const hasMore = filteredItems.length > renderLimit;

    // Reset limit when query changes or type changes
    useEffect(() => {
        setRenderLimit(30);
    }, [searchQuery, type, filters]);

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: ResourceItem } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const queryClient = useQueryClient();

    const getBackendResourceType = useCallback(() => (
        type === 'checkpoints'
            ? 'checkpoint'
            : type === 'controlNets'
                ? 'control_nets'
                : type === 'ipAdapters'
                    ? 'ip_adapters'
                    : type
    ), [type]);

    const getFallbackHash = useCallback((item: ResourceItem) => {
        if (item.hash) return item.hash;
        switch (type as string) {
            case 'checkpoints':
                return `name:${item.name}`;
            case 'loras':
                return `lora_${item.name}`;
            case 'embeddings':
                return `emb_${item.name}`;
            case 'hypernetworks':
                return `hyper_${item.name}`;
            case 'controlNets':
                return `cnet_${item.name}`;
            case 'ipAdapters':
                return `ipad_${item.name}`;
            default:
                return item.name;
        }
    }, [type]);

    // Close menu on click outside
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setContextMenu(null);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const handleContextMenu = (e: React.MouseEvent, item: ResourceItem) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, item });
    };

    // "Use Sidecar / Reset" - clears user override, falls back to sidecar > dynamic
    const handleResetToSidecar = async (item: ResourceItem) => {
        if (!item.hash && !item.name) return;

        try {
            const result = await commands.unsetModelThumbnail(getFallbackHash(item), item.name, getBackendResourceType());
            if (result.status === 'error') throw new Error(result.error);
            await queryClient.invalidateQueries({ queryKey: ['libraryStats'] });
            setContextMenu(null);
        } catch (error) {
            console.error("Failed to reset thumbnail", error);
        }
    };

    // "Use Dynamic" - clears BOTH override and sidecar, forces dynamic selection
    const handleUseDynamic = async (item: ResourceItem) => {
        if (!item.hash && !item.name) return;

        try {
            const result = await commands.clearAllThumbnails(getFallbackHash(item), item.name, getBackendResourceType());
            if (result.status === 'error') throw new Error(result.error);
            await queryClient.invalidateQueries({ queryKey: ['libraryStats'] });
            setContextMenu(null);
        } catch (error) {
            console.error("Failed to clear all thumbnails", error);
        }
    };

    const handleThumbnailSensitivity = async (item: ResourceItem, sensitivity: boolean | null) => {
        if (!item.hash && !item.name) return;

        try {
            const result = await commands.setResourceThumbnailSensitivity(getFallbackHash(item), item.name, sensitivity, getBackendResourceType());
            if (result.status === 'error') throw new Error(result.error);
            await queryClient.invalidateQueries({ queryKey: ['libraryStats'] });
            setContextMenu(null);
        } catch (error) {
            console.error("Failed to update thumbnail privacy", error);
        }
    };

    const renderGridItem = (item: ResourceItem) => {
        const isSelected = isItemSelected(item);
        const isInventoryOnly = item.count === 0 && item.isLocalDisk;
        const thumbUrl = item.thumbnailPath || item.previewUrl;

        return (
            <div
                key={`${item.name}-${item.hash || 'no-hash'}`}
                onClick={() => toggleItem(item)}
                onContextMenu={(e) => handleContextMenu(e, item)}
                title={isInventoryOnly ? `${item.name} has no images in the library yet` : item.name}
                className={`group relative aspect-square rounded-xl overflow-hidden border transition-all duration-300 ease-spring ${isInventoryOnly ? 'cursor-default' : 'cursor-pointer'} ${isSelected
                    ? 'border-sage-500 ring-2 ring-sage-500/20 shadow-lg shadow-sage-500/10'
                    : 'border-gray-200 dark:border-white/10 hover:border-sage-400/50 hover:shadow-md'
                    }`}
            >
                {/* Thumbnail */}
                <div className={`absolute inset-0 bg-gray-100 dark:bg-zinc-800 transition-colors ${isSelected ? 'bg-sage-50 dark:bg-sage-900/10' : ''}`}>
                    {thumbUrl ? (
                        <PrivacyAwareThumbnail
                            src={thumbUrl}
                            safeSrc={item.safeThumbnailPath}
                            alt={item.name}
                            isSensitive={item.thumbnailIsSensitive === 1}
                            wrapperClassName="w-full h-full"
                            imgClassName="w-full h-full object-cover"
                            loading="lazy"
                            fallback={<Puzzle className="w-8 h-8 opacity-20" />}
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center opacity-10">
                            <Puzzle className="w-8 h-8" />
                        </div>
                    )}
                </div>

                {/* Overlay Info - Single Line Truncated */}
                <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                    <p className="text-[10px] font-medium text-white truncate leading-tight drop-shadow-sm">
                        {type === 'checkpoints' ? formatModelName(item.name) : item.name}
                    </p>
                </div>

                {/* Selection Indicator */}
                {isSelected && (
                    <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-sage-500 flex items-center justify-center shadow-sm animate-in zoom-in-50 duration-200">
                        <Check className="w-2.5 h-2.5 text-white" />
                    </div>
                )}

                {/* Count Badge - Hover Only for ALL items, always Top Right */}
                {!isSelected && (
                    <div className={`absolute top-1.5 right-1.5 transition-opacity z-10 ${isInventoryOnly ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        <div className={`px-1.5 py-0.5 rounded-md backdrop-blur-sm text-[9px] font-bold shadow-sm ${isInventoryOnly ? 'bg-blue-500/80 text-white' : 'bg-black/40 text-white/90'}`}>
                            {isInventoryOnly ? 'Unused' : formatCountCompact(item.count)}
                        </div>
                    </div>
                )}

                {item.isLocalDisk && !isInventoryOnly && (
                    <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-white/80 dark:bg-black/50 backdrop-blur-sm text-[9px] font-bold text-blue-700 dark:text-blue-200 shadow-sm">
                        Local
                    </div>
                )}

            </div>
        );
    };


    const renderListItem = (item: ResourceItem) => {
        const isSelected = isItemSelected(item);
        const isInventoryOnly = item.count === 0 && item.isLocalDisk;
        const thumbUrl = item.thumbnailPath || item.previewUrl;

        return (
            <div
                key={`${item.name}-${item.hash || 'no-hash'}`}
                onClick={() => toggleItem(item)}
                onContextMenu={(e) => handleContextMenu(e, item)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all ease-spring border group relative overflow-hidden ${isInventoryOnly ? 'cursor-default' : 'cursor-pointer'} ${isSelected
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
                    <div className={`w-6 h-6 rounded bg-gray-100 dark:bg-white/10 flex-shrink-0 flex items-center justify-center overflow-hidden border relative ${isSelected ? 'border-sage-200 dark:border-sage-500/30' : 'border-transparent'}`}>
                        {thumbUrl ? (
                            <PrivacyAwareThumbnail
                                src={thumbUrl}
                                safeSrc={item.safeThumbnailPath}
                                alt={item.name}
                                isSensitive={item.thumbnailIsSensitive === 1}
                                wrapperClassName="w-full h-full"
                                imgClassName="w-full h-full object-cover"
                                loading="lazy"
                                fallback={<Puzzle className="w-3 h-3 opacity-30" />}
                            />
                        ) : (
                            <Puzzle className="w-3 h-3 opacity-30" />
                        )}
                    </div>

                    <span className="truncate" title={item.name}>{type === 'checkpoints' ? formatModelName(item.name) : item.name}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-md transition-opacity group-hover:opacity-100 ${isInventoryOnly ? 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 opacity-100' : `bg-gray-100 dark:bg-white/10 ${validNames != null ? 'opacity-30' : 'opacity-60'}`}`}
                        title={isInventoryOnly ? 'Local asset with no matching images yet' : `${item.count.toLocaleString()} total images`}
                    >
                        {isInventoryOnly ? 'Unused' : formatCountCompact(item.count)}
                    </span>
                    {item.isLocalDisk && !isInventoryOnly && (
                        <span className="text-[9px] bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wide">
                            Local
                        </span>
                    )}
                </div>
            </div>
        );
    };

    const isAllMode = filters.matchModes?.[filterKey] === 'all';

    return (
        <div className="space-y-2">
            <SectionHeader
                title={title}
                isOpen={isOpen}
                onToggle={onToggle}
                isLoading={isLoading}
            />
            {isOpen && (
                <div className="space-y-3 animate-in slide-in-from-top-2 duration-300 ease-spring">
                    {/* Toolbar Row */}
                    <div className="flex items-center gap-1.5 px-2">
                        <SortDropdown
                            title={`Sort ${singularType}s`}
                            options={[
                                { id: 'count_desc', label: 'Usage (High)', icon: SortDesc },
                                { id: 'count_asc', label: 'Usage (Low)', icon: SortAsc },
                                { id: 'name_asc', label: 'Name (A-Z)', icon: ArrowUpWideNarrow },
                                { id: 'name_desc', label: 'Name (Z-A)', icon: ArrowDownWideNarrow },
                                { id: 'recent_desc', label: 'Recently Used', icon: Clock },
                                { id: 'added_desc', label: 'Newest Added', icon: Calendar },
                            ]}
                            currentValue={sortOption}
                            onSelect={(id) => setSortOption(id as any)}
                            align="left"
                            triggerClassName={(isOpen) => `transition-colors p-1.5 rounded-lg border ${isOpen ? 'text-sage-600 dark:text-sage-400 bg-sage-50 dark:bg-sage-900/40 border-sage-200 dark:border-sage-500/30' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/5'}`}
                        />
                        <button
                            onClick={toggleViewMode}
                            className={`transition-colors p-1.5 rounded-lg border ${viewMode === 'grid' ? 'text-sage-600 dark:text-sage-400 bg-sage-50 dark:bg-sage-900/40 border-sage-200 dark:border-sage-500/30' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/5'}`}
                            title={viewMode === 'list' ? "Switch to Grid View" : "Switch to List View"}
                        >
                            {viewMode === 'list' ? <LayoutGrid className="w-3.5 h-3.5" /> : <ListIcon className="w-3.5 h-3.5" />}
                        </button>
                        {/* Match Mode Toggle - Icon Only */}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const nextMode = isAllMode ? 'any' : 'all';
                                setFilters(prev => ({
                                    ...prev,
                                    matchModes: {
                                        ...prev.matchModes,
                                        [filterKey]: nextMode
                                    }
                                }));
                            }}
                            className={`transition-colors p-1.5 rounded-lg border ${isAllMode
                                ? 'text-sage-600 dark:text-sage-400 bg-sage-50 dark:bg-sage-900/40 border-sage-200 dark:border-sage-500/30'
                                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/5'}`}
                            title={isAllMode
                                ? "Match All: Show images that have EVERY selected item"
                                : "Match Any: Show images with AT LEAST ONE selected item"}
                        >
                            {isAllMode ? <CircleDot className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsSearchOpen(!isSearchOpen); if (isSearchOpen) setSearchQuery(''); }}
                            className={`transition-colors p-1.5 rounded-lg border ${isSearchOpen ? 'text-sage-600 dark:text-sage-400 bg-sage-50 dark:bg-sage-900/40 border-sage-200 dark:border-sage-500/30' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/5'}`}
                            title={`Search ${singularType}s`}
                        >
                            <Search className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    {isSearchOpen && (
                        <SearchInput
                            value={searchQuery}
                            onChange={setSearchQuery}
                            placeholder={`Search ${singularType}s...`}
                            className="px-1"
                        />
                    )}

                    <div className={`pr-1 ${viewMode === 'grid' ? 'grid grid-cols-3 gap-2' : 'space-y-1'}`}>
                        <AnimatePresence mode="popLayout" initial={false}>
                            {visibleItems.map(item => (
                                <motion.div
                                    key={`${item.name}-${item.hash || 'no-hash'}`}
                                    layout
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    transition={{
                                        layout: { duration: 0.2, ease: 'easeInOut' },
                                        opacity: { duration: 0.15 },
                                        scale: { duration: 0.15 }
                                    }}
                                >
                                    {viewMode === 'grid' ? renderGridItem(item) : renderListItem(item)}
                                </motion.div>
                            ))}
                        </AnimatePresence>

                        {hasMore && (
                            <button
                                onClick={() => setRenderLimit(prev => prev + 30)}
                                className={`w-full py-2 text-xs font-medium text-sage-600 dark:text-sage-400 bg-sage-50 dark:bg-sage-900/20 hover:bg-sage-100 dark:hover:bg-sage-900/40 rounded-lg transition-colors border border-sage-200 dark:border-sage-500/30 ${viewMode === 'grid' ? 'col-span-3' : ''}`}
                            >
                                Show More ({filteredItems.length - renderLimit} remaining)
                            </button>
                        )}

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
            {contextMenu && createPortal(
                <div
                    ref={menuRef}
                    className="fixed z-[100] w-56 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    <div className="p-1">
                        <div className="px-2 py-1.5 text-xs font-medium text-gray-500 dark:text-zinc-500 border-b border-gray-100 dark:border-white/5 mb-1 truncate">
                            {type === 'checkpoints' ? formatModelName(contextMenu.item.name) : contextMenu.item.name}
                        </div>
                        {/* Use Preview - enabled if User Override OR (In Dynamic AND Sidecar available) */}
                        <button
                            onClick={() => handleResetToSidecar(contextMenu.item)}
                            disabled={!contextMenu.item.isUserOverride && !(!contextMenu.item.isManual && contextMenu.item.hasSidecar)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-md transition-colors ${(contextMenu.item.isUserOverride || (!contextMenu.item.isManual && contextMenu.item.hasSidecar))
                                ? 'text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-white/10'
                                : 'text-gray-400 cursor-not-allowed opacity-50'
                                }`}
                            title={contextMenu.item.isUserOverride ? "Clear user override" : "Use sidecar preview"}
                        >
                            <Puzzle className="w-3.5 h-3.5" />
                            Use Preview
                        </button>
                        {/* Use Dynamic - disabled if already in dynamic mode (isManual = 0) */}
                        <button
                            onClick={() => handleUseDynamic(contextMenu.item)}
                            disabled={!contextMenu.item.isManual}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-md transition-colors ${contextMenu.item.isManual
                                ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                                : 'text-gray-400 cursor-not-allowed opacity-50'
                                }`}
                            title="Clear sidecar and override, use pinned/recent image"
                        >
                            <Pin className="w-3.5 h-3.5" />
                            Use Dynamic
                        </button>
                        <div className="h-px bg-gray-100 dark:bg-white/5 my-1" />
                        <button
                            onClick={() => handleThumbnailSensitivity(contextMenu.item, true)}
                            disabled={contextMenu.item.thumbnailSensitivityOverride === 1}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-md transition-colors ${contextMenu.item.thumbnailSensitivityOverride === 1
                                ? 'text-gray-400 cursor-not-allowed opacity-50'
                                : 'text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-white/10'
                                }`}
                            title="Always mask this resource thumbnail"
                        >
                            <EyeOff className="w-3.5 h-3.5" />
                            Mask Thumbnail
                        </button>
                        <button
                            onClick={() => handleThumbnailSensitivity(contextMenu.item, false)}
                            disabled={contextMenu.item.thumbnailSensitivityOverride === 0}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-md transition-colors ${contextMenu.item.thumbnailSensitivityOverride === 0
                                ? 'text-gray-400 cursor-not-allowed opacity-50'
                                : 'text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-white/10'
                                }`}
                            title="Always show this resource thumbnail"
                        >
                            <Eye className="w-3.5 h-3.5" />
                            Always Show Thumbnail
                        </button>
                        <button
                            onClick={() => handleThumbnailSensitivity(contextMenu.item, null)}
                            disabled={contextMenu.item.thumbnailSensitivityOverride === null || contextMenu.item.thumbnailSensitivityOverride === undefined}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-md transition-colors ${contextMenu.item.thumbnailSensitivityOverride === null || contextMenu.item.thumbnailSensitivityOverride === undefined
                                ? 'text-gray-400 cursor-not-allowed opacity-50'
                                : 'text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-white/10'
                                }`}
                            title="Return thumbnail privacy to automatic detection"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Reset Thumbnail Privacy
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};
