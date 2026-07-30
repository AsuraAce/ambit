import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    importVideoAsset: vi.fn(),
    storeVideoPoster: vi.fn(),
    cancelVideoImport: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock('../../bindings', () => ({
    commands: {
        importVideoAsset: mocks.importVideoAsset,
        storeVideoPoster: mocks.storeVideoPoster,
        cancelVideoImport: mocks.cancelVideoImport,
    },
}));

describe('videoService', () => {
    beforeEach(() => vi.clearAllMocks());

    it('stops a sequential import batch after the active probe is cancelled', async () => {
        mocks.importVideoAsset.mockResolvedValue({
            status: 'ok',
            data: { status: 'cancelled', asset: null, reason: null },
        });
        const { importVideoPaths } = await import('../videoService');

        const summary = await importVideoPaths([
            'C:/videos/first.mp4',
            'C:/videos/second.mp4',
        ]);

        expect(summary.cancelled).toBe(1);
        expect(mocks.importVideoAsset).toHaveBeenCalledTimes(1);
        expect(mocks.storeVideoPoster).not.toHaveBeenCalled();
    });

    it('does not start another probe after the batch cancellation flag is set', async () => {
        const { importVideoPaths } = await import('../videoService');

        const summary = await importVideoPaths(
            ['C:/videos/first.mp4'],
            undefined,
            () => true
        );

        expect(summary).toMatchObject({ imported: 0, duplicate: 0, rejected: 0, cancelled: 0 });
        expect(mocks.importVideoAsset).not.toHaveBeenCalled();
    });

    it('isolates a failed native import and continues with the remaining paths', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mocks.importVideoAsset
            .mockRejectedValueOnce(new Error('file vanished'))
            .mockResolvedValueOnce({
                status: 'ok',
                data: { status: 'duplicate', asset: null, reason: null },
            });
        const { importVideoPaths } = await import('../videoService');

        const summary = await importVideoPaths([
            'C:/videos/vanished.mp4',
            'C:/videos/existing.mp4',
        ]);

        expect(summary).toMatchObject({ imported: 0, duplicate: 1, rejected: 1, cancelled: 0 });
        expect(mocks.importVideoAsset).toHaveBeenCalledTimes(2);
        expect(warning).toHaveBeenCalledWith(
            '[VideoImport] Failed to import video; continuing batch',
            'C:/videos/vanished.mp4',
            expect.any(Error)
        );
    });
});
