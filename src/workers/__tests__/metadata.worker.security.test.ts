
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decompressDeflate, parsePngChunksEnhanced } from '../metadata.worker';

const MAX_PNG_DECODED_TEXT_TOTAL_BYTES = 16 * 1024 * 1024;
const textEncoder = new TextEncoder();
const nativeDecompressionStream = globalThis.DecompressionStream;
const nativeResponse = globalThis.Response;
type Bytes = Uint8Array<ArrayBufferLike>;

const concat = (parts: Bytes[]): Uint8Array => {
    const totalLength = parts.reduce((total, part) => total + part.byteLength, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.byteLength;
    }
    return result;
};

const pngChunk = (type: string, data: Bytes = new Uint8Array()): Uint8Array => {
    const result = new Uint8Array(8 + data.byteLength + 4);
    const view = new DataView(result.buffer);
    view.setUint32(0, data.byteLength);
    result.set(textEncoder.encode(type), 4);
    result.set(data, 8);
    return result;
};

const pngFile = (...chunks: Bytes[]): Uint8Array =>
    concat([
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ...chunks,
        pngChunk('IEND'),
    ]);

const textChunkData = (key: string, value: string | Bytes): Uint8Array => {
    const encodedValue = typeof value === 'string' ? textEncoder.encode(value) : value;
    return concat([textEncoder.encode(key), new Uint8Array([0]), encodedValue]);
};

const repeatedTextChunkData = (key: string, length: number, fill: number): Uint8Array =>
    textChunkData(key, new Uint8Array(length).fill(fill));

const malformedUtf8OverDecodedBudget = (): Uint8Array =>
    new Uint8Array(Math.floor(MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 3) + 1).fill(0xff);

const itxtUncompressedData = (key: string, value: string | Bytes): Uint8Array => {
    const encodedValue = typeof value === 'string' ? textEncoder.encode(value) : value;
    return concat([
        textEncoder.encode(key),
        new Uint8Array([0, 0, 0, 0, 0]),
        encodedValue,
    ]);
};

const repeatedItxtData = (key: string, length: number, fill: number): Uint8Array =>
    itxtUncompressedData(key, new Uint8Array(length).fill(fill));

const ztxtData = (key: string, compressed: Bytes = new Uint8Array([1, 2, 3])): Uint8Array =>
    concat([textEncoder.encode(key), new Uint8Array([0, 0]), compressed]);

const itxtCompressedData = (key: string, compressed: Bytes = new Uint8Array([1, 2, 3])): Uint8Array =>
    concat([textEncoder.encode(key), new Uint8Array([0, 1, 0, 0, 0]), compressed]);

const exifUserCommentData = (comment: string): Uint8Array => {
    const encodedComment = concat([
        textEncoder.encode('ASCII'),
        new Uint8Array([0, 0, 0]),
        textEncoder.encode(comment),
    ]);
    const dataOffset = 26;
    const result = new Uint8Array(dataOffset + encodedComment.byteLength);
    const view = new DataView(result.buffer);

    result[0] = 0x49;
    result[1] = 0x49;
    view.setUint16(2, 0x002a, true);
    view.setUint32(4, 8, true);
    view.setUint16(8, 1, true);

    const entryOffset = 10;
    view.setUint16(entryOffset, 0x9286, true);
    view.setUint16(entryOffset + 2, 7, true);
    view.setUint32(entryOffset + 4, encodedComment.byteLength, true);
    view.setUint32(entryOffset + 8, dataOffset, true);
    view.setUint32(22, 0, true);
    result.set(encodedComment, dataOffset);

    return result;
};

const exifUserCommentBytes = (
    encodedComment: Bytes,
    littleEndian = true,
): Uint8Array => {
    const dataOffset = 26;
    const result = new Uint8Array(dataOffset + encodedComment.byteLength);
    const view = new DataView(result.buffer);

    result[0] = littleEndian ? 0x49 : 0x4d;
    result[1] = littleEndian ? 0x49 : 0x4d;
    view.setUint16(2, 0x002a, littleEndian);
    view.setUint32(4, 8, littleEndian);
    view.setUint16(8, 1, littleEndian);

    const entryOffset = 10;
    view.setUint16(entryOffset, 0x9286, littleEndian);
    view.setUint16(entryOffset + 2, 7, littleEndian);
    view.setUint32(entryOffset + 4, encodedComment.byteLength, littleEndian);
    view.setUint32(entryOffset + 8, dataOffset, littleEndian);
    view.setUint32(22, 0, littleEndian);
    result.set(encodedComment, dataOffset);

    return result;
};

const stubDeflateResult = (chunks: Bytes[]) => {
    const mockReader = {
        read: vi.fn(),
        cancel: vi.fn(),
    };
    for (const chunk of chunks) {
        mockReader.read.mockResolvedValueOnce({ done: false, value: chunk });
    }
    mockReader.read.mockResolvedValueOnce({ done: true, value: undefined });

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

    return mockReader;
};

const stubInvalidDeflate = () => {
    vi.stubGlobal('DecompressionStream', vi.fn().mockImplementation(function() {
        throw new Error('invalid deflate');
    }));
};

describe('decompressDeflate Security Limits', () => {
    beforeEach(() => {
        vi.stubGlobal('console', {
            warn: vi.fn(),
            error: console.error, // Don't mock error
            log: vi.fn(),
            debug: vi.fn(),
        });
    });

    it('should handle small decompression normally', async () => {
        const mockData = new Uint8Array([1, 2, 3]);
        stubDeflateResult([mockData]);

        const result = await decompressDeflate(new Uint8Array([0]));
        expect(result.status).toBe('ok');
        if (result.status === 'ok') {
            expect(result.data).toEqual(mockData);
        }
    });

    it('should abort if decompressed size exceeds 10MB', async () => {
        const MAX_DECOMPRESSED_SIZE = 10 * 1024 * 1024;
        const largeChunk = new Uint8Array(MAX_DECOMPRESSED_SIZE + 1);

        const mockReader = stubDeflateResult([largeChunk]);

        const result = await decompressDeflate(new Uint8Array([0]));
        
        expect(result.status).toBe('over-limit');
        expect(mockReader.cancel).toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Decompression limit exceeded'));
    });

    it('should fail closed when decompression is unavailable or disabled by size limits', async () => {
        vi.stubGlobal('DecompressionStream', undefined);

        await expect(decompressDeflate(new Uint8Array([0]))).resolves.toEqual({ status: 'invalid' });
        await expect(decompressDeflate(new Uint8Array([0]), 0)).resolves.toEqual({ status: 'over-limit' });
    });

    it('should ignore non-byte stream chunks while collecting decompressed bytes', async () => {
        const mockReader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: 'not-bytes' })
                .mockResolvedValueOnce({ done: false, value: new Uint8Array([4, 5]) })
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

        expect(result.status).toBe('ok');
        if (result.status === 'ok') {
            expect(result.data).toEqual(new Uint8Array([4, 5]));
        }
    });

    it('should fail closed when the browser response has no readable body', async () => {
        vi.stubGlobal('DecompressionStream', vi.fn().mockImplementation(function() {
            return {
                writable: {},
                readable: {},
            };
        }));
        vi.stubGlobal('Response', vi.fn().mockImplementation(function() {
            return { body: null };
        }));

        await expect(decompressDeflate(new Uint8Array([0]))).resolves.toEqual({ status: 'invalid' });
    });
});

describe('parsePngChunksEnhanced Security Limits', () => {
    beforeEach(() => {
        if (nativeDecompressionStream) vi.stubGlobal('DecompressionStream', nativeDecompressionStream);
        if (nativeResponse) vi.stubGlobal('Response', nativeResponse);
        vi.stubGlobal('console', {
            warn: vi.fn(),
            error: console.error,
            log: vi.fn(),
            debug: vi.fn(),
        });
    });

    it('should parse normal text, iTXt, and zTXt metadata', async () => {
        const compressedValue = Uint8Array.from(textEncoder.encode('CompressedValue'));
        const mockReader = stubDeflateResult([compressedValue]);

        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('tEXt', textChunkData('Software', 'Ambit')),
            pngChunk('iTXt', itxtUncompressedData('Keyword', 'Value')),
            pngChunk('zTXt', ztxtData('Compressed')),
        ));

        expect(chunks.Software).toBe('Ambit');
        expect(chunks.Keyword).toBe('Value');
        expect(mockReader.read).toHaveBeenCalled();
        expect(chunks.Compressed).toBe('CompressedValue');
    });

    it('should ignore invalid or truncated PNG buffers without throwing', async () => {
        await expect(parsePngChunksEnhanced(new Uint8Array([1, 2, 3]))).resolves.toEqual({});
        await expect(parsePngChunksEnhanced(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).resolves.toEqual({});
        await expect(parsePngChunksEnhanced(pngFile(pngChunk('tEXt', textEncoder.encode('NoNull'))).slice(0, 20))).resolves.toEqual({});
    });

    it('should extract A1111 parameters from PNG eXIf UserComment metadata', async () => {
        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('eXIf', exifUserCommentData('Prompt\nSteps: 20, Seed: 123')),
        ));

        expect(chunks.parameters).toBe('Prompt\nSteps: 20, Seed: 123');
    });

    it('should decode EXIF UserComment variants used by different generators', async () => {
        const unicodeComment = concat([
            textEncoder.encode('UNICODE\0'),
            new Uint8Array([0, 80, 0, 114, 0, 111, 0, 109, 0, 112, 0, 116]),
        ]);
        const undefinedHeaderComment = concat([
            new Uint8Array(8),
            textEncoder.encode('Undefined header prompt'),
        ]);
        const rawComment = textEncoder.encode('Raw prompt');

        await expect(parsePngChunksEnhanced(pngFile(
            pngChunk('eXIf', exifUserCommentBytes(unicodeComment, false)),
        ))).resolves.toMatchObject({ parameters: 'Prompt' });
        await expect(parsePngChunksEnhanced(pngFile(
            pngChunk('eXIf', exifUserCommentBytes(undefinedHeaderComment)),
        ))).resolves.toMatchObject({ parameters: 'Undefined header prompt' });
        await expect(parsePngChunksEnhanced(pngFile(
            pngChunk('eXIf', exifUserCommentBytes(rawComment)),
        ))).resolves.toMatchObject({ parameters: 'Raw prompt' });
    });

    it('should decompress compressed iTXt metadata with the supported deflate method', async () => {
        const compressedValue = Uint8Array.from(textEncoder.encode('Compressed iTXt Value'));
        const mockReader = stubDeflateResult([compressedValue]);

        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('iTXt', itxtCompressedData('CompressedKeyword')),
        ));

        expect(mockReader.read).toHaveBeenCalled();
        expect(chunks.CompressedKeyword).toBe('Compressed iTXt Value');
    });

    it('should skip compressed text chunks with unsupported compression methods', async () => {
        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('zTXt', concat([textEncoder.encode('z'), new Uint8Array([0, 1, 1, 2, 3])])),
            pngChunk('iTXt', concat([textEncoder.encode('i'), new Uint8Array([0, 1, 1, 0, 0, 1, 2, 3])])),
            pngChunk('tEXt', textEncoder.encode('NoNullSeparator')),
        ));

        expect(chunks.z).toBeUndefined();
        expect(chunks.i).toBeUndefined();
        expect(chunks.NoNullSeparator).toBeUndefined();
    });

    it('should preserve early text chunks and drop late chunks after the decoded aggregate budget', async () => {
        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('tEXt', textChunkData('early', 'ok')),
            pngChunk(
                'tEXt',
                repeatedTextChunkData('filler_a', MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2, 97),
            ),
            pngChunk(
                'tEXt',
                repeatedTextChunkData('filler_b', MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2 - 2, 98),
            ),
            pngChunk('tEXt', textChunkData('too_late', 'nope')),
            pngChunk('tEXt', textChunkData('after_limit', 'small')),
        ));

        expect(chunks.early).toBe('ok');
        expect(chunks.filler_a).toHaveLength(MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2);
        expect(chunks.too_late).toBeUndefined();
        expect(chunks.after_limit).toBeUndefined();
    });

    it('should drop late chunks after the raw aggregate metadata budget', async () => {
        const rawFiller = new Uint8Array(4 * 1024 * 1024);
        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('tEXt', textChunkData('early', 'ok')),
            ...Array.from({ length: 8 }, () => pngChunk('eXIf', rawFiller)),
            pngChunk('tEXt', textChunkData('too_late', 'nope')),
            pngChunk('tEXt', textChunkData('after_limit', 'nope')),
        ));

        expect(chunks.early).toBe('ok');
        expect(chunks.too_late).toBeUndefined();
        expect(chunks.after_limit).toBeUndefined();
    });

    it('should reject a single metadata chunk above the raw chunk limit', async () => {
        vi.stubGlobal('console', { warn: vi.fn(), error: vi.fn(), log: vi.fn() });
        const oversized = new Uint8Array(16 * 1024 * 1024 + 1);
        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('eXIf', oversized),
            pngChunk('tEXt', textChunkData('after', 'ok')),
        ));
        expect(chunks).toEqual({ after: 'ok' });
    });

    it('should scan non-empty iTXt language and translated keyword fields', async () => {
        const data = concat([
            textEncoder.encode('localized'),
            new Uint8Array([0, 0, 0]),
            textEncoder.encode('en'),
            new Uint8Array([0]),
            textEncoder.encode('Translated'),
            new Uint8Array([0]),
            textEncoder.encode('Localized value'),
        ]);
        await expect(parsePngChunksEnhanced(pngFile(pngChunk('iTXt', data))))
            .resolves.toMatchObject({ localized: 'Localized value' });
    });

    it('should cap uncompressed iTXt by the decoded aggregate budget', async () => {
        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('iTXt', itxtUncompressedData('early', 'ok')),
            pngChunk(
                'iTXt',
                repeatedItxtData('filler_a', MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2, 97),
            ),
            pngChunk(
                'iTXt',
                repeatedItxtData('filler_b', MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2 - 2, 98),
            ),
            pngChunk('iTXt', itxtUncompressedData('too_late', 'nope')),
        ));

        expect(chunks.early).toBe('ok');
        expect(chunks.filler_b).toHaveLength(MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2 - 2);
        expect(chunks.too_late).toBeUndefined();
    });

    it('should not decompress zTXt once no decoded text budget remains', async () => {
        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('tEXt', textChunkData('early', 'ok')),
            pngChunk(
                'tEXt',
                repeatedTextChunkData('filler_a', MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2, 97),
            ),
            pngChunk(
                'tEXt',
                repeatedTextChunkData('filler_b', MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2 - 2, 98),
            ),
            pngChunk('zTXt', ztxtData('too_late')),
        ));

        expect(chunks.early).toBe('ok');
        expect(chunks.too_late).toBeUndefined();
    });

    it('should reject tEXt whose decoded replacement text exceeds the aggregate budget', async () => {
        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('tEXt', textChunkData('early', 'ok')),
            pngChunk('tEXt', textChunkData('malformed', malformedUtf8OverDecodedBudget())),
        ));

        expect(chunks.early).toBe('ok');
        expect(chunks.malformed).toBeUndefined();
    });

    it('should reject uncompressed iTXt whose decoded replacement text exceeds the aggregate budget', async () => {
        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('iTXt', itxtUncompressedData('early', 'ok')),
            pngChunk('iTXt', itxtUncompressedData('malformed', malformedUtf8OverDecodedBudget())),
        ));

        expect(chunks.early).toBe('ok');
        expect(chunks.malformed).toBeUndefined();
    });

    it('should reject compressed zTXt after decoded replacement text exceeds the aggregate budget', async () => {
        const mockReader = stubDeflateResult([malformedUtf8OverDecodedBudget()]);

        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('tEXt', textChunkData('early', 'ok')),
            pngChunk('zTXt', ztxtData('malformed')),
        ));

        expect(mockReader.read).toHaveBeenCalled();
        expect(chunks.early).toBe('ok');
        expect(chunks.malformed).toBeUndefined();
    });

    it('should exhaust decoded budget after over-limit zTXt decompression', async () => {
        const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
        const mockReader = stubDeflateResult([oversized]);

        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('tEXt', textChunkData('early', 'ok')),
            pngChunk('zTXt', ztxtData('too_large')),
            pngChunk('zTXt', ztxtData('still_too_large')),
            pngChunk('tEXt', textChunkData('late', 'x')),
        ));

        expect(mockReader.cancel).toHaveBeenCalled();
        expect(chunks.early).toBe('ok');
        expect(chunks.too_large).toBeUndefined();
        expect(chunks.still_too_large).toBeUndefined();
        expect(chunks.late).toBeUndefined();
    });

    it('should skip malformed compressed chunks without null separators', async () => {
        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('zTXt', textEncoder.encode('missing-null')),
            pngChunk('iTXt', textEncoder.encode('missing-null')),
        ));
        expect(chunks).toEqual({});
    });

    it('should reject iTXt whose language fields run beyond the chunk payload', async () => {
        const malformed = concat([
            textEncoder.encode('key'),
            new Uint8Array([0, 0, 0]),
            textEncoder.encode('unterminated-language'),
        ]);
        await expect(parsePngChunksEnhanced(pngFile(pngChunk('iTXt', malformed))))
            .resolves.toEqual({});
    });

    it('should skip invalid compressed iTXt without exhausting the decoded budget', async () => {
        stubInvalidDeflate();
        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('iTXt', itxtCompressedData('invalid')),
            pngChunk('tEXt', textChunkData('late', 'yes')),
        ));
        expect(chunks).toEqual({ late: 'yes' });
    });

    it('should stop at an explicit IEND even when trailing bytes remain', async () => {
        const png = concat([
            new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            pngChunk('IEND'),
            pngChunk('tEXt', textChunkData('after-iend', 'ignored')),
        ]);
        await expect(parsePngChunksEnhanced(png)).resolves.toEqual({});
    });

    it('should ignore ordinary non-metadata PNG chunks', async () => {
        await expect(parsePngChunksEnhanced(pngFile(
            pngChunk('IDAT', new Uint8Array([1, 2, 3])),
        ))).resolves.toEqual({});
    });

    it('should exhaust decoded budget after over-limit compressed iTXt decompression', async () => {
        const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
        const mockReader = stubDeflateResult([oversized]);

        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('tEXt', textChunkData('early', 'ok')),
            pngChunk('iTXt', itxtCompressedData('too_large')),
            pngChunk('tEXt', textChunkData('late', 'x')),
        ));

        expect(mockReader.cancel).toHaveBeenCalled();
        expect(chunks.early).toBe('ok');
        expect(chunks.too_large).toBeUndefined();
        expect(chunks.late).toBeUndefined();
    });

    it('should skip invalid compressed text without exhausting decoded budget', async () => {
        stubInvalidDeflate();

        const chunks = await parsePngChunksEnhanced(pngFile(
            pngChunk('tEXt', textChunkData('early', 'ok')),
            pngChunk('zTXt', ztxtData('invalid_compressed')),
            pngChunk('tEXt', textChunkData('late', 'yes')),
        ));

        expect(chunks.early).toBe('ok');
        expect(chunks.invalid_compressed).toBeUndefined();
        expect(chunks.late).toBe('yes');
    });
});
