import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Favorites and pins must survive a library that a background writer holds for a while (#457).
// The SQL plugin's pool gives most connections SQLite's 5 s busy wait, so a write that meets a longer
// background transaction fails with this exact sqlx message, or with the pool's acquire timeout.
const BUSY = 'error returned from database: (code: 5) database is locked';
const POOL_TIMEOUT = 'pool timed out while waiting for an open connection';

const executeMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());

vi.mock('../connection', () => ({
    dbMutex: { dispatch: async (fn: () => Promise<unknown>) => fn() },
    getDb: () => Promise.resolve({ execute: executeMock, select: selectMock }),
}));
vi.mock('../readonlySelect', () => ({ selectReadonly: vi.fn() }));
vi.mock('../../runtime', () => ({ isBrowserMockMode: () => false }));
vi.mock('../../metadataParser', () => ({ scanImageNative: vi.fn() }));
vi.mock('../../../bindings', () => ({ commands: {} }));

type FlagWrite = (id: string, value: boolean) => Promise<void>;

const loadWrites = async (): Promise<Record<string, FlagWrite>> => {
    const repo = await import('../imageRepo');
    return {
        toggleImageFavorite: repo.toggleImageFavorite,
        toggleImagePin: repo.toggleImagePin,
        updateFavorite: repo.updateFavorite,
        updatePinned: repo.updatePinned,
    };
};

const flagUpdates = () => executeMock.mock.calls.filter(([sql]) => /SET is_(favorite|pinned) =/.test(sql as string));

describe('favorite and pin writes on a busy library', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        executeMock.mockReset();
        selectMock.mockReset();
        selectMock.mockResolvedValue([]);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each(['toggleImageFavorite', 'toggleImagePin', 'updateFavorite', 'updatePinned'])(
        '%s waits out a background writer instead of failing',
        async (name) => {
            const write = (await loadWrites())[name];
            executeMock.mockRejectedValueOnce(BUSY).mockRejectedValueOnce(new Error(POOL_TIMEOUT)).mockResolvedValue({ rowsAffected: 1 });

            const saved = write('C:\\library\\comfy.png', true);
            await vi.advanceTimersByTimeAsync(5_000);

            await expect(saved).resolves.toBeUndefined();
            expect(flagUpdates()).toHaveLength(3);
            expect(flagUpdates().at(-1)?.[1]).toEqual([1, 'C:/library/comfy.png']);
        }
    );

    it('still reports a library that stays busy past the wait budget', async () => {
        const { toggleImageFavorite } = await loadWrites();
        executeMock.mockRejectedValue(BUSY);

        const saved = toggleImageFavorite('C:/library/comfy.png', true);
        const outcome = expect(saved).rejects.toBe(BUSY);
        await vi.advanceTimersByTimeAsync(61_000);

        await outcome;
    });

    it('fails at once on errors that waiting cannot fix', async () => {
        const { toggleImagePin } = await loadWrites();
        executeMock.mockResolvedValue({ rowsAffected: 0 });

        await expect(toggleImagePin('C:/library/gone.png', true)).rejects.toThrow('Updating pin failed because the asset was not found');
        expect(flagUpdates()).toHaveLength(1);
    });

    it('keeps the last choice when the user toggles again while the first write waits', async () => {
        const { toggleImageFavorite, updateFavorite } = await loadWrites();
        executeMock.mockRejectedValueOnce(BUSY).mockResolvedValue({ rowsAffected: 1 });

        const on = toggleImageFavorite('C:/library/comfy.png', true);
        const off = updateFavorite('C:/library/comfy.png', false);
        await vi.advanceTimersByTimeAsync(5_000);

        await expect(on).resolves.toBeUndefined();
        await expect(off).resolves.toBeUndefined();
        expect(flagUpdates().at(-1)?.[1]).toEqual([0, 'C:/library/comfy.png']);
    });
});
