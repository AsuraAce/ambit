import { SplitSquareHorizontal, Heart, Pin, EyeOff, Folder, FolderMinus, Edit3, Share, Trash2, X, Eye } from 'lucide-react';
import { AIImage } from '../../../types';
import { isImageMasked } from '../../../utils/maskingUtils';
import { useSettingsStore } from '../../../stores/settingsStore';

interface SelectionBarProps {
    selectedIds: Set<string>;
    filteredImages: AIImage[];
    lastSelectedId: string | null;
    isExporting: boolean;
    confirmDelete: boolean;
    maskedKeywords: string[];
    activeCollectionId?: string | null;

    // Actions
    onClearSelection: () => void;
    onDelete: () => void;
    onExport: () => void;
    onRename: () => void;
    onAddToCollection: () => void;
    onRemoveFromCollection?: () => void;
    onToggleFavorite: () => void;
    onTogglePin: () => void;
    onToggleMask: (targetId?: string, overrideValue?: boolean | null) => void;
    onCompare: () => void;
}

export function SelectionBar({
    selectedIds,
    filteredImages,
    lastSelectedId,
    isExporting,
    confirmDelete,
    maskedKeywords,
    onClearSelection,
    onDelete,
    onExport,
    onRename,
    onAddToCollection,
    onRemoveFromCollection,
    onToggleFavorite,
    onTogglePin,
    onToggleMask,
    onCompare,
    activeCollectionId
}: SelectionBarProps) {
    const privacyEnabled = useSettingsStore(s => s.privacyEnabled);
    if (selectedIds.size === 0) return null;

    // Logic for Tri-State Mask Cycling in Bulk:
    // Determine the "base" state to decide the next step in the cycle.
    const selectedImages = filteredImages.filter(img => selectedIds.has(img.id));

    const allUserMasked = selectedImages.every(img => img.userMasked === true);
    const allUserUnmasked = selectedImages.every(img => img.userMasked === false);
    const allAuto = selectedImages.every(img => img.userMasked === undefined || img.userMasked === null);

    // Check if ALL are already masked (either by override or by keywords)
    const allCurrentlyMasked = selectedImages.every(img => isImageMasked(img, privacyEnabled, maskedKeywords));

    let nextState: boolean | null = null;
    let nextLabel = "Reset All to Auto Mask";
    let nextIcon = <EyeOff className="w-5 h-5 text-gray-400" />;
    let buttonClass = "text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10";

    if (allAuto) {
        // From Auto -> Mask (Skip if already masked by keyword)
        if (allCurrentlyMasked) {
            nextState = false;
            nextLabel = "Force Unmask All Content";
            nextIcon = <Eye className="w-5 h-5 text-green-400" />;
            buttonClass = "text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20";
        } else {
            nextState = true;
            nextLabel = "Force Mask All Content";
            nextIcon = <EyeOff className="w-5 h-5 text-amethyst-400" />;
            buttonClass = "text-amethyst-500 hover:bg-amethyst-50 dark:hover:bg-amethyst-900/20";
        }
    } else if (allUserMasked) {
        // From Masked -> Unmasked
        nextState = false;
        nextLabel = "Unmask All Content";
        nextIcon = <Eye className="w-5 h-5 text-green-400" />;
        buttonClass = "text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20";
    } else if (allUserUnmasked) {
        // From Unmasked -> Auto
        nextState = null;
        nextLabel = "Reset All to Auto Mask";
        nextIcon = <EyeOff className="w-5 h-5 text-gray-400" />;
        buttonClass = "text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10";
    } else {
        // Mixed State -> Consolidate to Auto first
        nextState = null;
        nextLabel = "Consolidate: Reset All to Auto Mask";
        nextIcon = <EyeOff className="w-5 h-5 text-gray-400" />;
        buttonClass = "text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-all border border-dashed border-gray-300 dark:border-white/20";
    }

    return (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30">
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-gray-200 dark:border-white/10 shadow-2xl rounded-full px-2 py-1.5 flex items-center gap-1 animate-in slide-in-from-bottom-4 zoom-in-95 duration-500 ease-spring">
                <div className="pl-4 pr-3 text-xs font-bold text-gray-900 dark:text-white whitespace-nowrap border-r border-gray-300 dark:border-white/10">
                    <span className="text-sage-600 dark:text-sage-400">{selectedIds.size}</span>{' '}
                    <span className="text-gray-500 dark:text-gray-400 font-normal">Selected</span>
                </div>

                {selectedIds.size === 2 && (
                    <button onClick={onCompare} className="p-2 text-sage-600 dark:text-sage-400 hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors" title="Compare">
                        <SplitSquareHorizontal className="w-5 h-5" />
                    </button>
                )}

                <button onClick={onToggleFavorite} className="p-2 text-red-500/80 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition-colors" title="Favorite All">
                    <Heart className="w-5 h-5" />
                </button>
                <button onClick={onTogglePin} className="p-2 text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors" title="Pin All">
                    <Pin className="w-5 h-5" />
                </button>
                <button
                    onClick={() => onToggleMask(undefined, nextState)}
                    className={`p-2 rounded-full transition-colors ${buttonClass}`}
                    title={nextLabel}
                >
                    {nextIcon}
                </button>

                <button onClick={onAddToCollection} className="p-2 text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors" title="Add to Collection">
                    <Folder className="w-5 h-5" />
                </button>
                {activeCollectionId && onRemoveFromCollection && (
                    <button onClick={onRemoveFromCollection} className="p-2 text-red-500/80 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition-colors" title="Remove from this Collection">
                        <FolderMinus className="w-5 h-5" />
                    </button>
                )}
                <button onClick={onRename} className="p-2 text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors" title="Batch Rename">
                    <Edit3 className="w-5 h-5" />
                </button>

                <button onClick={onExport} disabled={isExporting} className="p-2 text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors disabled:opacity-50" title="Export">
                    <Share className="w-5 h-5" />
                </button>

                <button onClick={onDelete} className="p-2 text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-full transition-colors" title="Delete">
                    <Trash2 className="w-5 h-5" />
                </button>

                <button onClick={onClearSelection} className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full transition-colors ml-1" title="Clear Selection">
                    <X className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
