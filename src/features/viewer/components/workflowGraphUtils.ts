export type WorkflowValue = string | number | boolean | null | undefined | Record<string, unknown> | unknown[];
export type WorkflowInputs = Record<string, WorkflowValue> | WorkflowValue[];

interface WorkflowRawNode extends Record<string, unknown> {
    id?: string | number;
    type?: string;
    class_type?: string;
    _type?: string;
    node_type?: string;
    title?: string;
    label?: string;
    widgets_values?: WorkflowValue[];
    inputs?: Record<string, WorkflowValue>;
    data?: Record<string, WorkflowValue>;
    _meta?: { title?: string };
}

export interface WorkflowDisplayNode {
    id: string | number;
    title: string;
    type: string;
    inputs: WorkflowInputs;
}

export interface WorkflowGraphSource {
    json: string;
    source: 'workflow' | 'prompt';
    nodes: WorkflowDisplayNode[];
}

interface SelectWorkflowGraphSourceArgs {
    tool?: string;
    localWorkflowJson?: string;
    workflowJson?: string;
    originalChunks?: Record<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const isWorkflowRawNode = (value: unknown): value is WorkflowRawNode => isRecord(value);

const isNodeLikeRecord = (value: unknown): value is WorkflowRawNode =>
    isWorkflowRawNode(value) && Boolean(
        value.class_type ||
        value.type ||
        value.node_type ||
        value.inputs ||
        value.widgets_values ||
        value.data
    );

const asStringValue = (value: unknown, fallback = ''): string =>
    typeof value === 'string' && value.length > 0 ? value : fallback;

const extractJsonTarget = (jsonStr: string): string => {
    const trimmed = jsonStr.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return jsonStr;

    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    return start !== -1 && end !== -1 && end > start
        ? jsonStr.substring(start, end + 1)
        : jsonStr;
};

const getNodePriority = (node: WorkflowDisplayNode) => {
    const type = String(node.type || '').toLowerCase();
    const title = String(node.title || '').toLowerCase();

    if (type.includes('sampler') || type.includes('denoise') || type.includes('t2l') || type.includes('l2l')) return 1;
    if (type.includes('prompt') || type.includes('conditioning') || title.includes('prompt')) return 2;
    if (type.includes('loader') || type.includes('checkpoint')) return 3;

    return 10;
};

const toWorkflowDisplayNodes = (nodeList: WorkflowRawNode[]): WorkflowDisplayNode[] => {
    const nodes: WorkflowDisplayNode[] = [];

    nodeList.forEach((node) => {
        const incomingInputs: WorkflowInputs = node.widgets_values || node.inputs || node.data || {};
        const inputRecord = Array.isArray(incomingInputs) ? {} : incomingInputs;

        let type = asStringValue(node.type || node.class_type || node._type || node.node_type || inputRecord.type || inputRecord.node_type, 'Unknown');
        let title = asStringValue(node.title || node.label || node._meta?.title || inputRecord.label || inputRecord.title, type);

        if (type.toLowerCase() === 'invocation' && (node.node_type || inputRecord.type || inputRecord.node_type)) {
            type = asStringValue(node.node_type || inputRecord.type || inputRecord.node_type, type);
        }

        if (title.toLowerCase() === 'invocation') {
            if (inputRecord.label) title = asStringValue(inputRecord.label, title);
            else if (inputRecord.title) title = asStringValue(inputRecord.title, title);
            else if (type.toLowerCase() !== 'invocation') title = type;
        }

        if (type || node.id) {
            nodes.push({
                id: node.id ?? `${type}-${nodes.length}`,
                title,
                type,
                inputs: incomingInputs
            });
        }
    });

    return nodes.sort((a, b) => {
        const priorityA = getNodePriority(a);
        const priorityB = getNodePriority(b);

        if (priorityA !== priorityB) return priorityA - priorityB;

        const idA = String(a.id);
        const idB = String(b.id);
        if (!Number.isNaN(Number(idA)) && !Number.isNaN(Number(idB))) return Number(idA) - Number(idB);
        return idA.localeCompare(idB);
    });
};

export const parseWorkflowNodes = (jsonStr?: string): WorkflowDisplayNode[] => {
    if (!jsonStr) return [];

    try {
        const json = JSON.parse(extractJsonTarget(jsonStr)) as unknown;
        let nodeList: WorkflowRawNode[] = [];

        if (isRecord(json) && Array.isArray(json.nodes)) {
            nodeList = json.nodes.filter(isWorkflowRawNode);
        } else if (isRecord(json)) {
            const entries = Object.entries(json);
            const nodeLikeEntries = entries.filter((entry): entry is [string, WorkflowRawNode] => isNodeLikeRecord(entry[1]));

            if (nodeLikeEntries.length === 0 || (nodeLikeEntries.length / entries.length) <= 0.5) return [];

            nodeList = nodeLikeEntries.map(([id, node]) => ({
                ...node,
                id: node.id || id
            }));
        }

        return toWorkflowDisplayNodes(nodeList);
    } catch (_error) {
        return [];
    }
};

export const isWorkflowGraph = (jsonStr: string): boolean => parseWorkflowNodes(jsonStr).length > 0;

export const selectWorkflowJsonForActions = ({
    localWorkflowJson,
    workflowJson,
    originalChunks
}: SelectWorkflowGraphSourceArgs): string | undefined =>
    localWorkflowJson || workflowJson || originalChunks?.workflow || originalChunks?.prompt;

export const selectWorkflowGraphSource = ({
    tool,
    localWorkflowJson,
    workflowJson,
    originalChunks
}: SelectWorkflowGraphSourceArgs): WorkflowGraphSource | undefined => {
    const preservedWorkflow = localWorkflowJson || workflowJson || originalChunks?.workflow;
    const workflowNodes = parseWorkflowNodes(preservedWorkflow);
    const promptNodes = tool === 'ComfyUI'
        ? parseWorkflowNodes(originalChunks?.prompt)
        : [];

    if (originalChunks?.prompt && promptNodes.length > 0 && (!preservedWorkflow || promptNodes.length > workflowNodes.length)) {
        return {
            json: originalChunks.prompt,
            source: 'prompt',
            nodes: promptNodes
        };
    }

    if (preservedWorkflow && workflowNodes.length > 0) {
        return {
            json: preservedWorkflow,
            source: 'workflow',
            nodes: workflowNodes
        };
    }

    return undefined;
};
