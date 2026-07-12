import { GeneratorTool, ImageMetadata } from '../../types';

type MetadataRecord = Record<string, unknown>;
type ResourceArrays = 'loras' | 'controlNets' | 'ipAdapters' | 'embeddings' | 'hypernetworks';
export type InvokeImageMetadata = ImageMetadata & Required<Pick<ImageMetadata, ResourceArrays>>;

const isRecord = (value: unknown): value is MetadataRecord =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value: unknown): MetadataRecord => isRecord(value) ? value : {};

const readString = (record: MetadataRecord, ...keys: string[]): string => {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.length > 0) return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    }
    return '';
};

const readNumber = (record: MetadataRecord, ...keys: string[]): number | undefined => {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value);
    }
    return undefined;
};

const readResourceName = (record: MetadataRecord): string => {
    const model = asRecord(record.model);
    if (Object.keys(model).length > 0) return readString(model, 'model_name', 'name', 'default');
    return readString(record, 'model_name', 'name', 'lora_name');
};

// Helper to clean model names consistent with backend logic
export function cleanModelName(name: string): string {
    if (!name || typeof name !== 'string') return '';
    return name
        .replace(".safetensors", "")
        .replace(".ckpt", "")
        .replace(".pth", "")
        .replace(".bin", "")
        .replace(".pt", "")
        .split('(')[0]
        .trim();
}

function extractEmbeddingsFromPrompt(text: string): string[] {
    if (!text) return [];
    // Matches: 
    // 1. embedding:name (Comfy/A1111)
    // 2. <embedding:name> (Comfy/A1111)
    // 3. <name> (InvokeAI) - must have closing >
    const re = /(embedding:|<embedding:|<)([a-zA-Z0-9_\-\.]+)([:>])?/gi;
    const matches = Array.from(text.matchAll(re));
    const embeddings: string[] = [];
    for (const match of matches) {
        const prefix = match[1].toLowerCase();
        const name = match[2];
        const closing = match[3] || '';

        // Stricter check for bare <name> format
        if (prefix === "<") {
            if (closing !== ">") continue;
            const nameLower = name.toLowerCase();
            if (nameLower === "lora" || nameLower === "hypernet" || nameLower.startsWith("lora:") || nameLower.startsWith("hypernet:")) {
                continue;
            }
        }

        if (name && name.length >= 2 && !embeddings.includes(name)) {
            embeddings.push(name);
        }
    }
    return embeddings;
}

function extractLorasFromPrompt(text: string): string[] {
    if (!text) return [];
    // Format: <lora:name:weight>
    const re = /<lora:([^:>]+)(?::([0-9\.]+))?>/gi;
    const matches = Array.from(text.matchAll(re));
    const loras: string[] = [];
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
        if (entry && !loras.includes(entry)) {
            loras.push(entry);
        }
    }
    return loras;
}

function extractHypernetsFromPrompt(text: string): string[] {
    if (!text) return [];
    // Format: <hypernet:name:weight>
    const re = /<hypernet:([^:>]+)(?::([0-9\.]+))?>/gi;
    const matches = Array.from(text.matchAll(re));
    const hypernets: string[] = [];
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
        if (entry && !hypernets.includes(entry)) {
            hypernets.push(entry);
        }
    }
    return hypernets;
}

interface Resources {
    loras: string[];
    controlNets: string[];
    ipAdapters: string[];
    embeddings: string[];
    hypernetworks: string[];
}

function scanForResources(val: unknown, res: Resources, depth = 0) {
    if (!val || typeof val !== 'object' || depth > 20) return;

    if (Array.isArray(val)) {
        val.forEach(item => scanForResources(item, res, depth + 1));
        return;
    }

    const obj = asRecord(val);

    // Check for LoRAs
    if (Array.isArray(obj.loras)) {
        obj.loras.forEach((l) => {
            if (!l) return;
            const loraRecord = asRecord(l);
            const loraModel = asRecord(loraRecord.lora);
            const name = typeof l === 'string'
                ? l
                : (readResourceName(loraModel) || readResourceName(loraRecord));

            if (name && typeof name === 'string') {
                const weight = readNumber(loraRecord, 'weight') ?? 1.0;
                const entry = Math.abs(weight - 1.0) > 0.001 ? `${name} (${weight.toFixed(2)})` : name;
                if (!res.loras.includes(entry)) res.loras.push(entry);
            }
        });
    }

    // Check for ControlNets (Support both arrays of adapters and individual node patterns)
    const cns_keys = ["controlnets", "control_adapters", "control_model"];
    cns_keys.forEach(key => {
        const cns = obj[key];
        if (cns) {
            const items = Array.isArray(cns) ? cns : [cns];
            items.forEach((c) => {
                if (!c) return;
                let name = '';
                if (typeof c === 'string') name = c;
                else {
                    const item = asRecord(c);
                    const controlModel = item.control_model;
                    if (typeof controlModel === 'string') name = controlModel;
                    else if (isRecord(controlModel)) name = readResourceName(controlModel);
                    else name = readResourceName(item);
                }

                if (name && typeof name === 'string') {
                    const cleaned = cleanModelName(name);
                    if (cleaned && !res.controlNets.includes(cleaned)) res.controlNets.push(cleaned);
                }
            });
        }
    });

    // Check for IP-Adapters
    const ips_keys = ["ip_adapters", "ip_adapter", "ip_adapter_model"];
    ips_keys.forEach(key => {
        const ips = obj[key];
        if (ips) {
            const items = Array.isArray(ips) ? ips : [ips];
            items.forEach((i) => {
                if (!i) return;
                let name = '';
                if (typeof i === 'string') name = i;
                else {
                    const item = asRecord(i);
                    const adapterModel = item.ip_adapter_model;
                    if (typeof adapterModel === 'string') name = adapterModel;
                    else if (isRecord(adapterModel)) name = readResourceName(adapterModel);
                    else name = readResourceName(item);
                }

                if (name && typeof name === 'string') {
                    const cleaned = cleanModelName(name);
                    if (cleaned && !res.ipAdapters.includes(cleaned)) res.ipAdapters.push(cleaned);
                }
            });
        }
    });

    // Check for embeddings
    const embs_keys = ["embeddings", "ti", "textual_inversion"];
    embs_keys.forEach(key => {
        const embs = obj[key];
        if (embs) {
            const items = Array.isArray(embs) ? embs : [embs];
            items.forEach((e) => {
                if (!e) return;
                const name = typeof e === 'string' ? e : readResourceName(e);

                if (name && typeof name === 'string') {
                    const cleaned = cleanModelName(name);
                    if (cleaned && !res.embeddings.includes(cleaned)) res.embeddings.push(cleaned);
                }
            });
        }
    });

    // Check for hypernetworks
    const hn_keys = ["hypernetworks", "hypernet", "hypernets"];
    hn_keys.forEach(key => {
        const hn = obj[key];
        if (hn) {
            const items = Array.isArray(hn) ? hn : [hn];
            items.forEach((h) => {
                if (!h) return;
                const name = typeof h === 'string' ? h : readResourceName(h);

                if (name && typeof name === 'string') {
                    const cleaned = cleanModelName(name);
                    if (cleaned && !res.hypernetworks.includes(cleaned)) res.hypernetworks.push(cleaned);
                }
            });
        }
    });

    // Recursively scan all object values
    for (const k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
            const v = obj[k];
            if (v && typeof v === 'object') {
                scanForResources(v, res, depth + 1);
            }
        }
    }
}

// Helper to map InvokeAI metadata to Ambit's format using a database row
export function mapInvokeMetadata(row: unknown, metaCol: string, processedIndex: number): InvokeImageMetadata {
    const rowRecord = asRecord(row);
    const rawVal = rowRecord[metaCol];

    // Base metadata - always includes tool: 'InvokeAI' since we know the source
    const baseMetadata: InvokeImageMetadata = {
        tool: GeneratorTool.INVOKEAI,
        model: 'Unknown',
        steps: 0,
        cfg: 0,
        sampler: 'Unknown',
        positivePrompt: '',
        negativePrompt: '',
        loras: [],
        controlNets: [],
        ipAdapters: [],
        embeddings: [],
        hypernetworks: [],
        hasWorkflowHint: rowRecord.has_workflow === 1 || rowRecord.has_workflow === true,
        isIntermediate: rowRecord.is_intermediate === 1 || rowRecord.is_intermediate === true
    };

    // Even if metadata is empty, we still know this is an InvokeAI image
    if (!rawVal) return baseMetadata;

    try {
        const meta = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
        const mapped = mapRawInvokeMetadata(meta);
        // Overwrite hints from higher-level row if present
        if (rowRecord.has_workflow !== undefined) mapped.hasWorkflowHint = rowRecord.has_workflow === 1 || rowRecord.has_workflow === true;
        return mapped;
    } catch (e) {
        return baseMetadata;
    }
}

/**
 * Standard mapper for raw InvokeAI metadata objects.
 * Used both during sync and when displaying "Original" metadata in the UI.
 */
export function mapRawInvokeMetadata(meta: unknown): InvokeImageMetadata {
    if (!meta) return {
        tool: GeneratorTool.INVOKEAI,
        model: 'Unknown',
        steps: 0,
        cfg: 0,
        sampler: 'Unknown',
        positivePrompt: '',
        negativePrompt: '',
        loras: [],
        controlNets: [],
        ipAdapters: [],
        embeddings: [],
        hypernetworks: [],
        hasWorkflowHint: false,
        isIntermediate: false
    };

    // Check if the input is wrapped in our internal DB structure
    const metaRecord = asRecord(meta);
    let root: unknown = metaRecord;
    if (metaRecord.invokeai_metadata || metaRecord['sd-metadata'] || metaRecord.dream_metadata) {
        root = metaRecord.invokeai_metadata || metaRecord['sd-metadata'] || metaRecord.dream_metadata;
        // If the wrapper contains a string (double-encoded legacy case), parse it
        if (typeof root === 'string') {
            try {
                root = JSON.parse(root);
            } catch (e) {
                root = metaRecord; // Fallback
            }
        }
    }

    const rootRecord = asRecord(root);
    const actualRoot = asRecord(rootRecord.image || rootRecord.generation || rootRecord);

    // Aggressive Workflow Detection - searches all potential storage locations
    const workflow = rootRecord.workflow || metaRecord.workflow || rootRecord.graph || metaRecord.graph ||
        actualRoot.workflow || actualRoot.graph || metaRecord.has_workflow_data;

    const mapped: InvokeImageMetadata = {
        tool: GeneratorTool.INVOKEAI,
        model: 'Unknown',
        steps: 0,
        cfg: 0,
        sampler: 'Unknown',
        positivePrompt: '',
        negativePrompt: '',
        loras: [],
        controlNets: [],
        ipAdapters: [],
        embeddings: [],
        hypernetworks: [],
        hasWorkflowHint: !!(workflow || metaRecord.has_workflow),
        isIntermediate: rootRecord.is_intermediate === 1 || rootRecord.is_intermediate === true || metaRecord.is_intermediate === 1 || metaRecord.is_intermediate === true,
        generationType: 'unknown',
        workflowJson: workflow ? (typeof workflow === 'string' ? workflow : JSON.stringify(workflow)) : undefined
    };

    // Support both snake_case (InvokeAI) and camelCase (our internal mapped format)
    const positivePrompt = readString(actualRoot, 'positive_prompt', 'positivePrompt');
    const negativePrompt = readString(actualRoot, 'negative_prompt', 'negativePrompt');
    if (positivePrompt) mapped.positivePrompt = positivePrompt.trim();
    if (negativePrompt) mapped.negativePrompt = negativePrompt.trim();
    mapped.steps = readNumber(actualRoot, 'steps') ?? mapped.steps;
    mapped.cfg = readNumber(actualRoot, 'cfg_scale', 'cfg') ?? mapped.cfg;
    mapped.seed = readNumber(actualRoot, 'seed') ?? mapped.seed;
    // Sampler - v2.x uses "sampler", v3.x uses "scheduler" or "sampler_name"
    const sampler = readString(actualRoot, 'scheduler', 'sampler', 'sampler_name');
    if (sampler) {
        mapped.sampler = sampler;
    }

    // Hash extraction (v2.x uses model_hash at root, v3.5+ uses model.hash)
    if (rootRecord.model_hash) mapped.modelHash = String(rootRecord.model_hash);
    else if (metaRecord.model_hash) mapped.modelHash = String(metaRecord.model_hash);
    else if (asRecord(actualRoot.model).hash) {
        // Strip prefixes like "blake3:" if present
        const hashStr = String(asRecord(actualRoot.model).hash);
        mapped.modelHash = hashStr.split(':').pop() || hashStr;
    }

    // Additional fields for parity with Rust ImageMetadata
    mapped.clipSkip = readNumber(actualRoot, 'clip_skip', 'clipSkip') ?? mapped.clipSkip;
    mapped.denoisingStrength = readNumber(actualRoot, 'hrf_strength', 'denoisingStrength') ?? mapped.denoisingStrength;
    const hiresUpscaler = readString(actualRoot, 'hrf_method', 'hiresUpscaler');
    if (hiresUpscaler) mapped.hiresUpscaler = hiresUpscaler;
    const generationType = readString(actualRoot, 'generation_mode', 'generationType', 'type');
    if (generationType) mapped.generationType = generationType as ImageMetadata['generationType'];

    // Check for favorite status in legacy formats
    if (actualRoot.subject === 'favorite' || actualRoot.isFavorite) mapped.isFavorite = true;

    if (!mapped.positivePrompt && actualRoot.prompt) {
        if (Array.isArray(actualRoot.prompt)) {
            mapped.positivePrompt = actualRoot.prompt.map((p) => readString(asRecord(p), 'prompt')).join(' ');
        } else if (typeof actualRoot.prompt === 'string') {
            mapped.positivePrompt = actualRoot.prompt.trim();
        }
    }

    if (actualRoot.model) {
        let modelFull = '';
        if (typeof actualRoot.model === 'string') modelFull = actualRoot.model;
        else modelFull = readResourceName(asRecord(actualRoot.model));

        if (modelFull) mapped.model = cleanModelName(modelFull);
    }

    // Deep scan for resources (LoRAs, ControlNets, IP-Adapters, Embeddings, Hypernets)
    const resources: Resources = { loras: [], controlNets: [], ipAdapters: [], embeddings: [], hypernetworks: [] };
    scanForResources(actualRoot, resources);

    mapped.loras = resources.loras;
    mapped.controlNets = resources.controlNets;
    mapped.ipAdapters = resources.ipAdapters;
    mapped.embeddings = resources.embeddings;
    mapped.hypernetworks = resources.hypernetworks;
    const embeddings = mapped.embeddings;
    const loras = mapped.loras;
    const hypernetworks = mapped.hypernetworks;

    // --- Extract Embeddings from Prompts (Legacy/Text-based) ---
    const promptEmbeddings = [
        ...extractEmbeddingsFromPrompt(mapped.positivePrompt),
        ...extractEmbeddingsFromPrompt(mapped.negativePrompt)
    ];
    promptEmbeddings.forEach(emb => {
        if (!embeddings.includes(emb)) {
            embeddings.push(emb);
        }
    });

    // --- Extract LoRAs from Prompts ---
    const promptLoras = [
        ...extractLorasFromPrompt(mapped.positivePrompt),
        ...extractLorasFromPrompt(mapped.negativePrompt)
    ];
    promptLoras.forEach(lora => {
        if (!loras.includes(lora)) {
            loras.push(lora);
        }
    });

    // --- Extract Hypernetworks from Prompts ---
    const promptHypernets = [
        ...extractHypernetsFromPrompt(mapped.positivePrompt),
        ...extractHypernetsFromPrompt(mapped.negativePrompt)
    ];
    promptHypernets.forEach(hn => {
        if (!hypernetworks.includes(hn)) {
            hypernetworks.push(hn);
        }
    });

    return mapped;
}
