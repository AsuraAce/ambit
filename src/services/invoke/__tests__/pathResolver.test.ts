import { describe, expect, it, vi } from 'vitest';
import { createInvokeImagePathResolver } from '../pathResolver';

const files = [
    'outputs/images/flat.png',
    'outputs/images/2026/05/25/date.png',
    'outputs/images/txt2img/type.png',
    'outputs/images/ab/hash.png',
    'outputs/images/2026/05/25/relative.png',
    'outputs/images/2026/05/25/duplicate.png',
    'outputs/images/txt2img/duplicate.png'
];

describe('InvokeAI image path resolver', () => {
    it.each([
        ['flat layout', 'flat.png', 'D:/Invoke/outputs/images/flat.png'],
        ['date layout', 'date.png', 'D:/Invoke/outputs/images/2026/05/25/date.png'],
        ['type layout', 'type.png', 'D:/Invoke/outputs/images/txt2img/type.png'],
        ['hash layout', 'hash.png', 'D:/Invoke/outputs/images/ab/hash.png'],
        ['relative image name', '2026/05/25/relative.png', 'D:/Invoke/outputs/images/2026/05/25/relative.png'],
        ['root-relative image name', 'outputs/images/2026/05/25/relative.png', 'D:/Invoke/outputs/images/2026/05/25/relative.png']
    ])('resolves %s', async (_label, imageName, expectedPath) => {
        const listImages = vi.fn().mockResolvedValue(files);
        const resolver = createInvokeImagePathResolver('D:/Invoke', listImages);

        await expect(resolver.resolveImagePath(imageName)).resolves.toEqual({
            absolutePath: expectedPath,
            relativePath: expectedPath.replace('D:/Invoke/', ''),
            ambiguous: false
        });
        expect(listImages).toHaveBeenCalledTimes(/[\\/]/.test(imageName) ? 0 : 1);
    });

    it('uses image_subfolder as the authoritative path before disk fallback', async () => {
        const listImages = vi.fn().mockResolvedValue(files);
        const resolver = createInvokeImagePathResolver('D:/Invoke', listImages);

        await expect(resolver.resolveImagePath('duplicate.png', 'custom/folder')).resolves.toEqual({
            absolutePath: 'D:/Invoke/outputs/images/custom/folder/duplicate.png',
            relativePath: 'outputs/images/custom/folder/duplicate.png',
            ambiguous: false
        });
        expect(listImages).not.toHaveBeenCalled();
    });

    it('marks basename collisions ambiguous instead of choosing a nested file silently', async () => {
        const resolver = createInvokeImagePathResolver('D:/Invoke', vi.fn().mockResolvedValue(files));

        await expect(resolver.resolveImagePath('duplicate.png')).resolves.toEqual({
            absolutePath: null,
            relativePath: null,
            ambiguous: true
        });
    });

    it('uses existing InvokeAI thumbnail candidates and falls back to the source image when none exist', async () => {
        const resolver = createInvokeImagePathResolver('D:/Invoke', vi.fn().mockResolvedValue(files));

        const flat = await resolver.resolveImagePath('flat.png');
        const nested = await resolver.resolveImagePath('date.png');
        const existing = new Set([
            'D:/Invoke/outputs/images/thumbnails/flat.webp',
            'D:/Invoke/outputs/images/2026/05/25/date.webp',
            'D:/Invoke/outputs/images/2026/05/25/date-custom.webp'
        ]);

        expect(resolver.resolveThumbnailPath(null, flat, existing)).toBe('D:/Invoke/outputs/images/thumbnails/flat.webp');
        expect(resolver.resolveThumbnailPath(null, nested, existing)).toBe('D:/Invoke/outputs/images/2026/05/25/date.webp');
        expect(resolver.resolveThumbnailPath('flat.webp', flat, existing)).toBe('D:/Invoke/outputs/images/thumbnails/flat.webp');
        expect(resolver.resolveThumbnailPath('date-custom.webp', nested, existing)).toBe('D:/Invoke/outputs/images/2026/05/25/date-custom.webp');
        expect(resolver.resolveThumbnailPath('missing.webp', nested, existing)).toBe('D:/Invoke/outputs/images/2026/05/25/date.png');
        expect(resolver.resolveThumbnailPath('2026/05/25/date.webp', nested, existing)).toBe('D:/Invoke/outputs/images/2026/05/25/date.webp');
    });

    it('checks central nested thumbnail folders before the legacy flat thumbnail folder', async () => {
        const resolver = createInvokeImagePathResolver('D:/Invoke', vi.fn().mockResolvedValue(files));
        const nested = await resolver.resolveImagePath('date.png');
        const existing = new Set([
            'D:/Invoke/outputs/images/thumbnails/2026/05/25/date.webp',
            'D:/Invoke/outputs/images/thumbnails/date.webp'
        ]);

        expect(resolver.resolveThumbnailPath(null, nested, existing)).toBe('D:/Invoke/outputs/images/thumbnails/2026/05/25/date.webp');
    });
});
