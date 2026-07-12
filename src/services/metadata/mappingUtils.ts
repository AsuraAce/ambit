import { AIImage, GeneratorTool, ImageMetadata } from '../../types';
import { mapRawInvokeMetadata } from '../invoke/metadataMapper';

type MetadataRecord = Record<string, unknown>;
type ComfyNode = MetadataRecord & {
    id?: string | number;
    class_type?: string;
    type?: string;
    inputs?: MetadataRecord;
    widgets_values?: unknown[];
};

const isRecord = (value: unknown): value is MetadataRecord =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value: unknown): MetadataRecord => isRecord(value) ? value : {};

const asComfyNode = (value: unknown): ComfyNode => asRecord(value) as ComfyNode;

const readString = (record: MetadataRecord, key: string): string | undefined => {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
};

const readNumber = (record: MetadataRecord, key: string): number | undefined => {
    const value = record[key];
    return typeof value === 'number' ? value : undefined;
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

    const toolLower = tool.toLowerCase();

    // If chunks is a raw string, we might need to parse it (could be JSON object or JSON-escaped string)
    if (typeof chunks === 'string') {
        const trimmed = chunks.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
            try {
                const parsed = JSON.parse(trimmed);
                // If it parsed as a string (was a JSON-escaped string), 
                // we recurse to handle the unescaped content.
                // If it parsed as an object, we recurse to use object mapping.
                return mapRawChunksToMetadata(parsed, tool);
            } catch { /* ignore and treat as raw text */ }
        }

        // It's a raw string, not JSON-encoded object/string
        if (toolLower.includes('comfy')) {
            return { tool: GeneratorTool.COMFYUI, workflowJson: chunks };
        } else if (toolLower.includes('invoke')) {
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
    } else if (chunkRecord.workflow || (chunkRecord.prompt && typeof chunkRecord.prompt === 'object') || chunkRecord.nodes || Object.keys(chunkRecord).some(k => !isNaN(Number(k)))) {
        detectedTool = GeneratorTool.COMFYUI;
    } else if (chunkRecord.invokeai_metadata || chunkRecord['sd-metadata'] || chunkRecord.dream_metadata || (isRecord(chunkRecord.image) && chunkRecord.image.prompt)) {
        detectedTool = GeneratorTool.INVOKEAI;
    }

    const effectiveToolLower = detectedTool.toLowerCase();

    // 2. ComfyUI flat structure check (no 'prompt'/'workflow' keys, just nodes/IDs)
    if (effectiveToolLower.includes('comfy') && (chunkRecord.nodes || Object.keys(chunkRecord).some(k => !isNaN(Number(k))))) {
        const metadata: Partial<ImageMetadata> = { tool: GeneratorTool.COMFYUI, workflowJson: JSON.stringify(chunkRecord) };
        parseComfyUIMetadata(chunkRecord, metadata);
        return metadata;
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
                try {
                    const json = typeof workflow === 'string' ? JSON.parse(workflow) : workflow;
                    const metadata: Partial<ImageMetadata> = { tool: GeneratorTool.COMFYUI, workflowJson: workflowStr };
                    parseComfyUIMetadata(json, metadata);
                    return metadata;
                } catch { /* ignore */ }
            }
            return { tool: GeneratorTool.COMFYUI };
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

/**
 * Standard ComfyUI parameter parser (extracted from metadata worker).
 */
export function parseComfyUIMetadata(json: unknown, metadata: Partial<ImageMetadata>) {
    const root = asRecord(json);
    const rawNodes = root.nodes
        ? (Array.isArray(root.nodes) ? root.nodes : Object.values(asRecord(root.nodes)))
        : Object.values(root);
    const nodes = rawNodes.map(asComfyNode);
    const loras = new Set<string>();

    let checkpointNode: ComfyNode | null = null;
    const candidateSamplers: ComfyNode[] = [];

    for (const node of nodes) {
        const type = String(node.class_type || node.type);
        const inputs = asRecord(node.inputs);

        if (type === 'KSampler' || type === 'KSamplerAdvanced' || type === 'SDParameterGenerator' || type === 'SDPromptSaver' || (type.includes('KSampler') && !type.includes('Context'))) {
            candidateSamplers.push(node);
        }

        if (!checkpointNode && (
            type === 'CheckpointLoaderSimple' ||
            type === 'CheckpointLoader' ||
            type === 'Load Checkpoint' ||
            type === 'UNETLoader' ||
            type === 'DiffusersLoader'
        )) {
            checkpointNode = node;
        }

        Object.keys(inputs).forEach(key => {
            if (key.startsWith('lora_name')) {
                const val = inputs[key];
                if (typeof val === 'string' && val !== 'None' && val.length > 0) {
                    loras.add(val);
                }
            }
        });
    }

    if (loras.size > 0) metadata.loras = Array.from(loras);

    if (candidateSamplers.length > 0) {
        candidateSamplers.sort((a, b) => {
            const idA = Number(a.id) || 999999;
            const idB = Number(b.id) || 999999;
            return idA - idB;
        });

        const mainSampler = candidateSamplers[0];
        const type = String(mainSampler.class_type || mainSampler.type);
        const w = mainSampler.widgets_values;

        if (Array.isArray(w)) {
            const isAdvanced = type.includes('Advanced');

            if (!isAdvanced) {
                // Standard KSampler or Efficiency Nodes
                const isEfficiency = type === 'SDParameterGenerator' || type === 'SDPromptSaver';
                const isPipe = type.includes('Pipe');

                if (isEfficiency) {
                    const sIdx = (type === 'SDParameterGenerator') ? 4 : 3;
                    const stIdx = 5;
                    const cIdx = (type === 'SDParameterGenerator') ? 7 : 6;
                    const smIdx = (type === 'SDParameterGenerator') ? 8 : 7;

                    if (typeof w[sIdx] === 'number') metadata.seed = w[sIdx];
                    if (typeof w[stIdx] === 'number') metadata.steps = w[stIdx];
                    if (typeof w[cIdx] === 'number') metadata.cfg = w[cIdx];
                    if (typeof w[smIdx] === 'string') {
                        metadata.sampler = w[smIdx];
                        if (typeof w[smIdx + 1] === 'string' && w[smIdx + 1] !== 'normal') metadata.sampler += ` (${w[smIdx + 1]})`;
                    }
                } else {
                    // KSampler or KSamplerPipe
                    const sIdx = isPipe ? 1 : 0;
                    const stIdx = isPipe ? 3 : 2;
                    const cIdx = isPipe ? 4 : 3;
                    const smIdx = isPipe ? 5 : 4;
                    const schIdx = isPipe ? 6 : 5;

                    if (typeof w[sIdx] === 'number') metadata.seed = w[sIdx];
                    if (typeof w[stIdx] === 'number') metadata.steps = w[stIdx];
                    if (typeof w[cIdx] === 'number') metadata.cfg = w[cIdx];
                    if (typeof w[smIdx] === 'string') {
                        metadata.sampler = w[smIdx];
                        if (typeof w[schIdx] === 'string' && w[schIdx] !== 'normal') metadata.sampler += ` (${w[schIdx]})`;
                    }
                }
            } else {
                // KSamplerAdvanced and variants
                // Standard KSamplerAdvanced: add_noise(0), seed(1), control(2), steps(3), start(4), end(5), cfg(6), sampler(7), scheduler(8)
                if (w.length >= 9) {
                    if (typeof w[1] === 'number') metadata.seed = w[1];
                    if (typeof w[3] === 'number') metadata.steps = w[3];
                    if (typeof w[6] === 'number') metadata.cfg = w[6];
                    if (typeof w[7] === 'string') {
                        metadata.sampler = w[7];
                        if (typeof w[8] === 'string' && w[8] !== 'normal') metadata.sampler += ` (${w[8]})`;
                    }
                } else if (w.length >= 7) {
                    // Fallback/Legacy/Simplified advanced
                    if (typeof w[1] === 'number') metadata.seed = w[1];
                    if (typeof w[3] === 'number') metadata.steps = w[3];
                    if (typeof w[4] === 'number') metadata.cfg = w[4];
                    if (typeof w[5] === 'string') {
                        metadata.sampler = w[5];
                        if (typeof w[6] === 'string' && w[6] !== 'normal') metadata.sampler += ` (${w[6]})`;
                    }
                }
            }
        }

        if (checkpointNode) {
            if (Array.isArray(checkpointNode.widgets_values) && checkpointNode.widgets_values.length > 0) {
                const rawName = checkpointNode.widgets_values.find((v: unknown) =>
                    typeof v === 'string' && /\.(safetensors|ckpt|pt|bin|sft)$/i.test(v)
                );
                if (typeof rawName === 'string') {
                    metadata.model = rawName.replace(/\.(safetensors|ckpt|pt|sft|bin)$/i, '').split(/[\\/]/).pop();
                }
            } else if (checkpointNode.inputs) {
                const inputs = asRecord(checkpointNode.inputs);
                const rawName = inputs.unet_name || inputs.ckpt_name || inputs.model_name;
                if (typeof rawName === 'string') {
                    metadata.model = rawName.replace(/\.(safetensors|ckpt|pt|sft|bin)$/i, '').split(/[\\/]/).pop();
                }
            }
        }
    }
}
