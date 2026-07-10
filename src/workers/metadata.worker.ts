import { GeneratorTool, ImageMetadata } from '../types';
import { parseA1111Parameters, parseComfyUIMetadata } from '../services/metadata/mappingUtils';

// ImageMetadata is now imported

export interface ParseResult {
    metadata: Partial<ImageMetadata>;
    extra: {
        isFavorite?: boolean;
        board?: string;
    };
    isIntermediate?: boolean;
}

// Helper to decode text from buffer
// Note: In a worker, TextDecoder is available in global scope in modern browsers.
const textDecoder = new TextDecoder('utf-8');
const textEncoder = new TextEncoder();

const MAX_PNG_METADATA_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_PNG_DECOMPRESSED_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_PNG_METADATA_TOTAL_CHUNK_BYTES = 32 * 1024 * 1024;
const MAX_PNG_DECODED_TEXT_TOTAL_BYTES = 16 * 1024 * 1024;

type PngMetadataBudget = {
    rawChunkBytes: number;
    decodedTextBytes: number;
    rawExhausted: boolean;
    decodedExhausted: boolean;
    loggedLimit: boolean;
};

const createPngMetadataBudget = (): PngMetadataBudget => ({
    rawChunkBytes: 0,
    decodedTextBytes: 0,
    rawExhausted: false,
    decodedExhausted: false,
    loggedLimit: false,
});

const notePngBudgetLimit = (budget: PngMetadataBudget, reason: string) => {
    if (!budget.loggedLimit) {
        if (typeof console.debug === 'function') {
            console.debug(`[Worker] PNG metadata budget reached: ${reason}`);
        }
        budget.loggedLimit = true;
    }
};

const isPngMetadataChunk = (type: string): boolean =>
    type === 'tEXt' || type === 'iTXt' || type === 'zTXt' || type === 'eXIf';

const allowPngMetadataChunk = (budget: PngMetadataBudget, length: number): boolean => {
    if (budget.rawExhausted) return false;

    if (length > MAX_PNG_METADATA_CHUNK_BYTES) {
        notePngBudgetLimit(budget, 'single metadata chunk exceeds limit');
        return false;
    }
    if (budget.rawChunkBytes + length > MAX_PNG_METADATA_TOTAL_CHUNK_BYTES) {
        budget.rawExhausted = true;
        notePngBudgetLimit(budget, 'aggregate metadata chunk bytes exceed limit');
        return false;
    }

    budget.rawChunkBytes += length;
    return true;
};

const remainingPngDecodedTextBytes = (budget: PngMetadataBudget): number =>
    budget.decodedExhausted
        ? 0
        : Math.max(0, MAX_PNG_DECODED_TEXT_TOTAL_BYTES - budget.decodedTextBytes);

const exhaustPngDecodedTextBudget = (budget: PngMetadataBudget) => {
    budget.decodedExhausted = true;
    notePngBudgetLimit(budget, 'aggregate decoded text bytes exceed limit');
};

const acceptPngDecodedText = (
    chunks: Record<string, string>,
    budget: PngMetadataBudget,
    key: string,
    value: string,
): boolean => {
    if (budget.decodedExhausted) return false;

    const decodedBytes = textEncoder.encode(value).byteLength;
    if (decodedBytes > remainingPngDecodedTextBytes(budget)) {
        exhaustPngDecodedTextBudget(budget);
        return false;
    }

    budget.decodedTextBytes += decodedBytes;
    chunks[key] = value;
    return true;
};

type DecompressDeflateResult =
    | { status: 'ok'; data: Uint8Array }
    | { status: 'over-limit' }
    | { status: 'invalid' };

type MetadataRecord = Record<string, unknown>;
type DecompressionStreamConstructor = new (format: 'deflate') => TransformStream<Uint8Array, Uint8Array>;
type DecompressionGlobal = typeof globalThis & {
    DecompressionStream?: DecompressionStreamConstructor;
};

const isRecord = (value: unknown): value is MetadataRecord =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value: unknown): MetadataRecord => isRecord(value) ? value : {};

const asStringRecord = (value: unknown): Record<string, string> | undefined => {
    if (!isRecord(value)) return undefined;
    const result: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === 'string') result[key] = entry;
    }
    return Object.keys(result).length > 0 ? result : undefined;
};

const asGeneratorTool = (value: unknown): GeneratorTool | undefined =>
    Object.values(GeneratorTool).includes(value as GeneratorTool) ? value as GeneratorTool : undefined;

const parseJsonRecord = (value: string): MetadataRecord => asRecord(JSON.parse(value));

const parseFiniteSeed = (value: unknown): number | undefined => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
};

export const parseSdNextJsonMetadata = (value: string): Partial<ImageMetadata> => {
    const json = parseJsonRecord(value);
    const metadata: Partial<ImageMetadata> = {};

    if (typeof json.parameters === 'string') {
        const a1111 = parseA1111Parameters(json.parameters);
        mergeMetadata(metadata, a1111);
    } else if (typeof json.prompt === 'string') {
        metadata.positivePrompt = json.prompt;
        if (typeof json.negative_prompt === 'string') metadata.negativePrompt = json.negative_prompt;
        const seed = parseFiniteSeed(json.seed);
        if (seed !== undefined) metadata.seed = seed;
        if (json.steps) metadata.steps = Number(json.steps);
    }

    metadata.tool = GeneratorTool.SDNEXT;
    return metadata;
};

const sanitize = (text: string): string => {
    return text.replace(/\0/g, '').trim();
};

export const parseFilenameMetadata = (filename: string): Partial<ImageMetadata> => {
    const name = filename.replace(/\.[^/.]+$/, "");
    const parts = name.split('_');
    const lastPart = parts[parts.length - 1];

    const isUUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(lastPart) ||
        /^[0-9a-f]{32}$/i.test(lastPart);

    if ((isUUID && parts.length > 1) || name.toLowerCase().includes('midjourney')) {
        const promptParts = isUUID ? parts.slice(0, -1) : parts;
        return {
            tool: GeneratorTool.MIDJOURNEY,
            model: 'Midjourney v6',
            positivePrompt: promptParts.join(' ').trim(),
            steps: 0,
            cfg: 0,
        };
    }

    const isGeneric =
        /^\d{4}-\d{2}-\d{2}[_-]\d{2}[_-]\d{2}[_-]\d{2}(?:_\d+)?$/.test(name) ||
        /^\d+$/.test(name) ||
        /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(name) ||
        /^(image|img|pic|comfyui)[_-]?\d+$/i.test(name);

    if (isGeneric) {
        return {
            tool: GeneratorTool.UNKNOWN,
            positivePrompt: '',
            steps: 0,
            cfg: 0,
        };
    }

    return {
        tool: GeneratorTool.UNKNOWN,
        positivePrompt: '',
        steps: 0,
        cfg: 0,
    };
};

export const detectGenerationType = (path: string, currentType?: string): 'txt2img' | 'img2img' | 'extras' | 'grid' | 'unknown' => {
    // If we already know it, return it (unless it's unknown/undefined)
    if (currentType && currentType !== 'unknown') {
        return currentType as 'txt2img' | 'img2img' | 'extras' | 'grid' | 'unknown';
    }

    if (!path) return 'unknown';

    const lowerPath = path.toLowerCase().replace(/\\/g, '/');
    if (lowerPath.includes('/txt2img-images') || lowerPath.includes('/outputs/txt2img') || lowerPath.includes('/txt2img/') || lowerPath.includes('/text/')) {
        return 'txt2img';
    } else if (lowerPath.includes('/img2img-images') || lowerPath.includes('/outputs/img2img') || lowerPath.includes('/img2img/') || lowerPath.includes('/image/')) {
        return 'img2img';
    } else if (lowerPath.includes('/extras-images') || lowerPath.includes('/outputs/extras') || lowerPath.includes('/extras/') || lowerPath.includes('/save') || lowerPath.includes('/saved')) {
        return 'extras';
    } else if (lowerPath.includes('-grids') || lowerPath.includes('/grids/')) {
        return 'grid';
    }

    return 'unknown';
};

// parseA1111Parameters is now imported

// parseComfyUIMetadata is now imported

const parseInvokeAIMetadata = (json: unknown, metadata: Partial<ImageMetadata>, extra: ParseResult['extra']) => {
    // Basic InvokeAI parsing helper (Simplified for worker)
    const record = asRecord(json);
    if (typeof record.positive_prompt === 'string') metadata.positivePrompt = record.positive_prompt;
    if (typeof record.negative_prompt === 'string') metadata.negativePrompt = record.negative_prompt;
    // width/height are physical properties, not metadata params usually
    if (typeof record.seed === 'number') metadata.seed = record.seed;
    if (typeof record.steps === 'number') metadata.steps = record.steps;
    if (typeof record.cfg_scale === 'number') metadata.cfg = record.cfg_scale;
    if (typeof record.sampler_name === 'string') metadata.sampler = record.sampler_name;
    if (record.model) {
        if (typeof record.model === 'string') {
            metadata.model = record.model;
        } else if (isRecord(record.model)) {
            metadata.model = String(record.model.model_name || record.model.name || 'Unknown Model');
        }
    }

    if (Array.isArray(record.loras)) {
        metadata.loras = record.loras.map((l: unknown) => {
            if (typeof l === 'string') return l;
            // Handle { model: { name: "..." } } structure (InvokeAI 4+)
            const loraRecord = asRecord(l);
            const modelRecord = asRecord(loraRecord.model);
            const loraModelRecord = asRecord(loraRecord.lora);
            if (Object.keys(modelRecord).length > 0) {
                return String(modelRecord.model_name || modelRecord.name || 'Unknown LoRA');
            }
            if (Object.keys(loraModelRecord).length > 0) return String(loraModelRecord.model_name || loraModelRecord.name || 'Unknown LoRA');
            return String(loraRecord.model_name || loraRecord.name || 'Unknown LoRA');
        }).filter(Boolean);
    }

    if (record.workflow || record.graph) {
        const wf = record.workflow || record.graph;
        metadata.workflowJson = typeof wf === 'string' ? wf : JSON.stringify(wf);
    }
    metadata.tool = GeneratorTool.INVOKEAI;
};

const mergeMetadata = (base: Partial<ImageMetadata>, secondary: Partial<ImageMetadata>) => {
    if ((base.tool === GeneratorTool.UNKNOWN || !base.tool) && secondary.tool) {
        base.tool = secondary.tool;
    }
    if ((!base.model || base.model === 'Unknown') && secondary.model) {
        base.model = secondary.model;
    }
    if (!base.steps && secondary.steps) base.steps = secondary.steps;
    if (!base.cfg && secondary.cfg) base.cfg = secondary.cfg;
    if (base.seed === undefined && secondary.seed !== undefined) base.seed = secondary.seed;
    if ((!base.sampler || base.sampler === 'Unknown') && secondary.sampler) {
        base.sampler = secondary.sampler;
    }
    if (!base.positivePrompt && secondary.positivePrompt) {
        base.positivePrompt = secondary.positivePrompt;
    }
    if (!base.negativePrompt && secondary.negativePrompt) {
        base.negativePrompt = secondary.negativePrompt;
    }
    if (!base.workflowJson && secondary.workflowJson) {
        base.workflowJson = secondary.workflowJson;
    }

    // Merge Loras
    if (secondary.loras) {
        if (!base.loras) base.loras = [];
        for (const lora of secondary.loras) {
            if (!base.loras.includes(lora)) base.loras.push(lora);
        }
    }

    // Merge ControlNets
    if (secondary.controlNets) {
        if (!base.controlNets) base.controlNets = [];
        for (const cn of secondary.controlNets) {
            if (!base.controlNets.includes(cn)) base.controlNets.push(cn);
        }
    }

    // Merge other arrays
    if (secondary.hypernetworks) {
        if (!base.hypernetworks) base.hypernetworks = [];
        for (const hn of secondary.hypernetworks) {
            if (!base.hypernetworks.includes(hn)) base.hypernetworks.push(hn);
        }
    }
    if (secondary.embeddings) {
        if (!base.embeddings) base.embeddings = [];
        for (const emb of secondary.embeddings) {
            if (!base.embeddings.includes(emb)) base.embeddings.push(emb);
        }
    }
    if (secondary.ipAdapters) {
        if (!base.ipAdapters) base.ipAdapters = [];
        for (const ipa of secondary.ipAdapters) {
            if (!base.ipAdapters.includes(ipa)) base.ipAdapters.push(ipa);
        }
    }

    // Merge other fields
    if (base.vae === undefined) base.vae = secondary.vae;
    if (base.clipSkip === undefined) base.clipSkip = secondary.clipSkip;
    if (base.denoisingStrength === undefined) base.denoisingStrength = secondary.denoisingStrength;
    if (base.hiresUpscale === undefined) base.hiresUpscale = secondary.hiresUpscale;
    if (base.hiresSteps === undefined) base.hiresSteps = secondary.hiresSteps;
    if (base.hiresUpscaler === undefined) base.hiresUpscaler = secondary.hiresUpscaler;
    if (base.modelHash === undefined) base.modelHash = secondary.modelHash;
};

const parseExifData = (data: Uint8Array): string | null => {
    // Basic EXIF parser focused on UserComment (0x9286)
    // EXIF blob usually starts with TIFF header if it's raw
    // or 'Exif\0\0' if it's JPEG APP1 style, but PNG 'eXIf' chunk is just the raw block (TIFF header).

    // Check for TIFF header
    let isLittleEndian = false;
    if (data[0] === 0x49 && data[1] === 0x49) {
        isLittleEndian = true;
    } else if (data[0] === 0x4D && data[1] === 0x4D) {
        isLittleEndian = false;
    } else {
        return null; // Not valid TIFF/EXIF
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // Helper to read data respecting endianness
    const getU16 = (offset: number) => view.getUint16(offset, isLittleEndian);
    const getU32 = (offset: number) => view.getUint32(offset, isLittleEndian);

    // Verify 42 (0x002A) signature
    if (getU16(2) !== 0x002A) return null;

    const firstIfdOffset = getU32(4);
    if (firstIfdOffset < 8 || firstIfdOffset >= data.length) return null;

    // We need to traverse IFDs. UserComment is usually in the Exif IFD.
    // IFD Structure: [count u16] [entry 12bytes]... [nextIFD u32]

    const readIfd = (offset: number): string | null => {
        if (offset >= data.length) return null;
        const entryCount = getU16(offset);
        const entriesStart = offset + 2;

        // Look for Exif Offset Tag (0x8769) or UserComment (0x9286)
        // 0x8769 is pointer to Exif IFD

        let exifIfdOffset = 0;

        for (let i = 0; i < entryCount; i++) {
            const entryOffset = entriesStart + (i * 12);
            if (entryOffset + 12 > data.length) break;

            const tag = getU16(entryOffset);
            const type = getU16(entryOffset + 2);
            const count = getU32(entryOffset + 4);
            const valueOffsetOrData = getU32(entryOffset + 8); // This implies value fits in 4 bytes if < 4 bytes, else it's offset

            // Tag 0x8769: Exif Offset
            if (tag === 0x8769) {
                exifIfdOffset = valueOffsetOrData;
            }

            // Tag 0x9286: UserComment
            if (tag === 0x9286) {
                // UserComment is type 7 (undefined) usually
                // It points to a data block
                const dataOffset = valueOffsetOrData;
                if (dataOffset + 8 < data.length) { // Minimum header size
                    // Read 'ASCII\0\0\0' or 'UNICODE\0' etc
                    // SDNext/A1111 usually use ASCII header or just UTF-8

                    // The standard usually requires an 8-byte header:
                    // ASCII\0\0\0 (41 53 43 49 49 00 00 00)
                    // UNICODE\0 (55 4E 49 43 4F 44 45 00)
                    // or \0\0\0\0\0\0\0\0 for undefined.

                    const encodingKey = textDecoder.decode(data.slice(dataOffset, dataOffset + 8));
                    let start = dataOffset + 8;

                    if (encodingKey.startsWith('ASCII')) {
                        // It is ASCII (utf-8 compatible usually)
                        return sanitize(textDecoder.decode(data.slice(start, start + count - 8)));
                    } else if (encodingKey.startsWith('UNICODE')) {
                        // Is typically UCS-2 or UTF-16
                        // TextDecoder supports utf-16
                        const payload = data.slice(start, start + count - 8);
                        const decoder = new TextDecoder(isLittleEndian ? 'utf-16le' : 'utf-16be');
                        return sanitize(decoder.decode(payload));
                    } else if (data[dataOffset] === 0) {
                        // Try default decode
                        return sanitize(textDecoder.decode(data.slice(start, start + count - 8)));
                    } else {
                        // No header? Try raw
                        return sanitize(textDecoder.decode(data.slice(dataOffset, dataOffset + count)));
                    }
                }
            }
        }

        // If we found Exif Pointer, recurse
        if (exifIfdOffset > 0) {
            return readIfd(exifIfdOffset);
        }

        return null;
    };

    return readIfd(firstIfdOffset);
};

// Decompression helper using browser-native DecompressionStream
export const decompressDeflate = async (
    buffer: Uint8Array,
    maxDecompressedSize = MAX_PNG_DECOMPRESSED_TEXT_BYTES,
): Promise<DecompressDeflateResult> => {
    if (maxDecompressedSize <= 0) return { status: 'over-limit' };

    try {
        // DecompressionStream is available in modern browser environments (webview2/webkit)
        const DecompressionStreamImpl = (globalThis as DecompressionGlobal).DecompressionStream;
        if (!DecompressionStreamImpl) return { status: 'invalid' };
        const ds = new DecompressionStreamImpl('deflate');
        const body = new ArrayBuffer(buffer.byteLength);
        new Uint8Array(body).set(buffer);
        const stream = new Response(body).body?.pipeThrough(ds);
        if (!stream) return { status: 'invalid' };

        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];
        let totalSize = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!(value instanceof Uint8Array)) continue;

            totalSize += value.length;
            if (totalSize > maxDecompressedSize) {
                console.warn(`[Worker] Decompression limit exceeded (${maxDecompressedSize} bytes)`);
                await reader.cancel();
                return { status: 'over-limit' };
            }
            chunks.push(value);
        }

        const result = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return { status: 'ok', data: result };
    } catch (e) {
        console.error('[Worker] Decompression failed:', e);
        return { status: 'invalid' };
    }
};

// Modified parsePngChunks to include eXIf and supported compressed chunks
export const parsePngChunksEnhanced = async (buffer: Uint8Array): Promise<Record<string, string>> => {
    const chunks: Record<string, string> = {};
    if (buffer.length < 8) return chunks;

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const budget = createPngMetadataBudget();

    if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return chunks;

    let pos = 8;
    while (pos + 8 < buffer.length) {
        const length = view.getUint32(pos);
        const type = textDecoder.decode(buffer.slice(pos + 4, pos + 8));
        pos += 8;
        const dataEnd = pos + length;

        if (dataEnd + 4 > buffer.length) break;

        if (isPngMetadataChunk(type)) {
            if (!allowPngMetadataChunk(budget, length)) {
                pos += length + 4;
                continue;
            }
        }

        if (type === 'tEXt') {
            const data = buffer.slice(pos, dataEnd);
            const nullPos = data.indexOf(0);
            if (nullPos !== -1) {
                const key = textDecoder.decode(data.slice(0, nullPos));
                acceptPngDecodedText(
                    chunks,
                    budget,
                    key,
                    textDecoder.decode(data.slice(nullPos + 1)),
                );
            }
        } else if (type === 'zTXt') {
            const data = buffer.slice(pos, dataEnd);
            const nullPos = data.indexOf(0);
            if (nullPos !== -1) {
                const key = textDecoder.decode(data.slice(0, nullPos));
                // zTXt: key (null) method (1 byte, must be 0 for deflate) compressedData
                if (data[nullPos + 1] === 0) { // Compression method 0 (deflate)
                    const compressed = data.slice(nullPos + 2);
                    const maxDecoded = Math.min(
                        MAX_PNG_DECOMPRESSED_TEXT_BYTES,
                        remainingPngDecodedTextBytes(budget),
                    );
                    const decompressed = await decompressDeflate(compressed, maxDecoded);
                    if (decompressed.status === 'ok') {
                        acceptPngDecodedText(
                            chunks,
                            budget,
                            key,
                            textDecoder.decode(decompressed.data),
                        );
                    } else if (decompressed.status === 'over-limit') {
                        exhaustPngDecodedTextBudget(budget);
                    }
                }
            }
        } else if (type === 'iTXt') {
            const data = buffer.slice(pos, dataEnd);
            const nullPos = data.indexOf(0);
            if (nullPos !== -1) {
                const key = textDecoder.decode(data.slice(0, nullPos));
                const isCompressed = data[nullPos + 1] === 1;
                const method = data[nullPos + 2]; // Compression method (0 for deflate)

                let textStart = nullPos + 3;
                while (textStart < data.length && data[textStart] !== 0) textStart++;
                textStart++; // Skip Lang
                while (textStart < data.length && data[textStart] !== 0) textStart++;
                textStart++; // Skip Trans

                if (textStart <= data.byteLength) {
                    if (isCompressed) {
                        if (method === 0) { // Compression method 0 (deflate)
                            const compressed = data.slice(textStart);
                            const maxDecoded = Math.min(
                                MAX_PNG_DECOMPRESSED_TEXT_BYTES,
                                remainingPngDecodedTextBytes(budget),
                            );
                            const decompressed = await decompressDeflate(compressed, maxDecoded);
                            if (decompressed.status === 'ok') {
                                acceptPngDecodedText(
                                    chunks,
                                    budget,
                                    key,
                                    textDecoder.decode(decompressed.data),
                                );
                            } else if (decompressed.status === 'over-limit') {
                                exhaustPngDecodedTextBudget(budget);
                            }
                        }
                    } else {
                        acceptPngDecodedText(
                            chunks,
                            budget,
                            key,
                            textDecoder.decode(data.slice(textStart)),
                        );
                    }
                }
            }
        } else if (type === 'eXIf') {
            const data = buffer.slice(pos, dataEnd);
            const exifComment = parseExifData(data);
            if (exifComment && !chunks['parameters']) {
                acceptPngDecodedText(chunks, budget, 'parameters', exifComment);
            }
        } else if (type === 'IEND') {
            break;
        }

        pos += length + 4; // Data + CRC
    }
    return chunks;
};

// Worker Message Handler
self.onmessage = async (e: MessageEvent) => {
    const request = asRecord(e.data);
    let chunks = asStringRecord(request.chunks);
    const buffer = request.buffer instanceof Uint8Array ? request.buffer : undefined;
    const filename = typeof request.filename === 'string' ? request.filename : '';
    const requestId = typeof request.requestId === 'string' ? request.requestId : undefined;
    const path = typeof request.path === 'string' ? request.path : '';
    const defaultTool = asGeneratorTool(request.defaultTool);

    if (!chunks && buffer) {
        chunks = await parsePngChunksEnhanced(buffer);
    }

    if (!chunks && !filename) {
        self.postMessage({ error: 'No data provided', requestId });
        return;
    }

    try {
        const metadata: Partial<ImageMetadata> = {};
        const extra: ParseResult['extra'] = {};
        let isIntermediate = false;
        if (chunks) {
            // 1. A1111 / SD.Next (Compatibility)
            if (chunks.parameters || chunks.Parameters || chunks.PARAMETERS) {
                const text = chunks.parameters || chunks.Parameters || chunks.PARAMETERS;
                const a1111 = parseA1111Parameters(text, defaultTool);
                mergeMetadata(metadata, a1111);
            }

            // 2. SD.Next specific JSON chunks (Cumulative)
            const sdNextMetadata = chunks['sd-metadata'] || chunks['metadata'];
            if (sdNextMetadata) {
                try {
                    mergeMetadata(metadata, parseSdNextJsonMetadata(sdNextMetadata));
                } catch { }
            }

            // 3. ComfyUI (Cumulative)
            const workflow = chunks.workflow || chunks.prompt;
            if (workflow) {
                try {
                    const json = JSON.parse(workflow) as unknown;
                    const secondary: Partial<ImageMetadata> = {};
                    parseComfyUIMetadata(json, secondary);
                    secondary.tool = GeneratorTool.COMFYUI;
                    secondary.workflowJson = workflow;
                    mergeMetadata(metadata, secondary);
                    // Finalize tool label
                    metadata.tool = GeneratorTool.COMFYUI;
                } catch { }
            }

            // 4. InvokeAI (Cumulative)
            const invokeMeta = chunks.invokeai_metadata || chunks['sd-metadata'] || chunks.dream_metadata;
            if (invokeMeta) {
                try {
                    const json = JSON.parse(invokeMeta) as unknown;
                    const secondary: Partial<ImageMetadata> = {};
                    parseInvokeAIMetadata(json, secondary, extra);
                    mergeMetadata(metadata, secondary);
                } catch { }
            }

            // 5. InvokeAI Workflow / Graph (Cumulative)
            const workflowChunk = chunks.invokeai_workflow || chunks.invokeai_graph || chunks.workflow || chunks.graph;
            if (workflowChunk) {
                const secondary: Partial<ImageMetadata> = {
                    workflowJson: workflowChunk,
                    tool: GeneratorTool.INVOKEAI
                };
                mergeMetadata(metadata, secondary);
            }
        }

        // Final tool check
        if (!metadata.tool || metadata.tool === GeneratorTool.UNKNOWN) {
            const filenameMeta = parseFilenameMetadata(filename || 'unknown');
            metadata.positivePrompt = metadata.positivePrompt || filenameMeta.positivePrompt;
            metadata.tool = metadata.tool || filenameMeta.tool;
            metadata.model = metadata.model || filenameMeta.model;
        }

        // Note: We no longer mark Unknown tool images as intermediate.
        // Only explicit is_intermediate flags from InvokeAI metadata are trusted.
        // This prevents false positives for non-AI images (photos, archived art).

        // Path-based generation type detection (A1111 standard)
        if (!metadata.generationType || metadata.generationType === 'unknown') {
            metadata.generationType = detectGenerationType(path || '', metadata.generationType);
        }

        self.postMessage({ metadata, extra, isIntermediate, requestId });

    } catch (err) {
        // Safe fallback
        console.error("Worker parsing failed", err);
        self.postMessage({ metadata: { tool: 'Unknown' }, extra: {}, requestId });
    }
};
