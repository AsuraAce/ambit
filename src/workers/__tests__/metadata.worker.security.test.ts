
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decompressDeflate } from '../metadata.worker';

describe('decompressDeflate Security Limits', () => {
    beforeEach(() => {
        vi.stubGlobal('console', {
            warn: vi.fn(),
            error: console.error, // Don't mock error
            log: vi.fn(),
        });
    });

    it('should handle small decompression normally', async () => {
        const mockData = new Uint8Array([1, 2, 3]);
        const mockReader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: mockData })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            cancel: vi.fn(),
        };
        const mockStream = {
            getReader: () => mockReader,
        };

        vi.stubGlobal('DecompressionStream', vi.fn().mockImplementation(function() {
            return {
                writable: {},
                readable: mockStream,
            };
        }));

        vi.stubGlobal('Response', vi.fn().mockImplementation(function() {
            return {
                body: {
                    pipeThrough: vi.fn().mockReturnValue(mockStream),
                },
            };
        }));

        const result = await decompressDeflate(new Uint8Array([0]));
        expect(result).toEqual(mockData);
    });

    it('should abort if decompressed size exceeds 10MB', async () => {
        const MAX_DECOMPRESSED_SIZE = 10 * 1024 * 1024;
        const largeChunk = new Uint8Array(MAX_DECOMPRESSED_SIZE + 1);

        const mockReader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: largeChunk })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            cancel: vi.fn(),
        };
        const mockStream = {
            getReader: () => mockReader,
        };

        vi.stubGlobal('DecompressionStream', vi.fn().mockImplementation(function() {
            return {
                writable: {},
                readable: mockStream,
            };
        }));

        vi.stubGlobal('Response', vi.fn().mockImplementation(function() {
            return {
                body: {
                    pipeThrough: vi.fn().mockReturnValue(mockStream),
                },
            };
        }));

        const result = await decompressDeflate(new Uint8Array([0]));
        
        expect(result).toBeNull();
        expect(mockReader.cancel).toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Decompression limit exceeded'));
    });
});
