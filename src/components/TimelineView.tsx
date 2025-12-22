

import * as React from 'react';
import { useRef, useState, useLayoutEffect, useMemo } from 'react';
import { AIImage, SortOption } from '../types';
import { ImageCard } from './ImageCard';
import { Clock } from 'lucide-react';
import { useTimeline } from '../hooks/useTimeline';

interface TimelineViewProps {
    images: AIImage[];
    selectedIds: Set<string>;
    thumbnailSize?: number;
    sortOption: SortOption;
    onImageClick: (e: React.MouseEvent, id: string, index: number) => void;
    onSelectionToggle: (e: React.MouseEvent, id: string) => void;
    onToggleFavorite: (e: React.MouseEvent, id: string) => void;
    onContextMenu: (e: React.MouseEvent, id: string) => void;
}

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
    onContextMenu
}) => {
    const { groups } = useTimeline(images, sortOption);
    const containerRef = useRef<HTMLDivElement>(null);
    const stickyHeaderRef = useRef<HTMLDivElement>(null);

    const [width, setWidth] = useState(0);
    const [scrollTop, setScrollTop] = useState(0);

    // Sticky Header State (Content Only)
    const [activeHeaderData, setActiveHeaderData] = useState<{ date: string, count: number } | null>(null);
    const activeHeaderIdRef = useRef<string | null>(null);

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

            // 2. Rows
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
            >
                <div style={{ height: totalHeight, position: 'relative' }}>
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
            </div>
        </div>
    );
};