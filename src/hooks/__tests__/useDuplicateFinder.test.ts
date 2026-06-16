
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDuplicateFinder } from '../useDuplicateFinder';
import { AIImage } from '../../types';

describe('useDuplicateFinder', () => {
    const createMockImage = (id: string, seed: number, timestamp: number, fileSize = 1000, fileHash?: string, includeMetadata = true): AIImage => ({
        id,
        timestamp,
        fileSize,
        fileHash,
        url: `url-${id}`,
        thumbnailUrl: `thumb-${id}`,
        filename: `file-${id}.png`,
        width: 512,
        height: 512,
        isFavorite: false,
        metadata: includeMetadata ? {
            seed,
            positivePrompt: 'A cat holding a taco',
            negativePrompt: 'low quality',
            steps: 20,
            cfg: 7,
            sampler: 'Euler a',
            model: 'v1.5'
        } as any : undefined as any
    });

    const mockOnResolve = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should identify direct duplicates (same size, same metadata)', () => {
        const images = [
            createMockImage('1', 12345, 1000),
            createMockImage('2', 12345, 2000), // Same seed, same prompt
        ];

        const { result } = renderHook(() => useDuplicateFinder(images, mockOnResolve));

        expect(result.current.groups).toHaveLength(1);
        expect(result.current.groups[0].kind).toBe('likely');
        expect(result.current.groups[0].images).toHaveLength(2);
        expect(result.current.totalRedundantCount).toBe(1);
    });

    it('should treat an explicit zero seed as usable metadata', () => {
        const images = [
            createMockImage('1', 0, 1000),
            createMockImage('2', 0, 2000),
        ];
        images.forEach(image => {
            image.metadata.positivePrompt = '';
            image.metadata.negativePrompt = '';
        });

        const { result } = renderHook(() => useDuplicateFinder(images, mockOnResolve));

        expect(result.current.groups).toHaveLength(1);
        expect(result.current.groups[0].kind).toBe('likely');
    });

    it('should identify exact duplicates by file hash even without metadata', () => {
        const images = [
            createMockImage('C:/one/original.png', 0, 1000, 1000, 'abc123', false),
            createMockImage('C:/two/renamed.png', 0, 2000, 1000, 'abc123', false),
        ];

        const { result } = renderHook(() => useDuplicateFinder(images, mockOnResolve));

        expect(result.current.groups).toHaveLength(1);
        expect(result.current.groups[0].kind).toBe('exact');
        expect(result.current.groups[0].images.map(img => img.id)).toEqual([
            'C:/one/original.png',
            'C:/two/renamed.png'
        ]);
    });

    it('should not mark same dimensions and size as exact when hashes differ', () => {
        const images = [
            createMockImage('1', 12345, 1000, 1000, 'hash-a'),
            createMockImage('2', 12345, 2000, 1000, 'hash-b'),
        ];

        const { result } = renderHook(() => useDuplicateFinder(images, mockOnResolve));

        expect(result.current.groups).toHaveLength(1);
        expect(result.current.groups[0].kind).toBe('likely');
    });

    it('should not group sparse same-size images without a matching hash', () => {
        const images = [
            createMockImage('1', 0, 1000, 1000, 'hash-a', false),
            createMockImage('2', 0, 2000, 1000, 'hash-b', false),
        ];

        const { result } = renderHook(() => useDuplicateFinder(images, mockOnResolve));

        expect(result.current.groups).toHaveLength(0);
    });

    it('should NOT group images with different seeds', () => {
        const images = [
            createMockImage('1', 12345, 1000),
            createMockImage('2', 67890, 2000), // Different seed
        ];

        const { result } = renderHook(() => useDuplicateFinder(images, mockOnResolve));

        expect(result.current.groups).toHaveLength(0);
        expect(result.current.totalRedundantCount).toBe(0);
    });

    it('should handle bulk resolve (newest strategy)', () => {
        const images = [
            createMockImage('old', 123, 1000, 1000, 'bulk-hash'), // Oldest
            createMockImage('mid', 123, 2000, 1000, 'bulk-hash'),
            createMockImage('new', 123, 3000, 1000, 'bulk-hash'), // Newest
        ];

        const { result } = renderHook(() => useDuplicateFinder(images, mockOnResolve));

        act(() => {
            result.current.handleBulkResolve('newest');
        });

        // Current implementation calls onResolve('bulk', deleteIds)
        expect(mockOnResolve).toHaveBeenCalledWith('bulk', expect.arrayContaining(['old', 'mid']));
        expect(mockOnResolve).toHaveBeenCalledWith('bulk', expect.not.arrayContaining(['new']));
    });

    it('should handle bulk resolve (oldest strategy)', () => {
        const images = [
            createMockImage('old', 123, 1000, 1000, 'bulk-hash'), // Oldest
            createMockImage('new', 123, 3000, 1000, 'bulk-hash'), // Newest
        ];

        const { result } = renderHook(() => useDuplicateFinder(images, mockOnResolve));

        act(() => {
            result.current.handleBulkResolve('oldest');
        });

        expect(mockOnResolve).toHaveBeenCalledWith('bulk', expect.arrayContaining(['new']));
        expect(mockOnResolve).toHaveBeenCalledWith('bulk', expect.not.arrayContaining(['old']));
    });

    it('should exclude likely duplicates from bulk resolve', () => {
        const images = [
            createMockImage('old', 123, 1000),
            createMockImage('new', 123, 3000),
        ];

        const { result } = renderHook(() => useDuplicateFinder(images, mockOnResolve));

        act(() => {
            result.current.handleBulkResolve('oldest');
        });

        expect(result.current.groups[0].kind).toBe('likely');
        expect(mockOnResolve).not.toHaveBeenCalled();
    });

    it('should filter out already resolved groups', () => {
        const images = [
            createMockImage('1', 123, 1000),
            createMockImage('2', 123, 2000),
        ];

        const { result } = renderHook(() => useDuplicateFinder(images, mockOnResolve));
        expect(result.current.groups).toHaveLength(1);

        act(() => {
            result.current.handleResolve(result.current.groups[0].id, '1', ['1', '2']);
        });

        expect(result.current.groups).toHaveLength(0);
    });
});
