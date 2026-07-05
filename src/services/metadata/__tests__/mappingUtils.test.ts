
import { describe, it, expect } from 'vitest';
import { mapRawChunksToMetadata } from '../mappingUtils';
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
    });

    describe('ComfyUI', () => {
        const comfyWorkflow = JSON.stringify({
            nodes: [
                { id: 1, type: "KSampler", widgets_values: [123456, "random", 20, 7.5, "euler", "normal", 1.0] }
            ]
        });

        const expectNoComfyGraphFields = (result: ReturnType<typeof mapRawChunksToMetadata>) => {
            expect(result.seed).toBeUndefined();
            expect(result.steps).toBeUndefined();
            expect(result.cfg).toBeUndefined();
            expect(result.sampler).toBeUndefined();
            expect(result.model).toBeUndefined();
            expect(result.positivePrompt).toBeUndefined();
            expect(result.negativePrompt).toBeUndefined();
            expect(result.loras).toBeUndefined();
            expect(result.controlNets).toBeUndefined();
            expect(result.ipAdapters).toBeUndefined();
        };

        it('should handle raw JSON string', () => {
            const result = mapRawChunksToMetadata(comfyWorkflow, GeneratorTool.COMFYUI);
            expect(result.tool).toBe(GeneratorTool.COMFYUI);
            expect(result.workflowJson).toBe(comfyWorkflow);
            expect(result.hasWorkflowHint).toBe(true);
            expectNoComfyGraphFields(result);
        });

        it('should handle object with prompt/workflow keys', () => {
            const chunks = { prompt: comfyWorkflow };
            const result = mapRawChunksToMetadata(chunks, GeneratorTool.COMFYUI);
            expect(result.tool).toBe(GeneratorTool.COMFYUI);
            expect(result.workflowJson).toBe(comfyWorkflow);
            expect(result.hasWorkflowHint).toBe(true);
            expectNoComfyGraphFields(result);
        });

        it('should not infer sampler or scheduler widgets', () => {
            const workflow = JSON.stringify({
                nodes: [
                    { id: 1, type: "KSampler", widgets_values: [123, "rand", 20, 7.5, "euler", "karras", 1.0] }
                ]
            });
            const result = mapRawChunksToMetadata(workflow, GeneratorTool.COMFYUI);
            expect(result.tool).toBe(GeneratorTool.COMFYUI);
            expect(result.workflowJson).toBe(workflow);
            expect(result.hasWorkflowHint).toBe(true);
            expectNoComfyGraphFields(result);
        });

        it('should not infer KSamplerAdvanced widget indexes', () => {
            const workflow = JSON.stringify({
                nodes: [
                    { id: 1, type: "KSamplerAdvanced", widgets_values: [true, 123456, "fixed", 40, 0, 40, 8.5, "dpmpp_2m", "karras", 1.0] }
                ]
            });
            const result = mapRawChunksToMetadata(workflow, GeneratorTool.COMFYUI);
            expect(result.tool).toBe(GeneratorTool.COMFYUI);
            expect(result.workflowJson).toBe(workflow);
            expect(result.hasWorkflowHint).toBe(true);
            expectNoComfyGraphFields(result);
        });

        it('should not infer Efficiency Node widgets', () => {
            const workflow = JSON.stringify({
                nodes: [
                    { id: 1, type: "SDParameterGenerator", widgets_values: ["v1-5.safetensors", "skip", "vae", "empty", 98765, 25, 1, 7.0, "euler_a", "normal", 1] }
                ]
            });
            const result = mapRawChunksToMetadata(workflow, GeneratorTool.COMFYUI);
            expect(result.tool).toBe(GeneratorTool.COMFYUI);
            expect(result.workflowJson).toBe(workflow);
            expect(result.hasWorkflowHint).toBe(true);
            expectNoComfyGraphFields(result);
        });
    });

    describe('InvokeAI', () => {
        it('should handle InvokeAI tool type via string', () => {
            const result = mapRawChunksToMetadata('{}', GeneratorTool.INVOKEAI);
            expect(result.tool).toBe(GeneratorTool.INVOKEAI);
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
            expect(result.workflowJson).toBe(comfyWorkflow);
            expect(result.hasWorkflowHint).toBe(true);
            expect(result.seed).toBeUndefined();
            expect(result.steps).toBeUndefined();
            expect(result.sampler).toBeUndefined();
        });

        it('should detect A1111 from raw string even if GeneratorTool.UNKNOWN is passed', () => {
            const raw = "A beautiful cat\nSteps: 20";
            const result = mapRawChunksToMetadata(raw, GeneratorTool.UNKNOWN);
            expect(result.tool).toBe(GeneratorTool.AUTOMATIC1111);
            expect(result.steps).toBe(20);
        });
    });
});
