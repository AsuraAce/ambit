import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from '@tauri-apps/plugin-sql';
import { commands } from '../../../bindings';
import { fetchBoardMappings } from '../connection';
import { insertImagesBatch } from '../../db';
import { reconcileInvokeBoardSnapshot, upsertInvokeBoardCollection } from '../../db/collectionRepo';
import {
    getFlatInvokeImageIdsForRoot,
    getImagesByIds,
    getRemovedImagesByIds,
    getRemovedInvokeImageNames,
    moveImagePathIdentities,
    moveImagePathIdentity,
    syncCollectionImages
} from '../../db/imageRepo';
import { syncImages as syncImagesImpl, type InvokePathCheckProgress, type InvokeSyncOptions } from '../syncService';
import { reconcileInvokeSourceFacts } from '../sourceReconciliation';
import { mapInvokeMetadata } from '../metadataMapper';
import { GeneratorTool, type AIImage } from '../../../types';

const invokeSourceDatabaseMock = vi.hoisted(() => vi.fn());

const legacyScope = {
    mode: 'legacy' as const,
    dbPath: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
    imagesRoot: 'D:/AmbitFixtures/InvokeAI',
};
const syncImages = (
    rootPath: string,
    onProgress: (current: number, total: number, message?: string) => void,
    signal?: AbortSignal,
    options: Omit<InvokeSyncOptions, 'scope'> = {}
) => {
    const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/$/, '');
    const isFile = /\.db$/i.test(normalizedRoot);
    const imagesRoot = isFile
        ? normalizedRoot.replace(/\/(?:databases\/)?invokeai\.db$/i, '')
        : normalizedRoot.replace(/\/databases$/i, '');
    return syncImagesImpl(rootPath, onProgress, signal, {
        scope: {
            ...legacyScope,
            dbPath: isFile ? normalizedRoot : `${imagesRoot}/databases/invokeai.db`,
            imagesRoot,
        },
        ...options,
    });
};

vi.mock('@tauri-apps/plugin-sql', () => ({
    default: {
        load: vi.fn()
    }
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((path: string) => `asset://${path}`)
}));

vi.mock('../../../bindings', () => ({
    commands: {
        getFileSizesBulk: vi.fn(),
        listInvokeaiImages: vi.fn(),
        probeFileMetadataBulk: vi.fn(),
        replaceInvokeImageReferences: vi.fn(),
        verifyImagePaths: vi.fn()
    }
}));

vi.mock('../metadataMapper', () => ({
    mapInvokeMetadata: vi.fn(() => ({
        tool: 'invokeai',
        model: 'Test Model',
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: 'test',
        negativePrompt: '',
        generationType: 'txt2img',
        loras: ['DetailBoost'],
        embeddings: ['EasyNegative'],
        controlNets: ['Depth Control'],
        ipAdapters: ['Face Adapter']
    }))
}));

vi.mock('../connection', () => ({
    fetchBoardMappings: vi.fn(),
    getInvokeSourceDatabase: invokeSourceDatabaseMock,
    resolveInvokePaths: vi.fn((rootPath: string) => {
        let imagesRoot = rootPath.replace(/\\/g, '/').replace(/\/$/, '');
        const isFile = /\.db$/i.test(imagesRoot);
        if (isFile) imagesRoot = imagesRoot.replace(/\/(?:databases\/)?invokeai\.db$/i, '');
        else if (/\/databases$/i.test(imagesRoot)) imagesRoot = imagesRoot.replace(/\/databases$/i, '');
        return {
            dbPath: isFile ? rootPath.replace(/\\/g, '/') : `${imagesRoot}/databases/invokeai.db`,
            imagesRoot,
        };
    })
}));

vi.mock('../sourceReconciliation', () => ({
    reconcileInvokeSourceFacts: vi.fn()
}));

vi.mock('../../db', () => ({
    insertImagesBatch: vi.fn()
}));

vi.mock('../../db/imageRepo', () => ({
    getFlatInvokeImageIdsForRoot: vi.fn(),
    getImagesByIds: vi.fn(),
    getRemovedImagesByIds: vi.fn(),
    getRemovedInvokeImageNames: vi.fn(),
    moveImagePathIdentities: vi.fn(),
    moveImagePathIdentity: vi.fn(),
    syncCollectionImages: vi.fn()
}));

vi.mock('../../db/collectionRepo', () => ({
    upsertInvokeBoardCollection: vi.fn(),
    reconcileInvokeBoardSnapshot: vi.fn()
}));

const createInvokeDb = (selectMock: ReturnType<typeof vi.fn>) => ({
    select: selectMock
});

const makeExistingInvokeImage = (filename: string, overrides: Partial<AIImage> = {}): AIImage => {
    const id = `D:/AmbitFixtures/InvokeAI/outputs/images/${filename}`;
    const metadata = {
        tool: GeneratorTool.INVOKEAI,
        model: 'Test Model',
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: 'raw',
        negativePrompt: ''
    };
    return {
        id,
        url: `asset://${id}`,
        thumbnailUrl: `asset://${id}`,
        filename,
        timestamp: 100,
        width: 512,
        height: 512,
        isFavorite: false,
        isPinned: false,
        metadata,
        originalMetadata: metadata,
        originalChunks: { invokeai_metadata: JSON.stringify({ positive_prompt: 'raw' }) },
        invokeImageName: filename,
        ...overrides,
    };
};

const arrangeImportBatches = (rowCount: number, metadataBlob: unknown = {}) => {
    const rows = Array.from({ length: rowCount }, (_, index) => ({
        image_name: `image-${index}.png`,
        metadata_blob: metadataBlob,
        created_at: '2026-04-18 12:00:00',
        width: 512,
        height: 512,
    }));
    const selectMock = vi.fn(async (sql: string) => {
        if (sql.includes('PRAGMA table_info(images)')) return [{ name: 'metadata_json' }];
        if (sql.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }, { name: 'boards' }];
        if (sql.includes('SELECT 1 as found FROM images i')) return [{ found: 1 }];
        if (sql.includes('SELECT count(*) as count FROM images i')) return [{ count: rows.length }];
        if (sql.includes('FROM images i') && sql.includes('OFFSET')) {
            const offset = Number(sql.match(/OFFSET (\d+)/)?.[1]);
            return rows.slice(offset, offset + 500);
        }
        return [];
    });
    vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
    return selectMock;
};

const arrangeManualRepair = async ({
    name,
    subfolder = 'nested',
    size = 123,
    existingPaths,
    rejectSize = false,
    includeUnmatchedRow = false,
    rowImageName = name,
    thumbnailName = null,
    ownerId,
    signal,
    onRepairRows,
}: {
    name: string;
    subfolder?: string;
    size?: number;
    existingPaths: string[];
    rejectSize?: boolean;
    includeUnmatchedRow?: boolean;
    rowImageName?: string;
    thumbnailName?: string | null;
    ownerId?: string;
    signal?: AbortSignal;
    onRepairRows?: (query: string, params?: unknown[]) => void;
}) => {
    const root = 'D:/AmbitFixtures/InvokeAI';
    const stalePath = `${root}/outputs/images/${name}`;
    const targetPath = subfolder ? `${root}/outputs/images/${subfolder}/${name}` : stalePath;
    const repairRow = {
        image_name: rowImageName,
        image_subfolder: subfolder || null,
        thumbnail_name: thumbnailName,
        metadata_blob: {},
        created_at: '2026-04-18 12:00:00'
    };
    const selectMock = vi.fn(async (query: string, params?: unknown[]) => {
        if (query.includes('PRAGMA table_info(images)')) {
            return [
                { name: 'metadata_json' },
                { name: 'image_subfolder' },
                { name: 'thumbnail_name' },
                ...(ownerId ? [{ name: 'user_id' }] : []),
            ];
        }
        if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
        if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 0 }];
        if (query.includes('SELECT i.image_name')) {
            onRepairRows?.(query, params);
            return includeUnmatchedRow
                ? [repairRow, { ...repairRow, image_name: 'not-stale.png' }]
                : [repairRow];
        }
        return [];
    });
    vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
    vi.mocked(getFlatInvokeImageIdsForRoot).mockResolvedValue([stalePath]);
    vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
        status: 'ok',
        data: [subfolder ? `outputs/images/${subfolder}/${name}` : `outputs/images/${name}`]
    } as never);
    if (rejectSize) vi.mocked(commands.getFileSizesBulk).mockRejectedValue(new Error('probe failed'));
    else vi.mocked(commands.getFileSizesBulk).mockResolvedValue({ status: 'ok', data: [size] } as never);
    vi.mocked(getImagesByIds).mockResolvedValue(existingPaths.map(path => makeExistingInvokeImage(name, { id: path })));

    const result = ownerId
        ? await syncImagesImpl(root, vi.fn(), signal, {
            scope: {
                mode: 'owner',
                ownerId,
                dbPath: `${root}/databases/invokeai.db`,
                imagesRoot: root,
            },
            mode: 'manual',
            syncBoards: false,
            syncFavorites: false,
        })
        : await syncImages(root, vi.fn(), signal, {
            mode: 'manual', syncBoards: false, syncFavorites: false
        });
    return { result, stalePath, targetPath };
};

const arrangeManualPathCheck = ({
    names,
    rows,
    relativeRows = [],
}: {
    names: string[];
    rows: Array<{ image_name: string; image_subfolder?: string }>;
    relativeRows?: Array<{ image_name: string; image_subfolder?: string }>;
}) => {
    const images = names.map(name => makeExistingInvokeImage(name, { invokeImageName: undefined }));
    const selectMock = vi.fn(async (query: string, params?: unknown[]): Promise<unknown[]> => {
        if (query.includes('PRAGMA table_info(images)')) {
            return ['metadata_json', 'image_subfolder', 'thumbnail_name', 'is_intermediate', 'user_id', 'updated_at']
                .map(name => ({ name }));
        }
        if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
        if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 0 }];
        if (query.includes('SELECT i.image_name')) {
            if (query.includes('instr(REPLACE(i.image_name')) return relativeRows;
            const queryNames = query.includes('json_each(?)')
                ? JSON.parse(params?.[0] as string) as string[]
                : params;
            return rows.filter(row => queryNames?.includes(row.image_name.toLowerCase()));
        }
        return [];
    });
    vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
    vi.mocked(getFlatInvokeImageIdsForRoot).mockResolvedValue(images.map(image => image.id));
    vi.mocked(getImagesByIds).mockImplementation(async ids => images.filter(image => ids.includes(image.id)));
    vi.mocked(moveImagePathIdentities).mockImplementation(async moves => ({
        moved: moves.length, skippedTargetExists: 0, skippedSourceMissing: 0,
    }));
    return selectMock;
};

describe('syncImages live mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        invokeSourceDatabaseMock.mockImplementation((path: string) => Database.load(`sqlite:${path}`));
        vi.mocked(commands.getFileSizesBulk).mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths.map(() => 123)
        }) as never);
        vi.mocked(commands.probeFileMetadataBulk).mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths.map(() => ({ status: 'present', size: 123, isFile: true }))
        }) as never);
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({ status: 'ok', data: [] } as never);
        vi.mocked(commands.replaceInvokeImageReferences).mockResolvedValue({
            status: 'ok',
            data: { sourcesReplaced: 0, referencesWritten: 0, skippedMissingSources: 0 },
        } as never);
        vi.mocked(commands.verifyImagePaths).mockResolvedValue({ status: 'ok', data: [] } as never);
        vi.mocked(insertImagesBatch).mockResolvedValue(undefined as never);
        vi.mocked(getFlatInvokeImageIdsForRoot).mockResolvedValue([]);
        vi.mocked(getImagesByIds).mockResolvedValue([]);
        vi.mocked(getRemovedImagesByIds).mockResolvedValue([]);
        vi.mocked(getRemovedInvokeImageNames).mockResolvedValue([]);
        vi.mocked(moveImagePathIdentities).mockResolvedValue({
            moved: 0,
            skippedTargetExists: 0,
            skippedSourceMissing: 0
        });
        vi.mocked(moveImagePathIdentity).mockResolvedValue(false);
        vi.mocked(syncCollectionImages).mockResolvedValue(undefined as never);
        vi.mocked(reconcileInvokeBoardSnapshot).mockResolvedValue({
            collectionsUpdated: 0,
            collectionsDeleted: 0,
            imagesUpdated: 0,
            membershipsDeleted: 0,
            membershipsInserted: 0,
        });
        vi.mocked(upsertInvokeBoardCollection).mockResolvedValue(undefined as never);
        vi.mocked(reconcileInvokeSourceFacts).mockResolvedValue(0);
        vi.mocked(fetchBoardMappings).mockResolvedValue({
            imageToBoardId: new Map(),
            boards: new Map(),
            isAuthoritative: true,
        });
    });

    it('uses the exact selected-owner predicate for candidate, count, and batch queries', async () => {
        const queries: Array<{ sql: string; params?: unknown[] }> = [];
        const selectMock = vi.fn(async (sql: string, params?: unknown[]) => {
            queries.push({ sql, params });
            if (sql.includes('PRAGMA table_info(images)')) {
                return [{ name: 'metadata_json' }, { name: 'user_id' }];
            }
            if (sql.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
            if (sql.includes('SELECT 1 as found')) return [{ found: 1 }];
            if (sql.includes('SELECT count(*) as count')) return [{ count: 1 }];
            if (sql.includes('SELECT i.image_name')) return [];
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);

        await syncImagesImpl('D:/Invoke', vi.fn(), undefined, {
            scope: {
                mode: 'owner',
                ownerId: 'owner-a',
                dbPath: 'D:/Invoke/databases/invokeai.db',
                imagesRoot: 'D:/Invoke',
            },
            mode: 'live',
            syncBoards: false,
            syncFavorites: false,
        });

        const scopedQueries = queries.filter(({ sql }) => (
            sql.includes('SELECT 1 as found')
            || sql.includes('SELECT count(*) as count')
            || sql.includes('SELECT i.image_name')
        ));
        expect(scopedQueries).toHaveLength(3);
        scopedQueries.forEach(({ sql, params }) => {
            expect(sql).toContain('i.user_id = ?');
            expect(params).toEqual(['owner-a']);
        });
    });

    it('fails before candidate discovery when selected-owner filtering is unavailable', async () => {
        const selectMock = vi.fn(async (sql: string) => {
            if (sql.includes('PRAGMA table_info(images)')) return [{ name: 'metadata_json' }];
            if (sql.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);

        await expect(syncImagesImpl('D:/Invoke', vi.fn(), undefined, {
            scope: {
                mode: 'owner',
                ownerId: 'owner-a',
                dbPath: 'D:/Invoke/databases/invokeai.db',
                imagesRoot: 'D:/Invoke',
            },
            mode: 'live',
        })).rejects.toThrow('images.user_id is missing');
        expect(selectMock.mock.calls.some(([sql]) => String(sql).includes('SELECT 1 as found'))).toBe(false);
    });

    it('preserves an untouched board assignment when owner board mappings are unavailable', async () => {
        const fullPath = 'D:/Invoke/outputs/images/owned.png';
        const selectMock = vi.fn(async (sql: string) => {
            if (sql.includes('PRAGMA table_info(images)')) {
                return [{ name: 'metadata_json' }, { name: 'user_id' }];
            }
            if (sql.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }, { name: 'boards' }];
            }
            if (sql.includes('SELECT count(*) as count FROM images i')) return [{ count: 1 }];
            if (sql.includes("name='boards'")) return [{ name: 'boards' }];
            if (sql.includes('FROM images i') && sql.includes('OFFSET 0')) {
                return [{
                    image_name: 'owned.png',
                    metadata_blob: { positive_prompt: 'raw' },
                    created_at: '2026-04-18T12:00:00Z',
                    width: 512,
                    height: 512,
                    user_id: 'owner-a',
                }];
            }
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(fetchBoardMappings).mockResolvedValueOnce({
            imageToBoardId: new Map(),
            boards: new Map(),
            isAuthoritative: false,
        });
        vi.mocked(getImagesByIds).mockResolvedValue([
            makeExistingInvokeImage('owned.png', {
                id: fullPath,
                boardId: 'board-a',
                originalState: { isFavorite: false, isPinned: false, boardId: 'board-a' },
                invokeOwnerId: 'owner-a',
            }),
        ]);

        await syncImagesImpl('D:/Invoke', vi.fn(), undefined, {
            scope: {
                mode: 'owner',
                ownerId: 'owner-a',
                dbPath: 'D:/Invoke/databases/invokeai.db',
                imagesRoot: 'D:/Invoke',
            },
            mode: 'manual',
            syncBoards: true,
            syncFavorites: false,
        });

        expect(insertImagesBatch).not.toHaveBeenCalled();
        expect(syncCollectionImages).not.toHaveBeenCalled();
        expect(upsertInvokeBoardCollection).not.toHaveBeenCalled();
    });

    it('uses selected-owner filtering during manual stale-path repair', async () => {
        const ownerRepairQueries: Array<{ query: string; params?: unknown[] }> = [];

        await arrangeManualRepair({
            name: 'owned.png',
            ownerId: 'owner-a',
            existingPaths: [],
            onRepairRows: (query, params) => ownerRepairQueries.push({ query, params }),
        });

        expect(ownerRepairQueries.length).toBeGreaterThan(0);
        ownerRepairQueries.forEach(({ query, params }) => {
            expect(query).toContain('i.user_id = ?');
            expect(params?.at(-1)).toBe('owner-a');
        });
    });

    it('checks more than 500 flat names with one JSON query without replaying image history or advancing its cursor', async () => {
        const names = Array.from({ length: 1001 }, (_, index) => `flat-${index}.png`);
        const selectMock = arrangeManualPathCheck({ names, rows: names.map(image_name => ({ image_name })) });
        const afterTimestamp = Date.parse('2026-10-01T12:00:00Z');
        const onProgress = vi.fn();
        const onPathCheckProgress = vi.fn();

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', onProgress, undefined, {
            mode: 'manual', afterTimestamp, syncBoards: false, onPathCheckProgress,
        });

        const repairQueries = selectMock.mock.calls.filter(([query]) => query.includes('SELECT i.image_name'));
        expect(repairQueries).toHaveLength(2);
        expect(repairQueries[0][0]).toContain('IN (SELECT value FROM json_each(?))');
        expect(repairQueries[0][1]).toEqual([JSON.stringify(names)]);
        expect(repairQueries.filter(([query]) => query.includes('instr(REPLACE(i.image_name'))).toHaveLength(1);
        expect(repairQueries.every(([query]) => !query.includes('i.created_at > ?') && !query.includes('OFFSET'))).toBe(true);
        expect(result).toMatchObject({ imported: 0, updated: 0, pathsRepaired: 0, maxTimestamp: afterTimestamp });
        expect(insertImagesBatch).not.toHaveBeenCalled();
        expect(mapInvokeMetadata).not.toHaveBeenCalled();
        expect(onPathCheckProgress).toHaveBeenNthCalledWith(1, { phase: 'checking', current: 0, total: 0, repaired: 0 });
        expect(onPathCheckProgress).toHaveBeenLastCalledWith({ phase: 'checking', current: 1001, total: 1001, repaired: 0 });
        expect(onProgress).toHaveBeenCalledWith(0, 0, 'Checking image locations…');
        expect(onProgress.mock.calls.some(([, , message]) => message === 'Updating image references…')).toBe(false);
    });

    it('skips unchanged locations before all downstream repair probes and record hydration', async () => {
        arrangeManualPathCheck({ names: ['unchanged.png'], rows: [{ image_name: 'unchanged.png' }] });

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual', syncBoards: false,
        });

        expect(result).toMatchObject({ updated: 0, pathsRepaired: 0 });
        expect(commands.getFileSizesBulk).not.toHaveBeenCalled();
        expect(getImagesByIds).not.toHaveBeenCalled();
        expect(commands.verifyImagePaths).not.toHaveBeenCalled();
        expect(mapInvokeMetadata).not.toHaveBeenCalled();
        expect(commands.probeFileMetadataBulk).toHaveBeenCalledExactlyOnceWith(['D:/AmbitFixtures/InvokeAI/outputs/images']);
        expect(moveImagePathIdentities).not.toHaveBeenCalled();
    });

    it.each([false, true])('preserves owner and intermediate scope in both repair lookups (intermediates: %s)', async importIntermediates => {
        const selectMock = arrangeManualPathCheck({ names: ['owned.png'], rows: [] });

        await syncImagesImpl('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            scope: { ...legacyScope, mode: 'owner', ownerId: 'owner-a' },
            mode: 'manual', syncBoards: false, importIntermediates,
        });

        const repairQueries = selectMock.mock.calls.filter(([query]) => query.includes('SELECT i.image_name'));
        expect(repairQueries).toHaveLength(2);
        expect(repairQueries[0][1]).toEqual([JSON.stringify(['owned.png']), 'owner-a']);
        expect(repairQueries[1][1]).toEqual(['owner-a']);
        for (const [query] of repairQueries) {
            expect(query).toContain('i.user_id = ?');
            expect(query.includes('i.is_intermediate = 0')).toBe(!importIntermediates);
        }
    });

    it('rejects ambiguous relative basenames even when their source rows span the 250-row boundary', async () => {
        const names = Array.from({ length: 249 }, (_, index) => `unique-${index}.png`);
        arrangeManualPathCheck({
            names: ['duplicate.png', ...names],
            rows: [],
            relativeRows: [
                { image_name: 'first/duplicate.png' },
                ...names.map(name => ({ image_name: `nested/${name}` })),
                { image_name: 'last/duplicate.png' },
            ],
        });

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual', syncBoards: false,
        });

        const moves = vi.mocked(moveImagePathIdentities).mock.calls.flatMap(([batch]) => batch);
        expect(moves).toHaveLength(249);
        expect(moves.some(move => move.oldId.endsWith('/duplicate.png'))).toBe(false);
        expect(result).toMatchObject({ updated: 249, pathsRepaired: 249 });
    });

    it('rejects a conflicting relative source row even when every flat name already matched', async () => {
        arrangeManualPathCheck({
            names: ['duplicate.png'],
            rows: [{ image_name: 'duplicate.png', image_subfolder: 'first' }],
            relativeRows: [{ image_name: 'last/duplicate.png' }],
        });

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual', syncBoards: false,
        });

        expect(result).toMatchObject({ updated: 0, pathsRepaired: 0 });
        expect(moveImagePathIdentities).not.toHaveBeenCalled();
        expect(commands.getFileSizesBulk).not.toHaveBeenCalled();
    });

    it('keeps globally ambiguous repairs rejected while importing eligible relative rows across image batches', async () => {
        const relativeRows = [
            { image_name: 'first/duplicate.png' },
            ...Array.from({ length: 499 }, (_, index) => ({ image_name: `nested/unique-${index}.png` })),
            { image_name: 'last/duplicate.png' },
        ];
        const selectMock = arrangeManualPathCheck({ names: ['duplicate.png'], rows: [], relativeRows });
        const originalSelect = selectMock.getMockImplementation()!;
        selectMock.mockImplementation(async (query, params) => {
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: relativeRows.length }];
            if (query.includes('OFFSET')) {
                const offset = Number(query.match(/OFFSET (\d+)/)?.[1]);
                return relativeRows.slice(offset, offset + 500).map(row => ({
                    ...row, metadata_blob: {}, created_at: '2026-04-18T12:00:00Z', width: 512, height: 512,
                }));
            }
            return originalSelect(query, params);
        });
        const legacy = makeExistingInvokeImage('duplicate.png', {
            invokeImageName: 'first/duplicate.png', isFavorite: true, notes: 'Preserve the original record',
        });
        const catalog = new Map([[legacy.id, legacy]]);
        vi.mocked(getImagesByIds).mockImplementation(async ids => ids.flatMap(id => catalog.get(id) ?? []));
        vi.mocked(insertImagesBatch).mockImplementation(async images => {
            images.forEach(image => catalog.set(image.id, image));
        });
        vi.mocked(moveImagePathIdentity).mockImplementation(async (oldId, newId) => {
            const image = catalog.get(oldId);
            if (!image || catalog.has(newId)) return false;
            catalog.delete(oldId);
            catalog.set(newId, { ...image, id: newId });
            return true;
        });

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual', syncBoards: false,
        });

        expect(result).toMatchObject({ imported: 501, updated: 0, pathsRepaired: 0 });
        expect(moveImagePathIdentities).not.toHaveBeenCalled();
        expect(moveImagePathIdentity).not.toHaveBeenCalled();
        expect(vi.mocked(insertImagesBatch).mock.calls.map(([images]) => images.length)).toEqual([500, 1]);
        expect(catalog.get(legacy.id)).toBe(legacy);
        expect(catalog.get('D:/AmbitFixtures/InvokeAI/outputs/images/first/duplicate.png')).toMatchObject({
            isFavorite: false, notes: undefined,
        });
    });

    it.each([
        {
            label: 'unsafe', rows: [],
            relativeRows: [{ image_name: '../duplicate.png' }, { image_name: 'known/duplicate.png' }],
            diskPaths: [],
        },
        {
            label: 'ambiguous on disk', rows: [{ image_name: 'duplicate.png' }],
            relativeRows: [{ image_name: 'known/duplicate.png' }],
            diskPaths: ['outputs/images/known/duplicate.png', 'outputs/images/other/duplicate.png'],
        },
    ])('rejects a unique target when another row for its legacy source is $label', async ({ rows, relativeRows, diskPaths }) => {
        arrangeManualPathCheck({ names: ['duplicate.png'], rows, relativeRows });
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({ status: 'ok', data: diskPaths });
        vi.mocked(getImagesByIds).mockResolvedValue([makeExistingInvokeImage('duplicate.png', { invokeImageName: 'known/duplicate.png' })]);

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual', syncBoards: false,
        });

        expect(result).toMatchObject({ updated: 0, pathsRepaired: 0 });
        expect(commands.getFileSizesBulk).not.toHaveBeenCalled();
        expect(moveImagePathIdentities).not.toHaveBeenCalled();
    });

    it.each([
        { label: 'a different known source', storedName: 'other/asset.png', expectedMoved: false },
        { label: 'the same source with legacy separators', storedName: 'nested\\asset.png', expectedMoved: true },
        { label: 'a legacy unknown source name', storedName: undefined, expectedMoved: true },
    ].flatMap(testCase => (['manual', 'live'] as const).map(mode => ({ ...testCase, mode }))))('guards $mode repair identity for $label', async ({ storedName, expectedMoved, mode }) => {
        const selectMock = arrangeManualPathCheck({ names: ['asset.png'], rows: [], relativeRows: [{ image_name: 'nested/asset.png' }] });
        const originalSelect = selectMock.getMockImplementation()!;
        selectMock.mockImplementation(async (query, params) => {
            if (query.includes('SELECT 1 as found FROM images i')) return [{ found: 1 }];
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: mode === 'manual' ? 0 : 1 }];
            if (query.includes('OFFSET 0')) return [{
                image_name: 'nested/asset.png', metadata_blob: {},
                created_at: '2026-04-18T12:00:00Z', width: 512, height: 512,
            }];
            if (query.includes('OFFSET')) return [];
            return originalSelect(query, params);
        });
        vi.mocked(getImagesByIds).mockResolvedValue([makeExistingInvokeImage('asset.png', { invokeImageName: storedName })]);
        vi.mocked(moveImagePathIdentity).mockResolvedValue(true);

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode, syncBoards: false,
        });

        expect(result).toMatchObject({
            imported: mode === 'live' && !expectedMoved ? 1 : 0,
            updated: expectedMoved ? 1 : 0,
            pathsRepaired: expectedMoved ? 1 : 0,
        });
        expect(moveImagePathIdentities).toHaveBeenCalledTimes(mode === 'manual' && expectedMoved ? 1 : 0);
        expect(moveImagePathIdentity).toHaveBeenCalledTimes(mode === 'live' && expectedMoved ? 1 : 0);
        expect(getFlatInvokeImageIdsForRoot).toHaveBeenCalledTimes(mode === 'manual' ? 1 : 0);
    });

    it('bounds atomic reference corrections to 250 and reports actual native corrections', async () => {
        const names = Array.from({ length: 501 }, (_, index) => `moved-${index}.png`);
        arrangeManualPathCheck({ names, rows: names.map(image_name => ({ image_name, image_subfolder: 'nested' })) });
        vi.mocked(moveImagePathIdentities).mockResolvedValueOnce({
            moved: 248, skippedTargetExists: 1, skippedSourceMissing: 1,
        });
        const callbackSequence: string[] = [];
        const onProgress = vi.fn((current: number, total: number, message?: string) => {
            callbackSequence.push(`progress:${message}:${current}/${total}`);
        });
        const onPathCheckProgress = vi.fn((progress: InvokePathCheckProgress) => {
            const message = progress.phase === 'checking' ? 'Checking image locations…' : 'Updating image references…';
            callbackSequence.push(`typed:${message}:${progress.current}/${progress.total}`);
        });
        const onBatchCommitted = vi.fn(() => { callbackSequence.push('committed'); });

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', onProgress, undefined, {
            mode: 'manual', syncBoards: false, onPathCheckProgress, onBatchCommitted,
        });

        expect(vi.mocked(moveImagePathIdentities).mock.calls.map(([moves]) => moves.length)).toEqual([250, 250, 1]);
        expect(result).toMatchObject({ imported: 0, updated: 499, pathsRepaired: 499 });
        expect(onPathCheckProgress).toHaveBeenLastCalledWith({ phase: 'repairing', current: 501, total: 501, repaired: 499 });
        expect(onProgress).toHaveBeenLastCalledWith(501, 501, 'Updating image references…');
        callbackSequence.forEach((event, index) => {
            if (event.startsWith('typed:')) expect(callbackSequence[index - 1]).toBe(event.replace(/^typed:/, 'progress:'));
            if (event === 'committed') expect(callbackSequence[index - 1]).toMatch(/^typed:/);
        });
    });

    it('waits for native repair settlement and reports committed corrections before rejecting cancellation', async () => {
        const names = Array.from({ length: 251 }, (_, index) => `cancel-${index}.png`);
        arrangeManualPathCheck({ names, rows: names.map(image_name => ({ image_name, image_subfolder: 'nested' })) });
        const controller = new AbortController();
        let releaseMove!: () => void;
        const pendingMove = new Promise<void>(resolve => { releaseMove = resolve; });
        vi.mocked(moveImagePathIdentities).mockImplementationOnce(async () => {
            await pendingMove;
            return { moved: 248, skippedTargetExists: 1, skippedSourceMissing: 1 };
        });
        const onPathCheckProgress = vi.fn();
        const onBatchCommitted = vi.fn();
        const settled = vi.fn();
        const operation = syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), controller.signal, {
            mode: 'manual', syncBoards: false, onPathCheckProgress, onBatchCommitted,
        }).finally(settled);
        const rejection = expect(operation).rejects.toThrow('Aborted');
        await vi.waitFor(() => expect(moveImagePathIdentities).toHaveBeenCalledOnce());
        controller.abort();
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();
        expect(onPathCheckProgress.mock.calls.every(([progress]) => progress.repaired === 0)).toBe(true);

        releaseMove();
        await rejection;

        expect(moveImagePathIdentities).toHaveBeenCalledOnce();
        expect(onPathCheckProgress).toHaveBeenLastCalledWith({ phase: 'repairing', current: 250, total: 251, repaired: 248 });
        expect(onBatchCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ imported: 0, updated: 248 }));
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('counts broad and inline corrections cumulatively without counting the same inline metadata update twice', async () => {
        const selectMock = arrangeManualPathCheck({
            names: ['broad.png'],
            rows: [{ image_name: 'broad.png', image_subfolder: 'nested' }],
        });
        const originalSelect = selectMock.getMockImplementation()!;
        selectMock.mockImplementation(async (query, params) => {
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 1 }];
            if (query.includes('OFFSET 0')) return [{
                image_name: 'inline.png', image_subfolder: 'nested', metadata_blob: {},
                created_at: '2026-04-18T12:00:00Z', width: 512, height: 512,
            }];
            if (query.includes('OFFSET')) return [];
            return originalSelect(query, params);
        });
        const images = [makeExistingInvokeImage('broad.png'), makeExistingInvokeImage('inline.png', { invokeImageCategory: 'outdated' })];
        vi.mocked(getImagesByIds).mockImplementation(async ids => images.filter(image => ids.includes(image.id)));
        vi.mocked(moveImagePathIdentity).mockResolvedValueOnce(true);
        const onPathCheckProgress = vi.fn();
        const onBatchCommitted = vi.fn();

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual', syncBoards: false, onPathCheckProgress, onBatchCommitted,
        });

        expect(result).toMatchObject({ imported: 0, updated: 2, pathsRepaired: 2 });
        expect(moveImagePathIdentities).toHaveBeenCalledOnce();
        expect(moveImagePathIdentity).toHaveBeenCalledOnce();
        expect(insertImagesBatch).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ filename: 'inline.png' })]);
        expect(onPathCheckProgress).toHaveBeenLastCalledWith({ phase: 'repairing', current: 0, total: 0, repaired: 2 });
        expect(onBatchCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ imported: 0, updated: 2 }));
    });

    it('reports an inline correction after cancellation without claiming preceding uncommitted image rows', async () => {
        arrangeImportBatches(2);
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({ status: 'ok', data: [
            'outputs/images/image-0.png', 'outputs/images/nested/image-1.png',
        ] });
        vi.mocked(getImagesByIds).mockResolvedValue([makeExistingInvokeImage('image-1.png')]);
        const controller = new AbortController();
        let releaseMove!: () => void;
        const pendingMove = new Promise<void>(resolve => { releaseMove = resolve; });
        vi.mocked(moveImagePathIdentity).mockImplementationOnce(async () => {
            await pendingMove;
            return true;
        });
        const onPathCheckProgress = vi.fn();
        const onBatchCommitted = vi.fn();
        const settled = vi.fn();
        const operation = syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), controller.signal, {
            mode: 'live', syncBoards: false, onPathCheckProgress, onBatchCommitted,
        }).finally(settled);
        const rejection = expect(operation).rejects.toThrow('Aborted');
        await vi.waitFor(() => expect(moveImagePathIdentity).toHaveBeenCalledOnce());
        controller.abort();
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();
        expect(onPathCheckProgress).not.toHaveBeenCalled();

        releaseMove();
        await rejection;

        expect(onPathCheckProgress).toHaveBeenCalledExactlyOnceWith({ phase: 'repairing', current: 0, total: 0, repaired: 1 });
        expect(onBatchCommitted).not.toHaveBeenCalled();
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('reconciles board-only changes, including empty boards, without requiring source repair', async () => {
        const selectMock = vi.fn(async (sql: string) => {
            if (sql.includes('PRAGMA table_info(images)')) {
                return [{ name: 'metadata_json' }, { name: 'user_id' }];
            }
            if (sql.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }, { name: 'boards' }];
            }
            if (sql.includes('SELECT count(*) as count')) return [{ count: 0 }];
            if (sql.includes("name='boards'")) return [{ name: 'boards' }];
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(fetchBoardMappings).mockResolvedValueOnce({
            imageToBoardId: new Map([['owned.png', 'board-a']]),
            boards: new Map([['board-a', {
                name: 'Owned board',
                createdAt: 10,
                ownerId: 'owner-a',
            }], ['empty-board', {
                name: 'Empty board',
                createdAt: 20,
                ownerId: 'owner-a',
            }]]),
            isAuthoritative: true,
        });
        vi.mocked(reconcileInvokeBoardSnapshot).mockResolvedValueOnce({
            collectionsUpdated: 1,
            collectionsDeleted: 1,
            imagesUpdated: 2,
            membershipsDeleted: 1,
            membershipsInserted: 1,
        });

        const result = await syncImagesImpl('D:/Invoke', vi.fn(), undefined, {
            scope: {
                mode: 'owner',
                ownerId: 'owner-a',
                dbPath: 'D:/Invoke/databases/invokeai.db',
                imagesRoot: 'D:/Invoke',
            },
            mode: 'startup',
            syncBoards: true,
            syncFavorites: false,
        });

        expect(reconcileInvokeBoardSnapshot).toHaveBeenCalledWith({
            dbPath: 'D:/Invoke/databases/invokeai.db',
            mode: 'owner',
            ownerId: 'owner-a',
            boards: [{
                id: 'board-a',
                name: 'Owned board',
                createdAt: 10,
                ownerId: 'owner-a',
            },
            {
                id: 'empty-board',
                name: 'Empty board',
                createdAt: 20,
                ownerId: 'owner-a',
            }],
            memberships: [{ imageName: 'owned.png', boardId: 'board-a' }],
            reconcileMemberships: true,
            deleteMissingCollections: true,
        });
        expect(syncCollectionImages).not.toHaveBeenCalled();
        expect(result.boardMapping).toEqual(new Map([
            ['board-a', { name: 'Owned board', createdAt: 10, ownerId: 'owner-a' }],
            ['empty-board', { name: 'Empty board', createdAt: 20, ownerId: 'owner-a' }],
        ]));
        expect(result.updated).toBe(0);
        expect(result.boardsChanged).toBe(true);
    });

    it('returns an empty result without opening a database when the root path is empty', async () => {
        const result = await syncImages('', vi.fn());

        expect(result).toMatchObject({
            imported: 0,
            updated: 0,
            maxTimestamp: null,
            touchedFacetTypes: []
        });
        expect(result.syncedIds).toEqual(new Set());
        expect(result.boardMapping).toEqual(new Map());
        expect(Database.load).not.toHaveBeenCalled();
    });

    it('reports the resolved database path when connection fails', async () => {
        vi.mocked(Database.load).mockRejectedValue(new Error('locked'));

        await expect(syncImages('D:/InvokeAI/databases', vi.fn())).rejects.toThrow(
            'Could not connect to InvokeAI DB at D:/InvokeAI/databases/invokeai.db'
        );
        expect(Database.load).toHaveBeenCalledWith('sqlite:D:/InvokeAI/databases/invokeai.db');
    });

    it('accepts a direct database path and rejects schemas without metadata', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) return [{ name: 'created_at' }];
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
            throw new Error(`Unexpected query: ${query}`);
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);

        await expect(syncImages('D:/InvokeAI/databases/invokeai.db', vi.fn())).rejects.toThrow(
            "Could not find metadata column (checked 'metadata_json' and 'metadata')"
        );
        expect(Database.load).toHaveBeenCalledWith('sqlite:D:/InvokeAI/databases/invokeai.db');
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('returns early for no-op live cycles before board and collection sync work', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [{ name: 'metadata_json' }, { name: 'updated_at' }, { name: 'is_intermediate' }];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('SELECT 1 as found FROM images i')) {
                return [];
            }
            throw new Error(`Unexpected query: ${query}`);
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);

        const result = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            {
                mode: 'live',
                syncBoards: true,
                syncFavorites: true,
                starredAs: 'favorite'
            }
        );

        expect(result.imported).toBe(0);
        expect(result.updated).toBe(0);
        expect(result.touchedFacetTypes).toEqual([]);
        expect(result.touchedFacetResources).toEqual({
            checkpoints: [],
            loras: [],
            embeddings: [],
            hypernetworks: [],
            controlNets: [],
            ipAdapters: [],
            tools: []
        });
        expect(fetchBoardMappings).not.toHaveBeenCalled();
        expect(getImagesByIds).not.toHaveBeenCalled();
        expect(insertImagesBatch).not.toHaveBeenCalled();
        expect(syncCollectionImages).not.toHaveBeenCalled();
        expect(upsertInvokeBoardCollection).not.toHaveBeenCalled();
        expect(reconcileInvokeSourceFacts).not.toHaveBeenCalled();
    });

    it('returns early for no-op startup cycles after candidate detection without counting', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [{ name: 'metadata_json' }, { name: 'updated_at' }, { name: 'is_intermediate' }];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('SELECT 1 as found FROM images i')) {
                return [];
            }
            throw new Error(`Unexpected query: ${query}`);
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);

        const result = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            {
                mode: 'startup',
                afterTimestamp: 100,
                syncBoards: true,
                syncFavorites: true,
                starredAs: 'favorite'
            }
        );

        expect(result.imported).toBe(0);
        expect(result.updated).toBe(0);
        expect(selectMock).not.toHaveBeenCalledWith(expect.stringContaining('SELECT count(*) as count FROM images i'));
        expect(fetchBoardMappings).not.toHaveBeenCalled();
        expect(getImagesByIds).not.toHaveBeenCalled();
        expect(insertImagesBatch).not.toHaveBeenCalled();
        expect(infoSpy).toHaveBeenCalledWith(
            '[Startup Catch-up] Invoke sync skipped; no candidates after saved cursor.',
            expect.objectContaining({
                afterTimestamp: 100
            })
        );
        infoSpy.mockRestore();
    });

    it('reconciles all source rows before an otherwise empty startup catch-up', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [
                    { name: 'metadata_json' },
                    { name: 'updated_at' },
                    { name: 'is_intermediate' },
                    { name: 'image_category' },
                    { name: 'image_origin' },
                ];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('SELECT 1 as found FROM images i')) return [];
            throw new Error(`Unexpected query: ${query}`);
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(reconcileInvokeSourceFacts).mockResolvedValueOnce(3);

        const result = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            {
                mode: 'startup',
                afterTimestamp: 100,
                importIntermediates: false,
                syncBoards: false,
                syncFavorites: false,
                reconcileSourceFacts: true,
            }
        );

        expect(reconcileInvokeSourceFacts).toHaveBeenCalledWith(expect.objectContaining({
            columns: new Set([
                'metadata_json',
                'updated_at',
                'is_intermediate',
                'image_category',
                'image_origin',
            ]),
            signal: undefined,
        }));
        expect(result).toMatchObject({ imported: 0, updated: 3 });
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('keeps live changed cycles incremental and skips the final full collection sync', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [
                    { name: 'metadata_json' },
                    { name: 'updated_at' },
                    { name: 'is_intermediate' },
                    { name: 'starred' },
                    { name: 'thumbnail_name' },
                    { name: 'has_workflow' },
                    { name: 'image_category' },
                    { name: 'image_origin' }
                ];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }, { name: 'boards' }];
            }
            if (query.includes('SELECT 1 as found FROM images i')) {
                return [{ found: 1 }];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) {
                return [{ count: 1 }];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table' AND name='boards'")) {
                return [{ name: 'boards' }];
            }
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [
                    {
                        image_name: 'new-image.png',
                        metadata_blob: { positive_prompt: 'test', init_image: 'source.png' },
                        created_at: '2026-04-18 12:00:00',
                        updated_at: '2026-04-18 12:00:05',
                        width: 1024,
                        height: 1024,
                        starred: 1,
                        thumbnail_name: 'new-image.webp',
                        has_workflow: 1,
                        is_intermediate: 0,
                        image_category: 'control',
                        image_origin: 'external'
                    }
                ];
            }
            return [];
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(fetchBoardMappings).mockResolvedValue({
            imageToBoardId: new Map([['new-image.png', 'board-1']]),
            boards: new Map([['board-1', { name: 'Board One', createdAt: 123 }]]),
            isAuthoritative: true,
        });

        const result = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            {
                mode: 'live',
                syncBoards: true,
                syncFavorites: true,
                starredAs: 'favorite'
            }
        );

        expect(result.imported).toBe(1);
        expect(result.touchedFacetTypes).toEqual([
            'checkpoints',
            'loras',
            'embeddings',
            'controlNets',
            'ipAdapters',
            'tools'
        ]);
        expect(result.touchedFacetResources.checkpoints).toEqual(['Test Model']);
        expect(result.touchedFacetResources.loras).toEqual(['DetailBoost']);
        expect(result.touchedFacetResources.tools).toEqual(['invokeai']);
        expect(insertImagesBatch).toHaveBeenCalledTimes(1);
        expect(vi.mocked(insertImagesBatch).mock.calls[0][0][0]).toEqual(expect.objectContaining({
            thumbnailSource: 'invokeai',
            thumbnailUrl: 'D:/AmbitFixtures/InvokeAI/outputs/images/thumbnails/new-image.webp',
            invokeImageName: 'new-image.png',
            invokeImageCategory: 'control',
            invokeImageOrigin: 'external'
        }));
        expect(syncCollectionImages).toHaveBeenCalledTimes(1);
        expect(syncCollectionImages).toHaveBeenCalledWith([
            'D:/AmbitFixtures/InvokeAI/outputs/images/new-image.png'
        ]);
        expect(reconcileInvokeBoardSnapshot).toHaveBeenCalledTimes(1);
        expect(commands.replaceInvokeImageReferences).toHaveBeenCalledWith([{
            sourceImageId: 'D:/AmbitFixtures/InvokeAI/outputs/images/new-image.png',
            references: [{ role: 'init_image', targetInvokeImageName: 'source.png' }],
        }]);
        expect(vi.mocked(insertImagesBatch).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(commands.replaceInvokeImageReferences).mock.invocationCallOrder[0]
        );
    });

    it('uses the authoritative snapshot plus incremental membership for a manual board sync', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [{ name: 'metadata_json' }, { name: 'starred' }, { name: 'thumbnail_name' }];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }, { name: 'boards' }];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 1 }];
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [{
                    image_name: 'manual-image.png', metadata_blob: JSON.stringify({ positive_prompt: 'test' }),
                    created_at: '2026-04-18 12:00:00', width: 512, height: 512,
                    starred: 0, thumbnail_name: 'manual-image.webp'
                }];
            }
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(fetchBoardMappings).mockResolvedValue({
            imageToBoardId: new Map([['manual-image.png', 'board-1']]),
            boards: new Map([['board-1', { name: 'Board One', createdAt: 0 }]]),
            isAuthoritative: true,
        });

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual', syncBoards: true, syncFavorites: true, starredAs: 'favorite'
        });

        expect(result.imported).toBe(1);
        expect(syncCollectionImages).toHaveBeenCalledOnce();
        expect(reconcileInvokeBoardSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            boards: [expect.objectContaining({ id: 'board-1', name: 'Board One' })],
            memberships: [{ imageName: 'manual-image.png', boardId: 'board-1' }],
            reconcileMemberships: true,
        }));
    });

    it.each([
        { imageName: 'tombstoned.png', tombstoned: true, missing: false },
        { imageName: 'missing-source.png', tombstoned: false, missing: true },
    ])('does not import $imageName when its local lifecycle forbids it', async ({ imageName, tombstoned, missing }) => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) return [{ name: 'metadata_json' }];
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 1 }];
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [{
                    image_name: imageName,
                    metadata_blob: JSON.stringify({ positive_prompt: 'test' }),
                    created_at: '2026-04-18 12:00:00',
                    width: 512,
                    height: 512,
                }];
            }
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        if (tombstoned) {
            vi.mocked(getRemovedImagesByIds).mockResolvedValue([makeExistingInvokeImage(imageName, { isDeleted: true })]);
        }
        if (missing) {
            vi.mocked(commands.probeFileMetadataBulk).mockImplementation(async (paths: string[]) => ({
                status: 'ok',
                data: paths.map(path => path.endsWith(`/outputs/images/${imageName}`)
                    ? { status: 'missing' }
                    : { status: 'present', size: 0, isFile: false }),
            }) as never);
        }

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual',
            syncBoards: false,
            syncFavorites: false,
        });

        expect(result.imported).toBe(0);
        expect(insertImagesBatch).not.toHaveBeenCalled();
        expect(syncCollectionImages).not.toHaveBeenCalled();
    });

    it('keeps an Invoke image Removed when its resolved source path changes', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [{ name: 'metadata_json' }, { name: 'image_subfolder' }];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 1 }];
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [{
                    image_name: 'relocated.png',
                    image_subfolder: 'new/location',
                    metadata_blob: JSON.stringify({ positive_prompt: 'test' }),
                    created_at: '2026-04-18 12:00:00',
                    width: 512,
                    height: 512,
                }];
            }
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(getRemovedInvokeImageNames).mockResolvedValue(['relocated.png']);

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual',
            syncBoards: false,
            syncFavorites: false,
        });

        expect(getRemovedInvokeImageNames).toHaveBeenCalledWith(
            legacyScope.dbPath,
            ['relocated.png']
        );
        expect(result.imported).toBe(0);
        expect(insertImagesBatch).not.toHaveBeenCalled();
        expect(syncCollectionImages).not.toHaveBeenCalled();
    });

    it('does not rewrite an unchanged image that already preserves raw Invoke metadata', async () => {
        const fullPath = 'D:/AmbitFixtures/InvokeAI/outputs/images/unchanged.png';
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) return [{ name: 'metadata_json' }];
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
            if (query.includes('SELECT 1 as found FROM images i')) return [{ found: 1 }];
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 1 }];
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [{
                    image_name: 'unchanged.png',
                    metadata_blob: { positive_prompt: 'raw', init_image: { image_name: 'source.png' } },
                    created_at: '2026-04-18T12:00:00Z', width: 512, height: 512
                }];
            }
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(getImagesByIds).mockResolvedValue([{
            id: fullPath, url: `asset://${fullPath}`, thumbnailUrl: `asset://${fullPath}`,
            filename: 'unchanged.png', fileSize: 123, timestamp: 100, width: 512, height: 512,
            isFavorite: false, isPinned: false,
            metadata: {
                tool: GeneratorTool.INVOKEAI, model: 'Test Model', steps: 20, cfg: 7,
                sampler: 'Euler', positivePrompt: 'raw', negativePrompt: ''
            },
            originalMetadata: {
                tool: GeneratorTool.INVOKEAI, model: 'Test Model', steps: 20, cfg: 7,
                sampler: 'Euler', positivePrompt: 'raw', negativePrompt: ''
            },
            originalState: { isFavorite: false, isPinned: false, boardId: undefined },
            originalChunks: { invokeai_metadata: JSON.stringify({ positive_prompt: 'raw' }) },
            invokeImageName: 'unchanged.png'
        }]);

        const onBatchCommitted = vi.fn();
        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'live', syncBoards: false, syncFavorites: false, onBatchCommitted,
        });

        expect(result).toMatchObject({ imported: 0, updated: 0 });
        expect(result.syncedIds).toContain('unchanged.png');
        expect(insertImagesBatch).not.toHaveBeenCalled();
        expect(commands.replaceInvokeImageReferences).toHaveBeenCalledWith([{
            sourceImageId: fullPath,
            references: [{ role: 'init_image', targetInvokeImageName: 'source.png' }],
        }]);
        expect(onBatchCommitted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            processed: 1, imported: 0, updated: 0,
        }));
        expect(onBatchCommitted.mock.invocationCallOrder[0])
            .toBeGreaterThan(vi.mocked(commands.replaceInvokeImageReferences).mock.invocationCallOrder[0]);
    });

    it('still snapshots current references when an unchanged image has a malformed stored raw chunk', async () => {
        const fullPath = 'D:/AmbitFixtures/InvokeAI/outputs/images/unchanged.png';
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) return [{ name: 'metadata_json' }];
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
            if (query.includes('SELECT 1 as found FROM images i')) return [{ found: 1 }];
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 1 }];
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [{
                    image_name: 'unchanged.png',
                    metadata_blob: { init_image: 'source.png' },
                    created_at: '2026-04-18T12:00:00Z', width: 512, height: 512,
                }];
            }
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(getImagesByIds).mockResolvedValue([makeExistingInvokeImage('unchanged.png', {
            originalState: { isFavorite: false, isPinned: false, boardId: undefined },
            originalChunks: { invokeai_metadata: '{bad json' },
        })]);

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'live', syncBoards: false, syncFavorites: false,
        });

        expect(result.syncedIds).toContain('unchanged.png');
        expect(commands.replaceInvokeImageReferences).toHaveBeenCalledWith([{
            sourceImageId: fullPath,
            references: [{ role: 'init_image', targetInvokeImageName: 'source.png' }],
        }]);
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('preserves stored references when an unchanged row has an empty metadata string', async () => {
        let storedReferenceNames = ['stored-source.png'];
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) return [{ name: 'metadata_json' }];
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
            if (query.includes('SELECT 1 as found FROM images i')) return [{ found: 1 }];
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 1 }];
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [{
                    image_name: 'unchanged.png', metadata_blob: '',
                    created_at: '2026-04-18T12:00:00Z', width: 512, height: 512,
                }];
            }
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(getImagesByIds).mockResolvedValue([makeExistingInvokeImage('unchanged.png', {
            originalState: { isFavorite: false, isPinned: false, boardId: undefined },
        })]);
        vi.mocked(commands.replaceInvokeImageReferences).mockImplementation(async (referenceSets) => {
            storedReferenceNames = referenceSets.flatMap(set =>
                set.references.map(reference => reference.targetInvokeImageName)
            );
            return {
                status: 'ok',
                data: { sourcesReplaced: 1, referencesWritten: 0, skippedMissingSources: 0 },
            } as never;
        });

        await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'live', syncBoards: false, syncFavorites: false,
        });

        expect(commands.replaceInvokeImageReferences).not.toHaveBeenCalled();
        expect(storedReferenceNames).toEqual(['stored-source.png']);
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('preserves stored references when an unchanged row has a malformed adapter container', async () => {
        let storedReferenceNames = ['stored-source.png'];
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) return [{ name: 'metadata_json' }];
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
            if (query.includes('SELECT 1 as found FROM images i')) return [{ found: 1 }];
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 1 }];
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [{
                    image_name: 'unchanged.png', metadata_blob: { controlnets: false },
                    created_at: '2026-04-18T12:00:00Z', width: 512, height: 512,
                }];
            }
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(getImagesByIds).mockResolvedValue([makeExistingInvokeImage('unchanged.png', {
            originalState: { isFavorite: false, isPinned: false, boardId: undefined },
        })]);
        vi.mocked(commands.replaceInvokeImageReferences).mockImplementation(async (referenceSets) => {
            storedReferenceNames = referenceSets.flatMap(set =>
                set.references.map(reference => reference.targetInvokeImageName)
            );
            return {
                status: 'ok',
                data: { sourcesReplaced: 1, referencesWritten: 0, skippedMissingSources: 0 },
            } as never;
        });

        await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'live', syncBoards: false, syncFavorites: false,
        });

        expect(commands.replaceInvokeImageReferences).not.toHaveBeenCalled();
        expect(storedReferenceNames).toEqual(['stored-source.png']);
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it.each(['manual', 'startup', 'live'] as const)('fails %s sync on a row error and retries it without duplicating earlier committed batches', async mode => {
        arrangeImportBatches(501);
        const mapper = vi.mocked(mapInvokeMetadata);
        const originalMapper = mapper.getMockImplementation()!;
        mapper.mockImplementation((...args) => {
            const row = args[0];
            if (row && typeof row === 'object' && 'image_name' in row && row.image_name === 'image-500.png') {
                throw new Error('metadata mapping failed');
            }
            return originalMapper(...args);
        });
        const onBatchCommitted = vi.fn();
        const progress = vi.fn();
        try {
            await expect(syncImages('D:/AmbitFixtures/InvokeAI', progress, undefined, {
                mode, syncBoards: false, syncFavorites: false, afterTimestamp: 0, onBatchCommitted,
            })).rejects.toThrow('Failed to process InvokeAI image image-500.png: metadata mapping failed');
            expect(insertImagesBatch).toHaveBeenCalledOnce();
            expect(onBatchCommitted).toHaveBeenCalledOnce();
            expect(onBatchCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ processed: 500, imported: 500 }));
            expect(progress).toHaveBeenLastCalledWith(500, 501, 'Processing images: 500 / 501');
        } finally {
            mapper.mockImplementation(originalMapper);
        }

        vi.mocked(insertImagesBatch).mockClear();
        vi.mocked(getImagesByIds).mockResolvedValue(Array.from({ length: 500 }, (_, index) =>
            makeExistingInvokeImage(`image-${index}.png`)));
        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode, syncBoards: false, syncFavorites: false, afterTimestamp: 0,
        });
        expect(result).toMatchObject({ imported: 1, updated: 0 });
        expect(insertImagesBatch).toHaveBeenCalledExactlyOnceWith([
            expect.objectContaining({ filename: 'image-500.png' }),
        ]);
    });

    it('fails the sync batch when transactional reference replacement fails', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) return [{ name: 'metadata_json' }];
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
            if (query.includes('SELECT 1 as found FROM images i')) return [{ found: 1 }];
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 1 }];
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [{
                    image_name: 'new.png', metadata_blob: { init_image: 'source.png' },
                    created_at: '2026-04-18T12:00:00Z', width: 512, height: 512,
                }];
            }
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(commands.replaceInvokeImageReferences).mockResolvedValueOnce({
            status: 'error', error: 'reference transaction failed',
        } as never);

        await expect(syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'live', syncBoards: false, syncFavorites: false,
        })).rejects.toBe('reference transaction failed');
        expect(insertImagesBatch).toHaveBeenCalledOnce();
    });

    it('rewrites an existing image when its stored raw chunk is already mapped', async () => {
        const fullPath = 'D:/AmbitFixtures/InvokeAI/outputs/images/mapped.png';
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) return [{ name: 'metadata_json' }];
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
            if (query.includes('SELECT 1 as found FROM images i')) return [{ found: 1 }];
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 1 }];
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [{
                    image_name: 'mapped.png', metadata_blob: { positive_prompt: 'raw' },
                    created_at: '2026-04-18 12:00:00', width: 512, height: 512
                }];
            }
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(getImagesByIds).mockResolvedValue([
            makeExistingInvokeImage('mapped.png', {
                originalMetadata: undefined,
                originalChunks: { invokeai_metadata: JSON.stringify({ positivePrompt: 'already mapped' }) }
            })
        ]);

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'live', syncBoards: false, syncFavorites: false
        });

        expect(result.updated).toBe(1);
        expect(insertImagesBatch).toHaveBeenCalledWith([
            expect.objectContaining({ id: fullPath, filename: 'mapped.png' })
        ]);
    });

    it('stops before querying the first batch when a live sync is already aborted', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) return [{ name: 'metadata_json' }];
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
            if (query.includes('SELECT 1 as found FROM images i')) return [{ found: 1 }];
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 1 }];
            if (query.includes('FROM images i') && query.includes('OFFSET')) throw new Error('batch query should not run');
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        const controller = new AbortController();
        controller.abort();

        await expect(syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), controller.signal, {
            mode: 'live', syncBoards: false, syncFavorites: false
        })).rejects.toThrow('Aborted');
        expect(Database.load).not.toHaveBeenCalled();
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('publishes cumulative processed, added, and updated image writes after each batch insert', async () => {
        arrangeImportBatches(501);
        const existing = [
            makeExistingInvokeImage('image-0.png'),
            makeExistingInvokeImage('image-1.png', { invokeImageCategory: 'outdated' }),
        ];
        vi.mocked(getImagesByIds).mockImplementation(async ids => existing.filter(image => ids.includes(image.id)));
        const onBatchCommitted = vi.fn();
        const onProgress = vi.fn();

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', onProgress, undefined, {
            mode: 'live', syncBoards: false, syncFavorites: false, onBatchCommitted,
        });

        expect(result).toMatchObject({ imported: 499, updated: 1 });
        expect(onBatchCommitted.mock.calls.map(([batch]) => ({
            processed: batch.processed, imported: batch.imported, updated: batch.updated,
        }))).toEqual([
            { processed: 500, imported: 498, updated: 1 },
            { processed: 501, imported: 499, updated: 1 },
        ]);
        expect(onBatchCommitted.mock.invocationCallOrder[0])
            .toBeGreaterThan(vi.mocked(insertImagesBatch).mock.invocationCallOrder[0]);
        expect(onBatchCommitted.mock.invocationCallOrder[1])
            .toBeGreaterThan(vi.mocked(insertImagesBatch).mock.invocationCallOrder[1]);
        expect(onProgress).toHaveBeenLastCalledWith(501, 501, 'Processing images: 501 / 501');
    });

    it('does not write or announce a committed batch when cancelled after reading existing records', async () => {
        arrangeImportBatches(501);
        const controller = new AbortController();
        vi.mocked(getImagesByIds).mockImplementationOnce(async () => {
            controller.abort();
            return [];
        });
        const onBatchCommitted = vi.fn();

        await expect(syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), controller.signal, {
            mode: 'live', syncBoards: false, onBatchCommitted,
        })).rejects.toThrow('Aborted');

        expect(insertImagesBatch).not.toHaveBeenCalled();
        expect(commands.replaceInvokeImageReferences).not.toHaveBeenCalled();
        expect(onBatchCommitted).not.toHaveBeenCalled();
    });

    it('reports durable added and updated image writes when cancelled before linking or references', async () => {
        const selectMock = arrangeImportBatches(501);
        const existing = [
            makeExistingInvokeImage('image-0.png'),
            makeExistingInvokeImage('image-1.png', { invokeImageCategory: 'outdated' }),
        ];
        vi.mocked(getImagesByIds).mockImplementation(async ids => existing.filter(image => ids.includes(image.id)));
        const controller = new AbortController();
        let releaseWrite!: () => void;
        let markWriteStarted!: () => void;
        const pendingWrite = new Promise<void>(resolve => { releaseWrite = resolve; });
        const writeStarted = new Promise<void>(resolve => { markWriteStarted = resolve; });
        const durableImages: AIImage[] = [];
        vi.mocked(insertImagesBatch).mockImplementation(async images => {
            markWriteStarted();
            await pendingWrite;
            durableImages.push(...images);
        });
        const onBatchCommitted = vi.fn();
        const onProgress = vi.fn();
        const operation = syncImages('D:/AmbitFixtures/InvokeAI', onProgress, controller.signal, {
            mode: 'manual', syncBoards: true, syncFavorites: false, onBatchCommitted,
        });

        await writeStarted;
        controller.abort();
        expect(onBatchCommitted).not.toHaveBeenCalled();
        releaseWrite();
        await expect(operation).rejects.toThrow('Aborted');

        expect(durableImages).toHaveLength(499);
        // A cancelled run must not show more additions than processed rows.
        expect(onProgress).toHaveBeenLastCalledWith(500, 501, 'Processing images: 500 / 501');
        expect(syncCollectionImages).not.toHaveBeenCalled();
        expect(commands.replaceInvokeImageReferences).not.toHaveBeenCalled();
        const batchReads = selectMock.mock.calls.filter(([sql]) => sql.includes('FROM images i') && sql.includes('OFFSET'));
        expect(batchReads).toHaveLength(1);
        expect(onBatchCommitted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            processed: 500, imported: 498, updated: 1,
        }));
    });

    it('does not report image writes when the batch insert rejects', async () => {
        const selectMock = arrangeImportBatches(501);
        vi.mocked(insertImagesBatch).mockRejectedValueOnce(new Error('native insert failed'));
        const onBatchCommitted = vi.fn();

        await expect(syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'live', syncBoards: false, onBatchCommitted,
        })).rejects.toThrow('native insert failed');

        expect(insertImagesBatch).toHaveBeenCalledOnce();
        expect(onBatchCommitted).not.toHaveBeenCalled();
        expect(commands.replaceInvokeImageReferences).not.toHaveBeenCalled();
        const batchReads = selectMock.mock.calls.filter(([sql]) => sql.includes('FROM images i') && sql.includes('OFFSET'));
        expect(batchReads).toHaveLength(1);
    });

    it.each(['link', 'references'] as const)(
        'reports image writes once before a subsequent %s failure',
        async stage => {
            const selectMock = arrangeImportBatches(501);
            if (stage === 'link') {
                vi.mocked(syncCollectionImages).mockRejectedValueOnce(new Error('link failed'));
            } else {
                vi.mocked(commands.replaceInvokeImageReferences).mockRejectedValueOnce(new Error('references failed'));
            }
            const onBatchCommitted = vi.fn();

            await expect(syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
                mode: 'live', syncBoards: stage === 'link', onBatchCommitted,
            })).rejects.toThrow(stage === 'link' ? 'link failed' : 'references failed');

            expect(insertImagesBatch).toHaveBeenCalledOnce();
            expect(onBatchCommitted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
                processed: 500, imported: 500, updated: 0,
            }));
            expect(onBatchCommitted.mock.invocationCallOrder[0])
                .toBeGreaterThan(vi.mocked(insertImagesBatch).mock.invocationCallOrder[0]);
            const failedFollowup = stage === 'link' ? syncCollectionImages : commands.replaceInvokeImageReferences;
            expect(onBatchCommitted.mock.invocationCallOrder[0])
                .toBeLessThan(vi.mocked(failedFollowup).mock.invocationCallOrder[0]);
            const batchReads = selectMock.mock.calls.filter(([sql]) => sql.includes('FROM images i') && sql.includes('OFFSET'));
            expect(batchReads).toHaveLength(1);
        }
    );

    it.each([
        { stage: 'insert', rowCount: 501, withoutReferences: false },
        { stage: 'link', rowCount: 501, withoutReferences: false },
        { stage: 'references', rowCount: 501, withoutReferences: false },
        { stage: 'references', rowCount: 1, withoutReferences: false },
        { stage: 'insert', rowCount: 1, withoutReferences: true },
    ] as const)(
        'settles an in-flight $stage write ($rowCount rows), reports image writes, and does not start another batch',
        async ({ stage, rowCount, withoutReferences }) => {
            const selectMock = arrangeImportBatches(rowCount, withoutReferences ? [] : {});
            const controller = new AbortController();
            let releaseWrite!: () => void;
            const pendingWrite = new Promise<void>(resolve => { releaseWrite = resolve; });
            const writeStarted = vi.fn();
            const committedIds: string[] = [];
            const waitForRelease = async () => { writeStarted(); await pendingWrite; };
            vi.mocked(insertImagesBatch).mockImplementation(async images => {
                if (stage === 'insert') await waitForRelease();
                committedIds.push(...images.map(image => image.id));
            });
            if (stage === 'link') vi.mocked(syncCollectionImages).mockImplementationOnce(waitForRelease);
            if (stage === 'references') {
                vi.mocked(commands.replaceInvokeImageReferences).mockImplementationOnce(async references => {
                    await waitForRelease();
                    return { status: 'ok', data: { sourcesReplaced: references.length, referencesWritten: 0, skippedMissingSources: 0 } };
                });
            }
            const onBatchCommitted = vi.fn();
            const settled = vi.fn();
            const operation = syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), controller.signal, {
                mode: 'live', syncBoards: stage === 'link', onBatchCommitted,
            }).finally(settled);
            const rejection = expect(operation).rejects.toThrow('Aborted');
            await vi.waitFor(() => expect(writeStarted).toHaveBeenCalledOnce());
            controller.abort();
            await Promise.resolve();
            expect(settled).not.toHaveBeenCalled();
            if (stage === 'insert') expect(onBatchCommitted).not.toHaveBeenCalled();

            releaseWrite();
            await rejection;

            expect(committedIds).toHaveLength(Math.min(500, rowCount));
            expect(insertImagesBatch).toHaveBeenCalledOnce();
            if (stage !== 'references') expect(commands.replaceInvokeImageReferences).not.toHaveBeenCalled();
            expect(onBatchCommitted).toHaveBeenCalledOnce();
            expect(onBatchCommitted).toHaveBeenCalledWith(expect.objectContaining({
                processed: Math.min(500, rowCount), imported: Math.min(500, rowCount), updated: 0,
            }));
            const batchReads = selectMock.mock.calls.filter(([sql]) => sql.includes('FROM images i') && sql.includes('OFFSET'));
            expect(batchReads).toHaveLength(1);
        }
    );

    it('aborts without importing when source-path verification fails', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [{ name: 'metadata_json' }, { name: 'thumbnail_name' }];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
            if (query.includes('SELECT 1 as found FROM images i')) return [{ found: 1 }];
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 1 }];
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [{
                    image_name: 'unreadable.png', thumbnail_name: 'unreadable.webp', metadata_blob: {},
                    created_at: '2026-04-18 12:00:00', width: 512, height: 512
                }];
            }
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(commands.verifyImagePaths).mockRejectedValue(new Error('verify failed'));
        vi.mocked(commands.probeFileMetadataBulk).mockRejectedValue(new Error('probe failed'));

        await expect(syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'live', syncBoards: false, syncFavorites: false
        })).rejects.toThrow('Failed to verify InvokeAI source image paths');

        expect(insertImagesBatch).not.toHaveBeenCalled();
        expect(syncCollectionImages).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
            '[InvokeAI Sync] Failed to verify InvokeAI thumbnail paths; using source image fallback.',
            expect.any(Error)
        );
        warnSpy.mockRestore();
    });

    it.each([
        { label: 'target file is missing', name: 'missing-target.png', size: 0, paths: ['stale'] as const },
        { label: 'target identity exists', name: 'existing-target.png', size: 123, paths: ['stale', 'target'] as const },
        { label: 'legacy source is missing', name: 'missing-source.png', size: 123, paths: [] as const },
        { label: 'source already equals target', name: 'already-flat.png', size: 123, paths: ['stale'] as const, subfolder: '' },
    ])('skips manual repair when the $label', async ({ name, size, paths, subfolder }) => {
        const root = 'D:/AmbitFixtures/InvokeAI';
        const stalePath = `${root}/outputs/images/${name}`;
        const targetPath = subfolder === '' ? stalePath : `${root}/outputs/images/nested/${name}`;
        const existingPaths = paths.map(path => path === 'stale' ? stalePath : targetPath);

        const { result } = await arrangeManualRepair({
            name,
            size,
            existingPaths,
            subfolder: subfolder ?? 'nested',
            includeUnmatchedRow: name === 'missing-target.png'
        });

        expect(result.updated).toBe(0);
        expect(moveImagePathIdentities).not.toHaveBeenCalled();
    });

    it('uses zero sizes when filesystem probing fails during manual repair', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const root = 'D:/AmbitFixtures/InvokeAI';
        const name = 'probe-failure.png';

        const { result } = await arrangeManualRepair({
            name,
            existingPaths: [`${root}/outputs/images/${name}`],
            rejectSize: true
        });

        expect(result.updated).toBe(0);
        expect(warnSpy).toHaveBeenCalledWith(
            '[InvokeAI Sync] Failed to probe resolved InvokeAI paths during repair.',
            expect.any(Error)
        );
        warnSpy.mockRestore();
    });

    it('records Invoke thumbnail provenance for a successful broad repair', async () => {
        const root = 'D:/AmbitFixtures/InvokeAI';
        const name = 'thumbnail-repair.png';
        vi.mocked(moveImagePathIdentities).mockResolvedValue({
            moved: 1, skippedTargetExists: 0, skippedSourceMissing: 0
        });

        const { result } = await arrangeManualRepair({
            name,
            thumbnailName: 'thumbnail-repair.webp',
            existingPaths: [`${root}/outputs/images/${name}`]
        });

        expect(result.updated).toBe(1);
        expect(moveImagePathIdentities).toHaveBeenCalledWith([
            expect.objectContaining({
                thumbnailPath: expect.stringContaining('thumbnail-repair.webp'),
                thumbnailSource: 'invokeai'
            })
        ]);
    });

    it('ignores a malformed empty stale image identity', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) return [{ name: 'metadata_json' }];
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 0 }];
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(getFlatInvokeImageIdsForRoot).mockResolvedValue(['']);

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual', syncBoards: false, syncFavorites: false
        });

        expect(result.updated).toBe(0);
        expect(moveImagePathIdentities).not.toHaveBeenCalled();
    });

    it('skips an unsafe unresolved database path during manual repair', async () => {
        const root = 'D:/AmbitFixtures/InvokeAI';
        const name = 'unsafe.png';

        const { result } = await arrangeManualRepair({
            name,
            rowImageName: `../${name}`,
            existingPaths: [`${root}/outputs/images/${name}`]
        });

        expect(result.updated).toBe(0);
        expect(moveImagePathIdentities).not.toHaveBeenCalled();
    });

    it('aborts before querying stale repair candidates when already cancelled', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(arrangeManualRepair({
            name: 'pre-aborted.png',
            existingPaths: [],
            signal: controller.signal
        })).rejects.toThrow('Aborted');
    });

    it('aborts before moving repair candidates when cancelled after their query', async () => {
        const controller = new AbortController();

        await expect(arrangeManualRepair({
            name: 'mid-repair-abort.png',
            existingPaths: [],
            signal: controller.signal,
            onRepairRows: () => controller.abort()
        })).rejects.toThrow('Aborted');
    });

    it('preserves legacy and user-modified state while applying Invoke state to untouched images', async () => {
        const rows = [
            { name: 'legacy.png', starred: 1 },
            { name: 'modified.png', starred: 1 },
            { name: 'untouched.png', starred: 1 },
            { name: 'unstarred.png', starred: 0 },
            { name: 'no-raw-key.png', starred: 0 },
            { name: 'object-raw.png', starred: 0 },
            { name: 'primitive-raw.png', starred: 0 },
        ];
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [{ name: 'metadata_json' }, { name: 'starred' }];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }, { name: 'boards' }];
            }
            if (query.includes('SELECT 1 as found FROM images i')) return [{ found: 1 }];
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: rows.length }];
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return rows.map(row => ({
                    image_name: row.name,
                    metadata_blob: { positive_prompt: 'raw' },
                    created_at: '2026-04-18 12:00:00',
                    width: 512,
                    height: 512,
                    starred: row.starred
                }));
            }
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(fetchBoardMappings).mockResolvedValue({
            imageToBoardId: new Map([
                ['legacy.png', 'invoke-legacy'],
                ['modified.png', 'invoke-modified'],
                ['untouched.png', 'invoke-untouched'],
            ]),
            boards: new Map([
                ['invoke-legacy', { name: 'Invoke Legacy', createdAt: 1 }],
                ['invoke-modified', { name: 'Invoke Modified', createdAt: 2 }],
                ['invoke-untouched', { name: 'Invoke Untouched', createdAt: 3 }],
            ]),
            isAuthoritative: true,
        });
        vi.mocked(getImagesByIds).mockResolvedValue([
            makeExistingInvokeImage('legacy.png', {
                isFavorite: true,
                isPinned: undefined,
                boardId: 'ambit-legacy'
            }),
            makeExistingInvokeImage('modified.png', {
                isFavorite: true,
                isPinned: undefined,
                boardId: 'ambit-modified',
                originalState: { isFavorite: false, isPinned: true, boardId: 'original-modified' }
            }),
            makeExistingInvokeImage('untouched.png', {
                boardId: 'original-untouched',
                originalState: { isFavorite: false, isPinned: false, boardId: 'original-untouched' }
            }),
            makeExistingInvokeImage('unstarred.png', {
                originalState: { isFavorite: false, isPinned: false, boardId: undefined }
            }),
            makeExistingInvokeImage('no-raw-key.png', {
                originalState: { isFavorite: false, isPinned: false, boardId: undefined },
                originalChunks: {}
            }),
            makeExistingInvokeImage('object-raw.png', {
                originalState: { isFavorite: false, isPinned: false, boardId: undefined },
                originalChunks: {
                    invokeai_metadata: { negativePrompt: 'already mapped' }
                } as unknown as Record<string, string>
            }),
            makeExistingInvokeImage('primitive-raw.png', {
                originalState: { isFavorite: false, isPinned: false, boardId: undefined },
                originalChunks: { invokeai_metadata: 1 } as unknown as Record<string, string>
            }),
        ]);

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'live', syncBoards: true, syncFavorites: true, starredAs: 'both'
        });

        expect(result).toMatchObject({ imported: 0, updated: 2 });
        expect(insertImagesBatch).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({
                filename: 'untouched.png',
                isFavorite: true,
                isPinned: true,
                boardId: 'invoke-untouched'
            }),
            expect.objectContaining({ filename: 'object-raw.png' })
        ]));
    });

    it('imports a legacy Invoke schema with string metadata and conservative fallbacks', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [
                    { name: 'metadata' }, { name: 'is_starred' }, { name: 'updated_at' },
                    { name: 'has_workflow' }, { name: 'is_intermediate' }
                ];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }, { name: 'boards' }];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 1 }];
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [{
                    image_name: 'legacy-schema.png',
                    metadata_blob: null,
                    created_at: 'invalid-date',
                    updated_at: '2026-04-18T12:00:05Z',
                    width: null,
                    height: null,
                    is_starred: true,
                    has_workflow: undefined,
                    is_intermediate: 1
                }];
            }
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(fetchBoardMappings).mockResolvedValue({
            imageToBoardId: new Map([['legacy-schema.png', 'missing-board']]),
            boards: new Map(),
            isAuthoritative: true,
        });

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            syncBoards: true,
            syncFavorites: true,
            importIntermediates: true,
            starredAs: 'pin'
        });

        expect(result.imported).toBe(1);
        expect(insertImagesBatch).toHaveBeenCalledWith([
            expect.objectContaining({
                filename: 'legacy-schema.png',
                width: 0,
                height: 0,
                isFavorite: false,
                isPinned: true,
                boardId: 'missing-board',
                originalChunks: { invokeai_metadata: {} },
                invokeImageName: 'legacy-schema.png',
                invokeImageCategory: undefined,
                invokeImageOrigin: undefined
            })
        ]);
        const batchQuery = selectMock.mock.calls
            .map(call => call[0])
            .find(query => query.includes('FROM images i') && query.includes('OFFSET 0'));
        expect(batchQuery).toContain('NULL AS image_category');
        expect(batchQuery).toContain('NULL AS image_origin');
        expect(upsertInvokeBoardCollection).not.toHaveBeenCalled();
    });

    it('keeps startup changed cycles incremental and skips the final full collection sync', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [
                    { name: 'metadata_json' },
                    { name: 'updated_at' },
                    { name: 'is_intermediate' },
                    { name: 'starred' },
                    { name: 'thumbnail_name' },
                    { name: 'has_workflow' }
                ];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }, { name: 'boards' }];
            }
            if (query.includes('SELECT 1 as found FROM images i')) {
                return [{ found: 1 }];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) {
                return [{ count: 1 }];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table' AND name='boards'")) {
                return [{ name: 'boards' }];
            }
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [
                    {
                        image_name: 'startup-image.png',
                        metadata_blob: { positive_prompt: 'test' },
                        created_at: '2026-04-18 12:00:00',
                        updated_at: '2026-04-18 12:00:05',
                        width: 1024,
                        height: 1024,
                        starred: 1,
                        thumbnail_name: 'startup-image.webp',
                        has_workflow: 1,
                        is_intermediate: 0
                    }
                ];
            }
            return [];
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(fetchBoardMappings).mockResolvedValue({
            imageToBoardId: new Map([['startup-image.png', 'board-1']]),
            boards: new Map([['board-1', { name: 'Board One', createdAt: 123 }]]),
            isAuthoritative: true,
        });

        const result = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            {
                mode: 'startup',
                afterTimestamp: 100,
                syncBoards: true,
                syncFavorites: true,
                starredAs: 'both'
            }
        );

        expect(result.imported).toBe(1);
        expect(insertImagesBatch).toHaveBeenCalledTimes(1);
        expect(vi.mocked(insertImagesBatch).mock.calls[0][0][0]).toEqual(expect.objectContaining({
            thumbnailSource: 'invokeai',
            thumbnailUrl: 'D:/AmbitFixtures/InvokeAI/outputs/images/thumbnails/startup-image.webp'
        }));
        expect(syncCollectionImages).toHaveBeenCalledTimes(1);
        expect(syncCollectionImages).toHaveBeenCalledWith([
            'D:/AmbitFixtures/InvokeAI/outputs/images/startup-image.png'
        ]);
        expect(reconcileInvokeBoardSnapshot).toHaveBeenCalledTimes(1);
    });

    it('catches up new All users rows by timestamp without reconciling unrelated owners', async () => {
        const afterTimestamp = 100;
        const expectedCursor = '1970-01-01 00:00:00.100';
        const odinRows = [
            { image_name: 'odin-1.png', created_at: '2026-04-18 12:00:01', user_id: 'odin' },
            { image_name: 'odin-2.png', created_at: '2026-04-18 12:00:02', user_id: 'odin' },
            { image_name: 'odin-3.png', created_at: '2026-04-18 12:00:03', user_id: 'odin' },
            { image_name: 'odin-4.png', created_at: '2026-04-18 12:00:04', user_id: 'odin' },
        ].map(row => ({
            ...row,
            metadata_blob: { positive_prompt: row.image_name },
            width: 512,
            height: 512,
            is_intermediate: 0,
        }));
        const selectMock = vi.fn(async (query: string, params?: unknown[]) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [{ name: 'metadata_json' }, { name: 'is_intermediate' }, { name: 'user_id' }];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('FROM images i') && !query.includes('i.created_at > ?')) {
                throw new Error(`Unexpected full source inventory query: ${query}`);
            }
            if (query.includes('SELECT 1 as found FROM images i')) {
                expect(params).toEqual([expectedCursor]);
                return [{ found: 1 }];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) {
                expect(params).toEqual([expectedCursor]);
                return [{ count: odinRows.length }];
            }
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                expect(params).toEqual([expectedCursor]);
                return odinRows;
            }
            if (query.includes('FROM images i') && query.includes('OFFSET 4')) return [];
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);

        const result = await syncImagesImpl('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            scope: {
                mode: 'all',
                dbPath: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
                imagesRoot: 'D:/AmbitFixtures/InvokeAI',
            },
            mode: 'startup',
            afterTimestamp,
            syncBoards: false,
            syncFavorites: false,
            reconcileSourceFacts: false,
        });

        const odinIds = odinRows.map(({ image_name }) => (
            `D:/AmbitFixtures/InvokeAI/outputs/images/${image_name}`
        ));
        expect(result).toMatchObject({ imported: 4, updated: 0 });
        expect(getImagesByIds).toHaveBeenCalledWith(odinIds, { includeOwnerHidden: true });
        expect(insertImagesBatch).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ id: odinIds[0], invokeImageName: 'odin-1.png', invokeOwnerId: 'odin' }),
            expect.objectContaining({ id: odinIds[1], invokeImageName: 'odin-2.png', invokeOwnerId: 'odin' }),
            expect.objectContaining({ id: odinIds[2], invokeImageName: 'odin-3.png', invokeOwnerId: 'odin' }),
            expect.objectContaining({ id: odinIds[3], invokeImageName: 'odin-4.png', invokeOwnerId: 'odin' }),
        ]));
        expect(vi.mocked(insertImagesBatch).mock.calls[0][0]).toHaveLength(4);
        expect(reconcileInvokeSourceFacts).not.toHaveBeenCalled();
        expect(fetchBoardMappings).not.toHaveBeenCalled();
        expect(syncCollectionImages).not.toHaveBeenCalled();
    });

    it('resolves flat, date, type, hash, custom, and relative InvokeAI subfolder paths during DB sync', async () => {
        const rows = [
            { image_name: 'flat.png', image_subfolder: '', metadata_blob: {}, created_at: '2026-04-18 12:00:00', width: 512, height: 512 },
            { image_name: 'date.png', image_subfolder: '2026/04/18', metadata_blob: {}, created_at: '2026-04-18 12:00:01', width: 512, height: 512 },
            { image_name: 'type.png', image_subfolder: 'txt2img', metadata_blob: {}, created_at: '2026-04-18 12:00:02', width: 512, height: 512 },
            { image_name: 'hash.png', image_subfolder: 'ab', metadata_blob: {}, created_at: '2026-04-18 12:00:03', width: 512, height: 512 },
            { image_name: 'custom.png', image_subfolder: 'custom/nested/path', metadata_blob: {}, created_at: '2026-04-18 12:00:04', width: 512, height: 512 },
            { image_name: '2026/04/relative.png', image_subfolder: '', metadata_blob: {}, created_at: '2026-04-18 12:00:05', width: 512, height: 512 }
        ];
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [{ name: 'metadata_json' }, { name: 'image_subfolder' }];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('SELECT 1 as found FROM images i')) {
                return [{ found: 1 }];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) {
                return [{ count: rows.length }];
            }
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return rows;
            }
            return [];
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
            status: 'ok',
            data: [
                'outputs/images/flat.png',
                'outputs/images/2026/04/relative.png'
            ]
        } as never);

        const result = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            {
                mode: 'live',
                syncBoards: false,
                syncFavorites: false
            }
        );

        expect(result.imported).toBe(6);
        expect(commands.listInvokeaiImages).toHaveBeenCalledTimes(1);
        expect(getImagesByIds).toHaveBeenCalledWith(expect.arrayContaining([
            'D:/AmbitFixtures/InvokeAI/outputs/images/flat.png',
            'D:/AmbitFixtures/InvokeAI/outputs/images/2026/04/18/date.png',
            'D:/AmbitFixtures/InvokeAI/outputs/images/txt2img/type.png',
            'D:/AmbitFixtures/InvokeAI/outputs/images/ab/hash.png',
            'D:/AmbitFixtures/InvokeAI/outputs/images/custom/nested/path/custom.png',
            'D:/AmbitFixtures/InvokeAI/outputs/images/2026/04/relative.png',
            'D:/AmbitFixtures/InvokeAI/outputs/images/date.png',
            'D:/AmbitFixtures/InvokeAI/outputs/images/type.png',
            'D:/AmbitFixtures/InvokeAI/outputs/images/hash.png',
            'D:/AmbitFixtures/InvokeAI/outputs/images/custom.png'
        ]), { includeOwnerHidden: true });
        expect(vi.mocked(insertImagesBatch).mock.calls[0][0].map((image) => image.id)).toEqual([
            'D:/AmbitFixtures/InvokeAI/outputs/images/flat.png',
            'D:/AmbitFixtures/InvokeAI/outputs/images/2026/04/18/date.png',
            'D:/AmbitFixtures/InvokeAI/outputs/images/txt2img/type.png',
            'D:/AmbitFixtures/InvokeAI/outputs/images/ab/hash.png',
            'D:/AmbitFixtures/InvokeAI/outputs/images/custom/nested/path/custom.png',
            'D:/AmbitFixtures/InvokeAI/outputs/images/2026/04/relative.png'
        ]);
    });

    it('skips ambiguous basename rows instead of importing an arbitrary nested file', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [{ name: 'metadata_json' }];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('SELECT 1 as found FROM images i')) {
                return [{ found: 1 }];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) {
                return [{ count: 1 }];
            }
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [{
                    image_name: 'duplicate.png',
                    metadata_blob: {},
                    created_at: '2026-04-18 12:00:00',
                    width: 512,
                    height: 512
                }];
            }
            return [];
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
            status: 'ok',
            data: [
                'outputs/images/2026/04/18/duplicate.png',
                'outputs/images/txt2img/duplicate.png'
            ]
        } as never);

        const result = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            {
                mode: 'live',
                syncBoards: false,
                syncFavorites: false
            }
        );

        expect(result.imported).toBe(0);
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('skips unsafe InvokeAI database paths before filesystem probes or inserts', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [{ name: 'metadata_json' }, { name: 'image_subfolder' }];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('SELECT 1 as found FROM images i')) {
                return [{ found: 1 }];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) {
                return [{ count: 1 }];
            }
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [{
                    image_name: '../outside.png',
                    image_subfolder: '',
                    metadata_blob: {},
                    created_at: '2026-04-18 12:00:00',
                    width: 512,
                    height: 512
                }];
            }
            return [];
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);

        const result = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            {
                mode: 'live',
                syncBoards: false,
                syncFavorites: false
            }
        );

        expect(result.imported).toBe(0);
        expect(commands.getFileSizesBulk).not.toHaveBeenCalled();
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('changes missing state only from typed filesystem evidence', async () => {
        const imagePath = 'D:/AmbitFixtures/InvokeAI/outputs/images/missing.png';
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) return [{ name: 'metadata_json' }];
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
            if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 1 }];
            if (query.includes('SELECT i.image_name') && query.includes('OFFSET 0')) return [{
                image_name: 'missing.png',
                metadata_blob: {},
                created_at: '2026-04-18 12:00:00',
                width: 512,
                height: 512,
            }];
            return [];
        });
        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(commands.probeFileMetadataBulk).mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths.map(path => path.endsWith('/outputs/images')
                ? { status: 'present', size: 0, isFile: false }
                : { status: 'missing' })
        }) as never);
        vi.mocked(getImagesByIds).mockResolvedValue([makeExistingInvokeImage('missing.png')]);

        await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual', syncBoards: false, syncFavorites: false,
        });

        expect(insertImagesBatch).toHaveBeenCalledWith([
            expect.objectContaining({ id: imagePath, isMissing: true }),
        ]);

        vi.mocked(insertImagesBatch).mockClear();
        vi.mocked(commands.probeFileMetadataBulk).mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths.map(path => path.endsWith('/outputs/images')
                ? { status: 'present', size: 0, isFile: false }
                : { status: 'present', size: 0, isFile: true })
        }) as never);
        vi.mocked(getImagesByIds).mockResolvedValue([makeExistingInvokeImage('missing.png', { isMissing: true })]);
        await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual', syncBoards: false, syncFavorites: false,
        });
        expect(insertImagesBatch).toHaveBeenCalledWith([
            expect.objectContaining({ id: imagePath, isMissing: false }),
        ]);

        vi.mocked(insertImagesBatch).mockClear();
        vi.mocked(commands.probeFileMetadataBulk).mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths.map(path => path.endsWith('/outputs/images')
                ? { status: 'present', size: 0, isFile: false }
                : { status: 'error', message: 'access denied' })
        }) as never);
        await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual', syncBoards: false, syncFavorites: false,
        });
        expect(insertImagesBatch).not.toHaveBeenCalled();

        vi.mocked(getImagesByIds).mockResolvedValue([makeExistingInvokeImage('missing.png', {
            fileSize: 4096,
            isMissing: true,
            originalMetadata: undefined,
            originalChunks: undefined,
        })]);
        await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual', syncBoards: false, syncFavorites: false,
        });
        expect(insertImagesBatch).toHaveBeenCalledWith([
            expect.objectContaining({ id: imagePath, fileSize: 4096, isMissing: true }),
        ]);

        vi.mocked(insertImagesBatch).mockClear();
        vi.mocked(getImagesByIds).mockResolvedValue([makeExistingInvokeImage('missing.png')]);
        vi.mocked(commands.probeFileMetadataBulk).mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths.map(path => path.endsWith('/outputs/images')
                ? { status: 'present', size: 0, isFile: true }
                : { status: 'missing' })
        }) as never);
        await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual', syncBoards: false, syncFavorites: false,
        });
        expect(insertImagesBatch).not.toHaveBeenCalled();

        vi.mocked(insertImagesBatch).mockClear();
        vi.mocked(getImagesByIds).mockResolvedValue([makeExistingInvokeImage('missing.png', { isMissing: true })]);
        vi.mocked(commands.probeFileMetadataBulk).mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths.map(path => path.endsWith('/outputs/images')
                ? { status: 'present', size: 0, isFile: false }
                : { status: 'present', size: 0, isFile: false })
        }) as never);
        await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual', syncBoards: false, syncFavorites: false,
        });
        expect(insertImagesBatch).not.toHaveBeenCalled();

        vi.mocked(insertImagesBatch).mockClear();
        vi.mocked(commands.probeFileMetadataBulk).mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths.map(path => path.endsWith('/outputs/images')
                ? { status: 'present', size: 0, isFile: false }
                : { status: 'missing' })
        }) as never);
        vi.mocked(getImagesByIds).mockResolvedValue([makeExistingInvokeImage('missing.png')]);
        let rootChecks = 0;
        vi.mocked(commands.probeFileMetadataBulk).mockImplementation(async (paths: string[]) => {
            if (paths.length === 1 && paths[0] === 'D:/AmbitFixtures/InvokeAI/outputs/images') {
                rootChecks++;
                return {
                    status: 'ok',
                    data: [rootChecks === 1
                        ? { status: 'present', size: 0, isFile: false }
                        : { status: 'missing' }],
                } as never;
            }
            return {
                status: 'ok',
                data: paths.map(() => ({ status: 'missing' })),
            } as never;
        });
        await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual', syncBoards: false, syncFavorites: false,
        });
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('repairs an existing stale flat InvokeAI row when the real file resolves to a subfolder', async () => {
        const staleFlatPath = 'D:/AmbitFixtures/InvokeAI/outputs/images/date.png';
        const resolvedPath = 'D:/AmbitFixtures/InvokeAI/outputs/images/2026/04/18/date.png';
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [{ name: 'metadata_json' }, { name: 'thumbnail_name' }, { name: 'image_subfolder' }];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('SELECT 1 as found FROM images i')) {
                return [{ found: 1 }];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) {
                return [{ count: 1 }];
            }
            if (query.includes('FROM images i') && query.includes('OFFSET 0')) {
                return [{
                    image_name: 'date.png',
                    image_subfolder: '2026/04/18',
                    metadata_blob: {},
                    created_at: '2026-04-18 12:00:00',
                    width: 512,
                    height: 512,
                    thumbnail_name: 'date.webp'
                }];
            }
            return [];
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
            status: 'ok',
            data: ['outputs/images/2026/04/18/date.png']
        } as never);
        vi.mocked(commands.verifyImagePaths).mockImplementation(async () => ({
            status: 'ok',
            data: []
        }) as never);
        vi.mocked(getImagesByIds).mockResolvedValue([{
            id: staleFlatPath,
            url: `asset://${staleFlatPath}`,
            thumbnailUrl: `asset://${staleFlatPath}`,
            filename: 'date.png',
            fileSize: 123,
            timestamp: 100,
            width: 512,
            height: 512,
            isFavorite: true,
            isPinned: false,
            isDeleted: false,
            isMissing: false,
            metadata: {
                tool: GeneratorTool.INVOKEAI,
                model: 'Test Model',
                seed: 1,
                steps: 20,
                cfg: 7,
                sampler: 'Euler',
                positivePrompt: 'test',
                negativePrompt: '',
                loras: [],
                controlNets: []
            },
            originalMetadata: {
                tool: GeneratorTool.INVOKEAI,
                model: 'Test Model',
                seed: 1,
                steps: 20,
                cfg: 7,
                sampler: 'Euler',
                positivePrompt: 'test',
                negativePrompt: '',
                loras: [],
                controlNets: []
            },
            originalChunks: { invokeai_metadata: JSON.stringify({ positive_prompt: 'test' }) },
            invokeImageName: 'date.png'
        }]);
        vi.mocked(moveImagePathIdentity)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);

        const result = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            {
                mode: 'live',
                syncBoards: false,
                syncFavorites: false
            }
        );

        expect(result.updated).toBe(1);
        expect(result.imported).toBe(0);
        expect(moveImagePathIdentity).toHaveBeenCalledWith(
            staleFlatPath,
            resolvedPath,
            expect.stringContaining('date.webp'),
            'invokeai'
        );
        expect(insertImagesBatch).not.toHaveBeenCalled();

        const declinedResult = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            { mode: 'live', syncBoards: false, syncFavorites: false }
        );
        expect(declinedResult.updated).toBe(0);

        vi.mocked(commands.verifyImagePaths).mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths
        }) as never);
        const fallbackResult = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            { mode: 'live', syncBoards: false, syncFavorites: false }
        );
        expect(fallbackResult.updated).toBe(1);
    });

    it('repairs stale existing rows during a timestamp-filtered manual sync even when there are no import candidates', async () => {
        const staleFlatPath = 'D:/AmbitFixtures/InvokeAI/outputs/images/old.png';
        const resolvedPath = 'D:/AmbitFixtures/InvokeAI/outputs/images/2026/04/18/old.png';
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [
                    { name: 'metadata_json' },
                    { name: 'image_subfolder' },
                    { name: 'thumbnail_name' },
                    { name: 'is_intermediate' }
                ];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) {
                return [{ count: 0 }];
            }
            if (query.includes('SELECT i.image_name, i.image_subfolder')) {
                return [{
                    image_name: 'old.png',
                    image_subfolder: '2026/04/18',
                    thumbnail_name: 'old.webp',
                    metadata_blob: null,
                    created_at: '2026-04-18 12:00:00',
                    is_intermediate: 0
                }];
            }
            return [];
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
            status: 'ok',
            data: ['outputs/images/wrong/old.png']
        } as never);
        vi.mocked(commands.verifyImagePaths).mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths
        }) as never);
        vi.mocked(getFlatInvokeImageIdsForRoot).mockResolvedValue([staleFlatPath]);
        vi.mocked(getImagesByIds).mockResolvedValue([{
            id: staleFlatPath,
            url: `asset://${staleFlatPath}`,
            thumbnailUrl: `asset://${staleFlatPath}`,
            filename: 'old.png',
            fileSize: 123,
            timestamp: 100,
            width: 512,
            height: 512,
            isFavorite: false,
            isPinned: false,
            isDeleted: false,
            isMissing: false,
            metadata: {
                tool: GeneratorTool.INVOKEAI,
                model: 'Test Model',
                seed: 1,
                steps: 20,
                cfg: 7,
                sampler: 'Euler',
                positivePrompt: 'test',
                negativePrompt: '',
                loras: [],
                controlNets: []
            }
        }]);
        vi.mocked(moveImagePathIdentities).mockResolvedValue({
            moved: 1,
            skippedTargetExists: 0,
            skippedSourceMissing: 0
        });

        const result = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            {
                mode: 'manual',
                afterTimestamp: Date.now(),
                syncBoards: false,
                syncFavorites: false
            }
        );

        expect(result.imported).toBe(0);
        expect(result.updated).toBe(1);
        expect(moveImagePathIdentities).toHaveBeenCalledWith([{
            oldId: staleFlatPath,
            newId: resolvedPath,
            thumbnailPath: resolvedPath,
            thumbnailSource: null
        }]);
        expect(commands.listInvokeaiImages).not.toHaveBeenCalled();
        expect(moveImagePathIdentity).not.toHaveBeenCalled();
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('does not run broad stale-path repair during startup catch-up when there are no new InvokeAI rows', async () => {
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [
                    { name: 'metadata_json' },
                    { name: 'image_subfolder' },
                    { name: 'is_intermediate' },
                    { name: 'updated_at' }
                ];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('SELECT 1 as found FROM images i')) {
                return [];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) {
                return [{ count: 0 }];
            }
            return [];
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);

        const result = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            {
                mode: 'startup',
                afterTimestamp: Date.now(),
                syncBoards: false,
                syncFavorites: false
            }
        );

        expect(result.imported).toBe(0);
        expect(result.updated).toBe(0);
        expect(getFlatInvokeImageIdsForRoot).not.toHaveBeenCalled();
        expect(moveImagePathIdentities).not.toHaveBeenCalled();
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('repairs stale rows through unique disk fallback when image_subfolder is unavailable', async () => {
        const staleFlatPath = 'D:/AmbitFixtures/InvokeAI/outputs/images/legacy.png';
        const resolvedPath = 'D:/AmbitFixtures/InvokeAI/outputs/images/2026/04/18/legacy.png';
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [
                    { name: 'metadata_json' },
                    { name: 'thumbnail_name' },
                    { name: 'is_intermediate' }
                ];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) {
                return [{ count: 0 }];
            }
            if (query.includes('SELECT i.image_name')) {
                return [{
                    image_name: 'legacy.png',
                    thumbnail_name: 'legacy.webp',
                    metadata_blob: null,
                    created_at: '2026-04-18 12:00:00',
                    is_intermediate: 0
                }];
            }
            return [];
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
            status: 'ok',
            data: ['outputs/images/2026/04/18/legacy.png']
        } as never);
        vi.mocked(commands.verifyImagePaths).mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths
        }) as never);
        vi.mocked(getFlatInvokeImageIdsForRoot).mockResolvedValue([staleFlatPath]);
        vi.mocked(getImagesByIds).mockResolvedValue([{
            id: staleFlatPath,
            url: `asset://${staleFlatPath}`,
            thumbnailUrl: `asset://${staleFlatPath}`,
            filename: 'legacy.png',
            fileSize: 123,
            timestamp: 100,
            width: 512,
            height: 512,
            isFavorite: false,
            isPinned: false,
            isDeleted: false,
            isMissing: false,
            metadata: {
                tool: GeneratorTool.INVOKEAI,
                model: 'Test Model',
                seed: 1,
                steps: 20,
                cfg: 7,
                sampler: 'Euler',
                positivePrompt: 'test',
                negativePrompt: '',
                loras: [],
                controlNets: []
            }
        }]);
        vi.mocked(moveImagePathIdentities).mockResolvedValue({
            moved: 1,
            skippedTargetExists: 0,
            skippedSourceMissing: 0
        });

        const result = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            {
                mode: 'manual',
                afterTimestamp: Date.now(),
                syncBoards: false,
                syncFavorites: false
            }
        );

        expect(result.imported).toBe(0);
        expect(result.updated).toBe(1);
        expect(moveImagePathIdentities).toHaveBeenCalledWith([{
            oldId: staleFlatPath,
            newId: resolvedPath,
            thumbnailPath: resolvedPath,
            thumbnailSource: null
        }]);
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('repairs stale rows when legacy InvokeAI image_name already contains a relative path', async () => {
        const staleFlatPath = 'D:/AmbitFixtures/InvokeAI/outputs/images/relative.png';
        const resolvedPath = 'D:/AmbitFixtures/InvokeAI/outputs/images/2026/04/18/relative.png';
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [
                    { name: 'metadata_json' },
                    { name: 'is_intermediate' }
                ];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) {
                return [{ count: 0 }];
            }
            if (query.includes('SELECT i.image_name') && query.includes(' IN (')) {
                return [];
            }
            if (query.includes('SELECT i.image_name') && query.includes("instr(REPLACE(i.image_name")) {
                return [{
                    image_name: '2026/04/18/relative.png',
                    metadata_blob: null,
                    created_at: '2026-04-18 12:00:00',
                    is_intermediate: 0
                }];
            }
            return [];
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(commands.verifyImagePaths).mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths
        }) as never);
        vi.mocked(getFlatInvokeImageIdsForRoot).mockResolvedValue([staleFlatPath]);
        vi.mocked(getImagesByIds).mockResolvedValue([{
            id: staleFlatPath,
            url: `asset://${staleFlatPath}`,
            thumbnailUrl: `asset://${staleFlatPath}`,
            filename: 'relative.png',
            fileSize: 123,
            timestamp: 100,
            width: 512,
            height: 512,
            isFavorite: false,
            isPinned: false,
            isDeleted: false,
            isMissing: false,
            metadata: {
                tool: GeneratorTool.INVOKEAI,
                model: 'Test Model',
                seed: 1,
                steps: 20,
                cfg: 7,
                sampler: 'Euler',
                positivePrompt: 'test',
                negativePrompt: '',
                loras: [],
                controlNets: []
            }
        }]);
        vi.mocked(moveImagePathIdentities).mockResolvedValue({
            moved: 1,
            skippedTargetExists: 0,
            skippedSourceMissing: 0
        });

        const result = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            {
                mode: 'manual',
                afterTimestamp: Date.now(),
                syncBoards: false,
                syncFavorites: false
            }
        );

        expect(result.imported).toBe(0);
        expect(result.updated).toBe(1);
        expect(moveImagePathIdentities).toHaveBeenCalledWith([{
            oldId: staleFlatPath,
            newId: resolvedPath,
            thumbnailPath: resolvedPath,
            thumbnailSource: null
        }]);
        const repairQueries = selectMock.mock.calls
            .map(([query]) => query)
            .filter(query => query.includes('SELECT i.image_name'));
        expect(repairQueries.some(query => query.includes("instr(REPLACE(i.image_name"))).toBe(true);
        expect(repairQueries.some(query => query.includes('LIKE ? ESCAPE'))).toBe(false);
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('skips stale relative-name repair when one flat source matches multiple resolved targets', async () => {
        const staleFlatPath = 'D:/AmbitFixtures/InvokeAI/outputs/images/duplicate.png';
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [
                    { name: 'metadata_json' },
                    { name: 'is_intermediate' }
                ];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) {
                return [{ count: 0 }];
            }
            if (query.includes('SELECT i.image_name') && query.includes(' IN (')) {
                return [];
            }
            if (query.includes('SELECT i.image_name') && query.includes("instr(REPLACE(i.image_name")) {
                return [
                    {
                        image_name: '2026/04/18/duplicate.png',
                        metadata_blob: null,
                        created_at: '2026-04-18 12:00:00',
                        is_intermediate: 0
                    },
                    {
                        image_name: 'txt2img/duplicate.png',
                        metadata_blob: null,
                        created_at: '2026-04-18 12:00:01',
                        is_intermediate: 0
                    }
                ];
            }
            return [];
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(commands.verifyImagePaths).mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths
        }) as never);
        vi.mocked(getFlatInvokeImageIdsForRoot).mockResolvedValue([staleFlatPath]);
        vi.mocked(getImagesByIds).mockResolvedValue([{
            id: staleFlatPath,
            url: `asset://${staleFlatPath}`,
            thumbnailUrl: `asset://${staleFlatPath}`,
            filename: 'duplicate.png',
            fileSize: 123,
            timestamp: 100,
            width: 512,
            height: 512,
            isFavorite: false,
            isPinned: false,
            isDeleted: false,
            isMissing: false,
            metadata: {
                tool: GeneratorTool.INVOKEAI,
                model: 'Test Model',
                seed: 1,
                steps: 20,
                cfg: 7,
                sampler: 'Euler',
                positivePrompt: 'test',
                negativePrompt: '',
                loras: [],
                controlNets: []
            }
        }]);

        const result = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            {
                mode: 'manual',
                afterTimestamp: Date.now(),
                syncBoards: false,
                syncFavorites: false
            }
        );

        expect(result.imported).toBe(0);
        expect(result.updated).toBe(0);
        expect(moveImagePathIdentities).not.toHaveBeenCalled();
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('skips stale repair fallback when duplicate basenames make the disk match ambiguous', async () => {
        const staleFlatPath = 'D:/AmbitFixtures/InvokeAI/outputs/images/duplicate.png';
        const selectMock = vi.fn(async (query: string) => {
            if (query.includes('PRAGMA table_info(images)')) {
                return [
                    { name: 'metadata_json' },
                    { name: 'is_intermediate' }
                ];
            }
            if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) {
                return [{ name: 'images' }];
            }
            if (query.includes('SELECT count(*) as count FROM images i')) {
                return [{ count: 0 }];
            }
            if (query.includes('SELECT i.image_name')) {
                return [{
                    image_name: 'duplicate.png',
                    metadata_blob: null,
                    created_at: '2026-04-18 12:00:00',
                    is_intermediate: 0
                }];
            }
            return [];
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
            status: 'ok',
            data: [
                'outputs/images/2026/04/18/duplicate.png',
                'outputs/images/txt2img/duplicate.png'
            ]
        } as never);
        vi.mocked(getFlatInvokeImageIdsForRoot).mockResolvedValue([staleFlatPath]);
        vi.mocked(getImagesByIds).mockResolvedValue([{
            id: staleFlatPath,
            url: `asset://${staleFlatPath}`,
            thumbnailUrl: `asset://${staleFlatPath}`,
            filename: 'duplicate.png',
            fileSize: 123,
            timestamp: 100,
            width: 512,
            height: 512,
            isFavorite: false,
            isPinned: false,
            isDeleted: false,
            isMissing: false,
            metadata: {
                tool: GeneratorTool.INVOKEAI,
                model: 'Test Model',
                seed: 1,
                steps: 20,
                cfg: 7,
                sampler: 'Euler',
                positivePrompt: 'test',
                negativePrompt: '',
                loras: [],
                controlNets: []
            }
        }]);

        const result = await syncImages(
            'D:/AmbitFixtures/InvokeAI/databases',
            vi.fn(),
            undefined,
            {
                mode: 'manual',
                afterTimestamp: Date.now(),
                syncBoards: false,
                syncFavorites: false
            }
        );

        expect(result.imported).toBe(0);
        expect(result.updated).toBe(0);
        expect(moveImagePathIdentities).not.toHaveBeenCalled();
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });
});
