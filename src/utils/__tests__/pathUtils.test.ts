
import { describe, it, expect } from 'vitest';
import {
    getDirectoryPath,
    getFilename,
    isPathWithinDirectory,
    normalizeInvokeRoot,
    normalizePath,
    repairAssetUrl,
    toWindowsPath,
    urlToPath,
} from '../pathUtils';

describe('pathUtils', () => {
    describe('normalizePath', () => {
        it('should replace backslashes with forward slashes', () => {
            expect(normalizePath('foo\\bar')).toBe('foo/bar');
            expect(normalizePath('C:\\Users\\Name')).toBe('C:/Users/Name');
        });

        it('should remove duplicate slashes', () => {
            expect(normalizePath('foo//bar')).toBe('foo/bar');
            expect(normalizePath('foo\\\\bar')).toBe('foo/bar');
        });
    });

    describe('toWindowsPath', () => {
        it('should replace forward slashes with backslashes', () => {
            expect(toWindowsPath('foo/bar')).toBe('foo\\bar');
        });
    });

    describe('getFilename', () => {
        it('should extract filename from path', () => {
            expect(getFilename('path/to/file.txt')).toBe('file.txt');
            expect(getFilename('path\\to\\file.txt')).toBe('file.txt');
            expect(getFilename('file.txt')).toBe('file.txt');
        });

        it('should handle empty paths', () => {
            expect(getFilename('')).toBe('');
        });
    });

    describe('repairAssetUrl', () => {
        it('should repair double encoded asset urls', () => {
            expect(repairAssetUrl('http://asset.localhost/%2Fpath%2Fto%2Ffile.png')).toBe('http://asset.localhost//path/to/file.png');
        });

        it('should repair encoded colons', () => {
            expect(repairAssetUrl('asset:%2F%2FC%3A%2Fpath')).toBe('asset://C:/path');
        });

        it('should repair https asset localhost urls used in release builds', () => {
            expect(repairAssetUrl('https://asset.localhost/C%3A%2FUsers%2FName%2Fimage.webp')).toBe('https://asset.localhost/C:/Users/Name/image.webp');
        });

        it('passes through empty and non-asset URLs while repairing encoded backslashes', () => {
            expect(repairAssetUrl('')).toBe('');
            expect(repairAssetUrl('https://example.test/image.png')).toBe('https://example.test/image.png');
            expect(repairAssetUrl('https://localhost/_up_/C%3A%5Cimage.png'))
                .toBe('https://localhost/_up_/C:/image.png');
        });
    });

    describe('urlToPath', () => {
        it('should convert asset localhost urls back to local paths', () => {
            expect(urlToPath('http://asset.localhost/C%3A%2FUsers%2FName%2Fimage.png')).toBe('C:/Users/Name/image.png');
        });

        it('should convert asset protocol urls back to local paths', () => {
            expect(urlToPath('asset://localhost/D%3A%2FImages%2Ffolder%2Fsample.webp')).toBe('D:/Images/folder/sample.webp');
        });

        it('should normalize a decoded leading slash before Windows drive letters', () => {
            expect(urlToPath('http://asset.localhost/%2FC%3A%2FUsers%2FName%2Fimage.png')).toBe('C:/Users/Name/image.png');
        });

        it('handles empty, inline, plain, and malformed encoded URLs', () => {
            expect(urlToPath(undefined)).toBe('');
            expect(urlToPath('data:image/png;base64,a')).toBe('data:image/png;base64,a');
            expect(urlToPath('blob:preview')).toBe('blob:preview');
            expect(urlToPath('C:/plain/image.png')).toBe('C:/plain/image.png');
            expect(urlToPath('asset://localhost/%E0%A4%A')).toBe('%E0%A4%A');
        });
    });

    describe('directory helpers', () => {
        it('should derive a parent directory from a file path', () => {
            expect(getDirectoryPath('D:/Images/folder/sample.webp')).toBe('D:/Images/folder');
            expect(getDirectoryPath('C:/sample.webp')).toBe('C:/');
            expect(getDirectoryPath('filename.webp')).toBe('filename.webp');
            expect(getDirectoryPath('C:/')).toBe('C:/');
        });

        it('should detect when a path is inside a directory', () => {
            expect(isPathWithinDirectory('C:/Users/AmbitTester/AppData/Local/io.github.asuraace.ambit/.thumbnails/file.webp', 'C:/Users/AmbitTester/AppData/Local/io.github.asuraace.ambit')).toBe(true);
            expect(isPathWithinDirectory('D:/AmbitFixtures/art/output/image.png', 'C:/Users/AmbitTester/AppData/Local/io.github.asuraace.ambit')).toBe(false);
        });
    });

    describe('normalizeInvokeRoot', () => {
        it('normalizes database files, databases folders, roots, and empty values', () => {
            expect(normalizeInvokeRoot(null)).toBeNull();
            expect(normalizeInvokeRoot('D:\\Invoke\\databases\\invokeai.db')).toBe('D:/Invoke');
            expect(normalizeInvokeRoot('D:/Invoke/databases/')).toBe('D:/Invoke');
            expect(normalizeInvokeRoot('D:/Invoke/')).toBe('D:/Invoke');
        });
    });
});
