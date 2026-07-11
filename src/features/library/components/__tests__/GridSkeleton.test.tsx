import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GridSkeleton } from '../GridSkeleton';

describe('GridSkeleton', () => {
    afterEach(() => vi.restoreAllMocks());

    it('renders stable randomized masonry placeholders by default', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const { container, rerender } = render(<GridSkeleton />);
        const root = container.firstElementChild as HTMLElement;
        expect(root.children).toHaveLength(24);
        expect((root.children[0] as HTMLElement).style.height).toBe('300px');
        expect((root.children[1] as HTMLElement).style.animationDelay).toBe('50ms');

        rerender(<GridSkeleton />);
        expect((root.children[0] as HTMLElement).style.height).toBe('300px');
    });

    it('renders justified placeholders with width and growth', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.25);
        const { container } = render(<GridSkeleton layout="justified" />);
        const item = container.firstElementChild?.children[0] as HTMLElement;
        expect(item.style.width).toBe('250px');
        expect(item.style.flexGrow).toBe('0.75');
    });

    it('renders fixed square placeholders for grid layout', () => {
        const { container } = render(<GridSkeleton layout="grid" />);
        const root = container.firstElementChild as HTMLElement;
        expect(root.children).toHaveLength(24);
        expect(root.children[0].className).toContain('aspect-square');
    });
});
