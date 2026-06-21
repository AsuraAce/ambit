import { describe, expect, it } from 'vitest';
import {
    getAssetMatchKey,
    getAssetMatchKeyCandidates,
    resolveAssetMatchKey,
    stripAssetExtension,
    uniqueAssetAliases
} from '../assetIdentity';

describe('assetIdentity', () => {
    it('builds the same match key for display names and local filenames', () => {
        expect(getAssetMatchKey('Pony Diffusion V6 XL')).toBe(getAssetMatchKey('ponyDiffusionV6XL.safetensors'));
    });

    it('strips supported resource extensions', () => {
        expect(stripAssetExtension('C:\\models\\Flux.Dev.ckpt')).toBe('Flux.Dev');
        expect(stripAssetExtension('/models/lora/Detailer.pt')).toBe('Detailer');
    });

    it('normalizes case and simple separators without removing meaningful text', () => {
        expect(getAssetMatchKey('Realistic_Vision-v5.1')).toBe('realisticvisionv51');
        expect(getAssetMatchKey('realistic vision v5 1')).toBe('realisticvisionv51');
        expect(getAssetMatchKey('RealisticVisionV6')).not.toBe(getAssetMatchKey('RealisticVisionV5'));
    });

    it('derives suffix candidates for InvokeAI display labels', () => {
        expect(getAssetMatchKeyCandidates('Flux Style - watercolor_flux_v1.1_rank_16_bf16')).toEqual([
            'fluxstylewatercolorfluxv11rank16bf16',
            'watercolorfluxv11rank16bf16'
        ]);

        expect(getAssetMatchKeyCandidates('Pony Style - Gothic Neon, g0th1cPXL')).toEqual([
            'ponystylegothicneong0th1cpxl',
            'gothicneong0th1cpxl',
            'g0th1cpxl'
        ]);
    });

    it('resolves display labels to a local disk key only when that key is known', () => {
        expect(resolveAssetMatchKey(
            'Flux Style - watercolor_flux_v1.1_rank_16_bf16',
            new Set(['watercolorfluxv11rank16bf16'])
        )).toBe('watercolorfluxv11rank16bf16');

        expect(resolveAssetMatchKey(
            'Flux Style - watercolor_flux_v1.1_rank_16_bf16',
            new Set(['differentlora'])
        )).toBe('fluxstylewatercolorfluxv11rank16bf16');
    });

    it('dedupes aliases case-insensitively while preserving display order', () => {
        expect(uniqueAssetAliases(['Alpha', 'alpha', '', undefined, 'Alpha.safetensors'])).toEqual(['Alpha', 'Alpha.safetensors']);
    });
});
