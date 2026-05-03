import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGalleryMotion, UseGalleryMotionOptions } from '../useGalleryMotion';

const createMatchMedia = (matches: boolean) =>
    vi.fn((query: string): MediaQueryList => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
    } as unknown as MediaQueryList));

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

    it('disables layout and grid motion when reduced motion is preferred', () => {
        vi.stubGlobal('matchMedia', createMatchMedia(true));

        const { result, rerender } = renderGalleryMotion({ transitionKey: 'initial', visibleItemCount: 20 });

        rerender({ transitionKey: 'layout:grid', visibleItemCount: 20 });

        expect(result.current.shouldAnimateLayout).toBe(false);
        expect(result.current.shouldAnimateGrid).toBe(false);
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
});
