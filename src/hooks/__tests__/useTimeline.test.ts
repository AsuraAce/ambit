
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTimeline } from '../useTimeline';
import { AIImage } from '../../types';

describe('useTimeline', () => {
    // Fixed "now" date: Wednesday, Oct 25, 2023
    const MOCK_NOW = new Date(2023, 9, 25, 12, 0, 0).getTime();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(MOCK_NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const createMockImage = (id: string, timestamp: number, isPinned = false): AIImage => ({
        id,
        timestamp,
        isPinned,
        url: `url-${id}`,
        thumbnailUrl: `thumb-${id}`,
        filename: `file-${id}.png`,
        width: 100,
        height: 100,
        isFavorite: false,
        metadata: {} as any
    });

    it('should group images into Today and Yesterday', () => {
        const today = MOCK_NOW; // Oct 25
        const yesterday = MOCK_NOW - 86400000; // Oct 24

        const images = [
            createMockImage('1', today),
            createMockImage('2', yesterday),
        ];

        const { result } = renderHook(() => useTimeline(images));

        expect(result.current.groups).toHaveLength(2);
        expect(result.current.groups[0].date).toBe('Today');
        expect(result.current.groups[1].date).toBe('Yesterday');
    });

    it('should group images into specific days if within 30 days', () => {
        // Oct 20, 2023 (Friday)
        const specificDay = new Date(2023, 9, 20, 10, 0, 0).getTime();
        const images = [createMockImage('3', specificDay)];

        const { result } = renderHook(() => useTimeline(images));

        expect(result.current.groups[0].date).toContain('Friday');
        expect(result.current.groups[0].date).toContain('October 20');
    });

    it('should group images into months if older than 30 days', () => {
        // August 1, 2023
        const oldDay = new Date(2023, 7, 1, 10, 0, 0).getTime();
        const images = [createMockImage('4', oldDay)];

        const { result } = renderHook(() => useTimeline(images));

        expect(result.current.groups[0].date).toBe('August 2023');
        expect(result.current.groups[0].id).toBe('2023-7'); // JS months are 0-indexed
    });

    it('should prioritize pinned images within a group', () => {
        const today = MOCK_NOW;
        const images = [
            createMockImage('1', today, false), // Regular
            createMockImage('2', today, true),  // Pinned
            createMockImage('3', today, false), // Regular
        ];

        const { result } = renderHook(() => useTimeline(images, 'date_desc'));

        const groupImages = result.current.groups[0].images;
        expect(groupImages[0].id).toBe('2'); // Pinned first
    });

    it('should sort groups by timestamp descending', () => {
        const today = MOCK_NOW;
        const lastMonth = new Date(2023, 8, 1).getTime();

        const images = [
            createMockImage('old', lastMonth),
            createMockImage('new', today),
        ];

        const { result } = renderHook(() => useTimeline(images));

        expect(result.current.groups[0].date).toBe('Today');
        expect(result.current.groups[1].date).toBe('September 2023');
    });

    it.each([
        ['name_asc', ['alpha', 'beta']],
        ['name_desc', ['beta', 'alpha']],
        ['size_asc', ['alpha', 'beta']],
        ['size_desc', ['beta', 'alpha']],
        ['date_asc', ['alpha', 'beta']],
        ['date_desc', ['beta', 'alpha']],
    ] as const)('sorts images within a date group by %s', (sortOption, expectedIds) => {
        const alpha = {
            ...createMockImage('alpha', MOCK_NOW - 1000),
            filename: 'alpha.png',
            fileSize: undefined,
        };
        const beta = {
            ...createMockImage('beta', MOCK_NOW),
            filename: 'beta.png',
            fileSize: 20,
        };

        const { result } = renderHook(() => useTimeline([beta, alpha], sortOption));

        expect(result.current.groups[0].images.map(image => image.id)).toEqual(expectedIds);
    });

    it('keeps pinned images first even when their selected sort value is lower', () => {
        const pinned = { ...createMockImage('pinned', MOCK_NOW - 1000, true), filename: 'z.png' };
        const regular = { ...createMockImage('regular', MOCK_NOW, false), filename: 'a.png' };

        const { result } = renderHook(() => useTimeline([pinned, regular], 'name_asc'));

        expect(result.current.groups[0].images.map(image => image.id)).toEqual(['pinned', 'regular']);
    });

    it('treats missing file sizes as zero on both sort sides', () => {
        const first = { ...createMockImage('first', MOCK_NOW), fileSize: undefined };
        const second = { ...createMockImage('second', MOCK_NOW - 1), fileSize: undefined };

        expect(renderHook(() => useTimeline([first, second], 'size_asc')).result.current.groups[0].images).toHaveLength(2);
        expect(renderHook(() => useTimeline([first, second], 'size_desc')).result.current.groups[0].images).toHaveLength(2);
    });
});
