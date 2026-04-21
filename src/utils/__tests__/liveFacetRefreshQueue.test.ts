import { describe, expect, it, vi } from 'vitest';
import { createLiveFacetRefreshQueue } from '../liveFacetRefreshQueue';

vi.mock('../liveWatchPerf', () => ({
    debugLiveWatchPerf: vi.fn(),
    elapsedMs: vi.fn(() => 1),
    infoLiveWatchPerf: vi.fn(),
    liveWatchNow: vi.fn(() => 1000)
}));

const createDeferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
};

describe('createLiveFacetRefreshQueue', () => {
    it('coalesces facet types that arrive while a refresh is already running', async () => {
        const firstRun = createDeferred<number>();
        const runIncremental = vi
            .fn()
            .mockImplementationOnce(() => firstRun.promise)
            .mockResolvedValueOnce(4);
        const runFullFallback = vi.fn().mockResolvedValue(0);
        const onRefreshApplied = vi.fn();

        const queue = createLiveFacetRefreshQueue({
            runIncremental,
            runFullFallback,
            onRefreshApplied
        });

        const activeRefresh = queue.queue(['checkpoints'], {
            source: 'invoke',
            cycleId: 'cycle-1',
            changedImageCount: 1
        });

        await Promise.resolve();

        const mergedRefresh = queue.queue(['tools', 'loras'], {
            source: 'generic',
            cycleId: 'cycle-2',
            changedImageCount: 2
        });

        expect(activeRefresh).toBe(mergedRefresh);
        expect(runIncremental).toHaveBeenCalledTimes(1);
        expect(runIncremental).toHaveBeenNthCalledWith(1, ['checkpoints']);

        firstRun.resolve(2);
        await activeRefresh;

        expect(runIncremental).toHaveBeenCalledTimes(2);
        expect(runIncremental).toHaveBeenNthCalledWith(2, ['loras', 'tools']);
        expect(runFullFallback).not.toHaveBeenCalled();
        expect(onRefreshApplied).toHaveBeenCalledTimes(2);
    });

    it('falls back to a full rebuild when the incremental refresh fails', async () => {
        const runIncremental = vi.fn().mockRejectedValue(new Error('incremental failed'));
        const runFullFallback = vi.fn().mockResolvedValue(9);
        const onRefreshApplied = vi.fn();

        const queue = createLiveFacetRefreshQueue({
            runIncremental,
            runFullFallback,
            onRefreshApplied
        });

        await queue.queue(['tools', 'checkpoints'], {
            source: 'invoke',
            cycleId: 'cycle-fallback',
            changedImageCount: 1
        });

        expect(runIncremental).toHaveBeenCalledWith(['checkpoints', 'tools']);
        expect(runFullFallback).toHaveBeenCalledTimes(1);
        expect(onRefreshApplied).toHaveBeenCalledTimes(1);
    });
});
