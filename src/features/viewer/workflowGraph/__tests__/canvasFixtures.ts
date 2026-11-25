import type {
    WorkflowCanvasGroup,
    WorkflowCanvasLevel,
    WorkflowCanvasLink,
    WorkflowCanvasNode,
    WorkflowCanvasPort,
    WorkflowCanvasReport,
} from '../../../../bindings';

export const port = (slot: number, dataType: string, linked = true, name = dataType.toLowerCase()): WorkflowCanvasPort => ({
    slot,
    name,
    label: '',
    dataType,
    typeInferred: false,
    linked,
});

export const canvasNode = (id: string, overrides: Partial<WorkflowCanvasNode> = {}): WorkflowCanvasNode => ({
    id,
    nodeType: 'KSampler',
    title: `Node ${id}`,
    kind: 'node',
    subgraphId: null,
    mode: 'active',
    collapsed: false,
    pos: { x: 0, y: 30 },
    size: { width: 200, height: 100 },
    inputs: [],
    outputs: [],
    widgets: [],
    rawJson: null,
    ...overrides,
});

export const canvasLink = (
    fromNode: string,
    fromSlot: number,
    toNode: string,
    toSlot: number,
    dataType = 'LATENT'
): WorkflowCanvasLink => ({
    fromNode,
    fromSlot,
    toNode,
    toSlot,
    dataType,
    typeInferred: false,
});

export const canvasGroup = (
    title: string,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string | null = null
): WorkflowCanvasGroup => ({
    title,
    pos: { x, y },
    size: { width, height },
    color,
});

export const level = (
    nodes: WorkflowCanvasNode[],
    links: WorkflowCanvasLink[] = [],
    groups: WorkflowCanvasGroup[] = []
): WorkflowCanvasLevel => ({ nodes, links, groups });

export const report = (root: WorkflowCanvasLevel, overrides: Partial<WorkflowCanvasReport> = {}): WorkflowCanvasReport => ({
    tool: 'ComfyUI',
    source: 'workflow',
    hasSavedLayout: true,
    truncated: false,
    root,
    subgraphs: [],
    selectedOutputPaths: [],
    selectedBranchPaths: [],
    outputAmbiguous: false,
    ...overrides,
});
