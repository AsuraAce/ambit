import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from '@tauri-apps/plugin-fs';
import { imageToBase64, repairAssetUrl } from '../imageService';

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const originalFileReaderDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');

describe('imageToBase64', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        if (originalFetchDescriptor) {
            Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, 'fetch');
        }
        if (originalFileReaderDescriptor) {
            Object.defineProperty(globalThis, 'FileReader', originalFileReaderDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, 'FileReader');
        }
    });

    it('reads local JPEG files through Tauri and reports their actual MIME type', async () => {
        mockReadFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

        const result = await imageToBase64('C:/library/photo.jpg');

        expect(mockReadFile).toHaveBeenCalledWith('C:/library/photo.jpg');
        expect(result).toBe(`data:image/jpeg;base64,${btoa('\x01\x02\x03')}`);
    });

    it('returns existing data URLs without reading or fetching them', async () => {
        const dataUrl = 'data:image/webp;base64,abc';

        await expect(imageToBase64(dataUrl)).resolves.toBe(dataUrl);
        expect(mockReadFile).not.toHaveBeenCalled();
    });

    it.each([
        ['webp', 'C:/library/render.webp?cache=1', 'image/webp'],
        ['gif', 'C:/library/animation.gif', 'image/gif'],
        ['avif', 'C:/library/export.avif', 'image/avif'],
        ['default png', 'C:/library/no-extension', 'image/png']
    ])('uses the %s MIME type for local paths', async (_label, path, mimeType) => {
        mockReadFile.mockResolvedValue(new Uint8Array([65]));

        await expect(imageToBase64(path)).resolves.toBe(`data:${mimeType};base64,${btoa('A')}`);
    });

    it('converts remote and blob URLs with FileReader instead of Tauri filesystem access', async () => {
        const fetchMock = vi.fn(async () => ({
            blob: async () => new Blob(['remote'], { type: 'image/gif' })
        }));
        class MockFileReader {
            result = 'data:image/gif;base64,remote';
            onloadend: (() => void) | null = null;
            onerror: ((reason?: unknown) => void) | null = null;

            readAsDataURL(_blob: Blob) {
                queueMicrotask(() => this.onloadend?.());
            }
        }
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('FileReader', MockFileReader);

        await expect(imageToBase64('blob:http://ambit/image')).resolves.toBe('data:image/gif;base64,remote');
        expect(fetchMock).toHaveBeenCalledWith('blob:http://ambit/image');
        expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('rejects when FileReader cannot convert a remote image', async () => {
        const readError = new Error('reader failed');
        vi.stubGlobal('fetch', vi.fn(async () => ({
            blob: async () => new Blob(['remote'])
        })));
        class FailingFileReader {
            result: string | null = null;
            onloadend: (() => void) | null = null;
            onerror: ((reason?: unknown) => void) | null = null;

            readAsDataURL(_blob: Blob) {
                queueMicrotask(() => this.onerror?.(readError));
            }
        }
        vi.stubGlobal('FileReader', FailingFileReader);

        await expect(imageToBase64('https://example.test/image.png')).rejects.toBe(readError);
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
