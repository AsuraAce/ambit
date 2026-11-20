import { useLayoutEffect } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGalleryMotion, UseGalleryMotionOptions } from '../useGalleryMotion';

const createMatchMedia = (matches: boolean) =>
    vi.fn(
        (query: string): MediaQueryList =>
            ({
                matches,
                media: query,
                onchange: null,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                addListener: vi.fn(),
                removeListener: vi.fn(),
                dispatchEvent: vi.fn(),
            }) as unknown as MediaQueryList
    );

const renderGalleryMotion = (initialProps: UseGalleryMotionOptions) =>
    renderHook((props: UseGalleryMotionOptions) => useGalleryMotion(props), { initialProps });

describe('useGalleryMotion', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('matchMedia', createMatchMedia(false));
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('does not animate on the first render', () => {
        const { result } = renderGalleryMotion({ transitionKey: 'initial', visibleItemCount: 20 });

        expect(result.current.shouldAnimateLayout).toBe(false);
        expect(result.current.shouldAnimateGrid).toBe(false);
        expect(result.current.layoutTransition).toBe(
            'transform 260ms cubic-bezier(0.2, 1.12, 0.22, 1), width 220ms cubic-bezier(0.16, 1, 0.3, 1), height 220ms cubic-bezier(0.16, 1, 0.3, 1)'
        );
        expect(result.current.gridTransition).toBe('opacity 180ms ease-out');
    });

    it('activates layout and grid motion when the transition key changes', () => {
        const { result, rerender } = renderGalleryMotion({ transitionKey: 'initial', visibleItemCount: 20 });

        rerender({ transitionKey: 'layout:grid', visibleItemCount: 20 });

        expect(result.current.shouldAnimateLayout).toBe(true);
        expect(result.current.shouldAnimateGrid).toBe(true);

        act(() => {
            vi.advanceTimersByTime(181);
        });

        expect(result.current.shouldAnimateLayout).toBe(true);
        expect(result.current.shouldAnimateGrid).toBe(false);

        act(() => {
            vi.advanceTimersByTime(78);
        });

        expect(result.current.shouldAnimateLayout).toBe(true);

        act(() => {
            vi.advanceTimersByTime(1);
        });

        expect(result.current.shouldAnimateLayout).toBe(false);
        expect(result.current.shouldAnimateGrid).toBe(false);
    });

    // Cards must already carry their transition when they move to the new layout; motion that
    // arrives one commit later would let the first layout jump without animating.
    it('animates in the first commit after the transition key changes, with a single commit', () => {
        const commits: Array<{ layout: boolean; grid: boolean }> = [];
        const { rerender } = renderHook(
            (props: UseGalleryMotionOptions) => {
                const motion = useGalleryMotion(props);
                useLayoutEffect(() => {
                    commits.push({ layout: motion.shouldAnimateLayout, grid: motion.shouldAnimateGrid });
                });
                return motion;
            },
            { initialProps: { transitionKey: 'initial', visibleItemCount: 20 } }
        );

        commits.length = 0;
        rerender({ transitionKey: 'layout:grid', visibleItemCount: 20 });

        expect(commits).toEqual([{ layout: true, grid: true }]);
    });

    it('disables layout and grid motion when reduced motion is preferred', () => {
        vi.stubGlobal('matchMedia', createMatchMedia(true));

        const { result, rerender } = renderGalleryMotion({ transitionKey: 'initial', visibleItemCount: 20 });

        rerender({ transitionKey: 'layout:grid', visibleItemCount: 20 });

        expect(result.current.shouldAnimateLayout).toBe(false);
        expect(result.current.shouldAnimateGrid).toBe(false);
    });

    // Reduced motion cancels the window timers, so a window left open would reappear as animation the moment
    // motion is allowed again, with no transition-key change to justify it.
    it('closes both motion windows when reduced motion turns on mid-animation and does not revive them when it turns off', () => {
        let reduced = false;
        const listeners: Array<() => void> = [];
        vi.stubGlobal(
            'matchMedia',
            vi.fn(
                (query: string) =>
                    ({
                        get matches() {
                            return reduced;
                        },
                        media: query,
                        addEventListener: (_event: string, listener: () => void) => listeners.push(listener),
                        removeEventListener: vi.fn(),
                    }) as unknown as MediaQueryList
            )
        );
        const setReducedMotion = (value: boolean) => {
            reduced = value;
            act(() => listeners.forEach((listener) => listener()));
        };

        const { result, rerender } = renderGalleryMotion({ transitionKey: 'initial', visibleItemCount: 20 });
        rerender({ transitionKey: 'layout:grid', visibleItemCount: 20 });
        expect(result.current.shouldAnimateLayout).toBe(true);
        expect(result.current.shouldAnimateGrid).toBe(true);

        setReducedMotion(true);
        expect(result.current.motionAllowed).toBe(false);
        expect(result.current.shouldAnimateLayout).toBe(false);
        expect(result.current.shouldAnimateGrid).toBe(false);
        expect(vi.getTimerCount()).toBe(0);

        setReducedMotion(false);
        expect(result.current.motionAllowed).toBe(true);
        expect(result.current.shouldAnimateLayout).toBe(false);
        expect(result.current.shouldAnimateGrid).toBe(false);

        rerender({ transitionKey: 'layout:list', visibleItemCount: 20 });
        expect(result.current.shouldAnimateLayout).toBe(true);
        expect(result.current.shouldAnimateGrid).toBe(true);
    });

    it('keeps the grid settle but disables per-card layout motion above the visible item cap', () => {
        const { result, rerender } = renderGalleryMotion({ transitionKey: 'initial', visibleItemCount: 120 });

        rerender({ transitionKey: 'layout:grid', visibleItemCount: 121 });

        expect(result.current.shouldAnimateLayout).toBe(false);
        expect(result.current.shouldAnimateGrid).toBe(true);
    });

    it('disables per-card layout motion while scrolling', () => {
        const { result, rerender } = renderGalleryMotion({ transitionKey: 'initial', visibleItemCount: 20 });

        rerender({ transitionKey: 'layout:grid', visibleItemCount: 20, isScrolling: true });

        expect(result.current.shouldAnimateLayout).toBe(false);
        expect(result.current.shouldAnimateGrid).toBe(true);
    });

    it('clears motion timers on unmount', () => {
        const { rerender, unmount } = renderGalleryMotion({ transitionKey: 'initial', visibleItemCount: 20 });

        rerender({ transitionKey: 'layout:grid', visibleItemCount: 20 });

        expect(vi.getTimerCount()).toBe(2);

        unmount();

        expect(vi.getTimerCount()).toBe(0);
    });

    it('disables media-query subscriptions when matchMedia is unavailable', () => {
        vi.stubGlobal('matchMedia', undefined);

        const { result } = renderGalleryMotion({ transitionKey: 'initial', visibleItemCount: 20 });

        expect(result.current.motionAllowed).toBe(true);
    });

    it('uses legacy media-query listeners and removes them on unmount', () => {
        const addListener = vi.fn();
        const removeListener = vi.fn();
        const mediaQuery = {
            matches: false,
            media: '(prefers-reduced-motion: reduce)',
            onchange: null,
            addListener,
            removeListener,
            dispatchEvent: vi.fn(),
        } as unknown as MediaQueryList;
        vi.stubGlobal(
            'matchMedia',
            vi.fn(() => mediaQuery)
        );

        const { unmount } = renderGalleryMotion({ transitionKey: 'initial', visibleItemCount: 20 });

        expect(addListener).toHaveBeenCalledWith(expect.any(Function));
        const changeHandler = addListener.mock.calls[0][0] as () => void;
        Object.defineProperty(mediaQuery, 'matches', { configurable: true, value: true });
        act(() => changeHandler());
        unmount();
        expect(removeListener).toHaveBeenCalledWith(changeHandler);
    });
});
