import { describe, it, expect } from 'vitest';
import { isImageMasked } from '../maskingUtils';
import { AIImage } from '../../types';

describe('maskingUtils', () => {
    const mockImage: AIImage = {
        id: '1',
        url: 'test.png',
        thumbnailUrl: 'test-thumb.png',
        filename: 'test.png',
        width: 512,
        height: 512,
        timestamp: Date.now(),
        metadata: {
            positivePrompt: 'A beautiful sunset over the mountains',
            negativePrompt: '',
            steps: 20,
            cfg: 7,
            tool: 'Unknown' as any,
            model: 'Unknown',
            seed: 0,
            sampler: 'Euler a',
        },
        isDeleted: false,
        isFavorite: false,
        isPinned: false,
        userMasked: undefined,
    };

    describe('isImageMasked', () => {
        it('should return false if privacyEnabled is false', () => {
            expect(isImageMasked(mockImage, false, ['sunset'])).toBe(false);
        });

        it('should return true if userMasked is explicitly true, even if no keywords match', () => {
            const maskedImage = { ...mockImage, userMasked: true };
            expect(isImageMasked(maskedImage, true, [])).toBe(true);
        });

        it('should return false if userMasked is explicitly false, even if keywords match', () => {
            const unmaskedImage = { ...mockImage, userMasked: false };
            expect(isImageMasked(unmaskedImage, true, ['sunset'])).toBe(false);
        });

        it('should return true if a keyword matches the positive prompt', () => {
            expect(isImageMasked(mockImage, true, ['sunset'])).toBe(true);
        });

        it('should be case-insensitive for keyword matching', () => {
            expect(isImageMasked(mockImage, true, ['SUNSET'])).toBe(true);
        });

        it('should return false if no keywords match', () => {
            expect(isImageMasked(mockImage, true, ['ocean'])).toBe(false);
        });

        it('should return false if prompt is empty', () => {
            const emptyPromptImage = {
                ...mockImage,
                metadata: { ...mockImage.metadata, positivePrompt: '' }
            };
            expect(isImageMasked(emptyPromptImage, true, ['sunset'])).toBe(false);
        });

        it('should return false if maskedKeywords is empty and userMasked is undefined', () => {
            expect(isImageMasked(mockImage, true, [])).toBe(false);
        });

        it('should handle missing positive prompt gracefully', () => {
            const missingPromptImage = {
                ...mockImage,
                metadata: { ...mockImage.metadata, positivePrompt: undefined as any }
            };
            expect(isImageMasked(missingPromptImage, true, ['sunset'])).toBe(false);
        });
    });
});
