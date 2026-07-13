import { act, renderHook } from '../../../../test/testUtils';
import { describe, expect, it } from 'vitest';
import type { AIImage } from '../../../../types';
import { useTimelineLayout } from '../useTimelineLayout';

const image = (id: string) => ({ id } as AIImage);

describe('useTimelineLayout', () => {
    it('returns an empty layout for an unmeasured container', () => {
        const { result } = renderHook(() => useTimelineLayout({
            groups: [{ id: 'one', date: 'Today', images: [image('one')] }],
            width: 0,
            thumbnailSize: 100,
            scrollTop: 0,
        }));

        expect(result.current).toMatchObject({
            layoutItems: [],
            headers: [],
            visibleItems: [],
            totalHeight: 0,
            activeHeaderData: null,
        });
    });

    it('builds rows and virtualizes a deep scroll window with binary search', () => {
        const groups = Array.from({ length: 40 }, (_, groupIndex) => ({
            id: `group-${groupIndex}`,
            date: `Group ${groupIndex}`,
            images: Array.from({ length: 12 }, (_, imageIndex) => image(`${groupIndex}-${imageIndex}`)),
        }));
        const { result } = renderHook(() => useTimelineLayout({
            groups,
            width: 320,
            thumbnailSize: 100,
            scrollTop: 8000,
        }));

        expect(result.current.layoutItems.length).toBeGreaterThan(result.current.visibleItems.length);
        expect(result.current.visibleItems[0].y).toBeGreaterThan(0);
        expect(result.current.visibleItems.at(-1)?.y).toBeGreaterThan(8000 + window.innerHeight);
        expect(result.current.headers).toHaveLength(40);
        expect(result.current.layoutItems.some(item => item.type === 'row' && item.items?.length === 2)).toBe(true);

        act(() => result.current.setActiveHeaderData({ date: 'Group 20', count: 12 }));
        expect(result.current.activeHeaderData).toEqual({ date: 'Group 20', count: 12 });
        result.current.activeHeaderIdRef.current = 'group-20';
        expect(result.current.activeHeaderIdRef.current).toBe('group-20');
    });
});
