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
        onScopeChange: vi.fn(),
        ...overrides,
    };
    render(<LibraryScopeDropdown {...props} />);
    return props;
};

describe('LibraryScopeDropdown', () => {
    it('offers six explicit destinations as one single-choice menu', () => {
        renderScope({ mediaType: 'image', sourceKind: 'photograph' });
        fireEvent.click(screen.getByRole('button', { name: /Library scope: Photos/ }));

        expect(screen.getAllByRole('menuitemradio').map(option => option.getAttribute('aria-label'))).toEqual([
            'All Media, 1,200', 'All Images, 1,175', 'Videos, 25',
            'Generated Images, 900', 'Photos, 250', 'Other Images, 25',
        ]);
        expect(screen.queryAllByRole('group')).toHaveLength(0);
        expect(screen.getAllByRole('menuitemradio', { checked: true })).toEqual([
            screen.getByRole('menuitemradio', { name: 'Photos, 250' }),
        ]);
    });

    it('organizes one selection into media and image-kind sections without extra keyboard stops or dividers', () => {
        const props = {
            mediaType: 'all' as const, sourceKind: 'all' as const, displayedCount: 1200,
            scopeCounts, onScopeChange: vi.fn(),
        };
        const { rerender } = render(<LibraryScopeDropdown {...props} />);
        fireEvent.click(screen.getByRole('button', { name: /Library scope:/ }));

        const mediaHeading = screen.getByText('Media');
        const kindHeading = screen.getByText('Image Kind');
        const allMedia = screen.getByRole('menuitemradio', { name: 'All Media, 1,200' });
        const allImages = screen.getByRole('menuitemradio', { name: 'All Images, 1,175' });
        const videos = screen.getByRole('menuitemradio', { name: 'Videos, 25' });
        const generated = screen.getByRole('menuitemradio', { name: 'Generated Images, 900' });
        expect(mediaHeading.closest('button')).toBeNull();
        expect(kindHeading.closest('button')).toBeNull();
        expect(mediaHeading.compareDocumentPosition(allMedia) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(videos.compareDocumentPosition(kindHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(kindHeading.compareDocumentPosition(generated) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole('separator')).toBeNull();

        fireEvent.keyDown(allMedia, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(allImages);
        act(() => videos.focus());
        fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(generated);
        fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(videos);

        rerender(<LibraryScopeDropdown {...props} scopeAvailability={{
            ...scopeCounts, media: { ...scopeCounts.media, video: 0 },
        }} />);
        expect(screen.queryByRole('menuitemradio', { name: 'Videos, 25' })).toBeNull();
        expect(screen.queryByRole('separator')).toBeNull();
        expect(screen.getByText('Image Kind')).toBeTruthy();
        expect(screen.getAllByRole('menuitemradio', { checked: true })).toEqual([allMedia]);
    });

    it('keeps the image-kind heading with the first available subtype and omits an empty section', () => {
        const emptyKinds = { all: 0, generated: 0, photograph: 0, other: 0 };
        const props = {
            mediaType: 'all' as const, sourceKind: 'all' as const, displayedCount: 1200,
            scopeCounts, onScopeChange: vi.fn(),
        };
        const { rerender } = render(<LibraryScopeDropdown {...props} scopeAvailability={{
            ...scopeCounts, imageKinds: { ...emptyKinds, other: 25 },
        }} />);
        fireEvent.click(screen.getByRole('button', { name: /Library scope:/ }));
        const other = screen.getByRole('menuitemradio', { name: 'Other Images, 25' });
        expect(screen.getByText('Image Kind').compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole('menuitemradio', { name: 'Generated Images, 900' })).toBeNull();
        expect(screen.queryByRole('menuitemradio', { name: 'Photos, 250' })).toBeNull();

        const availability = { ...scopeCounts, imageKinds: emptyKinds };
        rerender(<LibraryScopeDropdown {...props} scopeAvailability={availability} />);
        expect(screen.queryByText('Image Kind')).toBeNull();
        expect(screen.getByText('Media')).toBeTruthy();
        expect(screen.getAllByRole('menuitemradio').map(option => option.getAttribute('aria-label'))).toEqual([
            'All Media, 1,200', 'All Images, 1,175', 'Videos, 25',
        ]);

        rerender(<LibraryScopeDropdown {...props} mediaType="image" sourceKind="photograph"
            scopeAvailability={availability} scopeCounts={{ ...scopeCounts, imageKinds: emptyKinds }} />);
        const selectedPhoto = screen.getByRole('menuitemradio', { name: 'Photos, 0' });
        expect(screen.getByText('Image Kind').compareDocumentPosition(selectedPhoto) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getAllByRole('menuitemradio', { checked: true })).toEqual([selectedPhoto]);
    });

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
                onScopeChange={vi.fn()} />;
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
        expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Other Images, 25' }));
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

    it('uses the settled photo total only for the active photo scope', () => {
        renderScope({ mediaType: 'image', sourceKind: 'photograph', displayedCount: 3, scopeCounts: undefined });
        fireEvent.click(screen.getByRole('button', { name: /Library scope: Photos, 3/ }));
        expect(screen.getByRole('menuitemradio', { name: 'Photos, 3' })).toBeTruthy();
        expect(screen.getByRole('menuitemradio', { name: 'All Media, —' })).toBeTruthy();
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

    it('focuses the effective scope on opening', async () => {
        renderScope();

        const trigger = screen.getByRole('button', { name: 'Library scope: All Media, 1,200. Change library scope' });
        fireEvent.click(trigger);

        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'All Media, 1,200' })));
        expect(screen.getByRole('menuitemradio', { name: 'Photos, 250' })).toBeTruthy();
    });

    it.each([
        ['All Media', 1200, 'all', 'all'], ['All Images', 1175, 'image', 'all'],
        ['Generated Images', 900, 'image', 'generated'], ['Photos', 250, 'image', 'photograph'],
        ['Other Images', 25, 'image', 'other'], ['Videos', 25, 'video', 'all'],
    ] as const)('selects %s atomically and uses its exact label and count', (label, count, mediaType, sourceKind) => {
        const onScopeChange = vi.fn();
        renderScope({ mediaType, sourceKind, onScopeChange });
        const trigger = screen.getByRole('button', { name: `Library scope: ${label}, ${count.toLocaleString()}. Change library scope` });
        expect(trigger.textContent).toBe(label);
        fireEvent.click(trigger);
        const option = screen.getByRole('menuitemradio', { name: `${label}, ${count.toLocaleString()}` });
        expect(screen.getAllByRole('menuitemradio', { checked: true })).toEqual([option]);
        fireEvent.click(option);
        expect(onScopeChange).toHaveBeenCalledExactlyOnceWith({ mediaType, sourceKind });
    });

    it.each(['all', 'video'] as const)('does not present a legacy dormant photo preference as active under %s', mediaType => {
        renderScope({ mediaType, sourceKind: 'photograph' });
        fireEvent.click(screen.getByRole('button', { name: /Library scope:/ }));
        expect(screen.getAllByRole('menuitemradio', { checked: true })).toHaveLength(1);
        expect(screen.getByRole('menuitemradio', { name: 'Photos, 250' }).getAttribute('aria-checked')).toBe('false');
        expect(screen.queryByText(/Images ·/)).toBeNull();
    });

    it('selects image kinds, returns focus, and supports Escape navigation', async () => {
        const scopeChange = vi.fn();
        renderScope({ mediaType: 'image', sourceKind: 'photograph', onScopeChange: scopeChange });

        const trigger = screen.getByRole('button', { name: 'Library scope: Photos, 250. Change library scope' });
        fireEvent.click(trigger);
        const selected = screen.getByRole('menuitemradio', { name: 'Photos, 250' });
        await waitFor(() => expect(document.activeElement).toBe(selected));
        fireEvent.keyDown(selected, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Other Images, 25' }));
        fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
        expect(scopeChange).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(trigger);

        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Generated Images, 900' }));
        expect(scopeChange).toHaveBeenCalledExactlyOnceWith({ mediaType: 'image', sourceKind: 'generated' });
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
        expect(screen.getByRole('menuitemradio', { name: 'All Images, —' })).toBeTruthy();
        expect(screen.queryByRole('menuitemradio', { name: 'Other Images, —' })).toBeNull();
        expect(screen.queryByRole('menuitemradio', { name: 'Photos, —' })).toBeNull();
    });

    it('does not reset keyboard focus when counts refresh while the menu is open', () => {
        const props = {
            mediaType: 'image' as const,
            sourceKind: 'all' as const,
            displayedCount: 1175,
            scopeCounts,
            onScopeChange: vi.fn(),
        };
        const { rerender } = render(<LibraryScopeDropdown {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Library scope: All Images, 1,175. Change library scope' }));
        const allImages = screen.getByRole('menuitemradio', { name: 'All Images, 1,175' });
        fireEvent.keyDown(allImages, { key: 'End' });
        const focusedOption = screen.getByRole('menuitemradio', { name: 'Other Images, 25' });
        expect(document.activeElement).toBe(focusedOption);

        rerender(<LibraryScopeDropdown {...props} scopeCounts={{ ...scopeCounts, media: { ...scopeCounts.media, all: 1201 } }} />);
        expect(document.activeElement).toBe(focusedOption);
    });

    it('retains both All options and the active photo scope in an empty library', () => {
        const emptyCounts = {
            media: { all: 0, image: 0, video: 0 },
            imageKinds: { all: 0, generated: 0, photograph: 0, other: 0 },
        };
        renderScope({ mediaType: 'image', sourceKind: 'photograph', scopeCounts: emptyCounts, scopeAvailability: emptyCounts });
        fireEvent.click(screen.getByRole('button', { name: /Library scope: Photos, 0/ }));
        expect(screen.getAllByRole('menuitemradio').map(option => option.getAttribute('aria-label'))).toEqual([
            'All Media, 0', 'All Images, 0', 'Photos, 0',
        ]);
        expect(screen.getAllByRole('menuitemradio', { checked: true })).toHaveLength(1);
    });

    it('keeps available categories visible when the surrounding search has zero results', () => {
        renderScope({
            scopeAvailability: scopeCounts,
            scopeCounts: {
                media: { all: 0, image: 0, video: 0 },
                imageKinds: { all: 0, generated: 0, photograph: 0, other: 0 },
            },
        });
        fireEvent.click(screen.getByRole('button', { name: /Library scope: All Media, 0/ }));
        expect(screen.getAllByRole('menuitemradio')).toHaveLength(6);
        expect(screen.getByRole('menuitemradio', { name: 'Photos, 0' })).toBeTruthy();
        expect(screen.getByRole('menuitemradio', { name: 'Videos, 0' })).toBeTruthy();
    });

    it('returns to the effective selection only when the focused category disappears', () => {
        const props = {
            mediaType: 'image' as const, sourceKind: 'photograph' as const, displayedCount: 250,
            scopeCounts, onScopeChange: vi.fn(),
        };
        const { rerender } = render(<LibraryScopeDropdown {...props} />);
        fireEvent.click(screen.getByRole('button', { name: /Library scope: Photos/ }));
        fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Other Images, 25' }));
        rerender(<LibraryScopeDropdown {...props} scopeAvailability={{ ...scopeCounts, imageKinds: { ...scopeCounts.imageKinds, other: 0 } }} />);
        expect(screen.queryByRole('menuitemradio', { name: 'Other Images, 25' })).toBeNull();
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
        expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Other Images, 25' }));
        fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'All Media, 1,200' }));
        fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
        fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
        fireEvent.keyDown(document.activeElement as Element, { key });
        expect(props.onScopeChange).toHaveBeenCalledExactlyOnceWith({ mediaType: 'all', sourceKind: 'all' });
        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('reaches count retry by arrow keys and prevents duplicate retries while loading', () => {
        const props = { mediaType: 'all' as const, sourceKind: 'all' as const, displayedCount: undefined,
            countsError: true, onRetryCounts: vi.fn(), onScopeChange: vi.fn() };
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

    it('keeps inactive-scope counts unknown while All Media has only a settled total', () => {
        renderScope({ mediaType: 'all', sourceKind: 'photograph', scopeCounts: undefined });
        fireEvent.click(screen.getByRole('button', { name: /Library scope:/ }));
        expect(screen.getByRole('menuitemradio', { name: 'All Media, 1,200' })).toBeTruthy();
        expect(screen.getByRole('menuitemradio', { name: 'Photos, —' })).toBeTruthy();
        expect(screen.getByRole('menuitemradio', { name: 'All Images, —' })).toBeTruthy();
    });

    it('All Images never restores an old subtype', () => {
        const props = renderScope({ mediaType: 'video', sourceKind: 'photograph' });
        fireEvent.click(screen.getByRole('button', { name: /Library scope:/ }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'All Images, 1,175' }));
        expect(props.onScopeChange).toHaveBeenCalledExactlyOnceWith({ mediaType: 'image', sourceKind: 'all' });
    });
});
