import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from '@tauri-apps/plugin-fs';
import { imageToBase64 } from '../imageService';

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);

describe('imageToBase64', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
