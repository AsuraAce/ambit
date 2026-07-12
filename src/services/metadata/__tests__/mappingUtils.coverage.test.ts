
import { describe, it, expect } from 'vitest';
import { mapRawChunksToMetadata, parseA1111Parameters } from '../mappingUtils';
import { GeneratorTool } from '../../../types';

describe('mappingUtils - mapRawChunksToMetadata', () => {

    describe('AUTOMATIC1111 / SDV1 style', () => {
        const a1111Raw = "A beautiful cat\nNegative prompt: ugly\nSteps: 20, Sampler: Euler a, CFG scale: 7, Seed: 12345, Model: v1-5";

        it('should handle raw string input', () => {
            const result = mapRawChunksToMetadata(a1111Raw, GeneratorTool.AUTOMATIC1111);
            expect(result.tool).toBe(GeneratorTool.AUTOMATIC1111);
            expect(result.positivePrompt).toBe("A beautiful cat");
            expect(result.steps).toBe(20);
            expect(result.seed).toBe(12345);
        });

        it('should handle JSON-encoded string input', () => {
            const jsonEncoded = JSON.stringify(a1111Raw);
            const result = mapRawChunksToMetadata(jsonEncoded, GeneratorTool.AUTOMATIC1111);
            expect(result.tool).toBe(GeneratorTool.AUTOMATIC1111);
            expect(result.positivePrompt).toBe("A beautiful cat");
        });

        it('should handle object with parameters key', () => {
            const chunks = { parameters: a1111Raw };
            const result = mapRawChunksToMetadata(chunks, GeneratorTool.AUTOMATIC1111);
            expect(result.positivePrompt).toBe("A beautiful cat");
            expect(result.steps).toBe(20);
        });

        it('should accept legacy uppercase parameter keys so saved PNG chunks remain reversible', () => {
            const result = mapRawChunksToMetadata(
                { PARAMETERS: a1111Raw },
                GeneratorTool.UNKNOWN
            );

            expect(result.tool).toBe(GeneratorTool.AUTOMATIC1111);
            expect(result.model).toBe('v1-5');
        });

        it('should handle direct prompt/seed object (SDNext fallback)', () => {
            const chunks = {
                prompt: "Digital art of a sunset",
                negative_prompt: "low quality",
                seed: 999,
                steps: 30,
                cfg_scale: 8.5
            };
            const result = mapRawChunksToMetadata(chunks, GeneratorTool.SDNEXT);
            expect(result.positivePrompt).toBe("Digital art of a sunset");
            expect(result.seed).toBe(999);
            expect(result.cfg).toBe(8.5);
        });

        it('should preserve prompt resources and hires settings for facet rebuilds', () => {
            const result = parseA1111Parameters([
                'portrait <lora:FilmLook:0.75> <hypernet:LineArt:0.8> embedding:easynegative <detailer>',
                'Negative prompt: blurry',
                'still malformed negative line',
                'Steps: 30, Sampler: DPM++ 2M, CFG scale: 6.5, Seed: 42, Checkpoint: dream.ckpt, VAE: vae-ft, Clip skip: 2, Denoising strength: 0.45, Hires upscale: 1.5, Hires steps: 12, Hires upscaler: Latent, Model hash: abc123, TI hashes: "badhand": deadbeef, Lora hashes: "ExtraLora": beef, ControlNet 0: Model: control-depth, App: SD.Next'
            ].join('\n'));

            expect(result.positivePrompt).toContain('portrait');
            expect(result.negativePrompt).toBe('blurry still malformed negative line');
            expect(result.tool).toBe(GeneratorTool.SDNEXT);
            expect(result.loras).toEqual(['FilmLook', 'FilmLook (0.75)', 'ExtraLora']);
            expect(result.hypernetworks).toEqual(['LineArt (0.80)']);
            expect(result.embeddings).toEqual(['easynegative', 'detailer', 'badhand']);
            expect(result.controlNets).toEqual(['control-depth']);
            expect(result.vae).toBe('vae-ft');
            expect(result.clipSkip).toBe(2);
            expect(result.denoisingStrength).toBe(0.45);
            expect(result.hiresUpscale).toBe(1.5);
            expect(result.hiresSteps).toBe(12);
            expect(result.hiresUpscaler).toBe('Latent');
            expect(result.modelHash).toBe('abc123');
        });

        it('should infer Forge, Anapnoe, and Comfy variants from version metadata only when the default is generic', () => {
            expect(parseA1111Parameters('cat\nSteps: 1, Version: forge-classic').tool).toBe(GeneratorTool.FORGE);
            expect(parseA1111Parameters('cat\nSteps: 1, Version: anapnoe-ui').tool).toBe(GeneratorTool.ANAPNOE);
            expect(parseA1111Parameters('cat\nSteps: 1, Version: Comfy bridge').tool).toBe(GeneratorTool.COMFYUI);
            expect(parseA1111Parameters('cat\nSteps: 1, Version: forge-classic', GeneratorTool.SDNEXT).tool).toBe(GeneratorTool.SDNEXT);
        });

        it('should infer Forge and Anapnoe from the App field', () => {
            expect(parseA1111Parameters('cat\nSteps: 1, App: Forge').tool).toBe(GeneratorTool.FORGE);
            expect(parseA1111Parameters('cat\nSteps: 1, App: Anapnoe').tool).toBe(GeneratorTool.ANAPNOE);
        });
    });

    describe('InvokeAI', () => {
        it('should handle InvokeAI tool type via string', () => {
            const result = mapRawChunksToMetadata('{}', GeneratorTool.INVOKEAI);
            expect(result.tool).toBe(GeneratorTool.INVOKEAI);
        });

        it('should delegate empty and detected Invoke chunks to the Invoke mapper', () => {
            const empty = mapRawChunksToMetadata({}, GeneratorTool.INVOKEAI);
            const detected = mapRawChunksToMetadata(
                {
                    image: {
                        prompt: 'a moonlit city'
                    }
                },
                GeneratorTool.UNKNOWN
            );

            expect(empty.tool).toBe(GeneratorTool.INVOKEAI);
            expect(detected.tool).toBe(GeneratorTool.INVOKEAI);
            expect(detected.positivePrompt).toBe('a moonlit city');
        });
    });

    describe('Tool Mismatch / Detection', () => {
        it('preserves encoded and flat Comfy workflows without inferring graph fields', () => {
            const encoded = JSON.stringify('{"nodes":[]}');
            expect(mapRawChunksToMetadata(encoded, GeneratorTool.COMFYUI)).toEqual({
                tool: GeneratorTool.COMFYUI,
                workflowJson: '{"nodes":[]}',
                hasWorkflowHint: true,
            });
            expect(mapRawChunksToMetadata('"unterminated', GeneratorTool.COMFYUI)).toMatchObject({
                tool: GeneratorTool.COMFYUI,
                workflowJson: '"unterminated',
            });
            expect(mapRawChunksToMetadata({}, GeneratorTool.COMFYUI)).toEqual({ tool: GeneratorTool.COMFYUI });
            expect(mapRawChunksToMetadata({ workflow: '{}' }, GeneratorTool.UNKNOWN)).toMatchObject({
                tool: GeneratorTool.COMFYUI,
                workflowJson: '{}',
            });
            expect(mapRawChunksToMetadata({ workflow: { nodes: [] } }, GeneratorTool.UNKNOWN)).toMatchObject({
                tool: GeneratorTool.COMFYUI,
                workflowJson: '{"nodes":[]}',
            });
            expect(mapRawChunksToMetadata({ nodes: [] }, GeneratorTool.UNKNOWN)).toMatchObject({
                tool: GeneratorTool.COMFYUI,
                hasWorkflowHint: true,
            });
            expect(mapRawChunksToMetadata({ '1': { class_type: 'KSampler' } }, GeneratorTool.UNKNOWN)).toMatchObject({
                tool: GeneratorTool.COMFYUI,
                hasWorkflowHint: true,
            });
            expect(mapRawChunksToMetadata('plain prompt', undefined as unknown as GeneratorTool)).toMatchObject({
                tool: GeneratorTool.AUTOMATIC1111,
                positivePrompt: 'plain prompt',
            });
            expect(mapRawChunksToMetadata({ unknown: true }, undefined as unknown as GeneratorTool)).toEqual({});
            expect(parseA1111Parameters('plain prompt').rawParameters).toBe('plain prompt');
        });

        it('should detect A1111 from chunks even if GeneratorTool.UNKNOWN is passed', () => {
            const chunks = { parameters: "Prompt here\nSteps: 20" };
            const result = mapRawChunksToMetadata(chunks, GeneratorTool.UNKNOWN);
            expect(result.tool).toBe(GeneratorTool.AUTOMATIC1111);
            expect(result.steps).toBe(20);
        });

        it('should detect ComfyUI from raw JSON prompt even if GeneratorTool.INVOKEAI is passed', () => {
            const comfyWorkflow = JSON.stringify({
                nodes: [
                    { id: 1, type: "KSampler", widgets_values: [123456, "random", 20, 7.5, "euler", "normal", 1.0] }
                ]
            });
            const result = mapRawChunksToMetadata(comfyWorkflow, GeneratorTool.INVOKEAI);
            expect(result.tool).toBe(GeneratorTool.COMFYUI);
            expect(result.workflowJson).toBe(comfyWorkflow);
            expect(result.seed).toBeUndefined();
        });

        it('should detect A1111 from raw string even if GeneratorTool.UNKNOWN is passed', () => {
            const raw = "A beautiful cat\nSteps: 20";
            const result = mapRawChunksToMetadata(raw, GeneratorTool.UNKNOWN);
            expect(result.tool).toBe(GeneratorTool.AUTOMATIC1111);
            expect(result.steps).toBe(20);
        });

        it('returns empty metadata for null, arrays, and unknown object shapes', () => {
            expect(mapRawChunksToMetadata(null, GeneratorTool.UNKNOWN)).toEqual({});
            expect(mapRawChunksToMetadata([], GeneratorTool.UNKNOWN)).toEqual({});
            expect(mapRawChunksToMetadata({ unrelated: true }, GeneratorTool.UNKNOWN)).toEqual({});
        });

        it('handles raw Invoke text and explicit non-string A1111 parameter fields', () => {
            expect(mapRawChunksToMetadata('legacy invoke prompt', GeneratorTool.INVOKEAI).tool).toBe(GeneratorTool.INVOKEAI);
            expect(mapRawChunksToMetadata({ parameters: 42 }, GeneratorTool.UNKNOWN)).toEqual({});
        });

        it('covers direct SDNext defaults and Comfy objects without workflows', () => {
            expect(mapRawChunksToMetadata({ prompt: 'cat', negative_prompt: 4, cfg: 7 }, GeneratorTool.SDNEXT)).toMatchObject({
                negativePrompt: '',
                cfg: 7,
            });
            expect(mapRawChunksToMetadata({ unrelated: true }, GeneratorTool.COMFYUI)).toEqual({ tool: GeneratorTool.COMFYUI });
        });
    });

    describe('A1111 parser robustness', () => {
        it('covers neutral weights, resource exclusions, duplicate hashes, and alternate tool markers', () => {
            const result = parseA1111Parameters([
                '<lora:Neutral:1> <hypernet:Plain:1> <lora> <hypernet> <x> embedding:a embedding:a',
                'Steps: 1, Version: vlad diffusion, TI hashes: a: one, a: two, Lora hashes: Neutral: one, Neutral: two, ControlNet 0: disabled, App: unknown'
            ].join('\n'));

            expect(result.tool).toBe(GeneratorTool.SDNEXT);
            expect(result.loras).toEqual(['Neutral']);
            expect(result.hypernetworks).toEqual(['Plain']);
            expect(result.embeddings).toEqual(['a']);
            expect(result.controlNets).toBeUndefined();
        });

        it('accepts all model aliases and ignores parameter fragments without values', () => {
            const result = parseA1111Parameters('cat\nSteps: 2, Model name: named, SD model: final, malformed');
            expect(result.model).toBe('final');
            expect(result.steps).toBe(2);
        });

        it('initializes hash-only resource arrays and ignores empty hash entries', () => {
            const result = parseA1111Parameters('cat\nSteps: 1, TI hashes: : none, Lora hashes: Solo: hash, ControlNet 0: Model: control, ControlNet 1: Model: control');
            expect(result.embeddings).toEqual([]);
            expect(result.loras).toEqual(['Solo']);
            expect(result.controlNets).toEqual(['control']);
        });

        it('recognizes SD.Next and Comfy version aliases', () => {
            expect(parseA1111Parameters('cat\nSteps: 1, Version: sd.next').tool).toBe(GeneratorTool.SDNEXT);
            expect(parseA1111Parameters('cat\nSteps: 1, Version: comfy').tool).toBe(GeneratorTool.COMFYUI);
            expect(parseA1111Parameters('cat\nSteps: 1, Version: webui').tool).toBe(GeneratorTool.AUTOMATIC1111);
        });

        it('ignores text after parameters and malformed resource names and weights', () => {
            const result = parseA1111Parameters([
                '<lora:NoWeight> <lora: :1> <lora:Dot:.> <hypernet:NoWeight> <hypernet: :1>',
                'Steps: 1',
                'ignored after parameters',
            ].join('\n'));
            expect(result.loras).toEqual(['NoWeight', 'Dot']);
            expect(result.hypernetworks).toEqual(['NoWeight']);
        });
    });

});
