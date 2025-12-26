import * as React from 'react';
import { useState } from 'react';
import { AIImage } from '../types';
import { AlertTriangle, Check, Copy, EyeOff, Eye, Clock, Zap } from 'lucide-react';
import { useDuplicateFinder, DuplicateGroup } from '../hooks/useDuplicateFinder';
import { isImageMasked } from '../utils/maskingUtils';
import { VirtualGrid } from './VirtualGrid';

// --- Sub-Component for Individual Duplicate Image in a Group ---
const DuplicateItem: React.FC<{
    img: AIImage;
    onKeepOnly: (imgId: string) => void;
    privacyEnabled: boolean;
    maskedKeywords: string[];
    isNewest?: boolean;
}> = ({ img, onKeepOnly, privacyEnabled, maskedKeywords, isNewest }) => {
    const [isRevealed, setRevealed] = useState(false);
    const isMasked = !isRevealed && isImageMasked(img, privacyEnabled, maskedKeywords);

    return (
        <div className="group relative flex flex-col min-w-[160px] w-[calc(50%-0.5rem)] flex-shrink-0" onMouseLeave={() => isRevealed && setRevealed(false)}>
            {/* Image Preview */}
            <div className="relative aspect-[2/3] bg-gray-100 dark:bg-slate-950 rounded-lg overflow-hidden border border-gray-200 dark:border-white/10 group-hover:border-sage-500/50 transition-colors">
                <img
                    src={img.thumbnailUrl}
                    alt=""
                    className={`w-full h-full object-cover transition-all ${isMasked ? 'blur-xl scale-110' : ''}`}
                />

                {isMasked && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100/50 dark:bg-slate-950/20 backdrop-blur-sm z-10">
                        <EyeOff className="w-8 h-8 text-gray-500 dark:text-gray-400 drop-shadow-md mb-2" />
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setRevealed(true);
                            }}
                            className="px-3 py-1 bg-black/50 hover:bg-black/70 text-white text-[10px] font-bold uppercase tracking-wider rounded-full backdrop-blur-md transition-colors flex items-center gap-1"
                        >
                            <Eye className="w-3 h-3" /> Reveal
                        </button>
                    </div>
                )}

                {/* Badges Overlay */}
                <div className="absolute top-2 left-2 right-2 flex justify-between items-start pointer-events-none z-20">
                    <div className="flex flex-col gap-1">
                        {isNewest && (
                            <div className="bg-sage-500 text-white text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded shadow-lg flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5" />
                                Newest
                            </div>
                        )}
                    </div>
                    <div className="bg-black/60 backdrop-blur-md text-[10px] font-mono text-white px-2 py-0.5 rounded border border-white/10 shadow-sm">
                        {img.width}x{img.height}
                    </div>
                </div>

                {/* Overlay Actions (Only show if UNMASKED) */}
                {!isMasked && (
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 backdrop-blur-[1px] z-30">
                        <button
                            onClick={() => onKeepOnly(img.id)}
                            className="px-4 py-2 bg-sage-600 hover:bg-sage-500 text-white rounded-full font-bold text-xs shadow-lg transform hover:scale-105 transition-all flex items-center gap-2"
                        >
                            <Check className="w-3 h-3" /> Keep Only This
                        </button>
                    </div>
                )}
            </div>

            {/* Metadata Details */}
            <div className="mt-2 px-1">
                <div className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate" title={img.filename}>
                    {img.filename}
                </div>
                <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 flex justify-between">
                    <span>{new Date(img.timestamp).toLocaleDateString()}</span>
                </div>
            </div>
        </div>
    );
};

// --- Sub-Component for a Single Group Card (Memoized for Virtualization) ---
const DuplicateGroupCard: React.FC<{
    group: DuplicateGroup;
    newestId?: string;
    onResolve: (groupId: string, keepId: string, allIds: string[]) => void;
    privacyEnabled: boolean;
    maskedKeywords: string[];
    style?: React.CSSProperties;
}> = React.memo(({ group, newestId, onResolve, privacyEnabled, maskedKeywords, style }) => {
    return (
        <div style={style} className="p-2">
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden shadow-lg transition-all hover:shadow-xl flex flex-col h-full">
                <div className="px-5 py-3 bg-gray-50 dark:bg-slate-950/30 border-b border-gray-200 dark:border-white/5 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <Copy className="w-4 h-4 text-sage-500" />
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                            Exact Duplicate Group
                        </span>
                    </div>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${group.images.length > 2 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50' : 'text-gray-400'}`}>
                        {group.images.length} copies
                    </span>
                </div>

                <div className="p-5 flex flex-col gap-4 flex-1">
                    {/* Horizontal Scroll Container */}
                    <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar scroll-px-0">
                        {group.images.map((img) => (
                            <DuplicateItem
                                key={img.id}
                                img={img}
                                onKeepOnly={(imgId) => onResolve(group.id, imgId, group.images.map(i => i.id))}
                                privacyEnabled={privacyEnabled}
                                maskedKeywords={maskedKeywords}
                                isNewest={img.id === newestId}
                            />
                        ))}
                    </div>
                </div>

                {/* Conflict Info Footer */}
                <div className="mt-auto flex items-center gap-3 p-3 border-t border-gray-100 dark:border-white/5 bg-gray-50/30 dark:bg-slate-950/20">
                    <div className="p-2 rounded-full bg-sage-100 dark:bg-sage-900/20 text-sage-600">
                        <Check className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                        <p className="text-[10px] text-gray-500 dark:text-gray-400">
                            Keep version with best tag data. Others moved to trash bin.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
});

interface DuplicateFinderProps {
    images: AIImage[];
    onResolve: (keepId: string, deleteIds: string[]) => void;
    // Privacy
    maskedKeywords: string[];
    privacyEnabled: boolean;
    onRefresh?: (scope: 'global' | 'filtered') => void | Promise<any>;
    scrollContainerRef: React.RefObject<HTMLDivElement | null>;
    onRangeSelection?: (indexes: number[], isAdditive: boolean) => void;
    onBackgroundClick?: () => void;
}

export const DuplicateFinder: React.FC<DuplicateFinderProps> = React.memo(({
    images,
    onResolve,
    maskedKeywords,
    privacyEnabled,
    onRefresh,
    scrollContainerRef,
    onRangeSelection,
    onBackgroundClick
}) => {
    const { groups, totalRedundantCount, handleResolve, handleBulkResolve } = useDuplicateFinder(images, onResolve);
    const [scope, setScope] = useState<'global' | 'filtered'>('global');

    if (groups.length === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 animate-in fade-in py-20">
                <div className="p-6 bg-sage-500/10 rounded-full mb-6 border border-sage-500/20">
                    <Check className="w-16 h-16 text-sage-500" />
                </div>
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">Library is Clean</h2>
                <p className="max-w-md text-center text-gray-500 dark:text-gray-400 mb-6">
                    No strict duplicates detected in the {scope === 'global' ? 'entire library' : 'current filter results'}.
                </p>
                {onRefresh && (
                    <div className="flex flex-col items-center gap-4">
                        <button
                            onClick={() => onRefresh(scope)}
                            className="px-6 py-2 bg-sage-500 hover:bg-sage-600 text-white rounded-xl font-bold transition-all shadow-lg shadow-sage-500/20 flex items-center gap-2"
                        >
                            <Zap className="w-4 h-4" /> Run {scope === 'global' ? 'Global' : 'Filtered'} Scan
                        </button>

                        <div className="flex items-center gap-2 p-1 bg-gray-100 dark:bg-white/5 rounded-lg border border-gray-200 dark:border-white/5">
                            <button
                                onClick={() => { setScope('global'); onRefresh('global'); }}
                                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${scope === 'global' ? 'bg-white dark:bg-zinc-800 text-sage-500 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Entire Library
                            </button>
                            <button
                                onClick={() => { setScope('filtered'); onRefresh('filtered'); }}
                                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${scope === 'filtered' ? 'bg-white dark:bg-zinc-800 text-sage-500 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Current Filter
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="w-full pb-32 animate-in slide-in-from-bottom-4 flex flex-col h-full">

            {/* Combined Header & Bulk Actions */}
            <div className="mb-4 p-4 bg-sage-100/30 dark:bg-sage-900/10 border border-sage-200/50 dark:border-sage-800/30 rounded-2xl flex flex-col lg:flex-row items-center justify-between gap-6 shadow-sm shrink-0">
                <div className="flex items-center gap-4 flex-1">
                    <div className="p-3 bg-white dark:bg-black/20 rounded-xl shadow-sm border border-sage-200/50 dark:border-white/5 relative">
                        <AlertTriangle className="w-6 h-6 text-sage-600 dark:text-sage-400" />
                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-sage-500 rounded-full border-2 border-white dark:border-slate-900 shadow-sm" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">Duplicate Detection</h3>
                            <span className="px-1.5 py-0.5 bg-sage-500/20 text-sage-600 dark:text-sage-400 rounded text-[9px] font-bold uppercase tracking-tighter">
                                {scope === 'global' ? 'Global Scan' : 'Filtered Scan'}
                            </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            Found {groups.length} groups ({totalRedundantCount} redundant items) in your {scope === 'global' ? 'whole library' : 'current filter'}.
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {/* Scope Toggle */}
                    <div className="flex items-center gap-1 p-1 bg-white/50 dark:bg-black/20 border border-sage-200/50 dark:border-white/5 rounded-xl mr-2">
                        <button
                            onClick={() => { setScope('global'); onRefresh?.('global'); }}
                            className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all ${scope === 'global' ? 'bg-white dark:bg-zinc-800 text-sage-600 shadow-sm' : 'text-gray-400'}`}
                        >
                            Global
                        </button>
                        <button
                            onClick={() => { setScope('filtered'); onRefresh?.('filtered'); }}
                            className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all ${scope === 'filtered' ? 'bg-white dark:bg-zinc-800 text-sage-600 shadow-sm' : 'text-gray-400'}`}
                        >
                            Filtered
                        </button>
                    </div>

                    {onRefresh && (
                        <button
                            onClick={() => onRefresh(scope)}
                            className="p-2.5 text-gray-500 hover:text-sage-500 hover:bg-white dark:hover:bg-zinc-800 rounded-xl transition-all border border-transparent hover:border-sage-200/50"
                            title="Refresh results"
                        >
                            <Zap className="w-4 h-4" />
                        </button>
                    )}

                    {groups.length > 1 && (
                        <div className="flex items-center gap-2 p-1 bg-white/50 dark:bg-black/20 border border-sage-200/50 dark:border-white/5 rounded-2xl shadow-sm">
                            <div className="px-3 py-1 flex items-center gap-2 border-r border-sage-200/50 dark:border-white/5 mr-1">
                                <Zap className="w-3.5 h-3.5 text-sage-500" />
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">Bulk</span>
                            </div>
                            <button
                                onClick={() => handleBulkResolve('newest')}
                                className="px-4 py-2 bg-sage-500 hover:bg-sage-600 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 group shadow-md shadow-sage-500/20"
                            >
                                <Clock className="w-3.5 h-3.5 group-hover:rotate-12 transition-transform" />
                                Keep Newest
                                <span className="px-1.5 py-0.5 bg-white/20 rounded-md text-[9px]">{totalRedundantCount}</span>
                            </button>
                            <button
                                onClick={() => handleBulkResolve('oldest')}
                                className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-white/5 text-gray-600 dark:text-gray-400 rounded-xl text-xs font-bold transition-all flex items-center gap-2 group"
                            >
                                <Clock className="w-3.5 h-3.5 opacity-40 group-hover:-rotate-12 transition-transform" />
                                Keep Oldest
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-1 min-h-[600px] mt-4">
                <VirtualGrid
                    items={groups}
                    layout="masonry"
                    minItemWidth={500}
                    gap={24}
                    padding={0}
                    scrollContainerRef={scrollContainerRef}
                    onRangeSelection={onRangeSelection}
                    onBackgroundClick={onBackgroundClick}
                    getItemRatio={() => 1.5}
                    renderItem={(group, style) => (
                        <DuplicateGroupCard
                            key={group.id}
                            group={group}
                            newestId={group.newestId}
                            onResolve={handleResolve}
                            privacyEnabled={privacyEnabled}
                            maskedKeywords={maskedKeywords}
                            style={style}
                        />
                    )}
                />
            </div>
        </div >
    );
});