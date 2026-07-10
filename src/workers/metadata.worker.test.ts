
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { parseA1111Parameters } from '../services/metadata/mappingUtils';
import { detectGenerationType, parseFilenameMetadata, parseSdNextJsonMetadata } from './metadata.worker';

describe('Metadata Worker Tests', () => {
    const postMessageMock = vi.fn();

    beforeEach(() => {
        postMessageMock.mockClear();
        self.postMessage = postMessageMock;
    });

    const sendWorkerMessage = async (data: Record<string, unknown>) => {
        const handler = self.onmessage;
        if (typeof handler !== 'function') {
            throw new Error('Expected metadata worker message handler to be registered');
        }

        await handler.call(self, { data } as MessageEvent);
        return postMessageMock.mock.calls[0]?.[0] as Record<string, unknown>;
    };

    describe('detectGenerationType', () => {
        it('should detect txt2img paths', () => {
            expect(detectGenerationType('/path/to/txt2img-images/image.png')).toBe('txt2img');
            expect(detectGenerationType('D:\\SDNext\\outputs\\txt2img\\image.png')).toBe('txt2img');
            expect(detectGenerationType('/path/to/text/image.png')).toBe('txt2img');
        });

        it('should detect img2img paths', () => {
            expect(detectGenerationType('/path/to/img2img-images/image.png')).toBe('img2img');
            expect(detectGenerationType('D:\\SDNext\\outputs\\img2img\\image.png')).toBe('img2img');
            expect(detectGenerationType('/path/to/image/image.png')).toBe('img2img');
        });

        it('should detect extras paths', () => {
            expect(detectGenerationType('/path/to/extras-images/image.png')).toBe('extras');
            expect(detectGenerationType('D:\\SDNext\\outputs\\extras\\image.png')).toBe('extras');
            expect(detectGenerationType('/path/to/saved/image.png')).toBe('extras');
        });

        it('should detect grid paths', () => {
            expect(detectGenerationType('/path/to/txt2img-grids/image.png')).toBe('grid');
        });

        it('should return unknown for random paths', () => {
            expect(detectGenerationType('/path/to/random/image.png')).toBe('unknown');
            expect(detectGenerationType('')).toBe('unknown');
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

        it('should infer Midjourney prompts from prompt-like names with UUID suffixes', () => {
            const res = parseFilenameMetadata('misty_castle_01234567-89ab-cdef-0123-456789abcdef.png');

            expect(res.tool).toBe('Midjourney');
            expect(res.model).toBe('Midjourney v6');
            expect(res.positivePrompt).toBe('misty castle');
        });

        it('should treat date, numeric, UUID, and ComfyUI names as generic filenames', () => {
            expect(parseFilenameMetadata('2024-01-02_03-04-05.png').positivePrompt).toBe('');
            expect(parseFilenameMetadata('123456.png').positivePrompt).toBe('');
            expect(parseFilenameMetadata('0123456789abcdef0123456789abcdef.png').positivePrompt).toBe('');
            expect(parseFilenameMetadata('ComfyUI_00001.png').positivePrompt).toBe('');
        });
    });

    describe('parseSdNextJsonMetadata', () => {
        it('should parse SD.Next JSON parameters through the A1111-compatible path', () => {
            const meta = parseSdNextJsonMetadata(JSON.stringify({
                parameters: 'Prompt\nNegative prompt: blur\nSteps: 12, CFG scale: 4, Seed: 99, Sampler: Euler, Model: model-a',
            }));

            expect(meta.tool).toBe('SD.Next');
            expect(meta.positivePrompt).toBe('Prompt');
            expect(meta.negativePrompt).toBe('blur');
            expect(meta.steps).toBe(12);
            expect(meta.cfg).toBe(4);
            expect(meta.seed).toBe(99);
            expect(meta.sampler).toBe('Euler');
            expect(meta.model).toBe('model-a');
        });

        it('should parse prompt-style SD.Next JSON with optional negative prompt and numeric steps', () => {
            const meta = parseSdNextJsonMetadata(JSON.stringify({
                prompt: 'Prompt',
                negative_prompt: 'blur',
                seed: '123',
                steps: '18',
            }));

            expect(meta.tool).toBe('SD.Next');
            expect(meta.positivePrompt).toBe('Prompt');
            expect(meta.negativePrompt).toBe('blur');
            expect(meta.seed).toBe(123);
            expect(meta.steps).toBe(18);
        });

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

    describe('worker message handler', () => {
        it('posts a request-scoped error when no parseable data is supplied', async () => {
            const response = await sendWorkerMessage({ requestId: 'empty-request' });

            expect(response).toEqual({
                error: 'No data provided',
                requestId: 'empty-request'
            });
        });

        it('falls back to filename metadata and path generation type when chunks are absent', async () => {
            const response = await sendWorkerMessage({
                requestId: 'filename-request',
                filename: 'misty_castle_01234567-89ab-cdef-0123-456789abcdef.png',
                path: 'C:/outputs/img2img/misty_castle.png'
            });

            expect(response).toMatchObject({
                requestId: 'filename-request',
                extra: {},
                isIntermediate: false,
                metadata: {
                    tool: 'Midjourney',
                    model: 'Midjourney v6',
                    positivePrompt: 'misty castle',
                    generationType: 'img2img'
                }
            });
        });

        it('merges InvokeAI metadata, model objects, lora object shapes, and workflow chunks', async () => {
            const response = await sendWorkerMessage({
                requestId: 'invoke-request',
                filename: 'invoke.png',
                path: 'D:/Invoke/outputs/images/invoke.png',
                chunks: {
                    invokeai_metadata: JSON.stringify({
                        positive_prompt: 'invoke prompt',
                        negative_prompt: 'invoke negative',
                        seed: 123,
                        steps: 28,
                        cfg_scale: 6.5,
                        sampler_name: 'dpmpp_2m',
                        model: { model_name: 'Invoke Model' },
                        loras: [
                            'string-lora',
                            { model: { name: 'model-lora' } },
                            { lora: { model_name: 'nested-lora' } },
                            { name: 'plain-lora' }
                        ],
                        workflow: { nodes: [] }
                    }),
                    invokeai_graph: '{"graph":[]}'
                }
            });

            expect(response).toMatchObject({
                requestId: 'invoke-request',
                metadata: {
                    tool: 'InvokeAI',
                    positivePrompt: 'invoke prompt',
                    negativePrompt: 'invoke negative',
                    seed: 123,
                    steps: 28,
                    cfg: 6.5,
                    sampler: 'dpmpp_2m',
                    model: 'Invoke Model',
                    workflowJson: JSON.stringify({ nodes: [] }),
                    generationType: 'unknown'
                }
            });
            expect((response.metadata as { loras?: string[] }).loras).toEqual([
                'string-lora',
                'model-lora',
                'nested-lora',
                'plain-lora'
            ]);
        });

        it('parses Comfy workflow chunks and preserves the raw workflow JSON', async () => {
            const workflow = JSON.stringify({
                nodes: [
                    { id: 1, type: 'CheckpointLoaderSimple', widgets_values: ['dream.safetensors'] },
                    { id: 2, type: 'KSampler', widgets_values: [7, 'fixed', 18, 5.5, 'euler', 'karras'] }
                ]
            });

            const response = await sendWorkerMessage({
                requestId: 'comfy-request',
                filename: 'ComfyUI_00001.png',
                path: 'C:/outputs/txt2img-grids/grid.png',
                chunks: { workflow }
            });

            expect(response).toMatchObject({
                requestId: 'comfy-request',
                metadata: {
                    tool: 'ComfyUI',
                    workflowJson: workflow,
                    seed: 7,
                    steps: 18,
                    cfg: 5.5,
                    sampler: 'euler (karras)',
                    model: 'dream',
                    generationType: 'txt2img'
                }
            });
        });

        it('keeps parsing when optional JSON chunks are malformed', async () => {
            const response = await sendWorkerMessage({
                requestId: 'malformed-request',
                filename: 'plain.png',
                chunks: {
                    Parameters: 'Prompt\nSteps: 4, Seed: 0',
                    metadata: '{bad json',
                    prompt: '{bad workflow',
                    dream_metadata: '{bad invoke'
                }
            });

            expect(response).toMatchObject({
                requestId: 'malformed-request',
                metadata: {
                    tool: 'Automatic1111',
                    positivePrompt: 'Prompt',
                    steps: 4,
                    seed: 0,
                    generationType: 'unknown'
                }
            });
        });
    });
});
