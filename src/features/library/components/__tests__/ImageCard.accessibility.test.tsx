import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '../../../../test/testUtils';
import { GeneratorTool, type AIImage } from '../../../../types';
import { ImageCard } from '../ImageCard';

vi.mock('../SmartImage', () => ({
    SmartImage: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

const favoriteImage: AIImage = {
    id: 'favorite-image',
    url: 'asset://favorite-image.png',
    thumbnailUrl: 'asset://favorite-image.webp',
    filename: 'favorite-image.png',
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

const renderCard = (onToggleFavorite = vi.fn(), onToggleSelection = vi.fn()) => render(
    <ImageCard
        image={favoriteImage}
        isSelected={false}
        onClick={vi.fn()}
        onToggleSelection={onToggleSelection}
        onToggleFavorite={onToggleFavorite}
        onTogglePin={vi.fn()}
    />
);

describe('ImageCard keyboard actions', () => {
    it('reveals each newly focusable control when keyboard focus reaches it', () => {
        renderCard();

        const selectionButton = screen.getByRole('button', { name: 'Select Image' });
        expect(selectionButton.className).toContain('focus-visible:opacity-100');
        expect(selectionButton.className).toContain('focus-visible:scale-100');

        const favoriteButton = screen.getByRole('button', { name: 'Remove from Favorites' });
        const overlay = favoriteButton.closest('.absolute.inset-0');
        const toolbar = favoriteButton.closest('.flex.justify-between.items-end');

        expect(overlay?.className).toContain('focus-within:opacity-100');
        expect(toolbar?.className).toContain('focus-within:translate-y-0');

        act(() => favoriteButton.focus());
        expect(document.activeElement).toBe(favoriteButton);
        expect(screen.getByRole('tooltip').textContent).toBe('Remove from Favorites');
    });

    it('keeps the favorite badge as status and exposes only one favorite toggle', () => {
        const onToggleFavorite = vi.fn();
        renderCard(onToggleFavorite);

        const status = screen.getByRole('img', { name: 'Favorite' });
        expect(status.tagName).toBe('DIV');
        expect(status.getAttribute('tabindex')).toBeNull();

        const favoriteButtons = screen.getAllByRole('button', { name: 'Remove from Favorites' });
        expect(favoriteButtons).toHaveLength(1);

        fireEvent.click(favoriteButtons[0]);
        expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    });

    it('isolates selection activation keys from global shortcuts without changing its click action', () => {
        const onToggleSelection = vi.fn();
        const onWindowKeyDown = vi.fn();
        window.addEventListener('keydown', onWindowKeyDown);

        try {
            renderCard(vi.fn(), onToggleSelection);

            const selectionButton = screen.getByRole('button', { name: 'Select Image' });
            fireEvent.keyDown(selectionButton, { key: 'Enter' });
            fireEvent.keyDown(selectionButton, { key: ' ' });

            expect(onWindowKeyDown).not.toHaveBeenCalled();

            fireEvent.click(selectionButton);
            expect(onToggleSelection).toHaveBeenCalledTimes(1);
        } finally {
            window.removeEventListener('keydown', onWindowKeyDown);
        }
    });
});
