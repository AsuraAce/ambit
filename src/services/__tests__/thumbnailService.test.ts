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

    it('regenerates selected thumbnails in batches and persists only generated paths', async () => {
        mocks.scanImagesBulk.mockResolvedValue([{ thumbnail: 'thumb-a.webp' }, {}, { thumbnail: 'thumb-c.webp' }]);

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

        expect(mocks.scanImagesBulk).toHaveBeenCalledWith(
            ['C:/library/a.png', 'C:/library/b.png', 'C:/library/c.png'],
            'C:/AppData/Ambit/.thumbnails',
            false,
            false
        );
        expect(mocks.updateThumbnailPathsBatch).toHaveBeenCalledWith([
            { id: 'C:/library/a.png', thumbnailPath: 'thumb-a.webp', thumbnailSource: 'ambit' },
            { id: 'C:/library/c.png', thumbnailPath: 'thumb-c.webp', thumbnailSource: 'ambit' },
        ]);
        expect(updates.map(image => image.thumbnailUrl)).toEqual(['thumb-a.webp', 'thumb-c.webp']);
        expect(progress).toEqual([[3, 3]]);
    });

    it('regenerates all unoptimized thumbnails from DB pages without loading every image row', async () => {
        mocks.getUnoptimizedImagesCount.mockResolvedValue(3);
        mocks.getUnoptimizedImageEntries.mockResolvedValueOnce([
            { id: 'id-a', path: 'C:/library/a.png' },
            { id: 'id-b', path: 'C:/library/b.png' },
            { id: 'id-c', path: 'C:/library/c.png' },
        ]);
        mocks.scanImagesBulk.mockResolvedValue([{ thumbnail: 'a.webp' }, {}, { thumbnail: 'c.webp' }]);

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
        expect(mocks.getUnoptimizedImageEntries).toHaveBeenCalledWith(0, 500, 'WHERE model_name = ?', ['model-a'], true);
        expect(mocks.scanImagesBulk).toHaveBeenCalledWith(
            ['C:/library/a.png', 'C:/library/b.png', 'C:/library/c.png'],
            'C:/AppData/Ambit/.thumbnails',
            false,
            false
        );
        expect(mocks.updateThumbnailPathsBatch).toHaveBeenCalledWith([
            { id: 'id-a', thumbnailPath: 'a.webp', thumbnailSource: 'ambit' },
            { id: 'id-c', thumbnailPath: 'c.webp', thumbnailSource: 'ambit' },
        ]);
        expect(progress).toEqual([[3, 3]]);
    });

    it('cleans only thumbnail files that are not referenced by the database', async () => {
        mocks.readDir.mockResolvedValue([{ name: 'Keep.WebP' }, { name: 'orphan.webp' }]);
        mocks.getDb.mockResolvedValue({
            select: vi.fn().mockResolvedValue([{ thumbnail_path: 'C:/thumbs/keep.webp' }]),
            execute: vi.fn(),
        });

        const { cleanupOrphanThumbnails } = await import('../thumbnailService');

        await expect(cleanupOrphanThumbnails()).resolves.toBe(1);
        expect(mocks.remove).toHaveBeenCalledWith('C:/AppData/Ambit/.thumbnails/orphan.webp');
        expect(mocks.remove).toHaveBeenCalledTimes(1);
    });

    it('syncs missing DB thumbnail paths by rescanning existing files and writing one batch update', async () => {
        mocks.getDb.mockResolvedValue({
            select: vi.fn().mockResolvedValue([{ id: 'C:/library/a.png' }, { id: 'C:/library/b.png' }]),
            execute: vi.fn(),
        });
        mocks.scanImagesBulk.mockResolvedValue([{ thumbnail: 'a.webp' }, { thumbnail: 'b.webp' }]);

        const { syncExistingThumbnailsToDB } = await import('../thumbnailService');

        await expect(syncExistingThumbnailsToDB()).resolves.toBe(2);
        expect(mocks.convertFileSrc).toHaveBeenCalledWith('C:/library/a.png');
        expect(mocks.updateThumbnailPathsBatch).toHaveBeenCalledWith([
            { id: 'C:/library/a.png', thumbnailPath: 'a.webp', thumbnailSource: 'ambit' },
            { id: 'C:/library/b.png', thumbnailPath: 'b.webp', thumbnailSource: 'ambit' },
        ]);
    });

    it('prunes missing local thumbnails while leaving remote thumbnail URLs alone', async () => {
        const execute = vi.fn().mockResolvedValue(undefined);
        mocks.getDb.mockResolvedValue({
            select: vi.fn().mockResolvedValue([
                { id: 'remote', thumbnail_path: 'https://example.test/thumb.webp' },
                { id: 'relative', thumbnail_path: 'legacy.webp' },
                { id: 'absolute', thumbnail_path: 'C:/thumbs/absolute.webp' },
            ]),
            execute,
        });
        mocks.exists.mockImplementation(async (path: string) => path !== 'C:/AppData/Ambit/.thumbnails/legacy.webp');

        const { pruneBrokenThumbnails } = await import('../thumbnailService');

        await expect(pruneBrokenThumbnails()).resolves.toBe(1);
        expect(mocks.exists).toHaveBeenCalledWith('C:/AppData/Ambit/.thumbnails/legacy.webp');
        expect(mocks.exists).toHaveBeenCalledWith('C:/thumbs/absolute.webp');
        expect(execute).toHaveBeenCalledWith(
            'UPDATE images SET thumbnail_path = NULL, micro_thumbnail = NULL, thumbnail_source = NULL WHERE id IN (?)',
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

    it('handles empty, cancelled, failed, and unpersisted selected regeneration batches', async () => {
        const { regenerateThumbnailsForImages } = await import('../thumbnailService');
        await expect(regenerateThumbnailsForImages([])).resolves.toEqual([]);

        const aborted = new AbortController();
        aborted.abort();
        await expect(regenerateThumbnailsForImages([imageFixture('cancelled')], undefined, aborted.signal)).resolves.toEqual([]);

        mocks.scanImagesBulk.mockRejectedValueOnce(new Error('bulk failed'));
        const progress = vi.fn();
        await expect(regenerateThumbnailsForImages([imageFixture('failed')], progress)).resolves.toEqual([]);
        expect(progress).toHaveBeenCalledWith(1, 1);

        mocks.scanImagesBulk.mockResolvedValueOnce([{ thumbnail: 'generated.webp' }]);
        mocks.updateThumbnailPathsBatch.mockRejectedValueOnce(new Error('persist failed'));
        await expect(regenerateThumbnailsForImages([imageFixture('unpersisted')])).resolves.toHaveLength(1);
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
        expect(mocks.scanImagesBulk).not.toHaveBeenCalled();
    });

    it('contains regenerate-all scan and persistence failures', async () => {
        const entries = Array.from({ length: 151 }, (_, index) => ({
            id: `id-${index}`,
            path: `C:/${index}.png`
        }));
        mocks.getUnoptimizedImagesCount.mockResolvedValue(151);
        mocks.getUnoptimizedImageEntries.mockResolvedValueOnce(entries);
        mocks.scanImagesBulk
            .mockRejectedValueOnce(new Error('scan failed'))
            .mockResolvedValueOnce([{ thumbnail: 'persist.webp' }]);
        mocks.updateThumbnailPathsBatch.mockRejectedValueOnce(new Error('persist failed'));
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
