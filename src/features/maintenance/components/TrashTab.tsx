import * as React from 'react';
import { useCallback } from 'react';
import { ArchiveRestore, Loader2, Trash2 } from 'lucide-react';
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
    busyAction?: 'restoring' | 'deleting' | null;
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
    onBackgroundClick,
    busyAction = null
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
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">Removed List is Empty</h2>
                <p className="max-w-md text-center text-gray-500 dark:text-gray-400">
                    No library-removed images found. Files you remove from Ambit while keeping them on disk will appear here.
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
                        disabled={busyAction !== null}
                        className="px-4 py-2 bg-sage-600 hover:bg-sage-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2"
                    >
                        {busyAction === 'restoring' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArchiveRestore className="w-4 h-4" />} {busyAction === 'restoring' ? 'Restoring...' : 'Restore to Library'}
                        <span className="px-1.5 py-0.5 bg-white/20 rounded-md text-[9px]">{selectedIds.size}</span>
                    </button>
                    <button
                        onClick={onDeleteSelected}
                        disabled={busyAction !== null}
                        className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2"
                    >
                        {busyAction === 'deleting' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {busyAction === 'deleting' ? 'Deleting from Disk...' : 'Delete File'}
                    </button>
                </>
            ) : (
                <div className="px-4 py-2 text-gray-400 text-xs font-medium italic">
                    Select images to restore or delete from disk
                </div>
            )}
        </div>
    );

    return (
        <div className="w-full pb-32 animate-in slide-in-from-bottom-4 flex flex-col items-stretch">
            <MaintenanceHeader
                title="Removed from Library"
                description={`Found ${images.length} images removed from Ambit while kept on disk.`}
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
