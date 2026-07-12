import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from '@tauri-apps/plugin-sql';
import { commands } from '../../../bindings';
import { fetchBoardMappings } from '../connection';
import { insertImagesBatch } from '../../db';
import { upsertCollection } from '../../db/collectionRepo';
import {
    getFlatInvokeImageIdsForRoot,
    getImagesByIds,
    moveImagePathIdentities,
    moveImagePathIdentity,
    syncCollectionImages
} from '../../db/imageRepo';
import { syncImages } from '../syncService';
import { GeneratorTool, type AIImage } from '../../../types';

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
    fetchBoardMappings: vi.fn()
}));

vi.mock('../../db', () => ({
    insertImagesBatch: vi.fn()
}));

vi.mock('../../db/imageRepo', () => ({
    getFlatInvokeImageIdsForRoot: vi.fn(),
    getImagesByIds: vi.fn(),
    moveImagePathIdentities: vi.fn(),
    moveImagePathIdentity: vi.fn(),
    syncCollectionImages: vi.fn()
}));

vi.mock('../../db/collectionRepo', () => ({
    upsertCollection: vi.fn()
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
        ...overrides,
    };
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
    signal?: AbortSignal;
    onRepairRows?: () => void;
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
    const selectMock = vi.fn(async (query: string) => {
        if (query.includes('PRAGMA table_info(images)')) {
            return [{ name: 'metadata_json' }, { name: 'image_subfolder' }, { name: 'thumbnail_name' }];
        }
        if (query.includes("SELECT name FROM sqlite_master WHERE type='table'")) return [{ name: 'images' }];
        if (query.includes('SELECT count(*) as count FROM images i')) return [{ count: 0 }];
        if (query.includes('SELECT i.image_name')) {
            onRepairRows?.();
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

    const result = await syncImages(root, vi.fn(), signal, {
        mode: 'manual', syncBoards: false, syncFavorites: false
    });
    return { result, stalePath, targetPath };
};

describe('syncImages live mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(commands.getFileSizesBulk).mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths.map(() => 123)
        }) as never);
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({ status: 'ok', data: [] } as never);
        vi.mocked(commands.verifyImagePaths).mockResolvedValue({ status: 'ok', data: [] } as never);
        vi.mocked(insertImagesBatch).mockResolvedValue(undefined as never);
        vi.mocked(getFlatInvokeImageIdsForRoot).mockResolvedValue([]);
        vi.mocked(getImagesByIds).mockResolvedValue([]);
        vi.mocked(moveImagePathIdentities).mockResolvedValue({
            moved: 0,
            skippedTargetExists: 0,
            skippedSourceMissing: 0
        });
        vi.mocked(moveImagePathIdentity).mockResolvedValue(false);
        vi.mocked(syncCollectionImages).mockResolvedValue(undefined as never);
        vi.mocked(upsertCollection).mockResolvedValue(undefined as never);
        vi.mocked(fetchBoardMappings).mockResolvedValue({
            imageToBoardId: new Map(),
            boards: new Map()
        });
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
        expect(upsertCollection).not.toHaveBeenCalled();
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

    it('keeps live changed cycles incremental and skips the final full collection sync', async () => {
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
                        image_name: 'new-image.png',
                        metadata_blob: { positive_prompt: 'test' },
                        created_at: '2026-04-18 12:00:00',
                        updated_at: '2026-04-18 12:00:05',
                        width: 1024,
                        height: 1024,
                        starred: 1,
                        thumbnail_name: 'new-image.webp',
                        has_workflow: 1,
                        is_intermediate: 0
                    }
                ];
            }
            return [];
        });

        vi.mocked(Database.load).mockResolvedValue(createInvokeDb(selectMock) as never);
        vi.mocked(fetchBoardMappings).mockResolvedValue({
            imageToBoardId: new Map([['new-image.png', 'board-1']]),
            boards: new Map([['board-1', { name: 'Board One', createdAt: 123 }]])
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
            thumbnailUrl: 'D:/AmbitFixtures/InvokeAI/outputs/images/thumbnails/new-image.webp'
        }));
        expect(syncCollectionImages).toHaveBeenCalledTimes(1);
        expect(syncCollectionImages).toHaveBeenCalledWith([
            'D:/AmbitFixtures/InvokeAI/outputs/images/new-image.png'
        ]);
        expect(upsertCollection).toHaveBeenCalledTimes(1);
    });

    it('runs a final collection reconciliation after a manual board sync', async () => {
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
            boards: new Map([['board-1', { name: 'Board One', createdAt: 0 }]])
        });

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'manual', syncBoards: true, syncFavorites: true, starredAs: 'favorite'
        });

        expect(result.imported).toBe(1);
        expect(syncCollectionImages).toHaveBeenCalledTimes(2);
        expect(upsertCollection).toHaveBeenCalledWith(expect.objectContaining({ id: 'board-1', name: 'Board One' }));
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
                    image_name: 'unchanged.png', metadata_blob: { positive_prompt: 'raw' },
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
            originalChunks: { invokeai_metadata: JSON.stringify({ positive_prompt: 'raw' }) }
        }]);

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'live', syncBoards: false, syncFavorites: false
        });

        expect(result).toMatchObject({ imported: 0, updated: 0 });
        expect(result.syncedIds).toContain('unchanged.png');
        expect(insertImagesBatch).not.toHaveBeenCalled();
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
    });

    it('falls back safely when thumbnail verification and file-size probes fail', async () => {
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
        vi.mocked(commands.getFileSizesBulk).mockRejectedValue(new Error('probe failed'));

        const result = await syncImages('D:/AmbitFixtures/InvokeAI', vi.fn(), undefined, {
            mode: 'live', syncBoards: false, syncFavorites: false
        });

        expect(result.imported).toBe(1);
        expect(insertImagesBatch).toHaveBeenCalledWith([
            expect.objectContaining({
                filename: 'unreadable.png',
                fileSize: 0,
                thumbnailUrl: 'D:/AmbitFixtures/InvokeAI/outputs/images/unreadable.png'
            })
        ]);
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
            ])
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
            boards: new Map()
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
                originalChunks: { invokeai_metadata: {} }
            })
        ]);
        expect(upsertCollection).not.toHaveBeenCalled();
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
            boards: new Map([['board-1', { name: 'Board One', createdAt: 123 }]])
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
        expect(upsertCollection).toHaveBeenCalledTimes(1);
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
        ]));
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
            originalChunks: { invokeai_metadata: JSON.stringify({ positive_prompt: 'test' }) }
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
