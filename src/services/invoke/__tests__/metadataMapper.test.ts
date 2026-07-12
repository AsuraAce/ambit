import { describe, it, expect } from 'vitest';
import { GeneratorTool } from '../../../types';
import { cleanModelName, mapInvokeMetadata, mapRawInvokeMetadata } from '../metadataMapper';

describe('metadataMapper', () => {
    it('cleans supported model extensions and annotations', () => {
        expect(cleanModelName(' model.safetensors (hash) ')).toBe('model');
        expect(cleanModelName('model.ckpt')).toBe('model');
        expect(cleanModelName('model.pth')).toBe('model');
        expect(cleanModelName('model.bin')).toBe('model');
        expect(cleanModelName('model.pt')).toBe('model');
        expect(cleanModelName('')).toBe('');
        expect(cleanModelName(null as unknown as string)).toBe('');
    });

    it('returns complete Invoke defaults for absent and invalid row metadata', () => {
        expect(mapInvokeMetadata(null, 'metadata_json', 2)).toMatchObject({
            tool: GeneratorTool.INVOKEAI,
            model: 'Unknown',
            hasWorkflowHint: false,
            isIntermediate: false,
            loras: [], controlNets: [], ipAdapters: [], embeddings: [], hypernetworks: []
        });
        expect(mapInvokeMetadata({ metadata_json: '{bad', has_workflow: 1, is_intermediate: true }, 'metadata_json', 0)).toMatchObject({
            hasWorkflowHint: true,
            isIntermediate: true
        });
    });

    it('maps object metadata and lets explicit row workflow hints override mapped hints', () => {
        const result = mapInvokeMetadata({
            metadata: { workflow: { id: 1 }, positive_prompt: 'prompt' },
            has_workflow: 0
        }, 'metadata', 0);
        expect(result.positivePrompt).toBe('prompt');
        expect(result.hasWorkflowHint).toBe(false);
        expect(result.workflowJson).toBe('{"id":1}');
    });

    it('maps null metadata to standard defaults', () => {
        expect(mapRawInvokeMetadata(null)).toEqual(expect.objectContaining({
            tool: GeneratorTool.INVOKEAI,
            model: 'Unknown',
            steps: 0,
            cfg: 0,
            sampler: 'Unknown',
            hasWorkflowHint: false,
            isIntermediate: false
        }));
    });

    it('unwraps every legacy metadata wrapper including double-encoded and malformed payloads', () => {
        expect(mapRawInvokeMetadata({ invokeai_metadata: JSON.stringify({ positive_prompt: 'invoke' }) }).positivePrompt).toBe('invoke');
        expect(mapRawInvokeMetadata({ 'sd-metadata': { positive_prompt: 'sd' } }).positivePrompt).toBe('sd');
        expect(mapRawInvokeMetadata({ dream_metadata: { positive_prompt: 'dream' } }).positivePrompt).toBe('dream');
        expect(mapRawInvokeMetadata({ invokeai_metadata: '{bad', positive_prompt: 'fallback' }).positivePrompt).toBe('fallback');
    });

    it('reads nested image and generation roots with scalar coercion and alternate field names', () => {
        const imageResult = mapRawInvokeMetadata({
            image: {
                positivePrompt: 42,
                negativePrompt: false,
                steps: '12',
                cfg: '6.5',
                seed: '0',
                sampler_name: true,
                clipSkip: '2',
                denoisingStrength: '0.35',
                hiresUpscaler: 'latent',
                generationType: 'img2img',
                isFavorite: true,
                model: 'nested.ckpt'
            },
            model_hash: 123
        });
        expect(imageResult).toMatchObject({
            positivePrompt: '42', negativePrompt: 'false', steps: 12, cfg: 6.5, seed: 0,
            sampler: 'true', clipSkip: 2, denoisingStrength: 0.35,
            hiresUpscaler: 'latent', generationType: 'img2img', isFavorite: true,
            model: 'nested', modelHash: '123'
        });

        const generationResult = mapRawInvokeMetadata({ generation: { subject: 'favorite', scheduler: 'ddim' } });
        expect(generationResult).toMatchObject({ isFavorite: true, sampler: 'ddim' });
    });

    it('discovers workflows and hashes across legacy storage locations', () => {
        expect(mapRawInvokeMetadata({ workflow: 'root-workflow' }).workflowJson).toBe('root-workflow');
        expect(mapRawInvokeMetadata({ graph: { nodes: [] } }).workflowJson).toBe('{"nodes":[]}');
        expect(mapRawInvokeMetadata({ image: { workflow: 'image-workflow' } }).workflowJson).toBe('image-workflow');
        expect(mapRawInvokeMetadata({ image: { graph: 'image-graph' } }).workflowJson).toBe('image-graph');
        expect(mapRawInvokeMetadata({ has_workflow_data: true }).hasWorkflowHint).toBe(true);
        expect(mapRawInvokeMetadata({ has_workflow: true }).hasWorkflowHint).toBe(true);
        expect(mapRawInvokeMetadata({ is_intermediate: 1 }).isIntermediate).toBe(true);
        expect(mapRawInvokeMetadata({ image: { model: { hash: 'blake3:abc' } } }).modelHash).toBe('abc');
        expect(mapRawInvokeMetadata({ image: { model: { hash: ':' } } }).modelHash).toBe(':');
    });

    it('maps legacy prompt arrays and string prompts', () => {
        expect(mapRawInvokeMetadata({ prompt: [{ prompt: 'first' }, { prompt: 2 }, {}] }).positivePrompt).toBe('first 2 ');
        expect(mapRawInvokeMetadata({ prompt: '  legacy prompt  ' }).positivePrompt).toBe('legacy prompt');
        expect(mapRawInvokeMetadata({ prompt: 5 }).positivePrompt).toBe('');
    });

    it('extracts all resource aliases, object shapes, weights, and nested arrays', () => {
        const result = mapRawInvokeMetadata({
            loras: [null, 'plain', 'plain', { model: { default: 'default-lora' }, weight: '0.5' }, { name: 'named' }],
            control_adapters: [null, 'control.ckpt', { control_model: { model_name: 'nested-control.safetensors' } }, { name: 'direct-control.pt' }],
            control_model: { model_name: 'single-control.bin' },
            ip_adapters: [null, 'adapter.pth', { ip_adapter_model: { name: 'nested-adapter.bin' } }, { name: 'direct-adapter.pt' }],
            ip_adapter: { model_name: 'single-adapter.ckpt' },
            embeddings: [null, 'embedding.pt', 'embedding.pt', { model: { name: 'model-embedding.bin' } }],
            textual_inversion: { lora_name: 'single-embedding.safetensors' },
            hypernetworks: [null, 'hyper.pt', 'hyper.pt', { name: 'object-hyper.ckpt' }],
            hypernet: { model_name: 'single-hyper.bin' },
            nested: [{ hypernets: 'nested-hyper.pth' }]
        });
        expect(result.loras).toEqual(expect.arrayContaining(['plain', 'default-lora (0.50)', 'named']));
        expect(result.controlNets).toEqual(expect.arrayContaining(['control', 'nested-control', 'direct-control', 'single-control']));
        expect(result.ipAdapters).toEqual(expect.arrayContaining(['adapter', 'nested-adapter', 'direct-adapter', 'single-adapter']));
        expect(result.embeddings).toEqual(expect.arrayContaining(['embedding', 'model-embedding', 'single-embedding']));
        expect(result.hypernetworks).toEqual(expect.arrayContaining(['hyper', 'object-hyper', 'single-hyper', 'nested-hyper']));
    });

    it('deduplicates prompt resources and handles default, weighted, and malformed syntax', () => {
        const result = mapRawInvokeMetadata({
            embeddings: ['easy'],
            positive_prompt: 'embedding:easy <embedding:easy> <xy> <xy> <lora> <hypernet> <lora:lora> <lora:lora:1.0> <lora:weighted:0.25> <hypernet:hyper> <hypernet:hyper:1.0> <hypernet:hyper> <hypernet:weighted:0.25>',
            negative_prompt: '<lora:lora> <hypernet:hyper>'
        });
        expect(result.embeddings).toEqual(['easy', 'xy']);
        expect(result.loras).toEqual(['lora', 'weighted (0.25)']);
        expect(result.hypernetworks).toEqual(['hyper', 'weighted (0.25)']);
    });

    it('ignores unnamed resources and supports string-valued nested adapter models', () => {
        const result = mapRawInvokeMetadata({
            loras: [{}, { lora: {} }],
            controlnets: [{}, { control_model: {} }],
            ip_adapters: [{}, { ip_adapter_model: {} }, { ip_adapter_model: 'string-adapter.safetensors' }],
            embeddings: [{}],
            hypernetworks: [{}]
        });
        expect(result).toMatchObject({
            loras: [],
            controlNets: [],
            ipAdapters: ['string-adapter'],
            embeddings: [],
            hypernetworks: []
        });
    });

    it('uses wrapper model hashes when the unwrapped root has none', () => {
        expect(mapRawInvokeMetadata({
            invokeai_metadata: { positive_prompt: 'prompt' },
            model_hash: 'wrapper-hash'
        }).modelHash).toBe('wrapper-hash');
    });

    it('ignores inherited enumerable properties during recursive resource scans', () => {
        const inherited = { nested: { embeddings: ['inherited'] } };
        const metadata = Object.create(inherited) as Record<string, unknown>;
        metadata.positive_prompt = 'prompt';
        expect(mapRawInvokeMetadata(metadata).embeddings).toEqual([]);
    });

    it('stops recursive resource scans at the depth limit', () => {
        const root: Record<string, unknown> = {};
        let current = root;
        for (let depth = 0; depth < 23; depth++) {
            const next: Record<string, unknown> = {};
            current.next = next;
            current = next;
        }
        current.embeddings = ['too-deep'];
        expect(mapRawInvokeMetadata(root).embeddings).toEqual([]);
    });
    it('should extract basic generation parameters', () => {
        const row = {
            metadata_json: JSON.stringify({
                positive_prompt: 'a beautiful sunset',
                negative_prompt: 'low quality',
                steps: 30,
                cfg_scale: 7.5,
                seed: 12345,
                scheduler: 'euler_a',
                model: { model_name: 'sd-1.5' }
            }),
            has_workflow: 0,
            is_intermediate: 0
        };

        const result = mapInvokeMetadata(row, 'metadata_json', 0);
        expect(result.positivePrompt).toBe('a beautiful sunset');
        expect(result.negativePrompt).toBe('low quality');
        expect(result.steps).toBe(30);
        expect(result.cfg).toBe(7.5);
        expect(result.seed).toBe(12345);
        expect(result.sampler).toBe('euler_a');
        expect(result.model).toBe('sd-1.5');
    });

    it('should preserve zero and leave a missing seed unknown', () => {
        const zero = mapInvokeMetadata({
            metadata_json: JSON.stringify({ seed: 0 })
        }, 'metadata_json', 0);
        const unknown = mapInvokeMetadata({
            metadata_json: JSON.stringify({})
        }, 'metadata_json', 0);

        expect(zero.seed).toBe(0);
        expect(unknown.seed).toBeUndefined();
    });

    it('should recursively extract ControlNets (v3/v5 format)', () => {
        const row = {
            metadata_json: JSON.stringify({
                controlnets: [
                    { control_model: 'control_v11p_sd15_canny.safetensors' }
                ],
                nodes: {
                    'node-1': {
                        control_model: { name: 'control_v11f1p_sd15_depth.ckpt' }
                    }
                }
            })
        };

        const result = mapInvokeMetadata(row, 'metadata_json', 0);
        expect(result.controlNets).toContain('control_v11p_sd15_canny');
        expect(result.controlNets).toContain('control_v11f1p_sd15_depth');
    });

    it('should recursively extract IP-Adapters (v4+ format)', () => {
        const row = {
            metadata_json: JSON.stringify({
                ip_adapter_model: 'ip_adapter_sd15_plus.pth',
                workflow: {
                    nodes: {
                        'ip-node': {
                            ip_adapter_model: { name: 'ip_adapter_sd15_faceid.bin' }
                        }
                    }
                }
            })
        };

        const result = mapInvokeMetadata(row, 'metadata_json', 0);
        expect(result.ipAdapters).toContain('ip_adapter_sd15_plus');
        expect(result.ipAdapters).toContain('ip_adapter_sd15_faceid');
    });

    it('should extract LoRAs with weights', () => {
        const row = {
            metadata_json: JSON.stringify({
                loras: [
                    { lora: { name: 'style1' }, weight: 0.8 },
                    { model_name: 'detailer', weight: 1.0 }
                ]
            })
        };

        const result = mapInvokeMetadata(row, 'metadata_json', 0);
        expect(result.loras).toContain('style1 (0.80)');
        expect(result.loras).toContain('detailer');
    });

    it('should extract embeddings (textual inversions) from various field names and formats', () => {
        const row = {
            metadata_json: JSON.stringify({
                embeddings: [
                    { name: 'easynegative.safetensors' },
                    { model_name: 'bad-artist-v2' }
                ],
                ti: { name: 'deep_negative' },
                nodes: {
                    'ti-node': {
                        textual_inversion: 'another_emb.ckpt'
                    }
                }
            })
        };

        const result = mapInvokeMetadata(row, 'metadata_json', 0);
        expect(result.embeddings).toContain('easynegative');
        expect(result.embeddings).toContain('bad-artist-v2');
        expect(result.embeddings).toContain('deep_negative');
        expect(result.embeddings).toContain('another_emb');
        expect(result.embeddings.length).toBe(4);
    });

    it('should extract embeddings from prompt text and avoid false positives', () => {
        const row = {
            metadata_json: JSON.stringify({
                positive_prompt: 'a cat, <style1>, <<<<full body shot',
                negative_prompt: '<easynegative>, bad, <lora:some_lora:0.8>, <hypernet:A1 Extra-600000:0.15>'
            })
        };

        const result = mapInvokeMetadata(row, 'metadata_json', 0);
        expect(result.embeddings).toContain('style1');
        expect(result.embeddings).toContain('easynegative');
        expect(result.embeddings).not.toContain('full');
        expect(result.embeddings).not.toContain('lora');
        expect(result.embeddings).not.toContain('hypernet');
        expect(result.embeddings.length).toBe(2);
    });

    it('should extract loras and hypernetworks from prompt text', () => {
        const row = {
            metadata_json: JSON.stringify({
                positive_prompt: 'a cat, <lora:style_v1:0.8>, <lora:detailer:1.0>, <hypernet:my-hn:0.5>',
                negative_prompt: '<hypernet:A1 Extra:0.15>'
            })
        };

        const result = mapInvokeMetadata(row, 'metadata_json', 0);
        expect(result.loras).toContain('style_v1 (0.80)');
        expect(result.loras).toContain('detailer');
        expect(result.hypernetworks).toContain('my-hn (0.50)');
        expect(result.hypernetworks).toContain('A1 Extra (0.15)');
    });
});
