import { GeneratorTool, ImageMetadata } from '../../types';
import { mapRawInvokeMetadata } from '../invoke/metadataMapper';

type MetadataRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is MetadataRecord =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value: unknown): MetadataRecord => isRecord(value) ? value : {};

const readString = (record: MetadataRecord, key: string): string | undefined => {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
};

const readNumber = (record: MetadataRecord, key: string): number | undefined => {
    const value = record[key];
    return typeof value === 'number' ? value : undefined;
};

const hasNumericNodeKeys = (record: MetadataRecord): boolean =>
    Object.keys(record).some(k => !isNaN(Number(k)));

const isComfyWorkflowRecord = (record: MetadataRecord): boolean =>
    Boolean(record.workflow || (record.prompt && typeof record.prompt === 'object') || record.nodes || hasNumericNodeKeys(record));

const toComfyMetadata = (workflowJson?: string): Partial<ImageMetadata> => {
    const metadata: Partial<ImageMetadata> = { tool: GeneratorTool.COMFYUI };
    if (workflowJson) {
        metadata.workflowJson = workflowJson;
        metadata.hasWorkflowHint = true;
    }
    return metadata;
};

/**
 * Maps raw PNG/EXIF chunks to the standard ImageMetadata format based on the detected tool.
 * This is used to reconstruct "Original" metadata for comparison in the UI.
 * 
 * NOTE: This must be HIGHLY ROBUST and match the Rust-side reparse logic 
 * (`src-tauri/src/metadata/reparse.rs`) to prevent data loss on revert.
 */
export function mapRawChunksToMetadata(chunks: unknown, tool: GeneratorTool): Partial<ImageMetadata> {
    if (!chunks) return {};

    const toolLower = tool?.toLowerCase() || "";

    // If chunks is a raw string, we might need to parse it (could be JSON object or JSON-escaped string)
    if (typeof chunks === 'string') {
        const trimmed = chunks.trim();
        if (toolLower.includes('comfy')) {
            if (trimmed.startsWith('"')) {
                try {
                    return toComfyMetadata(JSON.parse(trimmed) as string);
                } catch { /* ignore and preserve the raw string */ }
            }
            return toComfyMetadata(chunks);
        }

        if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
            try {
                const parsed = JSON.parse(trimmed);
                // If it parsed as a string (was a JSON-escaped string), 
                // we recurse to handle the unescaped content.
                // If it parsed as an object, we recurse to use object mapping.
                if (isRecord(parsed) && isComfyWorkflowRecord(parsed)) {
                    return toComfyMetadata(chunks);
                }
                return mapRawChunksToMetadata(parsed, tool);
            } catch { /* ignore and treat as raw text */ }
        }

        // It's a raw string, not JSON-encoded object/string
        if (toolLower.includes('invoke')) {
            return mapRawInvokeMetadata(chunks);
        } else {
            // A1111, SD.Next, Forge etc.
            return parseA1111Parameters(chunks, tool);
        }
    }

    // --- Object-based Mapping & Tool Detection ---
    const chunkRecord = asRecord(chunks);
    if (Object.keys(chunkRecord).length === 0) {
        if (toolLower.includes('invoke')) return mapRawInvokeMetadata(chunkRecord);
        if (toolLower.includes('comfy')) return { tool: GeneratorTool.COMFYUI };
        return {};
    }

    // 1. Detect tool from chunks if possible (overrides the passed tool argument)
    let detectedTool = tool;
    if (chunkRecord.parameters || chunkRecord.Parameters || chunkRecord.PARAMETERS) {
        detectedTool = GeneratorTool.AUTOMATIC1111;
    } else if (isComfyWorkflowRecord(chunkRecord)) {
        detectedTool = GeneratorTool.COMFYUI;
    } else if (chunkRecord.invokeai_metadata || chunkRecord['sd-metadata'] || chunkRecord.dream_metadata || (isRecord(chunkRecord.image) && chunkRecord.image.prompt)) {
        detectedTool = GeneratorTool.INVOKEAI;
    }

    const effectiveToolLower = detectedTool?.toLowerCase() || "";

    // 2. ComfyUI flat structure check (no 'prompt'/'workflow' keys, just nodes/IDs)
    if (effectiveToolLower.includes('comfy') && (chunkRecord.nodes || hasNumericNodeKeys(chunkRecord))) {
        return toComfyMetadata(JSON.stringify(chunkRecord));
    }

    switch (detectedTool) {
        case GeneratorTool.AUTOMATIC1111:
        case GeneratorTool.SDNEXT:
        case GeneratorTool.FORGE:
        case GeneratorTool.ANAPNOE: {
            // Check for direct parameters key (standard in A1111 PNG chunks)
            const text = chunkRecord.parameters || chunkRecord.Parameters || chunkRecord.PARAMETERS;
            if (text && typeof text === 'string') return parseA1111Parameters(text, detectedTool);

            // If it's a JSON blob from SDNext that was already parsed
            if (typeof chunkRecord.prompt === 'string') {
                const metadata: Partial<ImageMetadata> = {
                    tool: detectedTool,
                    positivePrompt: chunkRecord.prompt,
                    negativePrompt: readString(chunkRecord, 'negative_prompt') || '',
                    seed: readNumber(chunkRecord, 'seed'),
                    steps: readNumber(chunkRecord, 'steps'),
                    cfg: readNumber(chunkRecord, 'cfg') ?? readNumber(chunkRecord, 'cfg_scale')
                };
                return metadata;
            }
            break;
        }

        case GeneratorTool.COMFYUI: {
            // ComfyUI usually stores workflow/prompt as JSON strings within these keys
            const workflow = chunkRecord.workflow || chunkRecord.prompt;
            if (workflow) {
                const workflowStr = typeof workflow === 'string' ? workflow : JSON.stringify(workflow);
                return toComfyMetadata(workflowStr);
            }
            return toComfyMetadata();
        }

        case GeneratorTool.INVOKEAI: {
            // High-fidelity mapping for InvokeAI
            return mapRawInvokeMetadata(chunkRecord);
        }
    }

    return {};
}

/**
 * Standard A1111 parameter parser (extracted from metadata worker).
 */
export function parseA1111Parameters(text: string, defaultTool?: GeneratorTool): Partial<ImageMetadata> {
    const metadata: Partial<ImageMetadata> = {
        tool: (defaultTool && defaultTool !== GeneratorTool.UNKNOWN) ? defaultTool : GeneratorTool.AUTOMATIC1111,
        rawParameters: text
    };

    const lines = text.split('\n').map(l => l.trim());
    let positiveParts: string[] = [];
    let negativePrompt = "";
    let paramsLine = "";
    let state = 0; // 0: positive, 1: negative, 2: params

    for (const line of lines) {
        if (line.startsWith("Negative prompt: ")) {
            state = 1;
            negativePrompt = line.substring(17).trim();
        } else if (line.startsWith("Steps: ")) {
            state = 2;
            paramsLine = line.trim();
        } else if (state === 0) {
            positiveParts.push(line);
        } else if (state === 1) {
            negativePrompt += " " + line;
        }
    }

    metadata.positivePrompt = positiveParts.join("\n").trim();
    metadata.negativePrompt = negativePrompt.trim();

    // --- Extract LoRAs from Prompts ---
    const loraRegex = /<lora:([^:>]+)(?::([0-9\.]+))?>/gi;
    const loras = new Set<string>();
    const prompts = [metadata.positivePrompt, metadata.negativePrompt];
    for (const p of prompts) {
        if (!p) continue;
        const matches = Array.from(p.matchAll(loraRegex));
        for (const match of matches) {
            const name = match[1].trim();
            const weightStr = match[2];
            if (name) {
                loras.add(name); // Ensure base name is always there
                if (weightStr) {
                    const weight = parseFloat(weightStr);
                    if (!isNaN(weight) && Math.abs(weight - 1.0) > 0.001) {
                        loras.add(`${name} (${weight.toFixed(2)})`);
                    }
                }
            }
        }
    }
    if (loras.size > 0) metadata.loras = Array.from(loras);

    // --- Extract Hypernetworks from Prompts ---
    const hypernetRegex = /<hypernet:([^:>]+)(?::([0-9\.]+))?>/gi;
    const hypernets = new Set<string>();
    for (const p of prompts) {
        if (!p) continue;
        const matches = Array.from(p.matchAll(hypernetRegex));
        for (const match of matches) {
            const name = match[1].trim();
            const weightStr = match[2];
            let entry = name;
            if (weightStr) {
                const weight = parseFloat(weightStr);
                if (!isNaN(weight) && Math.abs(weight - 1.0) > 0.001) {
                    entry = `${name} (${weight.toFixed(2)})`;
                }
            }
            if (entry) hypernets.add(entry);
        }
    }
    if (hypernets.size > 0) metadata.hypernetworks = Array.from(hypernets);

    // --- Extract Embeddings from Prompts ---
    const embeddingRegex = /(embedding:|<embedding:|<)([a-zA-Z0-9_\-\.]+)([:>])?/gi;
    const embeddings = new Set<string>();
    for (const p of prompts) {
        if (!p) continue;
        const matches = Array.from(p.matchAll(embeddingRegex));
        for (const match of matches) {
            const prefix = match[1].toLowerCase();
            const name = match[2];
            const closing = match[3] || '';

            if (prefix === "<") {
                if (closing !== ">") continue;
                const nameLower = name.toLowerCase();
                if (nameLower === "lora" || nameLower === "hypernet" || nameLower.startsWith("lora:") || nameLower.startsWith("hypernet:")) {
                    continue;
                }
            }
            if (name && name.length >= 2) embeddings.add(name);
        }
    }
    if (embeddings.size > 0) metadata.embeddings = Array.from(embeddings);

    if (paramsLine) {
        const parts = paramsLine.split(', ');
        for (const part of parts) {
            const [key, ...valParts] = part.split(': ');
            if (valParts.length > 0) {
                const k = key.trim();
                const v = valParts.join(': ').trim();

                switch (k) {
                    case 'Steps': metadata.steps = parseInt(v); break;
                    case 'Sampler': metadata.sampler = v; break;
                    case 'CFG scale': metadata.cfg = parseFloat(v); break;
                    case 'Seed': metadata.seed = parseInt(v); break;
                    case 'Model':
                    case 'Checkpoint':
                    case 'Model name':
                    case 'SD model':
                        metadata.model = v;
                        break;
                    case 'VAE': metadata.vae = v; break;
                    case 'Clip skip': metadata.clipSkip = parseInt(v); break;
                    case 'Denoising strength': metadata.denoisingStrength = parseFloat(v); break;
                    case 'Hires upscale': metadata.hiresUpscale = parseFloat(v); break;
                    case 'Hires steps': metadata.hiresSteps = parseInt(v); break;
                    case 'Hires upscaler': metadata.hiresUpscaler = v; break;
                    case 'Model hash': metadata.modelHash = v; break;
                    case 'App': {
                        const lowVal = v.toLowerCase();
                        if (lowVal.includes('sd.next') || lowVal.includes('sdnext')) {
                            metadata.tool = GeneratorTool.SDNEXT;
                        } else if (lowVal.includes('forge')) {
                            metadata.tool = GeneratorTool.FORGE;
                        } else if (lowVal.includes('anapnoe')) {
                            metadata.tool = GeneratorTool.ANAPNOE;
                        }
                        break;
                    }
                    case 'Version': {
                        const lowVal = v.toLowerCase();
                        if (metadata.tool === GeneratorTool.AUTOMATIC1111 || !metadata.tool) {
                            if (lowVal.includes('vlad') || lowVal.includes('next') || lowVal.includes('sd.next')) {
                                metadata.tool = GeneratorTool.SDNEXT;
                            } else if (lowVal.includes('forge') || lowVal.startsWith('f')) {
                                metadata.tool = GeneratorTool.FORGE;
                            } else if (lowVal.includes('anapnoe')) {
                                metadata.tool = GeneratorTool.ANAPNOE;
                            } else if (lowVal.includes('comfy')) {
                                metadata.tool = GeneratorTool.COMFYUI;
                            }
                        }
                        break;
                    }
                    case 'TI hashes': {
                        if (!metadata.embeddings) metadata.embeddings = [];
                        const parts = v.split(',');
                        for (const part of parts) {
                            const [name] = part.split(':');
                            const embName = name?.trim().replace(/^"|"$/g, '') || '';
                            if (embName && !metadata.embeddings.includes(embName)) {
                                metadata.embeddings.push(embName);
                            }
                        }
                        break;
                    }
                }

                if (k.startsWith('ControlNet')) {
                    const modelMatch = v.match(/Model: ([^,"]+)/);
                    if (modelMatch) {
                        if (!metadata.controlNets) metadata.controlNets = [];
                        const modelName = modelMatch[1].trim();
                        if (!metadata.controlNets.includes(modelName)) {
                            metadata.controlNets.push(modelName);
                        }
                    }
                } else if (k === 'Lora hashes') {
                    if (!metadata.loras) metadata.loras = [];
                    const parts = v.split(',');
                    for (const part of parts) {
                        const [name] = part.split(':');
                        const loraName = name.trim().replace(/^"|"$/g, '');
                        if (loraName && !metadata.loras.includes(loraName)) {
                            metadata.loras.push(loraName);
                        }
                    }
                }
            }
        }
    }
    return metadata;
}
