// Helper to map InvokeAI metadata to Ambit's format
export function mapInvokeMetadata(row: any, metaCol: string, processedIndex: number): any {
    const rawVal = row[metaCol];

    // Base metadata - always includes tool: 'InvokeAI' since we know the source
    const baseMetadata: any = {
        tool: 'InvokeAI',
        positivePrompt: '',
        negativePrompt: '',
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

    // Extract LoRAs
    if (root.loras && Array.isArray(root.loras)) {
        mapped.loras = root.loras.map((l: any) => {
            if (typeof l === 'string') return l;
            if (l.model && typeof l.model === 'object') {
                return l.model.model_name || l.model.name || 'Unknown LoRA';
            }
            if (l.lora && typeof l.lora === 'object') return l.lora.model_name || l.lora.name;
            return l.model_name || l.name || 'Unknown LoRA';
        }).filter(Boolean);
    }

    // Extract Workflow - Only from embedded metadata, never from columns (too heavy)
    if (root.workflow || root.graph) {
        // Optional: We could even skip this to force 100% lazy loading
        // but if it's already in the JSON blob we parsed, might as well keep it?
        // User requested "lightweight" so let's skip unless it's tiny.
        // Actually, let's just NOT map it. The Viewer will lazy load.
        // mapped.workflowJson = ... 
    }

    return mapped;
}
