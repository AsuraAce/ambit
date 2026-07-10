import * as React from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { act, fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import { WorkflowInspector } from '../WorkflowInspector';

const workflowMocks = vi.hoisted(() => ({
    scanImageWorkflow: vi.fn(),
    updateImageWorkflow: vi.fn(),
    updateImageWorkflowHint: vi.fn()
}));

vi.mock('../../../../services/metadataParser', () => ({
    scanImageWorkflow: workflowMocks.scanImageWorkflow
}));

vi.mock('../../../../services/db/imageRepo', () => ({
    updateImageWorkflow: workflowMocks.updateImageWorkflow,
    updateImageWorkflowHint: workflowMocks.updateImageWorkflowHint
}));

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

const createImage = (overrides: Partial<AIImage> = {}): AIImage => ({
    id: 'C:/library/image.png',
    url: 'asset://image.png',
    thumbnailUrl: 'asset://thumb.webp',
    filename: 'image.png',
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.COMFYUI,
        model: 'Model',
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: 'prompt',
        negativePrompt: ''
    },
    ...overrides
});

const withWorkflow = (workflowJson: string, overrides: Partial<AIImage> = {}): AIImage => {
    const base = createImage(overrides);
    return {
        ...base,
        metadata: {
            ...base.metadata,
            workflowJson
        }
    };
};

describe('WorkflowInspector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        workflowMocks.scanImageWorkflow.mockResolvedValue(null);
        workflowMocks.updateImageWorkflow.mockResolvedValue(undefined);
        workflowMocks.updateImageWorkflowHint.mockResolvedValue(undefined);
        vi.mocked(save).mockReset();
        vi.mocked(writeTextFile).mockReset();
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: vi.fn().mockResolvedValue(undefined) }
        });
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        if (originalClipboardDescriptor) {
            Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
        } else {
            Reflect.deleteProperty(navigator, 'clipboard');
        }
    });

    it('normalizes, prioritizes, filters, and expands saved node arrays', () => {
        const workflow = JSON.stringify({
            nodes: [
                { id: 30, type: 'CheckpointLoaderSimple', title: 'Load Model', inputs: { model: 'model.safetensors' } },
                { id: 20, class_type: 'CLIPTextEncode', label: 'Positive Prompt', inputs: { text: 'a bright landscape' } },
                {
                    id: 10,
                    class_type: 'KSampler',
                    title: 'Sampler',
                    inputs: {
                        seed: 42,
                        enabled: true,
                        optional: null,
                        connection: { node: 1 },
                        longLink: ['x'.repeat(60), 0],
                        values: ['euler', 1]
                    }
                },
                { id: 40, type: 'EmptyNode', title: 'Empty', inputs: {} }
            ]
        });

        render(<WorkflowInspector image={withWorkflow(workflow)} />);

        const headings = screen.getAllByTitle(/Sampler|Positive Prompt|Load Model|Empty/).map(node => node.textContent);
        expect(headings).toEqual(['Sampler', 'Positive Prompt', 'Load Model', 'Empty']);
        expect(screen.getByText('4')).toBeTruthy();

        fireEvent.click(screen.getByTitle('Sampler'));
        expect(screen.getByText('seed:')).toBeTruthy();
        expect(screen.getByText('42')).toBeTruthy();
        expect(screen.getByText('enabled:')).toBeTruthy();
        expect(screen.queryByText('connection:')).toBeNull();
        expect(screen.queryByText('longLink:')).toBeNull();
        fireEvent.click(screen.getByTitle('Sampler'));

        const search = screen.getByPlaceholderText("Search nodes (e.g. 'ControlNet', 'Seed')...");
        fireEvent.change(search, { target: { value: 'loader' } });
        expect(screen.getByTitle('Load Model')).toBeTruthy();
        expect(screen.queryByTitle('Sampler')).toBeNull();
        fireEvent.change(search, { target: { value: 'missing' } });
        expect(screen.getByText('No matching nodes found.')).toBeTruthy();
        fireEvent.change(search, { target: { value: '' } });
        expect(screen.getByTitle('Sampler')).toBeTruthy();
    });

    it('extracts mixed JSON and refines flat InvokeAI invocation nodes', () => {
        const workflow = `metadata prefix ${JSON.stringify({
            z: {
                type: 'invocation',
                node_type: 'denoise_latents',
                title: 'invocation',
                inputs: { label: 'Denoise', strength: 0.6 }
            },
            a: {
                type: 'invocation',
                inputs: { type: 'prompt_builder', title: 'Prompt Builder', text: 'hello' }
            },
            ignored: 'not a node'
        })} trailing text`;

        render(<WorkflowInspector image={withWorkflow(workflow)} />);

        expect(screen.getByTitle('Denoise')).toBeTruthy();
        expect(screen.getByText('denoise_latents')).toBeTruthy();
        expect(screen.getByTitle('Prompt Builder')).toBeTruthy();
        expect(screen.getByText('prompt_builder')).toBeTruthy();
        fireEvent.click(screen.getByTitle('Denoise'));
        expect(screen.getByText('strength:')).toBeTruthy();
        expect(screen.getByText('0.6')).toBeTruthy();
    });

    it('renders raw and tool-specific empty states for non-graph workflow data', () => {
        const raw = '{"session":"complex"}';
        const { rerender } = render(<WorkflowInspector image={withWorkflow(raw, {
            metadata: {
                ...createImage().metadata,
                tool: GeneratorTool.INVOKEAI,
                workflowJson: raw
            }
        })} />);

        expect(screen.getByText(/complex session structure/i)).toBeTruthy();
        expect(screen.getByText('JSON Preview')).toBeTruthy();
        expect(screen.getByText(/"session"/)).toBeTruthy();

        const malformed = 'not-json';
        rerender(<WorkflowInspector image={withWorkflow(malformed)} />);
        expect(screen.getByText(/raw workflow data/i)).toBeTruthy();
        expect(screen.getByText(/not-json/)).toBeTruthy();
    });

    it('lazy-loads valid workflows and persists the graph', async () => {
        const workflow = JSON.stringify({ nodes: [{ id: 1, class_type: 'KSampler', inputs: { seed: 9 } }] });
        const onWorkflowLoaded = vi.fn();
        workflowMocks.scanImageWorkflow.mockResolvedValueOnce(workflow);

        render(<WorkflowInspector image={createImage()} onWorkflowLoaded={onWorkflowLoaded} />);

        expect(screen.getByText('Reading workflow data from file headers...')).toBeTruthy();
        await waitFor(() => expect(screen.getByTitle('KSampler')).toBeTruthy());
        expect(workflowMocks.scanImageWorkflow).toHaveBeenCalledWith('C:/library/image.png');
        expect(workflowMocks.updateImageWorkflow).toHaveBeenCalledWith('C:/library/image.png', workflow);
        expect(onWorkflowLoaded).toHaveBeenCalledWith(workflow);
        expect(workflowMocks.updateImageWorkflowHint).not.toHaveBeenCalled();
    });

    it('recognizes flat lazy-loaded graphs and persists invalid workflow hints', async () => {
        const flatWorkflow = JSON.stringify({
            one: { class_type: 'KSampler', inputs: { seed: 1 } },
            two: { type: 'Prompt', inputs: { text: 'hello' } },
            metadata: 'ignored'
        });
        workflowMocks.scanImageWorkflow.mockResolvedValueOnce(flatWorkflow);
        const first = render(<WorkflowInspector image={createImage({ id: 'flat.png' })} />);

        await waitFor(() => expect(workflowMocks.updateImageWorkflow).toHaveBeenCalledWith('flat.png', flatWorkflow));
        first.unmount();

        workflowMocks.scanImageWorkflow.mockResolvedValueOnce('{"metadata":true}');
        render(<WorkflowInspector image={createImage({ id: 'invalid.png' })} />);
        await waitFor(() => expect(workflowMocks.updateImageWorkflowHint).toHaveBeenCalledWith('invalid.png', false));
    });

    it('skips known workflow-free images and reports lazy-load failures safely', async () => {
        const withoutWorkflow = createImage({
            metadata: {
                ...createImage().metadata,
                hasWorkflowHint: false
            }
        });
        const first = render(<WorkflowInspector image={withoutWorkflow} />);
        expect(screen.getByText(/generated without a recorded workflow/i)).toBeTruthy();
        expect(workflowMocks.scanImageWorkflow).not.toHaveBeenCalled();
        first.unmount();

        const failure = new Error('scan failed');
        workflowMocks.scanImageWorkflow.mockRejectedValueOnce(failure);
        render(<WorkflowInspector image={createImage({ id: 'failure.png' })} />);
        await waitFor(() => expect(console.error).toHaveBeenCalledWith('[Workflow] Failed lazy loading', failure));
        expect(screen.getByText(/No workflow data was found/i)).toBeTruthy();
    });

    it('copies workflow JSON and resets the copied state', async () => {
        vi.useFakeTimers();
        const workflow = JSON.stringify({ nodes: [{ id: 1, type: 'Prompt', inputs: { text: 'hello' } }] });
        render(<WorkflowInspector image={withWorkflow(workflow)} />);

        fireEvent.click(screen.getByTitle('Copy to clipboard'));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(workflow);
        expect(screen.getByText('Copied')).toBeTruthy();

        await act(async () => vi.advanceTimersByTimeAsync(2000));
        expect(screen.getByText('Copy')).toBeTruthy();
    });

    it('downloads workflow JSON and handles cancel and write failures', async () => {
        const workflow = JSON.stringify({ nodes: [{ id: 1, type: 'Prompt', inputs: { text: 'hello' } }] });
        vi.mocked(save)
            .mockResolvedValueOnce('C:/exports/image_workflow.json')
            .mockResolvedValueOnce(null)
            .mockRejectedValueOnce(new Error('dialog failed'));
        vi.mocked(writeTextFile).mockResolvedValue(undefined);
        render(<WorkflowInspector image={withWorkflow(workflow)} />);

        const download = screen.getByTitle('Download JSON file');
        fireEvent.click(download);
        await waitFor(() => expect(writeTextFile).toHaveBeenCalledWith('C:/exports/image_workflow.json', workflow));
        expect(save).toHaveBeenCalledWith({
            filters: [{ name: 'JSON', extensions: ['json'] }],
            defaultPath: 'image_workflow.json'
        });

        fireEvent.click(download);
        await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
        expect(writeTextFile).toHaveBeenCalledTimes(1);

        fireEvent.click(download);
        await waitFor(() => expect(console.error).toHaveBeenCalledWith('Failed to download workflow', expect.any(Error)));
    });
});
