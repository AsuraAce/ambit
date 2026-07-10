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
});
