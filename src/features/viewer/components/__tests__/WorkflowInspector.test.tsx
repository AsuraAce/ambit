import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage, type VideoAsset } from '../../../../types';
import { WorkflowInspector } from '../WorkflowInspector';

const mockInspectComfyuiMetadataChunks = vi.hoisted(() => vi.fn());
const mockInspectComfyuiWorkflowGraph = vi.hoisted(() => vi.fn());
const mockSettings = vi.hoisted(() => ({ devMode: true }));
const mockClipboardWriteText = vi.hoisted(() => vi.fn());
const mockSave = vi.hoisted(() => vi.fn());
const mockWriteTextFile = vi.hoisted(() => vi.fn());
const mockScrollIntoView = vi.hoisted(() => vi.fn());

vi.mock('../../../../bindings', () => ({
    commands: {
        inspectComfyuiMetadataChunks: (...args: unknown[]) => mockInspectComfyuiMetadataChunks(...args),
        inspectComfyuiWorkflowGraph: (...args: unknown[]) => mockInspectComfyuiWorkflowGraph(...args)
    }
}));

vi.mock('../../../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: { settings: { devMode: boolean } }) => unknown) =>
        selector({ settings: { devMode: mockSettings.devMode } })
}));

vi.mock('../../../../services/metadataParser', () => ({
    scanImageWorkflow: vi.fn()
}));

vi.mock('../../../../services/db/imageRepo', () => ({
    updateImageWorkflow: vi.fn(),
    updateImageWorkflowHint: vi.fn()
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mockSave }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: mockWriteTextFile }));

const workflowJson = JSON.stringify({
    nodes: [
        {
            id: 9,
            type: 'SaveImage',
            inputs: [{ name: 'images', link: 1 }]
        }
    ]
});

const promptJson = JSON.stringify({
    '3': {
        class_type: 'KSampler',
        inputs: { steps: 8, cfg: 1, sampler_name: 'euler' }
    },
    '9': {
        class_type: 'SaveImage',
        inputs: { images: ['3', 0] }
    }
});

const diagnosticsReport = {
    appVersion: '0.10.0',
    parserVersion: 46,
    chunkKeys: ['prompt', 'workflow'],
    hasPromptChunk: true,
    hasWorkflowChunk: true,
    graphNodeCount: 2,
    selectedOutputCandidateCount: 1,
    uniqueOutputRootSamplerCount: 1,
    outputAmbiguous: false,
    traversalIssues: [],
    traversalIssuesTruncated: false,
    attemptedLayers: ['workflow_chunk', 'sampler_traversal'],
    fieldSources: {
        model: 'sampler_traversal',
        positive_prompt: 'sampler_traversal',
        workflow_json: 'workflow_chunk'
    },
    fieldSourceNodeIds: {
        model: ['3'],
        positive_prompt: ['404']
    },
    resourceSources: [],
    metadata: {
        tool: 'ComfyUI',
        model: 'diagnostic_model',
        seed: 123,
        steps: 8,
        cfg: 1,
        sampler: 'euler (simple)',
        positivePrompt: 'diagnostic prompt',
        negativePrompt: '',
        loras: [],
        controlNets: [],
        ipAdapters: [],
        embeddings: [],
        hypernetworks: [],
        generationType: 'txt2img',
        hasWorkflowHint: true,
        hasWorkflowJson: true
    }
};

const workflowGraphReport = {
    source: 'api_prompt',
    nodeCount: 2,
    selectedOutputNodeIds: ['9'],
    rootSamplerNodeIds: ['3'],
    selectedBranchNodeIds: ['3', '9'],
    outputAmbiguous: false,
    edges: [{
        sourceNodeId: '3',
        sourceOutputSlot: 0,
        targetNodeId: '9',
        targetInputName: 'images',
        targetInputSlot: null
    }],
    nodes: [
        {
            id: '3',
            nodeType: 'KSampler',
            title: 'KSampler',
            inputs: { steps: '8', cfg: '1', sampler_name: 'euler' },
            subgraphPath: []
        },
        {
            id: '9',
            nodeType: 'SaveImage',
            title: 'SaveImage',
            inputs: { images: '["3",0]' },
            subgraphPath: []
        }
    ]
};

const makeImage = (tool: GeneratorTool = GeneratorTool.COMFYUI): AIImage => ({
    id: 'C:/library/comfy.png',
    url: 'asset://comfy.png',
    thumbnailUrl: 'asset://thumb.webp',
    filename: 'comfy.png',
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: false,
    metadata: {
        tool,
        model: 'diagnostic_model',
        seed: 123,
        steps: 8,
        cfg: 1,
        sampler: 'euler (simple)',
        positivePrompt: 'diagnostic prompt',
        negativePrompt: '',
        workflowJson,
        hasWorkflowHint: true
    },
    originalChunks: {
        workflow: workflowJson,
        prompt: promptJson
    }
});
const openParserDiagnostics = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Parser Diagnostics' }));
};

const renderWithOpenParserDiagnostics = (image: AIImage = makeImage()) => {
    const view = render(<WorkflowInspector image={image} />);
    openParserDiagnostics();
    return view;
};


describe('WorkflowInspector ComfyUI parser diagnostics', () => {
    beforeEach(() => {
        mockSettings.devMode = true;
        mockClipboardWriteText.mockReset();
        mockSave.mockReset();
        mockWriteTextFile.mockReset();
        mockSave.mockResolvedValue('C:/exports/ambit-comfyui-support.json');
        mockWriteTextFile.mockResolvedValue(undefined);
        mockInspectComfyuiMetadataChunks.mockReset();
        mockInspectComfyuiMetadataChunks.mockResolvedValue({
            status: 'ok',
            data: diagnosticsReport
        });
        mockInspectComfyuiWorkflowGraph.mockReset();
        mockInspectComfyuiWorkflowGraph.mockResolvedValue({
            status: 'ok',
            data: workflowGraphReport
        });
        mockScrollIntoView.mockReset();
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            value: mockScrollIntoView,
            configurable: true
        });
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: mockClipboardWriteText },
            configurable: true
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('keeps parser diagnostics collapsed in the scroll flow and loads them on demand', async () => {
        render(<WorkflowInspector image={makeImage()} />);

        const toggle = screen.getByRole('button', { name: 'Parser Diagnostics' });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.closest('.overflow-y-auto')).toBeTruthy();
        expect(mockInspectComfyuiMetadataChunks).not.toHaveBeenCalled();
        expect(screen.getByRole('heading', { name: 'Node Graph' }).className).toContain('whitespace-nowrap');

        openParserDiagnostics();

        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(await screen.findByText('diagnostic_model')).toBeTruthy();
        expect(screen.getByText('1 output / 1 root')).toBeTruthy();
        expect(screen.getAllByText(/Sampler Traversal/i).length).toBeGreaterThan(0);
        expect(mockInspectComfyuiMetadataChunks).toHaveBeenCalledWith({ workflow: workflowJson, prompt: promptJson });
        expect(mockInspectComfyuiWorkflowGraph).toHaveBeenCalledWith({ workflow: workflowJson, prompt: promptJson });
        expect(await screen.findByText('API Prompt')).toBeTruthy();
    });

    it('groups and searches backend-expanded workflow-only subgraph nodes', async () => {
        mockInspectComfyuiWorkflowGraph.mockResolvedValueOnce({
            status: 'ok',
            data: {
                source: 'expanded_workflow',
                nodeCount: 3,
                nodes: [
                    { id: '29', nodeType: 'SaveImage', title: 'SaveImage', inputs: {}, subgraphPath: [] },
                    { id: '30:19', nodeType: 'StringConcatenate', title: 'Krea Positive Prompt', inputs: { string_a: 'scene' }, subgraphPath: ['30'] },
                    { id: '30:7:4', nodeType: 'KSampler', title: 'Nested Sampler', inputs: {}, subgraphPath: ['30', '7'] }
                ]
            }
        });

        renderWithOpenParserDiagnostics();

        expect(await screen.findByText('Expanded Workflow')).toBeTruthy();
        expect(screen.getByText('Subgraph 30')).toBeTruthy();
        expect(screen.getByText('Subgraph 30 / 7')).toBeTruthy();
        expect(screen.getByTitle('Krea Positive Prompt')).toBeTruthy();

        fireEvent.change(screen.getByPlaceholderText("Search nodes (e.g. 'ControlNet', 'Seed')..."), {
            target: { value: '30:19' }
        });
        expect(screen.getByTitle('Krea Positive Prompt')).toBeTruthy();
        expect(screen.queryByTitle('Nested Sampler')).toBeNull();
    });

    it('follows normalized connections across the filtered node list', async () => {
        renderWithOpenParserDiagnostics();

        expect(await screen.findByText('API Prompt')).toBeTruthy();
        const search = screen.getByPlaceholderText("Search nodes (e.g. 'ControlNet', 'Seed')...") as HTMLInputElement;
        fireEvent.change(search, { target: { value: 'KSampler' } });

        const samplerHeader = screen.getByTitle('KSampler').closest('button');
        expect(samplerHeader).not.toBeNull();
        fireEvent.click(samplerHeader!);
        fireEvent.click(screen.getByLabelText('Open outgoing connected node SaveImage (9)'));

        await waitFor(() => expect(search.value).toBe(''));
        const target = document.querySelector<HTMLElement>('[data-workflow-node-id="9"]');
        expect(target).not.toBeNull();
        await waitFor(() => expect(document.activeElement).toBe(target));
        expect(target?.className).toContain('ring-2');
        expect(target?.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
        expect(mockScrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });

        fireEvent.click(target!.querySelector('button')!);
        expect(target?.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(screen.getByLabelText('Open outgoing connected node SaveImage (9)'));
        await waitFor(() => expect(target?.querySelector('button')?.getAttribute('aria-expanded')).toBe('true'));
        expect(mockScrollIntoView).toHaveBeenCalledTimes(2);
    });

    it('defaults to all nodes and filters to the parser-selected branch', async () => {
        mockInspectComfyuiWorkflowGraph.mockResolvedValueOnce({
            status: 'ok',
            data: {
                ...workflowGraphReport,
                nodeCount: 3,
                nodes: [
                    ...workflowGraphReport.nodes,
                    {
                        id: '12',
                        nodeType: 'CheckpointLoaderSimple',
                        title: 'Disconnected Loader',
                        inputs: {},
                        subgraphPath: []
                    }
                ]
            }
        });

        renderWithOpenParserDiagnostics();

        const allNodes = await screen.findByRole('button', { name: 'All Nodes' });
        await waitFor(() => expect(
            (screen.getByRole('button', { name: 'Selected Branch' }) as HTMLButtonElement).disabled
        ).toBe(false));
        const selectedBranch = screen.getByRole('button', { name: 'Selected Branch' });
        expect(allNodes.getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTitle('Disconnected Loader')).toBeTruthy();

        fireEvent.click(selectedBranch);

        await waitFor(() => expect(
            screen.getByRole('button', { name: 'Selected Branch' }).getAttribute('aria-pressed')
        ).toBe('true'));
        expect(screen.queryByTitle('Disconnected Loader')).toBeNull();
        expect(screen.getByText('2/3')).toBeTruthy();

        fireEvent.change(screen.getByPlaceholderText("Search nodes (e.g. 'ControlNet', 'Seed')..."), {
            target: { value: 'Disconnected' }
        });
        expect(screen.getByText('No matching nodes found.')).toBeTruthy();

        fireEvent.change(screen.getByPlaceholderText("Search nodes (e.g. 'ControlNet', 'Seed')..."), {
            target: { value: 'KSampler' }
        });
        expect(screen.getByTitle('KSampler')).toBeTruthy();
        expect(screen.queryByTitle('SaveImage')).toBeNull();
    });

    it('returns to all nodes when branch navigation targets an external node', async () => {
        mockInspectComfyuiWorkflowGraph.mockResolvedValueOnce({
            status: 'ok',
            data: {
                ...workflowGraphReport,
                nodeCount: 3,
                edges: [
                    ...workflowGraphReport.edges,
                    {
                        sourceNodeId: '3',
                        sourceOutputSlot: 0,
                        targetNodeId: '12',
                        targetInputName: 'model',
                        targetInputSlot: null
                    }
                ],
                nodes: [
                    ...workflowGraphReport.nodes,
                    {
                        id: '12',
                        nodeType: 'ExternalNode',
                        title: 'External Dependency',
                        inputs: {},
                        subgraphPath: []
                    }
                ]
            }
        });

        renderWithOpenParserDiagnostics();

        await waitFor(() => expect(
            (screen.getByRole('button', { name: 'Selected Branch' }) as HTMLButtonElement).disabled
        ).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Selected Branch' }));
        fireEvent.click(screen.getByTitle('KSampler').closest('button')!);
        fireEvent.click(screen.getByLabelText('Open outgoing connected node External Dependency (12)'));

        const allNodes = screen.getByRole('button', { name: 'All Nodes' });
        await waitFor(() => expect(allNodes.getAttribute('aria-pressed')).toBe('true'));
        const externalNode = document.querySelector<HTMLElement>('[data-workflow-node-id="12"]');
        await waitFor(() => expect(document.activeElement).toBe(externalNode));
        expect(externalNode?.className).toContain('ring-2');
    });

    it('renders parser-selected output and root anchors and focuses either node', async () => {
        renderWithOpenParserDiagnostics();

        const outputAnchor = await screen.findByLabelText('Open selected output node SaveImage (9)');
        expect(screen.getByLabelText('Open root sampler node KSampler (3)')).toBeTruthy();
        expect(screen.getAllByText('Selected Output')).toHaveLength(2);
        expect(screen.getAllByText('Root Sampler')).toHaveLength(2);
        expect(outputAnchor.className).toContain('w-full');
        expect(outputAnchor.parentElement?.className).toContain('grid-cols-1');
        expect(outputAnchor.parentElement?.className).toContain('sm:grid-cols-2');

        const search = screen.getByPlaceholderText("Search nodes (e.g. 'ControlNet', 'Seed')...") as HTMLInputElement;
        fireEvent.change(search, { target: { value: 'KSampler' } });
        fireEvent.click(outputAnchor);

        await waitFor(() => expect(search.value).toBe(''));
        const outputNode = document.querySelector<HTMLElement>('[data-workflow-node-id="9"]');
        await waitFor(() => expect(document.activeElement).toBe(outputNode));
        expect(outputNode?.className).toContain('ring-2');

        fireEvent.click(screen.getByLabelText('Open root sampler node KSampler (3)'));
        const rootNode = document.querySelector<HTMLElement>('[data-workflow-node-id="3"]');
        await waitFor(() => expect(document.activeElement).toBe(rootNode));
        expect(rootNode?.className).toContain('ring-2');
    });

    it('navigates every available metadata source node and leaves selected-branch mode when needed', async () => {
        mockInspectComfyuiMetadataChunks.mockResolvedValueOnce({
            status: 'ok',
            data: {
                ...diagnosticsReport,
                fieldSourceNodeIds: {
                    model: ['3', '12'],
                    positive_prompt: ['404']
                }
            }
        });
        mockInspectComfyuiWorkflowGraph.mockResolvedValueOnce({
            status: 'ok',
            data: {
                ...workflowGraphReport,
                nodeCount: 3,
                nodes: [
                    ...workflowGraphReport.nodes,
                    {
                        id: '12',
                        nodeType: 'CheckpointLoaderSimple',
                        title: 'Disconnected Loader',
                        inputs: {},
                        subgraphPath: []
                    }
                ]
            }
        });

        renderWithOpenParserDiagnostics();

        await waitFor(() => expect(
            (screen.getByRole('button', { name: 'Selected Branch' }) as HTMLButtonElement).disabled
        ).toBe(false));
        expect(await screen.findByTitle('Jump to source node 3: KSampler')).toBeTruthy();
        expect(screen.getByTitle('Jump to source node 12: Disconnected Loader')).toBeTruthy();
        expect(screen.getByTitle('Source node 404 is not available in the normalized workflow graph.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Selected Branch' }));
        const search = screen.getByPlaceholderText("Search nodes (e.g. 'ControlNet', 'Seed')...") as HTMLInputElement;
        fireEvent.change(search, { target: { value: 'KSampler' } });
        fireEvent.click(screen.getByTitle('Jump to source node 12: Disconnected Loader'));

        await waitFor(() => expect(screen.getByRole('button', { name: 'All Nodes' }).getAttribute('aria-pressed')).toBe('true'));
        expect(search.value).toBe('');
        const loader = document.querySelector<HTMLElement>('[data-workflow-node-id="12"]');
        await waitFor(() => expect(document.activeElement).toBe(loader));
        expect(loader?.className).toContain('ring-2');
    });

    it('labels conflicting roots as candidates without claiming authority', async () => {
        mockInspectComfyuiWorkflowGraph.mockResolvedValueOnce({
            status: 'ok',
            data: {
                ...workflowGraphReport,
                rootSamplerNodeIds: ['3', '7'],
                outputAmbiguous: true,
                nodes: [
                    ...workflowGraphReport.nodes,
                    {
                        id: '7',
                        nodeType: 'KSampler',
                        title: 'Alternate Sampler',
                        inputs: {},
                        subgraphPath: []
                    }
                ]
            }
        });

        renderWithOpenParserDiagnostics();

        expect(await screen.findByText(/Multiple root samplers were found/)).toBeTruthy();
        expect(screen.getAllByText('Root Candidate')).toHaveLength(4);
        expect(screen.queryByText('Root Sampler')).toBeNull();
        expect((screen.getByRole('button', { name: 'Selected Branch' }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByTitle('Unavailable because selected outputs resolve to different root samplers.')).toBeTruthy();
    });

    it('keeps samplerless selected outputs visible without fabricating a root', async () => {
        mockInspectComfyuiWorkflowGraph.mockResolvedValueOnce({
            status: 'ok',
            data: {
                ...workflowGraphReport,
                rootSamplerNodeIds: [],
                selectedBranchNodeIds: [],
                edges: [],
                nodes: [workflowGraphReport.nodes[1]]
            }
        });

        renderWithOpenParserDiagnostics();

        expect(await screen.findByText('No sampler root was found for the selected output.')).toBeTruthy();
        expect(screen.getByLabelText('Open selected output node SaveImage (9)')).toBeTruthy();
        expect(screen.queryByText('Root Sampler')).toBeNull();
        expect((screen.getByRole('button', { name: 'Selected Branch' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('falls back to the local graph when backend inspection fails', async () => {
        mockInspectComfyuiWorkflowGraph.mockResolvedValueOnce({
            status: 'error',
            error: 'normalizer unavailable'
        });

        renderWithOpenParserDiagnostics();

        await waitFor(() => expect(mockInspectComfyuiWorkflowGraph).toHaveBeenCalledTimes(1));
        expect(screen.getByTitle('KSampler')).toBeTruthy();
        expect(screen.getByTitle('SaveImage')).toBeTruthy();
        expect(screen.getByText('API Prompt')).toBeTruthy();
        expect(screen.queryByLabelText('Parser-selected workflow anchors')).toBeNull();
        expect((screen.getByRole('button', { name: 'Selected Branch' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('keeps copy pointed at the preserved workflow after displaying the API prompt', async () => {
        renderWithOpenParserDiagnostics();

        expect(await screen.findByText('API Prompt')).toBeTruthy();
        fireEvent.click(screen.getByTitle('Copy to clipboard'));

        expect(mockClipboardWriteText).toHaveBeenCalledWith(workflowJson);
        expect(mockClipboardWriteText).not.toHaveBeenCalledWith(promptJson);
    });

    it('copies compact parser diagnostics without raw chunk bodies', async () => {
        renderWithOpenParserDiagnostics();

        fireEvent.click(await screen.findByTitle('Copy parser diagnostics summary'));

        await waitFor(() => {
            expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);
        });
        const copied = mockClipboardWriteText.mock.calls[0][0] as string;
        const parsed = JSON.parse(copied) as {
            appVersion: string;
            parserVersion: number;
            image: { format: string; width: number; height: number };
            chunkKeys: string[];
            chunkLengths: Record<string, number>;
            graphNodeCount: number;
            outputSelection: {
                selectedOutputCandidateCount: number;
                uniqueOutputRootSamplerCount: number;
                ambiguous: boolean;
            };
            fieldSources: Record<string, string>;
            resourceSources: Array<{ field: string; value: string; layer: string | null; nodeIds: string[] }>;
            traversalIssues: unknown[];
            traversalIssuesTruncated: boolean;
            metadata: { model: string };
            chunks?: unknown;
            prompt?: unknown;
            workflow?: unknown;
        };

        expect(parsed.appVersion).toBe('0.10.0');
        expect(parsed.parserVersion).toBe(46);
        expect(parsed.image).toEqual({ format: 'png', width: 512, height: 512 });
        expect(parsed.chunkKeys).toEqual(['prompt', 'workflow']);
        expect(parsed.chunkLengths).toEqual({
            prompt: promptJson.length,
            workflow: workflowJson.length
        });
        expect(parsed.graphNodeCount).toBe(2);
        expect(parsed.outputSelection).toEqual({
            selectedOutputCandidateCount: 1,
            uniqueOutputRootSamplerCount: 1,
            ambiguous: false
        });
        expect(parsed.fieldSources.model).toBe('sampler_traversal');
        expect(parsed.resourceSources).toEqual([]);
        expect(parsed.traversalIssues).toEqual([]);
        expect(parsed.traversalIssuesTruncated).toBe(false);
        expect(parsed.metadata.model).toBe('diagnostic_model');
        expect(parsed).not.toHaveProperty('chunks');
        expect(parsed).not.toHaveProperty('prompt');
        expect(parsed).not.toHaveProperty('workflow');
        expect(parsed).not.toHaveProperty('imageId');
        expect(copied).not.toContain('C:/library/comfy.png');
        expect(await screen.findByText('Copied')).toBeTruthy();
    });

    it('confirms and saves a local support bundle with raw chunks', async () => {
        renderWithOpenParserDiagnostics();

        fireEvent.click(await screen.findByTitle('Export parser support bundle'));
        expect(screen.getByText('Export ComfyUI support bundle?')).toBeTruthy();
        expect(screen.getByText(/Ambit will not upload it/i)).toBeTruthy();

        fireEvent.click(screen.getAllByRole('button', { name: 'Export Bundle' })[1]);

        await waitFor(() => expect(mockWriteTextFile).toHaveBeenCalledTimes(1));
        expect(mockSave).toHaveBeenCalledWith({
            filters: [{ name: 'JSON', extensions: ['json'] }],
            defaultPath: 'ambit-comfyui-support.json'
        });
        const [path, contents] = mockWriteTextFile.mock.calls[0] as [string, string];
        expect(path).toBe('C:/exports/ambit-comfyui-support.json');
        const bundle = JSON.parse(contents) as {
            schemaVersion: number;
            chunks: Record<string, string>;
            image: Record<string, unknown>;
        };
        expect(bundle.schemaVersion).toBe(1);
        expect(bundle.chunks).toEqual({ prompt: promptJson, workflow: workflowJson });
        expect(bundle.image).toEqual({ format: 'png', width: 512, height: 512 });
        expect(bundle).not.toHaveProperty('imageId');
    });

    it('treats support bundle save cancellation as a no-op', async () => {
        mockSave.mockResolvedValueOnce(null);
        renderWithOpenParserDiagnostics();

        fireEvent.click(await screen.findByTitle('Export parser support bundle'));
        fireEvent.click(screen.getAllByRole('button', { name: 'Export Bundle' })[1]);

        await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
        expect(mockWriteTextFile).not.toHaveBeenCalled();
        expect(screen.queryByText(/Support bundle export failed/i)).toBeNull();
    });

    it('shows support bundle write failures without breaking diagnostics', async () => {
        mockWriteTextFile.mockRejectedValueOnce(new Error('disk full'));
        renderWithOpenParserDiagnostics();

        fireEvent.click(await screen.findByTitle('Export parser support bundle'));
        fireEvent.click(screen.getAllByRole('button', { name: 'Export Bundle' })[1]);

        expect(await screen.findByText(/Support bundle export failed: disk full/i)).toBeTruthy();
        expect(screen.getByText('Parser Diagnostics')).toBeTruthy();
    });

    it('resets copied diagnostics feedback after its display interval', async () => {
        renderWithOpenParserDiagnostics();
        const copyButton = await screen.findByTitle('Copy parser diagnostics summary');
        vi.useFakeTimers();
        await act(async () => {
            fireEvent.click(copyButton);
            await Promise.resolve();
        });
        expect(screen.getByText('Copied')).toBeTruthy();

        act(() => vi.advanceTimersByTime(2000));

        expect(screen.getByText('Copy Diagnostics')).toBeTruthy();
    });

    it('renders global, explicit, empty, and missing diagnostic evidence', async () => {
        mockInspectComfyuiMetadataChunks.mockResolvedValue({
            status: 'ok',
            data: {
                ...diagnosticsReport,
                chunkKeys: [],
                attemptedLayers: [],
                fieldSources: {
                    model: 'global_scan',
                    seed: 'explicit_node',
                    cfg: null,
                },
                metadata: {
                    ...diagnosticsReport.metadata,
                    model: null,
                    sampler: '',
                },
            },
        });
        renderWithOpenParserDiagnostics();

        expect(await screen.findByTitle('Global Scan')).toBeTruthy();
        expect(screen.getByTitle('Explicit Node')).toBeTruthy();
        expect(screen.getAllByText('None').length).toBeGreaterThan(1);
    });

    it('shows that raw chunks are unavailable without invoking diagnostics', () => {
        render(<WorkflowInspector image={{ ...makeImage(), originalChunks: undefined }} />);
        openParserDiagnostics();

        expect(screen.getByText('Raw chunks unavailable.')).toBeTruthy();
        expect(mockInspectComfyuiMetadataChunks).not.toHaveBeenCalled();
    });

    it('ignores diagnostics completion after unmount', async () => {
        let resolveInspection!: (value: { status: 'ok'; data: typeof diagnosticsReport }) => void;
        mockInspectComfyuiMetadataChunks.mockReturnValueOnce(new Promise(resolve => {
            resolveInspection = resolve;
        }));
        const view = renderWithOpenParserDiagnostics();
        view.unmount();

        resolveInspection({ status: 'ok', data: diagnosticsReport });
        await act(async () => Promise.resolve());
    });

    it('ignores diagnostics rejection after unmount', async () => {
        let rejectInspection!: (reason: unknown) => void;
        mockInspectComfyuiMetadataChunks.mockReturnValueOnce(new Promise((_resolve, reject) => {
            rejectInspection = reject;
        }));
        const view = renderWithOpenParserDiagnostics();
        view.unmount();

        rejectInspection('late failure');
        await act(async () => Promise.resolve());
    });

    it('formats non-Error diagnostics failures', async () => {
        mockInspectComfyuiMetadataChunks.mockRejectedValueOnce('bridge unavailable');
        renderWithOpenParserDiagnostics();

        expect(await screen.findByText(/Diagnostics unavailable: bridge unavailable/i)).toBeTruthy();
    });

    it('formats Error diagnostics failures', async () => {
        mockInspectComfyuiMetadataChunks.mockRejectedValueOnce(new Error('bridge crashed'));
        renderWithOpenParserDiagnostics();

        expect(await screen.findByText(/Diagnostics unavailable: bridge crashed/i)).toBeTruthy();
    });

    it('renders an explicit empty state when diagnostics have no field sources', async () => {
        mockInspectComfyuiMetadataChunks.mockResolvedValueOnce({
            status: 'ok',
            data: { ...diagnosticsReport, fieldSources: {} },
        });
        renderWithOpenParserDiagnostics();

        await screen.findByText('Parser Diagnostics');
        expect(screen.getAllByText('None').length).toBeGreaterThan(0);
    });

    it('does not reserve toolbar space while parser diagnostics are collapsed', () => {
        render(<WorkflowInspector image={makeImage()} />);

        expect(screen.queryByLabelText('Parser diagnostics actions')).toBeNull();
    });

    it('keeps diagnostic actions and long values readable in the narrow viewer sidebar', async () => {
        renderWithOpenParserDiagnostics();

        await screen.findByText('diagnostic_model');
        const actions = screen.getByRole('group', { name: 'Parser diagnostics actions' });
        expect(actions.className).toContain('flex-wrap');
        expect(actions.parentElement?.className).toContain('flex-col');

        const layers = screen.getByText('Layers').parentElement;
        expect(layers?.parentElement?.className).toContain('grid-cols-1');
        expect(layers?.querySelector('.font-mono')?.className).toContain('break-words');
        expect(layers?.querySelector('.font-mono')?.className).not.toContain('break-all');
    });

    it('marks sampler fallback diagnostics as weaker evidence', async () => {
        mockInspectComfyuiMetadataChunks.mockResolvedValue({
            status: 'ok',
            data: {
                ...diagnosticsReport,
                fieldSources: {
                    ...diagnosticsReport.fieldSources,
                    seed: 'sampler_fallback'
                }
            }
        });

        renderWithOpenParserDiagnostics();

        expect(
            await screen.findByTitle('Sampler fallback: found by scanning samplers, weaker than saved-output traversal.')
        ).toBeTruthy();
    });

    it('identifies retained flat parameters as medium-confidence evidence', async () => {
        mockInspectComfyuiMetadataChunks.mockResolvedValue({
            status: 'ok',
            data: {
                ...diagnosticsReport,
                fieldSources: {
                    ...diagnosticsReport.fieldSources,
                    seed: 'flat_parameters'
                }
            }
        });

        renderWithOpenParserDiagnostics();

        expect(
            await screen.findByTitle('Flat parameters: embedded saver metadata, stronger than fallback scans but weaker than saved-output traversal.')
        ).toBeTruthy();
    });

    it('navigates to an available resource source and leaves selected-branch mode', async () => {
        mockInspectComfyuiMetadataChunks.mockResolvedValueOnce({
            status: 'ok',
            data: {
                ...diagnosticsReport,
                resourceSources: [{
                    field: 'loras',
                    value: 'disconnected_style',
                    layer: 'sampler_traversal',
                    nodeIds: ['12']
                }]
            }
        });
        mockInspectComfyuiWorkflowGraph.mockResolvedValueOnce({
            status: 'ok',
            data: {
                ...workflowGraphReport,
                nodeCount: 3,
                nodes: [
                    ...workflowGraphReport.nodes,
                    {
                        id: '12',
                        nodeType: 'LoraLoaderModelOnly',
                        title: 'Disconnected LoRA',
                        inputs: {},
                        subgraphPath: []
                    }
                ]
            }
        });

        renderWithOpenParserDiagnostics();

        await waitFor(() => expect(
            (screen.getByRole('button', { name: 'Selected Branch' }) as HTMLButtonElement).disabled
        ).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Selected Branch' }));
        const search = screen.getByPlaceholderText("Search nodes (e.g. 'ControlNet', 'Seed')...") as HTMLInputElement;
        fireEvent.change(search, { target: { value: 'KSampler' } });
        fireEvent.click(await screen.findByRole('button', {
            name: 'Jump to LoRAs resource source node Disconnected LoRA (12)'
        }));

        await waitFor(() => expect(screen.getByRole('button', { name: 'All Nodes' }).getAttribute('aria-pressed')).toBe('true'));
        expect(search.value).toBe('');
        const sourceNode = document.querySelector<HTMLElement>('[data-workflow-node-id="12"]');
        await waitFor(() => expect(document.activeElement).toBe(sourceNode));
        expect(sourceNode?.className).toContain('ring-2');
    });

    it('keeps flat and unavailable resource sources visible without fake navigation', async () => {
        mockInspectComfyuiMetadataChunks.mockResolvedValueOnce({
            status: 'ok',
            data: {
                ...diagnosticsReport,
                resourceSources: [
                    {
                        field: 'embeddings',
                        value: 'flat_detail',
                        layer: 'flat_parameters',
                        nodeIds: []
                    },
                    {
                        field: 'ip_adapters',
                        value: 'missing_adapter',
                        layer: 'sampler_traversal',
                        nodeIds: ['404']
                    }
                ]
            }
        });

        renderWithOpenParserDiagnostics();

        expect(await screen.findByText('Resource Sources')).toBeTruthy();
        expect(screen.getByText('flat_detail')).toBeTruthy();
        expect(screen.getByTitle('Flat parameters: embedded saver metadata, stronger than fallback scans but weaker than saved-output traversal.')).toBeTruthy();
        expect(screen.getByText('missing_adapter')).toBeTruthy();
        expect(screen.getByTitle('Resource source node 404 is not available in the normalized workflow graph.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /resource source node.*404/i })).toBeNull();
    });

    it('renders compact traversal blockers and output ambiguity', async () => {
        mockInspectComfyuiMetadataChunks.mockResolvedValue({
            status: 'ok',
            data: {
                ...diagnosticsReport,
                selectedOutputCandidateCount: 2,
                uniqueOutputRootSamplerCount: 2,
                outputAmbiguous: true,
                traversalIssues: [{
                    field: 'positive_prompt',
                    nodeId: '30:19',
                    nodeType: 'TextGenerate',
                    inputName: 'text',
                    reason: 'generated_value_unavailable'
                }]
            }
        });

        renderWithOpenParserDiagnostics();

        expect(await screen.findByText('2 outputs / 2 roots')).toBeTruthy();
        expect(screen.getByTitle('Multiple saved-output roots were found, so no branch received strong traversal authority.')).toBeTruthy();
        expect(screen.getByText('Traversal Blockers')).toBeTruthy();
        const blocker = screen.getByTitle('The value is generated at runtime and no literal result is embedded in the image.');
        expect(blocker.textContent).toContain('Positive Prompt at #30:19 (TextGenerate) / text: Generated Value Unavailable');
        expect(screen.getByTitle('Traversal blocker node 30:19 is not available in the normalized workflow graph.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /traversal blocker node.*30:19/i })).toBeNull();
    });

    it('navigates to an available traversal blocker and leaves selected-branch mode', async () => {
        mockInspectComfyuiMetadataChunks.mockResolvedValueOnce({
            status: 'ok',
            data: {
                ...diagnosticsReport,
                traversalIssues: [{
                    field: 'model',
                    nodeId: '12',
                    nodeType: 'CheckpointLoaderSimple',
                    inputName: 'model',
                    reason: 'unsupported_node'
                }]
            }
        });
        mockInspectComfyuiWorkflowGraph.mockResolvedValueOnce({
            status: 'ok',
            data: {
                ...workflowGraphReport,
                nodeCount: 3,
                nodes: [
                    ...workflowGraphReport.nodes,
                    {
                        id: '12',
                        nodeType: 'CheckpointLoaderSimple',
                        title: 'Disconnected Loader',
                        inputs: {},
                        subgraphPath: []
                    }
                ]
            }
        });

        renderWithOpenParserDiagnostics();

        await waitFor(() => expect(
            (screen.getByRole('button', { name: 'Selected Branch' }) as HTMLButtonElement).disabled
        ).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Selected Branch' }));
        const search = screen.getByPlaceholderText("Search nodes (e.g. 'ControlNet', 'Seed')...") as HTMLInputElement;
        fireEvent.change(search, { target: { value: 'KSampler' } });
        fireEvent.click(await screen.findByRole('button', {
            name: 'Jump to traversal blocker node Disconnected Loader (12)'
        }));

        await waitFor(() => expect(screen.getByRole('button', { name: 'All Nodes' }).getAttribute('aria-pressed')).toBe('true'));
        expect(search.value).toBe('');
        const blockerNode = document.querySelector<HTMLElement>('[data-workflow-node-id="12"]');
        await waitFor(() => expect(document.activeElement).toBe(blockerNode));
        expect(blockerNode?.className).toContain('ring-2');
    });

    it('expands and collapses every returned traversal blocker', async () => {
        const traversalIssues = Array.from({ length: 6 }, (_, index) => ({
            field: 'positive_prompt',
            nodeId: String(100 + index),
            nodeType: 'UnknownTextNode',
            inputName: 'text',
            reason: 'unsupported_node'
        }));
        mockInspectComfyuiMetadataChunks.mockResolvedValueOnce({
            status: 'ok',
            data: { ...diagnosticsReport, traversalIssues }
        });

        renderWithOpenParserDiagnostics();

        expect(await screen.findByText('#103')).toBeTruthy();
        expect(screen.queryByText('#104')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Show all (6)' }));
        expect(screen.getByText('#105')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
        expect(screen.queryByText('#104')).toBeNull();
    });

    it('does not inspect a newly navigated image until diagnostics are expanded again', async () => {
        const view = renderWithOpenParserDiagnostics();
        await waitFor(() => expect(mockInspectComfyuiMetadataChunks).toHaveBeenCalledTimes(1));
        await screen.findByText('diagnostic_model');

        view.rerender(<WorkflowInspector image={{ ...makeImage(), id: 'C:/library/other.png', filename: 'other.png' }} />);

        await waitFor(() => expect(
            screen.getByRole('button', { name: 'Parser Diagnostics' }).getAttribute('aria-expanded')
        ).toBe('false'));
        expect(mockInspectComfyuiMetadataChunks).toHaveBeenCalledTimes(1);
        view.rerender(<WorkflowInspector image={makeImage()} />);
        expect(screen.getByRole('button', { name: 'Parser Diagnostics' }).getAttribute('aria-expanded')).toBe('false');
        expect(mockInspectComfyuiMetadataChunks).toHaveBeenCalledTimes(1);
    });
    it('resets expanded blockers when diagnostics change to another image', async () => {
        const traversalIssues = Array.from({ length: 6 }, (_, index) => ({
            field: 'positive_prompt',
            nodeId: String(200 + index),
            nodeType: 'UnknownTextNode',
            inputName: 'text',
            reason: 'unsupported_node'
        }));
        mockInspectComfyuiMetadataChunks.mockResolvedValue({
            status: 'ok',
            data: { ...diagnosticsReport, traversalIssues }
        });
        const view = renderWithOpenParserDiagnostics();

        fireEvent.click(await screen.findByRole('button', { name: 'Show all (6)' }));
        expect(screen.getByText('#205')).toBeTruthy();

        view.rerender(<WorkflowInspector image={{ ...makeImage(), id: 'C:/library/other.png', filename: 'other.png' }} />);

        await waitFor(() => expect(screen.queryByText('#205')).toBeNull());
        await waitFor(() => expect(
            screen.getByRole('button', { name: 'Parser Diagnostics' }).getAttribute('aria-expanded')
        ).toBe('false'));
        openParserDiagnostics();
        expect((await screen.findByRole('button', { name: 'Show all (6)' })).getAttribute('aria-expanded')).toBe('false');
    });

    it('copies the complete capped blocker list without raw metadata bodies', async () => {
        const traversalIssues = Array.from({ length: 6 }, (_, index) => ({
            field: 'positive_prompt',
            nodeId: String(index),
            nodeType: 'UnknownTextNode',
            inputName: 'text',
            reason: 'unsupported_node'
        }));
        mockInspectComfyuiMetadataChunks.mockResolvedValue({
            status: 'ok',
            data: {
                ...diagnosticsReport,
                traversalIssues,
                traversalIssuesTruncated: true
            }
        });
        renderWithOpenParserDiagnostics();

        fireEvent.click(await screen.findByTitle('Copy parser diagnostics summary'));
        await waitFor(() => expect(mockClipboardWriteText).toHaveBeenCalledTimes(1));

        const copied = JSON.parse(mockClipboardWriteText.mock.calls[0][0] as string) as {
            traversalIssues: typeof traversalIssues;
            traversalIssuesTruncated: boolean;
            prompt?: unknown;
            workflow?: unknown;
        };
        expect(copied.traversalIssues).toEqual(traversalIssues);
        expect(copied.traversalIssuesTruncated).toBe(true);
        expect(copied).not.toHaveProperty('prompt');
        expect(copied).not.toHaveProperty('workflow');
        expect(screen.getByRole('button', { name: 'Show all (6)' })).toBeTruthy();
        expect(screen.getByText('Additional traversal blockers were omitted after the diagnostics limit.')).toBeTruthy();
    });

    it('requires a fresh expansion after developer diagnostics are hidden and shown again', async () => {
        const workflowImage = makeImage();
        const view = renderWithOpenParserDiagnostics(workflowImage);
        await waitFor(() => expect(mockInspectComfyuiMetadataChunks).toHaveBeenCalledTimes(1));

        mockSettings.devMode = false;
        view.rerender(<WorkflowInspector image={workflowImage} />);
        expect(screen.queryByText('Parser Diagnostics')).toBeNull();

        mockSettings.devMode = true;
        view.rerender(<WorkflowInspector image={workflowImage} />);

        expect(screen.getByRole('button', { name: 'Parser Diagnostics' }).getAttribute('aria-expanded')).toBe('false');
        expect(mockInspectComfyuiMetadataChunks).toHaveBeenCalledTimes(1);
    });
    it('hides parser diagnostics outside developer mode', () => {
        mockSettings.devMode = false;

        render(<WorkflowInspector image={makeImage()} />);

        expect(screen.queryByText('Parser Diagnostics')).toBeNull();
        expect(mockInspectComfyuiMetadataChunks).not.toHaveBeenCalled();
    });

    it('hides parser diagnostics for non-ComfyUI images', () => {
        render(<WorkflowInspector image={makeImage(GeneratorTool.AUTOMATIC1111)} />);

        expect(screen.queryByText('Parser Diagnostics')).toBeNull();
        expect(mockInspectComfyuiMetadataChunks).not.toHaveBeenCalled();
        expect(mockInspectComfyuiWorkflowGraph).not.toHaveBeenCalled();
    });

    it('does not send video sidecar evidence through image chunk diagnostics', () => {
        const video = {
            ...makeImage(),
            mediaType: 'video',
            mediaContainer: 'WebM',
            durationMs: 2_000,
            videoCodec: 'VP9',
            audioPresent: true,
            rotationDegrees: 0,
            probeStatus: 'ready',
            playbackStatus: 'playable',
        } as VideoAsset;

        render(<WorkflowInspector image={video} />);

        expect(screen.queryByText('Parser Diagnostics')).toBeNull();
        expect(mockInspectComfyuiMetadataChunks).not.toHaveBeenCalled();
    });

    it('renders a diagnostics failure without breaking workflow display', async () => {
        mockInspectComfyuiMetadataChunks.mockResolvedValue({
            status: 'error',
            error: 'parse failed'
        });

        renderWithOpenParserDiagnostics();

        expect(screen.getAllByText('SaveImage').length).toBeGreaterThan(0);
        await waitFor(() => {
            expect(screen.getByText(/Diagnostics unavailable: parse failed/i)).toBeTruthy();
        });
    });
});
