import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../types';

const invokeMock = vi.hoisted(() => vi.fn());
const scanImageNativeMock = vi.hoisted(() => vi.fn());
const browserMockModeMock = vi.hoisted(() => vi.fn());
const getBrowserMockImagesMock = vi.hoisted(() => vi.fn());
const updateBrowserMockImageMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: (path: string) => `asset://${path}`,
    invoke: invokeMock,
}));

vi.mock('../../../bindings', () => ({
    commands: {
        saveImagesBatch: vi.fn(),
        moveImagePathIdentities: vi.fn(),
        moveToTrash: vi.fn(),
        deleteThumbnail: vi.fn(),
        rebuildFacetCache: vi.fn(),
        rebuildFacetCacheIncremental: vi.fn(),
        purgeDatabase: vi.fn(),
    }
}));

vi.mock('../../metadataParser', () => ({
    scanImageNative: scanImageNativeMock,
}));

vi.mock('../../runtime', () => ({
    isBrowserMockMode: browserMockModeMock,
}));

vi.mock('../../browserMockData', () => ({
    getBrowserMockImages: getBrowserMockImagesMock,
    updateBrowserMockImage: updateBrowserMockImageMock,
}));

const dispatchMock = vi.fn(async (fn: () => Promise<unknown>) => fn());
const getDbMock = vi.fn();

const liveImportMetadata = {
    tool: GeneratorTool.INVOKEAI,
    model: 'Checkpoint',
    seed: 1,
    steps: 20,
    cfg: 7,
    sampler: 'euler',
    positivePrompt: 'prompt',
    negativePrompt: '',
};

vi.mock('../connection', () => ({
    dbMutex: {
        dispatch: (...args: unknown[]) => dispatchMock(...args as [() => Promise<unknown>]),
    },
    getDb: () => getDbMock(),
}));

describe('imageRepo batch removal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        browserMockModeMock.mockReturnValue(false);
        getBrowserMockImagesMock.mockReturnValue([]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('surfaces native batch persistence failures so imports do not silently lose images', async () => {
        const db = {
            select: vi.fn(),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);
        const nativeError = new Error('backend refused batch');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { commands } = await import('../../../bindings');
        vi.mocked(commands.saveImagesBatch).mockRejectedValue(nativeError);

        const { insertImagesBatch } = await import('../imageRepo');
        await expect(insertImagesBatch([{
            id: 'C:/images/fails.png',
            url: 'C:/images/fails.png',
            thumbnailUrl: 'C:/thumbs/fails.webp',
            filename: 'fails.png',
            width: 512,
            height: 512,
            timestamp: 1700000000000,
            metadata: liveImportMetadata,
            isFavorite: false,
        }])).rejects.toThrow('backend refused batch');

        expect(errorSpy).toHaveBeenCalledWith('[DB] Rust batch insert failed', nativeError);
        errorSpy.mockRestore();
    });

    it('uses browser mock data for repository reads and writes without touching native storage', async () => {
        browserMockModeMock.mockReturnValue(true);
        const promptMetadata = { ...liveImportMetadata, positivePrompt: 'prompt' };
        const makeBrowserImage = (image: Partial<AIImage> & Pick<AIImage, 'id'>): AIImage => ({
            id: image.id,
            url: image.url ?? image.id,
            thumbnailUrl: image.thumbnailUrl ?? '',
            filename: image.filename ?? image.id.split('/').pop() ?? image.id,
            width: image.width ?? 512,
            height: image.height ?? 512,
            timestamp: image.timestamp ?? 0,
            metadata: image.metadata ?? liveImportMetadata,
            isFavorite: image.isFavorite ?? false,
            isPinned: image.isPinned,
            isDeleted: image.isDeleted,
            isIntermediate: image.isIntermediate,
            fileSize: image.fileSize,
            notes: image.notes,
            boardId: image.boardId,
            groupId: image.groupId,
        });
        const browserImages = [
            makeBrowserImage({
                id: 'regular',
                timestamp: 40,
                fileSize: 123,
                isPinned: false,
                isDeleted: false,
                isIntermediate: false,
                metadata: promptMetadata,
                notes: 'note',
            }),
            makeBrowserImage({
                id: 'pinned',
                timestamp: 10,
                fileSize: 456,
                isFavorite: true,
                isPinned: true,
                isDeleted: false,
                isIntermediate: false,
                metadata: promptMetadata,
            }),
            makeBrowserImage({
                id: 'intermediate',
                timestamp: 60,
                fileSize: 1,
                isPinned: false,
                isDeleted: false,
                isIntermediate: true,
                metadata: promptMetadata,
            }),
            makeBrowserImage({
                id: 'grid',
                timestamp: 70,
                fileSize: 1,
                isPinned: false,
                isDeleted: false,
                isIntermediate: false,
                metadata: { ...promptMetadata, isGrid: true },
            }),
            makeBrowserImage({
                id: 'deleted',
                timestamp: 80,
                fileSize: 1,
                isPinned: false,
                isDeleted: true,
                isIntermediate: false,
                metadata: promptMetadata,
            }),
            makeBrowserImage({
                id: 'D:/Invoke/outputs/images/flat.png',
                timestamp: 5,
                fileSize: 1,
                isPinned: false,
                isDeleted: false,
                isIntermediate: false,
                metadata: promptMetadata,
            }),
            makeBrowserImage({
                id: 'D:/Invoke/outputs/images/sub/nested.png',
                timestamp: 4,
                fileSize: 1,
                isPinned: false,
                isDeleted: false,
                isIntermediate: false,
                metadata: promptMetadata,
            }),
        ];
        getBrowserMockImagesMock.mockReturnValue(browserImages);

        const {
            insertImage,
            insertImagesBatch,
            moveImagePathIdentities,
            rebuildFacetCache,
            rebuildFacetCacheIncremental,
            syncCollectionImages,
            updateImageMetadataFields,
            revertImageMetadata,
            updateImageNotesCol,
            isImageNew,
            getAllImages,
            getImagesByIds,
            getFlatInvokeImageIdsForRoot,
            getImageWithFullMetadata,
            toggleImagePin,
            toggleImageFavorite,
            toggleImageMask,
            toggleImageIntermediate,
            deleteImage,
            deleteImageFromDisk,
            markAsDeleted,
            updateImageWorkflow,
            updateImageWorkflowHint,
            updateFavorite,
            updatePinned,
            updateImagesBoard,
            checkHiddenContentAvailability,
            clearAllThumbnailPaths,
            updateThumbnailPath,
            updateThumbnailPathsBatch,
            getExistingMetadata,
        } = await import('../imageRepo');

        await expect(insertImage(browserImages[0])).resolves.toBeUndefined();
        await expect(insertImagesBatch([browserImages[0]])).resolves.toBeUndefined();
        await expect(moveImagePathIdentities([
            { oldId: 'regular', newId: 'moved', thumbnailPath: 'thumb.webp', thumbnailSource: 'ambit' },
            { oldId: 'missing-source', newId: 'unused' },
            { oldId: 'pinned', newId: 'regular' },
        ])).resolves.toEqual({ moved: 1, skippedTargetExists: 1, skippedSourceMissing: 1 });
        await expect(rebuildFacetCache()).resolves.toBe(0);
        await expect(rebuildFacetCacheIncremental('loras')).resolves.toBe(0);
        await expect(syncCollectionImages(['regular'])).resolves.toBeUndefined();
        await expect(updateImageMetadataFields('regular', { model: 'edited' })).resolves.toBeUndefined();
        await expect(updateImageMetadataFields('missing-source', { model: 'ignored' })).resolves.toBeUndefined();
        await expect(revertImageMetadata('regular')).resolves.toBeUndefined();
        await expect(updateImageNotesCol('regular', null)).resolves.toBeUndefined();
        await expect(isImageNew('regular')).resolves.toBe(false);
        await expect(isImageNew('new-image')).resolves.toBe(true);
        await expect(getAllImages(2, 0, true)).resolves.toEqual([browserImages[1], browserImages[0]]);
        await expect(getImagesByIds([])).resolves.toEqual([]);
        await expect(getImagesByIds(['regular', 'pinned'])).resolves.toEqual([browserImages[0], browserImages[1]]);
        await expect(getFlatInvokeImageIdsForRoot('D:/Invoke/')).resolves.toEqual(['D:/Invoke/outputs/images/flat.png']);
        await expect(getImageWithFullMetadata('regular')).resolves.toEqual(browserImages[0]);
        await expect(getImageWithFullMetadata('missing-source')).resolves.toBeNull();
        await expect(toggleImagePin('regular', true)).resolves.toBeUndefined();
        await expect(toggleImageFavorite('regular', true)).resolves.toBeUndefined();
        await expect(toggleImageMask('regular', null)).resolves.toBeUndefined();
        await expect(toggleImageIntermediate('regular', true)).resolves.toBeUndefined();
        await expect(toggleImageIntermediate('missing-source', true)).resolves.toBeUndefined();
        await expect(deleteImage('regular')).resolves.toBeUndefined();
        await expect(deleteImageFromDisk('regular', 'regular', 'thumb.webp')).resolves.toBeUndefined();
        await expect(markAsDeleted(['regular', 'pinned'], true)).resolves.toBeUndefined();
        await expect(updateImageWorkflow('regular', '{"nodes":[]}')).resolves.toBeUndefined();
        await expect(updateImageWorkflow('missing-source', '{"nodes":[]}')).resolves.toBeUndefined();
        await expect(updateImageWorkflowHint('regular', true)).resolves.toBeUndefined();
        await expect(updateImageWorkflowHint('missing-source', true)).resolves.toBeUndefined();
        await expect(updateFavorite('regular', true)).resolves.toBeUndefined();
        await expect(updatePinned('regular', true)).resolves.toBeUndefined();
        await expect(updateImagesBoard(['regular'], 'board-a')).resolves.toBeUndefined();
        await expect(updateImagesBoard(['regular'], null)).resolves.toBeUndefined();
        await expect(checkHiddenContentAvailability()).resolves.toEqual({ hasIntermediates: true, hasGrids: true });
        await expect(clearAllThumbnailPaths()).resolves.toBe(0);
        await expect(updateThumbnailPath('regular', 'thumb.webp')).resolves.toBeUndefined();
        await expect(updateThumbnailPathsBatch([{ id: 'regular', thumbnailPath: 'thumb.webp', microThumbnail: 'data', thumbnailSource: 'ambit' }])).resolves.toBeUndefined();
        await expect(getExistingMetadata([])).resolves.toEqual(new Map());

        const existingMetadata = await getExistingMetadata(['regular', 'missing-source']);
        expect(existingMetadata.get('regular')).toEqual({
            timestamp: 40,
            fileSize: 123,
            metadataJson: JSON.stringify(promptMetadata),
            isFavorite: false,
            isPinned: false,
            boardId: undefined,
            groupId: undefined,
            notes: 'note',
        });
        expect(existingMetadata.has('missing-source')).toBe(false);

        expect(updateBrowserMockImageMock).toHaveBeenCalledWith('regular', {
            id: 'moved',
            url: 'moved',
            thumbnailUrl: 'thumb.webp',
            thumbnailSource: 'ambit',
            isMissing: false,
        });
        expect(updateBrowserMockImageMock).toHaveBeenCalledWith('regular', {
            metadata: expect.objectContaining({ positivePrompt: 'prompt', model: 'edited' }),
        });
        expect(updateBrowserMockImageMock).toHaveBeenCalledWith('regular', {
            metadata: expect.objectContaining({ positivePrompt: 'prompt', workflowJson: '{"nodes":[]}', hasWorkflowHint: true }),
        });
        expect(updateBrowserMockImageMock).toHaveBeenCalledWith('regular', {
            thumbnailUrl: 'thumb.webp',
            microThumbnail: 'data',
            thumbnailSource: 'ambit',
        });
        expect(getDbMock).not.toHaveBeenCalled();
    });

    it('continues existing-metadata lookups after a chunk query fails', async () => {
        const ids = Array.from({ length: 901 }, (_, index) => `C:/images/${index}.png`);
        const db = {
            select: vi.fn(async (_sql: string, params: string[]) => {
                if (params.includes('C:/images/0.png')) {
                    throw new Error('sqlite busy');
                }
                return [{
                    id: 'C:/images/900.png',
                    timestamp: 1700000000000,
                    file_size: 2048,
                    metadata_json: JSON.stringify(liveImportMetadata),
                    is_favorite: 1,
                    is_pinned: 0,
                    board_id: null,
                    group_id: 'group-a',
                    notes: null,
                }];
            }),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { getExistingMetadata } = await import('../imageRepo');
        const metadata = await getExistingMetadata(ids);

        expect(metadata.get('C:/images/900.png')).toEqual({
            timestamp: 1700000000000,
            fileSize: 2048,
            metadataJson: JSON.stringify(liveImportMetadata),
            isFavorite: true,
            isPinned: false,
            boardId: undefined,
            groupId: 'group-a',
            notes: undefined,
        });
        expect(errorSpy).toHaveBeenCalledWith('[DB] Failed to fetch existing metadata', expect.any(Error));
        errorSpy.mockRestore();
    });

    it('skips user_masked cleanup when imported records do not contain default-visible overrides', async () => {
        const db = {
            select: vi.fn(async (sql: string) => {
                const normalizedSql = sql.toLowerCase();
                if (normalizedSql.includes('count(*) as count')) return [{ count: 0 }];
                if (normalizedSql.includes('select 1 from images where ifnull(is_intermediate_gen')) return [{ 1: 1 }];
                if (normalizedSql.includes('select 1 from images where ifnull(is_grid_gen')) return [];
                if (sql.includes('FROM images')) {
                    return [{ id: 'C:/images/a.png', metadata_json: JSON.stringify(liveImportMetadata), timestamp: 1 }];
                }
                return [];
            }),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);

        const { commands } = await import('../../../bindings');
        vi.mocked(commands.saveImagesBatch).mockResolvedValue({ status: 'ok', data: 1 });

        const { insertImagesBatch } = await import('../imageRepo');
        await insertImagesBatch([{
            id: 'C:/images/live.png',
            url: 'C:/images/live.png',
            thumbnailUrl: 'C:/thumbs/live.webp',
            filename: 'live.png',
            width: 512,
            height: 512,
            timestamp: 1700000000000,
            metadata: liveImportMetadata,
            isFavorite: false,
        }]);

        expect(db.execute).not.toHaveBeenCalled();
    });

    it('does not persist an empty raw chunk map as reparsable metadata', async () => {
        const db = {
            select: vi.fn(),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);

        const { commands } = await import('../../../bindings');
        vi.mocked(commands.saveImagesBatch).mockResolvedValue({ status: 'ok', data: 1 });

        const { insertImagesBatch } = await import('../imageRepo');
        await insertImagesBatch([{
            id: 'C:/images/no-metadata.jpeg',
            url: 'C:/images/no-metadata.jpeg',
            thumbnailUrl: 'C:/thumbs/no-metadata.webp',
            filename: 'no-metadata.jpeg',
            width: 512,
            height: 512,
            timestamp: 1700000000000,
            metadata: {
                tool: GeneratorTool.UNKNOWN,
                model: 'Unknown',
                steps: 0,
                cfg: 0,
                sampler: '',
                positivePrompt: '',
                negativePrompt: '',
            },
            originalChunks: {},
            isFavorite: false,
        }]);

        const [records] = vi.mocked(commands.saveImagesBatch).mock.calls[0];
        expect(records[0].originalMetadataJson).toBeNull();
    });

    it('keeps the scalar seed synchronized when metadata fields are patched', async () => {
        const db = {
            select: vi.fn(),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);

        const { updateImageMetadataFields } = await import('../imageRepo');
        await updateImageMetadataFields('C:/images/zero.png', { seed: 0 });

        expect(db.execute).toHaveBeenCalledWith(
            expect.stringContaining(', seed = ?'),
            [0, 0, 'C:/images/zero.png']
        );
    });

    it('restores a genuine zero seed into both JSON and the scalar column', async () => {
        const originalMetadata = {
            ...liveImportMetadata,
            seed: 0,
        };
        const db = {
            select: vi.fn(async () => [{
                original_parsed_json: JSON.stringify(originalMetadata),
            }]),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);

        const { revertImageMetadata } = await import('../imageRepo');
        await revertImageMetadata('C:/images/zero.png');

        const [, params] = db.execute.mock.calls[0] as [string, unknown[]];
        expect(db.execute.mock.calls[0][0]).toContain('seed = ?');
        expect(params).toContain(0);
    });

    it('limits user_masked cleanup to imported record ids when default-visible overrides are present', async () => {
        const db = {
            select: vi.fn(),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);

        const { commands } = await import('../../../bindings');
        vi.mocked(commands.saveImagesBatch).mockResolvedValue({ status: 'ok', data: 1 });

        const { insertImagesBatch } = await import('../imageRepo');
        await insertImagesBatch([{
            id: 'C:/images/live-visible.png',
            url: 'C:/images/live-visible.png',
            thumbnailUrl: 'C:/thumbs/live-visible.webp',
            filename: 'live-visible.png',
            width: 512,
            height: 512,
            timestamp: 1700000000000,
            metadata: liveImportMetadata,
            isFavorite: false,
            userMasked: false,
        }]);

        expect(db.execute).toHaveBeenCalledTimes(1);
        expect(db.execute).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE images SET user_masked = NULL WHERE user_masked = 0 AND id IN (?)'),
            ['C:/images/live-visible.png']
        );
    });

    it('loads full metadata columns for ID lookups used by sync flows', async () => {
        const id = 'C:/images/synced.png';
        const metadata = {
            tool: 'InvokeAI',
            model: 'Invoke Model',
            seed: 123,
            steps: 24,
            cfg: 6.5,
            sampler: 'dpmpp',
            positivePrompt: 'edited prompt',
            negativePrompt: '',
            workflowJson: '{"nodes":[]}',
            loras: ['detail.safetensors'],
        };
        const originalMetadata = {
            ...metadata,
            positivePrompt: 'original prompt',
            workflowJson: undefined,
            loras: undefined,
        };
        const originalChunks = {
            invokeai_metadata: JSON.stringify({ positive_prompt: 'raw prompt' }),
        };
        const originalState = {
            isFavorite: true,
            isPinned: false,
            boardId: 'board-a',
        };

        const db = {
            select: vi.fn(async () => [{
                id,
                path: id,
                width: 512,
                height: 768,
                file_size: 2048,
                file_hash: 'hash-a',
                timestamp: 1700000000000,
                thumbnail_path: 'C:/thumbs/synced.webp',
                micro_thumbnail: null,
                thumbnail_source: 'ambit',
                is_favorite: 1,
                is_pinned: 0,
                is_deleted: 0,
                is_missing: 0,
                is_corrupt: 0,
                user_masked: null,
                group_id: null,
                board_id: 'board-a',
                notes: null,
                is_intermediate_gen: 0,
                is_grid_gen: 0,
                model_name: 'Invoke Model',
                model_hash: 'hash-model',
                tool: 'InvokeAI',
                resolved_model_name: 'Invoke Model',
                steps: 24,
                cfg: 6.5,
                sampler: 'dpmpp',
                generation_type: 'txt2img',
                positive_prompt: 'edited prompt',
                negative_prompt: '',
                metadata_json: JSON.stringify(metadata),
                original_metadata_json: JSON.stringify(originalChunks),
                original_parsed_json: JSON.stringify(originalMetadata),
                original_state_json: JSON.stringify(originalState),
            }]),
            execute: vi.fn(),
        };

        getDbMock.mockResolvedValue(db);

        const { getImagesByIds } = await import('../imageRepo');
        const images = await getImagesByIds([id]);

        const selectCalls = db.select.mock.calls as unknown as [string, unknown[]?][];
        const sql = selectCalls[0]?.[0];
        expect(sql).toBeDefined();
        expect(sql).toContain('images.metadata_json');
        expect(sql).toContain('images.original_metadata_json');
        expect(sql).toContain('images.original_parsed_json');
        expect(sql).toContain('images.original_state_json');
        expect(images[0].metadata.positivePrompt).toBe('edited prompt');
        expect(images[0].metadata.workflowJson).toBe('{"nodes":[]}');
        expect(images[0].metadata.loras).toEqual(['detail.safetensors']);
        expect(images[0].originalMetadata?.positivePrompt).toBe('original prompt');
        expect(images[0].originalChunks?.invokeai_metadata).toBe(JSON.stringify({ positive_prompt: 'raw prompt' }));
        expect(images[0].originalState).toEqual(originalState);
    });

    it('finds only flat InvokeAI image rows for stale path repair', async () => {
        const db = {
            select: vi.fn(async () => [
                { id: 'D:/Invoke/outputs/images/old.png' }
            ]),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);

        const { getFlatInvokeImageIdsForRoot } = await import('../imageRepo');
        const ids = await getFlatInvokeImageIdsForRoot('D:/Invoke');

        expect(ids).toEqual(['D:/Invoke/outputs/images/old.png']);
        expect(db.select).toHaveBeenCalledWith(
            expect.stringContaining("instr(substr(id, ?), '/') = 0"),
            ['D:/Invoke/outputs/images/%', 'D:/Invoke/outputs/images/'.length + 1]
        );
    });

    it('chunks multi-image library removal so large selections do not exceed sqlite parameter limits', async () => {
        const ids = Array.from({ length: 1001 }, (_, index) => `C:/images/${index}.png`);
        const imageRowsById = new Map(ids.map((id, index) => [id, {
            id,
            path: id,
            width: 512,
            height: 512,
            file_size: 1024 + index,
            timestamp: 1700000000000 + index,
            metadata_json: JSON.stringify({ model: 'test', tool: 'ComfyUI' }),
            thumbnail_path: `C:/thumbs/${index}.webp`,
            micro_thumbnail: null,
            thumbnail_source: 'ambit',
            is_favorite: 0,
            is_pinned: 0,
            is_missing: 0,
            user_masked: null,
            group_id: null,
            board_id: null,
            notes: null,
            original_metadata_json: null,
            original_parsed_json: null,
            original_state_json: null,
            is_corrupt: 0,
        }]));
        const membershipRowsById = new Map(ids.map(id => [id, [{ image_id: id, collection_id: 'collection-a' }]]));
        const removedRows = new Map<string, { id: string; collectionIdsJson: string | null }>();
        const deletedImageIds = new Set<string>();

        const enforceParamLimit = (params: unknown[] = []) => {
            if (params.length > 900) {
                throw new Error(`too many SQL variables: ${params.length}`);
            }
        };

        const db = {
            select: vi.fn(async (sql: string, params: string[] = []) => {
                enforceParamLimit(params);
                if (sql.includes('FROM images')) {
                    return params.map(id => imageRowsById.get(id)).filter(Boolean);
                }
                if (sql.includes('FROM collection_images')) {
                    return params.flatMap(id => membershipRowsById.get(id) ?? []);
                }
                return [];
            }),
            execute: vi.fn(async (sql: string, params: unknown[] = []) => {
                enforceParamLimit(params);

                if (sql.includes('INSERT OR REPLACE INTO removed_images')) {
                    removedRows.set(params[0] as string, {
                        id: params[0] as string,
                        collectionIdsJson: (params[22] as string | null) ?? null,
                    });
                    return;
                }

                if (sql.startsWith('DELETE FROM images WHERE id IN')) {
                    for (const id of params as string[]) {
                        deletedImageIds.add(id);
                    }
                }
            }),
        };

        getDbMock.mockResolvedValue(db);

        const { removeImagesFromLibrary } = await import('../imageRepo');

        await expect(removeImagesFromLibrary(ids)).resolves.toBeUndefined();

        expect(dispatchMock).toHaveBeenCalledTimes(1);
        expect(removedRows.size).toBe(ids.length);
        expect(deletedImageIds.size).toBe(ids.length);
        expect(db.select).toHaveBeenCalled();
        expect(db.execute).toHaveBeenCalled();

        const allSelectParamCounts = db.select.mock.calls.map(([, params]) => (params as unknown[] | undefined)?.length ?? 0);
        const allExecuteParamCounts = db.execute.mock.calls.map(([, params]) => (params as unknown[] | undefined)?.length ?? 0);
        expect(Math.max(...allSelectParamCounts)).toBeLessThanOrEqual(900);
        expect(Math.max(...allExecuteParamCounts)).toBeLessThanOrEqual(900);
        expect(removedRows.get(ids[0])?.collectionIdsJson).toBe(JSON.stringify(['collection-a']));
    });

    it('skips thumbnail trashing when the thumbnail path is the source image path', async () => {
        const db = {
            select: vi.fn(),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);

        const { commands } = await import('../../../bindings');
        vi.mocked(commands.moveToTrash).mockResolvedValue({ status: 'ok', data: null });
        vi.mocked(commands.deleteThumbnail).mockResolvedValue({ status: 'ok', data: null });

        const { deleteImageFromDisk, shouldTrashThumbnail } = await import('../imageRepo');

        expect(shouldTrashThumbnail('C:/images/source.png', 'C:\\images\\source.png')).toBe(false);
        expect(shouldTrashThumbnail('C:/images/source.png', 'C:/thumbs/source.webp')).toBe(true);
        expect(shouldTrashThumbnail('C:/images/source.png', null)).toBe(false);
        expect(shouldTrashThumbnail(null, 'C:/thumbs/source.webp')).toBe(true);

        await deleteImageFromDisk('C:/images/source.png', 'C:/images/source.png', 'C:\\images\\source.png');

        expect(commands.moveToTrash).toHaveBeenCalledWith('C:/images/source.png');
        expect(commands.deleteThumbnail).not.toHaveBeenCalled();
        expect(db.execute).toHaveBeenCalledWith('DELETE FROM images WHERE id = $1', ['C:/images/source.png']);
    });

    it('inserts a single image and syncs its board membership', async () => {
        const db = {
            select: vi.fn(async () => []),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);
        const { commands } = await import('../../../bindings');
        vi.mocked(commands.saveImagesBatch).mockResolvedValue({ status: 'ok', data: 1 });

        const { insertImage } = await import('../imageRepo');
        await insertImage({
            id: 'C:\\images\\boarded.png',
            url: 'C:\\images\\boarded.png',
            thumbnailUrl: 'asset://C:/thumbs/boarded.webp',
            filename: 'boarded.png',
            width: 640,
            height: 480,
            timestamp: 1700000000000,
            metadata: liveImportMetadata,
            isFavorite: true,
            boardId: 'board-a',
        });

        expect(commands.saveImagesBatch).toHaveBeenCalledWith([
            expect.objectContaining({
                id: 'C:/images/boarded.png',
                path: 'C:/images/boarded.png',
                thumbnailPath: 'C:/thumbs/boarded.webp',
                isFavorite: true,
                boardId: 'board-a',
            }),
        ]);
        expect(db.execute).toHaveBeenCalledWith(
            'INSERT OR IGNORE INTO collection_images (collection_id, image_id) VALUES (?, ?)',
            ['board-a', 'C:/images/boarded.png']
        );
    });

    it('skips path identity moves that are empty or normalize to the same path', async () => {
        const { commands } = await import('../../../bindings');
        const { moveImagePathIdentities } = await import('../imageRepo');

        await expect(moveImagePathIdentities([])).resolves.toEqual({
            moved: 0,
            skippedTargetExists: 0,
            skippedSourceMissing: 0,
        });
        await expect(moveImagePathIdentities([{
            oldId: 'C:/images/same.png',
            newId: 'C:\\images\\same.png',
        }])).resolves.toEqual({
            moved: 0,
            skippedTargetExists: 0,
            skippedSourceMissing: 0,
        });

        expect(commands.moveImagePathIdentities).not.toHaveBeenCalled();
    });

    it('normalizes facet type aliases before invoking incremental cache rebuilds', async () => {
        invokeMock.mockResolvedValue(7);

        const { rebuildFacetCacheIncrementalBatchStrict } = await import('../imageRepo');
        await expect(rebuildFacetCacheIncrementalBatchStrict([
            'ip_adapters',
            'control_nets',
            'bogus',
            'loras',
        ])).resolves.toBe(7);

        expect(invokeMock).toHaveBeenCalledWith('rebuild_facet_cache_incremental_batch', {
            facetTypes: ['loras', 'controlNets', 'ipAdapters'],
        });
    });

    it('does not invoke incremental cache rebuilds when all requested facet types are invalid', async () => {
        const { rebuildFacetCacheIncrementalBatchStrict } = await import('../imageRepo');

        await expect(rebuildFacetCacheIncrementalBatchStrict(['bogus'])).resolves.toBe(0);

        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('syncs only requested image ids into board collection memberships', async () => {
        const db = {
            select: vi.fn(async () => []),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);

        const { syncCollectionImages } = await import('../imageRepo');
        await syncCollectionImages(['C:/images/a.png', 'C:/images/b.png']);

        expect(db.execute).toHaveBeenCalledWith(
            expect.stringContaining('AND id IN (?,?)'),
            ['C:/images/a.png', 'C:/images/b.png']
        );
        expect(db.select).toHaveBeenCalledWith(
            expect.stringContaining('FROM collection_images'),
            ['C:/images/a.png', 'C:/images/b.png']
        );
    });

    it('syncs all board-linked images when no id filter is supplied', async () => {
        const db = {
            select: vi.fn(async () => []),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);

        const { syncCollectionImages } = await import('../imageRepo');
        await syncCollectionImages();

        expect(db.execute).toHaveBeenCalledWith(
            expect.not.stringContaining('AND id IN'),
            []
        );
        expect(db.select).not.toHaveBeenCalled();
    });

    it('serializes array metadata updates and keeps denormalized columns synchronized', async () => {
        const db = {
            select: vi.fn(),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);

        const { updateImageMetadataFields } = await import('../imageRepo');
        await updateImageMetadataFields('C:/images/meta.png', {
            loras: ['detail'],
            tool: GeneratorTool.COMFYUI,
            positivePrompt: 'prompt',
            negative_prompt: '',
            model: 'Checkpoint',
        });

        const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain("json_set(metadata_json, '$.loras', json(?))");
        expect(sql).toContain(', tool = ?');
        expect(sql).toContain(', positive_prompt = ?');
        expect(sql).toContain(', negative_prompt = ?');
        expect(sql).toContain(', resolved_model_name = ?');
        expect(params).toEqual([
            JSON.stringify(['detail']),
            GeneratorTool.COMFYUI,
            'prompt',
            '',
            'Checkpoint',
            GeneratorTool.COMFYUI,
            'prompt',
            null,
            'Checkpoint',
            'C:/images/meta.png',
        ]);
    });

    it('clears metadata overrides when no original parsed metadata is available', async () => {
        const db = {
            select: vi.fn(async () => [{ original_parsed_json: null }]),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);

        const { revertImageMetadata } = await import('../imageRepo');
        await revertImageMetadata('C:/images/no-original.png');

        expect(db.execute).toHaveBeenCalledWith(
            expect.stringContaining('SET metadata_json = NULL'),
            ['C:/images/no-original.png']
        );
    });

    it('updates workflow JSON while preserving existing metadata fields', async () => {
        const db = {
            select: vi.fn(async () => [{ metadata_json: JSON.stringify({ model: 'Checkpoint' }) }]),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);

        const { updateImageWorkflow, updateImageWorkflowHint } = await import('../imageRepo');
        await updateImageWorkflow('C:/images/workflow.png', '{"nodes":[]}');
        await updateImageWorkflowHint('C:/images/workflow.png', false);

        const firstMetadata = JSON.parse((db.execute.mock.calls[0] as [string, unknown[]])[1][0] as string);
        const secondMetadata = JSON.parse((db.execute.mock.calls[1] as [string, unknown[]])[1][0] as string);
        expect(firstMetadata).toEqual({
            model: 'Checkpoint',
            workflowJson: '{"nodes":[]}',
            hasWorkflowHint: true,
        });
        expect(secondMetadata).toEqual({
            model: 'Checkpoint',
            hasWorkflowHint: false,
        });
    });

    it('skips workflow edits when the image is missing or metadata JSON is malformed', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const db = {
            select: vi.fn()
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{ metadata_json: '{bad json' }])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{ metadata_json: '{bad json' }]),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);

        const { updateImageWorkflow, updateImageWorkflowHint } = await import('../imageRepo');
        await updateImageWorkflow('C:/images/missing-workflow.png', '{"nodes":[]}');
        await updateImageWorkflow('C:/images/bad-workflow.png', '{"nodes":[]}');
        await updateImageWorkflowHint('C:/images/missing-hint.png', true);
        await updateImageWorkflowHint('C:/images/bad-hint.png', false);

        expect(db.execute).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
            '[DB] Failed to update workflow for image',
            'C:/images/bad-workflow.png',
            expect.any(SyntaxError)
        );
        expect(console.error).toHaveBeenCalledWith(
            '[DB] Failed to update workflow hint for image',
            'C:/images/bad-hint.png',
            expect.any(SyntaxError)
        );
    });

    it('retries thumbnail path updates once when SQLite is briefly locked', async () => {
        const db = {
            select: vi.fn(async () => []),
            execute: vi.fn()
                .mockRejectedValueOnce(new Error('database is locked'))
                .mockResolvedValue(undefined),
        };
        getDbMock.mockResolvedValue(db);

        const { updateThumbnailPathsBatch } = await import('../imageRepo');
        await updateThumbnailPathsBatch([{
            id: 'C:/images/thumb.png',
            thumbnailPath: 'C:/thumbs/thumb.webp',
            microThumbnail: 'data:image/webp;base64,abc',
            thumbnailSource: 'ambit',
        }]);

        expect(db.execute).toHaveBeenCalledTimes(2);
        expect(db.execute).toHaveBeenLastCalledWith(
            expect.stringContaining('UPDATE images'),
            [
                'C:/thumbs/thumb.webp',
                'data:image/webp;base64,abc',
                'ambit',
                'ambit',
                'ambit',
                'ambit',
                'ambit',
                'C:/images/thumb.png',
            ]
        );
    });

    it('handles empty and partially failing thumbnail path batches without throwing', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const db = {
            select: vi.fn(async () => []),
            execute: vi.fn()
                .mockRejectedValueOnce(new Error('disk full'))
                .mockResolvedValue(undefined),
        };
        getDbMock.mockResolvedValue(db);

        const { updateThumbnailPathsBatch } = await import('../imageRepo');
        await updateThumbnailPathsBatch([]);
        expect(getDbMock).not.toHaveBeenCalled();

        await updateThumbnailPathsBatch([
            {
                id: 'C:/images/fail.png',
                thumbnailPath: 'C:/thumbs/fail.webp',
                microThumbnail: null,
                thumbnailSource: 'ambit',
            },
            {
                id: 'C:/images/external.png',
                thumbnailPath: 'C:/thumbs/external.webp',
                thumbnailSource: 'external',
            },
        ]);

        expect(db.execute).toHaveBeenCalledTimes(2);
        expect(db.execute).toHaveBeenLastCalledWith(
            expect.stringContaining('UPDATE images'),
            [
                'C:/thumbs/external.webp',
                null,
                'external',
                'external',
                'external',
                'external',
                'external',
                'C:/images/external.png',
            ]
        );
        expect(console.warn).toHaveBeenCalledWith(
            '[DB] Thumbnail update failed for C:/images/fail.png:',
            'disk full'
        );
        expect(console.warn).toHaveBeenCalledWith('[DB] 1 thumbnail updates failed');
    });

    it('wraps full and incremental facet rebuild failures for non-strict callers', async () => {
        const { commands } = await import('../../../bindings');
        const {
            rebuildFacetCache,
            rebuildFacetCacheStrict,
            rebuildFacetCacheIncremental,
            rebuildFacetCacheIncrementalBatch,
            refreshFacetCacheForResourcesStrict,
            rebuildThumbnailFacetCache,
        } = await import('../imageRepo');

        vi.mocked(commands.rebuildFacetCache).mockResolvedValueOnce({ status: 'ok', data: 5 });
        await expect(rebuildFacetCache()).resolves.toBe(5);
        await expect(rebuildFacetCacheStrict()).rejects.toThrow();

        invokeMock
            .mockResolvedValueOnce(3)
            .mockRejectedValueOnce(new Error('incremental failed'))
            .mockResolvedValueOnce(2)
            .mockResolvedValueOnce(6);

        await expect(rebuildFacetCacheIncremental('control_nets')).resolves.toBe(3);
        await expect(rebuildFacetCacheIncrementalBatch(['loras'])).resolves.toBe(0);
        await expect(refreshFacetCacheForResourcesStrict({
            checkpoints: ['Model'],
            loras: [],
            embeddings: [],
            hypernetworks: [],
            controlNets: [],
            ipAdapters: [],
            tools: [],
        })).resolves.toBe(2);
        await expect(rebuildThumbnailFacetCache()).resolves.toBeUndefined();

        expect(invokeMock).toHaveBeenCalledWith('rebuild_facet_cache_incremental_batch', {
            facetTypes: ['controlNets'],
        });
        expect(invokeMock).toHaveBeenCalledWith('refresh_facet_cache_for_resources', {
            touches: {
                checkpoints: ['Model'],
                loras: [],
                embeddings: [],
                hypernetworks: [],
                controlNets: [],
                ipAdapters: [],
                tools: [],
            },
        });
    });

    it('updates simple image flags through their narrow SQL helpers', async () => {
        const db = {
            select: vi.fn(async (sql: string) => {
                const normalizedSql = sql.toLowerCase();
                if (normalizedSql.includes('count(*) as count')) return [{ count: 0 }];
                if (normalizedSql.includes('select 1 from images where ifnull(is_intermediate_gen')) return [{ 1: 1 }];
                if (normalizedSql.includes('select 1 from images where ifnull(is_grid_gen')) return [];
                if (sql.includes('FROM images')) {
                    return [{ id: 'C:/images/a.png', metadata_json: JSON.stringify(liveImportMetadata), timestamp: 1 }];
                }
                return [];
            }),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);

        const {
            updateImageNotesCol,
            isImageNew,
            getAllImages,
            toggleImagePin,
            toggleImageFavorite,
            toggleImageMask,
            toggleImageIntermediate,
            deleteImage,
            markAsDeleted,
            updateFavorite,
            updatePinned,
            updateImagesBoard,
            checkHiddenContentAvailability,
            updateThumbnailPath,
        } = await import('../imageRepo');

        await updateImageNotesCol('C:/images/note.png', 'note');
        await expect(isImageNew('C:/images/new.png')).resolves.toBe(true);
        await expect(getAllImages(10, 5, true, true, false)).resolves.toHaveLength(1);
        await toggleImagePin('C:/images/pin.png', true);
        await toggleImageFavorite('C:/images/fav.png', false);
        await toggleImageMask('C:/images/mask.png', null);
        await toggleImageIntermediate('C:/images/intermediate.png', true);
        await deleteImage('C:/images/delete.png');
        await markAsDeleted(['C:/images/deleted.png'], true);
        await updateFavorite('C:/images/update-fav.png', true);
        await updatePinned('C:/images/update-pin.png', false);
        await updateImagesBoard(['C:/images/board.png'], 'board-a');
        await updateImagesBoard([], 'board-a');
        await expect(checkHiddenContentAvailability()).resolves.toEqual({
            hasIntermediates: true,
            hasGrids: false,
        });
        await updateThumbnailPath('C:/images/thumb.png', 'C:/thumbs/thumb.webp');

        const sqlCalls = db.execute.mock.calls.map(([sql]) => String(sql));
        expect(sqlCalls).toContain('UPDATE images SET notes = ? WHERE id = ?');
        expect(sqlCalls).toContain('UPDATE images SET is_pinned = $1 WHERE id = $2');
        expect(sqlCalls).toContain('UPDATE images SET is_favorite = $1 WHERE id = $2');
        expect(sqlCalls).toContain('UPDATE images SET user_masked = $1 WHERE id = $2');
        expect(sqlCalls).toContain("UPDATE images SET metadata_json = json_set(metadata_json, '$.isIntermediate', $1) WHERE id = $2");
        expect(sqlCalls).toContain('DELETE FROM images WHERE id = $1');
        expect(sqlCalls).toContain('UPDATE images SET is_deleted = ? WHERE id IN (?)');
        expect(sqlCalls).toContain('UPDATE images SET is_favorite = ? WHERE id = ?');
        expect(sqlCalls).toContain('UPDATE images SET is_pinned = ? WHERE id = ?');
        expect(sqlCalls).toContain('INSERT OR IGNORE INTO collection_images (collection_id, image_id) VALUES (?, ?)');
        expect(sqlCalls).toContain('UPDATE images SET thumbnail_path = ?, thumbnail_source = ?, thumbnail_version = 1, thumbnail_failure_count = 0, thumbnail_last_error = NULL, thumbnail_last_attempt_at = NULL WHERE id = ?');
    });

    it('returns without touching metadata when revert has no source row', async () => {
        const db = {
            select: vi.fn(async () => []),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);

        const { revertImageMetadata } = await import('../imageRepo');
        await revertImageMetadata('C:/images/missing-original.png');

        expect(db.execute).not.toHaveBeenCalled();
    });

    it('recovers high-fidelity A1111 metadata only for viewer reads that need it', async () => {
        const db = {
            select: vi.fn(async () => [{
                id: 'C:/images/a1111.png',
                path: 'C:/images/a1111.png',
                width: 512,
                height: 512,
                file_size: 1024,
                timestamp: 1700000000000,
                metadata_json: JSON.stringify({
                    ...liveImportMetadata,
                    tool: GeneratorTool.AUTOMATIC1111,
                    rawParameters: undefined,
                }),
                thumbnail_path: null,
                micro_thumbnail: null,
                thumbnail_source: null,
                is_favorite: 0,
                is_pinned: 0,
                is_deleted: 0,
                is_missing: 0,
                is_corrupt: 0,
                user_masked: null,
                group_id: null,
                board_id: null,
                notes: null,
                original_metadata_json: null,
                original_parsed_json: null,
                original_state_json: null,
            }]),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);
        scanImageNativeMock.mockResolvedValueOnce({
            metadata: {
                rawParameters: 'prompt\nSteps: 20',
                positivePrompt: 'rescanned prompt',
            },
        });

        const { getImageWithFullMetadata } = await import('../imageRepo');
        const image = await getImageWithFullMetadata('C:/images/a1111.png');

        expect(image?.metadata.rawParameters).toBe('prompt\nSteps: 20');
        expect(image?.metadata.positivePrompt).toBe('rescanned prompt');
        expect(scanImageNativeMock).toHaveBeenCalledWith('C:/images/a1111.png', '', true, true);
        expect(db.execute).not.toHaveBeenCalled();
    });

    it('returns null for missing full-metadata reads and maps removed image lookups in chunks', async () => {
        const ids = Array.from({ length: 901 }, (_, index) => `C:/removed/${index}.png`);
        const db = {
            select: vi.fn()
                .mockResolvedValueOnce([])
                .mockImplementation(async (_sql: string, params: string[]) => params.map(id => ({
                    id,
                    path: id,
                    width: 128,
                    height: 128,
                    file_size: 256,
                    timestamp: 1700000000000,
                    metadata_json: JSON.stringify(liveImportMetadata),
                    thumbnail_path: null,
                    micro_thumbnail: null,
                    thumbnail_source: null,
                    is_favorite: 0,
                    is_pinned: 0,
                    is_deleted: 0,
                    is_missing: 0,
                    is_corrupt: 0,
                    user_masked: null,
                    group_id: null,
                    board_id: null,
                    notes: null,
                    original_metadata_json: null,
                    original_parsed_json: null,
                    original_state_json: null,
                }))),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);

        const { getImageWithFullMetadata, getRemovedImagesByIds } = await import('../imageRepo');
        await expect(getImageWithFullMetadata('C:/missing.png')).resolves.toBeNull();
        const removed = await getRemovedImagesByIds(ids);

        expect(removed).toHaveLength(901);
        expect(db.select).toHaveBeenCalledTimes(3);
        expect((db.select.mock.calls[1][1] as string[])).toHaveLength(900);
        expect((db.select.mock.calls[2][1] as string[])).toHaveLength(1);
    });

    it('restores removed images and valid collection memberships before removing tombstones', async () => {
        const db = {
            select: vi.fn(async () => [{
                id: 'C:/removed/restore.png',
                path: 'C:/removed/restore.png',
                width: 128,
                height: 128,
                file_size: 256,
                timestamp: 1700000000000,
                metadata_json: JSON.stringify(liveImportMetadata),
                thumbnail_path: null,
                micro_thumbnail: null,
                thumbnail_source: null,
                is_favorite: 0,
                is_pinned: 0,
                is_deleted: 0,
                is_missing: 0,
                is_corrupt: 0,
                user_masked: null,
                group_id: null,
                board_id: null,
                notes: null,
                original_metadata_json: null,
                original_parsed_json: null,
                original_state_json: null,
                collection_ids_json: JSON.stringify(['collection-a', 'collection-b']),
            }]),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);
        const { commands } = await import('../../../bindings');
        vi.mocked(commands.saveImagesBatch).mockResolvedValue({ status: 'ok', data: 1 });

        const { restoreRemovedImages } = await import('../imageRepo');
        await restoreRemovedImages(['C:/removed/restore.png']);

        expect(commands.saveImagesBatch).toHaveBeenCalledTimes(1);
        expect(db.execute).toHaveBeenCalledWith(
            expect.stringContaining('INSERT OR IGNORE INTO collection_images'),
            ['collection-a', 'C:/removed/restore.png', 'collection-a']
        );
        expect(db.execute).toHaveBeenCalledWith(
            expect.stringContaining('DELETE FROM removed_images WHERE id IN (?)'),
            ['C:/removed/restore.png']
        );
    });

    it('reports deleted, missing, and thumbnail-warning ids when permanently deleting tombstones', async () => {
        const db = {
            select: vi.fn(async () => [
                {
                    id: 'C:/removed/ok.png',
                    path: 'C:/removed/ok.png',
                    thumbnail_path: 'C:/thumbs/ok.webp',
                },
                {
                    id: 'C:/removed/source-thumb.png',
                    path: 'C:/removed/source-thumb.png',
                    thumbnail_path: 'C:/removed/source-thumb.png',
                },
                {
                    id: 'C:/removed/fail.png',
                    path: 'C:/removed/fail.png',
                    thumbnail_path: null,
                },
            ]),
            execute: vi.fn(),
        };
        getDbMock.mockResolvedValue(db);
        const { commands } = await import('../../../bindings');
        vi.mocked(commands.moveToTrash)
            .mockResolvedValueOnce({ status: 'ok', data: null })
            .mockResolvedValueOnce({ status: 'ok', data: null })
            .mockResolvedValueOnce({ status: 'error', error: 'trash failed' });
        vi.mocked(commands.deleteThumbnail)
            .mockResolvedValueOnce({ status: 'error', error: 'thumbnail failed' });

        const { deleteRemovedImagesFromDisk, deleteRemovedImageFromDisk } = await import('../imageRepo');
        await expect(deleteRemovedImagesFromDisk([])).resolves.toEqual({
            deletedIds: [],
            failedIds: [],
            thumbnailWarningIds: [],
        });

        const result = await deleteRemovedImagesFromDisk([
            'C:/removed/ok.png',
            'C:/removed/source-thumb.png',
            'C:/removed/fail.png',
            'C:/removed/missing.png',
        ]);

        expect(result).toEqual({
            deletedIds: ['C:/removed/ok.png', 'C:/removed/source-thumb.png'],
            failedIds: ['C:/removed/fail.png', 'C:/removed/missing.png'],
            thumbnailWarningIds: ['C:/removed/ok.png'],
        });
        expect(commands.deleteThumbnail).toHaveBeenCalledTimes(1);
        expect(db.execute).toHaveBeenCalledWith(
            expect.stringContaining('DELETE FROM removed_images WHERE id IN (?,?)'),
            ['C:/removed/ok.png', 'C:/removed/source-thumb.png']
        );

        db.select.mockResolvedValueOnce([]);
        await expect(deleteRemovedImageFromDisk('C:/removed/absent.png')).resolves.toEqual({
            deletedIds: [],
            failedIds: ['C:/removed/absent.png'],
            thumbnailWarningIds: [],
        });
    });

    it('clears all thumbnail paths with retry and updates collection thumbnail caches only after changes', async () => {
        const db = {
            select: vi.fn(),
            execute: vi.fn()
                .mockRejectedValueOnce(new Error('database is locked'))
                .mockResolvedValueOnce({ rowsAffected: 4 }),
        };
        getDbMock.mockResolvedValue(db);

        const { clearAllThumbnailPaths } = await import('../imageRepo');
        await expect(clearAllThumbnailPaths()).resolves.toBe(4);

        expect(db.execute).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE images SET thumbnail_path = NULL')
        );
    });

    it('does not clear collection caches when no thumbnail paths changed and surfaces non-lock failures', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const db = {
            select: vi.fn(),
            execute: vi.fn()
                .mockResolvedValueOnce({ rowsAffected: 0 })
                .mockRejectedValueOnce(new Error('disk full')),
        };
        getDbMock.mockResolvedValue(db);

        const { clearAllThumbnailPaths } = await import('../imageRepo');
        await expect(clearAllThumbnailPaths()).resolves.toBe(0);
        await expect(clearAllThumbnailPaths()).rejects.toThrow('disk full');

        expect(console.error).toHaveBeenCalledWith(
            '[DB] Failed to clear thumbnails',
            expect.any(Error)
        );
    });

    it('handles empty batches and delegates normalized path identity moves', async () => {
        const { commands } = await import('../../../bindings');
        vi.mocked(commands.moveImagePathIdentities).mockResolvedValue({
            status: 'ok',
            data: { moved: 1, skippedTargetExists: 0, skippedSourceMissing: 0 }
        });
        const {
            insertImagesBatch,
            moveImagePathIdentities,
            moveImagePathIdentity,
            getRemovedImagesByIds,
            removeImagesFromLibrary,
            restoreRemovedImages,
            markAsDeleted
        } = await import('../imageRepo');

        await insertImagesBatch([]);
        await expect(moveImagePathIdentities([])).resolves.toEqual({ moved: 0, skippedTargetExists: 0, skippedSourceMissing: 0 });
        await expect(moveImagePathIdentity('C:\\old.png', 'C:\\new.png', 'C:\\thumb.webp', 'source')).resolves.toBe(true);
        await expect(getRemovedImagesByIds([])).resolves.toEqual([]);
        await removeImagesFromLibrary([]);
        await restoreRemovedImages([]);
        await markAsDeleted([], true);

        expect(commands.moveImagePathIdentities).toHaveBeenCalledWith([{
            oldId: 'C:/old.png',
            newId: 'C:/new.png',
            thumbnailPath: 'C:/thumb.webp',
            thumbnailSource: 'source'
        }]);
        expect(getDbMock).not.toHaveBeenCalled();
    });

    it('covers strict facet rebuild success and non-strict rebuild failures', async () => {
        const { commands } = await import('../../../bindings');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(commands.rebuildFacetCache)
            .mockResolvedValueOnce({ status: 'error', error: 'full failed' })
            .mockResolvedValueOnce({ status: 'ok', data: 7 });
        invokeMock.mockRejectedValueOnce(new Error('incremental failed'));
        const { rebuildFacetCache, rebuildFacetCacheStrict, rebuildFacetCacheIncremental } = await import('../imageRepo');

        await expect(rebuildFacetCache()).resolves.toBe(0);
        await expect(rebuildFacetCacheStrict()).resolves.toBe(7);
        await expect(rebuildFacetCacheIncremental('loras')).resolves.toBe(0);
        expect(console.error).toHaveBeenCalledTimes(2);
    });

    it('covers override-model updates, malformed reverts, visibility filters, and deep-scan failures', async () => {
        const a1111Row = {
            id: 'C:/images/a1111.png', path: 'C:/images/a1111.png', width: 1, height: 1,
            file_size: 1, timestamp: 1,
            metadata_json: JSON.stringify({ ...liveImportMetadata, tool: GeneratorTool.AUTOMATIC1111 }),
            thumbnail_path: null, micro_thumbnail: null, thumbnail_source: null,
            is_favorite: 0, is_pinned: 0, is_deleted: 0, is_missing: 0, is_corrupt: 0,
            user_masked: null, group_id: null, board_id: null, notes: null,
            original_metadata_json: null, original_parsed_json: null, original_state_json: null
        };
        const db = {
            select: vi.fn()
                .mockResolvedValueOnce([{ original_parsed_json: '{bad' }])
                .mockResolvedValueOnce([a1111Row])
                .mockResolvedValueOnce([a1111Row]),
            execute: vi.fn()
        };
        getDbMock.mockResolvedValue(db);
        scanImageNativeMock.mockRejectedValue(new Error('scan failed'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { updateImageMetadataFields, revertImageMetadata, getAllImages, getImageWithFullMetadata } = await import('../imageRepo');

        await updateImageMetadataFields('C:/images/a.png', { overrideModel: 'override' });
        await revertImageMetadata('C:/images/a.png');
        await expect(getAllImages(undefined, 0, false, false, false)).resolves.toHaveLength(1);
        await expect(getImageWithFullMetadata('C:/images/a1111.png')).resolves.toBeTruthy();

        expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('resolved_model_name = ?'), ['override', 'override', 'C:/images/a.png']);
        expect(db.execute).toHaveBeenCalledWith(
            'UPDATE images SET metadata_json = NULL, seed = NULL, positive_prompt = NULL, negative_prompt = NULL WHERE id = ?',
            ['C:/images/a.png']
        );
        expect(db.select.mock.calls[1][0]).toContain('IFNULL(is_intermediate_gen, 0) = 0');
        expect(db.select.mock.calls[1][0]).toContain('IFNULL(is_grid_gen, 0) = 0');
        expect(console.error).toHaveBeenCalledWith('Failed deep scan for', 'C:/images/a1111.png', expect.any(Error));
    });

    it('persists both explicit mask values', async () => {
        const db = { select: vi.fn(), execute: vi.fn() };
        getDbMock.mockResolvedValue(db);
        const { toggleImageMask } = await import('../imageRepo');
        await toggleImageMask('C:/true.png', true);
        await toggleImageMask('C:/false.png', false);
        expect(db.execute).toHaveBeenNthCalledWith(1, 'UPDATE images SET user_masked = $1 WHERE id = $2', [1, 'C:/true.png']);
        expect(db.execute).toHaveBeenNthCalledWith(2, 'UPDATE images SET user_masked = $1 WHERE id = $2', [0, 'C:/false.png']);
    });

    it('returns cleanly when removal or restoration rows are absent and skips empty membership payloads', async () => {
        const removedRow = {
            id: 'C:/removed/a.png', path: 'C:/removed/a.png', width: 1, height: 1, file_size: 1, timestamp: 1,
            metadata_json: JSON.stringify(liveImportMetadata), thumbnail_path: null, micro_thumbnail: null,
            thumbnail_source: null, is_favorite: 0, is_pinned: 0, is_deleted: 1, is_missing: 0,
            is_corrupt: 0, user_masked: null, group_id: null, board_id: null, notes: null,
            original_metadata_json: null, original_parsed_json: null, original_state_json: null,
            collection_ids_json: null
        };
        const restoreRows = [[], [removedRow], [{ ...removedRow, collection_ids_json: '{bad' }]];
        const db = {
            select: vi.fn(async (sql: string) => {
                if (!sql.includes('FROM removed_images')) return [];
                return restoreRows.shift() ?? [];
            }),
            execute: vi.fn()
        };
        getDbMock.mockResolvedValue(db);
        const { commands } = await import('../../../bindings');
        vi.mocked(commands.saveImagesBatch).mockResolvedValue({ status: 'ok', data: 1 });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { removeImagesFromLibrary, restoreRemovedImages } = await import('../imageRepo');

        await removeImagesFromLibrary(['C:/missing.png']);
        await restoreRemovedImages(['C:/missing.png']);
        await restoreRemovedImages(['C:/removed/a.png']);
        await restoreRemovedImages(['C:/removed/bad.png']);
        expect(console.warn).toHaveBeenCalledWith(
            '[DB] Failed to restore collection membership for removed image',
            'C:/removed/a.png',
            expect.any(Error)
        );
    });

    it('logs source and thumbnail trash failures while still deleting the database row', async () => {
        const db = { select: vi.fn(), execute: vi.fn() };
        getDbMock.mockResolvedValue(db);
        const { commands } = await import('../../../bindings');
        vi.mocked(commands.moveToTrash).mockResolvedValue({ status: 'error', error: 'trash failed' });
        vi.mocked(commands.deleteThumbnail).mockResolvedValue({ status: 'error', error: 'thumb failed' });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { deleteImageFromDisk } = await import('../imageRepo');

        await deleteImageFromDisk('C:/image.png', 'C:/image.png', 'C:/thumb.webp');
        expect(console.error).toHaveBeenCalledWith('[Repo] Failed to move file to trash:', 'C:/image.png', 'trash failed');
        expect(console.warn).toHaveBeenCalledWith('[Repo] Failed to trash thumbnail:', 'C:/thumb.webp', 'thumb failed');
        expect(db.execute).toHaveBeenCalledWith('DELETE FROM images WHERE id = $1', ['C:/image.png']);
    });

    it('persists minimal images and browser path moves using default record values', async () => {
        const db = { select: vi.fn(), execute: vi.fn() };
        getDbMock.mockResolvedValue(db);
        const { commands } = await import('../../../bindings');
        vi.mocked(commands.saveImagesBatch).mockResolvedValue({ status: 'ok', data: 1 });
        const { insertImage, moveImagePathIdentities } = await import('../imageRepo');
        const minimal = {
            id: 'C:/minimal.png', url: 'C:/minimal.png', thumbnailUrl: '', filename: 'minimal.png',
            width: 1, height: 1, timestamp: 1, metadata: liveImportMetadata, isFavorite: false
        } as AIImage;
        await insertImage(minimal);
        const record = vi.mocked(commands.saveImagesBatch).mock.calls[0][0][0];
        expect(record).toMatchObject({
            fileSize: 0, fileHash: null, thumbnailPath: '', microThumbnail: null,
            thumbnailSource: null, isPinned: false, isDeleted: false, isMissing: false,
            userMasked: null, groupId: null, boardId: null, notes: null,
            originalMetadataJson: null, originalStateJson: null, isCorrupt: false
        });
        expect(db.execute).not.toHaveBeenCalled();

        browserMockModeMock.mockReturnValue(true);
        getBrowserMockImagesMock.mockReturnValue([minimal]);
        await expect(moveImagePathIdentities([{ oldId: minimal.id, newId: 'C:/moved.png' }])).resolves.toMatchObject({ moved: 1 });
        expect(updateBrowserMockImageMock).toHaveBeenCalledWith(minimal.id, expect.objectContaining({
            thumbnailUrl: 'C:/moved.png', thumbnailSource: undefined
        }));
    });

    it('covers opposite boolean writes, default reads, empty workflow JSON, and board removal', async () => {
        const row = {
            id: 'C:/a.png', path: 'C:/a.png', width: 1, height: 1, file_size: 1, timestamp: 1,
            metadata_json: null, thumbnail_path: null, micro_thumbnail: null, thumbnail_source: null,
            is_favorite: 0, is_pinned: 0, is_deleted: 0, is_missing: 0, is_corrupt: 0,
            user_masked: null, group_id: null, board_id: null, notes: null,
            original_metadata_json: null, original_parsed_json: null, original_state_json: null
        };
        const db = {
            select: vi.fn(async (sql: string) => sql.includes('SELECT metadata_json') ? [{ metadata_json: null }] : [row]),
            execute: vi.fn()
        };
        getDbMock.mockResolvedValue(db);
        const {
            getAllImages, toggleImagePin, toggleImageFavorite, toggleImageIntermediate,
            markAsDeleted, updateFavorite, updatePinned, updateImageWorkflow,
            updateImageWorkflowHint, updateImagesBoard
        } = await import('../imageRepo');

        await expect(getAllImages()).resolves.toHaveLength(1);
        await toggleImagePin('C:/a.png', false);
        await toggleImageFavorite('C:/a.png', true);
        await toggleImageIntermediate('C:/a.png', false);
        await markAsDeleted(['C:/a.png'], false);
        await updateFavorite('C:/a.png', false);
        await updatePinned('C:/a.png', true);
        await updateImageWorkflow('C:/a.png', '{}');
        await updateImageWorkflowHint('C:/a.png', false);
        await updateImagesBoard(['C:/a.png'], null);

        expect(db.execute).toHaveBeenCalledWith('UPDATE images SET is_pinned = $1 WHERE id = $2', [0, 'C:/a.png']);
        expect(db.execute).toHaveBeenCalledWith('UPDATE images SET is_favorite = $1 WHERE id = $2', [1, 'C:/a.png']);
        expect(db.execute).toHaveBeenCalledWith("UPDATE images SET metadata_json = json_set(metadata_json, '$.isIntermediate', $1) WHERE id = $2", [0, 'C:/a.png']);
        expect(db.execute).toHaveBeenCalledWith('UPDATE images SET is_deleted = ? WHERE id IN (?)', [0, 'C:/a.png']);
        expect(db.execute).toHaveBeenCalledWith('UPDATE images SET is_favorite = ? WHERE id = ?', [0, 'C:/a.png']);
        expect(db.execute).toHaveBeenCalledWith('UPDATE images SET is_pinned = ? WHERE id = ?', [1, 'C:/a.png']);
    });

    it('stores null-heavy tombstones without memberships and permanently deletes pathless rows', async () => {
        const tombstone = {
            id: 'C:/nulls.png', path: '', timestamp: 1,
            width: null, height: null, file_size: null, metadata_json: null,
            thumbnail_path: null, micro_thumbnail: null, thumbnail_source: null,
            is_favorite: null, is_pinned: null, is_missing: null, user_masked: null,
            group_id: null, board_id: null, notes: null, original_metadata_json: null,
            original_parsed_json: null, original_state_json: null, is_corrupt: null
        };
        const db = {
            select: vi.fn(async (sql: string) => {
                if (sql.includes('FROM images')) return [tombstone];
                if (sql.includes('FROM collection_images')) return [];
                if (sql.includes('FROM removed_images')) return [{ id: tombstone.id, path: '', thumbnail_path: null }];
                return [];
            }),
            execute: vi.fn()
        };
        getDbMock.mockResolvedValue(db);
        const { removeImagesFromLibrary, deleteRemovedImagesFromDisk } = await import('../imageRepo');
        await removeImagesFromLibrary([tombstone.id]);
        const insert = db.execute.mock.calls.find(([sql]) => String(sql).includes('INSERT OR REPLACE INTO removed_images'));
        expect(insert?.[1]).toEqual(expect.arrayContaining([null]));

        const result = await deleteRemovedImagesFromDisk([tombstone.id]);
        expect(result).toEqual({ deletedIds: [tombstone.id], failedIds: [], thumbnailWarningIds: [] });
    });

    it('maps nullable existing metadata fields and browser thumbnail batch defaults', async () => {
        const db = {
            select: vi.fn(async () => [{
                id: 'C:/a.png', timestamp: 1, file_size: 0, metadata_json: '{}',
                is_favorite: 0, is_pinned: 0, board_id: null, group_id: null, notes: null
            }]),
            execute: vi.fn()
        };
        getDbMock.mockResolvedValue(db);
        const { getExistingMetadata, updateThumbnailPathsBatch } = await import('../imageRepo');
        const metadata = await getExistingMetadata(['C:/a.png']);
        expect(metadata.get('C:/a.png')).toMatchObject({
            isFavorite: false, isPinned: false, boardId: undefined, groupId: undefined, notes: undefined
        });

        browserMockModeMock.mockReturnValue(true);
        await updateThumbnailPathsBatch([{ id: 'C:/a.png', thumbnailPath: 'C:/thumb.webp' }]);
        expect(updateBrowserMockImageMock).toHaveBeenCalledWith('C:/a.png', {
            thumbnailUrl: 'C:/thumb.webp', microThumbnail: undefined, thumbnailSource: undefined
        });
    });

    it('persists every rich optional image field and explicit masking states', async () => {
        const db = { select: vi.fn(), execute: vi.fn() };
        getDbMock.mockResolvedValue(db);
        const { commands } = await import('../../../bindings');
        vi.mocked(commands.saveImagesBatch).mockResolvedValue({ status: 'ok', data: 2 });
        const { insertImagesBatch } = await import('../imageRepo');
        const rich = (id: string, userMasked: boolean): AIImage => ({
            id, url: id, thumbnailUrl: 'asset://localhost/C:/thumb.webp', filename: 'rich.png',
            width: 2, height: 3, fileSize: 4, fileHash: 'hash', timestamp: 5,
            metadata: liveImportMetadata, microThumbnail: 'micro', thumbnailSource: 'ambit',
            isFavorite: true, isPinned: true, isDeleted: true, isMissing: true, userMasked,
            groupId: 'group', boardId: 'board', notes: 'notes', originalChunks: { parameters: 'raw' },
            originalMetadata: liveImportMetadata, originalState: { isFavorite: true }, isCorrupt: true
        });
        await insertImagesBatch([rich('C:/true.png', true), rich('C:/false.png', false)]);
        const records = vi.mocked(commands.saveImagesBatch).mock.calls[0][0];
        expect(records[0]).toMatchObject({
            fileSize: 4, fileHash: 'hash', microThumbnail: 'micro', thumbnailSource: 'ambit',
            isFavorite: true, isPinned: true, isDeleted: true, isMissing: true, userMasked: true,
            groupId: 'group', boardId: 'board', notes: 'notes', isCorrupt: true
        });
        expect(records[0].originalMetadataJson).toBe(JSON.stringify({ parameters: 'raw' }));
        expect(records[0].originalStateJson).toBe(JSON.stringify({ isFavorite: true }));
        expect(records[1].userMasked).toBe(false);
    });

    it('stores multiple memberships for one tombstone and reports all-trash-failed deletion batches', async () => {
        const row = {
            id: 'C:/member.png', path: 'C:/member.png', width: 1, height: 1, file_size: 1,
            timestamp: 1, metadata_json: '{}', thumbnail_path: null, micro_thumbnail: null,
            thumbnail_source: null, is_favorite: 0, is_pinned: 0, is_missing: 0, user_masked: null,
            group_id: null, board_id: null, notes: null, original_metadata_json: null,
            original_parsed_json: null, original_state_json: null, is_corrupt: 0
        };
        let removalDone = false;
        const db = {
            select: vi.fn(async (sql: string) => {
                if (sql.includes('FROM collection_images')) return [
                    { image_id: row.id, collection_id: 'one' },
                    { image_id: row.id, collection_id: 'two' }
                ];
                if (sql.includes('FROM removed_images')) return [{ id: row.id, path: row.path, thumbnail_path: null }];
                if (sql.includes('FROM images') && !removalDone) {
                    removalDone = true;
                    return [row];
                }
                return [];
            }),
            execute: vi.fn()
        };
        getDbMock.mockResolvedValue(db);
        const { commands } = await import('../../../bindings');
        vi.mocked(commands.moveToTrash).mockResolvedValue({ status: 'error', error: 'failed' });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { removeImagesFromLibrary, deleteRemovedImagesFromDisk } = await import('../imageRepo');
        await removeImagesFromLibrary([row.id]);
        const tombstoneInsert = db.execute.mock.calls.find(([sql]) => String(sql).includes('INSERT OR REPLACE INTO removed_images'));
        expect(tombstoneInsert?.[1]).toContain(JSON.stringify(['one', 'two']));

        const result = await deleteRemovedImagesFromDisk([row.id]);
        expect(result).toEqual({ deletedIds: [], failedIds: [row.id], thumbnailWarningIds: [] });
    });

    it('handles string lock failures, repeated thumbnail failures, and truthy browser metadata fields', async () => {
        const db = {
            select: vi.fn(),
            execute: vi.fn()
                .mockRejectedValueOnce('database is locked')
                .mockResolvedValueOnce({ rowsAffected: 0 })
        };
        getDbMock.mockResolvedValue(db);
        const { clearAllThumbnailPaths, updateThumbnailPathsBatch, getExistingMetadata } = await import('../imageRepo');
        await expect(clearAllThumbnailPaths()).resolves.toBe(0);

        db.execute.mockReset();
        db.execute.mockRejectedValue('disk full');
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const updates = Array.from({ length: 5 }, (_, index) => ({
            id: `C:/image-${index}.png`, thumbnailPath: `C:/thumb-${index}.webp`,
            microThumbnail: index === 0 ? 'micro' : undefined,
            thumbnailSource: index === 0 ? 'ambit' : undefined
        }));
        await updateThumbnailPathsBatch(updates);
        expect(console.warn).toHaveBeenCalledWith('[DB] 5 thumbnail updates failed');

        browserMockModeMock.mockReturnValue(true);
        getBrowserMockImagesMock.mockReturnValue([{
            id: 'C:/browser.png', timestamp: 1, fileSize: 9, metadata: liveImportMetadata,
            isFavorite: true, isPinned: true, boardId: 'board', groupId: 'group', notes: 'note'
        }]);
        const existing = await getExistingMetadata(['C:/browser.png']);
        expect(existing.get('C:/browser.png')).toMatchObject({ fileSize: 9, isPinned: true });
    });

    it('covers legacy metadata persistence, snake-case null updates, sparse reverts, and read fallbacks', async () => {
        const baseRow = {
            id: 'C:/read.png', path: 'C:/read.png', width: 1, height: 1, file_size: 1, timestamp: 1,
            metadata_json: JSON.stringify(liveImportMetadata), thumbnail_path: null, micro_thumbnail: null,
            thumbnail_source: null, is_favorite: 0, is_pinned: 0, is_deleted: 0, is_missing: 0,
            is_corrupt: 0, user_masked: null, group_id: null, board_id: null, notes: null,
            original_metadata_json: null, original_parsed_json: null, original_state_json: null
        };
        const db = {
            select: vi.fn(async (sql: string, params?: string[]) => {
                if (sql.includes('original_parsed_json')) {
                    return [{ original_parsed_json: JSON.stringify({ positive_prompt: 'snake positive', negative_prompt: 'snake negative' }) }];
                }
                if (sql.includes('WHERE id = ?') && params?.[0] === 'C:/a1111.png') {
                    return [{ ...baseRow, id: 'C:/a1111.png', path: 'C:/a1111.png', metadata_json: JSON.stringify({ ...liveImportMetadata, tool: GeneratorTool.AUTOMATIC1111 }) }];
                }
                return [baseRow];
            }),
            execute: vi.fn()
        };
        getDbMock.mockResolvedValue(db);
        scanImageNativeMock.mockResolvedValue(null);
        const { commands } = await import('../../../bindings');
        vi.mocked(commands.saveImagesBatch).mockResolvedValue({ status: 'ok', data: 1 });
        const {
            insertImage, updateImageMetadataFields, revertImageMetadata,
            getAllImages, getImageWithFullMetadata, deleteImageFromDisk
        } = await import('../imageRepo');

        await insertImage({
            id: 'C:/legacy.png', url: 'C:/legacy.png', thumbnailUrl: '', filename: 'legacy.png',
            width: 1, height: 1, timestamp: 1, metadata: liveImportMetadata, isFavorite: false,
            originalMetadata: liveImportMetadata
        });
        expect(vi.mocked(commands.saveImagesBatch).mock.calls[0][0][0].originalMetadataJson).toBe(JSON.stringify(liveImportMetadata));

        await updateImageMetadataFields('C:/read.png', {
            positivePrompt: null, positive_prompt: 'snake', negativePrompt: null,
            negative_prompt: null, seed: null
        });
        await revertImageMetadata('C:/read.png');
        await expect(getAllImages(undefined, 0, true, true, false)).resolves.toHaveLength(1);
        await expect(getImageWithFullMetadata('C:/read.png')).resolves.toBeTruthy();
        await expect(getImageWithFullMetadata('C:/a1111.png')).resolves.toBeTruthy();
        await deleteImageFromDisk('C:/no-path.png', '', null);

        expect(db.execute).toHaveBeenCalledWith(
            expect.stringContaining('positive_prompt = ?'),
            [null, 'snake', null, null, null, 'snake', null, null, 'C:/read.png']
        );
        const revertCall = db.execute.mock.calls.find(([sql]) => String(sql).includes('SET metadata_json = ?'));
        expect(revertCall?.[1]).toEqual(expect.arrayContaining(['snake positive', 'snake negative', GeneratorTool.UNKNOWN]));
        expect(scanImageNativeMock).toHaveBeenCalledTimes(1);
    });

    it('covers browser ordering, unlimited reads, and absent existing-metadata defaults', async () => {
        browserMockModeMock.mockReturnValue(true);
        const first = {
            id: 'first', url: 'first', thumbnailUrl: '', filename: 'first', width: 1, height: 1,
            timestamp: 1, metadata: liveImportMetadata, isFavorite: false, isPinned: true
        } as AIImage;
        const second = {
            ...first, id: 'second', url: 'second', filename: 'second', timestamp: 2,
            fileSize: undefined, isPinned: undefined
        } as AIImage;
        getBrowserMockImagesMock.mockReturnValue([first, second]);
        const { getAllImages, getExistingMetadata } = await import('../imageRepo');

        await expect(getAllImages(undefined, 0, true, true, true)).resolves.toEqual([first, second]);
        await expect(getAllImages(1, 0, true, true, false)).resolves.toHaveLength(1);
        const existing = await getExistingMetadata(['second']);
        expect(existing.get('second')).toMatchObject({ fileSize: 0, isPinned: false });
    });

    it('persists null prompt fallbacks and reads native grids when explicitly enabled', async () => {
        const row = {
            id: 'C:/grid.png', path: 'C:/grid.png', width: 1, height: 1, file_size: 1, timestamp: 1,
            metadata_json: '{}', thumbnail_path: null, micro_thumbnail: null, thumbnail_source: null,
            is_favorite: 0, is_pinned: 0, is_deleted: 0, is_missing: 0, is_corrupt: 0,
            user_masked: null, group_id: null, board_id: null, notes: null,
            original_metadata_json: null, original_parsed_json: null, original_state_json: null
        };
        const db = {
            select: vi.fn(async (sql: string) => sql.includes('original_parsed_json')
                ? [{ original_parsed_json: '{}' }]
                : [row]),
            execute: vi.fn()
        };
        getDbMock.mockResolvedValue(db);
        const { updateImageMetadataFields, revertImageMetadata, getAllImages } = await import('../imageRepo');
        await updateImageMetadataFields('C:/grid.png', { positivePrompt: null, positive_prompt: null });
        await revertImageMetadata('C:/grid.png');
        await expect(getAllImages(undefined, 0, false, true, true)).resolves.toHaveLength(1);

        const updateCall = db.execute.mock.calls[0];
        expect(updateCall[1]).toEqual([null, null, null, 'C:/grid.png']);
        const revertCall = db.execute.mock.calls[1];
        expect(revertCall[1][6]).toBeNull();
        expect(revertCall[1][7]).toBeNull();
        expect(db.select.mock.calls[1][0]).not.toContain('AND IFNULL(is_grid_gen');
    });
});
