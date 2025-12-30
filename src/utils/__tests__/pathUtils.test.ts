
import { describe, it, expect } from 'vitest';
import { normalizePath, toWindowsPath, getFilename, repairAssetUrl } from '../pathUtils';

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
    });
});
