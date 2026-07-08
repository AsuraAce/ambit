
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { ImageMetadata } from '../types';
import { GeneratorTool } from '../types';
import { parseA1111Parameters } from '../services/metadata/mappingUtils';
import { detectGenerationType, parseFilenameMetadata, parseSdNextJsonMetadata } from './metadata.worker';

describe('Metadata Worker Tests', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('detectGenerationType', () => {
        it('should detect txt2img paths', () => {
            expect(detectGenerationType('/path/to/txt2img-images/image.png')).toBe('txt2img');
            expect(detectGenerationType('D:\\SDNext\\outputs\\txt2img\\image.png')).toBe('txt2img');
        });

        it('should detect img2img paths', () => {
            expect(detectGenerationType('/path/to/img2img-images/image.png')).toBe('img2img');
            expect(detectGenerationType('D:\\SDNext\\outputs\\img2img\\image.png')).toBe('img2img');
        });

        it('should detect extras paths', () => {
            expect(detectGenerationType('/path/to/extras-images/image.png')).toBe('extras');
            expect(detectGenerationType('D:\\SDNext\\outputs\\extras\\image.png')).toBe('extras');
        });

        it('should detect grid paths', () => {
            expect(detectGenerationType('/path/to/txt2img-grids/image.png')).toBe('grid');
        });

        it('should return unknown for random paths', () => {
            expect(detectGenerationType('/path/to/random/image.png')).toBe('unknown');
        });

        it('should respect existing type if not unknown', () => {
            expect(detectGenerationType('/path/to/txt2img/image.png', 'custom')).toBe('custom');
        });
    });

    describe('parseA1111Parameters', () => {
        it('should parse basic A1111 parameters', () => {
            const raw = "Positive prompt here\nNegative prompt: Negative content\nSteps: 20, Sampler: Euler a, CFG scale: 7, Seed: 12345, Model: v1-5-pruned, Model hash: abcde";
            const meta = parseA1111Parameters(raw);

            expect(meta.positivePrompt).toBe("Positive prompt here");
            expect(meta.negativePrompt).toBe("Negative content");
            expect(meta.steps).toBe(20);
            expect(meta.cfg).toBe(7.0);
            expect(meta.seed).toBe(12345);
            expect(meta.model).toBe("v1-5-pruned");
            expect(meta.modelHash).toBe("abcde");
        });

        it('should preserve an explicit zero seed', () => {
            const meta = parseA1111Parameters("Prompt\nSteps: 20, Seed: 0");

            expect(meta.seed).toBe(0);
        });

        it('should detect SD.Next via App key', () => {
            const raw = "Prompt\nSteps: 20, App: SD.Next";
            const meta = parseA1111Parameters(raw);
            expect(meta.tool).toBe('SD.Next');
        });

        it('should detect Forge via Version key', () => {
            const raw = "Prompt\nSteps: 20, Version: forge";
            const meta = parseA1111Parameters(raw);
            expect(meta.tool).toBe('Forge');
        });

        it('should extract LoRAs', () => {
            const raw = "A beautiful <lora:cool_style:0.8> painting";
            const meta = parseA1111Parameters(raw);
            expect(meta.loras).toContain('cool_style');
        });
    });

    describe('parseFilenameMetadata', () => {
        it('should parse generic filename', () => {
            const res = parseFilenameMetadata("image_0001.png");
            expect(res.tool).toBe("Unknown");
        });

        // Add more filename parsing tests as needed
    });

    describe('parseSdNextJsonMetadata', () => {
        it('should preserve numeric and numeric-string seeds', () => {
            expect(parseSdNextJsonMetadata(JSON.stringify({ prompt: 'p', seed: 0 })).seed).toBe(0);
            expect(parseSdNextJsonMetadata(JSON.stringify({ prompt: 'p', seed: '0' })).seed).toBe(0);
            expect(parseSdNextJsonMetadata(JSON.stringify({ prompt: 'p', seed: '123' })).seed).toBe(123);
        });

        it('should leave malformed seeds unknown', () => {
            expect(parseSdNextJsonMetadata(JSON.stringify({ prompt: 'p', seed: 'not-a-number' })).seed).toBeUndefined();
            expect(parseSdNextJsonMetadata(JSON.stringify({ prompt: 'p', seed: '' })).seed).toBeUndefined();
            expect(parseSdNextJsonMetadata(JSON.stringify({ prompt: 'p', seed: false })).seed).toBeUndefined();
            expect(parseSdNextJsonMetadata(JSON.stringify({ prompt: 'p', seed: {} })).seed).toBeUndefined();
            expect(parseSdNextJsonMetadata(JSON.stringify({ prompt: 'p', seed: [] })).seed).toBeUndefined();
        });
    });

    describe('ComfyUI fallback', () => {
        it('should preserve workflow JSON without inferring graph fields', async () => {
            const workflow = JSON.stringify({
                nodes: [
                    { id: 1, type: 'KSampler', widgets_values: [123456, 'random', 20, 7.5, 'euler', 'normal', 1.0] }
                ]
            });
            const postMessage = vi.spyOn(self, 'postMessage').mockImplementation(() => undefined);
            const handler = self.onmessage;
            expect(typeof handler).toBe('function');

            await (handler as (event: MessageEvent) => Promise<void>)({
                data: {
                    chunks: { prompt: workflow },
                    filename: 'comfy.png',
                    requestId: 'comfy-worker-test',
                },
            } as MessageEvent);

            type WorkerResponse = {
                metadata: Partial<ImageMetadata>;
                requestId?: string;
            };
            const response = postMessage.mock.calls[0]?.[0] as WorkerResponse;

            expect(response.requestId).toBe('comfy-worker-test');
            expect(response.metadata.tool).toBe(GeneratorTool.COMFYUI);
            expect(response.metadata.workflowJson).toBe(workflow);
            expect(response.metadata.hasWorkflowHint).toBe(true);
            expect(response.metadata.seed).toBeUndefined();
            expect(response.metadata.steps).toBeUndefined();
            expect(response.metadata.cfg).toBeUndefined();
            expect(response.metadata.sampler).toBeUndefined();
            expect(response.metadata.model).toBeUndefined();
            expect(response.metadata.positivePrompt).toBeUndefined();
            expect(response.metadata.negativePrompt).toBeUndefined();
        });
    });
});
