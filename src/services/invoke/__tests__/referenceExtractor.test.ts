import { describe, expect, it } from 'vitest';
import { extractInvokeImageReferences } from '../referenceExtractor';

describe('extractInvokeImageReferences', () => {
    it('extracts all canonical InvokeAI reference roles', () => {
        const result = extractInvokeImageReferences({
            init_image: 'Init.PNG',
            controlnets: [{
                image: { image_name: 'control.png' },
                processed_image: 'control-processed.png',
            }],
            ipAdapters: [{ image: { image_name: 'face.png' } }],
            t2iAdapters: [{
                image: 'sketch.png',
                processed_image: { image_name: 'sketch-processed.png' },
            }],
        });

        expect(result).toEqual({
            status: 'valid',
            references: [
                { role: 'init_image', targetInvokeImageName: 'Init.PNG' },
                { role: 'controlnet_image', targetInvokeImageName: 'control.png' },
                { role: 'controlnet_processed_image', targetInvokeImageName: 'control-processed.png' },
                { role: 'ip_adapter_image', targetInvokeImageName: 'face.png' },
                { role: 't2i_adapter_image', targetInvokeImageName: 'sketch.png' },
                { role: 't2i_adapter_processed_image', targetInvokeImageName: 'sketch-processed.png' },
            ],
        });
    });

    it('supports established aliases, singleton adapters, and processedImage', () => {
        const result = extractInvokeImageReferences({
            control_adapters: {
                image: 'control.png',
                processedImage: { image_name: 'processed.png' },
            },
            ip_adapter: { image: 'ip.png' },
            t2i_adapters: { image: { image_name: 't2i.png' } },
        });

        expect(result.references).toEqual([
            { role: 'controlnet_image', targetInvokeImageName: 'control.png' },
            { role: 'controlnet_processed_image', targetInvokeImageName: 'processed.png' },
            { role: 'ip_adapter_image', targetInvokeImageName: 'ip.png' },
            { role: 't2i_adapter_image', targetInvokeImageName: 't2i.png' },
        ]);
    });

    it('unwraps encoded metadata and image or generation payloads', () => {
        const wrapped = extractInvokeImageReferences({
            invokeai_metadata: JSON.stringify({
                generation: {
                    init_image: { image_name: 'wrapped.png' },
                },
            }),
        });
        const imagePayload = extractInvokeImageReferences({
            image: {
                ip_adapters: [{ image: 'image-payload.png' }],
            },
        });

        expect(wrapped.references).toEqual([
            { role: 'init_image', targetInvokeImageName: 'wrapped.png' },
        ]);
        expect(imagePayload.references).toEqual([
            { role: 'ip_adapter_image', targetInvokeImageName: 'image-payload.png' },
        ]);
    });

    it('deduplicates exact role and name pairs without merging roles or case', () => {
        const result = extractInvokeImageReferences({
            init_image: 'Same.PNG',
            controlnets: [
                { image: 'Same.PNG' },
                { image: { image_name: 'Same.PNG' } },
                { image: 'same.png' },
            ],
        });

        expect(result.references).toEqual([
            { role: 'init_image', targetInvokeImageName: 'Same.PNG' },
            { role: 'controlnet_image', targetInvokeImageName: 'Same.PNG' },
            { role: 'controlnet_image', targetInvokeImageName: 'same.png' },
        ]);
    });

    it('does not infer references from arbitrary image_name fields or model strings', () => {
        const result = extractInvokeImageReferences({
            custom: { image_name: 'custom.png' },
            workflow: { nodes: [{ image: { image_name: 'workflow.png' } }] },
            control_model: { image: { image_name: 'model.png' } },
            controlnets: ['control-model.safetensors'],
            ipAdapters: [{ model_name: 'ip-model', image_name: 'not-an-image-field.png' }],
        });

        expect(result).toEqual({ status: 'valid', references: [] });
    });

    it('preserves exact nonblank names and ignores blank values', () => {
        const result = extractInvokeImageReferences({
            init_image: '  spaced name.png  ',
            controlnets: [{ image: '   ', processed_image: { image_name: '' } }],
        });

        expect(result.references).toEqual([
            { role: 'init_image', targetInvokeImageName: '  spaced name.png  ' },
        ]);
    });

    it('allows empty optional reference values and model-only adapter entries', () => {
        expect(extractInvokeImageReferences({
            init_image: null,
            controlnets: [
                null,
                undefined,
                'control-model.safetensors',
                '   ',
                { model_name: 'record-only-model' },
                { model_name: 'control-model', image: '   ', processed_image: null },
            ],
            ipAdapters: { model_name: 'ip-model', image: { image_name: null } },
            t2iAdapters: [],
        })).toEqual({ status: 'valid', references: [] });
    });

    it.each([
        ['init_image primitive', { init_image: 42 }],
        ['init_image object', { init_image: { image_name: 42 } }],
        ['adapter image', { controlnets: [{ image: false }] }],
        ['adapter processed_image', { controlnets: [{ processed_image: [] }] }],
        ['adapter processedImage', { t2iAdapters: [{ processedImage: {} }] }],
    ])('rejects a malformed present %s reference so it cannot clear stored provenance', (_name, metadata) => {
        expect(extractInvokeImageReferences(metadata)).toEqual({ status: 'invalid', references: [] });
    });

    it.each([
        ['boolean container', { controlnets: false }],
        ['numeric singleton', { ip_adapter: 42 }],
        ['numeric array item', { ip_adapters: [42] }],
        ['boolean array item', { t2i_adapters: [{ model_name: 'valid' }, false] }],
        ['nested array item', { control_adapters: [[{ model_name: 'nested' }]] }],
    ])('rejects an unsupported adapter %s so it cannot clear stored provenance', (_name, metadata) => {
        expect(extractInvokeImageReferences(metadata)).toEqual({ status: 'invalid', references: [] });
    });

    it('distinguishes authoritative empty metadata from malformed metadata', () => {
        expect(extractInvokeImageReferences(null)).toEqual({ status: 'valid', references: [] });
        expect(extractInvokeImageReferences(undefined)).toEqual({ status: 'valid', references: [] });
        expect(extractInvokeImageReferences('{}')).toEqual({ status: 'valid', references: [] });
        expect(extractInvokeImageReferences({ positive_prompt: 'no references' })).toEqual({
            status: 'valid',
            references: [],
        });
        expect(extractInvokeImageReferences('')).toEqual({ status: 'invalid', references: [] });
        expect(extractInvokeImageReferences('   ')).toEqual({ status: 'invalid', references: [] });
        expect(extractInvokeImageReferences('{bad')).toEqual({ status: 'invalid', references: [] });
        expect(extractInvokeImageReferences({ invokeai_metadata: '{bad' })).toEqual({
            status: 'invalid',
            references: [],
        });
    });
});
