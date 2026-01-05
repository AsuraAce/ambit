import { ImageMetadata, GeneratorTool, ParseResult, AIImage } from '../types';
import { commands, ScanResult } from '../bindings';
import { unwrap } from '../utils/spectaUtils';
import { getFilename } from '../utils/pathUtils';

// Initializing the worker
// Using ?worker&inline might be needed depending on Vite config, 
// but usually `new Worker(new URL(..., import.meta.url))` works best in Vite.
const worker = new Worker(new URL('../workers/metadata.worker.ts', import.meta.url), {
    type: 'module'
});

// Helper to wrap worker messaging in a Promise
const parseInWorker = (chunks: any, filename: string, path?: string, defaultTool?: GeneratorTool): Promise<{ metadata: Partial<ImageMetadata>, extra: any, isIntermediate?: boolean }> => {
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

        const handler = (e: MessageEvent) => {
            if (e.data.requestId === requestId) {
                worker.removeEventListener('message', handler);
                if (e.data.error) reject(e.data.error);
                else resolve(e.data);
            }
        };

        worker.addEventListener('message', handler);
        worker.postMessage({ chunks: (chunks as any).chunks, buffer: (chunks as any).buffer, filename, requestId, path, defaultTool });

        // Timeout safety
        setTimeout(() => {
            worker.removeEventListener('message', handler);
            reject(new Error("Worker timed out"));
        }, 5000);
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
            error: true
        };
    }

    // Fast Path: If Rust successfully parsed metadata (e.g. InvokeAI), use it directly.
    if (info.metadata) {
        return {
            metadata: info.metadata as any,
            extra: {},
            isIntermediate: info.metadata.isIntermediate,
            width: info.width,
            height: info.height,
            fileSize: info.size,
            timestamp: info.modified,
            thumbnail: info.thumbnail
        };
    }

    // Heuristic: If missing metadata but has InvokeAI Workflow chunk, mark as Intermediate
    if (info.chunks && (info.chunks.invokeai_workflow || info.chunks['sd-metadata'])) {
        return {
            metadata: { tool: GeneratorTool.INVOKEAI, model: 'Unknown' },
            extra: {},
            isIntermediate: true,
            width: info.width,
            height: info.height,
            fileSize: info.size,
            timestamp: info.modified,
            thumbnail: info.thumbnail
        };
    }

    const filename = path.split(/[\\/]/).pop() || "unknown";

    try {
        const { metadata, extra, isIntermediate } = (await parseInWorker(info.chunks, filename, path, defaultTool)) as any;
        const finalIsIntermediate = isIntermediate || metadata.isIntermediate;
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
            thumbnail: info.thumbnail
        };
    } catch (workerError) {
        console.error(`Worker parse failed/timed out for ${path}:`, workerError);
        return {
            metadata: { tool: GeneratorTool.UNKNOWN, model: 'Unknown' },
            extra: {},
            width: info.width,
            height: info.height,
            fileSize: info.size,
            timestamp: info.modified,
            thumbnail: info.thumbnail
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

export const scanImagesBulk = async (paths: string[], thumbnailDir?: string, skipThumbnail: boolean = false, extractWorkflow: boolean = true, defaultTool?: GeneratorTool): Promise<ParseResult[]> => {
    try {
        const results = await unwrap(commands.scanImagesBulk(paths, thumbnailDir || null, skipThumbnail, extractWorkflow, defaultTool || null));

        const tasks = results.map((info, index) => {
            const path = paths[index];
            return processScanResult(info, path, defaultTool);
        });

        return Promise.all(tasks);
    } catch (e) {
        console.error("Bulk scan invocation failed", e);
        return [];
    }
};

// Helper for buffer (node/drag drop raw)
export const parseImageBuffer = async (data: Uint8Array, filename: string, path?: string): Promise<ParseResult> => {
    try {
        const { metadata, extra } = await parseInWorker({ buffer: data } as any, filename, path);
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