import { describe, expect, it } from 'vitest';
import { getAssetMatchKey, stripAssetExtension, uniqueAssetAliases } from '../assetIdentity';

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

    it('dedupes aliases case-insensitively while preserving display order', () => {
        expect(uniqueAssetAliases(['Alpha', 'alpha', '', undefined, 'Alpha.safetensors'])).toEqual(['Alpha', 'Alpha.safetensors']);
    });
});
