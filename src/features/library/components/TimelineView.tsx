
import * as React from 'react';
import { useRef, useState, useLayoutEffect } from 'react';
import { AIImage, SortOption } from '../../../types';
import { ImageCard } from './ImageCard';
import { Clock } from 'lucide-react';
import { useTimeline } from '../../../hooks/useTimeline';
import { isImageMasked } from '../../../utils/maskingUtils';
import { useTimelineLayout } from '../hooks/useTimelineLayout';
import { useTimelineSelection } from '../hooks/useTimelineSelection';
import { useTimelineScroll } from '../hooks/useTimelineScroll';
import { useSettingsStore } from '../../../stores/settingsStore';

interface TimelineViewProps {
    images: AIImage[];
    selectedIds: Set<string>;
    thumbnailSize?: number;
    sortOption: SortOption;
    onImageClick: (e: React.MouseEvent, id: string, index: number) => void;
    onSelectionToggle: (e: React.MouseEvent, id: string) => void;
    onToggleFavorite: (e: React.MouseEvent, id: string) => void;
    onTogglePin?: (e: React.MouseEvent, id: string) => void;
    onContextMenu: (e: React.MouseEvent, id: string) => void;
    onRangeSelection?: (selectedIndexes: number[], isAdditive: boolean) => void;
    onBackgroundClick?: () => void;
    hasMoreImages?: boolean;
    isLoadingMore?: boolean;
    onLoadMore?: () => void | Promise<void>;
    maskedKeywords: string[];
}

export const TimelineView: React.FC<TimelineViewProps> = ({
    images,
    selectedIds,
    thumbnailSize = 250,
    sortOption,
    onImageClick,
    onSelectionToggle,
    onToggleFavorite,
    onTogglePin,
    onContextMenu,
    onRangeSelection,
    onBackgroundClick,
    hasMoreImages = false,
    isLoadingMore = false,
    onLoadMore,
    maskedKeywords
}) => {
    const privacyEnabled = useSettingsStore(s => s.privacyEnabled);
    const { groups } = useTimeline(images, sortOption);
    const timelineSourceIndexes = React.useMemo(() => {
        const sourceIndexById = new Map(images.map((image, index) => [image.id, index]));

        return groups.flatMap(group =>
            group.images.map(image => sourceIndexById.get(image.id) ?? -1)
        );
    }, [groups, images]);
    const containerRef = useRef<HTMLDivElement>(null);
    const stickyHeaderRef = useRef<HTMLDivElement>(null);

    const [width, setWidth] = useState(0);
    const [scrollTop, setScrollTop] = useState(0);

    // Measure container
    useLayoutEffect(() => {
        if (!containerRef.current) return;
        const observer = new ResizeObserver(entries => {
            if (entries[0]) setWidth(entries[0].contentRect.width);
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    // Layout Hook
    const {
        totalHeight,
        headers,
        visibleItems,
        activeHeaderData,
        setActiveHeaderData,
        activeHeaderIdRef
    } = useTimelineLayout({ groups, width, thumbnailSize, scrollTop });

    const handleTimelineRangeSelection = React.useCallback((selectedIndexes: number[], isAdditive: boolean) => {
        if (!onRangeSelection) return;

        const sourceIndexes = selectedIndexes
            .map(index => timelineSourceIndexes[index])
            .filter((index): index is number => index !== undefined && index >= 0);

        onRangeSelection(sourceIndexes, isAdditive);
    }, [onRangeSelection, timelineSourceIndexes]);

    // Selection Hook
    const { dragBox, handleMouseDown } = useTimelineSelection({
        containerRef,
        layoutItems: visibleItems, // We can use visible items or all items, visible is enough for overlap check if we search correctly
        onRangeSelection: handleTimelineRangeSelection,
        onBackgroundClick
    });

    // Scroll Hook
    const handleScroll = useTimelineScroll({
        headers,
        stickyHeaderRef,
        activeHeaderIdRef,
        setScrollTop,
        setActiveHeaderData,
        hasMoreImages,
        isLoadingMore,
        onLoadMore
    });

    const loadingMoreHeight = isLoadingMore && images.length > 0 ? 80 : 0;

    return (
        <div className="h-full w-full relative">
            {/* Sticky Header Overlay */}
            <div
                ref={stickyHeaderRef}
                className="absolute left-6 right-8 px-4 flex items-center gap-3 z-20 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-gray-200 dark:border-white/10 shadow-lg rounded-2xl transition-opacity duration-75 will-change-transform"
                style={{ top: 20, height: 60, opacity: 0, pointerEvents: 'none' }}
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
                <div style={{ height: totalHeight + loadingMoreHeight, position: 'relative' }} className="overflow-hidden">
                    {visibleItems.map((item) => {
                        if (item.type === 'header') {
                            return (
                                <div
                                    key={`h-${item.id}`}
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
                            const rowKey = item.items?.[0]?.image.id || `r-${item.y}`;
                            return (
                                <div key={rowKey} className="absolute w-full" style={{ top: item.y, height: item.height }}>
                                    {item.items?.map((subItem) => (
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
                                                    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : [subItem.image.id];
                                                    try {
                                                        e.dataTransfer.effectAllowed = 'copyMove';
                                                        e.dataTransfer.setData('application/x-ambit-image-ids', JSON.stringify(ids));
                                                        e.dataTransfer.setData('text/plain', `ambit:${ids.length} images`);
                                                    } catch (err) {
                                                        console.error('[TimelineView] Failed to set drag data:', err);
                                                    }
                                                }}
                                                onClick={(e) => onImageClick(e, subItem.image.id, timelineSourceIndexes[subItem.globalIndex] ?? subItem.globalIndex)}
                                                onToggleSelection={(e) => onSelectionToggle(e, subItem.image.id)}
                                                onToggleFavorite={(e) => onToggleFavorite(e, subItem.image.id)}
                                                onTogglePin={onTogglePin ? (e) => onTogglePin(e, subItem.image.id) : undefined}
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

                    {loadingMoreHeight > 0 && (
                        <div
                            className="absolute left-0 w-full flex items-center justify-center gap-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500"
                            style={{ top: totalHeight, height: loadingMoreHeight }}
                        >
                            <div className="h-5 w-5 rounded-full border-2 border-sage-500/20 border-t-sage-500 animate-spin" />
                            Loading older images
                        </div>
                    )}
                </div>

                {dragBox && (
                    <div
                        className="absolute bg-sage-500/30 border-2 border-sage-400 z-50 pointer-events-none rounded-sm shadow-[0_0_15px_rgba(115,140,85,0.4)]"
                        style={{ left: dragBox.x, top: dragBox.y, width: dragBox.w, height: dragBox.h }}
                    />
                )}
            </div>
        </div>
    );
};
