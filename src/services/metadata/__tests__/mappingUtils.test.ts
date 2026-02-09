
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
