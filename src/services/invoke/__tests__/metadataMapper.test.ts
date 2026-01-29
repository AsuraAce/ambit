import { describe, it, expect } from 'vitest';
import { mapInvokeMetadata } from '../metadataMapper';

describe('metadataMapper', () => {
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
});
