import { act, renderHook } from '../../test/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDelayedBusyPresentation } from '../useDelayedBusyPresentation';

describe('useDelayedBusyPresentation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    const renderPresentation = (isActive = true, resetKey = 'root-a') => renderHook(
        ({ active, key }) => useDelayedBusyPresentation(active, {
            revealDelayMs: 700,
            minimumVisibleMs: 500,
            resetKey: key,
        }),
        { initialProps: { active: isActive, key: resetKey } }
    );

    it('never reveals work that finishes during the grace period', () => {
        const view = renderPresentation();

        act(() => vi.advanceTimersByTime(699));
        expect(view.result.current).toBe(false);

        view.rerender({ active: false, key: 'root-a' });
        act(() => vi.advanceTimersByTime(1000));
        expect(view.result.current).toBe(false);
    });

    it('reveals sustained work and observes the minimum visible duration', () => {
        const view = renderPresentation();

        act(() => vi.advanceTimersByTime(700));
        expect(view.result.current).toBe(true);

        view.rerender({ active: false, key: 'root-a' });
        act(() => vi.advanceTimersByTime(499));
        expect(view.result.current).toBe(true);

        act(() => vi.advanceTimersByTime(1));
        expect(view.result.current).toBe(false);
    });

    it('hides immediately when work has already exceeded the minimum duration', () => {
        const view = renderPresentation();

        act(() => vi.advanceTimersByTime(1200));
        expect(view.result.current).toBe(true);

        view.rerender({ active: false, key: 'root-a' });
        act(() => vi.advanceTimersByTime(0));
        expect(view.result.current).toBe(false);
    });

    it('resets pending and visible presentation when the cycle key changes', () => {
        const view = renderPresentation();

        act(() => vi.advanceTimersByTime(700));
        expect(view.result.current).toBe(true);

        view.rerender({ active: true, key: 'root-b' });
        expect(view.result.current).toBe(false);

        act(() => vi.advanceTimersByTime(699));
        expect(view.result.current).toBe(false);

        act(() => vi.advanceTimersByTime(1));
        expect(view.result.current).toBe(true);
    });
});
