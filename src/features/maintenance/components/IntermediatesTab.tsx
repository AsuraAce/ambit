import * as React from 'react';
import { useCallback } from 'react';
import { Layers, Trash2, Eye, CheckCircle, Globe, Filter } from 'lucide-react';
import { AIImage } from '../../../types';
import { VirtualGrid } from '../../library/components/VirtualGrid';
import { MaintenanceItem } from './MaintenanceItem';
import { MaintenanceHeader } from './MaintenanceHeader';

interface IntermediatesTabProps {
    images: AIImage[];
    selectedIds: Set<string>;
    onItemClick: (id: string, index: number, e: React.MouseEvent, revealGranted?: boolean) => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onDeleteSelected: () => void;
    onUnmarkSelected: () => void;
    onViewImage: (id: string, revealGranted?: boolean) => void;
    maskedKeywords: string[];
    scrollContainerRef: React.RefObject<HTMLElement | null>;
    onRangeSelection: (indexes: number[], isAdditive: boolean) => void;
    onBackgroundClick: () => void;
    scope: 'global' | 'filtered';
    onScopeChange: (scope: 'global' | 'filtered') => void;
}

export const IntermediatesTab: React.FC<IntermediatesTabProps> = ({
    images,
    selectedIds,
    onItemClick,
    onSelectAll,
    onClearSelection,
    onDeleteSelected,
    onUnmarkSelected,
    onViewImage,
    maskedKeywords,
    scrollContainerRef,
    onRangeSelection,
    onBackgroundClick,
    scope,
    onScopeChange
}) => {
    const renderItem = useCallback((img: AIImage, style: React.CSSProperties, index: number) => {
        const isSelected = selectedIds.has(img.id);

        const overlayActions = (revealGranted: boolean) => (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onViewImage(img.id, revealGranted);
                }}
                className="px-4 py-2 bg-white/90 dark:bg-zinc-900/90 text-gray-900 dark:text-white rounded-full text-xs font-bold shadow-xl transform scale-90 hover:scale-100 transition-all flex items-center gap-2 hover:bg-white dark:hover:bg-zinc-800"
            >
                <Eye className="w-4 h-4" /> View Image
            </button>
        );

        return (
            <MaintenanceItem
                key={img.id}
                img={img}
                style={style}
                isSelected={isSelected}
                onClick={(e, revealGranted) => onItemClick(img.id, index, e, revealGranted)}
                maskedKeywords={maskedKeywords}
                overlayActions={overlayActions}
            >
                {!isSelected && (
                    <div className="absolute inset-x-0 bottom-6 flex justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="flex items-center gap-1 rounded bg-gray-900/80 px-2 py-1 text-[10px] font-bold text-white shadow-lg backdrop-blur-md">
                            <Layers className="w-3 h-3" /> Intermediate
                        </span>
                    </div>
                )}
            </MaintenanceItem>
        );
    }, [selectedIds, onItemClick, onViewImage, maskedKeywords]);

    if (images.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <div className="mb-6 rounded-full border border-harbor-200 bg-harbor-50 p-6 shadow-inner dark:border-harbor-500/20 dark:bg-harbor-500/10">
                    <Layers className="h-16 w-16 text-harbor-600 dark:text-harbor-300" />
                </div>
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">No Intermediate Images</h2>
                <p className="max-w-md text-center text-gray-500 dark:text-gray-400 text-sm">
                    {scope === 'global'
                        ? "Your library is clean! No images are currently flagged as intermediates."
                        : "There are no intermediate images in the current filtered view."}
                </p>
                {scope === 'filtered' && (
                    <button
                        onClick={() => onScopeChange('global')}
                        className="mt-6 rounded-full bg-sage-600 px-6 py-2 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-sage-500"
                    >
                        Switch to Global Scan
                    </button>
                )}
            </div>
        );
    }

    const actions = (
        <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white/50 p-1 shadow-sm dark:border-white/5 dark:bg-black/20">
            {selectedIds.size > 0 ? (
                <>
                    <button
                        onClick={onUnmarkSelected}
                        className="flex items-center gap-2 rounded-xl bg-sage-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-sage-500"
                    >
                        <CheckCircle className="w-4 h-4" /> Move to Gallery
                        <span className="px-1.5 py-0.5 bg-white/20 rounded-md text-[9px] font-black">{selectedIds.size}</span>
                    </button>
                    <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mx-1" />
                    <button
                        onClick={onDeleteSelected}
                        className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-lg shadow-red-500/20"
                    >
                        <Trash2 className="w-4 h-4" /> Delete
                    </button>
                </>
            ) : (
                <div className="px-4 py-2 text-gray-400 text-xs font-bold italic tracking-tight">
                    Select images to process
                </div>
            )}
        </div>
    );

    const scopeSwitcher = (
        <div className="flex items-center gap-1 rounded-2xl border border-gray-200 bg-white/50 p-1 shadow-sm dark:border-white/5 dark:bg-black/20">
            <button
                onClick={() => onScopeChange('filtered')}
                className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors ${scope === 'filtered' ? 'bg-sage-600 text-white' : 'text-gray-400 hover:text-gray-600'}`}
            >
                <Filter className="w-3 h-3" /> Filtered
            </button>
            <button
                onClick={() => onScopeChange('global')}
                className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors ${scope === 'global' ? 'bg-sage-600 text-white' : 'text-gray-400 hover:text-gray-600'}`}
            >
                <Globe className="w-3 h-3" /> Global
            </button>
        </div>
    );

    return (
        <div className="w-full pb-32 animate-in slide-in-from-bottom-4 flex flex-col items-stretch">
            <MaintenanceHeader
                title="Intermediate Images"
                description={`Found ${images.length} images flagged as intermediates (no InvokeAI metadata).`}
                icon={<Layers className="w-6 h-6" />}
                count={images.length}
                onSelectAll={onSelectAll}
                onClearSelection={onClearSelection}
                selectedCount={selectedIds.size}
                actions={actions}
                extraControls={scopeSwitcher}
                variant="harbor"
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
