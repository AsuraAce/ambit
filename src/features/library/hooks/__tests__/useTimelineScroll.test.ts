import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MutableRefObject, RefObject, UIEvent } from 'react';
import { useTimelineScroll } from '../useTimelineScroll';

type TimelineScrollProps = Parameters<typeof useTimelineScroll>[0];

const createScrollEvent = (
    scrollTop: number,
    scrollHeight = 10000,
    clientHeight = 3000
): UIEvent<HTMLDivElement> => ({
    currentTarget: {
        scrollTop,
        scrollHeight,
        clientHeight
    } as HTMLDivElement
} as UIEvent<HTMLDivElement>);

const renderTimelineScroll = (overrides: Partial<TimelineScrollProps> = {}) => {
    const stickyHeaderRef: RefObject<HTMLDivElement | null> = { current: null };
    const activeHeaderIdRef: MutableRefObject<string | null> = { current: null };

    return renderHook(() => useTimelineScroll({
        headers: [],
        stickyHeaderRef,
        activeHeaderIdRef,
        setScrollTop: vi.fn(),
        setActiveHeaderData: vi.fn(),
        ...overrides
    }));
};

describe('useTimelineScroll', () => {
    it('requests more images when scrolling near the bottom', () => {
        const onLoadMore = vi.fn().mockResolvedValue(undefined);
        const { result } = renderTimelineScroll({
            hasMoreImages: true,
            isLoadingMore: false,
            onLoadMore
        });

        act(() => {
            result.current(createScrollEvent(6500));
        });

        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('does not request more images while a page is already loading', () => {
        const onLoadMore = vi.fn();
        const { result } = renderTimelineScroll({
            hasMoreImages: true,
            isLoadingMore: true,
            onLoadMore
        });

        act(() => {
            result.current(createScrollEvent(6500));
        });

        expect(onLoadMore).not.toHaveBeenCalled();
    });

    it('does not request another page while the previous request is pending', () => {
        let resolveLoad: () => void = () => undefined;
        const pendingLoad = new Promise<void>((resolve) => {
            resolveLoad = resolve;
        });
        const onLoadMore = vi.fn(() => pendingLoad);
        const { result } = renderTimelineScroll({
            hasMoreImages: true,
            isLoadingMore: false,
            onLoadMore
        });

        act(() => {
            result.current(createScrollEvent(6500));
            result.current(createScrollEvent(6600));
        });

        expect(onLoadMore).toHaveBeenCalledTimes(1);
        resolveLoad();
    });
});
