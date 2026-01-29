// Helper to clean model names consistent with backend logic
function cleanModelName(name: string): string {
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

interface Resources {
    loras: string[];
    controlNets: string[];
    ipAdapters: string[];
}

function scanForResources(val: any, res: Resources, depth = 0) {
    if (!val || typeof val !== 'object' || depth > 20) return;

    if (Array.isArray(val)) {
        val.forEach(item => scanForResources(item, res, depth + 1));
        return;
    }

    // Check for LoRAs
    if (val.loras && Array.isArray(val.loras)) {
        val.loras.forEach((l: any) => {
            if (!l) return;
            let name = '';
            if (typeof l === 'string') name = l;
            else if (l.model && typeof l.model === 'object') name = l.model.model_name || l.model.name;
            else if (l.lora && typeof l.lora === 'object') name = l.lora.model_name || l.lora.name;
            else name = l.model_name || l.name || l.lora_name;

            if (name && typeof name === 'string') {
                const weight = typeof l.weight === 'number' ? l.weight : 1.0;
                const entry = Math.abs(weight - 1.0) > 0.001 ? `${name} (${weight.toFixed(2)})` : name;
                if (!res.loras.includes(entry)) res.loras.push(entry);
            }
        });
    }

    // Check for ControlNets (Support both arrays of adapters and individual node patterns)
    const cns = val.controlnets || val.control_adapters || val.control_model;
    if (cns) {
        const items = Array.isArray(cns) ? cns : [cns];
        items.forEach((c: any) => {
            if (!c) return;
            let name = '';
            if (typeof c === 'string') name = c;
            else if (c.control_model) {
                if (typeof c.control_model === 'string') name = c.control_model;
                else name = c.control_model.model_name || c.control_model.name;
            } else if (c.model && typeof c.model === 'object') {
                name = c.model.model_name || c.model.name;
            } else {
                name = c.model_name || c.name || (typeof c === 'string' ? c : '');
            }

            if (name && typeof name === 'string') {
                const cleaned = cleanModelName(name);
                if (cleaned && !res.controlNets.includes(cleaned)) res.controlNets.push(cleaned);
            }
        });
    }

    // Check for IP-Adapters
    const ips = val.ip_adapters || val.ip_adapter || val.ip_adapter_model;
    if (ips) {
        const items = Array.isArray(ips) ? ips : [ips];
        items.forEach((i: any) => {
            if (!i) return;
            let name = '';
            if (typeof i === 'string') name = i;
            else if (i.ip_adapter_model) {
                if (typeof i.ip_adapter_model === 'string') name = i.ip_adapter_model;
                else name = i.ip_adapter_model.model_name || i.ip_adapter_model.name;
            } else if (i.model && typeof i.model === 'object') {
                name = i.model.model_name || i.model.name;
            } else {
                name = i.model_name || i.name || (typeof i === 'string' ? i : '');
            }

            if (name && typeof name === 'string') {
                const cleaned = cleanModelName(name);
                if (cleaned && !res.ipAdapters.includes(cleaned)) res.ipAdapters.push(cleaned);
            }
        });
    }

    // Recursively scan all object values
    for (const k in val) {
        if (Object.prototype.hasOwnProperty.call(val, k)) {
            const v = val[k];
            if (v && typeof v === 'object') {
                scanForResources(v, res, depth + 1);
            }
        }
    }
}

// Helper to map InvokeAI metadata to Ambit's format
export function mapInvokeMetadata(row: any, metaCol: string, processedIndex: number): any {
    const rawVal = row[metaCol];

    // Base metadata - always includes tool: 'InvokeAI' since we know the source
    const baseMetadata: any = {
        tool: 'InvokeAI',
        positivePrompt: '',
        negativePrompt: '',
        loras: [],
        controlNets: [],
        ipAdapters: [],
        hasWorkflowHint: row.has_workflow === 1 || row.has_workflow === true,
        isIntermediate: row.is_intermediate === 1 || row.is_intermediate === true
    };

    // Even if metadata is empty, we still know this is an InvokeAI image
    if (!rawVal) return baseMetadata;

    let meta: any = {};
    try {
        meta = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
    } catch (e) { meta = {}; }

    // Use base metadata and extend with parsed values
    const mapped = { ...baseMetadata };
    if (meta.is_intermediate === true) mapped.isIntermediate = true;

    const root = meta.image || meta.generation || meta;

    if (root.positive_prompt) mapped.positivePrompt = root.positive_prompt;
    if (root.negative_prompt) mapped.negativePrompt = root.negative_prompt;
    if (root.steps) mapped.steps = root.steps;
    if (root.cfg_scale) mapped.cfg = root.cfg_scale;
    if (root.seed) mapped.seed = root.seed;
    if (root.scheduler) mapped.sampler = root.scheduler;

    if (!mapped.positivePrompt && root.prompt && Array.isArray(root.prompt)) {
        mapped.positivePrompt = root.prompt.map((p: any) => p.prompt).join(' ');
    }

    if (root.model) {
        if (typeof root.model === 'string') mapped.model = root.model;
        else if (root.model.model_name) mapped.model = root.model.model_name;
        else if (root.model.name) mapped.model = root.model.name;
        else if (root.model.default) mapped.model = root.model.default;
    }

    // Deep scan for resources (LoRAs, ControlNets, IP-Adapters)
    const resources: Resources = { loras: [], controlNets: [], ipAdapters: [] };
    scanForResources(meta, resources);

    mapped.loras = resources.loras;
    mapped.controlNets = resources.controlNets;
    mapped.ipAdapters = resources.ipAdapters;

    return mapped;
}
