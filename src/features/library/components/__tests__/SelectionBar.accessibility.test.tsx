import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { GeneratorTool, type AIImage } from '../../../../types';
import { useSettingsStore } from '../../../../stores/settingsStore';
import { SelectionBar } from '../SelectionBar';

const createImage = (id: string): AIImage => ({
    id,
    url: `asset://${id}.png`,
    thumbnailUrl: `asset://${id}.webp`,
    filename: `${id}.png`,
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: true,
    isPinned: true,
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
});

describe('SelectionBar tooltips', () => {
    beforeEach(() => {
        useSettingsStore.setState(useSettingsStore.getInitialState(), true);
        useSettingsStore.setState({ privacyEnabled: false });
    });

    it('describes bulk actions, forwards pressed state, and preserves callbacks', () => {
        const onCompare = vi.fn();
        const onToggleFavorite = vi.fn();
        const images = [createImage('one'), createImage('two')];

        render(
            <SelectionBar
                selectedIds={new Set(images.map(image => image.id))}
                filteredImages={images}
                lastSelectedId="two"
                isExporting={false}
                confirmDelete
                maskedKeywords={[]}
                onClearSelection={vi.fn()}
                onDelete={vi.fn()}
                onExport={vi.fn()}
                onAddToCollection={vi.fn()}
                activeCollectionId="collection-1"
                onRemoveFromCollection={vi.fn()}
                onToggleFavorite={onToggleFavorite}
                onTogglePin={vi.fn()}
                onToggleMask={vi.fn()}
                onCompare={onCompare}
            />
        );

        const compareButton = screen.getByRole('button', { name: 'Compare Selected Images' });
        expect(compareButton.getAttribute('title')).toBeNull();
        fireEvent.focus(compareButton);
        expect(screen.getByRole('tooltip').textContent).toBe('Compare Selected Images');
        fireEvent.click(compareButton);
        expect(onCompare).toHaveBeenCalledTimes(1);

        const favoriteButton = screen.getByRole('button', { name: 'Remove Selected from Favorites' });
        expect(favoriteButton.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(favoriteButton);
        expect(onToggleFavorite).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Unpin Selected Images' }).getAttribute('aria-pressed')).toBe('true');

        for (const button of screen.getAllByRole('button')) {
            expect(button.className).toContain('focus-visible:ring-2');
        }
        expect(screen.getByRole('button', { name: 'Clear Selection' }).getAttribute('title')).toBeNull();
    });
});
