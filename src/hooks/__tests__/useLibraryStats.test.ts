
import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useLibraryStats } from '../useLibraryStats';
import { AIImage, ModelType } from '../../types';

describe('useLibraryStats', () => {
    const mockImages: AIImage[] = [
        {
            id: '1',
            timestamp: 100,
            url: 'url1',
            thumbnailUrl: 'thumb1',
            filename: 'img1.png',
            width: 512,
            height: 512,
            isFavorite: false,
            metadata: {
                positivePrompt: 'A cat holding a taco, masterpiece, highly detailed',
                steps: 20,
                model: ModelType.SDXL
            } as any
        },
        {
            id: '2',
            timestamp: 200,
            url: 'url2',
            thumbnailUrl: 'thumb2',
            filename: 'img2.png',
            width: 512,
            height: 512,
            isFavorite: false,
            metadata: {
                positivePrompt: 'A dog eating a pizza, masterpiece',
                steps: 30,
                model: ModelType.SD15
            } as any
        }
    ];

    it('should calculate basic totals correctly', () => {
        const { result } = renderHook(() => useLibraryStats(mockImages));

        expect(result.current.totalGenerations).toBe(2);
        expect(result.current.avgSteps).toBe(25); // (20 + 30) / 2
        expect(result.current.estSizeMB).toBe('4.8'); // 2 * 2.4
    });

    it('should calculate model distribution', () => {
        const { result } = renderHook(() => useLibraryStats(mockImages));

        const sdxl = result.current.modelStats.find(m => m.fullName === ModelType.SDXL);
        const sd15 = result.current.modelStats.find(m => m.fullName === ModelType.SD15);

        expect(sdxl?.count).toBe(1);
        expect(sd15?.count).toBe(1);
    });

    it('should generate a word cloud with stop-words removed', () => {
        const { result } = renderHook(() => useLibraryStats(mockImages));

        // 'cat' appears in image 1
        const cat = result.current.wordCloud.find(w => w.text === 'cat');
        expect(cat?.value).toBe(1);

        // 'masterpiece' is a stop-word and should NOT be present
        const masterpiece = result.current.wordCloud.find(w => w.text === 'masterpiece');
        expect(masterpiece).toBeUndefined();

        // 'taco' and 'pizza' should be present
        expect(result.current.wordCloud.some(w => w.text === 'taco')).toBe(true);
        expect(result.current.wordCloud.some(w => w.text === 'pizza')).toBe(true);
    });

    it('should handle empty image list gracefully', () => {
        const { result } = renderHook(() => useLibraryStats([]));

        expect(result.current.totalGenerations).toBe(0);
        expect(result.current.avgSteps).toBe(0);
        expect(result.current.wordCloud).toEqual([]);
    });
});
