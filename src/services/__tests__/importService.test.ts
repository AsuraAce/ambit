import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processTargetedFiles } from '../importService';

const mocks = vi.hoisted(() => ({
    listen: vi.fn(),
    scanImagesBulk: vi.fn(),
    insertImagesBatch: vi.fn(),
    getExistingMetadata: vi.fn()
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((path: string) => `asset://${path}`),
    invoke: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: mocks.listen
}));

vi.mock('../metadataParser', () => ({
    parseImageFile: vi.fn(),
    scanImageNative: vi.fn(),
    scanImagesBulk: mocks.scanImagesBulk
}));

vi.mock('../db/imageRepo', () => ({
    insertImage: vi.fn(),
    insertImagesBatch: mocks.insertImagesBatch,
    getExistingMetadata: mocks.getExistingMetadata
}));

describe('processTargetedFiles', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listen.mockResolvedValue(vi.fn());
        mocks.insertImagesBatch.mockResolvedValue(undefined);
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
});
