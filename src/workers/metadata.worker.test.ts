
import { describe, it, expect } from 'vitest';
import { detectGenerationType, parseA1111Parameters, parseFilenameMetadata } from './metadata.worker';

describe('Metadata Worker Tests', () => {

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
            const meta: any = {};
            parseA1111Parameters(raw, meta);

            expect(meta.positivePrompt).toBe("Positive prompt here");
            expect(meta.negativePrompt).toBe("Negative content");
            expect(meta.steps).toBe(20);
            expect(meta.cfg).toBe(7.0);
            expect(meta.seed).toBe(12345);
            expect(meta.model).toBe("v1-5-pruned");
            expect(meta.modelHash).toBe("abcde");
        });

        it('should detect SD.Next via App key', () => {
            const raw = "Prompt\nSteps: 20, App: SD.Next";
            const meta: any = {};
            parseA1111Parameters(raw, meta);
            expect(meta.tool).toBe('SD.Next');
        });

        it('should detect Forge via Version key', () => {
            const raw = "Prompt\nSteps: 20, Version: forge";
            const meta: any = {};
            parseA1111Parameters(raw, meta);
            expect(meta.tool).toBe('Forge');
        });

        it('should extract LoRAs', () => {
            const raw = "A beautiful <lora:cool_style:0.8> painting";
            const meta: any = {};
            parseA1111Parameters(raw, meta);
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
});
