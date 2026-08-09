import { describe, expect, it } from 'vitest';
import {
    groupWorkflowNodes,
    selectWorkflowGraphSource,
    selectWorkflowJsonForActions,
    workflowGraphSourceFromBackend
} from '../workflowGraphUtils';

const compactTemplateWorkflow = JSON.stringify({
    nodes: [
        { id: 1, type: 'MarkdownNote', widgets_values: ['Krea v2 template'] },
        { id: 30, type: 'ComfyUI-Subgraph', title: 'Krea Image Generation' }
    ]
});

const richerApiPrompt = JSON.stringify({
    '30:6': {
        class_type: 'UNETLoader',
        inputs: { unet_name: 'krea2_turbo_fp8_scaled.safetensors' }
    },
    '30:14': {
        class_type: 'SamplerCustomAdvanced',
        inputs: { sampler_name: 'euler', steps: 8 }
    },
    '30:19': {
        class_type: 'StringConcatenate',
        _meta: { title: 'Positive Prompt' },
        inputs: { string_a: 'glowing forest', string_b: 'cinematic light' }
    },
    '30:24': {
        class_type: 'SaveImage',
        inputs: { images: ['30:22', 0] }
    }
});

describe('workflow graph source selection', () => {
    it('uses the richer ComfyUI API prompt graph for Krea-style template internals', () => {
        const source = selectWorkflowGraphSource({
            tool: 'ComfyUI',
            workflowJson: compactTemplateWorkflow,
            originalChunks: {
                workflow: compactTemplateWorkflow,
                prompt: richerApiPrompt
            }
        });

        expect(source?.source).toBe('prompt');
        expect(source?.json).toBe(richerApiPrompt);
        expect(source?.nodes).toHaveLength(4);
        expect(source?.nodes.some(node => node.id === '30:19' && node.title === 'Positive Prompt')).toBe(true);
    });

    it('keeps existing workflow graph behavior when no prompt graph is available', () => {
        const source = selectWorkflowGraphSource({
            tool: 'ComfyUI',
            workflowJson: compactTemplateWorkflow,
            originalChunks: { workflow: compactTemplateWorkflow }
        });

        expect(source?.source).toBe('workflow');
        expect(source?.json).toBe(compactTemplateWorkflow);
        expect(source?.nodes).toHaveLength(2);
    });

    it('falls back to workflow when the prompt chunk is not valid graph JSON', () => {
        const source = selectWorkflowGraphSource({
            tool: 'ComfyUI',
            workflowJson: compactTemplateWorkflow,
            originalChunks: {
                workflow: compactTemplateWorkflow,
                prompt: 'not-json'
            }
        });

        expect(source?.source).toBe('workflow');
        expect(source?.json).toBe(compactTemplateWorkflow);
        expect(source?.nodes).toHaveLength(2);
    });

    it('does not replace workflow when the ComfyUI prompt graph is not richer', () => {
        const smallPrompt = JSON.stringify({
            '30:19': {
                class_type: 'StringConcatenate',
                inputs: { string_a: 'glowing forest' }
            }
        });

        const source = selectWorkflowGraphSource({
            tool: 'ComfyUI',
            workflowJson: compactTemplateWorkflow,
            originalChunks: {
                workflow: compactTemplateWorkflow,
                prompt: smallPrompt
            }
        });

        expect(source?.source).toBe('workflow');
        expect(source?.json).toBe(compactTemplateWorkflow);
        expect(source?.nodes).toHaveLength(2);
    });

    it('keeps copy and download JSON pointed at the preserved workflow before prompt fallback', () => {
        expect(selectWorkflowJsonForActions({
            workflowJson: compactTemplateWorkflow,
            originalChunks: {
                workflow: compactTemplateWorkflow,
                prompt: richerApiPrompt
            }
        })).toBe(compactTemplateWorkflow);

        expect(selectWorkflowJsonForActions({
            originalChunks: { prompt: richerApiPrompt }
        })).toBe(richerApiPrompt);
    });

    it('recognizes data-only nodes as graph content', () => {
        const source = selectWorkflowGraphSource({
            tool: 'ComfyUI',
            workflowJson: JSON.stringify({
                only: { data: { prompt: 'hello' } },
            }),
        });

        expect(source?.nodes).toHaveLength(1);
        expect(source?.nodes[0]).toMatchObject({ type: 'Unknown', title: 'Unknown' });
    });

    it('maps backend-normalized nodes without changing their archival source JSON', () => {
        const source = workflowGraphSourceFromBackend({
            source: 'expanded_workflow',
            nodes: [{
                id: '30:19',
                nodeType: 'StringConcatenate',
                title: 'Positive Prompt',
                inputs: { string_a: 'glowing forest' },
                subgraphPath: ['30']
            }]
        }, { workflow: compactTemplateWorkflow });

        expect(source).toEqual({
            json: compactTemplateWorkflow,
            source: 'workflow',
            normalizedByBackend: true,
            nodes: [{
                id: '30:19',
                type: 'StringConcatenate',
                title: 'Positive Prompt',
                inputs: { string_a: 'glowing forest' },
                subgraphPath: ['30']
            }]
        });
    });

    it('rejects empty or source-less backend reports so the caller can fall back', () => {
        expect(workflowGraphSourceFromBackend({
            source: 'expanded_workflow',
            nodes: []
        }, { workflow: compactTemplateWorkflow })).toBeUndefined();

        expect(workflowGraphSourceFromBackend({
            source: 'api_prompt',
            nodes: [{
                id: '1',
                nodeType: 'SaveImage',
                title: 'SaveImage',
                inputs: {},
                subgraphPath: []
            }]
        }, { workflow: compactTemplateWorkflow })).toBeUndefined();

        expect(workflowGraphSourceFromBackend({
            source: 'none',
            nodes: [{
                id: '1',
                nodeType: 'SaveImage',
                title: 'SaveImage',
                inputs: {},
                subgraphPath: []
            }]
        }, { workflow: compactTemplateWorkflow })).toBeUndefined();
    });

    it('groups top-level and nested nodes by their backend-derived subgraph paths', () => {
        const groups = groupWorkflowNodes([
            { id: '29', type: 'SaveImage', title: 'Save', inputs: {}, subgraphPath: [] },
            { id: '30:19', type: 'Prompt', title: 'Prompt', inputs: {}, subgraphPath: ['30'] },
            { id: '30:7:4', type: 'KSampler', title: 'Sampler', inputs: {}, subgraphPath: ['30', '7'] },
            { id: '30:20', type: 'Preview', title: 'Preview', inputs: {}, subgraphPath: ['30'] }
        ]);

        expect(groups.map(group => ({
            key: group.key,
            path: group.path,
            ids: group.nodes.map(node => node.id)
        }))).toEqual([
            { key: '', path: [], ids: ['29'] },
            { key: '30', path: ['30'], ids: ['30:19', '30:20'] },
            { key: '30:7', path: ['30', '7'], ids: ['30:7:4'] }
        ]);
    });
});
