
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { parseA1111Parameters } from '../services/metadata/mappingUtils';
import { GeneratorTool, type ImageMetadata } from '../types';
import { detectGenerationType, mergeMetadata, parseExifData, parseFilenameMetadata, parseSdNextJsonMetadata } from './metadata.worker';

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

        it('should infer Midjourney from filenames that name the generator', () => {
            expect(parseFilenameMetadata('midjourney_misty_castle.png')).toMatchObject({
                tool: GeneratorTool.MIDJOURNEY,
                positivePrompt: 'midjourney misty castle'
            });
        });

        it('should treat date, numeric, UUID, and ComfyUI names as generic filenames', () => {
            expect(parseFilenameMetadata('2024-01-02_03-04-05.png').positivePrompt).toBe('');
            expect(parseFilenameMetadata('123456.png').positivePrompt).toBe('');
            expect(parseFilenameMetadata('0123456789abcdef0123456789abcdef.png').positivePrompt).toBe('');
            expect(parseFilenameMetadata('ComfyUI_00001.png').positivePrompt).toBe('');
        });

        it('should return unknown metadata for descriptive non-generator filenames', () => {
            expect(parseFilenameMetadata('family-vacation.png')).toEqual({
                tool: GeneratorTool.UNKNOWN,
                positivePrompt: '',
                steps: 0,
                cfg: 0
            });
        });
    });

    describe('mergeMetadata', () => {
        it('fills missing scalar fields and unions every resource array', () => {
            const base: Partial<ImageMetadata> = {
                tool: GeneratorTool.UNKNOWN,
                model: 'Unknown',
                sampler: 'Unknown',
                loras: ['shared'],
                controlNets: ['shared-control'],
                hypernetworks: ['shared-hyper'],
                embeddings: ['shared-embedding'],
                ipAdapters: ['shared-adapter']
            };
            const secondary: Partial<ImageMetadata> = {
                tool: GeneratorTool.COMFYUI,
                model: 'model',
                steps: 20,
                cfg: 7,
                seed: 0,
                sampler: 'euler',
                positivePrompt: 'positive',
                negativePrompt: 'negative',
                workflowJson: '{}',
                loras: ['shared', 'new-lora'],
                controlNets: ['shared-control', 'new-control'],
                hypernetworks: ['shared-hyper', 'new-hyper'],
                embeddings: ['shared-embedding', 'new-embedding'],
                ipAdapters: ['shared-adapter', 'new-adapter'],
                vae: 'vae',
                clipSkip: 2,
                denoisingStrength: 0.4,
                hiresUpscale: 2,
                hiresSteps: 10,
                hiresUpscaler: 'upscaler',
                modelHash: 'hash'
            };

            mergeMetadata(base, secondary);

            expect(base).toEqual(expect.objectContaining({
                tool: GeneratorTool.COMFYUI,
                model: 'model',
                seed: 0,
                positivePrompt: 'positive',
                workflowJson: '{}',
                loras: ['shared', 'new-lora'],
                controlNets: ['shared-control', 'new-control'],
                hypernetworks: ['shared-hyper', 'new-hyper'],
                embeddings: ['shared-embedding', 'new-embedding'],
                ipAdapters: ['shared-adapter', 'new-adapter'],
                modelHash: 'hash'
            }));
        });

        it('initializes resource arrays and preserves established scalar fields', () => {
            const base: Partial<ImageMetadata> = {
                tool: GeneratorTool.AUTOMATIC1111,
                model: 'base-model',
                steps: 1,
                cfg: 1,
                seed: 1,
                sampler: 'base-sampler',
                positivePrompt: 'base-positive',
                negativePrompt: 'base-negative',
                workflowJson: 'base-workflow',
                vae: 'base-vae',
                clipSkip: 1,
                denoisingStrength: 0.1,
                hiresUpscale: 1,
                hiresSteps: 1,
                hiresUpscaler: 'base-upscaler',
                modelHash: 'base-hash'
            };
            mergeMetadata(base, {
                ...base,
                tool: GeneratorTool.COMFYUI,
                model: 'secondary-model',
                loras: ['lora'],
                controlNets: ['control'],
                hypernetworks: ['hyper'],
                embeddings: ['embedding'],
                ipAdapters: ['adapter']
            });

            expect(base).toEqual(expect.objectContaining({
                tool: GeneratorTool.AUTOMATIC1111,
                model: 'base-model',
                loras: ['lora'],
                controlNets: ['control'],
                hypernetworks: ['hyper'],
                embeddings: ['embedding'],
                ipAdapters: ['adapter'],
                vae: 'base-vae'
            }));
        });

        it('leaves absent optional metadata untouched', () => {
            const base: Partial<ImageMetadata> = {};
            mergeMetadata(base, {});
            expect(base).toEqual({});
        });
    });

    describe('parseExifData', () => {
        const tiff = (configure?: (view: DataView, bytes: Uint8Array) => void) => {
            const bytes = new Uint8Array(40);
            const view = new DataView(bytes.buffer);
            bytes.set([0x49, 0x49]);
            view.setUint16(2, 0x002a, true);
            view.setUint32(4, 8, true);
            view.setUint16(8, 0, true);
            configure?.(view, bytes);
            return bytes;
        };

        it('rejects invalid TIFF headers, signatures, and IFD offsets', () => {
            expect(parseExifData(new Uint8Array(8))).toBeNull();
            expect(parseExifData(tiff(view => view.setUint16(2, 0, true)))).toBeNull();
            expect(parseExifData(tiff(view => view.setUint32(4, 4, true)))).toBeNull();
            expect(parseExifData(tiff(view => view.setUint32(4, 100, true)))).toBeNull();
        });

        it('returns null for empty, truncated, and comment-free IFDs', () => {
            expect(parseExifData(tiff())).toBeNull();
            expect(parseExifData(tiff((view) => view.setUint16(8, 4, true)).slice(0, 22))).toBeNull();
        });

        it('follows Exif IFD pointers and rejects undersized comment payloads', () => {
            const bytes = tiff((view) => {
                view.setUint16(8, 1, true);
                view.setUint16(10, 0x8769, true);
                view.setUint32(18, 26, true);
                view.setUint16(26, 1, true);
                view.setUint16(28, 0x9286, true);
                view.setUint32(32, 4, true);
                view.setUint32(36, 35, true);
            });
            expect(parseExifData(bytes)).toBeNull();
        });

        it('rejects Exif pointers outside the data and decodes little-endian Unicode comments', () => {
            const invalidPointer = tiff(view => {
                view.setUint16(8, 1, true);
                view.setUint16(10, 0x8769, true);
                view.setUint32(18, 100, true);
            });
            expect(parseExifData(invalidPointer)).toBeNull();

            const payload = new Uint8Array([0x55, 0x4e, 0x49, 0x43, 0x4f, 0x44, 0x45, 0, 0x4f, 0, 0x4b, 0]);
            const unicode = new Uint8Array(26 + payload.length);
            const view = new DataView(unicode.buffer);
            unicode.set([0x49, 0x49]);
            view.setUint16(2, 0x002a, true);
            view.setUint32(4, 8, true);
            view.setUint16(8, 1, true);
            view.setUint16(10, 0x9286, true);
            view.setUint16(12, 7, true);
            view.setUint32(14, payload.length, true);
            view.setUint32(18, 26, true);
            unicode.set(payload, 26);
            expect(parseExifData(unicode)).toBe('OK');
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
            expect(parseSdNextJsonMetadata('{"prompt":"p","seed":1e999}').seed).toBeUndefined();
            expect(parseSdNextJsonMetadata(JSON.stringify({ prompt: 'p', seed: 'Infinity' })).seed).toBeUndefined();
            expect(parseSdNextJsonMetadata(JSON.stringify([])).tool).toBe(GeneratorTool.SDNEXT);
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

        it('parses PNG buffers supplied directly to the worker', async () => {
            const encoder = new TextEncoder();
            const data = encoder.encode('parameters\0Buffer prompt\nSteps: 5, Seed: 7');
            const chunk = new Uint8Array(12 + data.length);
            new DataView(chunk.buffer).setUint32(0, data.length);
            chunk.set(encoder.encode('tEXt'), 4);
            chunk.set(data, 8);
            const buffer = new Uint8Array(8 + chunk.length + 12);
            buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
            buffer.set(chunk, 8);
            new DataView(buffer.buffer).setUint32(8 + chunk.length, 0);
            buffer.set(encoder.encode('IEND'), 12 + chunk.length);

            const response = await sendWorkerMessage({ buffer, filename: 'buffer.png' });
            expect(response).toMatchObject({ metadata: { positivePrompt: 'Buffer prompt', steps: 5, seed: 7 } });
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

        it('handles sparse InvokeAI metadata, string models, graph strings, and fallback lora names', async () => {
            const response = await sendWorkerMessage({
                filename: 'invoke.png',
                chunks: {
                    dream_metadata: JSON.stringify({
                        model: 'String Model',
                        loras: [
                            { model: { other: true } },
                            { lora: { other: true } },
                            { lora: { name: 'lora-name' } },
                            {},
                            null
                        ],
                        graph: 'graph-json'
                    })
                }
            });
            expect(response).toMatchObject({
                metadata: {
                    tool: GeneratorTool.INVOKEAI,
                    model: 'String Model',
                    loras: ['Unknown LoRA', 'lora-name'],
                    workflowJson: 'graph-json'
                }
            });
        });

        it('handles absent and non-record InvokeAI model and resource fields', async () => {
            const absent = await sendWorkerMessage({ filename: 'invoke.png', chunks: { invokeai_metadata: '{}' } });
            expect(absent).toMatchObject({ metadata: { tool: GeneratorTool.INVOKEAI } });

            postMessageMock.mockClear();
            const nonRecord = await sendWorkerMessage({
                filename: 'invoke.png',
                chunks: { invokeai_metadata: JSON.stringify({ model: 5, workflow: { nodes: [] } }) }
            });
            expect(nonRecord).toMatchObject({ metadata: { tool: GeneratorTool.INVOKEAI, workflowJson: '{"nodes":[]}' } });

            postMessageMock.mockClear();
            const named = await sendWorkerMessage({
                filename: 'invoke.png',
                chunks: { invokeai_metadata: JSON.stringify({ model: { name: 'Named Model' } }) }
            });
            expect(named).toMatchObject({ metadata: { model: 'Named Model' } });

            postMessageMock.mockClear();
            const unknown = await sendWorkerMessage({
                filename: 'invoke.png',
                chunks: { invokeai_metadata: JSON.stringify({ model: {} }) }
            });
            expect(unknown).toMatchObject({ metadata: { model: 'Unknown Model' } });
        });

        it('uses a valid default generator and uppercase parameter chunk', async () => {
            const response = await sendWorkerMessage({
                filename: 'parameters.png',
                defaultTool: GeneratorTool.FORGE,
                chunks: { PARAMETERS: 'Prompt\nSteps: 2' }
            });
            expect(response).toMatchObject({ metadata: { tool: GeneratorTool.FORGE, positivePrompt: 'Prompt' } });
        });

        it('normalizes malformed request fields and ignores non-string chunk values', async () => {
            const response = await sendWorkerMessage({
                requestId: 5,
                filename: 12,
                path: null,
                defaultTool: 'not-a-tool',
                chunks: { parameters: 42, valid: 'value' }
            });
            expect(response).toMatchObject({
                requestId: undefined,
                metadata: { tool: GeneratorTool.UNKNOWN, generationType: 'unknown' }
            });
        });

        it('treats an empty chunk record as absent data', async () => {
            const response = await sendWorkerMessage({ filename: 'plain.png', chunks: {} });
            expect(response).toMatchObject({ metadata: { tool: GeneratorTool.UNKNOWN } });
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

        it('posts the safe fallback when response delivery throws during parsing', async () => {
            postMessageMock.mockImplementationOnce(() => { throw new Error('delivery failed'); });
            await sendWorkerMessage({ filename: 'plain.png' });
            expect(postMessageMock.mock.calls[1][0]).toEqual({ metadata: { tool: 'Unknown' }, extra: {}, requestId: undefined });
        });
    });
});
