import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_DATABASE_WAIT_NOTICE_MS, runWithDatabaseWaitNotice } from '../importService';

// #609: a batch insert can wait up to the 60 s busy timeout for the library database; the dock must say so.
describe('runWithDatabaseWaitNotice', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const deferred = <T>() => {
        let resolve!: (value: T) => void;
        let reject!: (reason: unknown) => void;
        const promise = new Promise<T>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return { promise, resolve, reject };
    };

    it('reports the wait only after the threshold, and clears it when the insert resolves', async () => {
        const onProgress = vi.fn();
        const insert = deferred<string>();
        const run = runWithDatabaseWaitNotice(onProgress, 300, 600, () => insert.promise);

        await vi.advanceTimersByTimeAsync(IMPORT_DATABASE_WAIT_NOTICE_MS - 1);
        expect(onProgress).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(onProgress).toHaveBeenCalledWith(300, 600, 'Waiting for the library database...', { waitingForDatabase: true });

        insert.resolve('done');
        await expect(run).resolves.toBe('done');
        expect(onProgress).toHaveBeenLastCalledWith(300, 600, 'Importing images...', { waitingForDatabase: false });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears the wait when the insert rejects, and rethrows', async () => {
        const onProgress = vi.fn();
        const insert = deferred<void>();
        const run = runWithDatabaseWaitNotice(onProgress, 1, 2, () => insert.promise);
        const settled = expect(run).rejects.toThrow('database is locked');

        await vi.advanceTimersByTimeAsync(IMPORT_DATABASE_WAIT_NOTICE_MS);
        insert.reject(new Error('database is locked'));
        await settled;

        expect(onProgress).toHaveBeenLastCalledWith(1, 2, 'Importing images...', { waitingForDatabase: false });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stays silent and leaves no timer for a fast insert, across consecutive batches', async () => {
        const onProgress = vi.fn();
        await runWithDatabaseWaitNotice(onProgress, 1, 3, async () => undefined);
        await runWithDatabaseWaitNotice(onProgress, 2, 3, () => Promise.reject(new Error('x'))).catch(() => undefined);
        expect(vi.getTimerCount()).toBe(0);

        await vi.advanceTimersByTimeAsync(IMPORT_DATABASE_WAIT_NOTICE_MS * 2);
        expect(onProgress).not.toHaveBeenCalled();
    });
});
