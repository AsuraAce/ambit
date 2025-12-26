import * as React from 'react';
import { useCallback } from 'react';
import { Layers, Zap, RefreshCw, Check, Image } from 'lucide-react';
import { AIImage } from '../../types';
import { VirtualGrid } from '../VirtualGrid';
import { MaintenanceItem } from './MaintenanceItem';
import { MaintenanceHeader } from './MaintenanceHeader';

interface ThumbnailsTabProps {
    images: AIImage[];
    selectedIds: Set<string>;
    onItemClick: (id: string, index: number, e: React.MouseEvent) => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onRegenerate: (ids?: string[]) => void;
    thumbnailsScope: 'global' | 'filtered';
    onScopeChange: (scope: 'global' | 'filtered') => void;
    privacyEnabled: boolean;
    maskedKeywords: string[];
    scrollContainerRef: React.RefObject<HTMLElement | null>;
    onRangeSelection: (indexes: number[], isAdditive: boolean) => void;
    onBackgroundClick: () => void;
}

export const ThumbnailsTab: React.FC<ThumbnailsTabProps> = ({
    images,
    selectedIds,
    onItemClick,
    onSelectAll,
    onClearSelection,
    onRegenerate,
    thumbnailsScope,
    onScopeChange,
    privacyEnabled,
    maskedKeywords,
    scrollContainerRef,
    onRangeSelection,
    onBackgroundClick
}) => {
    const renderItem = useCallback((img: AIImage, style: React.CSSProperties, index: number) => {
        return (
            <MaintenanceItem
                key={img.id}
                img={img}
                style={style}
                isSelected={selectedIds.has(img.id)}
                onClick={(e) => onItemClick(img.id, index, e)}
                privacyEnabled={privacyEnabled}
                maskedKeywords={maskedKeywords}
            />
        );
    }, [selectedIds, onItemClick, privacyEnabled, maskedKeywords]);

    const actions = (
        <div className="flex flex-wrap items-center gap-3">
            {/* Scope Toggle */}
            <div className="flex items-center gap-1 p-1 bg-white/50 dark:bg-black/20 border border-sage-200/50 dark:border-white/5 rounded-xl mr-2">
                <button
                    onClick={() => onScopeChange('global')}
                    className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all ${thumbnailsScope === 'global' ? 'bg-white dark:bg-zinc-800 text-sage-600 shadow-sm' : 'text-gray-400'}`}
                >
                    Global
                </button>
                <button
                    onClick={() => onScopeChange('filtered')}
                    className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all ${thumbnailsScope === 'filtered' ? 'bg-white dark:bg-zinc-800 text-sage-600 shadow-sm' : 'text-gray-400'}`}
                >
                    Filtered
                </button>
            </div>

            {selectedIds.size > 0 ? (
                <button
                    onClick={() => onRegenerate(Array.from(selectedIds))}
                    className="px-4 py-2 bg-sage-500 hover:bg-sage-600 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 group shadow-md shadow-sage-500/20"
                >
                    <Zap className="w-4 h-4 group-hover:rotate-12 transition-transform" />
                    Regenerate Selected
                    <span className="px-1.5 py-0.5 bg-white/20 rounded-md text-[9px]">{selectedIds.size}</span>
                </button>
            ) : (
                <button
                    onClick={() => onRegenerate()}
                    className="px-4 py-2 bg-sage-500 hover:bg-sage-600 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 group shadow-md shadow-sage-500/20"
                >
                    <RefreshCw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-700" />
                    Regenerate All Unoptimized
                    {images.length > 0 && <span className="px-1.5 py-0.5 bg-white/20 rounded-md text-[9px]">{images.length}</span>}
                </button>
            )}
        </div>
    );

    if (images.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <div className="p-6 bg-blue-500/10 rounded-full mb-6 border border-blue-500/20">
                    <Check className="w-16 h-16 text-blue-500" />
                </div>
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">Optimized</h2>
                <p className="max-w-md text-center text-gray-500 dark:text-gray-400">
                    All images in this scope have high-quality thumbnails.
                </p>
                <button
                    onClick={() => onScopeChange(thumbnailsScope === 'global' ? 'filtered' : 'global')}
                    className="mt-6 text-xs font-bold text-sage-600 hover:underline"
                >
                    Switch to {thumbnailsScope === 'global' ? 'Filtered' : 'Global'} scope
                </button>
            </div>
        );
    }

    return (
        <div className="w-full pb-32 animate-in slide-in-from-bottom-4 flex flex-col items-stretch">
            <MaintenanceHeader
                title="Thumbnail Optimization"
                description={`Found ${images.length} images ${thumbnailsScope === 'filtered' ? 'in current filter' : ''} that could benefit from thumbnail regeneration.`}
                icon={<Image className="w-6 h-6" />}
                count={images.length}
                onSelectAll={onSelectAll}
                onClearSelection={onClearSelection}
                selectedCount={selectedIds.size}
                actions={actions}
                variant="blue"
            />

            <VirtualGrid
                items={images}
                renderItem={renderItem}
                layout="masonry"
                minItemWidth={200}
                gap={16}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                onRangeSelection={onRangeSelection}
                onBackgroundClick={onBackgroundClick}
            />
        </div>
    );
};
