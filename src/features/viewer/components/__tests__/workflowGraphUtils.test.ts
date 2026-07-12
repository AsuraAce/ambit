import { describe, expect, it } from 'vitest';
import {
    selectWorkflowGraphSource,
    selectWorkflowJsonForActions
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
});
