import * as React from 'react';
import { useCallback } from 'react';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import { AIImage } from '../../../types';
import { VirtualGrid } from '../../library/components/VirtualGrid';
import { MaintenanceItem } from './MaintenanceItem';
import { MaintenanceHeader } from './MaintenanceHeader';

interface TrashTabProps {
    images: AIImage[];
    selectedIds: Set<string>;
    onItemClick: (id: string, index: number, e: React.MouseEvent) => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onRestoreSelected: () => void;
    onDeleteSelected: () => void;
    maskedKeywords: string[];
    scrollContainerRef: React.RefObject<HTMLElement | null>;
    onRangeSelection: (indexes: number[], isAdditive: boolean) => void;
    onBackgroundClick: () => void;
}

export const TrashTab: React.FC<TrashTabProps> = ({
    images,
    selectedIds,
    onItemClick,
    onSelectAll,
    onClearSelection,
    onRestoreSelected,
    onDeleteSelected,
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
                maskedKeywords={maskedKeywords}
                imageClassName={selectedIds.has(img.id) ? 'opacity-100' : 'opacity-70 grayscale'}
            />
        );
    }, [selectedIds, onItemClick, maskedKeywords]);

    if (images.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <div className="p-6 bg-sage-500/10 rounded-full mb-6 border border-sage-500/20">
                    <Trash2 className="w-16 h-16 text-sage-500" />
                </div>
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">Trash is Empty</h2>
                <p className="max-w-md text-center text-gray-500 dark:text-gray-400">
                    No soft-deleted images found. Images you delete from the gallery will appear here.
                </p>
            </div>
        );
    }

    const actions = (
        <div className="flex items-center gap-2 p-1 bg-white/50 dark:bg-black/20 border border-sage-200/50 dark:border-white/5 rounded-2xl shadow-sm">
            {selectedIds.size > 0 ? (
                <>
                    <button
                        onClick={onRestoreSelected}
                        className="px-4 py-2 bg-sage-600 hover:bg-sage-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2"
                    >
                        <ArchiveRestore className="w-4 h-4" /> Restore Selected
                        <span className="px-1.5 py-0.5 bg-white/20 rounded-md text-[9px]">{selectedIds.size}</span>
                    </button>
                    <button
                        onClick={onDeleteSelected}
                        className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2"
                    >
                        <Trash2 className="w-4 h-4" /> Delete Forever
                    </button>
                </>
            ) : (
                <div className="px-4 py-2 text-gray-400 text-xs font-medium italic">
                    Select images to restore or delete forever
                </div>
            )}
        </div>
    );

    return (
        <div className="w-full pb-32 animate-in slide-in-from-bottom-4 flex flex-col items-stretch">
            <MaintenanceHeader
                title="Trash Bin"
                description={`Found ${images.length} soft-deleted images.`}
                icon={<Trash2 className="w-6 h-6" />}
                count={images.length}
                onSelectAll={onSelectAll}
                onClearSelection={onClearSelection}
                selectedCount={selectedIds.size}
                actions={actions}
                variant="sage"
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
