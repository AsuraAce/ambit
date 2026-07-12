

import * as React from 'react';
import { memo, useRef } from 'react';
import { AIImage } from '../../../types';
import { ImageCard } from './ImageCard';
import { Layers } from 'lucide-react';
import { isImageMasked } from '../../../utils/maskingUtils';
import { useSettingsStore } from '../../../stores/settingsStore';
import { commands } from '../../../bindings';
import { normalizePath, urlToPath } from '../../../utils/pathUtils';

interface GridItemProps {
    image: AIImage;
    style: React.CSSProperties;
    index: number;
    isSelected: boolean;
    selectedIds: Set<string>;
    maskedKeywords: string[];
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    onClick: (e: React.MouseEvent, id: string, index: number) => void;
    onToggleSelection: (e: React.MouseEvent, id: string) => void;
    onTogglePin: (e: React.MouseEvent, id: string) => void;
    onToggleFavorite: (e: React.MouseEvent, id: string) => void;
    onContextMenu: (e: React.MouseEvent, id: string) => void;
    isThumbnail?: boolean;
    layoutPos?: { x: number, y: number, width: number, height: number };
}

export const GridItem: React.FC<GridItemProps> = memo(({
    image,
    style,
    index,
    isSelected,
    selectedIds, // Passed for multi-select logic if needed
    maskedKeywords,
    setImages,
    onClick,
    onToggleSelection,
    onTogglePin,
    onToggleFavorite,
    onContextMenu,
    isThumbnail = false
}) => {
    const privacyEnabled = useSettingsStore(s => s.privacyEnabled);

    // Unified Masking Logic
    const isMasked = isImageMasked(image, privacyEnabled, maskedKeywords);

    const isVerifyingMissingRef = useRef(false);

    // Error Handler: If real thumbnail fails to load, regenerate it (with retry limit)
    const handleImageError = () => {
        const sourcePath = normalizePath(urlToPath(image.url));
        if (!sourcePath || image.isMissing || isVerifyingMissingRef.current) {
            return;
        }

        isVerifyingMissingRef.current = true;
        void commands.verifyImagePaths([sourcePath])
            .then((result) => {
                if (result.status === 'error') {
                    throw new Error(result.error);
                }

                const isActuallyMissing = result.data.includes(sourcePath);
                if (!isActuallyMissing) {
                    console.warn('[GridItem] Image load failed but file still exists', sourcePath);
                    return;
                }

                setImages(prev => prev.map(img =>
                    img.id === image.id ? { ...img, isMissing: true } : img
                ));
            })
            .catch((error) => {
                console.error('[GridItem] Failed to verify image path after load error', error);
            })
            .finally(() => {
                isVerifyingMissingRef.current = false;
            });
    };

    const stackSize = image.stack?.length ?? 0;
    const isStack = stackSize > 1;

    return (
        <div
            style={{ ...style, zIndex: isSelected ? 10 : 1 }}
            className="group/griditem absolute top-0 left-0"
        >
            {/* ... stack layers omitted for clarity in chunk ... */}
            {isStack && (
                <>
                    <div className="absolute -top-2 left-3 right-3 h-full bg-gray-200 dark:bg-zinc-800 rounded-2xl border border-gray-300 dark:border-white/5 z-0 transition-transform duration-300 group-hover/griditem:-translate-y-1" />
                    <div className="absolute -top-1 left-1.5 right-1.5 h-full bg-gray-300 dark:bg-zinc-700 rounded-2xl border border-gray-300 dark:border-white/5 z-0 transition-transform duration-300 group-hover/griditem:-translate-y-0.5" />
                </>
            )}

            <div
                className={`relative z-10 w-full h-full ${isStack ? 'group-hover/griditem:translate-y-1' : ''}`}
            >
                <ImageCard
                    image={image}
                    isSelected={isSelected}
                    isMasked={isMasked}
                    isThumbnail={isThumbnail}
                    onDragStart={(e) => {
                        const ids = selectedIds.size > 0 ? Array.from(selectedIds) : [image.id];
                        try {
                            e.dataTransfer.effectAllowed = 'copyMove';
                            e.dataTransfer.setData('application/x-ambit-image-ids', JSON.stringify(ids));
                            e.dataTransfer.setData('text/plain', `ambit:${ids.length} images`);
                        } catch (err) {
                            console.error('[GridItem] Failed to set drag data:', err);
                        }
                    }}
                    onClick={(e) => onClick(e, image.id, index)}
                    onToggleSelection={(e) => onToggleSelection(e, image.id)}
                    onToggleFavorite={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(e, image.id);
                    }}
                    onTogglePin={(e) => {
                        e.stopPropagation();
                        onTogglePin(e, image.id);
                    }}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        onContextMenu(e, image.id);
                    }}
                    onImageError={handleImageError}
                />

                {/* Stack Badge - Moved to Top Right to avoid hover action overlap */}
                {isStack && (
                    <div
                        className={`absolute top-2 right-2 bg-black/70 backdrop-blur-md text-white text-[10px] font-bold px-2 py-1 rounded-md flex items-center gap-1.5 border border-white/10 shadow-lg pointer-events-none z-30 transition-all duration-300 ${image.isPinned ? 'mt-8' : ''}`}
                        title={`${stackSize} versions stacked`}
                    >
                        <Layers className="w-3 h-3 text-sage-400" />
                        {stackSize}
                    </div>
                )}
            </div>
        </div>
    );
}, (prev, next) => {
    return (
        prev.image === next.image &&
        prev.image.stack === next.image.stack &&
        prev.image.isPinned === next.image.isPinned &&
        prev.isSelected === next.isSelected &&
        prev.isThumbnail === next.isThumbnail &&
        prev.selectedIds === next.selectedIds &&
        prev.maskedKeywords === next.maskedKeywords &&
        prev.index === next.index &&
        prev.style.transform === next.style.transform &&
        prev.style.transition === next.style.transition &&
        prev.style.willChange === next.style.willChange &&
        prev.style.opacity === next.style.opacity &&
        prev.style.width === next.style.width &&
        prev.style.height === next.style.height &&
        // Check layout pos instead of style.top/left
        prev.layoutPos?.x === next.layoutPos?.x &&
        prev.layoutPos?.y === next.layoutPos?.y
    );
});
