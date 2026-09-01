import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage, type ImageMetadata } from '../../types';

const mocks = vi.hoisted(() => ({
    appLocalDataDir: vi.fn(),
    join: vi.fn(),
    convertFileSrc: vi.fn((path: string) => `asset://${path}`),
    exists: vi.fn(),
    readDir: vi.fn(),
    remove: vi.fn(),
    scanImageNative: vi.fn(),
    scanImagesBulk: vi.fn(),
    getDb: vi.fn(),
    getUnoptimizedImagesCount: vi.fn(),
    getUnoptimizedImageEntries: vi.fn(),
    updateThumbnailPathsBatch: vi.fn(),
    repairThumbnailBatch: vi.fn(),
    cancelThumbnailOptimizationJob: vi.fn(),
    getSettingsState: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
    appLocalDataDir: mocks.appLocalDataDir,
    join: mocks.join,
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: mocks.convertFileSrc,
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
    exists: mocks.exists,
    readDir: mocks.readDir,
    remove: mocks.remove,
}));

vi.mock('../metadataParser', () => ({
    scanImageNative: mocks.scanImageNative,
    scanImagesBulk: mocks.scanImagesBulk,
}));

vi.mock('../db/connection', () => ({
    getDb: mocks.getDb,
}));

vi.mock('../db/maintenanceRepo', () => ({
    getUnoptimizedImagesCount: mocks.getUnoptimizedImagesCount,
    getUnoptimizedImageEntries: mocks.getUnoptimizedImageEntries,
}));

vi.mock('../db/imageRepo', () => ({
    updateThumbnailPathsBatch: mocks.updateThumbnailPathsBatch,
}));

vi.mock('../../bindings', () => ({
    commands: {
        repairThumbnailBatch: mocks.repairThumbnailBatch,
        cancelThumbnailOptimizationJob: mocks.cancelThumbnailOptimizationJob,
    },
}));

vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: {
        getState: mocks.getSettingsState,
    },
}));

const nativeRepairResult = (
    updates: Array<{ id: string; thumbnailPath: string }> = [],
    overrides: Partial<{ optimized: number; checked: number; requested: number }> = {}
) => ({
    status: 'ok' as const,
    data: {
        requested: overrides.requested ?? updates.length,
        checked: overrides.checked ?? updates.length,
        optimized: overrides.optimized ?? updates.length,
        reused: 0,
        missing: 0,
        failed: 0,
        skipped: 0,
        wasCancelled: false,
        durationMs: 1,
        candidateFetchMs: 0,
        dbMs: 0,
        encodeMs: 1,
        updates,
    },
});

const metadata: ImageMetadata = {
    tool: GeneratorTool.UNKNOWN,
    model: 'Unknown',
    steps: 0,
    cfg: 0,
    sampler: 'Unknown',
    positivePrompt: '',
    negativePrompt: '',
};

const imageFixture = (id: string): AIImage => ({
    id,
    url: '',
    thumbnailUrl: '',
    filename: id.split('/').pop() ?? id,
    timestamp: 1,
    width: 100,
    height: 100,
    isFavorite: false,
    metadata,
});

describe('thumbnailService', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.resetAllMocks();

        mocks.convertFileSrc.mockImplementation((path: string) => `asset://${path}`);
        mocks.appLocalDataDir.mockResolvedValue('C:/AppData/Ambit');
        mocks.join.mockImplementation(async (...parts: string[]) => parts.join('/'));
        mocks.scanImageNative.mockResolvedValue({});
        mocks.scanImagesBulk.mockResolvedValue([]);
        mocks.getUnoptimizedImagesCount.mockResolvedValue(0);
        mocks.getUnoptimizedImageEntries.mockResolvedValue([]);
        mocks.updateThumbnailPathsBatch.mockResolvedValue(undefined);
        mocks.repairThumbnailBatch.mockResolvedValue(nativeRepairResult());
        mocks.cancelThumbnailOptimizationJob.mockResolvedValue(undefined);
        mocks.getSettingsState.mockReturnValue({
            settings: {
                monitoredFolders: [
                    { path: 'C:/library', isActive: true },
                    { path: 'D:/archive', isActive: false },
                ],
            },
        });
        mocks.getDb.mockResolvedValue({
            select: vi.fn().mockResolvedValue([]),
            execute: vi.fn().mockResolvedValue(undefined),
        });
    });

    it('caches the app thumbnail directory because every healing flow uses the same target', async () => {
        const { getThumbnailDir } = await import('../thumbnailService');

        await expect(getThumbnailDir()).resolves.toBe('C:/AppData/Ambit/.thumbnails');
        await expect(getThumbnailDir()).resolves.toBe('C:/AppData/Ambit/.thumbnails');

        expect(mocks.appLocalDataDir).toHaveBeenCalledTimes(1);
        expect(mocks.join).toHaveBeenCalledWith('C:/AppData/Ambit', '.thumbnails');
    });

    it('returns null for duplicate single-thumbnail work so scroll retries do not pile up', async () => {
        let resolveScan: (value: { thumbnail?: string }) => void = () => undefined;
        mocks.scanImageNative.mockReturnValue(new Promise(resolve => {
            resolveScan = resolve;
        }));

        const { generateSingleThumbnail } = await import('../thumbnailService');

        const first = generateSingleThumbnail('C:/library/a.png');
        await expect(generateSingleThumbnail('C:/library/a.png')).resolves.toBeNull();

        resolveScan({ thumbnail: 'C:/AppData/Ambit/.thumbnails/a.webp' });
        await expect(first).resolves.toBe('C:/AppData/Ambit/.thumbnails/a.webp');

        expect(mocks.scanImageNative).toHaveBeenCalledTimes(1);
        expect(mocks.scanImageNative).toHaveBeenCalledWith(
            'C:/library/a.png',
            'C:/AppData/Ambit/.thumbnails',
            false,
            false
        );
    });

    it('force-regenerates selected thumbnails through the native engine with immediate retry', async () => {
        mocks.repairThumbnailBatch.mockResolvedValue(nativeRepairResult([
            { id: 'C:/library/a.png', thumbnailPath: 'thumb-a.webp' },
            { id: 'C:/library/c.png', thumbnailPath: 'thumb-c.webp' },
        ], { requested: 3, checked: 3 }));

        const { regenerateThumbnailsForImages } = await import('../thumbnailService');
        const progress: Array<[number, number]> = [];

        const updates = await regenerateThumbnailsForImages(
            [
                imageFixture('C:/library/a.png'),
                imageFixture('C:/library/b.png'),
                imageFixture('C:/library/c.png'),
            ],
            (current, total) => progress.push([current, total])
        );

        expect(mocks.repairThumbnailBatch).toHaveBeenCalledWith({
            ids: ['C:/library/a.png', 'C:/library/b.png', 'C:/library/c.png'],
            thumbnailDir: 'C:/AppData/Ambit/.thumbnails',
            sourceRoots: ['C:/library'],
            force: true,
            respectBackoff: false,
        });
        expect(mocks.scanImagesBulk).not.toHaveBeenCalled();
        expect(mocks.updateThumbnailPathsBatch).not.toHaveBeenCalled();
        expect(updates.map(image => image.thumbnailUrl)).toEqual(['thumb-a.webp', 'thumb-c.webp']);
        expect(progress).toEqual([[3, 3]]);
    });

    it('regenerates all unoptimized thumbnails from DB pages without loading every image row', async () => {
        mocks.getUnoptimizedImagesCount.mockResolvedValue(3);
        mocks.getUnoptimizedImageEntries.mockResolvedValueOnce([
            { id: 'id-a', path: 'C:/library/a.png', timestamp: 30 },
            { id: 'id-b', path: 'C:/library/b.png', timestamp: 20 },
            { id: 'id-c', path: 'C:/library/c.png', timestamp: 10 },
        ]);
        mocks.repairThumbnailBatch.mockResolvedValue(nativeRepairResult([
            { id: 'id-a', thumbnailPath: 'a.webp' },
            { id: 'id-c', thumbnailPath: 'c.webp' },
        ], { requested: 3, checked: 3, optimized: 2 }));

        const { regenerateAllUnoptimized } = await import('../thumbnailService');
        const progress: Array<[number, number]> = [];

        await expect(regenerateAllUnoptimized(
            (current, total) => progress.push([current, total]),
            undefined,
            'WHERE model_name = ?',
            ['model-a'],
            true
        )).resolves.toBe(2);

        expect(mocks.getUnoptimizedImagesCount).toHaveBeenCalledWith('WHERE model_name = ?', ['model-a'], true);
        expect(mocks.getUnoptimizedImageEntries).toHaveBeenCalledWith(null, 500, 'WHERE model_name = ?', ['model-a'], true);
        expect(mocks.repairThumbnailBatch).toHaveBeenCalledWith({
            ids: ['id-a', 'id-b', 'id-c'],
            thumbnailDir: 'C:/AppData/Ambit/.thumbnails',
            sourceRoots: ['C:/library'],
            force: false,
            respectBackoff: false,
        });
        expect(mocks.scanImagesBulk).not.toHaveBeenCalled();
        expect(mocks.updateThumbnailPathsBatch).not.toHaveBeenCalled();
        expect(progress).toEqual([[3, 3]]);
    });

    it('continues from the last candidate instead of skipping rows removed by earlier repairs', async () => {
        mocks.getUnoptimizedImagesCount.mockResolvedValue(501);
        mocks.getUnoptimizedImageEntries
            .mockResolvedValueOnce([
                { id: 'id-newer', path: 'C:/library/newer.png', timestamp: 20 },
                { id: 'id-older', path: 'C:/library/older.png', timestamp: 10 },
            ])
            .mockResolvedValueOnce([
                { id: 'id-last', path: 'C:/library/last.png', timestamp: 5 },
            ])
            .mockResolvedValueOnce([]);
        mocks.repairThumbnailBatch
            .mockResolvedValueOnce(nativeRepairResult([
                { id: 'id-newer', thumbnailPath: 'newer.webp' },
                { id: 'id-older', thumbnailPath: 'older.webp' },
            ]))
            .mockResolvedValueOnce(nativeRepairResult([
                { id: 'id-last', thumbnailPath: 'last.webp' },
            ]));

        const { regenerateAllUnoptimized } = await import('../thumbnailService');

        await expect(regenerateAllUnoptimized()).resolves.toBe(3);

        expect(mocks.getUnoptimizedImageEntries).toHaveBeenNthCalledWith(1, null, 500, '', [], false);
        expect(mocks.getUnoptimizedImageEntries).toHaveBeenNthCalledWith(
            2,
            { timestamp: 10, id: 'id-older' },
            500,
            '',
            [],
            false
        );
        expect(mocks.getUnoptimizedImageEntries).toHaveBeenNthCalledWith(
            3,
            { timestamp: 5, id: 'id-last' },
            500,
            '',
            [],
            false
        );
        expect(mocks.repairThumbnailBatch).toHaveBeenCalledTimes(2);
    });

    it('cleans only thumbnail files that are not referenced by the database', async () => {
        mocks.readDir.mockResolvedValue([{ name: 'Keep.WebP' }, { name: 'orphan.webp' }]);
        const select = vi.fn().mockResolvedValue([{ thumbnail_path: 'C:/thumbs/keep.webp' }]);
        mocks.getDb.mockResolvedValue({
            select,
            execute: vi.fn(),
        });

        const { cleanupOrphanThumbnails } = await import('../thumbnailService');

        await expect(cleanupOrphanThumbnails()).resolves.toBe(1);
        expect(select).toHaveBeenCalledWith(expect.stringContaining('FROM images'));
        expect(select).not.toHaveBeenCalledWith(expect.stringContaining('FROM scoped_images'));
        expect(mocks.remove).toHaveBeenCalledWith('C:/AppData/Ambit/.thumbnails/orphan.webp');
        expect(mocks.remove).toHaveBeenCalledTimes(1);
    });

    it('syncs missing DB thumbnail paths by rescanning existing files and writing one batch update', async () => {
        const select = vi.fn().mockResolvedValue([{ id: 'C:/library/a.png' }, { id: 'C:/library/b.png' }]);
        mocks.getDb.mockResolvedValue({
            select,
            execute: vi.fn(),
        });
        mocks.scanImagesBulk.mockResolvedValue([{ thumbnail: 'a.webp' }, { thumbnail: 'b.webp' }]);

        const { syncExistingThumbnailsToDB } = await import('../thumbnailService');

        await expect(syncExistingThumbnailsToDB()).resolves.toBe(2);
        expect(select).toHaveBeenCalledWith(expect.stringContaining("media_type = 'image'"));
        expect(select).toHaveBeenCalledWith(expect.stringContaining('invoke_scope_hidden = 0'));
        expect(mocks.convertFileSrc).toHaveBeenCalledWith('C:/library/a.png');
        expect(mocks.updateThumbnailPathsBatch).toHaveBeenCalledWith([
            { id: 'C:/library/a.png', thumbnailPath: 'a.webp', thumbnailSource: 'ambit' },
            { id: 'C:/library/b.png', thumbnailPath: 'b.webp', thumbnailSource: 'ambit' },
        ]);
    });

    it('prunes missing local thumbnails while leaving remote thumbnail URLs alone', async () => {
        const execute = vi.fn().mockResolvedValue(undefined);
        const select = vi.fn().mockResolvedValue([
            { id: 'remote', thumbnail_path: 'https://example.test/thumb.webp' },
            { id: 'relative', thumbnail_path: 'legacy.webp' },
            { id: 'absolute', thumbnail_path: 'C:/thumbs/absolute.webp' },
        ]);
        mocks.getDb.mockResolvedValue({
            select,
            execute,
        });
        mocks.exists.mockImplementation(async (path: string) => path !== 'C:/AppData/Ambit/.thumbnails/legacy.webp');

        const { pruneBrokenThumbnails } = await import('../thumbnailService');

        await expect(pruneBrokenThumbnails()).resolves.toBe(1);
        expect(select).toHaveBeenCalledWith(expect.stringContaining('invoke_scope_hidden = 0'));
        expect(mocks.exists).toHaveBeenCalledWith('C:/AppData/Ambit/.thumbnails/legacy.webp');
        expect(mocks.exists).toHaveBeenCalledWith('C:/thumbs/absolute.webp');
        expect(execute).toHaveBeenCalledWith(
            'UPDATE images SET thumbnail_path = NULL, micro_thumbnail = NULL, thumbnail_source = NULL WHERE id IN (?) AND id IN (SELECT id FROM scoped_images WHERE invoke_scope_hidden = 0)',
            ['relative']
        );
    });

    it('contains thumbnail-directory and single-generation failures', async () => {
        mocks.appLocalDataDir.mockRejectedValueOnce(new Error('no app data'));
        let service = await import('../thumbnailService');
        await expect(service.getThumbnailDir()).resolves.toBeUndefined();
        await expect(service.generateSingleThumbnail('C:/library/no-dir.png')).resolves.toBeNull();

        vi.resetModules();
        mocks.appLocalDataDir.mockResolvedValue('C:/AppData/Ambit');
        mocks.scanImageNative.mockRejectedValueOnce(new Error('scan failed')).mockResolvedValueOnce({});
        service = await import('../thumbnailService');
        await expect(service.generateSingleThumbnail('C:/library/error.png')).resolves.toBeNull();
        await expect(service.generateSingleThumbnail('C:/library/no-thumb.png')).resolves.toBeNull();
    });

    it('limits concurrent single-thumbnail generation to five paths', async () => {
        const resolvers: Array<(value: { thumbnail?: string }) => void> = [];
        mocks.scanImageNative.mockImplementation(() => new Promise(resolve => resolvers.push(resolve)));
        const { generateSingleThumbnail } = await import('../thumbnailService');

        const active = Array.from({ length: 5 }, (_, index) => generateSingleThumbnail(`C:/library/${index}.png`));
        await expect(generateSingleThumbnail('C:/library/overflow.png')).resolves.toBeNull();
        resolvers.forEach(resolve => resolve({}));
        await Promise.all(active);
    });

    it('handles empty, cancelled, and failed selected native regeneration batches', async () => {
        const { regenerateThumbnailsForImages } = await import('../thumbnailService');
        await expect(regenerateThumbnailsForImages([])).resolves.toEqual([]);

        const aborted = new AbortController();
        aborted.abort();
        await expect(regenerateThumbnailsForImages([imageFixture('cancelled')], undefined, aborted.signal)).resolves.toEqual([]);

        mocks.repairThumbnailBatch.mockRejectedValueOnce(new Error('native repair failed'));
        const progress = vi.fn();
        await expect(regenerateThumbnailsForImages([imageFixture('failed')], progress)).resolves.toEqual([]);
        expect(progress).toHaveBeenCalledWith(1, 1);

        mocks.repairThumbnailBatch.mockResolvedValueOnce(nativeRepairResult([
            { id: 'generated', thumbnailPath: 'generated.webp' },
        ]));
        await expect(regenerateThumbnailsForImages([imageFixture('generated')])).resolves.toHaveLength(1);
    });

    it('routes an active Maintenance cancellation to the shared native job', async () => {
        let finishRepair: (result: ReturnType<typeof nativeRepairResult>) => void = () => undefined;
        mocks.repairThumbnailBatch.mockReturnValueOnce(new Promise(resolve => {
            finishRepair = resolve;
        }));
        const controller = new AbortController();
        const { regenerateThumbnailsForImages } = await import('../thumbnailService');

        const regeneration = regenerateThumbnailsForImages(
            [imageFixture('cancel-active')],
            undefined,
            controller.signal
        );
        await vi.waitFor(() => expect(mocks.repairThumbnailBatch).toHaveBeenCalledOnce());
        controller.abort();
        await vi.waitFor(() => expect(mocks.cancelThumbnailOptimizationJob).toHaveBeenCalledOnce());
        finishRepair(nativeRepairResult([], { requested: 1, checked: 0 }));

        await expect(regeneration).resolves.toEqual([]);
    });

    it('returns early from regenerate-all defaults and outer cancellation paths', async () => {
        const { regenerateAllUnoptimized } = await import('../thumbnailService');
        await expect(regenerateAllUnoptimized()).resolves.toBe(0);
        expect(mocks.getUnoptimizedImagesCount).toHaveBeenCalledWith('', [], false);

        mocks.getUnoptimizedImagesCount.mockResolvedValueOnce(1);
        const aborted = new AbortController();
        aborted.abort();
        await expect(regenerateAllUnoptimized(undefined, aborted.signal)).resolves.toBe(0);
    });

    it('handles empty pages and cancellation between regenerate-all fetch and batching', async () => {
        mocks.getUnoptimizedImagesCount.mockResolvedValue(1);
        mocks.getUnoptimizedImageEntries.mockResolvedValueOnce([]);
        const { regenerateAllUnoptimized } = await import('../thumbnailService');
        await expect(regenerateAllUnoptimized()).resolves.toBe(0);

        const controller = new AbortController();
        mocks.getUnoptimizedImageEntries.mockImplementationOnce(async () => {
            controller.abort();
            return [{ id: 'id-a', path: 'C:/a.png' }];
        });
        await expect(regenerateAllUnoptimized(undefined, controller.signal)).resolves.toBe(0);
        expect(mocks.repairThumbnailBatch).not.toHaveBeenCalled();
    });

    it('contains regenerate-all native batch failures and continues the next batch', async () => {
        const entries = Array.from({ length: 151 }, (_, index) => ({
            id: `id-${index}`,
            path: `C:/${index}.png`
        }));
        mocks.getUnoptimizedImagesCount.mockResolvedValue(151);
        mocks.getUnoptimizedImageEntries.mockResolvedValueOnce(entries);
        mocks.repairThumbnailBatch
            .mockRejectedValueOnce(new Error('native repair failed'))
            .mockResolvedValueOnce(nativeRepairResult([
                { id: 'id-150', thumbnailPath: 'persist.webp' },
            ]));
        const { regenerateAllUnoptimized } = await import('../thumbnailService');

        await expect(regenerateAllUnoptimized()).resolves.toBe(1);
    });

    it('returns safely when orphan cleanup cannot read or remove files', async () => {
        mocks.readDir.mockRejectedValueOnce(new Error('missing directory'));
        let service = await import('../thumbnailService');
        await expect(service.cleanupOrphanThumbnails()).resolves.toBe(0);

        vi.resetModules();
        mocks.readDir.mockResolvedValue([{ name: 'orphan.webp' }]);
        mocks.remove.mockRejectedValueOnce(new Error('locked'));
        mocks.getDb.mockResolvedValue({
            select: vi.fn().mockResolvedValue([{ thumbnail_path: '' }]),
            execute: vi.fn()
        });
        service = await import('../thumbnailService');
        await expect(service.cleanupOrphanThumbnails()).resolves.toBe(0);
    });

    it('handles empty, failed, and unpersisted existing-thumbnail syncs with progress', async () => {
        const select = vi.fn().mockResolvedValueOnce([]);
        mocks.getDb.mockResolvedValue({ select, execute: vi.fn() });
        let service = await import('../thumbnailService');
        await expect(service.syncExistingThumbnailsToDB()).resolves.toBe(0);

        vi.resetModules();
        select.mockResolvedValue([{ id: 'C:/a.png' }]);
        mocks.scanImagesBulk.mockRejectedValueOnce(new Error('sync scan failed'));
        const progress = vi.fn();
        service = await import('../thumbnailService');
        await expect(service.syncExistingThumbnailsToDB(progress)).resolves.toBe(0);
        expect(progress).toHaveBeenCalledWith(1, 1);

        vi.resetModules();
        mocks.scanImagesBulk.mockResolvedValueOnce([{}]);
        service = await import('../thumbnailService');
        await expect(service.syncExistingThumbnailsToDB()).resolves.toBe(0);

        vi.resetModules();
        mocks.scanImagesBulk.mockResolvedValueOnce([{ thumbnail: 'a.webp' }]);
        mocks.updateThumbnailPathsBatch.mockRejectedValueOnce(new Error('sync persist failed'));
        service = await import('../thumbnailService');
        await expect(service.syncExistingThumbnailsToDB()).resolves.toBe(0);
    });

    it('contains file-existence errors and reports a clean prune pass', async () => {
        mocks.getDb.mockResolvedValue({
            select: vi.fn().mockResolvedValue([{ id: 'error', thumbnail_path: 'C:/thumbs/error.webp' }]),
            execute: vi.fn()
        });
        mocks.exists.mockRejectedValue(new Error('filesystem unavailable'));
        const { pruneBrokenThumbnails } = await import('../thumbnailService');

        await expect(pruneBrokenThumbnails()).resolves.toBe(0);
    });

    it('returns safely from every operation when the thumbnail directory cannot resolve', async () => {
        mocks.appLocalDataDir.mockRejectedValue(new Error('no app data'));
        const service = await import('../thumbnailService');

        await expect(service.generateSingleThumbnail('C:/a.png')).resolves.toBeNull();
        await expect(service.regenerateAllUnoptimized()).resolves.toBe(0);
        await expect(service.cleanupOrphanThumbnails()).resolves.toBe(0);
        await expect(service.syncExistingThumbnailsToDB()).resolves.toBe(0);
        await expect(service.pruneBrokenThumbnails()).resolves.toBe(0);
    });
});
