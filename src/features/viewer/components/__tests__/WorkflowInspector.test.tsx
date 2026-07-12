import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import { WorkflowInspector } from '../WorkflowInspector';

const mockInspectComfyuiMetadataChunks = vi.hoisted(() => vi.fn());
const mockSettings = vi.hoisted(() => ({ devMode: true }));
const mockClipboardWriteText = vi.hoisted(() => vi.fn());

vi.mock('../../../../bindings', () => ({
    commands: {
        inspectComfyuiMetadataChunks: (...args: unknown[]) => mockInspectComfyuiMetadataChunks(...args)
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
    chunkKeys: ['prompt', 'workflow'],
    hasPromptChunk: true,
    hasWorkflowChunk: true,
    graphNodeCount: 2,
    attemptedLayers: ['workflow_chunk', 'sampler_traversal'],
    fieldSources: {
        model: 'sampler_traversal',
        positive_prompt: 'sampler_traversal',
        workflow_json: 'workflow_chunk'
    },
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

describe('WorkflowInspector ComfyUI parser diagnostics', () => {
    beforeEach(() => {
        mockSettings.devMode = true;
        mockClipboardWriteText.mockReset();
        mockInspectComfyuiMetadataChunks.mockReset();
        mockInspectComfyuiMetadataChunks.mockResolvedValue({
            status: 'ok',
            data: diagnosticsReport
        });
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: mockClipboardWriteText },
            configurable: true
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders parser diagnostics for ComfyUI images in developer mode', async () => {
        render(<WorkflowInspector image={makeImage()} />);

        expect(await screen.findByText('Parser Diagnostics')).toBeTruthy();
        expect(screen.getByText('diagnostic_model')).toBeTruthy();
        expect(screen.getAllByText(/Sampler Traversal/i).length).toBeGreaterThan(0);
        expect(mockInspectComfyuiMetadataChunks).toHaveBeenCalledWith({
            workflow: workflowJson,
            prompt: promptJson
        });
    });

    it('copies compact parser diagnostics without raw chunk bodies', async () => {
        render(<WorkflowInspector image={makeImage()} />);

        fireEvent.click(await screen.findByTitle('Copy parser diagnostics summary'));

        await waitFor(() => {
            expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);
        });
        const copied = mockClipboardWriteText.mock.calls[0][0] as string;
        const parsed = JSON.parse(copied) as {
            imageId: string;
            chunkKeys: string[];
            chunkLengths: Record<string, number>;
            graphNodeCount: number;
            fieldSources: Record<string, string>;
            metadata: { model: string };
            chunks?: unknown;
            prompt?: unknown;
            workflow?: unknown;
        };

        expect(parsed.imageId).toBe('C:/library/comfy.png');
        expect(parsed.chunkKeys).toEqual(['prompt', 'workflow']);
        expect(parsed.chunkLengths).toEqual({
            prompt: promptJson.length,
            workflow: workflowJson.length
        });
        expect(parsed.graphNodeCount).toBe(2);
        expect(parsed.fieldSources.model).toBe('sampler_traversal');
        expect(parsed.metadata.model).toBe('diagnostic_model');
        expect(parsed).not.toHaveProperty('chunks');
        expect(parsed).not.toHaveProperty('prompt');
        expect(parsed).not.toHaveProperty('workflow');
        expect(await screen.findByText('Copied')).toBeTruthy();
    });

    it('resets copied diagnostics feedback after its display interval', async () => {
        render(<WorkflowInspector image={makeImage()} />);
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
        render(<WorkflowInspector image={makeImage()} />);

        expect(await screen.findByTitle('Global Scan')).toBeTruthy();
        expect(screen.getByTitle('Explicit Node')).toBeTruthy();
        expect(screen.getAllByText('None').length).toBeGreaterThan(1);
    });

    it('shows that raw chunks are unavailable without invoking diagnostics', () => {
        render(<WorkflowInspector image={{ ...makeImage(), originalChunks: undefined }} />);

        expect(screen.getByText('Raw chunks unavailable.')).toBeTruthy();
        expect(mockInspectComfyuiMetadataChunks).not.toHaveBeenCalled();
    });

    it('ignores diagnostics completion after unmount', async () => {
        let resolveInspection!: (value: { status: 'ok'; data: typeof diagnosticsReport }) => void;
        mockInspectComfyuiMetadataChunks.mockReturnValueOnce(new Promise(resolve => {
            resolveInspection = resolve;
        }));
        const view = render(<WorkflowInspector image={makeImage()} />);
        view.unmount();

        resolveInspection({ status: 'ok', data: diagnosticsReport });
        await act(async () => Promise.resolve());
    });

    it('ignores diagnostics rejection after unmount', async () => {
        let rejectInspection!: (reason: unknown) => void;
        mockInspectComfyuiMetadataChunks.mockReturnValueOnce(new Promise((_resolve, reject) => {
            rejectInspection = reject;
        }));
        const view = render(<WorkflowInspector image={makeImage()} />);
        view.unmount();

        rejectInspection('late failure');
        await act(async () => Promise.resolve());
    });

    it('formats non-Error diagnostics failures', async () => {
        mockInspectComfyuiMetadataChunks.mockRejectedValueOnce('bridge unavailable');
        render(<WorkflowInspector image={makeImage()} />);

        expect(await screen.findByText(/Diagnostics unavailable: bridge unavailable/i)).toBeTruthy();
    });

    it('formats Error diagnostics failures', async () => {
        mockInspectComfyuiMetadataChunks.mockRejectedValueOnce(new Error('bridge crashed'));
        render(<WorkflowInspector image={makeImage()} />);

        expect(await screen.findByText(/Diagnostics unavailable: bridge crashed/i)).toBeTruthy();
    });

    it('renders an explicit empty state when diagnostics have no field sources', async () => {
        mockInspectComfyuiMetadataChunks.mockResolvedValueOnce({
            status: 'ok',
            data: { ...diagnosticsReport, fieldSources: {} },
        });
        render(<WorkflowInspector image={makeImage()} />);

        await screen.findByText('Parser Diagnostics');
        expect(screen.getAllByText('None').length).toBeGreaterThan(0);
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

        render(<WorkflowInspector image={makeImage()} />);

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

        render(<WorkflowInspector image={makeImage()} />);

        expect(
            await screen.findByTitle('Flat parameters: embedded saver metadata, stronger than fallback scans but weaker than saved-output traversal.')
        ).toBeTruthy();
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
    });

    it('renders a diagnostics failure without breaking workflow display', async () => {
        mockInspectComfyuiMetadataChunks.mockResolvedValue({
            status: 'error',
            error: 'parse failed'
        });

        render(<WorkflowInspector image={makeImage()} />);

        expect(screen.getAllByText('SaveImage').length).toBeGreaterThan(0);
        await waitFor(() => {
            expect(screen.getByText(/Diagnostics unavailable: parse failed/i)).toBeTruthy();
        });
    });
});
