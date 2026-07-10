
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

    describe('ComfyUI', () => {
        const comfyWorkflow = JSON.stringify({
            nodes: [
                { id: 1, type: "KSampler", widgets_values: [123456, "random", 20, 7.5, "euler", "normal", 1.0] }
            ]
        });

        it('should handle raw JSON string', () => {
            const result = mapRawChunksToMetadata(comfyWorkflow, GeneratorTool.COMFYUI);
            expect(result.tool).toBe(GeneratorTool.COMFYUI);
            expect(result.seed).toBe(123456);
            expect(result.steps).toBe(20);
            expect(result.workflowJson).toBe(comfyWorkflow);
        });

        it('should handle object with prompt/workflow keys', () => {
            const chunks = { prompt: comfyWorkflow };
            const result = mapRawChunksToMetadata(chunks, GeneratorTool.COMFYUI);
            expect(result.seed).toBe(123456);
            expect(result.workflowJson).toBe(comfyWorkflow);
        });

        it('should return a Comfy marker for empty or unreadable workflow chunks', () => {
            expect(mapRawChunksToMetadata({}, GeneratorTool.COMFYUI)).toEqual({
                tool: GeneratorTool.COMFYUI
            });
            expect(mapRawChunksToMetadata({ workflow: '{not json' }, GeneratorTool.COMFYUI)).toEqual({
                tool: GeneratorTool.COMFYUI
            });
            expect(mapRawChunksToMetadata('{not json', GeneratorTool.COMFYUI)).toEqual({
                tool: GeneratorTool.COMFYUI,
                workflowJson: '{not json'
            });
        });

        it('should detect flat numeric node maps from legacy prompt chunks', () => {
            const chunks = {
                '9': {
                    id: 9,
                    class_type: 'CheckpointLoaderSimple',
                    inputs: { ckpt_name: 'C:/models/flat-model.safetensors' }
                },
                '10': {
                    id: 10,
                    class_type: 'KSampler',
                    inputs: { lora_name_1: 'flat-lora.safetensors', lora_name_2: 'None' },
                    widgets_values: [555, 'fixed', 22, 8, 'euler', 'karras']
                }
            };

            const result = mapRawChunksToMetadata(chunks, GeneratorTool.UNKNOWN);

            expect(result.tool).toBe(GeneratorTool.COMFYUI);
            expect(result.seed).toBe(555);
            expect(result.steps).toBe(22);
            expect(result.cfg).toBe(8);
            expect(result.sampler).toBe('euler (karras)');
            expect(result.model).toBe('flat-model');
            expect(result.loras).toEqual(['flat-lora.safetensors']);
        });

        it('should format sampler and scheduler with parentheses', () => {
            const workflow = JSON.stringify({
                nodes: [
                    { id: 1, type: "KSampler", widgets_values: [123, "rand", 20, 7.5, "euler", "karras", 1.0] }
                ]
            });
            const result = mapRawChunksToMetadata(workflow, GeneratorTool.COMFYUI);
            expect(result.sampler).toBe("euler (karras)");
        });

        it('should handle KSamplerAdvanced with correct indexes', () => {
            // Standard KSamplerAdvanced: add_noise(0), seed(1), control(2), steps(3), start(4), end(5), cfg(6), sampler(7), scheduler(8)
            const workflow = JSON.stringify({
                nodes: [
                    { id: 1, type: "KSamplerAdvanced", widgets_values: [true, 123456, "fixed", 40, 0, 40, 8.5, "dpmpp_2m", "karras", 1.0] }
                ]
            });
            const result = mapRawChunksToMetadata(workflow, GeneratorTool.COMFYUI);
            expect(result.seed).toBe(123456);
            expect(result.steps).toBe(40);
            expect(result.cfg).toBe(8.5);
            expect(result.sampler).toBe("dpmpp_2m (karras)");
        });

        it('should support compact legacy KSamplerAdvanced widget arrays', () => {
            const workflow = {
                nodes: [
                    { id: 1, type: "KSamplerAdvanced", widgets_values: [true, 2468, "fixed", 18, 5.5, "uni_pc", "exponential"] },
                    { id: 2, type: "UNETLoader", widgets_values: ["ignored", "C:/models/unet.sft"] }
                ]
            };

            const result = mapRawChunksToMetadata({ workflow }, GeneratorTool.COMFYUI);

            expect(result.seed).toBe(2468);
            expect(result.steps).toBe(18);
            expect(result.cfg).toBe(5.5);
            expect(result.sampler).toBe("uni_pc (exponential)");
            expect(result.model).toBe('unet');
        });

        it('should handle Efficiency Nodes (SDParameterGenerator)', () => {
            // SDParameterGenerator: model(0), clip(1), vae(2), ..., seed(4), steps(5), step_ref(6), cfg(7), sampler(8), scheduler(9)
            const workflow = JSON.stringify({
                nodes: [
                    { id: 1, type: "SDParameterGenerator", widgets_values: ["v1-5.safetensors", "skip", "vae", "empty", 98765, 25, 1, 7.0, "euler_a", "normal", 1] }
                ]
            });
            const result = mapRawChunksToMetadata(workflow, GeneratorTool.COMFYUI);
            expect(result.seed).toBe(98765);
            expect(result.steps).toBe(25);
            expect(result.cfg).toBe(7.0);
            expect(result.sampler).toBe("euler_a"); // normal is omitted
        });

        it('should handle SDPromptSaver and KSamplerPipe node offsets', () => {
            const promptSaver = mapRawChunksToMetadata({
                prompt: {
                    nodes: [
                        { id: 1, type: "SDPromptSaver", widgets_values: ["model", "clip", "vae", 1122, "skip", 17, 6.25, "ddim", "sgm_uniform"] },
                        { id: 2, type: "DiffusersLoader", inputs: { model_name: "diffusers.bin" } }
                    ]
                }
            }, GeneratorTool.UNKNOWN);
            const pipe = mapRawChunksToMetadata({
                prompt: {
                    nodes: [
                        { id: 1, type: "KSamplerPipe", widgets_values: ["pipe", 3344, "fixed", 24, 7.75, "dpm_fast", "normal"] }
                    ]
                }
            }, GeneratorTool.UNKNOWN);

            expect(promptSaver.seed).toBe(1122);
            expect(promptSaver.steps).toBe(17);
            expect(promptSaver.cfg).toBe(6.25);
            expect(promptSaver.sampler).toBe("ddim (sgm_uniform)");
            expect(promptSaver.model).toBe('diffusers');
            expect(pipe.seed).toBe(3344);
            expect(pipe.steps).toBe(24);
            expect(pipe.cfg).toBe(7.75);
            expect(pipe.sampler).toBe("dpm_fast");
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
            expect(result.seed).toBe(123456);
        });

        it('should detect A1111 from raw string even if GeneratorTool.UNKNOWN is passed', () => {
            const raw = "A beautiful cat\nSteps: 20";
            const result = mapRawChunksToMetadata(raw, GeneratorTool.UNKNOWN);
            expect(result.tool).toBe(GeneratorTool.AUTOMATIC1111);
            expect(result.steps).toBe(20);
        });
    });
});
