import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { GeneratorTool, type AIImage } from '../../../../types';
import { ViewerToolbar } from '../ViewerToolbar';

const image: AIImage = {
    id: 'viewer-image',
    url: 'asset://viewer-image.png',
    thumbnailUrl: 'asset://viewer-image.webp',
    filename: 'viewer-image.png',
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: true,
    isPinned: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: 'Unknown',
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: '',
        negativePrompt: '',
    },
};

describe('ViewerToolbar tooltips', () => {
    it('uses next-action labels and state semantics without native titles', () => {
        const onToggleFavorite = vi.fn();
        const onToggleSidebar = vi.fn();

        render(
            <ViewerToolbar
                image={image}
                versionsCount={1}
                activeVersionIndex={0}
                showControls
                isTheaterMode={false}
                isSidebarOpen
                onCopy={vi.fn()}
                onOpenExternal={vi.fn()}
                onToggleTheater={vi.fn()}
                onShare={vi.fn()}
                onToggleFavorite={onToggleFavorite}
                onTogglePin={vi.fn()}
                onDelete={vi.fn()}
                onToggleSidebar={onToggleSidebar}
                onClose={vi.fn()}
            />
        );

        const favoriteButton = screen.getByRole('button', { name: 'Remove from Favorites (F)' });
        expect(favoriteButton.getAttribute('aria-pressed')).toBe('true');
        expect(favoriteButton.getAttribute('title')).toBeNull();
        expect(favoriteButton.closest('.absolute.top-0')?.className).toContain('focus-within:opacity-100');
        fireEvent.focus(favoriteButton);
        expect(screen.getByRole('tooltip').textContent).toBe('Remove from Favorites (F)');
        fireEvent.click(favoriteButton);
        expect(onToggleFavorite).toHaveBeenCalledTimes(1);

        const sidebarButton = screen.getByRole('button', { name: 'Hide Sidebar (I)' });
        expect(sidebarButton.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(sidebarButton);
        expect(onToggleSidebar).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Close Viewer (Esc)' }).getAttribute('title')).toBeNull();
    });
});
