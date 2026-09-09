import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LibraryScopeDropdown } from '../ImageKindScopeDropdown';

const scopeCounts = {
    media: { all: 1200, image: 1175, video: 25 },
    imageKinds: { all: 1175, generated: 900, photograph: 250, other: 25 },
};

const renderScope = (overrides: Partial<React.ComponentProps<typeof LibraryScopeDropdown>> = {}) => {
    const props = {
        mediaType: 'all' as const,
        sourceKind: 'all' as const,
        displayedCount: 1200,
        scopeCounts,
        onMediaTypeChange: vi.fn(),
        onImageKindChange: vi.fn(),
        ...overrides,
    };
    render(<LibraryScopeDropdown {...props} />);
    return props;
};

describe('LibraryScopeDropdown', () => {
    it('keeps the selector label-only and abbreviates menu counts with exact accessible values', () => {
        renderScope({ scopeCounts: { ...scopeCounts, media: { ...scopeCounts.media, all: 211000 } } });
        const trigger = screen.getByRole('button', { name: /Library scope: All Media/ });
        expect(trigger.textContent).toBe('All Media');
        fireEvent.click(trigger);
        const allMedia = screen.getByRole('radio', { name: `All Media, ${(211000).toLocaleString()}` });
        expect(allMedia.textContent).toContain('211k');
        expect(screen.getByTitle((211000).toLocaleString()).textContent).toBe('211k');
    });

    it('groups media and image kind choices while focusing the effective scope', async () => {
        renderScope();

        const trigger = screen.getByRole('button', { name: 'Library scope: All Media, 1,200. Change library scope' });
        fireEvent.click(trigger);

        expect(screen.getByRole('radiogroup', { name: 'Media type' })).toBeTruthy();
        expect(screen.getByRole('radiogroup', { name: 'Image kind' })).toBeTruthy();
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'All Media, 1,200' })));
        expect(screen.getByRole('radio', { name: 'Photos, 250' })).toBeTruthy();
    });

    it('preserves the remembered kind for media changes and makes kind selection atomic', () => {
        const mediaChange = vi.fn();
        const kindChange = vi.fn();
        renderScope({ mediaType: 'video', sourceKind: 'photograph', onMediaTypeChange: mediaChange, onImageKindChange: kindChange });

        fireEvent.click(screen.getByRole('button', { name: 'Library scope: Videos, 25. Change library scope' }));
        fireEvent.click(screen.getByRole('radio', { name: 'Images, 1,175' }));
        expect(mediaChange).toHaveBeenCalledWith('image');
        expect(kindChange).not.toHaveBeenCalled();
    });

    it('labels the image-wide trigger as Images while retaining All Images in the menu', () => {
        renderScope({ mediaType: 'image', sourceKind: 'all' });

        const trigger = screen.getByRole('button', { name: 'Library scope: Images, 1,175. Change library scope' });
        fireEvent.click(trigger);
        expect(screen.getByRole('radio', { name: 'All Images, 1,175' })).toBeTruthy();
    });

    it('selects image kinds, returns focus, and supports Escape navigation', async () => {
        const kindChange = vi.fn();
        renderScope({ mediaType: 'image', sourceKind: 'photograph', onImageKindChange: kindChange });

        const trigger = screen.getByRole('button', { name: 'Library scope: Photos, 250. Change library scope' });
        fireEvent.click(trigger);
        const selected = screen.getByRole('radio', { name: 'Photos, 250' });
        await waitFor(() => expect(document.activeElement).toBe(selected));
        fireEvent.keyDown(selected, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Other, 25' }));
        fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
        expect(kindChange).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(trigger);

        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('radio', { name: 'Generated, 900' }));
        expect(kindChange).toHaveBeenCalledWith('generated');
        expect(document.activeElement).toBe(trigger);
    });

    it('uses neutral loading counts and hides only unavailable non-selected categories', () => {
        renderScope({
            mediaType: 'video',
            sourceKind: 'photograph',
            displayedCount: 7,
            scopeCounts: undefined,
            scopeAvailability: {
                media: { all: 1200, image: 1200, video: 0 },
                imageKinds: { all: 1200, generated: 1200, photograph: 0, other: 0 },
            },
        });

        const trigger = screen.getByRole('button', { name: 'Library scope: Videos, 7. Change library scope' });
        fireEvent.click(trigger);
        expect(screen.getByRole('radio', { name: 'All Media, —' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'Videos, 7' })).toBeTruthy();
        expect(screen.queryByRole('radio', { name: 'Other, —' })).toBeNull();
        expect(screen.getByRole('radio', { name: 'Photos, —' })).toBeTruthy();
    });

    it('does not reset keyboard focus when counts refresh while the menu is open', () => {
        const props = {
            mediaType: 'image' as const,
            sourceKind: 'all' as const,
            displayedCount: 1175,
            scopeCounts,
            onMediaTypeChange: vi.fn(),
            onImageKindChange: vi.fn(),
        };
        const { rerender } = render(<LibraryScopeDropdown {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Library scope: Images, 1,175. Change library scope' }));
        const allImages = screen.getByRole('radio', { name: 'All Images, 1,175' });
        fireEvent.keyDown(allImages, { key: 'ArrowUp' });
        const focusedOption = screen.getByRole('radio', { name: 'Videos, 25' });
        expect(document.activeElement).toBe(focusedOption);

        rerender(<LibraryScopeDropdown {...props} scopeCounts={{ ...scopeCounts, media: { ...scopeCounts.media, all: 1201 } }} />);
        expect(document.activeElement).toBe(focusedOption);
    });
});
