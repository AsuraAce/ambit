import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LibraryScopeDropdown } from '../ImageKindScopeDropdown';
import { useGlobalShortcuts } from '../../../../hooks/useGlobalShortcuts';
import { GeneratorTool, type AIImage } from '../../../../types';

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
    it('owns its keyboard actions without triggering gallery navigation or opening the selected image', () => {
        const actions = {
            setSelectedImageIndex: vi.fn(), setSelectedIds: vi.fn(), setLastSelectedId: vi.fn(), clearSelection: vi.fn(),
            handleBulkDelete: vi.fn(), togglePrivacyMode: vi.fn(), toggleMasking: vi.fn(), toggleFavorite: vi.fn(),
            togglePin: vi.fn(), openCollection: vi.fn(), openSettings: vi.fn(), openImport: vi.fn(),
            closeAllModals: vi.fn(), toggleShortcuts: vi.fn(), toggleCommandPalette: vi.fn(),
        };
        const selected: AIImage = {
            id: 'selected', url: 'sample.png', thumbnailUrl: 'sample-thumb.png', filename: 'sample.png', timestamp: 1, width: 512, height: 512, isFavorite: false,
            metadata: { tool: GeneratorTool.UNKNOWN, model: '', seed: 0, steps: 0, cfg: 0, sampler: '', positivePrompt: '', negativePrompt: '' },
        };
        const navigate = vi.fn(() => 0);
        const Harness = () => {
            useGlobalShortcuts({ ...actions, viewMode: 'grid', selectedIds: new Set(['selected']), filteredImages: [selected],
                lastSelectedId: 'selected', isViewerOpen: false, isModalOpen: false, searchInputRef: { current: null },
                gridRef: { current: { navigate, scrollToItem: vi.fn() } } });
            return <LibraryScopeDropdown mediaType="all" sourceKind="all" displayedCount={1200} scopeCounts={scopeCounts}
                onMediaTypeChange={vi.fn()} onImageKindChange={vi.fn()} />;
        };
        render(<Harness />);
        const trigger = screen.getByRole('button', { name: /Library scope:/ });
        for (const key of ['Enter', ' ']) {
            fireEvent.keyDown(trigger, { key });
            expect(actions.setSelectedImageIndex).not.toHaveBeenCalled();
        }
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
            fireEvent.keyDown(document.activeElement as Element, { key });
        }
        expect(navigate).not.toHaveBeenCalled();
        for (const key of ['Enter', ' ']) {
            if (!screen.queryByRole('menu')) fireEvent.click(trigger);
            fireEvent.keyDown(document.activeElement as Element, { key });
            expect(actions.setSelectedImageIndex).not.toHaveBeenCalled();
        }
        expect(actions.setSelectedIds).not.toHaveBeenCalled();
    });

    it('opens as a menu with arrow endpoints and closes when keyboard focus leaves', () => {
        renderScope({ mediaType: 'image', sourceKind: 'photograph' });
        const trigger = screen.getByRole('button', { name: /Library scope: Photos/ });
        expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        const menu = screen.getByRole('menu', { name: 'Choose library scope' });
        expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'All Media, 1,200' }));
        fireEvent.keyDown(menu, { key: 'Tab' });
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.keyDown(trigger, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Other, 25' }));
        fireEvent.keyDown(document.activeElement as Element, { key: 'Tab', shiftKey: true });
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('keeps unknown counts unknown and offers a keyboard-accessible count-only retry', () => {
        const retry = vi.fn();
        renderScope({ displayedCount: undefined, scopeCounts: undefined, countsError: true, onRetryCounts: retry });
        const trigger = screen.getByRole('button', { name: /Library scope: All Media, —/ });
        fireEvent.click(trigger);
        expect(screen.getByRole('menuitemradio', { name: 'Photos, —' })).toBeTruthy();
        expect(screen.getByText('Counts unavailable')).toBeTruthy();
        const retryButton = screen.getByRole('menuitem', { name: 'Retry counts' });
        retryButton.focus();
        fireEvent.keyDown(retryButton, { key: 'Escape' });
        expect(document.activeElement).toBe(trigger);
        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Retry counts' }));
        expect(retry).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(trigger);
    });

    it('uses the settled photo total only for actions that restore the effective photo scope', () => {
        renderScope({ mediaType: 'image', sourceKind: 'photograph', displayedCount: 3, scopeCounts: undefined });
        fireEvent.click(screen.getByRole('button', { name: /Library scope: Photos, 3/ }));
        expect(screen.getByRole('menuitemradio', { name: 'Photos, 3' })).toBeTruthy();
        expect(screen.getByRole('menuitemradio', { name: 'Images · Photos, 3' })).toBeTruthy();
        expect(screen.getByRole('menuitemradio', { name: 'All Images, —' })).toBeTruthy();
    });
    it('keeps the selector label-only and abbreviates menu counts with exact accessible values', () => {
        renderScope({ scopeCounts: { ...scopeCounts, media: { ...scopeCounts.media, all: 211000 } } });
        const trigger = screen.getByRole('button', { name: /Library scope: All Media/ });
        expect(trigger.textContent).toBe('All Media');
        fireEvent.click(trigger);
        const allMedia = screen.getByRole('menuitemradio', { name: `All Media, ${(211000).toLocaleString()}` });
        expect(allMedia.textContent).toContain('211k');
        expect(screen.getByTitle((211000).toLocaleString()).textContent).toBe('211k');
    });

    it('groups media and image kind choices while focusing the effective scope', async () => {
        renderScope();

        const trigger = screen.getByRole('button', { name: 'Library scope: All Media, 1,200. Change library scope' });
        fireEvent.click(trigger);

        expect(screen.getByRole('group', { name: 'Media type' })).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Image kind' })).toBeTruthy();
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'All Media, 1,200' })));
        expect(screen.getByRole('menuitemradio', { name: 'Photos, 250' })).toBeTruthy();
    });

    it('preserves the remembered kind for media changes and makes kind selection atomic', () => {
        const mediaChange = vi.fn();
        const kindChange = vi.fn();
        renderScope({ mediaType: 'video', sourceKind: 'photograph', onMediaTypeChange: mediaChange, onImageKindChange: kindChange });

        fireEvent.click(screen.getByRole('button', { name: 'Library scope: Videos, 25. Change library scope' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Images · Photos, 250' }));
        expect(mediaChange).toHaveBeenCalledWith('image');
        expect(kindChange).not.toHaveBeenCalled();
    });

    it.each([
        ['photograph', 'Photos', 250], ['generated', 'Generated', 900], ['other', 'Other', 25],
    ] as const)('describes the remembered %s action without showing it as active', (sourceKind, label, count) => {
        renderScope({ mediaType: 'all', sourceKind });
        fireEvent.click(screen.getByRole('button', { name: /Library scope: All Media/ }));
        const images = screen.getByRole('menuitemradio', { name: `Images · ${label}, ${count}` });
        expect(images.getAttribute('aria-checked')).toBe('false');
        expect(screen.getByRole('menuitemradio', { name: `${label}, ${count}` }).getAttribute('aria-checked')).toBe('false');
    });

    it('labels the image-wide trigger as Images while retaining All Images in the menu', () => {
        renderScope({ mediaType: 'image', sourceKind: 'all' });

        const trigger = screen.getByRole('button', { name: 'Library scope: Images, 1,175. Change library scope' });
        fireEvent.click(trigger);
        expect(screen.getByRole('menuitemradio', { name: 'All Images, 1,175' })).toBeTruthy();
    });

    it('selects image kinds, returns focus, and supports Escape navigation', async () => {
        const kindChange = vi.fn();
        renderScope({ mediaType: 'image', sourceKind: 'photograph', onImageKindChange: kindChange });

        const trigger = screen.getByRole('button', { name: 'Library scope: Photos, 250. Change library scope' });
        fireEvent.click(trigger);
        const selected = screen.getByRole('menuitemradio', { name: 'Photos, 250' });
        await waitFor(() => expect(document.activeElement).toBe(selected));
        fireEvent.keyDown(selected, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Other, 25' }));
        fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
        expect(kindChange).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(trigger);

        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Generated, 900' }));
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
        expect(screen.getByRole('menuitemradio', { name: 'All Media, —' })).toBeTruthy();
        expect(screen.getByRole('menuitemradio', { name: 'Videos, 7' })).toBeTruthy();
        expect(screen.queryByRole('menuitemradio', { name: 'Other, —' })).toBeNull();
        expect(screen.getByRole('menuitemradio', { name: 'Photos, —' })).toBeTruthy();
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
        const allImages = screen.getByRole('menuitemradio', { name: 'All Images, 1,175' });
        fireEvent.keyDown(allImages, { key: 'ArrowUp' });
        const focusedOption = screen.getByRole('menuitemradio', { name: 'Videos, 25' });
        expect(document.activeElement).toBe(focusedOption);

        rerender(<LibraryScopeDropdown {...props} scopeCounts={{ ...scopeCounts, media: { ...scopeCounts.media, all: 1201 } }} />);
        expect(document.activeElement).toBe(focusedOption);
    });

    it('returns to the effective selection only when the focused category disappears', () => {
        const props = {
            mediaType: 'image' as const, sourceKind: 'photograph' as const, displayedCount: 250,
            scopeCounts, onMediaTypeChange: vi.fn(), onImageKindChange: vi.fn(),
        };
        const { rerender } = render(<LibraryScopeDropdown {...props} />);
        fireEvent.click(screen.getByRole('button', { name: /Library scope: Photos/ }));
        fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
        expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Other, 25' }));
        rerender(<LibraryScopeDropdown {...props} scopeAvailability={{ ...scopeCounts, imageKinds: { ...scopeCounts.imageKinds, other: 0 } }} />);
        expect(screen.queryByRole('menuitemradio', { name: 'Other, 25' })).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Photos, 250' }));
    });

    it('dismisses on outside focus or pointer without stealing focus', () => {
        renderScope();
        const outside = document.createElement('button');
        document.body.append(outside);
        try {
            const trigger = screen.getByRole('button', { name: /Library scope:/ });
            fireEvent.click(trigger);
            act(() => outside.focus());
            expect(screen.queryByRole('menu')).toBeNull();
            expect(document.activeElement).toBe(outside);
            fireEvent.click(trigger);
            fireEvent.pointerDown(outside);
            act(() => outside.focus());
            expect(screen.queryByRole('menu')).toBeNull();
            expect(document.activeElement).toBe(outside);
        } finally {
            outside.remove();
        }
    });

    it.each(['Enter', ' '])('supports arrow wrapping, Home/End and %s activation', key => {
        const props = renderScope();
        const trigger = screen.getByRole('button', { name: /Library scope:/ });
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Other, 25' }));
        fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'All Media, 1,200' }));
        fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
        fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
        fireEvent.keyDown(document.activeElement as Element, { key });
        expect(props.onMediaTypeChange).toHaveBeenCalledExactlyOnceWith('all');
        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('reaches count retry by arrow keys and prevents duplicate retries while loading', () => {
        const props = { mediaType: 'all' as const, sourceKind: 'all' as const, displayedCount: undefined,
            countsError: true, onRetryCounts: vi.fn(), onMediaTypeChange: vi.fn(), onImageKindChange: vi.fn() };
        const { rerender } = render(<LibraryScopeDropdown {...props} countsLoading />);
        const trigger = screen.getByRole('button', { name: /Library scope:/ });
        fireEvent.keyDown(trigger, { key: 'ArrowUp' });
        const retry = screen.getByRole('menuitem', { name: 'Retry counts' });
        expect(document.activeElement).toBe(retry);
        fireEvent.keyDown(retry, { key: 'Enter' });
        expect(props.onRetryCounts).not.toHaveBeenCalled();
        rerender(<LibraryScopeDropdown {...props} countsLoading={false} />);
        expect(document.activeElement).toBe(retry);
        fireEvent.keyDown(retry, { key: 'Enter' });
        expect(props.onRetryCounts).toHaveBeenCalledTimes(1);
    });

    it('keeps the remembered-scope count unknown while All Media has only a settled total', () => {
        renderScope({ mediaType: 'all', sourceKind: 'photograph', scopeCounts: undefined });
        fireEvent.click(screen.getByRole('button', { name: /Library scope:/ }));
        expect(screen.getByRole('menuitemradio', { name: 'All Media, 1,200' })).toBeTruthy();
        expect(screen.getByRole('menuitemradio', { name: 'Images · Photos, —' })).toBeTruthy();
        expect(screen.getByRole('menuitemradio', { name: 'All Images, —' })).toBeTruthy();
    });

    it('All Images explicitly clears the remembered kind', () => {
        const props = renderScope({ mediaType: 'video', sourceKind: 'photograph' });
        fireEvent.click(screen.getByRole('button', { name: /Library scope:/ }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'All Images, 1,175' }));
        expect(props.onImageKindChange).toHaveBeenCalledExactlyOnceWith('all');
    });
});
