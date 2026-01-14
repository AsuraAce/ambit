

import * as React from 'react';
import { memo, useRef } from 'react';
import { motion, MotionProps } from 'framer-motion';
import { AIImage } from '../../../types';
import { ImageCard } from './ImageCard';
import { Layers } from 'lucide-react';
import { isImageMasked } from '../../../utils/maskingUtils';
import { useSettingsStore } from '../../../stores/settingsStore';

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
    layoutPos,
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

    // Retry tracking for error recovery (max 2 attempts)
    const MAX_THUMB_RETRIES = 2;
    const retryCountRef = useRef(0);

    // Lazy Generation: If thumbnailUrl equals url (no real thumbnail), generate in background
    React.useEffect(() => {
        // Only trigger if: not missing, not already generating, and thumbnail == source
        if (!image.isMissing && image.thumbnailUrl === image.url && image.url) {
            // Generate thumbnail in background (fire-and-forget, updates state on success)
            import('../../../services/thumbnailService').then(({ generateSingleThumbnail }) => {
                generateSingleThumbnail(image.id).then((newThumb) => {
                    if (newThumb) {
                        // Success: update React state
                        setImages(prev => prev.map(img =>
                            img.id === image.id ? { ...img, thumbnailUrl: newThumb } : img
                        ));
                        // Persist to database so we don't regenerate on restart
                        import('../../../services/db/imageRepo').then(({ updateThumbnailPath }) => {
                            updateThumbnailPath(image.id, newThumb);
                        });
                    }
                    // If generation fails, keep using source (no change needed)
                }).catch(() => {
                    // Silent failure - source image continues to work
                });
            });
        }
    }, [image.id, image.isMissing, image.thumbnailUrl, image.url, setImages]);

    // Error Handler: If real thumbnail fails to load, regenerate it (with retry limit)
    const handleImageError = () => {
        // Check retry limit to prevent infinite loops
        if (retryCountRef.current >= MAX_THUMB_RETRIES) {
            if (!image.isMissing) {
                setImages(prev => prev.map(img =>
                    img.id === image.id ? { ...img, isMissing: true } : img
                ));
            }
            return;
        }

        // If we have a thumbnail URL that differs from source, try to regenerate
        if (image.thumbnailUrl && image.thumbnailUrl !== image.url && !image.isMissing) {
            retryCountRef.current++;
            import('../../../services/thumbnailService').then(({ generateSingleThumbnail }) => {
                generateSingleThumbnail(image.id).then((newThumb) => {
                    if (newThumb) {
                        setImages(prev => prev.map(img =>
                            img.id === image.id ? { ...img, thumbnailUrl: newThumb } : img
                        ));
                        // Persist regenerated thumbnail
                        import('../../../services/db/imageRepo').then(({ updateThumbnailPath }) => {
                            updateThumbnailPath(image.id, newThumb);
                        });
                    } else {
                        // Generation failed: fallback to source
                        setImages(prev => prev.map(img =>
                            img.id === image.id ? { ...img, thumbnailUrl: img.url } : img
                        ));
                    }
                }).catch(() => {
                    setImages(prev => prev.map(img => img.id === image.id ? { ...img, isMissing: true } : img));
                });
            });
            return;
        }

        // Source image failed: mark as missing
        if (!image.isMissing) {
            setImages(prev => prev.map(img => img.id === image.id ? { ...img, isMissing: true } : img));
        }
    };

    const isStack = image.stack && image.stack.length > 1;

    // Separate transform from style to let motion handle it
    const { transform, ...restStyle } = style;

    return (
        <motion.div
            style={{ ...restStyle }}
            layoutId={`card-${image.id}`}
            // initial={{ opacity: 0, scale: 0.9 }} // Disabled to prevent flicker during scroll
            initial={false}
            animate={{
                x: layoutPos?.x || 0,
                y: layoutPos?.y || 0,
                zIndex: isSelected ? 10 : 1,
                opacity: 1,
                scale: 1
            }}
            transition={{
                layout: { type: "spring", stiffness: 350, damping: 25, mass: 1 },
                x: { type: "spring", stiffness: 350, damping: 25, mass: 1 },
                y: { type: "spring", stiffness: 350, damping: 25, mass: 1 },
                opacity: { duration: 0.4, ease: "easeOut" },
                scale: { duration: 0.4, ease: "easeOut" }
            }}

            whileHover={{ transition: { duration: 0.2, ease: "easeOut" } }}
            className="group/griditem absolute top-0 left-0" // Force absolute here as we stripped it or rely on style
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
                        const idsToDrag = isSelected ? Array.from(selectedIds) : [image.id];
                        console.log('[GridItem] Drag Start. IDs:', idsToDrag);

                        // Set multiple data types for maximum compatibility
                        e.dataTransfer.effectAllowed = 'copyMove';
                        e.dataTransfer.setData('text/plain', JSON.stringify(idsToDrag));
                        e.dataTransfer.setData('application/json', JSON.stringify(idsToDrag));

                        // Set a drag image as a fallback (browser should handle it usually)
                        const img = (e.currentTarget as HTMLElement).querySelector('img');
                        if (img && e.dataTransfer.setDragImage) {
                            e.dataTransfer.setDragImage(img, 20, 20);
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
                        title={`${image.stack?.length} versions stacked`}
                    >
                        <Layers className="w-3 h-3 text-sage-400" />
                        {image.stack?.length}
                    </div>
                )}
            </div>
        </motion.div>
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
        prev.style.width === next.style.width &&
        prev.style.height === next.style.height &&
        // Check layout pos instead of style.top/left
        prev.layoutPos?.x === next.layoutPos?.x &&
        prev.layoutPos?.y === next.layoutPos?.y
    );
});
