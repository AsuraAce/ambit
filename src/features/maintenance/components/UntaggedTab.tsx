import * as React from 'react';
import { useCallback } from 'react';
import { Tag, Trash2, Eye, Wand2, Globe, Filter } from 'lucide-react';
import { AIImage } from '../../../types';
import { VirtualGrid } from '../../library/components/VirtualGrid';
import { MaintenanceItem } from './MaintenanceItem';
import { MaintenanceHeader } from './MaintenanceHeader';

interface UntaggedTabProps {
    images: AIImage[];
    selectedIds: Set<string>;
    onItemClick: (id: string, index: number, e: React.MouseEvent) => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onMoveToTrash: () => void;
    onViewImage: (id: string) => void;
    privacyEnabled: boolean;
    maskedKeywords: string[];
    scrollContainerRef: React.RefObject<HTMLElement | null>;
    onRangeSelection: (indexes: number[], isAdditive: boolean) => void;
    onBackgroundClick: () => void;
    untaggedScope: 'global' | 'filtered';
    onScopeChange: (scope: 'global' | 'filtered') => void;
}

export const UntaggedTab: React.FC<UntaggedTabProps> = ({
    images,
    selectedIds,
    onItemClick,
    onSelectAll,
    onClearSelection,
    onMoveToTrash,
    onViewImage,
    privacyEnabled,
    maskedKeywords,
    scrollContainerRef,
    onRangeSelection,
    onBackgroundClick,
    untaggedScope,
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
                privacyEnabled={privacyEnabled}
                maskedKeywords={maskedKeywords}
                overlayActions={overlayActions}
            >
                {/* Specific logic for Untagged item from original code */}
                {!isSelected && (
                    <div className="absolute inset-x-0 bottom-6 flex justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="bg-black/60 text-white text-[10px] px-2 py-1 rounded backdrop-blur-md font-bold flex items-center gap-1">
                            <Wand2 className="w-3 h-3" /> Recover
                        </span>
                    </div>
                )}
            </MaintenanceItem>
        );
    }, [selectedIds, onItemClick, onViewImage, privacyEnabled, maskedKeywords]);

    if (images.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <div className="p-6 bg-orange-500/10 rounded-full mb-6 border border-orange-500/20">
                    <Tag className="w-16 h-16 text-orange-500" />
                </div>
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">No Untagged Images</h2>
                <p className="max-w-md text-center text-gray-500 dark:text-gray-400">
                    All your images {untaggedScope === 'filtered' ? 'in this filter' : ''} appear to have metadata or positive prompts.
                </p>
                <button
                    onClick={() => onScopeChange(untaggedScope === 'global' ? 'filtered' : 'global')}
                    className="mt-6 text-xs font-bold text-orange-600 hover:underline"
                >
                    Switch to {untaggedScope === 'global' ? 'Filtered' : 'Global'} scope
                </button>
            </div>
        );
    }

    const actions = (
        <div className="flex items-center gap-2 p-1 bg-white/50 dark:bg-black/20 border border-orange-200/50 dark:border-white/5 rounded-2xl shadow-sm">
            {selectedIds.size > 0 ? (
                <button
                    onClick={onMoveToTrash}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2"
                >
                    <Trash2 className="w-4 h-4" /> Move to Trash
                    <span className="px-1.5 py-0.5 bg-white/20 rounded-md text-[9px]">{selectedIds.size}</span>
                </button>
            ) : (
                <div className="px-4 py-2 text-gray-400 text-xs font-medium italic">
                    Select images to move to trash bin
                </div>
            )}
        </div>
    );

    const scopeSwitcher = (
        <div className="flex items-center gap-1 p-1 bg-white/50 dark:bg-black/20 border border-orange-200/50 dark:border-white/5 rounded-2xl shadow-sm">
            <button
                onClick={() => onScopeChange('filtered')}
                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 ${untaggedScope === 'filtered' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-gray-400 hover:text-gray-600'}`}
            >
                <Filter className="w-3 h-3" /> Filtered
            </button>
            <button
                onClick={() => onScopeChange('global')}
                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 ${untaggedScope === 'global' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-gray-400 hover:text-gray-600'}`}
            >
                <Globe className="w-3 h-3" /> Global
            </button>
        </div>
    );

    return (
        <div className="w-full pb-32 animate-in slide-in-from-bottom-4 flex flex-col items-stretch">
            <MaintenanceHeader
                title="Untagged Images"
                description={`Found ${images.length} images without descriptive metadata.`}
                icon={<Tag className="w-6 h-6" />}
                count={images.length}
                onSelectAll={onSelectAll}
                onClearSelection={onClearSelection}
                selectedCount={selectedIds.size}
                actions={actions}
                extraControls={scopeSwitcher}
                variant="orange"
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
