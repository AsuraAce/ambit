
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useFiltering } from '../useFiltering';
import { AIImage } from '../../types';

describe('useFiltering', () => {
    const mockImages: AIImage[] = [
        {
            id: '1',
            timestamp: 100,
            url: 'url1',
            thumbnailUrl: 'thumb1',
            filename: 'img1.png',
            width: 100,
            height: 100,
            isFavorite: false,
            metadata: {
                positivePrompt: 'A beautiful sunset, warm colors, masterpiece',
                steps: 20,
                cfg: 7,
                sampler: 'Euler a',
                model: 'Stable Diffusion XL'
            } as any
        }
    ];

    it('should initialize with default filters', () => {
        const { result } = renderHook(() => useFiltering(mockImages, [], false, 'blur', []));

        expect(result.current.filters.searchQuery).toBe('');
        expect(result.current.filters.models).toEqual([]);
        expect(result.current.sortOption).toBe('date_desc');
    });

    it('should update filters correctly', () => {
        const { result } = renderHook(() => useFiltering(mockImages, [], false, 'blur', []));

        act(() => {
            result.current.setFilters(prev => ({ ...prev, searchQuery: 'cat' }));
        });

        expect(result.current.filters.searchQuery).toBe('cat');
    });

    it('should clear all filters correctly', () => {
        const { result } = renderHook(() => useFiltering(mockImages, [], false, 'blur', []));

        act(() => {
            result.current.setFilters(prev => ({ ...prev, searchQuery: 'cat', favoritesOnly: true }));
            result.current.clearAllFilters();
        });

        expect(result.current.filters.searchQuery).toBe('');
        expect(result.current.filters.favoritesOnly).toBe(false);
    });

    it('should compute available tags from image set (comma-separated)', () => {
        const { result } = renderHook(() => useFiltering(mockImages, [], false, 'blur', []));

        expect(result.current.availableTags).toContain('a beautiful sunset');
        expect(result.current.availableTags).toContain('warm colors');
        expect(result.current.availableTags).toContain('masterpiece');
    });

    it('ignores non-string, short, and oversized prompt tags', () => {
        const variants = [
            { ...mockImages[0], metadata: { ...mockImages[0].metadata, positivePrompt: 42 as unknown as string } },
            { ...mockImages[0], id: '2', metadata: { ...mockImages[0].metadata, positivePrompt: 'a, this prompt token is deliberately much longer than forty characters' } },
        ];
        const { result } = renderHook(() => useFiltering(variants, [], false, 'blur', []));

        expect(result.current.availableTags).toEqual([]);
    });

    it('should reflect SQL where clause changes when filters change', () => {
        const { result, rerender } = renderHook(
            ({ privacy }) => useFiltering(mockImages, [], privacy, 'blur', []),
            { initialProps: { privacy: false } }
        );

        const initialClause = result.current.activeSqlWhere;

        act(() => {
            result.current.setFilters(prev => ({ ...prev, favoritesOnly: true }));
        });

        expect(result.current.activeSqlWhere).not.toBe(initialClause);
        expect(result.current.activeSqlWhere).toContain('is_favorite = 1');
    });
});
