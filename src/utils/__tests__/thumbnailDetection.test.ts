import { describe, expect, it } from 'vitest';
import { detectThumbnailSource, isUpgradeableThumb } from '../thumbnailDetection';

describe('thumbnailDetection', () => {
    it('recognizes Ambit thumbnails case-insensitively', () => {
        expect(detectThumbnailSource('C:/Images/.THUMBNAILS/photo.WEBP')).toBe('ambit');
        expect(isUpgradeableThumb('C:/Images/.thumbnails/photo.webp')).toBe(false);
    });

    it('distinguishes InvokeAI and other external thumbnails', () => {
        expect(detectThumbnailSource('C:/InvokeAI/outputs/thumbnails/photo.webp')).toBe('invokeai');
        expect(detectThumbnailSource('C:/cache/photo.jpg')).toBe('external');
        expect(isUpgradeableThumb('C:/InvokeAI/thumb.png')).toBe(true);
        expect(isUpgradeableThumb('https://example.test/thumb.jpg')).toBe(true);
    });

    it('treats missing thumbnails as neither generated nor upgradeable', () => {
        expect(detectThumbnailSource(undefined)).toBe('none');
        expect(detectThumbnailSource('')).toBe('none');
        expect(isUpgradeableThumb(undefined)).toBe(false);
    });
});
