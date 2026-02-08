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

const sanitize = (text: string): string => {
    return text.replace(/\0/g, '').trim();
};

const findNodeByOutputLink = (nodes: any[], linkId: number | string): { node: any, slotIndex: number } | null => {
    if (!linkId) return null;
    for (const node of nodes) {
        if (node.outputs) {
            for (let i = 0; i < node.outputs.length; i++) {
                const output = node.outputs[i];
                // Loose equality check for links to handle string/number mismatch
                if (output.links && output.links.some((l: any) => l == linkId)) {
                    return { node, slotIndex: output.slot_index !== undefined ? output.slot_index : i };
                }
            }
        }
    }
    return null;
};

const traceText = (nodes: any[], nodeId: number, slotIndex: number, depth = 0): string | null => {
    if (depth > 20) return null;
    const node = nodes.find(n => n.id == nodeId); // Loose equality
    if (!node) return null;

    if (node.mode === 2 || node.mode === 4) return null;

    const type = (node.type || node.class_type || "").toLowerCase();

    // 1. Explicit Primitive/String Node Handling
    if (type === 'primitivenode' || type.includes('primitive') || type === 'string' || type.includes('literal')) {
        if (node.widgets_values) {
            const strings = node.widgets_values.filter((v: any) => typeof v === 'string');
            if (strings.length > 0) {
                return strings.reduce((a: string, b: string) => a.length > b.length ? a : b);
            }
        }
    }

    // Handle Reroute Nodes
    if (type === 'reroute' || type.includes('reroute')) {
        const inputs = node.inputs || [];
        if (inputs.length > 0 && inputs[0].link) {
            const source = findNodeByOutputLink(nodes, inputs[0].link);
            if (source) return traceText(nodes, source.node.id, source.slotIndex, depth + 1);
        }
    }

    if (type.includes('promptreader')) {
        if (node.widgets_values) {
            if (slotIndex === 2 && typeof node.widgets_values[3] === 'string') return node.widgets_values[3];
            if (slotIndex === 3 && typeof node.widgets_values[4] === 'string') return node.widgets_values[4];
        }
        const strings = node.widgets_values?.filter((v: any) => typeof v === 'string');
        if (strings && strings.length > 0) return strings[0];
    }

    // Handle String Concatenation
    if (type.includes('join') || (type.includes('concat') && type.includes('string')) || type === 'joinstringmulti') {
        const parts: string[] = [];
        const inputs = node.inputs || [];

        const sortedInputs = [...inputs].sort((a, b) => {
            if (a.name && b.name) return a.name.localeCompare(b.name, undefined, { numeric: true });
            return 0;
        });

        for (const input of sortedInputs) {
            if (input.link) {
                const source = findNodeByOutputLink(nodes, input.link);
                if (source) {
                    const txt = traceText(nodes, source.node.id, source.slotIndex, depth + 1);
                    if (txt) parts.push(txt);
                }
            }
        }

        let separator = " ";
        if (node.widgets_values) {
            const candidates = node.widgets_values.filter((v: any) => typeof v === 'string');
            const sep = candidates.find((v: string) => v.length < 50 && (v.includes(',') || v.includes('\n') || v === ' '));
            if (sep !== undefined) separator = sep;
        }

        if (parts.length > 0) return parts.join(separator);
    }

    // TextEncode/CLIPText handling
    if (type.includes('textencode') || type.includes('cliptext') || type.includes('prompt') || type.includes('string') || type.includes('style')) {
        let tracedResult: string | null = null;
        const inputs = node.inputs || [];
        const textInput = inputs.find((i: any) =>
            (i.name === 'text' || i.name === 'text_g' || i.name === 'text_l' || i.name === 'string' || i.name === 'prompt') && i.link
        );

        if (textInput) {
            const source = findNodeByOutputLink(nodes, textInput.link);
            if (source) {
                tracedResult = traceText(nodes, source.node.id, source.slotIndex, depth + 1);
            }
        }

        if (tracedResult) return tracedResult;

        if (node.widgets_values) {
            const strings = node.widgets_values.filter((v: any) => typeof v === 'string' && v.trim().length > 0);
            if (strings.length > 0) {
                return strings.reduce((a: string, b: string) => a.length > b.length ? a : b);
            }
        }
    }

    // Conditioning Traversal
    const inputs = node.inputs || [];
    const candidateInputs = inputs.filter((i: any) => {
        const name = (i.name || "").toLowerCase();
        const iType = (i.type || "").toUpperCase();
        return name.includes('conditioning') || iType === 'CONDITIONING' || name === 'c' || name === 'input' || name === 'clip';
    });

    for (const input of candidateInputs) {
        if (input.link) {
            const source = findNodeByOutputLink(nodes, input.link);
            if (source) {
                const res = traceText(nodes, source.node.id, source.slotIndex, depth + 1);
                if (res) return res;
            }
        }
    }

    if (type === 'getnode' || type === 'get_node') {
        const varName = node.widgets_values?.[0];
        if (typeof varName === 'string') {
            const setNode = nodes.find(n => {
                const t = (n.type || n.class_type || "").toLowerCase();
                return (t === 'setnode' || t === 'set_node') && n.widgets_values?.[0] === varName;
            });

            if (setNode) {
                const setInput = setNode.inputs?.find((i: any) => i.link);
                if (setInput) {
                    const source = findNodeByOutputLink(nodes, setInput.link);
                    if (source) return traceText(nodes, source.node.id, source.slotIndex, depth + 1);
                }
            }
        }
    }

    if (type.includes('concat') && type.includes('text')) {
        const parts: string[] = [];
        const inputs = node.inputs || [];
        for (const input of inputs) {
            if (input.link) {
                const source = findNodeByOutputLink(nodes, input.link);
                if (source) {
                    const txt = traceText(nodes, source.node.id, source.slotIndex, depth + 1);
                    if (txt) parts.push(txt);
                }
            }
        }
        if (parts.length > 0) return parts.join(' ');
    }

    if (node.widgets_values) {
        const strings = node.widgets_values.filter((v: any) => typeof v === 'string' && v.length > 0);
        if (strings.length > 0) {
            return strings.reduce((a: string, b: string) => a.length > b.length ? a : b);
        }
    }

    return null;
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
            seed: 0
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
            seed: 0
        };
    }

    return {
        tool: GeneratorTool.UNKNOWN,
        positivePrompt: '',
        steps: 0,
        cfg: 0,
        seed: 0
    };
};

export const detectGenerationType = (path: string, currentType?: string): 'txt2img' | 'img2img' | 'extras' | 'grid' | 'unknown' => {
    // If we already know it, return it (unless it's unknown/undefined)
    if (currentType && currentType !== 'unknown') return currentType as any;

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

const parseInvokeAIMetadata = (json: any, metadata: Partial<ImageMetadata>, extra: any) => {
    // Basic InvokeAI parsing helper (Simplified for worker)
    if (json.positive_prompt) metadata.positivePrompt = json.positive_prompt;
    if (json.negative_prompt) metadata.negativePrompt = json.negative_prompt;
    // width/height are physical properties, not metadata params usually
    if (json.seed) metadata.seed = json.seed;
    if (json.steps) metadata.steps = json.steps;
    if (json.cfg_scale) metadata.cfg = json.cfg_scale;
    if (json.sampler_name) metadata.sampler = json.sampler_name;
    if (json.model) {
        if (typeof json.model === 'string') {
            metadata.model = json.model;
        } else if (typeof json.model === 'object') {
            metadata.model = json.model.model_name || json.model.name || 'Unknown Model';
        }
    }

    if (json.loras && Array.isArray(json.loras)) {
        metadata.loras = json.loras.map((l: any) => {
            if (typeof l === 'string') return l;
            // Handle { model: { name: "..." } } structure (InvokeAI 4+)
            if (l.model && typeof l.model === 'object') {
                return l.model.model_name || l.model.name || 'Unknown LoRA';
            }
            if (l.lora && typeof l.lora === 'object') return l.lora.model_name || l.lora.name;
            return l.model_name || l.name || 'Unknown LoRA';
        }).filter(Boolean);
    }

    if (json.workflow || json.graph) {
        const wf = json.workflow || json.graph;
        metadata.workflowJson = typeof wf === 'string' ? wf : JSON.stringify(wf);
    }
    metadata.tool = GeneratorTool.INVOKEAI;
};

const parseInvokeDreamCommand = (cmd: string, metadata: Partial<ImageMetadata>) => {
    const promptMatch = cmd.match(/^"(.+?)"/);
    if (promptMatch) {
        metadata.positivePrompt = promptMatch[1];
        // Very basic dream parser
        const rest = cmd.substring(promptMatch[0].length);
        const negMatch = rest.match(/\[([^\]]+)\]/);
        if (negMatch) metadata.negativePrompt = negMatch[1];

        const steps = rest.match(/-s\s*(\d+)/);
        if (steps) metadata.steps = parseInt(steps[1]);

        const cfg = rest.match(/-C\s*([\d.]+)/);
        if (cfg) metadata.cfg = parseFloat(cfg[1]);

        const seed = rest.match(/-S\s*(\d+)/);
        if (seed) metadata.seed = parseInt(seed[1]);
    }
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
    if (!base.seed && secondary.seed) base.seed = secondary.seed;
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

const parsePngChunks = (buffer: Uint8Array): Record<string, string> => {
    const chunks: Record<string, string> = {};
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // Verify PNG header
    if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) {
        return chunks;
    }

    let pos = 8;
    while (pos + 8 < buffer.length) {
        const length = view.getUint32(pos);
        const type = textDecoder.decode(buffer.slice(pos + 4, pos + 8));
        pos += 8;

        if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
            const data = buffer.slice(pos, pos + length);
            const nullPos = data.indexOf(0);
            if (nullPos !== -1) {
                const key = textDecoder.decode(data.slice(0, nullPos));
                if (type === 'tEXt') {
                    chunks[key] = textDecoder.decode(data.slice(nullPos + 1));
                } else if (type === 'iTXt') {
                    // iTXt: Keyword (null) CompressionFlag (1) CompressionMethod (1) Language (null) TranslatedKeyword (null) Text
                    const isCompressed = data[nullPos + 1] === 1;
                    let textStart = nullPos + 3;
                    // Find end of lang
                    while (textStart < data.length && data[textStart] !== 0) textStart++;
                    textStart++;
                    // Find end of trans
                    while (textStart < data.length && data[textStart] !== 0) textStart++;
                    textStart++;

                    if (isCompressed) {
                        // Decompression would require a lib like fflate in the worker.
                        // For now we skip compressed iTXt if not available.
                    } else {
                        chunks[key] = textDecoder.decode(data.slice(textStart));
                    }
                }
                // zTXt would also need decompression.
            }
        } else if (type === 'IEND') {
            break;
        }

        pos += length + 4; // Data + CRC
    }
    return chunks;
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
const decompressDeflate = async (buffer: Uint8Array): Promise<Uint8Array | null> => {
    try {
        // DecompressionStream is available in modern browser environments (webview2/webkit)
        const ds = new (globalThis as any).DecompressionStream('deflate');
        const decompressedStream = new Response(buffer as any).body?.pipeThrough(ds);
        if (!decompressedStream) return null;
        const res = await new Response(decompressedStream).arrayBuffer();
        return new Uint8Array(res);
    } catch (e) {
        // Fallback or fail
        return null;
    }
};

// Worker Message Handler
self.onmessage = async (e: MessageEvent) => {
    let { chunks, buffer, filename, requestId, path } = e.data;

    // Modified parsePngChunks to include eXIf and supported compressed chunks
    const parsePngChunksEnhanced = async (buffer: Uint8Array): Promise<Record<string, string>> => {
        const chunks: Record<string, string> = {};
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

        if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return chunks;

        let pos = 8;
        while (pos + 8 < buffer.length) {
            const length = view.getUint32(pos);
            const type = textDecoder.decode(buffer.slice(pos + 4, pos + 8));
            pos += 8;

            if (type === 'tEXt') {
                const data = buffer.slice(pos, pos + length);
                const nullPos = data.indexOf(0);
                if (nullPos !== -1) {
                    const key = textDecoder.decode(data.slice(0, nullPos));
                    chunks[key] = textDecoder.decode(data.slice(nullPos + 1));
                }
            } else if (type === 'zTXt') {
                const data = buffer.slice(pos, pos + length);
                const nullPos = data.indexOf(0);
                if (nullPos !== -1) {
                    const key = textDecoder.decode(data.slice(0, nullPos));
                    // zTXt: key (null) method (1 byte, must be 0 for deflate) compressedData
                    if (data[nullPos + 1] === 0) { // Compression method 0 (deflate)
                        const compressed = data.slice(nullPos + 2);
                        const decompressed = await decompressDeflate(compressed);
                        if (decompressed) {
                            chunks[key] = textDecoder.decode(decompressed);
                        }
                    }
                }
            } else if (type === 'iTXt') {
                const data = buffer.slice(pos, pos + length);
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

                    if (isCompressed) {
                        if (method === 0) { // Compression method 0 (deflate)
                            const compressed = data.slice(textStart);
                            const decompressed = await decompressDeflate(compressed);
                            if (decompressed) {
                                chunks[key] = textDecoder.decode(decompressed);
                            }
                        }
                    } else {
                        chunks[key] = textDecoder.decode(data.slice(textStart));
                    }
                }
            } else if (type === 'eXIf') {
                const data = buffer.slice(pos, pos + length);
                const exifComment = parseExifData(data);
                if (exifComment) {
                    // Try to avoid overwriting standard parameters if already found, 
                    // but usually eXIf is the fallback.
                    if (!chunks['parameters']) chunks['parameters'] = exifComment;
                }
            } else if (type === 'IEND') {
                break;
            }

            pos += length + 4; // Data + CRC
        }
        return chunks;
    };

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
                const a1111 = parseA1111Parameters(text, e.data.defaultTool);
                mergeMetadata(metadata, a1111);
            }

            // 2. SD.Next specific JSON chunks (Cumulative)
            const sdNextMetadata = chunks['sd-metadata'] || chunks['metadata'];
            if (sdNextMetadata) {
                try {
                    const json = JSON.parse(sdNextMetadata);
                    const secondary: Partial<ImageMetadata> = {};
                    if (json.parameters) {
                        const a1111 = parseA1111Parameters(json.parameters);
                        mergeMetadata(secondary, a1111);
                    } else if (json.prompt) {
                        secondary.positivePrompt = json.prompt;
                        if (json.negative_prompt) secondary.negativePrompt = json.negative_prompt;
                        if (json.seed) secondary.seed = Number(json.seed);
                        if (json.steps) secondary.steps = Number(json.steps);
                    }
                    secondary.tool = GeneratorTool.SDNEXT;
                    mergeMetadata(metadata, secondary);
                } catch { }
            }

            // 3. ComfyUI (Cumulative)
            const workflow = chunks.workflow || chunks.prompt;
            if (workflow) {
                try {
                    const json = JSON.parse(workflow);
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
                    const json = JSON.parse(invokeMeta);
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
