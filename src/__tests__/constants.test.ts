import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateMockImages, INITIAL_COLLECTIONS } from '../constants';
import { GeneratorTool } from '../types';

describe('constants mock data helpers', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('generates mock images plus duplicate copies for duplicate-maintenance demos', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);

        const images = generateMockImages(6);

        expect(images).toHaveLength(11);
        expect(images[0]).toMatchObject({
            id: 'img_0',
            width: 832,
            height: 1216,
            isFavorite: true,
        });
        expect(images[0].metadata.negativePrompt).toContain('blurry');
        expect(images[0].metadata.loras).toHaveLength(1);
        expect(images[0].metadata.controlNets).toHaveLength(1);
        expect(images[0].metadata.ipAdapters).toHaveLength(1);
        expect(images[5].metadata.tool).toBe(GeneratorTool.UNKNOWN);

        expect(images[6].id).toBe('img_dup_0');
        expect(images[6].filename).toBe(`copy_of_${images[0].filename}`);
        expect(images[6].metadata).toBe(images[0].metadata);
    });

    it('handles an empty mock library without inventing duplicates', () => {
        expect(generateMockImages(0)).toEqual([]);
    });

    it('starts with no built-in collections', () => {
        expect(INITIAL_COLLECTIONS).toEqual([]);
    });
});
