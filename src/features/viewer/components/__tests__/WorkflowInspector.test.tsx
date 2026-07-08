import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import { WorkflowInspector } from '../WorkflowInspector';

const mockInspectComfyuiMetadataChunks = vi.hoisted(() => vi.fn());
const mockSettings = vi.hoisted(() => ({ devMode: true }));

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
        mockInspectComfyuiMetadataChunks.mockReset();
        mockInspectComfyuiMetadataChunks.mockResolvedValue({
            status: 'ok',
            data: diagnosticsReport
        });
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
