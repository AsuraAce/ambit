import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from '@tauri-apps/api/path';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { GeneratorTool, type AIImage } from '../../types';
import { exportImagesToZip } from '../exportService';

vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(), writeFile: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ join: vi.fn() }));

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedJoin = vi.mocked(join);

const image = (overrides: Partial<AIImage> = {}): AIImage => ({
    id: 'C:/images/photo.png',
    url: 'asset://C:/images/photo.png',
    thumbnailUrl: 'asset://C:/thumbs/photo.webp',
    filename: 'photo.png',
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: false,
    notes: 'keeper',
    metadata: {
        tool: GeneratorTool.COMFYUI,
        model: 'flux',
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: 'portrait',
        negativePrompt: '',
    },
    ...overrides,
});

const writtenZip = async () => {
    const bytes = mockedWriteFile.mock.calls[0][1];
    if (!(bytes instanceof Uint8Array)) {
        throw new Error('Expected exportService to write ZIP bytes');
    }
    return JSZip.loadAsync(bytes);
};

describe('exportImagesToZip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockedJoin.mockImplementation(async (...parts) => parts.join('/'));
        mockedWriteFile.mockResolvedValue(undefined);
    });

    it('archives local images, metadata, and a manifest while reporting progress', async () => {
        mockedReadFile.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
        const onProgress = vi.fn();

        await exportImagesToZip([image()], 'C:/exports', 'library', onProgress);

        expect(mockedJoin).toHaveBeenCalledWith('C:/exports', 'library.zip');
        expect(onProgress).toHaveBeenCalledWith(1, 1);
        const zip = await writtenZip();
        expect(await zip.file('photo.png')?.async('uint8array')).toEqual(new Uint8Array([1, 2, 3]));
        expect(JSON.parse(await zip.file('metadata/photo.png.json')!.async('string'))).toEqual(image().metadata);
        expect(JSON.parse(await zip.file('manifest.json')!.async('string'))).toEqual([{
            filename: 'photo.png',
            metadata: image().metadata,
            notes: 'keeper',
        }]);
    });

    it('falls back to fetch for supported remote and data URLs', async () => {
        const images = [
            image({ id: 'http', url: 'https://example.test/a.png', filename: 'a.png' }),
            image({ id: 'blob', url: 'blob:ambit-image', filename: 'b.png' }),
            image({ id: 'data', url: 'data:image/png;base64,AQ==', filename: 'c.png' }),
        ];
        mockedReadFile.mockRejectedValue(new Error('not a local file'));
        vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['remote']) })));

        await exportImagesToZip(images, 'C:/exports', 'remote.zip');

        expect(fetch).toHaveBeenCalledTimes(3);
        expect(mockedJoin).toHaveBeenCalledWith('C:/exports', 'remote.zip');
        const zip = await writtenZip();
        expect(zip.file('a.png')).not.toBeNull();
        expect(zip.file('b.png')).not.toBeNull();
        expect(zip.file('c.png')).not.toBeNull();
    });

    it('records readable error files for local and failed remote sources', async () => {
        mockedReadFile.mockRejectedValue(new Error('read denied'));
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

        await exportImagesToZip([
            image({ id: 'C:/missing.png', url: 'asset://C:/missing.png', filename: 'local.png' }),
            image({ id: 'remote', url: 'https://example.test/missing.png', filename: 'remote.png' }),
        ], 'C:/exports', 'errors');

        const zip = await writtenZip();
        expect(await zip.file('local.png.error.txt')!.async('string')).toBe('Failed to read local file: C:/missing.png');
        expect(await zip.file('remote.png.error.txt')!.async('string')).toBe(
            'Failed to download source image: https://example.test/missing.png'
        );
    });
});
