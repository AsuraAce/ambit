import { useState, useMemo, useLayoutEffect, useRef } from 'react';
import { AIImage } from '../../../types';

export interface TimelineGroup {
    id: string;
    date: string;
    images: AIImage[];
}

export interface TimelineRowItem {
    image: AIImage;
    x: number;
    width: number;
    height: number;
    globalIndex: number;
}

export interface LayoutItem {
    type: 'header' | 'row' | 'shelf';
    y: number;
    height: number;
    id?: string;
    date?: string;
    count?: number;
    items?: TimelineRowItem[];
}

interface UseTimelineLayoutProps {
    groups: TimelineGroup[];
    width: number;
    thumbnailSize: number;
    scrollTop: number;
}

const chunk = <T,>(arr: T[], size: number): T[][] => {
    return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
        arr.slice(i * size, i * size + size)
    );
};

export const useTimelineLayout = ({ groups, width, thumbnailSize, scrollTop }: UseTimelineLayoutProps) => {
    const [activeHeaderData, setActiveHeaderData] = useState<{ date: string, count: number } | null>(null);
    const activeHeaderIdRef = useRef<string | null>(null);

    const { layoutItems, totalHeight, headers } = useMemo(() => {
        if (width === 0) return { layoutItems: [], totalHeight: 0, headers: [] };

        const padding = 24;
        const gap = 16;
        const effectiveWidth = width - (padding * 2);
        const cols = Math.max(1, Math.floor((effectiveWidth + gap) / (thumbnailSize + gap)));
        const itemWidth = (effectiveWidth - (cols - 1) * gap) / cols;
        const rowHeight = itemWidth;
        const headerHeight = 60;

        const items: LayoutItem[] = [];
        const headersList: LayoutItem[] = [];
        let currentY = padding;
        let globalImageIndex = 0;

        groups.forEach(group => {
            const headerItem: LayoutItem = {
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

    // Virtualization (Optimized with Binary Search)
    const visibleItems = useMemo(() => {
        const buffer = 1200;
        const windowHeight = window.innerHeight;
        const startY = Math.max(0, scrollTop - buffer);
        const endY = scrollTop + windowHeight + buffer;

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

        const visible: LayoutItem[] = [];
        for (let i = startIndex; i < layoutItems.length; i++) {
            const item = layoutItems[i];
            visible.push(item);
            if (item.y > endY) break;
        }

        return visible;
    }, [layoutItems, scrollTop]);

    return {
        layoutItems,
        totalHeight,
        headers,
        visibleItems,
        activeHeaderData,
        setActiveHeaderData,
        activeHeaderIdRef
    };
};
