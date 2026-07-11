import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processFoldersUnified, processNativePaths, processTargetedFiles, processWebFiles, scanResourceThumbnails } from '../importService';
import { GeneratorTool } from '../../types';

const mocks = vi.hoisted(() => ({
    listen: vi.fn(),
    scanDirectoryWithStats: vi.fn(),
    getFileSizesBulk: vi.fn(),
    scanModelThumbnails: vi.fn(),
    scanImagesBulk: vi.fn(),
    parseImageFile: vi.fn(),
    insertImagesBatch: vi.fn(),
    getExistingMetadata: vi.fn(),
    rebuildFacetCache: vi.fn(),
    dbSelect: vi.fn(),
    incrementFacetCacheVersion: vi.fn()
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
        scanDirectoryWithStats: mocks.scanDirectoryWithStats,
        getFileSizesBulk: mocks.getFileSizesBulk,
        scanModelThumbnails: mocks.scanModelThumbnails
    }
}));

vi.mock('../metadataParser', () => ({
    parseImageFile: mocks.parseImageFile,
    scanImageNative: vi.fn(),
    scanImagesBulk: mocks.scanImagesBulk
}));

vi.mock('../db/imageRepo', () => ({
    insertImage: vi.fn(),
    insertImagesBatch: mocks.insertImagesBatch,
    getExistingMetadata: mocks.getExistingMetadata,
    rebuildFacetCache: mocks.rebuildFacetCache
}));

vi.mock('../db/connection', () => ({
    getDb: vi.fn(async () => ({
        select: mocks.dbSelect
    }))
}));

vi.mock('../../stores/libraryStore', () => ({
    useLibraryStore: {
        getState: vi.fn(() => ({
            incrementFacetCacheVersion: mocks.incrementFacetCacheVersion
        }))
    }
}));

describe('processTargetedFiles', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listen.mockResolvedValue(vi.fn());
        mocks.insertImagesBatch.mockResolvedValue(undefined);
        mocks.rebuildFacetCache.mockResolvedValue(0);
        mocks.dbSelect.mockResolvedValue([]);
        mocks.getFileSizesBulk.mockResolvedValue([100]);
        mocks.scanModelThumbnails.mockResolvedValue({
            status: 'ok',
            data: {
                scanned: 0,
                matched: 0,
                updated: 0,
                missing: []
            }
        });
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

    it('skips database duplicates before scanning so rescans do not rewrite unchanged paths', async () => {
        mocks.dbSelect.mockResolvedValueOnce([{ id: 'C:/library/existing.png' }]);
        mocks.getExistingMetadata.mockResolvedValueOnce(new Map());
        mocks.scanImagesBulk.mockResolvedValueOnce([
            {
                metadata: { tool: 'ComfyUI', model: 'Fresh Model' },
                timestamp: 5000,
                width: 512,
                height: 512,
                fileSize: 555,
                thumbnail: 'C:/thumbs/fresh.webp',
                thumbnailSource: 'ambit',
                microThumbnail: 'mini-fresh',
                originalChunks: {}
            }
        ]);

        const result = await processTargetedFiles([
            'C:/library/existing.png',
            'C:/library/fresh.png'
        ]);

        expect(result.stats.skipped).toBe(1);
        expect(result.stats.imported).toBe(1);
        expect(result.handledPaths).toEqual(['C:/library/fresh.png']);
        expect(mocks.scanImagesBulk).toHaveBeenCalledWith(
            ['C:/library/fresh.png'],
            '',
            true,
            true,
            undefined,
            expect.any(String)
        );
    });

    it('preserves user row state and avoids upsert when timestamp and size are unchanged', async () => {
        mocks.getExistingMetadata.mockResolvedValueOnce(new Map([
            [
                'C:/library/unchanged.png',
                {
                    timestamp: 7000,
                    fileSize: 777,
                    metadataJson: JSON.stringify({ tool: 'ComfyUI', model: 'Stable Model' }),
                    isFavorite: true,
                    isPinned: true,
                    boardId: 'board-1',
                    groupId: 'group-1',
                    notes: 'keep me'
                }
            ]
        ]));
        mocks.scanImagesBulk.mockResolvedValueOnce([
            {
                metadata: { tool: 'ComfyUI', model: 'Stable Model' },
                timestamp: 7000,
                width: 1024,
                height: 768,
                fileSize: 777,
                thumbnail: 'C:/thumbs/unchanged.webp',
                thumbnailSource: 'ambit',
                microThumbnail: 'mini-unchanged',
                originalChunks: {}
            }
        ]);

        const result = await processTargetedFiles(['C:/library/unchanged.png'], { forceRescan: true });

        expect(result.stats.imported).toBe(0);
        expect(result.handledPaths).toEqual(['C:/library/unchanged.png']);
        expect(result.images[0]).toMatchObject({
            isFavorite: true,
            isPinned: true,
            boardId: 'board-1',
            groupId: 'group-1',
            notes: 'keep me'
        });
        expect(mocks.insertImagesBatch).not.toHaveBeenCalled();
    });

    it('accounts failed metadata batches as failed paths without pretending import succeeded', async () => {
        mocks.scanImagesBulk.mockRejectedValueOnce(new Error('native scanner failed'));

        const result = await processTargetedFiles(
            ['C:/library/a.png', 'C:/library/b.png'],
            { forceRescan: true }
        );

        expect(result.stats.errors).toBe(2);
        expect(result.stats.imported).toBe(0);
        expect(result.failedPaths).toEqual(expect.arrayContaining(['C:/library/a.png', 'C:/library/b.png']));
        expect(result.failedPaths).toHaveLength(2);
        expect(result.completedSourcePaths).toEqual([]);
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
        expect(result.completedSourcePaths).toEqual(['C:/library']);
        expect(result.cancelledSourcePaths).toEqual([]);
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
        expect(result.completedSourcePaths).toEqual([]);
        expect(result.cancelledSourcePaths).toEqual(['C:/library']);
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
        expect(result.completedSourcePaths).toEqual([]);
        expect(result.cancelledSourcePaths).toEqual(['C:/library']);
        expect(result.failedPaths).toEqual([]);
        expect(mocks.insertImagesBatch).not.toHaveBeenCalled();
        expect(mocks.rebuildFacetCache).not.toHaveBeenCalled();
    });

    it('processes multi-folder imports in source order without merging by variant', async () => {
        mocks.getExistingMetadata.mockResolvedValue(new Map());
        mocks.scanDirectoryWithStats
            .mockResolvedValueOnce({
                status: 'ok',
                data: [{ path: 'C:/library-a/a.png', modified: 1000, size: 100 }]
            })
            .mockResolvedValueOnce({
                status: 'ok',
                data: [{ path: 'C:/library-b/b.png', modified: 2000, size: 200 }]
            });
        mocks.scanImagesBulk
            .mockResolvedValueOnce([{
                metadata: { tool: 'ComfyUI', model: 'Model A' },
                timestamp: 1000,
                width: 512,
                height: 512,
                fileSize: 100,
                thumbnail: 'C:/thumbs/a.webp',
                thumbnailSource: 'ambit',
                microThumbnail: 'mini-a',
                originalChunks: {}
            }])
            .mockResolvedValueOnce([{
                metadata: { tool: 'ComfyUI', model: 'Model B' },
                timestamp: 2000,
                width: 512,
                height: 512,
                fileSize: 200,
                thumbnail: 'C:/thumbs/b.webp',
                thumbnailSource: 'ambit',
                microThumbnail: 'mini-b',
                originalChunks: {}
            }]);

        const result = await processFoldersUnified(
            [
                { path: 'C:/library-a', variant: GeneratorTool.COMFYUI },
                { path: 'C:/library-b', variant: GeneratorTool.COMFYUI }
            ],
            { forceRescan: true }
        );

        expect(mocks.scanImagesBulk).toHaveBeenCalledTimes(2);
        expect(mocks.scanImagesBulk).toHaveBeenNthCalledWith(1, ['C:/library-a/a.png'], '', true, true, GeneratorTool.COMFYUI, expect.any(String));
        expect(mocks.scanImagesBulk).toHaveBeenNthCalledWith(2, ['C:/library-b/b.png'], '', true, true, GeneratorTool.COMFYUI, expect.any(String));
        expect(result.completedSourcePaths).toEqual(['C:/library-a', 'C:/library-b']);
        expect(result.cancelledSourcePaths).toEqual([]);
    });

    it('marks completed and unfinished source folders when cancellation happens mid-import', async () => {
        const abortCtrl = new AbortController();
        mocks.getExistingMetadata.mockResolvedValue(new Map());
        mocks.scanDirectoryWithStats
            .mockResolvedValueOnce({
                status: 'ok',
                data: [{ path: 'C:/library-a/a.png', modified: 1000, size: 100 }]
            })
            .mockResolvedValueOnce({
                status: 'ok',
                data: [{ path: 'C:/library-b/b.png', modified: 2000, size: 200 }]
            })
            .mockResolvedValueOnce({
                status: 'ok',
                data: [{ path: 'C:/library-c/c.png', modified: 3000, size: 300 }]
            });
        mocks.scanImagesBulk
            .mockResolvedValueOnce([{
                metadata: { tool: 'ComfyUI', model: 'Model A' },
                timestamp: 1000,
                width: 512,
                height: 512,
                fileSize: 100,
                thumbnail: 'C:/thumbs/a.webp',
                thumbnailSource: 'ambit',
                microThumbnail: 'mini-a',
                originalChunks: {}
            }])
            .mockImplementationOnce(async () => {
                abortCtrl.abort();
                return [{
                    metadata: { tool: 'ComfyUI', model: 'Model B' },
                    timestamp: 2000,
                    width: 512,
                    height: 512,
                    fileSize: 200,
                    thumbnail: 'C:/thumbs/b.webp',
                    thumbnailSource: 'ambit',
                    microThumbnail: 'mini-b',
                    originalChunks: {}
                }];
            });

        const result = await processFoldersUnified(
            [
                { path: 'C:/library-a' },
                { path: 'C:/library-b' },
                { path: 'C:/library-c' }
            ],
            {
                forceRescan: true,
                abortSignal: abortCtrl.signal
            }
        );

        expect(result.wasCancelled).toBe(true);
        expect(result.completedSourcePaths).toEqual(['C:/library-a']);
        expect(result.cancelledSourcePaths).toEqual(['C:/library-b', 'C:/library-c']);
        expect(mocks.insertImagesBatch).toHaveBeenCalledTimes(1);
    });

    it('keeps partial-failure sources retryable without marking them cancelled', async () => {
        mocks.scanDirectoryWithStats.mockResolvedValueOnce({
            status: 'ok',
            data: [{ path: 'C:/library/bad.png', modified: 1000, size: 100 }]
        });
        mocks.scanImagesBulk.mockResolvedValueOnce([{
            metadata: {},
            timestamp: 1000,
            width: 0,
            height: 0,
            fileSize: 100,
            thumbnail: '',
            thumbnailSource: 'ambit',
            microThumbnail: '',
            originalChunks: {},
            errorReason: 'bad metadata'
        }]);

        const result = await processFoldersUnified(
            [{ path: 'C:/library' }],
            { forceRescan: true }
        );

        expect(result.wasCancelled).toBe(false);
        expect(result.failedPaths).toEqual(['C:/library/bad.png']);
        expect(result.completedSourcePaths).toEqual([]);
        expect(result.cancelledSourcePaths).toEqual([]);
    });

    it('keeps native path imports batched instead of forcing one metadata scan per source path', async () => {
        mocks.getExistingMetadata.mockResolvedValue(new Map());
        mocks.scanDirectoryWithStats
            .mockResolvedValueOnce({
                status: 'ok',
                data: [{ path: 'C:/drop/a.png', modified: 1000, size: 100 }]
            })
            .mockResolvedValueOnce({
                status: 'ok',
                data: [{ path: 'C:/drop/b.png', modified: 2000, size: 200 }]
            });
        mocks.scanImagesBulk.mockResolvedValueOnce([
            {
                metadata: { tool: 'ComfyUI', model: 'Model A' },
                timestamp: 1000,
                width: 512,
                height: 512,
                fileSize: 100,
                thumbnail: 'C:/thumbs/a.webp',
                thumbnailSource: 'ambit',
                microThumbnail: 'mini-a',
                originalChunks: {}
            },
            {
                metadata: { tool: 'ComfyUI', model: 'Model B' },
                timestamp: 2000,
                width: 512,
                height: 512,
                fileSize: 200,
                thumbnail: 'C:/thumbs/b.webp',
                thumbnailSource: 'ambit',
                microThumbnail: 'mini-b',
                originalChunks: {}
            }
        ]);

        await processNativePaths(
            ['C:/drop/a.png', 'C:/drop/b.png'],
            undefined,
            undefined,
            undefined,
            undefined,
            false,
            true
        );

        expect(mocks.scanImagesBulk).toHaveBeenCalledTimes(1);
        expect(mocks.scanImagesBulk).toHaveBeenCalledWith(
            ['C:/drop/b.png', 'C:/drop/a.png'],
            '',
            false,
            true,
            undefined,
            expect.any(String)
        );
    });

    it('ignores native metadata progress events from a different run id', async () => {
        type NativeProgressEvent = {
            payload: {
                current: number;
                total: number;
                message: string;
                progressRunId?: string;
            };
        };
        let progressListener: ((event: NativeProgressEvent) => void) | undefined;
        const progressMessages: string[] = [];

        mocks.listen.mockImplementationOnce((
            _event: string,
            callback: (event: NativeProgressEvent) => void
        ) => {
            progressListener = callback;
            return Promise.resolve(vi.fn());
        });
        mocks.getExistingMetadata.mockResolvedValue(new Map());
        mocks.scanDirectoryWithStats.mockResolvedValueOnce({
            status: 'ok',
            data: [{ path: 'C:/library/a.png', modified: 1000, size: 100 }]
        });
        mocks.scanImagesBulk.mockImplementationOnce(async (
            _paths: string[],
            _thumbnailDir: string,
            _skipThumbnail: boolean,
            _extractWorkflow: boolean,
            _defaultTool: GeneratorTool | undefined,
            progressRunId: string
        ) => {
            progressListener?.({
                payload: {
                    current: 1,
                    total: 1,
                    message: 'Stale metadata progress',
                    progressRunId: 'old-run'
                }
            });
            progressListener?.({
                payload: {
                    current: 1,
                    total: 1,
                    message: 'Matching metadata progress',
                    progressRunId
                }
            });
            return [{
                metadata: { tool: 'ComfyUI', model: 'Model A' },
                timestamp: 1000,
                width: 512,
                height: 512,
                fileSize: 100,
                thumbnail: 'C:/thumbs/a.webp',
                thumbnailSource: 'ambit',
                microThumbnail: 'mini-a',
                originalChunks: {}
            }];
        });

        await processFoldersUnified(
            [{ path: 'C:/library', variant: GeneratorTool.COMFYUI }],
            {
                forceRescan: true,
                onProgress: (_current, _total, message) => {
                    if (message) progressMessages.push(message);
                }
            }
        );

        expect(progressMessages).toContain('Matching metadata progress');
        expect(progressMessages).not.toContain('Stale metadata progress');
    });

    it('falls back to treating a failed directory scan as a direct image file', async () => {
        mocks.scanDirectoryWithStats.mockRejectedValueOnce(new Error('not a directory'));
        mocks.getExistingMetadata.mockResolvedValueOnce(new Map());
        mocks.scanImagesBulk.mockResolvedValueOnce([
            {
                metadata: { tool: 'ComfyUI', model: 'Direct Model' },
                timestamp: 9000,
                width: 640,
                height: 640,
                fileSize: 999,
                thumbnail: 'C:/thumbs/direct.webp',
                thumbnailSource: 'ambit',
                microThumbnail: 'mini-direct',
                originalChunks: {}
            }
        ]);

        const result = await processFoldersUnified(
            [{ path: 'C:/drop/direct.png', variant: GeneratorTool.COMFYUI }],
            { forceRescan: true }
        );

        expect(result.completedSourcePaths).toEqual(['C:/drop/direct.png']);
        expect(mocks.scanImagesBulk).toHaveBeenCalledWith(
            ['C:/drop/direct.png'],
            '',
            true,
            true,
            GeneratorTool.COMFYUI,
            expect.any(String)
        );
    });

    it('marks empty non-image sources complete and reports no valid images', async () => {
        const progressMessages: string[] = [];
        mocks.scanDirectoryWithStats.mockResolvedValueOnce({
            status: 'ok',
            data: []
        });

        const result = await processFoldersUnified(
            [{ path: 'C:/library/readme.txt' }],
            {
                onProgress: (_current, _total, message) => {
                    if (message) progressMessages.push(message);
                }
            }
        );

        expect(result.stats.processed).toBe(0);
        expect(result.completedSourcePaths).toEqual(['C:/library/readme.txt']);
        expect(progressMessages).toContain('No valid images found.');
        expect(mocks.scanImagesBulk).not.toHaveBeenCalled();
    });

    it('imports browser files with metadata defaults and counts parse errors', async () => {
        const originalCreateObjectUrl = URL.createObjectURL;
        const originalImage = globalThis.Image;
        class TestImage {
            width = 321;
            height = 654;
            onload: (() => void) | null = null;

            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }
        URL.createObjectURL = vi.fn((file: Blob) => `blob://${(file as File).name}`);
        vi.stubGlobal('Image', TestImage);
        mocks.parseImageFile
            .mockResolvedValueOnce({
                metadata: { positivePrompt: 'browser prompt' },
                extra: { isFavorite: true }
            })
            .mockRejectedValueOnce(new Error('bad browser file'));

        try {
            const result = await processWebFiles([
                new File(['ok'], 'ok.png', { type: 'image/png', lastModified: 1234 }),
                new File(['bad'], 'bad.jpg', { type: 'image/jpeg', lastModified: 5678 }),
                new File(['skip'], 'notes.txt', { type: 'text/plain' })
            ]);

            expect(result.stats).toEqual({
                processed: 3,
                imported: 1,
                skipped: 0,
                errors: 1
            });
            expect(result.images[0].id).toMatch(/^imported_\d+_0$/);
            expect(result.images[0]).toMatchObject({
                url: 'blob://ok.png',
                thumbnailUrl: 'blob://ok.png',
                filename: 'ok.png',
                width: 321,
                height: 654,
                isFavorite: true,
                metadata: {
                    tool: GeneratorTool.UNKNOWN,
                    model: 'Unknown',
                    steps: 0,
                    cfg: 0,
                    sampler: 'Unknown',
                    positivePrompt: 'browser prompt',
                    negativePrompt: '',
                    generationType: 'unknown'
                }
            });
        } finally {
            URL.createObjectURL = originalCreateObjectUrl;
            vi.stubGlobal('Image', originalImage);
        }
    });

    it('delegates resource thumbnail scans through the generated command wrapper', async () => {
        mocks.scanModelThumbnails.mockResolvedValueOnce({
            status: 'ok',
            data: {
                scanned: 2,
                matched: 1,
                updated: 1,
                missing: ['C:/models/missing.safetensors']
            }
        });

        await expect(scanResourceThumbnails(['C:/models/a.safetensors'])).resolves.toEqual({
            scanned: 2,
            matched: 1,
            updated: 1,
            missing: ['C:/models/missing.safetensors']
        });
        expect(mocks.scanModelThumbnails).toHaveBeenCalledWith(['C:/models/a.safetensors']);
    });

    it('rethrows resource thumbnail scan failures for the maintenance UI to surface', async () => {
        const failure = new Error('thumbnail scan failed');
        mocks.scanModelThumbnails.mockResolvedValueOnce({
            status: 'error',
            error: failure
        });

        await expect(scanResourceThumbnails(['C:/models/a.safetensors'])).rejects.toThrow(failure);
    });
});
