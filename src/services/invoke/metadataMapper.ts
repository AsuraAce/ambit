// Helper to map InvokeAI metadata to Ambit's format
export function mapInvokeMetadata(row: any, metaCol: string, processedIndex: number): any {
    const rawVal = row[metaCol];
    const sessionWorkflow = row.session_workflow; // From JOIN

    if (!rawVal && !sessionWorkflow) return {};

    let meta: any = {};
    if (rawVal) {
        try {
            meta = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
        } catch (e) { meta = {}; }
    }

    const mapped: any = {
        tool: 'InvokeAI',
        positivePrompt: '',
        negativePrompt: '',
        hasWorkflowHint: row.has_workflow === 1 || row.has_workflow === true
    };

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

    // -- DATA AUTOPSY --
    if (processedIndex === 0 || row.image_name?.includes('autopsy')) {
        console.log('[InvokeAI Data Autopsy]', {
            image: row.image_name,
            col_workflow: !!row.workflow,
            col_graph: !!row.graph,
            col_session_workflow: !!row.session_workflow,
            meta_workflow: !!root.workflow,
            meta_graph: !!root.graph,
            meta_keys: Object.keys(root)
        });
    }

    // Extract Workflow - Prioritize Session Workflow if found via JOIN
    if (sessionWorkflow) {
        mapped.workflowJson = typeof sessionWorkflow === 'string' ? sessionWorkflow : JSON.stringify(sessionWorkflow);
        console.log('[InvokeAI Sync Trace] Workflow found via session_queue JOIN for', row.image_name, 'Length:', mapped.workflowJson.length);
    } else if (root.workflow || root.graph) {
        const wf = root.workflow || root.graph;
        mapped.workflowJson = typeof wf === 'string' ? wf : JSON.stringify(wf);
        console.log('[InvokeAI Sync Trace] Workflow found in metadata blob for', row.image_name, 'Length:', mapped.workflowJson.length);
    } else if (row.workflow || row.graph || row.workflow_json || row.workflowJson) {
        const wf = row.workflow || row.graph || row.workflow_json || row.workflowJson;
        mapped.workflowJson = typeof wf === 'string' ? wf : JSON.stringify(wf);
        console.log('[InvokeAI Sync Trace] Workflow found in row fallback for', row.image_name || row.path, 'Length:', mapped.workflowJson.length);
    }

    return mapped;
}
