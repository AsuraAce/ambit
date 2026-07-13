import { describe, expect, it } from 'vitest';
import { expandSamplerVariants, normalizeSampler } from '../samplerUtils';

describe('samplerUtils', () => {
    it('normalizes known sampler aliases to canonical display names', () => {
        expect(normalizeSampler('')).toBe('Unknown');
        expect(normalizeSampler('euler_a')).toBe('Euler a');
        expect(normalizeSampler('DPM++ 2M SDE KARRAS')).toBe('DPM++ 2M SDE Karras');
        expect(normalizeSampler('custom_sampler-name')).toBe('Custom Sampler Name');
    });

    it('expands canonical selections back to all matching raw database values', () => {
        expect(expandSamplerVariants([], ['euler_a'])).toEqual([]);
        expect(expandSamplerVariants(
            ['Euler a', 'DPM++ 2M'],
            ['euler_a', 'Euler A', 'dpm++ 2m', 'heun']
        )).toEqual(['euler_a', 'Euler A', 'dpm++ 2m']);
    });
});
