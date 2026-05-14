import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processFoldersUnified, processTargetedFiles } from '../importService';

const mocks = vi.hoisted(() => ({
    listen: vi.fn(),
    scanDirectoryWithStats: vi.fn(),
    scanImagesBulk: vi.fn(),
    insertImagesBatch: vi.fn(),
    getExistingMetadata: vi.fn(),
    rebuildFacetCache: vi.fn()
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((path: string) => `asset://${path}`),
    invoke: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: mocks.listen
}));

vi.mock('../../bindings', () => ({
    commands: {
        scanDirectoryWithStats: mocks.scanDirectoryWithStats
    }
}));

vi.mock('../metadataParser', () => ({
    parseImageFile: vi.fn(),
    scanImageNative: vi.fn(),
    scanImagesBulk: mocks.scanImagesBulk
}));

vi.mock('../db/imageRepo', () => ({
    insertImage: vi.fn(),
    insertImagesBatch: mocks.insertImagesBatch,
    getExistingMetadata: mocks.getExistingMetadata,
    rebuildFacetCache: mocks.rebuildFacetCache
}));

describe('processTargetedFiles', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listen.mockResolvedValue(vi.fn());
        mocks.insertImagesBatch.mockResolvedValue(undefined);
        mocks.rebuildFacetCache.mockResolvedValue(0);
        mocks.scanDirectoryWithStats.mockResolvedValue({
            status: 'ok',
            data: [
                {
                    path: 'C:/library/new-image.png',
                    modified: 3000,
                    size: 333
                }
            ]
        });
        mocks.getExistingMetadata.mockResolvedValue(new Map([
            [
                'C:/library/updated-image.png',
                {
                    timestamp: 1000,
                    fileSize: 111,
                    metadataJson: JSON.stringify({
                        tool: 'ComfyUI',
                        model: 'Old Model',
                        loras: ['OldLora'],
                        embeddings: ['OldEmbedding'],
                        controlNets: ['OldControl']
                    }),
                    isFavorite: false,
                    isPinned: false
                }
            ]
        ]));
        mocks.scanImagesBulk.mockResolvedValue([
            {
                metadata: {
                    tool: 'ComfyUI',
                    model: 'Updated Model',
                    loras: ['NewLora'],
                    ipAdapters: ['Face Adapter']
                },
                timestamp: 2000,
                width: 1024,
                height: 1024,
                fileSize: 222,
                thumbnail: 'C:/thumbs/updated.webp',
                thumbnailSource: 'ambit',
                microThumbnail: 'mini-updated',
                originalChunks: {}
            },
            {
                metadata: {
                    tool: 'InvokeAI',
                    model: 'Fresh Model',
                    hypernetworks: ['Hyper One']
                },
                timestamp: 3000,
                width: 768,
                height: 768,
                fileSize: 333,
                thumbnail: 'C:/thumbs/new.webp',
                thumbnailSource: 'ambit',
                microThumbnail: 'mini-new',
                originalChunks: {}
            }
        ]);
    });

    it('returns touched facet types for new and updated live imports', async () => {
        const result = await processTargetedFiles(
            [
                'C:/library/updated-image.png',
                'C:/library/new-image.png'
            ],
            { forceRescan: true }
        );

        expect(result.stats.imported).toBe(2);
        expect(result.wasCancelled).toBe(false);
        expect(result.failedPaths).toEqual([]);
        expect(result.handledPaths).toEqual([
            'C:/library/updated-image.png',
            'C:/library/new-image.png'
        ]);
        expect(result.touchedFacetTypes).toEqual([
            'checkpoints',
            'loras',
            'embeddings',
            'hypernetworks',
            'controlNets',
            'ipAdapters',
            'tools'
        ]);
        expect(result.touchedFacetResources).toEqual({
            checkpoints: ['Old Model', 'Updated Model', 'Fresh Model'],
            loras: ['OldLora', 'NewLora'],
            embeddings: ['OldEmbedding'],
            hypernetworks: ['Hyper One'],
            controlNets: ['OldControl'],
            ipAdapters: ['Face Adapter'],
            tools: ['ComfyUI', 'InvokeAI']
        });
        expect(mocks.insertImagesBatch).toHaveBeenCalledTimes(1);
        expect(mocks.insertImagesBatch).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ id: 'C:/library/updated-image.png' }),
                expect.objectContaining({ id: 'C:/library/new-image.png' })
            ])
        );
    });

    it('can defer folder-import facet cleanup for startup coordination', async () => {
        mocks.getExistingMetadata.mockResolvedValue(new Map());
        mocks.scanImagesBulk.mockResolvedValueOnce([
            {
                metadata: {
                    tool: 'ComfyUI',
                    model: 'Startup Model',
                    loras: ['StartupLora']
                },
                timestamp: 3000,
                width: 768,
                height: 768,
                fileSize: 333,
                thumbnail: 'C:/thumbs/startup.webp',
                thumbnailSource: 'ambit',
                microThumbnail: 'mini-startup',
                originalChunks: {}
            }
        ]);

        const result = await processFoldersUnified(
            [{ path: 'C:/library' }],
            {
                forceRescan: true,
                deferFacetCacheRefresh: true
            }
        );

        expect(result.stats.imported).toBe(1);
        expect(result.wasCancelled).toBe(false);
        expect(result.touchedFacetTypes).toEqual([
            'checkpoints',
            'loras',
            'tools'
        ]);
        expect(result.touchedFacetResources).toEqual({
            checkpoints: ['Startup Model'],
            loras: ['StartupLora'],
            embeddings: [],
            hypernetworks: [],
            controlNets: [],
            ipAdapters: [],
            tools: ['ComfyUI']
        });
        expect(mocks.rebuildFacetCache).not.toHaveBeenCalled();
    });

    it('returns a cancelled result and skips work when aborted before discovery', async () => {
        const abortCtrl = new AbortController();
        abortCtrl.abort();

        const result = await processFoldersUnified(
            [{ path: 'C:/library' }],
            {
                abortSignal: abortCtrl.signal
            }
        );

        expect(result.wasCancelled).toBe(true);
        expect(result.failedPaths).toEqual([]);
        expect(mocks.scanDirectoryWithStats).not.toHaveBeenCalled();
        expect(mocks.scanImagesBulk).not.toHaveBeenCalled();
        expect(mocks.insertImagesBatch).not.toHaveBeenCalled();
        expect(mocks.rebuildFacetCache).not.toHaveBeenCalled();
    });

    it('returns a cancelled result and skips facet cleanup when aborted after metadata scan', async () => {
        const abortCtrl = new AbortController();
        mocks.getExistingMetadata.mockResolvedValue(new Map());
        mocks.scanImagesBulk.mockImplementationOnce(async () => {
            abortCtrl.abort();
            return [
                {
                    metadata: {
                        tool: 'ComfyUI',
                        model: 'Cancelled Model'
                    },
                    timestamp: 3000,
                    width: 768,
                    height: 768,
                    fileSize: 333,
                    thumbnail: 'C:/thumbs/cancelled.webp',
                    thumbnailSource: 'ambit',
                    microThumbnail: 'mini-cancelled',
                    originalChunks: {}
                }
            ];
        });

        const result = await processFoldersUnified(
            [{ path: 'C:/library' }],
            {
                forceRescan: true,
                abortSignal: abortCtrl.signal
            }
        );

        expect(result.wasCancelled).toBe(true);
        expect(result.failedPaths).toEqual([]);
        expect(mocks.insertImagesBatch).not.toHaveBeenCalled();
        expect(mocks.rebuildFacetCache).not.toHaveBeenCalled();
    });
});
