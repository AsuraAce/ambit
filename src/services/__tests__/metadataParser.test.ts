import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool } from '../../types';

const mocks = vi.hoisted(() => ({
    commands: {
        scanImage: vi.fn(),
        scanImagesBulk: vi.fn(),
        scanImageWorkflow: vi.fn(),
    },
    workerResponses: [] as Array<Record<string, unknown>>,
    workerMessages: [] as Array<Record<string, unknown>>,
    postMessageError: null as unknown,
}));

vi.mock('../../bindings', () => ({
    commands: mocks.commands,
}));

vi.mock('../../utils/backgroundDiagnostics', () => ({
    startBackgroundDiagnostic: vi.fn(() => ({
        finish: vi.fn(),
        update: vi.fn(),
    })),
}));

vi.mock('../../utils/liveWatchPerf', () => ({
    debugLiveWatchPerf: vi.fn(),
    elapsedMs: vi.fn(() => 1),
    infoLiveWatchPerf: vi.fn(),
    liveWatchNow: vi.fn(() => 1),
}));

type WorkerHandler = (event: MessageEvent) => void;

class RespondingWorker {
    private handlers = new Set<WorkerHandler>();

    addEventListener(_event: string, handler: WorkerHandler) {
        this.handlers.add(handler);
    }

    removeEventListener(_event: string, handler: WorkerHandler) {
        this.handlers.delete(handler);
    }

    postMessage(message: Record<string, unknown>) {
        if (mocks.postMessageError) throw mocks.postMessageError;
        mocks.workerMessages.push(message);
        const response = mocks.workerResponses.shift() ?? {};
        queueMicrotask(() => {
            this.handlers.forEach((handler) => handler({
                data: {
                    requestId: message.requestId,
                    ...response,
                },
            } as MessageEvent));
        });
    }

    terminate() {}
}

const scanResult = (overrides: Record<string, unknown> = {}) => ({
    width: 640,
    height: 480,
    size: 1234,
    modified: 1700000000000,
    thumbnail: 'C:/thumbs/a.webp',
    microThumbnail: 'data:image/webp;base64,abc',
    thumbnailSource: 'ambit',
    chunks: { parameters: 'prompt' },
    metadata: null,
    error: null,
    ...overrides,
});

describe('metadataParser', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.workerResponses.length = 0;
        mocks.workerMessages.length = 0;
        mocks.postMessageError = null;
        vi.stubGlobal('Worker', RespondingWorker);
    });

    it('uses Rust-provided parsed metadata directly without worker parsing', async () => {
        const metadata = {
            tool: GeneratorTool.INVOKEAI,
            model: 'Checkpoint',
            steps: 20,
            cfg: 7,
            sampler: 'euler',
            positivePrompt: 'prompt',
            negativePrompt: '',
            isIntermediate: true,
        };
        mocks.commands.scanImage.mockResolvedValue({ status: 'ok', data: scanResult({ metadata }) });

        const { scanImageNative } = await import('../metadataParser');
        const result = await scanImageNative('C:/images/a.png', 'C:/thumbs', true, false, GeneratorTool.INVOKEAI);

        expect(mocks.commands.scanImage).toHaveBeenCalledWith(
            'C:/images/a.png',
            'C:/thumbs',
            true,
            false,
            GeneratorTool.INVOKEAI
        );
        expect(result.metadata).toBe(metadata);
        expect(result.isIntermediate).toBe(true);
        expect(mocks.workerMessages).toEqual([]);
    });

    it('returns a structured error result for empty bulk-scan placeholders', async () => {
        mocks.commands.scanImage.mockResolvedValue({
            status: 'ok',
            data: scanResult({
                width: 0,
                height: 0,
                size: 0,
                modified: 0,
                chunks: {},
                metadata: null,
                error: 'decode failed',
            }),
        });

        const { scanImageNative } = await import('../metadataParser');
        const result = await scanImageNative('C:/images/broken.png');

        expect(result.error).toBe(true);
        expect(result.errorReason).toBe('decode failed');
        expect(result.metadata).toEqual({ tool: GeneratorTool.UNKNOWN, model: 'Unknown' });
    });

    it('parses native scan chunks in the worker and marks grids consistently', async () => {
        mocks.commands.scanImage.mockResolvedValue({ status: 'ok', data: scanResult() });
        mocks.workerResponses.push({
            metadata: {
                tool: GeneratorTool.COMFYUI,
                model: 'Checkpoint',
                generationType: 'grid',
            },
            extra: { board: 'board-a' },
            isIntermediate: false,
        });

        const { scanImageNative } = await import('../metadataParser');
        const result = await scanImageNative('C:/images/grid.png');

        expect(result.metadata.isGrid).toBe(true);
        expect(result.metadata.generationType).toBe('grid');
        expect(result.extra).toEqual({ board: 'board-a' });
        expect(mocks.workerMessages[0]).toMatchObject({
            chunks: { parameters: 'prompt' },
            filename: 'grid.png',
            path: 'C:/images/grid.png',
        });
    });

    it('passes primitive metadata chunks through to the worker', async () => {
        mocks.commands.scanImage.mockResolvedValue({
            status: 'ok',
            data: scanResult({
                chunks: 'raw metadata',
                thumbnail: null,
                microThumbnail: null,
                thumbnailSource: null,
            }),
        });
        mocks.workerResponses.push({ metadata: {}, extra: {} });
        const { scanImageNative } = await import('../metadataParser');

        await scanImageNative('C:/images/raw.png');

        expect(mocks.workerMessages[0].chunks).toBe('raw metadata');
    });

    it('ignores a duplicate worker response after the request settles', async () => {
        class DuplicateResponseWorker {
            private handler: WorkerHandler | null = null;
            addEventListener(_event: string, handler: WorkerHandler) { this.handler = handler; }
            removeEventListener() {}
            postMessage(message: Record<string, unknown>) {
                const event = { data: { requestId: message.requestId, metadata: {}, extra: {} } } as MessageEvent;
                this.handler?.(event);
                this.handler?.(event);
            }
        }
        vi.stubGlobal('Worker', DuplicateResponseWorker);
        mocks.commands.scanImage.mockResolvedValue({ status: 'ok', data: scanResult() });
        const { scanImageNative } = await import('../metadataParser');

        await expect(scanImageNative('C:/images/duplicate.png')).resolves.toMatchObject({ width: 640 });
    });

    it('warns about empty native scan results outside the test runtime', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.stubEnv('TEST', '');
        mocks.commands.scanImage.mockResolvedValue({
            status: 'ok',
            data: scanResult({ width: 0, height: 0, metadata: null }),
        });
        const { scanImageNative } = await import('../metadataParser');

        await scanImageNative('C:/images/empty.png');

        expect(warn).toHaveBeenCalledWith('Scan returned empty result for C:/images/empty.png');
        vi.unstubAllEnvs();
        warn.mockRestore();
    });

    it('uses an unknown filename and preserves absent scan assets on worker failure', async () => {
        mocks.commands.scanImage.mockResolvedValue({
            status: 'ok',
            data: scanResult({ thumbnail: null, microThumbnail: null, thumbnailSource: null }),
        });
        mocks.postMessageError = 'transport unavailable';
        const { scanImageNative } = await import('../metadataParser');

        const result = await scanImageNative('');

        expect(mocks.workerMessages).toEqual([]);
        expect(result.thumbnail).toBeUndefined();
        expect(result.microThumbnail).toBeUndefined();
        expect(result.thumbnailSource).toBeUndefined();
        expect(result.errorReason).toBe('transport unavailable');
    });

    it('reports synchronous Error worker transport failures', async () => {
        mocks.commands.scanImage.mockResolvedValue({ status: 'ok', data: scanResult() });
        mocks.postMessageError = new Error('worker bridge failed');
        const { scanImageNative } = await import('../metadataParser');

        const result = await scanImageNative('C:/images/error.png');

        expect(result.errorReason).toBe('worker bridge failed');
    });

    it('falls back to Unknown metadata when worker parsing fails', async () => {
        mocks.commands.scanImage.mockResolvedValue({ status: 'ok', data: scanResult({ error: 'partial metadata' }) });
        mocks.workerResponses.push({ error: 'worker exploded' });

        const { scanImageNative } = await import('../metadataParser');
        const result = await scanImageNative('C:/images/fail.png');

        expect(result.metadata).toEqual({ tool: GeneratorTool.UNKNOWN, model: 'Unknown' });
        expect(result.errorReason).toBe('worker exploded');
        expect(result.thumbnail).toBe('C:/thumbs/a.webp');
    });

    it('bulk scans every returned result against the matching original path', async () => {
        mocks.commands.scanImagesBulk.mockResolvedValue({
            status: 'ok',
            data: [
                scanResult({ chunks: { parameters: 'a' } }),
                scanResult({ chunks: { parameters: 'b' } }),
            ],
        });
        mocks.workerResponses.push(
            { metadata: { positivePrompt: 'A' }, extra: {} },
            { metadata: { positivePrompt: 'B' }, extra: {} },
        );

        const { scanImagesBulk } = await import('../metadataParser');
        const results = await scanImagesBulk(['C:/images/a.png', 'C:/images/b.png'], undefined, false, true, GeneratorTool.COMFYUI, 'run-1');

        expect(mocks.commands.scanImagesBulk).toHaveBeenCalledWith(
            ['C:/images/a.png', 'C:/images/b.png'],
            null,
            false,
            true,
            GeneratorTool.COMFYUI,
            'run-1'
        );
        expect(results.map((result) => result.metadata.positivePrompt)).toEqual(['A', 'B']);
        expect(mocks.workerMessages.map((message) => message.path)).toEqual(['C:/images/a.png', 'C:/images/b.png']);
    });

    it('parses image buffers through the worker buffer path', async () => {
        mocks.workerResponses.push({
            metadata: { tool: GeneratorTool.AUTOMATIC1111 },
            extra: { isFavorite: true },
        });

        const { parseImageBuffer } = await import('../metadataParser');
        const result = await parseImageBuffer(new Uint8Array([1, 2, 3]), 'drop.png', 'C:/drop.png');

        expect(result.metadata.tool).toBe(GeneratorTool.AUTOMATIC1111);
        expect(result.extra).toEqual({ isFavorite: true });
        expect(mocks.workerMessages[0].buffer).toEqual(new Uint8Array([1, 2, 3]));
        expect(mocks.workerMessages[0].chunks).toEqual({ buffer: new Uint8Array([1, 2, 3]) });
    });

    it('extracts workflow JSON directly or via worker parsing for metadata blobs', async () => {
        mocks.commands.scanImageWorkflow
            .mockResolvedValueOnce({ status: 'ok', data: 'plain workflow' })
            .mockResolvedValueOnce({ status: 'ok', data: '{"invoke":"metadata"}' })
            .mockResolvedValueOnce({ status: 'ok', data: null });
        mocks.workerResponses.push({
            metadata: { workflowJson: '{"nodes":[]}' },
            extra: {},
        });

        const { scanImageWorkflow } = await import('../metadataParser');

        await expect(scanImageWorkflow('C:/images/plain.png')).resolves.toBe('plain workflow');
        await expect(scanImageWorkflow('C:/images/blob.png')).resolves.toBe('{"nodes":[]}');
        await expect(scanImageWorkflow('C:/images/none.png')).resolves.toBeNull();
        expect(mocks.workerMessages[0]).toMatchObject({
            chunks: { invokeai_metadata: '{"invoke":"metadata"}' },
            filename: 'blob.png',
        });
    });

    it('returns safe fallbacks when native commands reject', async () => {
        mocks.commands.scanImage.mockRejectedValueOnce(new Error('native unavailable'));
        mocks.commands.scanImagesBulk.mockRejectedValueOnce(new Error('bulk unavailable'));
        mocks.commands.scanImageWorkflow.mockRejectedValueOnce(new Error('workflow unavailable'));

        const { scanImageNative, scanImagesBulk, scanImageWorkflow } = await import('../metadataParser');

        await expect(scanImageNative('C:/images/a.png')).resolves.toMatchObject({
            metadata: { tool: GeneratorTool.UNKNOWN, model: 'Unknown' },
            width: 0,
            height: 0,
        });
        await expect(scanImagesBulk(['C:/images/a.png'])).resolves.toEqual([]);
        await expect(scanImageWorkflow('C:/images/a.png')).resolves.toBeNull();
    });

    it('ignores stale worker replies and times out when no matching reply arrives', async () => {
        vi.useFakeTimers();
        mocks.workerResponses.push({ requestId: 'stale-request', metadata: { model: 'Wrong' } });

        const { parseImageBuffer } = await import('../metadataParser');
        const resultPromise = parseImageBuffer(new Uint8Array(), 'timeout.png');
        await vi.advanceTimersByTimeAsync(5000);

        await expect(resultPromise).resolves.toEqual({
            metadata: { tool: GeneratorTool.UNKNOWN },
            extra: {},
        });
        vi.useRealTimers();
    });

    it('reports synchronous worker transport failures for non-Error values', async () => {
        mocks.postMessageError = 'worker unavailable';

        const { parseImageBuffer } = await import('../metadataParser');

        await expect(parseImageBuffer(new Uint8Array(), 'broken.png')).resolves.toEqual({
            metadata: { tool: GeneratorTool.UNKNOWN },
            extra: {},
        });
    });

    it('parses browser files through their array buffer', async () => {
        mocks.workerResponses.push({ metadata: {}, extra: {} });
        const file = new File([new Uint8Array([4, 5])], 'browser.png');

        const { parseImageFile } = await import('../metadataParser');
        await expect(parseImageFile(file)).resolves.toMatchObject({ metadata: {}, extra: {} });
        expect(mocks.workerMessages[0].buffer).toEqual(new Uint8Array([4, 5]));
    });

    it('normalizes sparse scan results and worker defaults', async () => {
        mocks.commands.scanImage
            .mockResolvedValueOnce({ status: 'ok', data: scanResult({ error: null }) })
            .mockResolvedValueOnce({
                status: 'ok',
                data: scanResult({
                    metadata: { tool: GeneratorTool.COMFYUI },
                    thumbnail: null,
                    microThumbnail: null,
                    thumbnailSource: null,
                    chunks: null,
                }),
            });
        mocks.workerResponses.push({});

        const { scanImageNative } = await import('../metadataParser');
        const parsed = await scanImageNative('filename-without-directory.png');
        const native = await scanImageNative('C:/images/native.png');

        expect(parsed).toMatchObject({
            metadata: { isIntermediate: undefined, isGrid: false },
            extra: {},
            errorReason: undefined,
        });
        expect(native).toMatchObject({
            thumbnail: undefined,
            microThumbnail: undefined,
            thumbnailSource: undefined,
        });
    });

    it('falls back to the original metadata blob when no workflow is extracted', async () => {
        mocks.commands.scanImageWorkflow.mockResolvedValue({ status: 'ok', data: '{}' });
        mocks.workerResponses.push({ metadata: {}, extra: {} });

        const { scanImageWorkflow } = await import('../metadataParser');

        await expect(scanImageWorkflow('image.png')).resolves.toBe('{}');
    });
});
