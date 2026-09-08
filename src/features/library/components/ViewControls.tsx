import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { LayoutGrid, Columns, AlignJustify, Play, ArrowUpDown, Check, Sliders, Eye } from 'lucide-react';
import { LayoutMode, SortOption } from '../../../types';
import { useSearch } from '../../../contexts/SearchContext';
import { TooltipButton } from '../../../components/ui/InfoTooltip';
import { useDelayedBusyPresentation } from '../../../hooks/useDelayedBusyPresentation';

const COUNT_LOADING_REVEAL_DELAY_MS = 180;
const COUNT_LOADING_MIN_VISIBLE_MS = 300;

interface CountPresentation {
    displayedCount: number;
    totalCount: number | null;
    scopeName: string;
    ownerPresentationKey: string;
}

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
    totalCount: number | null;
    scopeName: string;
    ownerPresentationKey?: string;
    isFiltering?: boolean;
    showSortButton?: boolean;
}

const SORT_OPTIONS: Array<{ val: SortOption; label: string }> = [
    { val: 'date_desc', label: 'Newest' },
    { val: 'date_asc', label: 'Oldest' },
    { val: 'name_asc', label: 'Name (A-Z)' },
    { val: 'name_desc', label: 'Name (Z-A)' },
    { val: 'size_desc', label: 'Largest (Size)' },
    { val: 'size_asc', label: 'Smallest (Size)' },
];

const sortLabel = (sortOption: SortOption) => SORT_OPTIONS.find(option => option.val === sortOption)?.label ?? 'Sort';

export const SortOptionList = ({
    sortOption,
    onSelect,
    compact = false,
}: {
    sortOption: SortOption;
    onSelect: (option: SortOption) => void;
    compact?: boolean;
}) => (
    <>
        {SORT_OPTIONS.map(option => (
            <button key={option.val} type="button" onClick={() => onSelect(option.val)} className={compact
                ? `rounded-lg px-2 py-1.5 text-left text-[10px] ${sortOption === option.val ? 'bg-sage-500/15 text-sage-700 dark:text-sage-200' : 'text-gray-600 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-white/5'}`
                : `w-full text-left px-3 py-2 text-xs transition-colors flex justify-between items-center ${sortOption === option.val ? 'bg-sage-50 text-sage-600 dark:bg-sage-900/40 dark:text-sage-300' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'}`
            }>
                {option.label}
                {!compact && sortOption === option.val && <Check className="w-3 h-3" />}
            </button>
        ))}
    </>
);

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
    isFiltering,
    ownerPresentationKey = 'invoke:none',
    showSortButton = true,
}) => {
    const { availableHiddenContent, filters, setFilters } = useSearch();
    const [showSortMenu, setShowSortMenu] = useState(false);
    const [showViewMenu, setShowViewMenu] = useState(false);
    const sortMenuRef = useRef<HTMLDivElement>(null);
    const viewMenuRef = useRef<HTMLDivElement>(null);
    const sortTriggerRef = useRef<HTMLButtonElement>(null);
    const viewTriggerRef = useRef<HTMLButtonElement>(null);
    const settledCountPresentationRef = useRef<CountPresentation | null>(
        isFiltering ? null : { displayedCount, totalCount, scopeName, ownerPresentationKey }
    );
    const isCountLoadingVisible = useDelayedBusyPresentation(Boolean(isFiltering), {
        revealDelayMs: COUNT_LOADING_REVEAL_DELAY_MS,
        minimumVisibleMs: COUNT_LOADING_MIN_VISIBLE_MS,
    });

    React.useLayoutEffect(() => {
        if (isFiltering) return;
        settledCountPresentationRef.current = { displayedCount, totalCount, scopeName, ownerPresentationKey };
    }, [displayedCount, isFiltering, ownerPresentationKey, scopeName, totalCount]);

    const showCountLoading = isCountLoadingVisible;
    const settledCountPresentation = settledCountPresentationRef.current;
    const hasSettledCurrentOwnerScope = settledCountPresentation?.ownerPresentationKey === ownerPresentationKey;
    const isAwaitingFirstSettledCount = Boolean(isFiltering) && !showCountLoading && !hasSettledCurrentOwnerScope;
    const countPresentation = isFiltering && !showCountLoading && hasSettledCurrentOwnerScope
        ? settledCountPresentation!
        : { displayedCount, totalCount, scopeName, ownerPresentationKey };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (sortMenuRef.current && !sortMenuRef.current.contains(event.target as Node)) setShowSortMenu(false);
            if (viewMenuRef.current && !viewMenuRef.current.contains(event.target as Node)) setShowViewMenu(false);
        };

        document.addEventListener('mousedown', handleClickOutside);
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (showSortMenu) {
                setShowSortMenu(false);
                sortTriggerRef.current?.focus();
            } else if (showViewMenu) {
                setShowViewMenu(false);
                viewTriggerRef.current?.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [showSortMenu, showViewMenu]);

    const selectSort = (option: SortOption) => {
        setSortOption(option);
        setShowSortMenu(false);
        setShowViewMenu(false);
    };
    const hasHiddenContentControls = availableHiddenContent.hasIntermediates
        || availableHiddenContent.hasGrids
        || availableHiddenContent.hasInvokeImageAssets;

    return (
        <div className="flex shrink-0 items-center gap-3">
            {showSortButton && (
                <div className="relative" ref={sortMenuRef}>
                    <button ref={sortTriggerRef} type="button" aria-expanded={showSortMenu} onClick={() => setShowSortMenu(open => !open)} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-zinc-800/50 rounded-xl border border-gray-200 dark:border-white/5 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
                        <ArrowUpDown className="w-3 h-3 text-gray-500" />
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{sortLabel(sortOption)}</span>
                    </button>
                    {showSortMenu && (
                        <div className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl z-[100] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                            <SortOptionList sortOption={sortOption} onSelect={selectSort} />
                        </div>
                    )}
                </div>
            )}

            <div className="relative" ref={viewMenuRef}>
                <button ref={viewTriggerRef} type="button" aria-expanded={showViewMenu} onClick={() => setShowViewMenu(open => !open)} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-colors ${showViewMenu ? 'bg-sage-600 border-sage-500 text-white' : 'bg-gray-100 dark:bg-zinc-800/50 border-gray-200 dark:border-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300'}`} title="View Options">
                    <Eye className="w-3 h-3" />
                    <span className="text-xs font-medium">View</span>
                </button>
                {showViewMenu && (
                    <div className="absolute top-full right-0 mt-2 w-64 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl z-[100] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="border-b border-gray-100 p-2 dark:border-white/5">
                                <span className="px-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">Layout</span>
                                <div className="mt-1 flex items-center gap-1 px-1">
                                    {showLayoutSwitcher && (
                                        <>
                                            <TooltipButton label="Use Grid Layout" content="Use Grid Layout" aria-pressed={layoutMode === 'grid'} onClick={() => setLayoutMode('grid')} className={`p-1.5 rounded-lg transition-all ${layoutMode === 'grid' ? 'bg-white dark:bg-white/10 text-sage-600 dark:text-sage-300 shadow-sm' : 'text-gray-400'}`}><LayoutGrid className="w-4 h-4" /></TooltipButton>
                                            <TooltipButton label="Use Masonry Layout" content="Use Masonry Layout" aria-pressed={layoutMode === 'masonry'} onClick={() => setLayoutMode('masonry')} className={`p-1.5 rounded-lg transition-all ${layoutMode === 'masonry' ? 'bg-white dark:bg-white/10 text-sage-600 dark:text-sage-300 shadow-sm' : 'text-gray-400'}`}><Columns className="w-4 h-4" /></TooltipButton>
                                            <TooltipButton label="Use Justified Layout" content="Use Justified Layout" aria-pressed={layoutMode === 'justified'} onClick={() => setLayoutMode('justified')} className={`p-1.5 rounded-lg transition-all ${layoutMode === 'justified' ? 'bg-white dark:bg-white/10 text-sage-600 dark:text-sage-300 shadow-sm' : 'text-gray-400'}`}><AlignJustify className="w-4 h-4" /></TooltipButton>
                                        </>
                                    )}
                                    {showSlideshowButton && <TooltipButton label="Play Slideshow" content="Play Slideshow" onClick={onSlideshow} className="p-1.5 rounded-lg text-gray-500 hover:text-sage-600"><Play className="w-4 h-4 fill-current" /></TooltipButton>}
                                </div>
                                <label className="mt-3 flex items-center gap-2 px-1 text-xs text-gray-500">
                                    <Sliders className="w-3 h-3" />
                                    <span className="sr-only">Thumbnail Size</span>
                                    <input aria-label="Thumbnail Size" type="range" min="100" max="400" value={thumbnailSize} onChange={event => setThumbnailSize(Number(event.target.value))} className="h-1 w-32 cursor-pointer appearance-none rounded-lg bg-gray-300 accent-sage-500 dark:bg-slate-700" />
                                </label>
                        </div>
                        {hasHiddenContentControls && (
                            <div>
                                <div className="border-b border-gray-100 bg-gray-50/50 p-2 dark:border-white/5 dark:bg-black/20"><span className="pl-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">Display</span></div>
                                {availableHiddenContent.hasInvokeImageAssets && <HiddenContentToggle label="Show InvokeAI Image Assets" description="Reference, control, mask, and source images" enabled={Boolean(filters.showInvokeImageAssets)} onClick={() => setFilters(previous => ({ ...previous, showInvokeImageAssets: !previous.showInvokeImageAssets }))} />}
                                {availableHiddenContent.hasIntermediates && <HiddenContentToggle label="Show Intermediates" description="Ephemeral generation steps" enabled={Boolean(filters.showIntermediates)} onClick={() => setFilters(previous => ({ ...previous, showIntermediates: !previous.showIntermediates }))} />}
                                {availableHiddenContent.hasGrids && <HiddenContentToggle label="Show Image Grids" description="Combined previews (SD WebUI)" enabled={Boolean(filters.showGrids)} onClick={() => setFilters(previous => ({ ...previous, showGrids: !previous.showGrids }))} />}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className={`flex min-w-[3rem] items-center justify-end text-[10px] font-bold tracking-widest tabular-nums text-gray-400 transition-opacity duration-200 dark:text-gray-500 ${showCountLoading ? 'opacity-50' : 'opacity-100'}`}>
                {isAwaitingFirstSettledCount ? <span aria-hidden>&nbsp;</span> : showCountLoading ? <span aria-label={`Loading ${scopeName}`} className="text-gray-600 dark:text-gray-300">...<span className="sr-only" title={`LOADING ${scopeName}`}>{`LOADING ${scopeName}`}</span></span> : countPresentation.displayedCount !== countPresentation.totalCount ? (
                    <span aria-label={`${countPresentation.displayedCount.toLocaleString()} matches in ${countPresentation.scopeName}; ${countPresentation.totalCount === null ? 'collection total not available' : `${countPresentation.totalCount.toLocaleString()} total`}`}>
                        <span className="text-sage-600 dark:text-sage-400">{countPresentation.displayedCount.toLocaleString()}</span><span className="px-1 opacity-40">/</span><span className="text-gray-600 dark:text-gray-300" aria-label={countPresentation.totalCount === null ? 'Collection total not available' : undefined} title={countPresentation.totalCount === null ? 'Collection total not available' : undefined}>{countPresentation.totalCount?.toLocaleString() ?? '—'}</span>
                        <span className="sr-only text-[10px] text-gray-500 dark:text-gray-400 normal-case tracking-normal max-w-[40ch] truncate" title={`MATCHES IN ${countPresentation.scopeName}`}>{`MATCHES IN ${countPresentation.scopeName}`}</span>
                    </span>
                ) : (
                    <span aria-label={`${countPresentation.totalCount?.toLocaleString() ?? 'collection total not available'} in ${countPresentation.scopeName}`} className="text-gray-600 dark:text-gray-300">{countPresentation.totalCount?.toLocaleString() ?? '—'}<span className="sr-only text-[10px] text-gray-500 dark:text-gray-400 normal-case tracking-normal max-w-[40ch] truncate" title={countPresentation.scopeName}>{countPresentation.scopeName}</span></span>
                )}
            </div>
        </div>
    );
};

const HiddenContentToggle = ({ label, description, enabled, onClick }: { label: string; description: string; enabled: boolean; onClick: () => void }) => (
    <button type="button" aria-pressed={enabled} onClick={onClick} className="group flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-xs transition-colors hover:bg-gray-100 dark:hover:bg-white/5">
        <span className="flex min-w-0 flex-col"><span className="font-medium text-gray-700 dark:text-gray-200">{label}</span><span className="text-[9px] text-gray-400">{description}</span></span>
        <span className={`relative flex h-4 w-8 shrink-0 items-center rounded-full transition-colors ${enabled ? 'bg-sage-600' : 'bg-gray-300 dark:bg-zinc-700'}`}><span className={`absolute h-3 w-3 rounded-full bg-white transition-all ${enabled ? 'right-0.5' : 'left-0.5'}`} /></span>
    </button>
);
