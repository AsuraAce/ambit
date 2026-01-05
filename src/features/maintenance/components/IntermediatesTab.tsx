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
    onItemClick: (id: string, index: number, e: React.MouseEvent) => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onDeleteSelected: () => void;
    onUnmarkSelected: () => void;
    onViewImage: (id: string) => void;
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

        const overlayActions = (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onViewImage(img.id);
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
                onClick={(e) => onItemClick(img.id, index, e)}
                maskedKeywords={maskedKeywords}
                overlayActions={overlayActions}
            >
                {!isSelected && (
                    <div className="absolute inset-x-0 bottom-6 flex justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="bg-blue-600/80 text-white text-[10px] px-2 py-1 rounded backdrop-blur-md font-bold flex items-center gap-1 shadow-lg">
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
                <div className="p-6 bg-blue-500/10 rounded-full mb-6 border border-blue-500/20 shadow-inner">
                    <Layers className="w-16 h-16 text-blue-500" />
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
                        className="mt-6 px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-full text-xs font-black transition-all shadow-lg shadow-blue-500/20 uppercase tracking-widest"
                    >
                        Switch to Global Scan
                    </button>
                )}
            </div>
        );
    }

    const actions = (
        <div className="flex items-center gap-2 p-1 bg-white/50 dark:bg-black/20 border border-blue-200/50 dark:border-white/5 rounded-2xl shadow-sm">
            {selectedIds.size > 0 ? (
                <>
                    <button
                        onClick={onUnmarkSelected}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-lg shadow-blue-500/20"
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
        <div className="flex items-center gap-1 p-1 bg-white/50 dark:bg-black/20 border border-blue-200/50 dark:border-white/5 rounded-2xl shadow-sm">
            <button
                onClick={() => onScopeChange('filtered')}
                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 ${scope === 'filtered' ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' : 'text-gray-400 hover:text-gray-600'}`}
            >
                <Filter className="w-3 h-3" /> Filtered
            </button>
            <button
                onClick={() => onScopeChange('global')}
                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 ${scope === 'global' ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' : 'text-gray-400 hover:text-gray-600'}`}
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
