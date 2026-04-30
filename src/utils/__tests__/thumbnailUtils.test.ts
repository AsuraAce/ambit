import { describe, expect, it } from 'vitest';
import { AIImage, Collection } from '../../types';
import { isCollectionThumbnailImage } from '../thumbnailUtils';

const image = (overrides: Partial<AIImage> = {}): AIImage => ({
    id: 'img1',
    url: 'asset://C:/images/img1.png',
    thumbnailUrl: 'asset://C:/thumbs/img1.webp',
    filename: 'img1.png',
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: false,
    metadata: {
        tool: 'Unknown' as AIImage['metadata']['tool'],
        model: '',
        seed: 0,
        steps: 0,
        cfg: 0,
        sampler: '',
        positivePrompt: '',
        negativePrompt: ''
    },
    ...overrides
});

const collection = (overrides: Partial<Collection>): Collection => ({
    id: 'c1',
    name: 'Collection',
    imageIds: [],
    createdAt: 1,
    source: 'ambit',
    ...overrides
});

describe('isCollectionThumbnailImage', () => {
    it('matches only the custom selected image when a custom thumbnail exists', () => {
        const active = collection({
            customThumbnail: 'img2',
            thumbnail: 'asset://C:/thumbs/img1.webp',
            thumbnailSourceKind: 'customImage'
        });

        expect(isCollectionThumbnailImage(image({ id: 'img1' }), active)).toBe(false);
        expect(isCollectionThumbnailImage(image({ id: 'img2', thumbnailUrl: 'asset://C:/thumbs/img2.webp' }), active)).toBe(true);
    });

    it('uses resolved thumbnail urls for dynamic thumbnails', () => {
        const active = collection({
            thumbnail: 'asset://C:/thumbs/img1.webp',
            thumbnailSourceKind: 'dynamic'
        });

        expect(isCollectionThumbnailImage(image(), active)).toBe(true);
        expect(isCollectionThumbnailImage(image({ id: 'img2', thumbnailUrl: 'asset://C:/thumbs/img2.webp' }), active)).toBe(false);
    });
});
