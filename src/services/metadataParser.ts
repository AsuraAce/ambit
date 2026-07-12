import { ImageMetadata, GeneratorTool, ParseResult, AIImage } from '../types';
import { commands, ScanResult } from '../bindings';
import { unwrap } from '../utils/spectaUtils';
import { getFilename } from '../utils/pathUtils';
import {
    debugLiveWatchPerf,
    elapsedMs,
    infoLiveWatchPerf,
    liveWatchNow,
} from '../utils/liveWatchPerf';
import { startBackgroundDiagnostic } from '../utils/backgroundDiagnostics';

// Initializing the worker
// Using ?worker&inline might be needed depending on Vite config, 
// but usually `new Worker(new URL(..., import.meta.url))` works best in Vite.
const worker = new Worker(new URL('../workers/metadata.worker.ts', import.meta.url), {
    type: 'module'
});

type WorkerExtra = ParseResult['extra'];

interface WorkerInput {
    chunks?: unknown;
    buffer?: Uint8Array;
}

interface WorkerParseResponse {
    requestId?: string;
    error?: string;
    metadata?: Partial<ImageMetadata>;
    extra?: WorkerExtra;
    isIntermediate?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const toWorkerInput = (value: unknown): WorkerInput => {
    if (!isRecord(value)) return { chunks: value };
    return {
        chunks: 'chunks' in value ? value.chunks : value,
        buffer: value.buffer instanceof Uint8Array ? value.buffer : undefined
    };
};

// Helper to wrap worker messaging in a Promise
const parseInWorker = (chunks: unknown, filename: string, path?: string, defaultTool?: GeneratorTool): Promise<{ metadata: Partial<ImageMetadata>, extra: WorkerExtra, isIntermediate?: boolean }> => {
    return new Promise((resolve, reject) => {
        // We use a simple one-off handler approach for now.
        // For high concurrency, we might want a proper ID-based pool, 
        // but JS is single threaded event loop, so the worker will reply in order usually.
        // HOWEVER, to be safe with async/await overlap, let's just make a new listener per call 
        // OR better: Since we have one global worker, we need request IDs.

        // For simplicity in this optimization phase WITHOUT a complex Worker wrapper lib:
        // We will instantiate a new listener, check a request ID.
        // Let's actually keep it simple: One worker message = One response?
        // If we flood it, responses might mix?
        // Worker `onmessage` handles one event at a time.

        // Let's implement a simple Request ID system.
        const requestId = Math.random().toString(36).substring(7);
        let timeoutId: ReturnType<typeof setTimeout>;
        let settled = false;
        const diagnostic = startBackgroundDiagnostic('worker', 'Metadata parse', {
            requestId,
            filename,
            path
        });

        const cleanup = () => {
            worker.removeEventListener('message', handler);
            clearTimeout(timeoutId);
        };

        const settle = (
            status: 'finished' | 'failed',
            action: () => void,
            detail?: Record<string, unknown>
        ) => {
            if (settled) return;
            settled = true;
            cleanup();
            diagnostic.finish(status, detail);
            action();
        };

        const handler = (e: MessageEvent) => {
            const data = e.data as WorkerParseResponse;
            if (data.requestId === requestId) {
                if (data.error) {
                    settle('failed', () => reject(new Error(data.error)), { error: data.error });
                    return;
                }

                settle('finished', () => resolve({
                    metadata: data.metadata ?? {},
                    extra: data.extra ?? {},
                    isIntermediate: data.isIntermediate
                }));
            }
        };

        const payload = toWorkerInput(chunks);
        timeoutId = setTimeout(() => {
            settle('failed', () => reject(new Error("Worker timed out")), { error: 'Worker timed out' });
        }, 5000);
        worker.addEventListener('message', handler);

        try {
            worker.postMessage({ chunks: payload.chunks, buffer: payload.buffer, filename, requestId, path, defaultTool });
        } catch (error) {
            settle('failed', () => reject(error), {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });
};


// -- Public API --

// -- Internal Helpers --

const processScanResult = async (info: ScanResult, path: string, defaultTool?: GeneratorTool): Promise<ParseResult> => {
    // Note: Rust side now returns Result<ScanResult>, so for single scans errors are thrown.
    // For bulk scans, errors return a zeroed ScanResult.
    if (info.width === 0 && info.height === 0 && !info.metadata) {
        if (!process.env.TEST) console.warn(`Scan returned empty result for ${path}`);
        return {
            metadata: { tool: GeneratorTool.UNKNOWN, model: 'Unknown' },
            extra: {},
            width: 0,
            height: 0,
            fileSize: 0,
            timestamp: Date.now(),
            error: true,
            errorReason: info.error ?? undefined
        };
    }

    // Fast Path: If Rust successfully parsed metadata (e.g. InvokeAI), use it directly.
    if (info.metadata) {
        return {
            metadata: info.metadata as Partial<ImageMetadata>,
            extra: {},
            isIntermediate: info.metadata.isIntermediate,
            width: info.width,
            height: info.height,
            fileSize: info.size,
            timestamp: info.modified,
            thumbnail: info.thumbnail ?? undefined,
            microThumbnail: info.microThumbnail ?? undefined,
            thumbnailSource: info.thumbnailSource ?? undefined,
            originalChunks: info.chunks as Record<string, string>
        };
    }

    // Note: Removed heuristic that marked workflow-chunk-only images as intermediate.
    // This caused false positives for valid InvokeAI images with stripped metadata.
    // Now we let normal parsing flow handle these - the worker will detect InvokeAI
    // from chunks, and is_intermediate is only set if explicit in metadata.

    const filename = path.split(/[\\/]/).pop() || "unknown";
    const workerStartedAt = liveWatchNow();

    try {
        const { metadata, extra, isIntermediate } = await parseInWorker(info.chunks, filename, path, defaultTool);
        const finalIsIntermediate = isIntermediate || metadata.isIntermediate;
        debugLiveWatchPerf('Worker parse complete', {
            filename,
            workerMs: elapsedMs(workerStartedAt)
        });
        return {
            metadata: {
                ...metadata,
                isIntermediate: finalIsIntermediate,
                isGrid: metadata.isGrid || metadata.generationType === 'grid'
            },
            extra,
            isIntermediate: finalIsIntermediate,
            width: info.width,
            height: info.height,
            fileSize: info.size,
            timestamp: info.modified,
            thumbnail: info.thumbnail ?? undefined,
            microThumbnail: info.microThumbnail ?? undefined,
            thumbnailSource: info.thumbnailSource ?? undefined,
            originalChunks: info.chunks as Record<string, string>,
            errorReason: info.error ?? undefined
        };
    } catch (workerError) {
        debugLiveWatchPerf('Worker parse failed', {
            filename,
            workerMs: elapsedMs(workerStartedAt),
            error: workerError instanceof Error ? workerError.message : String(workerError)
        });
        console.error(`Worker parse failed/timed out for ${path}:`, workerError);
        return {
            metadata: { tool: GeneratorTool.UNKNOWN, model: 'Unknown' },
            extra: {},
            width: info.width,
            height: info.height,
            fileSize: info.size,
            timestamp: info.modified,
            thumbnail: info.thumbnail ?? undefined,
            microThumbnail: info.microThumbnail ?? undefined,
            thumbnailSource: info.thumbnailSource ?? undefined,
            errorReason: workerError instanceof Error ? workerError.message : String(workerError)
        };
    }
};

// -- Public API --

export const scanImageNative = async (path: string, thumbnailDir?: string, skipThumbnail: boolean = false, extractWorkflow: boolean = true, defaultTool?: GeneratorTool): Promise<ParseResult> => {
    try {
        const info = await unwrap(commands.scanImage(path, thumbnailDir || null, skipThumbnail, extractWorkflow, defaultTool || null));
        return await processScanResult(info, path, defaultTool);
    } catch (e) {
        console.error("Native scan failed", e);
        return {
            metadata: { tool: GeneratorTool.UNKNOWN, model: 'Unknown' },
            extra: {},
            width: 0,
            height: 0,
            fileSize: 0,
            timestamp: Date.now()
        };
    }
};

export const scanImagesBulk = async (
    paths: string[],
    thumbnailDir?: string,
    skipThumbnail: boolean = false,
    extractWorkflow: boolean = true,
    defaultTool?: GeneratorTool,
    progressRunId?: string
): Promise<ParseResult[]> => {
    try {
        const bulkScanStartedAt = liveWatchNow();
        const nativeScanStartedAt = liveWatchNow();
        const results = await unwrap(commands.scanImagesBulk(
            paths,
            thumbnailDir || null,
            skipThumbnail,
            extractWorkflow,
            defaultTool || null,
            progressRunId || null
        ));
        const nativeScanMs = elapsedMs(nativeScanStartedAt);

        const tasks = results.map((info, index) => {
            const path = paths[index];
            return processScanResult(info, path, defaultTool);
        });

        const postProcessStartedAt = liveWatchNow();
        const parsedResults = await Promise.all(tasks);
        infoLiveWatchPerf('scanImagesBulk complete', {
            pathCount: paths.length,
            nativeScanMs,
            postProcessMs: elapsedMs(postProcessStartedAt),
            totalMs: elapsedMs(bulkScanStartedAt)
        });
        return parsedResults;
    } catch (e) {
        console.error("Bulk scan invocation failed", e);
        return [];
    }
};

// Helper for buffer (node/drag drop raw)
export const parseImageBuffer = async (data: Uint8Array, filename: string, path?: string): Promise<ParseResult> => {
    try {
        const { metadata, extra } = await parseInWorker({ buffer: data }, filename, path);
        return {
            metadata,
            extra,
            timestamp: Date.now()
        };
    } catch (e) {
        console.error("Buffer parse failed", e);
        return {
            metadata: { tool: GeneratorTool.UNKNOWN },
            extra: {}
        };
    }
};

export const parseImageFile = async (file: File): Promise<ParseResult> => {
    // Stub for browser file object support
    return parseImageBuffer(new Uint8Array(await file.arrayBuffer()), file.name);
};

export const scanImageWorkflow = async (path: string): Promise<string | null> => {
    try {
        const result = await unwrap(commands.scanImageWorkflow(path));
        if (!result) return null;

        // If it's a JSON string, it might be the raw workflow already
        if (result.trim().startsWith('{')) {
            // But it might also be a metadata blob that needs parsing by the worker
            const filename = getFilename(path);
            const { metadata } = await parseInWorker({ chunks: { invokeai_metadata: result } }, filename);
            return metadata.workflowJson || result;
        }

        return result;
    } catch (e) {
        console.error("Failed to scan image workflow:", e);
        return null;
    }
};
