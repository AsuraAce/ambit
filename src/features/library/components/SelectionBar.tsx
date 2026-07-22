import { SplitSquareHorizontal, Heart, Pin, EyeOff, Folder, FolderMinus, Edit3, Share, Trash2, X, Eye } from 'lucide-react';
import { AIImage } from '../../../types';
import { isImageMasked } from '../../../utils/maskingUtils';
import { useSettingsStore } from '../../../stores/settingsStore';
import { TooltipButton } from '../../../components/ui/InfoTooltip';

const BUTTON_BASE_CLASS = "p-2 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50";
const NEUTRAL_BUTTON_CLASS = `${BUTTON_BASE_CLASS} text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10`;
const ACTIVE_FAVORITE_BUTTON_CLASS = `${BUTTON_BASE_CLASS} text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20`;
const ACTIVE_PIN_BUTTON_CLASS = `${BUTTON_BASE_CLASS} text-sage-600 dark:text-sage-400 hover:text-sage-700 dark:hover:text-sage-300 hover:bg-sage-50 dark:hover:bg-sage-900/20`;

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
    const allFavorite = selectedImages.length > 0 && selectedImages.every(img => img.isFavorite);
    const allPinned = selectedImages.length > 0 && selectedImages.every(img => img.isPinned);
    const favoritePressed: boolean | 'mixed' = allFavorite ? true : selectedImages.some(img => img.isFavorite) ? 'mixed' : false;
    const pinPressed: boolean | 'mixed' = allPinned ? true : selectedImages.some(img => img.isPinned) ? 'mixed' : false;

    const allUserMasked = selectedImages.every(img => img.userMasked === true);
    const allUserUnmasked = selectedImages.every(img => img.userMasked === false);
    const allAuto = selectedImages.every(img => img.userMasked === undefined || img.userMasked === null);

    // Check if ALL are already masked (either by override or by keywords)
    const allCurrentlyMasked = selectedImages.every(img => isImageMasked(img, privacyEnabled, maskedKeywords));

    let nextState: boolean | null = null;
    let nextLabel = "Reset All to Auto Mask";
    let nextIcon = <EyeOff className="w-5 h-5" />;
    let buttonClass = NEUTRAL_BUTTON_CLASS;

    if (allAuto) {
        // From Auto -> Mask (Skip if already masked by keyword)
        if (allCurrentlyMasked) {
            nextState = false;
            nextLabel = "Force Unmask All Content";
            nextIcon = <Eye className="w-5 h-5" />;
        } else {
            nextState = true;
            nextLabel = "Force Mask All Content";
            nextIcon = <EyeOff className="w-5 h-5" />;
        }
    } else if (allUserMasked) {
        // From Masked -> Unmasked
        nextState = false;
        nextLabel = "Unmask All Content";
        nextIcon = <Eye className="w-5 h-5" />;
    } else if (allUserUnmasked) {
        // From Unmasked -> Auto
        nextState = null;
        nextLabel = "Reset All to Auto Mask";
        nextIcon = <EyeOff className="w-5 h-5" />;
    } else {
        // Mixed State -> Consolidate to Auto first
        nextState = null;
        nextLabel = "Consolidate: Reset All to Auto Mask";
        nextIcon = <EyeOff className="w-5 h-5" />;
        buttonClass = `${NEUTRAL_BUTTON_CLASS} border border-dashed border-gray-300 dark:border-white/20`;
    }

    return (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30">
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-gray-200 dark:border-white/10 shadow-2xl rounded-full px-2 py-1.5 flex items-center gap-1 animate-in slide-in-from-bottom-4 zoom-in-95 duration-500 ease-spring">
                <div className="pl-4 pr-3 text-xs font-bold text-gray-900 dark:text-white whitespace-nowrap border-r border-gray-300 dark:border-white/10">
                    <span className="text-sage-600 dark:text-sage-400">{selectedIds.size}</span>{' '}
                    <span className="text-gray-500 dark:text-gray-400 font-normal">Selected</span>
                </div>

                {selectedIds.size === 2 && (
                    <TooltipButton label="Compare Selected Images" content="Compare Selected Images" onClick={onCompare} className={NEUTRAL_BUTTON_CLASS}>
                        <SplitSquareHorizontal className="w-5 h-5" />
                    </TooltipButton>
                )}

                <TooltipButton label={allFavorite ? "Remove Selected from Favorites" : "Add Selected to Favorites"} content={allFavorite ? "Remove Selected from Favorites" : "Add Selected to Favorites"} aria-pressed={favoritePressed} onClick={onToggleFavorite} className={allFavorite ? ACTIVE_FAVORITE_BUTTON_CLASS : NEUTRAL_BUTTON_CLASS}>
                    <Heart className={`w-5 h-5 ${allFavorite ? 'fill-current' : ''}`} />
                </TooltipButton>
                <TooltipButton label={allPinned ? "Unpin Selected Images" : "Pin Selected Images"} content={allPinned ? "Unpin Selected Images" : "Pin Selected Images"} aria-pressed={pinPressed} onClick={onTogglePin} className={allPinned ? ACTIVE_PIN_BUTTON_CLASS : NEUTRAL_BUTTON_CLASS}>
                    <Pin className={`w-5 h-5 ${allPinned ? 'fill-current' : ''}`} />
                </TooltipButton>
                <TooltipButton
                    label={nextLabel}
                    content={nextLabel}
                    onClick={() => onToggleMask(undefined, nextState)}
                    className={buttonClass}
                >
                    {nextIcon}
                </TooltipButton>

                <TooltipButton label="Add Selected to Collection" content="Add Selected to Collection" onClick={onAddToCollection} className={NEUTRAL_BUTTON_CLASS}>
                    <Folder className="w-5 h-5" />
                </TooltipButton>
                {activeCollectionId && onRemoveFromCollection && (
                    <TooltipButton label="Remove Selected from Collection" content="Remove Selected from Collection" onClick={onRemoveFromCollection} className={NEUTRAL_BUTTON_CLASS}>
                        <FolderMinus className="w-5 h-5" />
                    </TooltipButton>
                )}


                <TooltipButton label="Export Selected Images" content="Export Selected Images" onClick={onExport} disabled={isExporting} className={`${NEUTRAL_BUTTON_CLASS} disabled:opacity-50`}>
                    <Share className="w-5 h-5" />
                </TooltipButton>

                <TooltipButton label="Remove Selected from Library" content="Remove Selected from Library" onClick={onDelete} className="p-2 text-red-500/70 dark:text-red-400/80 hover:text-red-700 dark:hover:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50">
                    <Trash2 className="w-5 h-5" />
                </TooltipButton>

                <button type="button" aria-label="Clear Selection" onClick={onClearSelection} className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/50 ml-1">
                    <X className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
