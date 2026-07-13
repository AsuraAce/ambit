import * as React from 'react';
import { ChevronDown, ChevronUp, Pin } from 'lucide-react';
import { AIImage } from '../../../types';
import { GridItem } from './GridItem';
import { useSettingsStore } from '../../../stores/settingsStore';

interface PinnedShelfProps {
    images: AIImage[];
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    // Props required for GridItem
    selectedIds: Set<string>;
    maskedKeywords: string[];
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    onImageClick: (e: React.MouseEvent, id: string, index: number) => void;
    onToggleSelection: (e: React.MouseEvent, id: string) => void;
    onTogglePin: (e: React.MouseEvent, id: string) => void;
    onToggleFavorite: (e: React.MouseEvent, id: string) => void;
    onContextMenu: (e: React.MouseEvent, id: string) => void;
    thumbnailSize: number;
    isActiveThumbnail?: (image: AIImage) => boolean;
    onRangeSelection?: (selectedIndexes: number[], isAdditive: boolean) => void;
    onBackgroundClick?: () => void;
}

export const PinnedShelf: React.FC<PinnedShelfProps> = ({
    images,
    isCollapsed,
    onToggleCollapse,
    selectedIds,
    maskedKeywords,
    setImages,
    onImageClick,
    onToggleSelection,
    onTogglePin,
    onToggleFavorite,
    onContextMenu,
    thumbnailSize,
    isActiveThumbnail,
    onRangeSelection,
    onBackgroundClick
}) => {
    const privacyEnabled = useSettingsStore(s => s.privacyEnabled);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [dragBox, setDragBox] = React.useState<{ x: number, y: number, w: number, h: number } | null>(null);
    const dragStartRef = React.useRef<{ x: number, y: number } | null>(null);
    const isDraggingRef = React.useRef(false);
    const onRangeSelectionRef = React.useRef(onRangeSelection);
    const onBackgroundClickRef = React.useRef(onBackgroundClick);

    React.useEffect(() => {
        onRangeSelectionRef.current = onRangeSelection;
        onBackgroundClickRef.current = onBackgroundClick;
    }, [onRangeSelection, onBackgroundClick]);

    if (images.length === 0) return null;

    // Calculate layout for the "Collapsed" state (1 row)
    // We assume a simple responsive grid
    // For the collapsed state, we just set a max-height/overflow hidden

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        // Don't intercept if clicking on a draggable item
        if ((e.target as HTMLElement).closest('[data-drag-source="true"]')) return;

        e.preventDefault();
        const container = containerRef.current!;
        const rect = container.getBoundingClientRect();
        const startX = e.clientX - rect.left;
        const startY = e.clientY - rect.top + container.scrollTop;

        dragStartRef.current = { x: startX, y: startY };
        isDraggingRef.current = false;

        const handleWindowMove = (we: MouseEvent) => {
            if (!dragStartRef.current || !containerRef.current) return;

            const currentRect = containerRef.current.getBoundingClientRect();
            const currentX = we.clientX - currentRect.left;
            const currentY = we.clientY - currentRect.top + containerRef.current.scrollTop;

            if (!isDraggingRef.current) {
                const dx = Math.abs(currentX - dragStartRef.current.x);
                const dy = Math.abs(currentY - dragStartRef.current.y);
                if (dx > 5 || dy > 5) isDraggingRef.current = true;
            }

            if (isDraggingRef.current) {
                setDragBox({
                    x: Math.min(dragStartRef.current.x, currentX),
                    y: Math.min(dragStartRef.current.y, currentY),
                    w: Math.abs(currentX - dragStartRef.current.x),
                    h: Math.abs(currentY - dragStartRef.current.y)
                });
            }
        };

        const handleWindowUp = (we: MouseEvent) => {
            window.removeEventListener('mousemove', handleWindowMove);
            window.removeEventListener('mouseup', handleWindowUp);

            if (isDraggingRef.current && dragStartRef.current && onRangeSelectionRef.current) {
                const currentRect = containerRef.current!.getBoundingClientRect();
                const currentX = we.clientX - currentRect.left;
                const currentY = we.clientY - currentRect.top + containerRef.current!.scrollTop;

                const bx = Math.min(dragStartRef.current.x, currentX);
                const by = Math.min(dragStartRef.current.y, currentY);
                const bw = Math.abs(currentX - dragStartRef.current.x);
                const bh = Math.abs(currentY - dragStartRef.current.y);

                const selectedIndexes: number[] = [];
                const itemNodes = containerRef.current!.querySelectorAll('[data-pinned-item-index]');

                itemNodes.forEach((node) => {
                    const idx = parseInt(node.getAttribute('data-pinned-item-index') || '0');
                    const rect = node.getBoundingClientRect();
                    const containerRect = containerRef.current!.getBoundingClientRect();

                    const itemX = rect.left - containerRect.left;
                    const itemY = rect.top - containerRect.top + containerRef.current!.scrollTop;
                    const itemW = rect.width;
                    const itemH = rect.height;

                    const overlap = (
                        itemX < bx + bw &&
                        itemX + itemW > bx &&
                        itemY < by + bh &&
                        itemY + itemH > by
                    );

                    if (overlap) selectedIndexes.push(idx);
                });

                onRangeSelectionRef.current(selectedIndexes, we.shiftKey);
            } else if (!isDraggingRef.current && onBackgroundClickRef.current) {
                onBackgroundClickRef.current();
            }

            setDragBox(null);
            dragStartRef.current = null;
            isDraggingRef.current = false;
        };

        window.addEventListener('mousemove', handleWindowMove);
        window.addEventListener('mouseup', handleWindowUp);
    };

    return (
        <div className="flex flex-col border-b border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-transparent backdrop-blur-sm z-10 shrink-0 transition-all duration-300">
            {/* Header */}
            <button
                type="button"
                aria-expanded={!isCollapsed}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                }}
                onClick={onToggleCollapse}
                className="flex items-center justify-between px-6 py-3 select-none cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
                <div className="flex items-center gap-2 text-sage-600 dark:text-sage-400 font-bold text-sm">
                    <Pin className="w-4 h-4 fill-current" />
                    <span>Pinned</span>
                    <span className="bg-sage-200 dark:bg-sage-900 text-sage-700 dark:text-sage-300 px-2 py-0.5 rounded-full text-xs ml-1 font-mono">
                        {images.length}
                    </span>
                </div>
                <span className="p-1 rounded-full text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors" aria-hidden="true">
                    {isCollapsed ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
                </span>
            </button>

            {/* Grid Content */}
            <div
                ref={containerRef}
                onMouseDown={handleMouseDown}
                className={`px-6 pb-4 transition-all duration-500 ease-spring overflow-hidden relative ${isCollapsed ? 'overflow-y-hidden' : 'overflow-y-auto custom-scrollbar'}`}
                style={{
                    maxHeight: isCollapsed ? `${thumbnailSize + 32}px` : '60vh' // 32px for padding. ensures 1 row is visible.
                }}
            >
                <div
                    className="flex flex-wrap gap-4 w-full"
                >
                    {images.map((img, index) => {
                        const ratio = (img.width || 1) / (img.height || 1);
                        const width = thumbnailSize * ratio;

                        return (
                            <div
                                key={img.id}
                                style={{
                                    height: thumbnailSize,
                                    width: width,
                                    flexGrow: ratio, // Grow proportional to aspect ratio keeps scaling natural
                                    minWidth: thumbnailSize * 0.5,
                                    maxWidth: thumbnailSize * 3 // prevent ultra-wide
                                }}
                                className="relative"
                                data-pinned-item-index={index}
                            >
                                <GridItem
                                    image={img}
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        position: 'relative',
                                        top: 0, left: 0
                                    }}
                                    index={index} // This is the GLOBAL index 0..N because Pinned images are at the start
                                    isSelected={selectedIds.has(img.id)}
                                    selectedIds={selectedIds}
                                    maskedKeywords={maskedKeywords}
                                    setImages={setImages}
                                    onClick={onImageClick}
                                    onToggleSelection={onToggleSelection}
                                    onTogglePin={onTogglePin}
                                    onToggleFavorite={onToggleFavorite}
                                    onContextMenu={onContextMenu}
                                    isThumbnail={isActiveThumbnail?.(img) ?? false}
                                />
                            </div>
                        );
                    })}
                    {/* Spacer to prevent last row from stretching too much */}
                    <div style={{ flexGrow: 100, height: 0 }} />
                </div>
                {/* Fade overlay for collapsed state if deeply overflowed */}
                {isCollapsed && images.length > 5 && (
                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-gray-50 dark:from-[#111] to-transparent pointer-events-none opacity-80" />
                )}

                {dragBox && (
                    <div
                        className="absolute bg-sage-500/30 border-2 border-sage-400 z-50 pointer-events-none rounded-sm shadow-[0_0_15px_rgba(115,140,85,0.4)]"
                        style={{
                            left: dragBox.x,
                            top: dragBox.y,
                            width: dragBox.w,
                            height: dragBox.h
                        }}
                    />
                )}
            </div>
        </div>
    );
};
