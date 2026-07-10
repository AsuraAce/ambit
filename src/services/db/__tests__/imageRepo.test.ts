import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool } from '../../../types';

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock('../../../bindings', () => ({
    commands: {
        saveImagesBatch: vi.fn(),
        moveImagePathIdentities: vi.fn(),
        moveToTrash: vi.fn(),
        deleteThumbnail: vi.fn(),
        rebuildFacetCache: vi.fn(),
        rebuildFacetCacheIncremental: vi.fn(),
    }
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
    });

    it('skips user_masked cleanup when imported records do not contain default-visible overrides', async () => {
        const db = {
            select: vi.fn(),
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

        await deleteImageFromDisk('C:/images/source.png', 'C:/images/source.png', 'C:\\images\\source.png');

        expect(commands.moveToTrash).toHaveBeenCalledWith('C:/images/source.png');
        expect(commands.deleteThumbnail).not.toHaveBeenCalled();
        expect(db.execute).toHaveBeenCalledWith('DELETE FROM images WHERE id = $1', ['C:/images/source.png']);
    });
});
