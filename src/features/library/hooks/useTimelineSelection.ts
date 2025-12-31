import { useState, useRef, useEffect } from 'react';

interface UseTimelineSelectionProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    layoutItems: any[];
    onRangeSelection?: (selectedIndexes: number[], isAdditive: boolean) => void;
    onBackgroundClick?: () => void;
}

export const useTimelineSelection = ({
    containerRef,
    layoutItems,
    onRangeSelection,
    onBackgroundClick
}: UseTimelineSelectionProps) => {
    const [dragBox, setDragBox] = useState<{ x: number, y: number, w: number, h: number } | null>(null);
    const dragStartRef = useRef<{ x: number, y: number } | null>(null);
    const isDraggingRef = useRef(false);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest('[data-draggable="true"]')) return;
        if (!containerRef.current) return;

        e.preventDefault();
        const rect = containerRef.current.getBoundingClientRect();
        const startX = e.clientX - rect.left;
        const startY = e.clientY - rect.top + containerRef.current.scrollTop;

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

            if (isDraggingRef.current && dragStartRef.current && onRangeSelection) {
                const currentRect = containerRef.current!.getBoundingClientRect();
                const currentX = we.clientX - currentRect.left;
                const currentY = we.clientY - currentRect.top + containerRef.current!.scrollTop;

                const bx = Math.min(dragStartRef.current.x, currentX);
                const by = Math.min(dragStartRef.current.y, currentY);
                const bw = Math.abs(currentX - dragStartRef.current.x);
                const bh = Math.abs(currentY - dragStartRef.current.y);

                const selectedIndexes: number[] = [];

                layoutItems.forEach(item => {
                    if (item.type === 'row') {
                        item.items.forEach((subItem: any) => {
                            const itemX = subItem.x;
                            const itemY = item.y;
                            const itemW = subItem.width;
                            const itemH = subItem.height;

                            const overlap = (
                                itemX < bx + bw &&
                                itemX + itemW > bx &&
                                itemY < by + bh &&
                                itemY + itemH > by
                            );

                            if (overlap) selectedIndexes.push(subItem.globalIndex);
                        });
                    }
                });

                onRangeSelection(selectedIndexes, we.shiftKey);
            } else if (!isDraggingRef.current && onBackgroundClick) {
                onBackgroundClick();
            }

            setDragBox(null);
            dragStartRef.current = null;
            isDraggingRef.current = false;
        };

        window.addEventListener('mousemove', handleWindowMove);
        window.addEventListener('mouseup', handleWindowUp);
    };

    return { dragBox, handleMouseDown };
};
