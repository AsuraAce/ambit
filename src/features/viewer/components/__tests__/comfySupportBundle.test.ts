import { describe, expect, it } from 'vitest';
import type { ComfyParserDiagnosticsReport } from '../../../../bindings';
import {
    buildComfySupportBundle,
    buildDiagnosticsClipboardPayload
} from '../comfySupportBundle';

const diagnostics: ComfyParserDiagnosticsReport = {
    appVersion: '0.10.0',
    parserVersion: 46,
    chunkKeys: ['prompt', 'workflow'],
    hasPromptChunk: true,
    hasWorkflowChunk: true,
    graphNodeCount: 3,
    selectedOutputCandidateCount: 1,
    uniqueOutputRootSamplerCount: 1,
    outputAmbiguous: false,
    traversalIssues: [],
    traversalIssuesTruncated: false,
    attemptedLayers: ['workflow_chunk', 'sampler_traversal'],
    fieldSources: { model: 'sampler_traversal' },
    fieldSourceNodeIds: { model: ['3'] },
    resourceSources: [{
        field: 'loras',
        value: 'detail_style',
        layer: 'sampler_traversal',
        nodeIds: ['7']
    }],
    metadata: {
        tool: 'ComfyUI',
        model: 'model',
        seed: 1,
        steps: 4,
        cfg: 1,
        sampler: 'euler (simple)',
        positivePrompt: 'prompt',
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

const image = {
    filename: 'private-name.WEBP',
    width: 1024,
    height: 768
};

const chunks = {
    workflow: '{"local_filename":"D:/models/private.safetensors"}',
    parameters: 'private prompt',
    prompt: '{"1":{"class_type":"SaveImage"}}'
};

describe('ComfyUI support bundle', () => {
    it('builds a deterministic full bundle with exact sorted chunks', () => {
        const bundle = buildComfySupportBundle(
            image,
            chunks,
            diagnostics,
            '2026-08-08T12:00:00.000Z'
        );

        expect(bundle).toEqual({
            schemaVersion: 1,
            createdAt: '2026-08-08T12:00:00.000Z',
            appVersion: '0.10.0',
            parserVersion: 46,
            image: { format: 'webp', width: 1024, height: 768 },
            diagnostics,
            chunkLengths: {
                parameters: chunks.parameters.length,
                prompt: chunks.prompt.length,
                workflow: chunks.workflow.length
            },
            chunks: {
                parameters: chunks.parameters,
                prompt: chunks.prompt,
                workflow: chunks.workflow
            }
        });
        expect(Object.keys(bundle.chunks)).toEqual(['parameters', 'prompt', 'workflow']);
    });

    it('keeps the compact clipboard payload free of raw chunks and image identity', () => {
        const payload = buildDiagnosticsClipboardPayload(image, chunks, diagnostics);
        const serialized = JSON.stringify(payload);

        expect(payload.image).toEqual({ format: 'webp', width: 1024, height: 768 });
        expect(payload.chunkKeys).toEqual(['parameters', 'prompt', 'workflow']);
        expect(payload.chunkLengths).toEqual({
            parameters: chunks.parameters.length,
            prompt: chunks.prompt.length,
            workflow: chunks.workflow.length
        });
        expect(payload.fieldSourceNodeIds).toEqual({ model: ['3'] });
        expect(payload.resourceSources).toEqual(diagnostics.resourceSources);
        expect(payload).not.toHaveProperty('chunks');
        expect(payload).not.toHaveProperty('imageId');
        expect(serialized).not.toContain('private-name');
        expect(serialized).not.toContain('D:/models/private.safetensors');
        expect(serialized).not.toContain('private prompt');
    });
});
