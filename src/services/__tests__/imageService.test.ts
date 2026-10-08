import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from '@tauri-apps/plugin-fs';
import { imageToAnalysisBase64, repairAssetUrl } from '../imageService';

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);
const originalCreateImageBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');

describe('imageToAnalysisBase64', () => {
    const drawImage = vi.fn();
    const close = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4096, height: 2048, close })));
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => {
            callback(new Blob(['SANITIZED_PIXELS'], { type: 'image/webp' }));
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        if (originalCreateImageBitmap) {
            Object.defineProperty(globalThis, 'createImageBitmap', originalCreateImageBitmap);
        } else {
            Reflect.deleteProperty(globalThis, 'createImageBitmap');
        }
    });

    it('decodes local image pixels and sends only a metadata-free WebP container', async () => {
        const privateMetadataSentinel = 'GPS=52.5,13.4;SERIAL=SECRET';
        mockReadFile.mockResolvedValue(new TextEncoder().encode(privateMetadataSentinel));

        const result = await imageToAnalysisBase64('C:/library/photo.jpg');

        expect(mockReadFile).toHaveBeenCalledWith('C:/library/photo.jpg');
        expect(createImageBitmap).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'image/jpeg' }),
            { imageOrientation: 'from-image' },
        );
        expect(result).toMatch(/^data:image\/webp;base64,/);
        expect(atob(result.split(',')[1])).toBe('SANITIZED_PIXELS');
        expect(result).not.toContain(btoa(privateMetadataSentinel));
        expect(close).toHaveBeenCalled();
    });

    it('caps the long edge at 2048 pixels without upscaling', async () => {
        mockReadFile.mockResolvedValue(new Uint8Array([1]));

        await imageToAnalysisBase64('C:/library/large.png');

        expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2048, 1024);
    });

    it('re-encodes existing data URLs instead of forwarding their container bytes', async () => {
        const source = `data:image/jpeg;base64,${btoa('SOURCE_EXIF_SENTINEL')}`;

        const result = await imageToAnalysisBase64(source);

        expect(mockReadFile).not.toHaveBeenCalled();
        expect(result).toBe(`data:image/webp;base64,${btoa('SANITIZED_PIXELS')}`);
    });

    it('fails closed when decode or re-encoding fails', async () => {
        mockReadFile.mockResolvedValue(new Uint8Array([1]));
        vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('decode failed'));
        await expect(imageToAnalysisBase64('C:/library/broken.jpg')).rejects.toThrow('decode failed');

        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementationOnce(callback => callback(null));
        await expect(imageToAnalysisBase64('C:/library/broken.jpg')).rejects.toThrow(
            'Browser could not create a sanitized WebP analysis image',
        );
    });

    it('rejects non-image remote responses', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            status: 200,
            blob: async () => new Blob(['html'], { type: 'text/html' }),
        })));

        await expect(imageToAnalysisBase64('https://example.test/not-an-image')).rejects.toThrow(
            'Analysis source is not an image',
        );
    });
});

describe('repairAssetUrl', () => {
    it.each([
        ['', ''],
        ['https://example.test/image.png', 'https://example.test/image.png'],
        ['blob:http://ambit/image', 'blob:http://ambit/image'],
        ['data:image/png;base64,abc', 'data:image/png;base64,abc'],
        ['C:/library/image.png', 'C:/library/image.png']
    ])('returns %s unchanged', (input, expected) => {
        expect(repairAssetUrl(input)).toBe(expected);
    });
});
