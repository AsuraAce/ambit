import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    commands: {
        backfillParameterColumns: vi.fn(),
        verifyImagePaths: vi.fn(),
        backfillImageFileHashes: vi.fn(),
        cancelImageFileHashBackfill: vi.fn(),
        resolveExactDuplicateGroups: vi.fn(),
    },
    unwrap: vi.fn(),
    getDb: vi.fn(),
    dispatch: vi.fn(),
    isBrowserMockMode: vi.fn(),
    getBrowserMockImages: vi.fn(),
    getBrowserMockCollections: vi.fn(),
    updateBrowserMockImage: vi.fn(),
    upsertBrowserMockCollection: vi.fn(),
    mapRowToImage: vi.fn(),
}));

vi.mock('../../../bindings', () => ({
    commands: mocks.commands,
}));

vi.mock('../../../utils/spectaUtils', () => ({
    unwrap: mocks.unwrap,
}));

vi.mock('../connection', () => ({
    getDb: mocks.getDb,
    dbMutex: {
        dispatch: mocks.dispatch,
    },
}));

vi.mock('../../runtime', () => ({
    isBrowserMockMode: mocks.isBrowserMockMode,
}));

vi.mock('../../browserMockData', () => ({
    getBrowserMockImages: mocks.getBrowserMockImages,
    getBrowserMockCollections: mocks.getBrowserMockCollections,
    updateBrowserMockImage: mocks.updateBrowserMockImage,
    upsertBrowserMockCollection: mocks.upsertBrowserMockCollection,
}));

vi.mock('../repoUtils', () => ({
    getImageFieldsLight: () => 'id, path',
    REMOVED_IMAGE_FIELDS: 'id, path',
    mapRowToImage: mocks.mapRowToImage,
}));

describe('maintenanceRepo', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.resetAllMocks();

        mocks.unwrap.mockImplementation(async (value: unknown) => value);
        mocks.dispatch.mockImplementation(async (fn: () => Promise<unknown>) => fn());
        mocks.isBrowserMockMode.mockReturnValue(false);
        mocks.getBrowserMockCollections.mockReturnValue([]);
        mocks.mapRowToImage.mockImplementation((row: { id: string; path?: string }) => ({
            id: row.id,
            url: row.path ?? row.id,
            thumbnailUrl: '',
            metadata: {},
        }));
        mocks.getDb.mockResolvedValue({
            select: vi.fn().mockResolvedValue([]),
            execute: vi.fn().mockResolvedValue(undefined),
        });
    });

    it('delegates parameter backfill to Rust because parsed metadata columns are backend-owned', async () => {
        mocks.commands.backfillParameterColumns.mockResolvedValue(42);
        const { backfillParameterColumns } = await import('../maintenanceRepo');

        await expect(backfillParameterColumns()).resolves.toBe(42);

        expect(mocks.commands.backfillParameterColumns).toHaveBeenCalled();
        expect(mocks.unwrap).toHaveBeenCalledWith(expect.any(Promise));
    });

    it('normalizes legacy backslash paths only when the database still contains them', async () => {
        const db = {
            select: vi.fn().mockResolvedValue([{ id: 'C:\\library\\a.png' }]),
            execute: vi.fn().mockResolvedValue(undefined),
        };
        mocks.getDb.mockResolvedValue(db);

        const { normalizeAllPaths } = await import('../maintenanceRepo');
        await normalizeAllPaths();

        expect(mocks.dispatch).toHaveBeenCalledTimes(1);
        expect(db.select).toHaveBeenCalledWith('SELECT id FROM images WHERE id LIKE "%\\%" OR path LIKE "%\\%" LIMIT 1');
        expect(db.execute).toHaveBeenCalledWith(expect.stringContaining("SET id = REPLACE(id, '\\', '/')"));
    });

    it('leaves already-normalized paths untouched to avoid unnecessary writes', async () => {
        const db = {
            select: vi.fn().mockResolvedValue([]),
            execute: vi.fn().mockResolvedValue(undefined),
        };
        mocks.getDb.mockResolvedValue(db);

        const { normalizeAllPaths } = await import('../maintenanceRepo');
        await normalizeAllPaths();

        expect(db.select).toHaveBeenCalledTimes(1);
        expect(db.execute).not.toHaveBeenCalled();
    });

    it('uses in-memory maintenance data in browser mock mode so demos never call native commands', async () => {
        mocks.isBrowserMockMode.mockReturnValue(true);
        const controller = new AbortController();
        controller.abort();
        const browserImages = [
            { id: 'missing', isMissing: true, isDeleted: false, isIntermediate: false, metadata: { positivePrompt: 'prompt' } },
            { id: 'deleted', isMissing: false, isDeleted: true, isIntermediate: false, metadata: { positivePrompt: 'prompt' } },
            { id: 'intermediate', isMissing: false, isDeleted: false, isIntermediate: true, metadata: { positivePrompt: 'prompt' } },
            { id: 'metadata-intermediate', isMissing: false, isDeleted: false, isIntermediate: false, metadata: { positivePrompt: 'prompt', isIntermediate: true } },
            { id: 'untagged', isMissing: false, isDeleted: false, isIntermediate: false, metadata: {} },
            { id: 'regular', isMissing: false, isDeleted: false, isIntermediate: false, metadata: { positivePrompt: 'prompt' } },
        ];
        mocks.getBrowserMockImages.mockReturnValue(browserImages);

        const {
            backfillParameterColumns,
            normalizeAllPaths,
            verifyLibraryIntegrity,
            getMissingImages,
            pruneMissingLinks,
            getDeletedImages,
            getIntermediateImages,
            getUntaggedImages,
            getUnoptimizedImages,
            getUnoptimizedImagesCount,
            getUnoptimizedImageEntries,
            backfillImageFileHashes,
            cancelImageFileHashBackfill,
            getDuplicateCandidates,
            getMaintenanceCounts,
        } = await import('../maintenanceRepo');

        const progress = vi.fn();
        await expect(backfillParameterColumns()).resolves.toBe(0);
        await expect(normalizeAllPaths()).resolves.toBeUndefined();
        await expect(verifyLibraryIntegrity(progress, controller.signal)).resolves.toEqual({
            scanned: 5,
            total: 5,
            missingIds: [],
            sampleMissingPaths: [],
            wasCancelled: true,
        });
        await expect(getMissingImages()).resolves.toEqual([browserImages[0]]);
        await expect(pruneMissingLinks(['missing', 'regular'])).resolves.toBe(2);
        await expect(getDeletedImages()).resolves.toEqual([browserImages[1]]);
        await expect(getIntermediateImages()).resolves.toEqual([browserImages[2], browserImages[3]]);
        await expect(getUntaggedImages()).resolves.toEqual([browserImages[4]]);
        await expect(getUnoptimizedImages()).resolves.toEqual([]);
        await expect(getUnoptimizedImagesCount()).resolves.toBe(0);
        await expect(getUnoptimizedImageEntries(0, 10)).resolves.toEqual([]);
        await expect(backfillImageFileHashes()).resolves.toEqual({
            scanned: 0,
            updated: 0,
            missing: 0,
            errors: 0,
            remaining: 0,
            wasCancelled: false,
        });
        await expect(cancelImageFileHashBackfill()).resolves.toBeUndefined();
        await expect(getDuplicateCandidates()).resolves.toEqual([]);
        await expect(getMaintenanceCounts()).resolves.toEqual({
            untagged: 1,
            orphans: 0,
            intermediates: 2,
            missing: 1,
            trash: 1,
            duplicates: 0,
        });
        expect(progress).toHaveBeenCalledWith(5, 5);
        expect(mocks.updateBrowserMockImage).toHaveBeenCalledWith('missing', { isMissing: true });
        expect(mocks.updateBrowserMockImage).toHaveBeenCalledWith('regular', { isMissing: true });
        expect(mocks.getDb).not.toHaveBeenCalled();
        expect(mocks.commands.backfillParameterColumns).not.toHaveBeenCalled();
        expect(mocks.commands.cancelImageFileHashBackfill).not.toHaveBeenCalled();
    });

    it('audits missing files in chunks and reports progress without mutating rows', async () => {
        const rows = [
            { id: 'id-a', path: 'C:/library/a.png' },
            { id: 'id-b', path: 'C:/library/b.png' },
        ];
        const db = {
            select: vi.fn().mockResolvedValue(rows),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);
        mocks.commands.verifyImagePaths.mockResolvedValue(['C:/library/b.png']);

        const { verifyLibraryIntegrity } = await import('../maintenanceRepo');
        const progress: Array<[number, number]> = [];

        await expect(verifyLibraryIntegrity((processed, total) => progress.push([processed, total]))).resolves.toEqual({
            scanned: 2,
            total: 2,
            missingIds: ['id-b'],
            sampleMissingPaths: ['C:/library/b.png'],
            wasCancelled: false,
        });
        expect(mocks.commands.verifyImagePaths).toHaveBeenCalledWith(['C:/library/a.png', 'C:/library/b.png']);
        expect(db.execute).not.toHaveBeenCalled();
        expect(progress).toEqual([[2, 2]]);

        await expect(verifyLibraryIntegrity()).resolves.toMatchObject({ scanned: 2 });
    });

    it('caps missing-path samples across multiple audit chunks', async () => {
        const rows = Array.from({ length: 1001 }, (_, index) => ({
            id: `id-${index}`,
            path: `C:/library/${index}.png`,
        }));
        mocks.getDb.mockResolvedValue({ select: vi.fn().mockResolvedValue(rows), execute: vi.fn() });
        mocks.commands.verifyImagePaths
            .mockResolvedValueOnce(rows.slice(0, 10).map(row => row.path))
            .mockResolvedValueOnce([]);
        const { verifyLibraryIntegrity } = await import('../maintenanceRepo');

        const result = await verifyLibraryIntegrity();

        expect(result.sampleMissingPaths).toHaveLength(10);
        expect(mocks.commands.verifyImagePaths).toHaveBeenCalledTimes(2);
    });

    it('returns an empty integrity audit when there are no eligible images to scan', async () => {
        const db = {
            select: vi.fn().mockResolvedValue([]),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);

        const { verifyLibraryIntegrity } = await import('../maintenanceRepo');
        const progress = vi.fn();

        await expect(verifyLibraryIntegrity(progress)).resolves.toEqual({
            scanned: 0,
            total: 0,
            missingIds: [],
            sampleMissingPaths: [],
            wasCancelled: false,
        });
        expect(mocks.commands.verifyImagePaths).not.toHaveBeenCalled();
        expect(progress).not.toHaveBeenCalled();
    });

    it('stops integrity scanning before native path checks when cancellation is already requested', async () => {
        const db = {
            select: vi.fn().mockResolvedValue([{ id: 'id-a', path: 'C:/library/a.png' }]),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);
        const controller = new AbortController();
        controller.abort();

        const { verifyLibraryIntegrity } = await import('../maintenanceRepo');
        await expect(verifyLibraryIntegrity(undefined, controller.signal)).resolves.toEqual({
            scanned: 0,
            total: 1,
            missingIds: [],
            sampleMissingPaths: [],
            wasCancelled: true,
        });
        expect(mocks.commands.verifyImagePaths).not.toHaveBeenCalled();
    });

    it('keeps integrity progress moving when a native chunk check fails', async () => {
        const db = {
            select: vi.fn().mockResolvedValue([{ id: 'id-a', path: 'C:/library/a.png' }]),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);
        mocks.commands.verifyImagePaths.mockRejectedValue(new Error('permission denied'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { verifyLibraryIntegrity } = await import('../maintenanceRepo');
        const progress = vi.fn();

        await expect(verifyLibraryIntegrity(progress)).resolves.toEqual({
            scanned: 1,
            total: 1,
            missingIds: [],
            sampleMissingPaths: [],
            wasCancelled: false,
        });
        expect(progress).toHaveBeenCalledWith(1, 1);
        expect(errorSpy).toHaveBeenCalledWith('[Verify] Chunk check failed', expect.any(Error));
        errorSpy.mockRestore();
    });

    it('reports partial integrity results when cancellation happens between chunks', async () => {
        const rows = Array.from({ length: 1001 }, (_, index) => ({
            id: `id-${index}`,
            path: `C:/library/${index}.png`,
        }));
        const db = {
            select: vi.fn().mockResolvedValue(rows),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);
        mocks.commands.verifyImagePaths.mockResolvedValue([]);
        const controller = new AbortController();

        const { verifyLibraryIntegrity } = await import('../maintenanceRepo');
        await expect(verifyLibraryIntegrity(() => controller.abort(), controller.signal)).resolves.toEqual({
            scanned: 1000,
            total: 1001,
            missingIds: [],
            sampleMissingPaths: [],
            wasCancelled: true,
        });
        expect(mocks.commands.verifyImagePaths).toHaveBeenCalledTimes(1);
    });

    it('loads missing and deleted maintenance buckets with their dedicated row mappings', async () => {
        const db = {
            select: vi.fn()
                .mockResolvedValueOnce([{ id: 'missing', path: 'C:/library/missing.png' }])
                .mockResolvedValueOnce([{ id: 'deleted', path: 'C:/library/deleted.png' }]),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);

        const { getMissingImages, getDeletedImages } = await import('../maintenanceRepo');
        await expect(getMissingImages()).resolves.toEqual([{
            id: 'missing',
            url: 'C:/library/missing.png',
            thumbnailUrl: '',
            metadata: {},
        }]);
        await expect(getDeletedImages()).resolves.toEqual([{
            id: 'deleted',
            url: 'C:/library/deleted.png',
            thumbnailUrl: '',
            metadata: {},
        }]);

        expect(db.select.mock.calls[0][0]).toContain('WHERE is_missing = 1');
        expect(db.select.mock.calls[1][0]).toContain('FROM removed_images');
    });

    it('marks missing links in batches so very large audits stay under SQLite parameter limits', async () => {
        const db = {
            select: vi.fn(),
            execute: vi.fn().mockResolvedValue(undefined),
        };
        mocks.getDb.mockResolvedValue(db);
        const ids = Array.from({ length: 501 }, (_, index) => `id-${index}`);

        const { pruneMissingLinks } = await import('../maintenanceRepo');
        await expect(pruneMissingLinks(ids)).resolves.toBe(501);

        expect(db.execute).toHaveBeenCalledTimes(2);
        expect(db.execute.mock.calls[0][1]).toHaveLength(500);
        expect(db.execute.mock.calls[1][1]).toEqual(['id-500']);
    });

    it('skips missing-link writes when there is nothing to prune', async () => {
        const db = {
            select: vi.fn(),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);

        const { pruneMissingLinks } = await import('../maintenanceRepo');
        await expect(pruneMissingLinks([])).resolves.toBe(0);

        expect(db.execute).not.toHaveBeenCalled();
    });

    it('builds scoped intermediate queries by appending cleaned WHERE clauses', async () => {
        const db = {
            select: vi.fn().mockResolvedValue([{ id: 'id-a', path: 'C:/library/a.png' }]),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);

        const { getIntermediateImages } = await import('../maintenanceRepo');
        await expect(getIntermediateImages('WHERE model_name = ?', ['model-a'])).resolves.toEqual([{
            id: 'id-a',
            url: 'C:/library/a.png',
            thumbnailUrl: '',
            metadata: {},
        }]);

        const [query, params] = db.select.mock.calls[0] as [string, unknown[]];
        expect(query).toMatch(/AND\s+model_name = \?/);
        expect(query).toContain('ORDER BY timestamp DESC');
        expect(params).toEqual(['model-a']);
    });

    it('builds scoped untagged queries from caller filters without replacing the required predicates', async () => {
        const db = {
            select: vi.fn().mockResolvedValue([{ id: 'untagged', path: 'C:/library/untagged.png' }]),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);

        const { getUntaggedImages } = await import('../maintenanceRepo');
        await expect(getUntaggedImages('rating >= ?', [4])).resolves.toEqual([{
            id: 'untagged',
            url: 'C:/library/untagged.png',
            thumbnailUrl: '',
            metadata: {},
        }]);

        const [query, params] = db.select.mock.calls[0] as [string, unknown[]];
        expect(query).toContain("(positive_prompt IS NULL OR positive_prompt = '')");
        expect(query).toContain('AND rating >= ?');
        expect(params).toEqual([4]);
    });

    it('fetches unoptimized images with base thumbnail criteria when upgrades are not requested', async () => {
        const db = {
            select: vi.fn().mockResolvedValue([{ id: 'needs-thumb', path: 'C:/library/a.png' }]),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);

        const { getUnoptimizedImages } = await import('../maintenanceRepo');
        await expect(getUnoptimizedImages('WHERE model_name = ?', ['model-a'])).resolves.toEqual([{
            id: 'needs-thumb',
            url: 'C:/library/a.png',
            thumbnailUrl: '',
            metadata: {},
        }]);

        const [query, params] = db.select.mock.calls[0] as [string, unknown[]];
        expect(query).toContain("(path = thumbnail_path OR thumbnail_path IS NULL OR thumbnail_path = '')");
        expect(query).not.toContain("thumbnail_source IS NULL OR thumbnail_source != 'ambit'");
        expect(query).toMatch(/AND\s+model_name = \?/);
        expect(query).toContain('LIMIT 500');
        expect(params).toEqual(['model-a']);
    });

    it('clears stale filter params for global unoptimized counts', async () => {
        const db = {
            select: vi.fn().mockResolvedValue([{ count: 7 }]),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);

        const { getUnoptimizedImagesCount } = await import('../maintenanceRepo');
        await expect(getUnoptimizedImagesCount('', ['stale-param'], true)).resolves.toBe(7);

        const [query, params] = db.select.mock.calls[0] as [string, unknown[]];
        expect(query).toContain("thumbnail_source IS NULL OR thumbnail_source != 'ambit'");
        expect(params).toEqual([]);
    });

    it('defaults unoptimized counts to zero when SQLite returns no count row', async () => {
        const db = {
            select: vi.fn().mockResolvedValue([]),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);

        const { getUnoptimizedImagesCount } = await import('../maintenanceRepo');
        await expect(getUnoptimizedImagesCount('WHERE rating >= ?', [4])).resolves.toBe(0);

        const [query, params] = db.select.mock.calls[0] as [string, unknown[]];
        expect(query).toMatch(/AND\s+rating >= \?/);
        expect(params).toEqual([4]);
    });

    it('fetches unoptimized entries with stable pagination and caller filters', async () => {
        const db = {
            select: vi.fn().mockResolvedValue([{ id: 'id-a', path: 'C:/library/a.png' }]),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);

        const { getUnoptimizedImageEntries } = await import('../maintenanceRepo');
        await expect(getUnoptimizedImageEntries(500, 150, 'model_name = ?', ['model-a'])).resolves.toEqual([
            { id: 'id-a', path: 'C:/library/a.png' },
        ]);

        const [query, params] = db.select.mock.calls[0] as [string, unknown[]];
        expect(query).toContain('AND model_name = ?');
        expect(query).toContain('LIMIT 150 OFFSET 500');
        expect(params).toEqual(['model-a']);
    });

    it('clears stale filter params for global unoptimized entry pagination', async () => {
        const db = {
            select: vi.fn().mockResolvedValue([]),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);

        const { getUnoptimizedImageEntries } = await import('../maintenanceRepo');
        await expect(getUnoptimizedImageEntries(0, 25, '', ['stale-param'], true)).resolves.toEqual([]);

        const [query, params] = db.select.mock.calls[0] as [string, unknown[]];
        expect(query).toContain("thumbnail_source IS NULL OR thumbnail_source != 'ambit'");
        expect(query).toContain('LIMIT 25 OFFSET 0');
        expect(params).toEqual([]);
    });

    it('accepts alternate scoped predicate forms across maintenance queries', async () => {
        const db = {
            select: vi.fn().mockResolvedValue([]),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);
        const {
            getIntermediateImages,
            getUntaggedImages,
            getUnoptimizedImages,
            getUnoptimizedImagesCount,
            getUnoptimizedImageEntries,
        } = await import('../maintenanceRepo');

        await getIntermediateImages();
        await getIntermediateImages('rating >= ?', [1]);
        await getIntermediateImages('   ', ['ignored']);
        await getUntaggedImages();
        await getUntaggedImages('WHERE rating >= ?', [2]);
        await getUntaggedImages('   ', ['ignored']);
        await getUnoptimizedImages('rating >= ?', [3]);
        await getUnoptimizedImages('', ['stale']);
        await getUnoptimizedImagesCount('rating >= ?', [4]);
        await getUnoptimizedImageEntries(0, 10, 'WHERE rating >= ?', [5]);

        const queries = db.select.mock.calls.map(([query]) => query as string);
        expect(queries[0]).not.toContain('AND    ');
        expect(queries[1]).toMatch(/AND rating >= \?/);
        expect(queries[2]).not.toContain('AND    ');
        expect(queries[3]).not.toContain('AND    ');
        expect(queries[4]).toMatch(/AND\s+rating >= \?/);
        expect(queries[5]).not.toContain('AND    ');
        expect(queries[6]).toMatch(/AND rating >= \?/);
        expect(db.select.mock.calls[7][1]).toEqual([]);
        expect(queries[8]).toMatch(/AND rating >= \?/);
        expect(queries[9]).toMatch(/AND\s+rating >= \?/);
    });

    it('logs completed file hash backfills only when native work was scanned', async () => {
        const result = { scanned: 3, updated: 2, missing: 1, errors: 0, remaining: 4, wasCancelled: false };
        mocks.commands.backfillImageFileHashes.mockResolvedValue(result);
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        const { backfillImageFileHashes } = await import('../maintenanceRepo');
        await expect(backfillImageFileHashes()).resolves.toEqual(result);

        expect(mocks.commands.backfillImageFileHashes).toHaveBeenCalledWith(null);
        expect(logSpy).toHaveBeenCalledWith('[Maintenance] File hash backfill complete', result);
        logSpy.mockRestore();
    });

    it('keeps quiet when file hash backfill has no scanned native work', async () => {
        const result = { scanned: 0, updated: 0, missing: 0, errors: 0, remaining: 0, wasCancelled: false };
        mocks.commands.backfillImageFileHashes.mockResolvedValue(result);
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        const { backfillImageFileHashes } = await import('../maintenanceRepo');
        await expect(backfillImageFileHashes()).resolves.toEqual(result);

        expect(logSpy).not.toHaveBeenCalled();
        logSpy.mockRestore();
    });

    it('delegates file hash cancellation to the backend worker', async () => {
        mocks.commands.cancelImageFileHashBackfill.mockResolvedValue(undefined);

        const { cancelImageFileHashBackfill } = await import('../maintenanceRepo');
        await cancelImageFileHashBackfill();

        expect(mocks.commands.cancelImageFileHashBackfill).toHaveBeenCalledTimes(1);
    });

    it('maps duplicate candidates from the global exact-hash query without wrapping the indexed hash column', async () => {
        const db = {
            select: vi.fn().mockResolvedValue([{ id: 'dupe-a', path: 'C:/library/a.png' }]),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);

        const { getDuplicateCandidates } = await import('../maintenanceRepo');
        await expect(getDuplicateCandidates()).resolves.toEqual([{
            id: 'dupe-a',
            url: 'C:/library/a.png',
            thumbnailUrl: '',
            metadata: {},
        }]);

        const [query] = db.select.mock.calls[0] as [string];
        expect(query).toContain('duplicate_hashes');
        expect(query).toContain("file_hash != ''");
        expect(query).not.toContain('LOWER(TRIM(file_hash))');
        expect(query).toContain('is_missing = 0');
        expect(query).not.toContain('file_size, width, height');
        expect(db.select.mock.calls[0]).toHaveLength(1);
    });

    it('delegates an exact duplicate batch to the transactional native command', async () => {
        const resolutions = [{ keepId: 'keeper', removeIds: ['copy'] }];
        const result = {
            resolvedGroups: 1,
            removedIds: ['copy'],
            keepers: [{ id: 'keeper', isFavorite: true, isPinned: false, userMasked: null }],
        };
        mocks.commands.resolveExactDuplicateGroups.mockResolvedValue(result);
        mocks.unwrap.mockImplementation(async (value: unknown) => value);

        const { resolveExactDuplicateGroups } = await import('../maintenanceRepo');
        await expect(resolveExactDuplicateGroups(resolutions)).resolves.toEqual(result);

        expect(mocks.commands.resolveExactDuplicateGroups).toHaveBeenCalledWith(resolutions);
    });

    it('validates the entire browser duplicate batch before mutating any records', async () => {
        mocks.isBrowserMockMode.mockReturnValue(true);
        mocks.getBrowserMockImages.mockReturnValue([
            { id: 'keep-a', fileHash: 'hash-a', metadata: {} },
            { id: 'remove-a', fileHash: 'hash-a', metadata: {} },
            { id: 'keep-b', fileHash: 'hash-b', metadata: {} },
            { id: 'remove-b', fileHash: 'changed', metadata: {} },
        ]);

        const { resolveExactDuplicateGroups } = await import('../maintenanceRepo');
        await expect(resolveExactDuplicateGroups([
            { keepId: 'keep-a', removeIds: ['remove-a'] },
            { keepId: 'keep-b', removeIds: ['remove-b'] },
        ])).rejects.toThrow('Duplicate set changed');

        expect(mocks.updateBrowserMockImage).not.toHaveBeenCalled();
        expect(mocks.upsertBrowserMockCollection).not.toHaveBeenCalled();
    });

    it('propagates duplicate query failures so the UI cannot report a false clean result', async () => {
        const db = {
            select: vi.fn().mockRejectedValue(new Error('sqlite busy')),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);

        const { getDuplicateCandidates } = await import('../maintenanceRepo');
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await expect(getDuplicateCandidates()).rejects.toThrow('sqlite busy');
        error.mockRestore();
    });

    it('combines maintenance counters in one query for the dashboard summary', async () => {
        const db = {
            select: vi.fn().mockResolvedValue([{ untagged: 1, missing: 2, intermediates: 3, trash: 4 }]),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);

        const { getMaintenanceCounts } = await import('../maintenanceRepo');
        await expect(getMaintenanceCounts()).resolves.toEqual({
            untagged: 1,
            orphans: 2,
            intermediates: 3,
            missing: 2,
            trash: 4,
            duplicates: 0,
        });
        expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('defaults missing maintenance counters to zero when the aggregate row is absent', async () => {
        const db = {
            select: vi.fn().mockResolvedValue([]),
            execute: vi.fn(),
        };
        mocks.getDb.mockResolvedValue(db);

        const { getMaintenanceCounts } = await import('../maintenanceRepo');
        await expect(getMaintenanceCounts()).resolves.toEqual({
            untagged: 0,
            orphans: 0,
            intermediates: 0,
            missing: 0,
            trash: 0,
            duplicates: 0,
        });
    });
});
