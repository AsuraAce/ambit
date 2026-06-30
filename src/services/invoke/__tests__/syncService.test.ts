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
import { GeneratorTool } from '../../../types';

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
            'D:/AI/art/webUI/invokeai/databases',
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
            'D:/AI/art/webUI/invokeai/databases',
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
            'D:/AI/art/webUI/invokeai/databases',
            vi.fn(),
            undefined,
            {
                mode: 'live',
                syncBoards: true,
                syncFavorites: true,
                starredAs: 'both'
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
            thumbnailUrl: 'D:/AI/art/webUI/invokeai/outputs/images/thumbnails/new-image.webp'
        }));
        expect(syncCollectionImages).toHaveBeenCalledTimes(1);
        expect(syncCollectionImages).toHaveBeenCalledWith([
            'D:/AI/art/webUI/invokeai/outputs/images/new-image.png'
        ]);
        expect(upsertCollection).toHaveBeenCalledTimes(1);
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
            'D:/AI/art/webUI/invokeai/databases',
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
            thumbnailUrl: 'D:/AI/art/webUI/invokeai/outputs/images/thumbnails/startup-image.webp'
        }));
        expect(syncCollectionImages).toHaveBeenCalledTimes(1);
        expect(syncCollectionImages).toHaveBeenCalledWith([
            'D:/AI/art/webUI/invokeai/outputs/images/startup-image.png'
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
            'D:/AI/art/webUI/invokeai/databases',
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
            'D:/AI/art/webUI/invokeai/outputs/images/flat.png',
            'D:/AI/art/webUI/invokeai/outputs/images/2026/04/18/date.png',
            'D:/AI/art/webUI/invokeai/outputs/images/txt2img/type.png',
            'D:/AI/art/webUI/invokeai/outputs/images/ab/hash.png',
            'D:/AI/art/webUI/invokeai/outputs/images/custom/nested/path/custom.png',
            'D:/AI/art/webUI/invokeai/outputs/images/2026/04/relative.png',
            'D:/AI/art/webUI/invokeai/outputs/images/date.png',
            'D:/AI/art/webUI/invokeai/outputs/images/type.png',
            'D:/AI/art/webUI/invokeai/outputs/images/hash.png',
            'D:/AI/art/webUI/invokeai/outputs/images/custom.png'
        ]));
        expect(vi.mocked(insertImagesBatch).mock.calls[0][0].map((image) => image.id)).toEqual([
            'D:/AI/art/webUI/invokeai/outputs/images/flat.png',
            'D:/AI/art/webUI/invokeai/outputs/images/2026/04/18/date.png',
            'D:/AI/art/webUI/invokeai/outputs/images/txt2img/type.png',
            'D:/AI/art/webUI/invokeai/outputs/images/ab/hash.png',
            'D:/AI/art/webUI/invokeai/outputs/images/custom/nested/path/custom.png',
            'D:/AI/art/webUI/invokeai/outputs/images/2026/04/relative.png'
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
            'D:/AI/art/webUI/invokeai/databases',
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
            'D:/AI/art/webUI/invokeai/databases',
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
        const staleFlatPath = 'D:/AI/art/webUI/invokeai/outputs/images/date.png';
        const resolvedPath = 'D:/AI/art/webUI/invokeai/outputs/images/2026/04/18/date.png';
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
        vi.mocked(commands.verifyImagePaths).mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths
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
            }
        }]);
        vi.mocked(moveImagePathIdentity).mockResolvedValue(true);

        const result = await syncImages(
            'D:/AI/art/webUI/invokeai/databases',
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
            resolvedPath,
            null
        );
        expect(insertImagesBatch).toHaveBeenCalledWith([
            expect.objectContaining({
                id: resolvedPath,
                isFavorite: true,
                thumbnailUrl: resolvedPath
            })
        ]);
    });

    it('repairs stale existing rows during a timestamp-filtered manual sync even when there are no import candidates', async () => {
        const staleFlatPath = 'D:/AI/art/webUI/invokeai/outputs/images/old.png';
        const resolvedPath = 'D:/AI/art/webUI/invokeai/outputs/images/2026/04/18/old.png';
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
            'D:/AI/art/webUI/invokeai/databases',
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
            'D:/AI/art/webUI/invokeai/databases',
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
        const staleFlatPath = 'D:/AI/art/webUI/invokeai/outputs/images/legacy.png';
        const resolvedPath = 'D:/AI/art/webUI/invokeai/outputs/images/2026/04/18/legacy.png';
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
            'D:/AI/art/webUI/invokeai/databases',
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
        const staleFlatPath = 'D:/AI/art/webUI/invokeai/outputs/images/relative.png';
        const resolvedPath = 'D:/AI/art/webUI/invokeai/outputs/images/2026/04/18/relative.png';
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
            'D:/AI/art/webUI/invokeai/databases',
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
        const staleFlatPath = 'D:/AI/art/webUI/invokeai/outputs/images/duplicate.png';
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
            'D:/AI/art/webUI/invokeai/databases',
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
        const staleFlatPath = 'D:/AI/art/webUI/invokeai/outputs/images/duplicate.png';
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
            'D:/AI/art/webUI/invokeai/databases',
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
