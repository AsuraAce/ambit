import * as React from 'react';
import { useCallback } from 'react';
import { FileWarning, Trash2, Eye, FileX } from 'lucide-react';
import { AIImage } from '../../../types';
import { VirtualGrid } from '../../library/components/VirtualGrid';
import { MaintenanceHeader } from './MaintenanceHeader';
import { MaintenanceItem } from './MaintenanceItem';

interface MissingTabProps {
    images: AIImage[];
    selectedIds: Set<string>;
    onItemClick: (id: string, index: number, e: React.MouseEvent) => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onDeleteSelected: () => void;
    onPurgeMissing: () => void;
    onViewImage: (id: string) => void;
    scrollContainerRef: React.RefObject<HTMLElement | null>;
    onRangeSelection: (indexes: number[], isAdditive: boolean) => void;
    onBackgroundClick: () => void;
}

export const MissingTab: React.FC<MissingTabProps> = ({
    images,
    selectedIds,
    onItemClick,
    onSelectAll,
    onClearSelection,
    onDeleteSelected,
    onPurgeMissing,
    onViewImage,
    scrollContainerRef,
    onRangeSelection,
    onBackgroundClick
}) => {
    const renderItem = useCallback((img: AIImage, style: React.CSSProperties, index: number) => {
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
                isSelected={selectedIds.has(img.id)}
                onClick={(e) => onItemClick(img.id, index, e)}
                privacyEnabled={false}
                maskedKeywords={[]}
                overlayActions={overlayActions}
                isMissing={true}
            />
        );
    }, [selectedIds, onItemClick, onViewImage]);

    if (images.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <div className="p-6 bg-red-500/10 rounded-full mb-6 border border-red-500/20">
                    <FileWarning className="w-16 h-16 text-red-500" />
                </div>
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">No Missing Files</h2>
                <p className="max-w-md text-center text-gray-500 dark:text-gray-400">
                    All scanned images are currently accessible on disk.
                </p>
            </div>
        );
    }

    const actions = (
        <div className="flex items-center gap-2 p-1 bg-white/50 dark:bg-black/20 border border-red-200/50 dark:border-white/5 rounded-2xl shadow-sm">
            {selectedIds.size > 0 ? (
                <button
                    onClick={onDeleteSelected}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2"
                >
                    <Trash2 className="w-4 h-4" /> Move to Trash
                    <span className="px-1.5 py-0.5 bg-white/20 rounded-md text-[9px]">{selectedIds.size}</span>
                </button>
            ) : (
                <button
                    onClick={onPurgeMissing}
                    className="px-4 py-2 bg-red-600/10 hover:bg-red-600/20 text-red-600 dark:text-red-400 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-red-200 dark:border-red-900/50"
                >
                    <FileX className="w-4 h-4" /> Move all {images.length} to Trash
                </button>
            )}
        </div>
    );

    return (
        <div className="w-full pb-32 animate-in slide-in-from-bottom-4 flex flex-col items-stretch">
            <MaintenanceHeader
                title="Missing Files"
                description={`Found ${images.length} records whose source file is no longer on disk. These might have been moved or deleted manually.`}
                icon={<FileWarning className="w-6 h-6" />}
                count={images.length}
                onSelectAll={onSelectAll}
                onClearSelection={onClearSelection}
                selectedCount={selectedIds.size}
                actions={actions}
                variant="red"
            />

            <VirtualGrid
                items={images}
                renderItem={renderItem}
                layout="grid"
                minItemWidth={220}
                gap={16}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                onRangeSelection={onRangeSelection}
                onBackgroundClick={onBackgroundClick}
            />
        </div>
    );
};
