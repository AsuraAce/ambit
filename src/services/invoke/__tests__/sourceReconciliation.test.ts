import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from '../../../bindings';
import { createInvokeImagePathResolver } from '../pathResolver';
import { reconcileInvokeSourceFacts as reconcileInvokeSourceFactsImpl } from '../sourceReconciliation';

const reconcileInvokeImageSources = vi.hoisted(() => vi.fn());
const replaceInvokeImageReferences = vi.hoisted(() => vi.fn());
const verifyImagePaths = vi.hoisted(() => vi.fn());

vi.mock('../../../bindings', () => ({
    commands: { reconcileInvokeImageSources, replaceInvokeImageReferences, verifyImagePaths },
}));

const root = 'D:/InvokeAI';
const reconcileInvokeSourceFacts = (
    options: Omit<Parameters<typeof reconcileInvokeSourceFactsImpl>[0], 'scope'>
) => reconcileInvokeSourceFactsImpl({
    scope: {
        mode: 'legacy',
        dbPath: `${root}/databases/invokeai.db`,
        imagesRoot: root,
    },
    ...options,
});

const createDb = (rows: Array<{
    image_name: string;
    image_subfolder?: string | null;
    image_category?: string | null;
    image_origin?: string | null;
    user_id?: string | null;
    metadata_blob?: unknown;
}>) => ({
    select: vi.fn(async (query: string) => {
        if (query.includes('SELECT count(*) as count FROM images')) {
            return [{ count: rows.length }];
        }
        if (query.includes('FROM images i')) {
            return rows;
        }
        return [];
    }),
});

describe('reconcileInvokeSourceFacts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        reconcileInvokeImageSources.mockImplementation(async (updates: unknown[]) => ({
            status: 'ok',
            data: { activeUpdated: updates.length, removedUpdated: 1 },
        }));
        replaceInvokeImageReferences.mockImplementation(async (referenceSets: unknown[]) => ({
            status: 'ok',
            data: {
                sourcesReplaced: referenceSets.length,
                referencesWritten: 0,
                skippedMissingSources: 0,
            },
        }));
        verifyImagePaths.mockResolvedValue({ status: 'ok', data: [] });
    });

    it('scopes both reconciliation passes to the selected owner', async () => {
        const rows = [{ image_name: 'owned.png', user_id: 'owner-a', metadata_blob: {} }];
        const queries: Array<{ sql: string; params?: unknown[] }> = [];
        const db = {
            select: vi.fn(async (sql: string, params?: unknown[]) => {
                queries.push({ sql, params });
                if (sql.includes('SELECT count(*)')) return [{ count: rows.length }];
                if (sql.includes('FROM images i')) return rows;
                return [];
            }),
        };
        const pathResolver = createInvokeImagePathResolver(root, async () => ['outputs/images/owned.png']);

        await reconcileInvokeSourceFactsImpl({
            db: db as never,
            columns: new Set(['user_id']),
            pathResolver,
            scope: {
                mode: 'owner',
                ownerId: 'owner-a',
                dbPath: `${root}/databases/invokeai.db`,
                imagesRoot: root,
            },
            onProgress: vi.fn(),
        });

        const imageQueries = queries.filter(({ sql }) => sql.includes('FROM images i'));
        expect(imageQueries.length).toBeGreaterThanOrEqual(3);
        imageQueries.forEach(({ sql, params }) => {
            expect(sql).toContain('i.user_id = ?');
            if (sql.includes('ORDER BY i.rowid ASC')) {
                expect(sql).toContain('i.rowid > ?');
                expect(sql).not.toContain('OFFSET');
                expect(params).toEqual(['owner-a', 0]);
            } else {
                expect(params).toEqual(['owner-a']);
            }
        });
    });

    it('uses rowid keyset pagination across both source passes and reports truthful phases', async () => {
        const rows = Array.from({ length: 501 }, (_, index) => ({
            source_rowid: index + 1,
            image_name: `image-${index + 1}.png`,
            metadata_blob: null,
        }));
        const db = {
            select: vi.fn(async (sql: string, params: unknown[] = []) => {
                if (sql.startsWith('SELECT rowid AS source_rowid')) return [{ source_rowid: 1 }];
                if (sql.includes('SELECT count(*)')) return [{ count: rows.length }];
                if (sql.includes('FROM images i')) {
                    const cursor = Number(params.at(-1) ?? 0);
                    return rows.filter(row => row.source_rowid > cursor).slice(0, 500);
                }
                return [];
            }),
        };
        const onProgress = vi.fn();

        await reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(['metadata_json']),
            pathResolver: createInvokeImagePathResolver(root, async () => rows.map(row => (
                `outputs/images/${row.image_name}`
            ))),
            onProgress,
        });

        const batchCalls = db.select.mock.calls.filter(([sql]) => sql.includes('ORDER BY i.rowid ASC'));
        expect(batchCalls).toHaveLength(4);
        expect(batchCalls.map(([, params]) => params)).toEqual([[0], [500], [0], [500]]);
        batchCalls.forEach(([sql]) => {
            expect(sql).toContain('i.rowid > ?');
            expect(sql).not.toContain('OFFSET');
        });
        expect(onProgress).toHaveBeenCalledWith(0, 0, 'Indexing InvokeAI image files...');
        expect(onProgress).toHaveBeenCalledWith(500, 501, 'Mapping InvokeAI image locations...');
        expect(onProgress).toHaveBeenCalledWith(0, 501, 'Updating InvokeAI image details...');
        expect(onProgress).toHaveBeenCalledWith(501, 501, 'Updating InvokeAI image details...');
    });

    it('uses ordered offset pagination only when the source table has no rowid', async () => {
        const rows = [{ image_name: 'asset.png' }];
        const db = {
            select: vi.fn(async (sql: string) => {
                if (sql.startsWith('SELECT rowid AS source_rowid')) {
                    throw new Error('no such column: rowid');
                }
                if (sql.includes('SELECT count(*)')) return [{ count: rows.length }];
                if (sql.includes('FROM images i')) return rows;
                return [];
            }),
        };

        await reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(),
            pathResolver: createInvokeImagePathResolver(root, async () => ['outputs/images/asset.png']),
            onProgress: vi.fn(),
        });

        const batchSql = db.select.mock.calls
            .map(([sql]) => sql)
            .filter(sql => sql.includes('FROM images i') && sql.includes('ORDER BY'));
        expect(batchSql).toHaveLength(2);
        batchSql.forEach(sql => {
            expect(sql).toContain('ORDER BY i.image_name ASC');
            expect(sql).toContain('OFFSET 0');
            expect(sql).not.toContain('i.rowid > ?');
        });
    });

    it('does not reread a short detail batch when the source shrinks after counting', async () => {
        const row = {
            source_rowid: 1,
            image_name: 'remaining.png',
            metadata_blob: null,
        };
        const db = {
            select: vi.fn(async (sql: string) => {
                if (sql.startsWith('SELECT rowid AS source_rowid')) return [{ source_rowid: 1 }];
                if (sql.includes('SELECT count(*)')) return [{ count: 501 }];
                if (sql.includes('FROM images i')) return [row];
                return [];
            }),
        };

        await reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(['metadata_json']),
            pathResolver: createInvokeImagePathResolver(root, async () => [
                'outputs/images/remaining.png',
            ]),
            onProgress: vi.fn(),
        });

        const detailQueries = db.select.mock.calls
            .map(([sql]) => sql)
            .filter(sql => sql.includes('metadata_blob'));
        expect(detailQueries).toHaveLength(1);
        expect(reconcileInvokeImageSources).toHaveBeenCalledOnce();
    });

    it('does not hide unrelated rowid capability probe failures behind compatibility pagination', async () => {
        const db = {
            select: vi.fn(async (sql: string) => {
                if (sql.includes('SELECT count(*)')) return [{ count: 1 }];
                if (sql.startsWith('SELECT rowid AS source_rowid')) {
                    throw new Error('database is locked');
                }
                return [];
            }),
        };

        await expect(reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(),
            pathResolver: createInvokeImagePathResolver(root, async () => []),
            onProgress: vi.fn(),
        })).rejects.toThrow('database is locked');
        expect(reconcileInvokeImageSources).not.toHaveBeenCalled();
    });

    it('lets canonical paths win and only emits an unclaimed unique legacy alias', async () => {
        const db = createDb([
            {
                image_name: 'shared.png',
                image_subfolder: null,
                image_category: 'general',
                image_origin: 'internal',
            },
            {
                image_name: 'shared.png',
                image_subfolder: 'references',
                image_category: 'control',
                image_origin: 'external',
            },
            {
                image_name: 'pose.png',
                image_subfolder: 'references',
                image_category: 'control',
                image_origin: 'external',
            },
        ]);
        const pathResolver = createInvokeImagePathResolver(root, async () => [
            'outputs/images/shared.png',
            'outputs/images/references/shared.png',
            'outputs/images/references/pose.png',
        ]);
        verifyImagePaths.mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths.filter(path => path === `${root}/outputs/images/pose.png`),
        }));

        const updated = await reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(['image_subfolder', 'image_category', 'image_origin']),
            pathResolver,
            onProgress: vi.fn(),
        });

        expect(commands.reconcileInvokeImageSources).toHaveBeenCalledOnce();
        const updates = reconcileInvokeImageSources.mock.calls[0][0];
        expect(updates).toEqual(expect.arrayContaining([
            {
                id: `${root}/outputs/images/shared.png`,
                invokeImageName: 'shared.png',
                invokeImageCategory: 'general',
                invokeImageOrigin: 'internal',
                invokeOwnerId: null,
            },
            {
                id: `${root}/outputs/images/references/shared.png`,
                invokeImageName: 'shared.png',
                invokeImageCategory: 'control',
                invokeImageOrigin: 'external',
                invokeOwnerId: null,
            },
            {
                id: `${root}/outputs/images/references/pose.png`,
                invokeImageName: 'pose.png',
                invokeImageCategory: 'control',
                invokeImageOrigin: 'external',
                invokeOwnerId: null,
            },
            {
                id: `${root}/outputs/images/pose.png`,
                invokeImageName: 'pose.png',
                invokeImageCategory: 'control',
                invokeImageOrigin: 'external',
                invokeOwnerId: null,
            },
        ]));
        expect(updates).toHaveLength(4);
        expect(updated).toBe(5);
    });

    it('does not apply a legacy alias over a different flat file that still exists', async () => {
        const db = createDb([{
            image_name: 'asset.png',
            image_subfolder: 'references',
            image_category: 'control',
            image_origin: 'external',
        }]);
        const canonicalPath = `${root}/outputs/images/references/asset.png`;
        const legacyPath = `${root}/outputs/images/asset.png`;
        verifyImagePaths.mockResolvedValueOnce({ status: 'ok', data: [] });

        await reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(['image_subfolder', 'image_category', 'image_origin']),
            pathResolver: createInvokeImagePathResolver(root, async () => [
                'outputs/images/references/asset.png',
                'outputs/images/asset.png',
            ]),
            onProgress: vi.fn(),
        });

        expect(verifyImagePaths).toHaveBeenCalledWith([legacyPath, canonicalPath]);
        expect(reconcileInvokeImageSources).toHaveBeenCalledWith([{
            id: canonicalPath,
            invokeImageName: 'asset.png',
            invokeImageCategory: 'control',
            invokeImageOrigin: 'external',
            invokeOwnerId: null,
        }]);
    });

    it('clears stale optional source facts when the InvokeAI columns are absent', async () => {
        const db = createDb([{ image_name: 'asset.png' }]);
        const pathResolver = createInvokeImagePathResolver(root, async () => [
            'outputs/images/asset.png',
        ]);

        await reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(),
            pathResolver,
            onProgress: vi.fn(),
        });

        expect(reconcileInvokeImageSources).toHaveBeenCalledWith([{
            id: `${root}/outputs/images/asset.png`,
            invokeImageName: 'asset.png',
            invokeImageCategory: null,
            invokeImageOrigin: null,
            invokeOwnerId: null,
        }]);
        const factQuery = db.select.mock.calls
            .map(call => call[0])
            .find(query => query.includes('NULL AS image_category'));
        expect(factQuery).toContain('NULL AS image_origin');
    });

    it('reconciles the authoritative image owner without reading user profile fields', async () => {
        const db = createDb([{
            image_name: 'owned.png',
            image_category: 'general',
            image_origin: 'internal',
            user_id: ' owner-a ',
        }]);

        await reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(['image_category', 'image_origin', 'user_id']),
            pathResolver: createInvokeImagePathResolver(root, async () => ['outputs/images/owned.png']),
            onProgress: vi.fn(),
        });

        expect(reconcileInvokeImageSources).toHaveBeenCalledWith([{
            id: `${root}/outputs/images/owned.png`,
            invokeImageName: 'owned.png',
            invokeImageCategory: 'general',
            invokeImageOrigin: 'internal',
            invokeOwnerId: 'owner-a',
        }]);
        const sourceQuery = db.select.mock.calls.map(call => call[0]).find(query => query.includes('metadata_blob'));
        expect(sourceQuery).toContain('CAST(i.user_id AS TEXT) AS user_id');
        expect(sourceQuery?.toLowerCase()).not.toContain('email');
        expect(sourceQuery?.toLowerCase()).not.toContain('password');
    });

    it('reconciles exact references for canonical and safe legacy source identities', async () => {
        const db = createDb([{
            image_name: 'result.png',
            image_subfolder: 'nested',
            metadata_blob: {
                init_image: ' Input.PNG ',
                controlnets: [{ image: { image_name: 'pose.png' } }],
            },
        }]);
        const canonicalPath = `${root}/outputs/images/nested/result.png`;
        const legacyPath = `${root}/outputs/images/result.png`;
        verifyImagePaths.mockResolvedValueOnce({ status: 'ok', data: [legacyPath] });

        await reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(['image_subfolder', 'metadata_json']),
            pathResolver: createInvokeImagePathResolver(root, async () => [
                'outputs/images/nested/result.png',
            ]),
            onProgress: vi.fn(),
        });

        expect(replaceInvokeImageReferences).toHaveBeenCalledWith([
            {
                sourceImageId: canonicalPath,
                references: [
                    { role: 'init_image', targetInvokeImageName: ' Input.PNG ' },
                    { role: 'controlnet_image', targetInvokeImageName: 'pose.png' },
                ],
            },
            {
                sourceImageId: legacyPath,
                references: [
                    { role: 'init_image', targetInvokeImageName: ' Input.PNG ' },
                    { role: 'controlnet_image', targetInvokeImageName: 'pose.png' },
                ],
            },
        ]);
        const factQuery = db.select.mock.calls
            .map(call => call[0])
            .find(query => query.includes('NULL AS image_category'));
        expect(factQuery).toContain('i.metadata_json AS metadata_blob');
    });

    it('uses a valid empty snapshot to clear references but preserves them for malformed metadata', async () => {
        const pathResolver = createInvokeImagePathResolver(root, async () => [
            'outputs/images/asset.png',
        ]);

        await reconcileInvokeSourceFacts({
            db: createDb([{ image_name: 'asset.png', metadata_blob: null }]) as never,
            columns: new Set(['metadata_json']),
            pathResolver,
            onProgress: vi.fn(),
        });

        expect(replaceInvokeImageReferences).toHaveBeenCalledWith([{
            sourceImageId: `${root}/outputs/images/asset.png`,
            references: [],
        }]);

        replaceInvokeImageReferences.mockClear();
        await reconcileInvokeSourceFacts({
            db: createDb([{ image_name: 'asset.png', metadata_blob: '{bad json' }]) as never,
            columns: new Set(['metadata_json']),
            pathResolver,
            onProgress: vi.fn(),
        });

        expect(replaceInvokeImageReferences).not.toHaveBeenCalled();
    });

    it('propagates native reference reconciliation failures', async () => {
        replaceInvokeImageReferences.mockResolvedValueOnce({
            status: 'error',
            error: 'reference write unavailable',
        });

        await expect(reconcileInvokeSourceFacts({
            db: createDb([{ image_name: 'asset.png', metadata_blob: null }]) as never,
            columns: new Set(['metadata_json']),
            pathResolver: createInvokeImagePathResolver(root, async () => [
                'outputs/images/asset.png',
            ]),
            onProgress: vi.fn(),
        })).rejects.toBe('reference write unavailable');
    });

    it.each([
        {
            label: 'category-only schema with an unknown future category',
            columns: ['image_category'],
            row: {
                image_name: 'asset.png',
                image_category: 'future-category',
                image_origin: null,
            },
            expectedCategory: 'future-category',
            expectedOrigin: null,
            selectedColumn: 'i.image_category',
            missingAlias: 'NULL AS image_origin',
        },
        {
            label: 'origin-only schema',
            columns: ['image_origin'],
            row: {
                image_name: 'asset.png',
                image_category: null,
                image_origin: 'external',
            },
            expectedCategory: null,
            expectedOrigin: 'external',
            selectedColumn: 'i.image_origin',
            missingAlias: 'NULL AS image_category',
        },
    ])('supports a $label', async ({
        columns,
        row,
        expectedCategory,
        expectedOrigin,
        selectedColumn,
        missingAlias,
    }) => {
        const db = createDb([row]);

        await reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(columns),
            pathResolver: createInvokeImagePathResolver(root, async () => [
                'outputs/images/asset.png',
            ]),
            onProgress: vi.fn(),
        });

        expect(reconcileInvokeImageSources).toHaveBeenCalledWith([{
            id: `${root}/outputs/images/asset.png`,
            invokeImageName: 'asset.png',
            invokeImageCategory: expectedCategory,
            invokeImageOrigin: expectedOrigin,
            invokeOwnerId: null,
        }]);
        const factQuery = db.select.mock.calls
            .map(call => call[0])
            .find(query => query.includes('FROM images i') && query.includes(missingAlias));
        expect(factQuery).toContain(selectedColumn);
    });

    it('stops before writing when cancelled', async () => {
        const db = createDb([{ image_name: 'asset.png' }]);
        const controller = new AbortController();
        controller.abort();

        await expect(reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(),
            pathResolver: createInvokeImagePathResolver(root, async () => []),
            onProgress: vi.fn(),
            signal: controller.signal,
        })).rejects.toThrow('Aborted');
        expect(reconcileInvokeImageSources).not.toHaveBeenCalled();
    });

    it('propagates native reconciliation failures', async () => {
        reconcileInvokeImageSources.mockResolvedValueOnce({
            status: 'error',
            error: 'database unavailable',
        });
        const db = createDb([{ image_name: 'asset.png' }]);

        await expect(reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(),
            pathResolver: createInvokeImagePathResolver(root, async () => [
                'outputs/images/asset.png',
            ]),
            onProgress: vi.fn(),
        })).rejects.toBe('database unavailable');
    });

    it('propagates legacy-path verification failures before writing', async () => {
        verifyImagePaths.mockResolvedValueOnce({
            status: 'error',
            error: 'path verification unavailable',
        });
        const db = createDb([{
            image_name: 'asset.png',
            image_subfolder: 'references',
        }]);

        await expect(reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(['image_subfolder']),
            pathResolver: createInvokeImagePathResolver(root, async () => [
                'outputs/images/references/asset.png',
            ]),
            onProgress: vi.fn(),
        })).rejects.toBe('path verification unavailable');
        expect(reconcileInvokeImageSources).not.toHaveBeenCalled();
    });
});
