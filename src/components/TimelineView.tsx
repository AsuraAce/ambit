

import * as React from 'react';
import { useRef, useState, useLayoutEffect, useMemo } from 'react';
import { AIImage, SortOption } from '../types';
import { ImageCard } from './ImageCard';
import { Clock } from 'lucide-react';
import { useTimeline } from '../hooks/useTimeline';
import { isImageMasked } from '../utils/maskingUtils';

interface TimelineViewProps {
    images: AIImage[];
    selectedIds: Set<string>;
    thumbnailSize?: number;
    sortOption: SortOption;
    onImageClick: (e: React.MouseEvent, id: string, index: number) => void;
    onSelectionToggle: (e: React.MouseEvent, id: string) => void;
    onToggleFavorite: (e: React.MouseEvent, id: string) => void;
    onContextMenu: (e: React.MouseEvent, id: string) => void;
    onRangeSelection?: (selectedIndexes: number[], isAdditive: boolean) => void;
    onBackgroundClick?: () => void;

    // Privacy Props
    maskedKeywords: string[];
    privacyEnabled: boolean;
    showPinsAsShelf?: boolean;
}
// ... (keep chunk helper if inside range, wait, my target content starts at imports)

// Actually I will target the imports and interface specifically to be safe, then a second chunk for usage? 
// No I can do it in two calls or one big replace if I'm careful.
// Let's do imports and interface first.


// Helper to chunk arrays
const chunk = <T,>(arr: T[], size: number): T[][] => {
    return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
        arr.slice(i * size, i * size + size)
    );
};

export const TimelineView: React.FC<TimelineViewProps> = ({
    images,
    selectedIds,
    thumbnailSize = 250,
    sortOption,
    onImageClick,
    onSelectionToggle,
    onToggleFavorite,
    onContextMenu,
    onRangeSelection,
    onBackgroundClick,
    maskedKeywords,
    privacyEnabled,
    showPinsAsShelf = true
}) => {
    const { groups } = useTimeline(images, sortOption, showPinsAsShelf);
    const containerRef = useRef<HTMLDivElement>(null);
    const stickyHeaderRef = useRef<HTMLDivElement>(null);

    const [width, setWidth] = useState(0);
    const [scrollTop, setScrollTop] = useState(0);

    // Sticky Header State (Content Only)
    const [activeHeaderData, setActiveHeaderData] = useState<{ date: string, count: number } | null>(null);
    const activeHeaderIdRef = useRef<string | null>(null);

    // --- Drag Selection State ---
    const [dragBox, setDragBox] = useState<{ x: number, y: number, w: number, h: number } | null>(null);
    const dragStartRef = useRef<{ x: number, y: number } | null>(null);
    const isDraggingRef = useRef(false);
    const onRangeSelectionRef = useRef(onRangeSelection);
    const onBackgroundClickRef = useRef(onBackgroundClick);

    React.useEffect(() => {
        onRangeSelectionRef.current = onRangeSelection;
        onBackgroundClickRef.current = onBackgroundClick;
    }, [onRangeSelection, onBackgroundClick]);

    // Measure container
    useLayoutEffect(() => {
        if (!containerRef.current) return;
        const observer = new ResizeObserver(entries => {
            if (entries[0]) setWidth(entries[0].contentRect.width);
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    // Layout Calculation
    const { layoutItems, totalHeight, headers } = useMemo(() => {
        if (width === 0) return { layoutItems: [], totalHeight: 0, headers: [] };

        const padding = 24;
        const gap = 16;
        const effectiveWidth = width - (padding * 2);
        const cols = Math.max(1, Math.floor((effectiveWidth + gap) / (thumbnailSize + gap)));
        const itemWidth = (effectiveWidth - (cols - 1) * gap) / cols;
        const rowHeight = itemWidth; // Square aspect ratio (1:1)
        const headerHeight = 60;

        const items: any[] = [];
        const headersList: any[] = [];
        let currentY = padding;
        let globalImageIndex = 0;

        groups.forEach(group => {
            // 1. Header
            const headerItem = {
                type: 'header',
                date: group.date,
                id: group.id,
                count: group.images.length,
                y: currentY,
                height: headerHeight
            };
            items.push(headerItem);
            headersList.push(headerItem);

            currentY += headerHeight;

            if (group.id === 'pinned') {
                // SPECIAL CASE: Horizontal Shelf for Pinned Items
                const shelfHeight = thumbnailSize * 0.8; // Slightly smaller height for shelf
                items.push({
                    type: 'shelf',
                    id: 'pinned-shelf',
                    images: group.images,
                    y: currentY,
                    height: shelfHeight,
                    globalStartIndex: globalImageIndex
                });
                globalImageIndex += group.images.length;
                currentY += shelfHeight + gap;
            } else {
                // 2. Rows (Default Grid)
                const rows = chunk(group.images, cols);
                rows.forEach(rowImages => {
                    const rowItems = rowImages.map((img, colIndex) => ({
                        image: img,
                        x: padding + colIndex * (itemWidth + gap),
                        width: itemWidth,
                        height: rowHeight,
                        globalIndex: globalImageIndex++
                    }));

                    items.push({
                        type: 'row',
                        items: rowItems,
                        y: currentY,
                        height: rowHeight
                    });

                    currentY += rowHeight + gap;
                });
            }

            currentY += 24;
        });

        return { layoutItems: items, totalHeight: currentY, headers: headersList };
    }, [groups, width, thumbnailSize]);

    // Handle Scroll (Optimized for Direct DOM Manipulation)
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const currentScroll = e.currentTarget.scrollTop;
        setScrollTop(currentScroll); // Trigger React render for virtualization

        // --- Direct DOM Sticky Logic ---
        if (!stickyHeaderRef.current || headers.length === 0) return;

        let active = null;
        let next = null;

        // Find active header
        for (let i = 0; i < headers.length; i++) {
            if (headers[i].y <= currentScroll + 20) { // +20 offset for the floating margin
                active = headers[i];
            } else {
                next = headers[i];
                break;
            }
        }

        if (active) {
            // 1. Update Content (Only if changed)
            if (active.id !== activeHeaderIdRef.current) {
                setActiveHeaderData({ date: active.date, count: active.count });
                activeHeaderIdRef.current = active.id;
            }

            // 2. Calculate Push Offset (Direct Math)
            let yOffset = 0;
            const headerHeight = active.height;
            const floatMargin = 20; // Matches CSS top value

            if (next) {
                // Distance from top of scroll viewport to the next header
                // If next header is approaching the "sticky zone"
                const distance = next.y - currentScroll;
                const threshold = headerHeight + floatMargin;

                if (distance < threshold) {
                    yOffset = distance - threshold;
                }
            }

            // 3. Apply Transform Sync
            stickyHeaderRef.current.style.transform = `translateY(${yOffset}px)`;
            stickyHeaderRef.current.style.opacity = '1';
            stickyHeaderRef.current.style.pointerEvents = 'auto';
        } else {
            // Hide if at top (before first header)
            stickyHeaderRef.current.style.opacity = '0';
            stickyHeaderRef.current.style.pointerEvents = 'none';
            activeHeaderIdRef.current = null;
        }
    };

    // --- Selection Handlers ---
    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        // Don't intercept if clicking on a draggable item
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

            if (isDraggingRef.current && dragStartRef.current && onRangeSelectionRef.current) {
                const currentRect = containerRef.current!.getBoundingClientRect();
                const currentX = we.clientX - currentRect.left;
                const currentY = we.clientY - currentRect.top + containerRef.current!.scrollTop;

                const bx = Math.min(dragStartRef.current.x, currentX);
                const by = Math.min(dragStartRef.current.y, currentY);
                const bw = Math.abs(currentX - dragStartRef.current.x);
                const bh = Math.abs(currentY - dragStartRef.current.y);

                const selectedIndexes: number[] = [];

                // Check all layout items that are images
                layoutItems.forEach(item => {
                    if (item.type === 'row') {
                        item.items.forEach((subItem: any) => {
                            const itemX = subItem.x;
                            const itemY = item.y; // Row Y
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

    // Virtualization (Optimized with Binary Search)
    const visibleItems = useMemo(() => {
        const buffer = 1200;
        const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 1000;
        const startY = Math.max(0, scrollTop - buffer);
        const endY = scrollTop + windowHeight + buffer;

        // Binary search for start index
        let start = 0;
        let end = layoutItems.length - 1;
        let startIndex = 0;

        while (start <= end) {
            const mid = Math.floor((start + end) / 2);
            const item = layoutItems[mid];

            if (item.y + item.height < startY) {
                start = mid + 1;
            } else {
                startIndex = mid;
                end = mid - 1;
            }
        }

        // Scan forward from startIndex until we exit the view
        const visible: any[] = [];
        for (let i = startIndex; i < layoutItems.length; i++) {
            const item = layoutItems[i];
            visible.push(item);
            if (item.y > endY) break;
        }

        return visible;
    }, [layoutItems, scrollTop]);

    return (
        <div className="h-full w-full relative">
            {/* Sticky Header Overlay (Persistent DOM Element) */}
            <div
                ref={stickyHeaderRef}
                className="absolute left-6 right-8 px-4 flex items-center gap-3 z-20 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-gray-200 dark:border-white/10 shadow-lg rounded-2xl transition-opacity duration-75 will-change-transform"
                style={{
                    top: 20,
                    height: 60, // Matches headerHeight
                    opacity: 0, // Hidden by default
                    pointerEvents: 'none'
                }}
            >
                <div className="p-2 bg-sage-100 dark:bg-sage-900/50 rounded-full text-sage-600 dark:text-sage-400">
                    <Clock className="w-4 h-4" />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
                        {activeHeaderData?.date}
                    </h3>
                    <div className="text-[10px] text-gray-500 font-medium">{activeHeaderData?.count} images</div>
                </div>
            </div>

            {/* Scroll Container */}
            <div
                ref={containerRef}
                className="h-full w-full overflow-y-auto custom-scrollbar relative"
                onScroll={handleScroll}
                onMouseDown={handleMouseDown}
            >
                <div style={{ height: totalHeight, position: 'relative' }} className="overflow-hidden">
                    {visibleItems.map((item, i) => {
                        if (item.type === 'header') {
                            return (
                                <div
                                    key={`h-${item.id}`} // Stable header ID
                                    className="absolute left-0 w-full px-6 flex items-center gap-3"
                                    style={{ top: item.y, height: item.height }}
                                >
                                    <div className="p-2 bg-sage-100 dark:bg-sage-900/30 rounded-full text-sage-600 dark:text-sage-400 opacity-50">
                                        <Clock className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider">
                                            {item.date}
                                        </h3>
                                        <div className="text-[10px] text-gray-400 font-medium">{item.count} images</div>
                                    </div>
                                    <div className="flex-1 h-px bg-gray-200 dark:bg-white/5 ml-4" />
                                </div>
                            );
                        } else if (item.type === 'shelf') {
                            return (
                                <div
                                    key={item.id}
                                    className="absolute w-full px-6 flex gap-4 overflow-x-auto custom-scrollbar no-scrollbar-y pb-2 group/shelf"
                                    style={{ top: item.y, height: item.height }}
                                >
                                    {item.images.map((img: AIImage, idx: number) => {
                                        const globalIndex = item.globalStartIndex + idx;
                                        return (
                                            <div
                                                key={img.id}
                                                className="flex-shrink-0"
                                                style={{
                                                    width: item.height,
                                                    height: item.height
                                                }}
                                            >
                                                <ImageCard
                                                    image={img}
                                                    isSelected={selectedIds.has(img.id)}
                                                    isMasked={isImageMasked(img, privacyEnabled, maskedKeywords)}
                                                    onDragStart={(e) => {
                                                        const idsToDrag = selectedIds.has(img.id) ? Array.from(selectedIds) : [img.id];
                                                        e.dataTransfer.effectAllowed = 'copyMove';
                                                        e.dataTransfer.setData('text/plain', JSON.stringify(idsToDrag));
                                                        e.dataTransfer.setData('application/json', JSON.stringify(idsToDrag));

                                                        const dragImg = (e.currentTarget as HTMLElement).querySelector('img');
                                                        if (dragImg && e.dataTransfer.setDragImage) {
                                                            e.dataTransfer.setDragImage(dragImg, 20, 20);
                                                        }
                                                    }}
                                                    onClick={(e) => onImageClick(e, img.id, globalIndex)}
                                                    onToggleSelection={(e) => onSelectionToggle(e, img.id)}
                                                    onToggleFavorite={(e) => onToggleFavorite(e, img.id)}
                                                    onContextMenu={(e) => {
                                                        e.preventDefault();
                                                        onContextMenu(e, img.id);
                                                    }}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        } else {
                            // Use first image ID as stable key for row matches
                            const rowKey = item.items[0]?.image.id || `r-${item.y}`;
                            return (
                                <div key={rowKey} className="absolute w-full" style={{ top: item.y, height: item.height }}>
                                    {item.items.map((subItem: any) => (
                                        <div
                                            key={subItem.image.id}
                                            style={{
                                                position: 'absolute',
                                                left: subItem.x,
                                                width: subItem.width,
                                                height: subItem.height
                                            }}
                                        >
                                            <ImageCard
                                                image={subItem.image}
                                                isSelected={selectedIds.has(subItem.image.id)}
                                                isMasked={isImageMasked(subItem.image, privacyEnabled, maskedKeywords)}
                                                onDragStart={(e) => {
                                                    const idsToDrag = selectedIds.has(subItem.image.id) ? Array.from(selectedIds) : [subItem.image.id];
                                                    e.dataTransfer.effectAllowed = 'copyMove';
                                                    e.dataTransfer.setData('text/plain', JSON.stringify(idsToDrag));
                                                    e.dataTransfer.setData('application/json', JSON.stringify(idsToDrag));

                                                    // Set drag image
                                                    const img = (e.currentTarget as HTMLElement).querySelector('img');
                                                    if (img && e.dataTransfer.setDragImage) {
                                                        e.dataTransfer.setDragImage(img, 20, 20);
                                                    }
                                                }}
                                                onClick={(e) => onImageClick(e, subItem.image.id, subItem.globalIndex)}
                                                onToggleSelection={(e) => onSelectionToggle(e, subItem.image.id)}
                                                onToggleFavorite={(e) => onToggleFavorite(e, subItem.image.id)}
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    onContextMenu(e, subItem.image.id);
                                                }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            );
                        }
                    })}

                    {images.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                            No images found in this timeframe.
                        </div>
                    )}
                </div>

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