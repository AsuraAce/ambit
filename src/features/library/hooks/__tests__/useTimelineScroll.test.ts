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

    it('skips loading without eligibility or while far from the threshold', () => {
        const onLoadMore = vi.fn();
        const withoutMore = renderTimelineScroll({ hasMoreImages: false, onLoadMore });
        act(() => withoutMore.result.current(createScrollEvent(6500)));
        const withoutCallback = renderTimelineScroll({ hasMoreImages: true });
        act(() => withoutCallback.result.current(createScrollEvent(6500)));
        const farAway = renderTimelineScroll({ hasMoreImages: true, onLoadMore, loadMoreThreshold: 100 });
        act(() => farAway.result.current(createScrollEvent(100)));
        expect(onLoadMore).not.toHaveBeenCalled();
    });

    it('resets the load gate after synchronous failure and logs the error', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onLoadMore = vi.fn()
            .mockImplementationOnce(() => { throw new Error('failed'); })
            .mockResolvedValueOnce(undefined);
        const { result } = renderTimelineScroll({ hasMoreImages: true, onLoadMore });
        act(() => result.current(createScrollEvent(6500)));
        act(() => result.current(createScrollEvent(6500)));
        expect(onLoadMore).toHaveBeenCalledTimes(2);
        expect(error).toHaveBeenCalledWith('[TimelineView] Failed to load more images:', expect.any(Error));
    });

    it('updates sticky header identity, push-off transform, and hidden state', () => {
        const sticky = document.createElement('div');
        const stickyHeaderRef: RefObject<HTMLDivElement | null> = { current: sticky };
        const activeHeaderIdRef: MutableRefObject<string | null> = { current: null };
        const setScrollTop = vi.fn();
        const setActiveHeaderData = vi.fn();
        const headers = [
            { id: 'first', date: 'Jan', count: 2, y: 100, height: 40 },
            { id: 'second', date: 'Feb', count: 3, y: 150, height: 40 },
        ];
        const { result } = renderTimelineScroll({ headers, stickyHeaderRef, activeHeaderIdRef, setScrollTop, setActiveHeaderData });

        act(() => result.current(createScrollEvent(80)));
        expect(sticky.style.transform).toBe('translateY(0px)');
        act(() => result.current(createScrollEvent(100)));
        expect(setScrollTop).toHaveBeenCalledWith(100);
        expect(setActiveHeaderData).toHaveBeenCalledWith({ date: 'Jan', count: 2 });
        expect(sticky.style.transform).toBe('translateY(-10px)');
        expect(sticky.style.opacity).toBe('1');

        act(() => result.current(createScrollEvent(105)));
        expect(setActiveHeaderData).toHaveBeenCalledOnce();
        act(() => result.current(createScrollEvent(151)));
        expect(setActiveHeaderData).toHaveBeenLastCalledWith({ date: 'Feb', count: 3 });
        expect(sticky.style.transform).toBe('translateY(0px)');

        act(() => result.current(createScrollEvent(0)));
        expect(sticky.style.opacity).toBe('0');
        expect(sticky.style.pointerEvents).toBe('none');
        expect(activeHeaderIdRef.current).toBeNull();
    });

    it('returns after scroll tracking without a sticky element', () => {
        const setScrollTop = vi.fn();
        const { result } = renderTimelineScroll({ headers: [{ y: 0, height: 20 }], setScrollTop });
        act(() => result.current(createScrollEvent(20)));
        expect(setScrollTop).toHaveBeenCalledWith(20);
    });
});
