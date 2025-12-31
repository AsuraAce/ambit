
// We redefine types here to avoid complex import issues in simple workers, 
// or we could configure Vite to handle it. For robustness, we redefine the minimal set.

export enum GeneratorTool {
    AUTOMATIC1111 = 'Automatic1111',
    COMFYUI = 'ComfyUI',
    INVOKEAI = 'InvokeAI',
    MIDJOURNEY = 'Midjourney',
    SDNEXT = 'SD.Next',
    FORGE = 'Forge',
    ANAPNOE = 'Anapnoe',
    UNKNOWN = 'Unknown'
}

export interface ImageMetadata {
    tool: GeneratorTool;
    model: string;
    steps: number;
    cfg: number;
    seed: number;
    sampler: string;
    positivePrompt: string;
    negativePrompt: string;
    workflowJson?: string;
    rawParameters?: string;
    tiled?: boolean;
    upscaled?: boolean;
    notes?: string;
    variationId?: string;
    loras?: string[];
    controlNets?: string[];
    ipAdapters?: string[];
    vae?: string;
    clipSkip?: number;
    denoisingStrength?: number;
    hiresUpscale?: number;
    hiresSteps?: number;
    hiresUpscaler?: string;
    modelHash?: string;
    generationType?: 'txt2img' | 'img2img' | 'extras' | 'grid' | 'unknown';
}

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

const parseFilenameMetadata = (filename: string): Partial<ImageMetadata> => {
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
            model: 'Unknown',
            positivePrompt: '',
            steps: 0,
            cfg: 0,
            seed: 0
        };
    }

    return {
        tool: GeneratorTool.UNKNOWN,
        model: 'Unknown',
        positivePrompt: '',
        steps: 0,
        cfg: 0,
        seed: 0
    };
};

const parseA1111Parameters = (text: string, metadata: Partial<ImageMetadata>) => {
    const lines = text.split('\n');
    let positivePrompt = [];
    let negativePrompt = '';
    let paramsLine = '';
    let isNegative = false;

    for (const line of lines) {
        if (line.startsWith('Negative prompt:')) {
            isNegative = true;
            negativePrompt += line.substring(16).trim();
        } else if (line.startsWith('Steps: ')) {
            paramsLine = line;
        } else if (isNegative) {
            if (!line.startsWith('Steps: ')) negativePrompt += ' ' + line.trim();
            else paramsLine = line;
        } else {
            positivePrompt.push(line);
        }
    }

    metadata.positivePrompt = positivePrompt.join(' ').trim();
    metadata.negativePrompt = negativePrompt.trim();

    const loraRegex = /<lora:([^:>]+)(?::[^>]+)?>/g;
    const loras = new Set<string>();
    let match;
    while ((match = loraRegex.exec(metadata.positivePrompt)) !== null) {
        loras.add(match[1]);
    }
    if (loras.size > 0) metadata.loras = Array.from(loras);

    const pairs = paramsLine.split(', ');
    let foundModel = false;
    let variationSeed = '';
    let variationStrength = '';

    pairs.forEach(pair => {
        const [key, value] = pair.split(': ');
        if (!value) return;
        if (key === 'Steps') metadata.steps = parseInt(value);
        if (key === 'Sampler') metadata.sampler = value;
        if (key === 'CFG scale') metadata.cfg = parseFloat(value);
        if (key === 'Seed') metadata.seed = parseInt(value);
        if (key === 'Variation seed') variationSeed = value;
        if (key === 'Variation seed strength') variationStrength = value;
        if (key === 'Model' && value.trim().length > 0 && value !== 'Unknown') {
            metadata.model = value;
            foundModel = true;
        }

        if (key === 'VAE') metadata.vae = value;
        if (key === 'Clip skip') metadata.clipSkip = parseInt(value);
        if (key === 'Denoising strength') metadata.denoisingStrength = parseFloat(value);
        if (key === 'Hires upscale') metadata.hiresUpscale = parseFloat(value);
        if (key === 'Hires steps') metadata.hiresSteps = parseInt(value);
        if (key === 'Hires upscaler') metadata.hiresUpscaler = value;
        if (key === 'Model hash' || key === 'sd_model_hash') {
            if (!metadata.modelHash) metadata.modelHash = value;
        }

        if (key.startsWith('ControlNet')) {
            const modelMatch = value.match(/Model: ([^,]+)/);
            if (modelMatch) {
                if (!metadata.controlNets) metadata.controlNets = [];
                const modelName = modelMatch[1].trim();
                if (!metadata.controlNets.includes(modelName)) {
                    metadata.controlNets.push(modelName);
                }
            }
        }

        if (key === 'Version' && value.toLowerCase().includes('comfy')) {
            metadata.tool = GeneratorTool.COMFYUI;
        }

        // SD.Next often sets "App: SD.Next"
        if (key === 'App' && value.toLowerCase().includes('sd.next')) {
            metadata.tool = GeneratorTool.SDNEXT;
        }

        // Forge might not set "App" but if Version says Forge?
        // (This is heuristic based on common behavior in forks)
        if (key === 'App' && value.toLowerCase().includes('forge')) {
            metadata.tool = GeneratorTool.FORGE;
        }

        // Some versions of Forge might put it in Version
        if (key === 'Version' && value.toLowerCase().includes('forge')) {
            metadata.tool = GeneratorTool.FORGE;
        }

        if (!foundModel && !metadata.model && key === 'VAE' && value === 'FLUX') {
            metadata.model = 'Flux.1';
        }
    });

    if (variationSeed && variationStrength) {
        metadata.variationId = `${variationSeed}:${variationStrength}`;
    }
};

const parseComfyUIMetadata = (json: any, metadata: Partial<ImageMetadata>) => {
    const nodes = json.nodes ? json.nodes : Object.values(json);
    const loras = new Set<string>();

    let checkpointNode: any = null;
    const candidateSamplers: any[] = [];

    // Pass 1: Identify key nodes
    for (const node of nodes) {
        const type = node.class_type || node.type || "";
        const inputs = node.inputs || node.widgets_values || {};

        if (type === 'KSampler' || type === 'KSamplerAdvanced' || (type.includes('KSampler') && !type.includes('Context'))) {
            candidateSamplers.push(node);
        }

        if (!checkpointNode && (
            type === 'CheckpointLoaderSimple' ||
            type === 'CheckpointLoader' ||
            type === 'Load Checkpoint' ||
            type === 'UNETLoader' ||
            type === 'DiffusersLoader' ||
            type === 'SDParameterGenerator'
        )) {
            checkpointNode = node;
        }

        if (inputs) {
            Object.keys(inputs).forEach(key => {
                if (key.startsWith('lora_name')) {
                    const val = inputs[key];
                    if (typeof val === 'string' && val !== 'None' && val.length > 0) {
                        loras.add(val);
                    }
                }

                if (key === 'loras' && typeof inputs[key] === 'object') {
                    const stack = inputs[key]?.__value__;
                    if (Array.isArray(stack)) {
                        stack.forEach((item: any) => {
                            if (item.name && typeof item.name === 'string' && item.active !== false) {
                                loras.add(item.name);
                            }
                        });
                    }
                }
            });
        }
    }

    if (loras.size > 0) metadata.loras = Array.from(loras);

    // Pass 2: Select "First" Sampler
    if (candidateSamplers.length > 0) {
        candidateSamplers.sort((a, b) => {
            const orderA = typeof a.order === 'number' ? a.order : (parseInt(a.id) || 999999);
            const orderB = typeof b.order === 'number' ? b.order : (parseInt(b.id) || 999999);
            return orderA - orderB;
        });

        const mainSampler = candidateSamplers[0];
        const type = mainSampler.class_type || mainSampler.type || "";

        // Extract Params from Main Sampler
        if (Array.isArray(mainSampler.widgets_values)) {
            const w = mainSampler.widgets_values;
            if (type === 'KSampler' && w.length >= 6) {
                if (typeof w[0] === 'number' || typeof w[0] === 'bigint') metadata.seed = Number(w[0]);
                if (typeof w[2] === 'number') metadata.steps = Number(w[2]);
                if (typeof w[3] === 'number') metadata.cfg = Number(w[3]);

                if (typeof w[4] === 'string') {
                    metadata.sampler = w[4];
                    if (typeof w[5] === 'string' && w[5] !== 'normal') metadata.sampler += ` ${w[5]}`;
                }
            } else if (type === 'KSamplerAdvanced' && w.length >= 7) {
                if (typeof w[1] === 'number' || typeof w[1] === 'bigint') metadata.seed = Number(w[1]);
                if (typeof w[3] === 'number') metadata.steps = Number(w[3]);
                if (typeof w[4] === 'number') metadata.cfg = Number(w[4]);

                if (typeof w[5] === 'string') {
                    metadata.sampler = w[5];
                    if (typeof w[6] === 'string' && w[6] !== 'normal') metadata.sampler += ` ${w[6]}`;
                }
            } else {
                for (let i = 0; i < Math.min(w.length, 5); i++) {
                    const val = w[i];
                    if (typeof val === 'number' || typeof val === 'bigint') {
                        const num = Number(val);
                        if (num > 10000000 && !metadata.seed) metadata.seed = num;
                        else if (num > 0 && num <= 200 && !metadata.steps && Number.isInteger(num)) metadata.steps = num;
                        else if (num > 0 && num <= 50 && !metadata.cfg && !Number.isInteger(num)) metadata.cfg = num;
                    }
                }
            }
        }
        else {
            const inputs = mainSampler.inputs || mainSampler.widgets_values;
            if (inputs && !Array.isArray(inputs)) {
                if (inputs.seed !== undefined) metadata.seed = Number(inputs.seed);
                else if (inputs.noise_seed !== undefined) metadata.seed = Number(inputs.noise_seed);

                if (inputs.steps !== undefined) metadata.steps = Number(inputs.steps);
                if (inputs.cfg !== undefined) metadata.cfg = Number(inputs.cfg);

                if (inputs.sampler_name && typeof inputs.sampler_name === 'string') {
                    metadata.sampler = inputs.sampler_name;
                    if (inputs.scheduler && typeof inputs.scheduler === 'string' && inputs.scheduler !== 'normal') {
                        metadata.sampler += ` ${inputs.scheduler}`;
                    }
                }
            }
        }

        // Trace Prompts for Main Sampler
        const inputs = mainSampler.inputs || [];
        let posLink = null;
        let negLink = null;

        if (Array.isArray(inputs)) {
            const p = inputs.find((i: any) => i.name === 'positive');
            if (p) posLink = p.link;
            const n = inputs.find((i: any) => i.name === 'negative');
            if (n) negLink = n.link;
        } else {
            if (inputs.positive) posLink = Array.isArray(inputs.positive) ? inputs.positive[0] : inputs.positive;
            if (inputs.negative) negLink = Array.isArray(inputs.negative) ? inputs.negative[0] : inputs.negative;
        }

        if (posLink) {
            const source = findNodeByOutputLink(nodes, posLink);
            if (source) {
                const text = traceText(nodes, source.node.id, source.slotIndex);
                if (text) metadata.positivePrompt = text;
            }
        }

        if (negLink) {
            const source = findNodeByOutputLink(nodes, negLink);
            if (source) {
                const text = traceText(nodes, source.node.id, source.slotIndex);
                if (text) metadata.negativePrompt = text;
            }
        }
    }

    // Fallback: Scan ALL nodes
    if (!metadata.positivePrompt) {
        const potentialPrompts: { text: string, type: 'pos' | 'neg' | 'unknown', length: number }[] = [];

        nodes.forEach((node: any) => {
            if (node.mode === 2 || node.mode === 4) return;

            const type = (node.class_type || node.type || "").toLowerCase();
            const title = (node.title || node._meta?.title || "").toLowerCase();

            if (type.includes('textencode') || type.includes('cliptext') || type.includes('advancedprompt') || type.includes('prompts') || (node.widgets_values && node.widgets_values.some((w: any) => typeof w === 'string' && w.length > 20))) {
                if (node.widgets_values) {
                    const strings = node.widgets_values.filter((v: any) => typeof v === 'string' && v.trim().length > 0);
                    if (strings.length > 0) {
                        const text = strings.reduce((a: string, b: string) => a.length > b.length ? a : b);
                        if (text.length < 3) return;

                        let flavor: 'pos' | 'neg' | 'unknown' = 'unknown';
                        if (title.includes('negative')) flavor = 'neg';
                        else if (title.includes('positive') || title.includes('prompt')) flavor = 'pos';

                        potentialPrompts.push({ text, type: flavor, length: text.length });
                    }
                }
            }
        });

        const explicitPos = potentialPrompts.find(p => p.type === 'pos');
        if (explicitPos) {
            metadata.positivePrompt = explicitPos.text;
        }
        else {
            const unknowns = potentialPrompts.filter(p => p.type === 'unknown');
            if (unknowns.length > 0) {
                unknowns.sort((a, b) => b.length - a.length);
                metadata.positivePrompt = unknowns[0].text;
            }
        }

        if (!metadata.negativePrompt) {
            const explicitNeg = potentialPrompts.find(p => p.type === 'neg');
            if (explicitNeg) {
                metadata.negativePrompt = explicitNeg.text;
            }
        }
    }

    if (checkpointNode) {
        let rawName: string | null = null;
        if (Array.isArray(checkpointNode.widgets_values) && checkpointNode.widgets_values.length > 0) {
            const modelFile = checkpointNode.widgets_values.find((v: any) =>
                typeof v === 'string' && /\.(safetensors|ckpt|pt|bin|sft)$/i.test(v)
            );
            if (modelFile) rawName = modelFile;
            else if (typeof checkpointNode.widgets_values[0] === 'string') rawName = checkpointNode.widgets_values[0];
        }

        if (!rawName && checkpointNode.inputs && !Array.isArray(checkpointNode.inputs)) {
            rawName = checkpointNode.inputs.unet_name || checkpointNode.inputs.ckpt_name || checkpointNode.inputs.model_name;
        }

        if (rawName && typeof rawName === 'string') {
            const parts = rawName.split(/[\\/]/);
            let name = parts[parts.length - 1];
            name = name.replace(/\.(safetensors|ckpt|pt|sft|bin)$/i, '');
            if (name.length > 0) {
                metadata.model = name;
            }
        }
    }
};

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

// Worker Message Handler
self.onmessage = (e: MessageEvent) => {
    let { chunks, buffer, filename, requestId, path } = e.data;

    if (!chunks && buffer) {
        chunks = parsePngChunks(buffer);
    }

    if (!chunks && !filename) {
        self.postMessage({ error: 'No data provided', requestId });
        return;
    }

    try {
        const metadata: Partial<ImageMetadata> = {};
        const extra: ParseResult['extra'] = {};
        let isIntermediate = false;
        let foundAuthoritative = false;

        if (chunks) {
            // A1111
            if (chunks.parameters) {
                parseA1111Parameters(chunks.parameters, metadata);
                metadata.rawParameters = chunks.parameters;
                metadata.tool = GeneratorTool.AUTOMATIC1111;
                foundAuthoritative = true;
            }

            // ComfyUI
            const workflow = chunks.workflow || chunks.prompt;
            if (workflow) {
                try {
                    const json = JSON.parse(workflow);
                    parseComfyUIMetadata(json, metadata);
                    metadata.tool = GeneratorTool.COMFYUI;
                    metadata.workflowJson = workflow;
                    foundAuthoritative = true;
                } catch { }
            }

            // InvokeAI
            const invokeMeta = chunks.invokeai_metadata || chunks['sd-metadata'] || chunks.dream_metadata;
            if (invokeMeta) {
                try {
                    const json = JSON.parse(invokeMeta);
                    parseInvokeAIMetadata(json, metadata, extra);
                    metadata.rawParameters = invokeMeta;
                    foundAuthoritative = true;
                } catch { }
            }

            // InvokeAI Workflow
            const workflowChunk = chunks.invokeai_workflow || chunks.invokeai_graph || chunks.workflow || chunks.graph;
            if (workflowChunk) {
                metadata.workflowJson = workflowChunk;
                metadata.tool = GeneratorTool.INVOKEAI;
                foundAuthoritative = true;
            }
        }

        if (!foundAuthoritative) {
            const filenameMeta = parseFilenameMetadata(filename || 'unknown');
            metadata.positivePrompt = metadata.positivePrompt || filenameMeta.positivePrompt;
            metadata.tool = metadata.tool || filenameMeta.tool;
            metadata.model = metadata.model || filenameMeta.model;
        }

        if (metadata.tool === GeneratorTool.UNKNOWN) {
            isIntermediate = true;
        }

        // Path-based generation type detection (A1111 standard)
        if (path) {
            const lowerPath = path.toLowerCase().replace(/\\/g, '/');
            if (lowerPath.includes('/txt2img-images') || lowerPath.includes('/outputs/txt2img')) {
                metadata.generationType = 'txt2img';
            } else if (lowerPath.includes('/img2img-images') || lowerPath.includes('/outputs/img2img')) {
                metadata.generationType = 'img2img';
            } else if (lowerPath.includes('/extras-images') || lowerPath.includes('/outputs/extras')) {
                metadata.generationType = 'extras';
            } else if (lowerPath.includes('-grids') || lowerPath.includes('/grids/')) {
                metadata.generationType = 'grid';
            }
        }

        self.postMessage({ metadata, extra, isIntermediate, requestId });

    } catch (err) {
        // Safe fallback
        console.error("Worker parsing failed", err);
        self.postMessage({ metadata: { tool: 'Unknown' }, extra: {}, requestId });
    }
};
