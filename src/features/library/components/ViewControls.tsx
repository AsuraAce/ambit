import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { LayoutGrid, Columns, AlignJustify, Play, ArrowUpDown, Check, Sliders, Eye } from 'lucide-react';
import { LayoutMode, SortOption } from '../../../types';
import { useSearch } from '../../../contexts/SearchContext';

interface ViewControlsProps {
    showLayoutSwitcher: boolean;
    layoutMode: LayoutMode;
    setLayoutMode: (mode: LayoutMode) => void;
    showSlideshowButton: boolean;
    onSlideshow: () => void;
    sortOption: SortOption;
    setSortOption: (opt: SortOption) => void;
    thumbnailSize: number;
    setThumbnailSize: (size: number) => void;
    displayedCount: number;
    totalCount: number;
    scopeName: string;
    isFiltering?: boolean;
}

export const ViewControls: React.FC<ViewControlsProps> = ({
    showLayoutSwitcher,
    layoutMode,
    setLayoutMode,
    showSlideshowButton,
    onSlideshow,
    sortOption,
    setSortOption,
    thumbnailSize,
    setThumbnailSize,
    displayedCount,
    totalCount,
    scopeName,
    isFiltering
}) => {
    const { filters, setFilters, availableHiddenContent } = useSearch();
    const [showSortMenu, setShowSortMenu] = useState(false);
    const [showViewMenu, setShowViewMenu] = useState(false);

    const sortMenuRef = useRef<HTMLDivElement>(null);
    const viewMenuRef = useRef<HTMLDivElement>(null);

    // Click outside listener
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (sortMenuRef.current && !sortMenuRef.current.contains(event.target as Node)) {
                setShowSortMenu(false);
            }
            if (viewMenuRef.current && !viewMenuRef.current.contains(event.target as Node)) {
                setShowViewMenu(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="flex items-center gap-4">
            {showLayoutSwitcher && (
                <div className="flex bg-gray-100 dark:bg-zinc-800/50 rounded-xl p-1 border border-gray-200 dark:border-white/5">
                    <button
                        onClick={() => setLayoutMode('grid')}
                        className={`p-1.5 rounded-lg transition-all ${layoutMode === 'grid' ? 'bg-white dark:bg-white/10 text-sage-600 dark:text-sage-300 shadow-sm' : 'text-gray-400'}`}
                        title="Grid Layout"
                    >
                        <LayoutGrid className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setLayoutMode('masonry')}
                        className={`p-1.5 rounded-lg transition-all ${layoutMode === 'masonry' ? 'bg-white dark:bg-white/10 text-sage-600 dark:text-sage-300 shadow-sm' : 'text-gray-400'}`}
                        title="Masonry Layout"
                    >
                        <Columns className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setLayoutMode('justified')}
                        className={`p-1.5 rounded-lg transition-all ${layoutMode === 'justified' ? 'bg-white dark:bg-white/10 text-sage-600 dark:text-sage-300 shadow-sm' : 'text-gray-400'}`}
                        title="Justified Layout"
                    >
                        <AlignJustify className="w-4 h-4" />
                    </button>
                </div>
            )}

            {showSlideshowButton && (
                <button
                    onClick={onSlideshow}
                    className="p-2 rounded-xl bg-gray-100 dark:bg-zinc-800/50 border border-gray-200 dark:border-white/5 text-gray-500 hover:text-sage-600 transition-colors"
                    title="Play Slideshow"
                >
                    <Play className="w-4 h-4 fill-current" />
                </button>
            )}

            {(showLayoutSwitcher || showSlideshowButton) && (
                <div className="h-6 w-px bg-gray-300 dark:bg-white/10 mx-2" />
            )}

            <div className="relative" ref={sortMenuRef}>
                <button
                    onClick={() => setShowSortMenu(!showSortMenu)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-zinc-800/50 rounded-xl border border-gray-200 dark:border-white/5 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                >
                    <ArrowUpDown className="w-3 h-3 text-gray-500" />
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        {{
                            'date_desc': 'Newest',
                            'date_asc': 'Oldest',
                            'name_asc': 'Name (A-Z)',
                            'name_desc': 'Name (Z-A)',
                            'size_desc': 'Largest (Size)',
                            'size_asc': 'Smallest (Size)'
                        }[sortOption] || 'Sort'}
                    </span>
                </button>
                {showSortMenu && (
                    <div
                        className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
                        onClick={() => setShowSortMenu(false)}
                    >
                        {[
                            { val: 'date_desc', label: 'Newest' },
                            { val: 'date_asc', label: 'Oldest' },
                            { val: 'name_asc', label: 'Name (A-Z)' },
                            { val: 'name_desc', label: 'Name (Z-A)' },
                            { val: 'size_desc', label: 'Largest (Size)' },
                            { val: 'size_asc', label: 'Smallest (Size)' }
                        ].map(opt => (
                            <button
                                key={opt.val}
                                onClick={() => setSortOption(opt.val as SortOption)}
                                className={`w-full text-left px-3 py-2 text-xs transition-colors flex justify-between items-center ${sortOption === opt.val ? 'bg-sage-50 text-sage-600 dark:bg-sage-900/40 dark:text-sage-300' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'}`}
                            >
                                {opt.label}
                                {sortOption === opt.val && <Check className="w-3 h-3" />}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* View Options Menu */}
            {(availableHiddenContent.hasIntermediates || availableHiddenContent.hasGrids) && (
                <div className="relative" ref={viewMenuRef}>
                    <button
                        onClick={() => setShowViewMenu(!showViewMenu)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-colors ${showViewMenu ? 'bg-sage-600 border-sage-500 text-white' : 'bg-gray-100 dark:bg-zinc-800/50 border-gray-200 dark:border-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300'}`}
                        title="View Options"
                    >
                        <Eye className="w-3 h-3" />
                        <span className="text-xs font-medium">View</span>
                    </button>
                    {showViewMenu && (
                        <div
                            className="absolute top-full right-0 mt-2 w-56 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
                        >
                            <div className="p-2 border-b border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-black/20">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-2">Display</span>
                            </div>

                            {availableHiddenContent.hasIntermediates && (
                                <button
                                    onClick={() => {
                                        setFilters(prev => ({ ...prev, showIntermediates: !prev.showIntermediates }));
                                    }}
                                    className="w-full text-left px-3 py-2.5 text-xs transition-colors flex justify-between items-center group hover:bg-gray-100 dark:hover:bg-white/5"
                                >
                                    <div className="flex flex-col">
                                        <span className="font-medium text-gray-700 dark:text-gray-200">Show Intermediates</span>
                                        <span className="text-[9px] text-gray-400">Ephemeral generation steps</span>
                                    </div>
                                    <div className={`w-8 h-4 rounded-full transition-colors relative flex items-center ${filters.showIntermediates ? 'bg-sage-600' : 'bg-gray-300 dark:bg-zinc-700'}`}>
                                        <div className={`absolute w-3 h-3 bg-white rounded-full transition-all ${filters.showIntermediates ? 'right-0.5' : 'left-0.5'}`} />
                                    </div>
                                </button>
                            )}

                            {availableHiddenContent.hasGrids && (
                                <button
                                    onClick={() => {
                                        setFilters(prev => ({ ...prev, showGrids: !prev.showGrids }));
                                    }}
                                    className="w-full text-left px-3 py-2.5 text-xs transition-colors flex justify-between items-center group hover:bg-gray-100 dark:hover:bg-white/5"
                                >
                                    <div className="flex flex-col">
                                        <span className="font-medium text-gray-700 dark:text-gray-200">Show Image Grids</span>
                                        <span className="text-[9px] text-gray-400">Combined previews (SD WebUI)</span>
                                    </div>
                                    <div className={`w-8 h-4 rounded-full transition-colors relative flex items-center ${filters.showGrids ? 'bg-sage-600' : 'bg-gray-300 dark:bg-zinc-700'}`}>
                                        <div className={`absolute w-3 h-3 bg-white rounded-full transition-all ${filters.showGrids ? 'right-0.5' : 'left-0.5'}`} />
                                    </div>
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            <div className="flex items-center gap-2 text-gray-500 ml-2">
                <Sliders className="w-3 h-3" />
                <input
                    type="range"
                    min="100"
                    max="400"
                    value={thumbnailSize}
                    onChange={(e) => setThumbnailSize(Number(e.target.value))}
                    className="w-20 h-1 bg-gray-300 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sage-500"
                />
            </div>

            <div className="h-6 w-px bg-gray-300 dark:bg-white/10 mx-2" />

            <div className={`text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest tabular-nums text-right flex flex-col items-end leading-tight min-w-[120px] transition-opacity duration-200 ${isFiltering ? 'opacity-50' : 'opacity-100'}`}>
                {displayedCount !== totalCount ? (
                    <>
                        <div className="flex items-center gap-1">
                            <span className="text-sage-600 dark:text-sage-400">{(isFiltering && displayedCount === 0) ? '...' : displayedCount.toLocaleString()}</span>
                            <span className="opacity-40">/</span>
                            <span className="text-gray-600 dark:text-gray-300">{(isFiltering && totalCount === 0) ? '...' : totalCount.toLocaleString()}</span>
                        </div>
                        <span className="text-[8px] opacity-60">{(isFiltering) ? 'SEARCHING...' : `MATCHES IN ${scopeName}`}</span>
                    </>
                ) : (
                    <>
                        <span className="text-gray-600 dark:text-gray-300">{(isFiltering && totalCount === 0) ? '...' : totalCount.toLocaleString()}</span>
                        <span className="text-[8px] opacity-60">{(isFiltering) ? 'LOADING...' : `TOTAL ${scopeName}`}</span>
                    </>
                )}
            </div>
        </div>
    );
};
