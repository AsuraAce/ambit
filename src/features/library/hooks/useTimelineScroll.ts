import { useCallback, useRef } from 'react';
import type { MutableRefObject, RefObject, UIEvent } from 'react';

interface TimelineHeaderItem {
    y: number;
    height: number;
    id?: string;
    date?: string;
    count?: number;
}

interface UseTimelineScrollProps {
    headers: TimelineHeaderItem[];
    stickyHeaderRef: RefObject<HTMLDivElement | null>;
    activeHeaderIdRef: MutableRefObject<string | null>;
    setScrollTop: (top: number) => void;
    setActiveHeaderData: (data: { date: string, count: number } | null) => void;
    hasMoreImages?: boolean;
    isLoadingMore?: boolean;
    onLoadMore?: () => void | Promise<void>;
    loadMoreThreshold?: number;
}

export const useTimelineScroll = ({
    headers,
    stickyHeaderRef,
    activeHeaderIdRef,
    setScrollTop,
    setActiveHeaderData,
    hasMoreImages = false,
    isLoadingMore = false,
    onLoadMore,
    loadMoreThreshold = 6000
}: UseTimelineScrollProps) => {
    const loadMoreRequestedRef = useRef(false);

    const maybeLoadMore = useCallback((container: HTMLDivElement) => {
        if (!hasMoreImages || isLoadingMore || !onLoadMore || loadMoreRequestedRef.current) return;

        const distanceFromBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
        if (distanceFromBottom >= loadMoreThreshold) return;

        loadMoreRequestedRef.current = true;

        try {
            const result = onLoadMore();
            void Promise.resolve(result).finally(() => {
                loadMoreRequestedRef.current = false;
            });
        } catch (error) {
            loadMoreRequestedRef.current = false;
            console.error('[TimelineView] Failed to load more images:', error);
        }
    }, [hasMoreImages, isLoadingMore, onLoadMore, loadMoreThreshold]);

    return useCallback((e: UIEvent<HTMLDivElement>) => {
        const currentTarget = e.currentTarget;
        const currentScroll = currentTarget.scrollTop;
        setScrollTop(currentScroll);
        maybeLoadMore(currentTarget);

        if (!stickyHeaderRef.current || headers.length === 0) return;

        let active: TimelineHeaderItem | null = null;
        let next: TimelineHeaderItem | null = null;

        for (let i = 0; i < headers.length; i++) {
            if (headers[i].y <= currentScroll + 20) {
                active = headers[i];
            } else {
                next = headers[i];
                break;
            }
        }

        if (active) {
            if (active.id !== activeHeaderIdRef.current) {
                setActiveHeaderData({ date: active.date!, count: active.count! });
                activeHeaderIdRef.current = active.id!;
            }

            let yOffset = 0;
            const headerHeight = active.height;
            const floatMargin = 20;

            if (next) {
                const distance = next.y - currentScroll;
                const threshold = headerHeight + floatMargin;

                if (distance < threshold) {
                    yOffset = distance - threshold;
                }
            }

            stickyHeaderRef.current.style.transform = `translateY(${yOffset}px)`;
            stickyHeaderRef.current.style.opacity = '1';
            stickyHeaderRef.current.style.pointerEvents = 'auto';
        } else {
            stickyHeaderRef.current.style.opacity = '0';
            stickyHeaderRef.current.style.pointerEvents = 'none';
            activeHeaderIdRef.current = null;
        }
    }, [headers, stickyHeaderRef, activeHeaderIdRef, setScrollTop, maybeLoadMore, setActiveHeaderData]);
};
