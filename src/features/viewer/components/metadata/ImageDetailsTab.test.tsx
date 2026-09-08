import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { GeneratorTool, type AIImage } from '../../../../types';
import { ImageDetailsTab } from './ImageDetailsTab';

describe('ImageDetailsTab', () => {
    it('keeps shared Details and supports manual kind correction and Automatic through a compact dropdown', async () => {
        const image: AIImage = {
            id: 'photo', url: 'photo.jpg', thumbnailUrl: 'photo.jpg', filename: 'photo.jpg',
            width: 4000, height: 3000, timestamp: 1, isFavorite: false, isPinned: false,
            sourceKind: 'photograph', detectedSourceKind: 'photograph',
            metadata: { tool: GeneratorTool.UNKNOWN, model: '', seed: 0, steps: 0, cfg: 0, sampler: '', positivePrompt: '', negativePrompt: '' },
        };
        const onSetImageKind = vi.fn();
        const props = {
            image, collections: [], notes: '', setNotes: vi.fn(),
            onSetImageKind, onSetCollectionMembership: vi.fn(), palette: [], isPaletteLoading: false,
        };
        const { rerender } = render(<ImageDetailsTab
            image={image} collections={[]} notes="" setNotes={vi.fn()}
            onSetImageKind={onSetImageKind} onSetCollectionMembership={props.onSetCollectionMembership}
            palette={[]} isPaletteLoading={false}
        />);
        expect(screen.queryByRole('heading', { name: 'Capture details' })).toBeNull();
        expect(screen.getByRole('heading', { name: 'Technical details' })).toBeTruthy();
        const selector = screen.getByRole('combobox', { name: 'Image kind' });
        expect(screen.queryByRole('radiogroup', { name: 'Image kind' })).toBeNull();
        fireEvent.change(selector, { target: { value: 'other' } });
        expect(onSetImageKind).toHaveBeenCalledWith('photo', 'other');
        await waitFor(() => expect(selector.hasAttribute('disabled')).toBe(false));
        rerender(<ImageDetailsTab {...props} image={{ ...image, sourceKindOverride: 'other' }} />);
        expect((selector as HTMLSelectElement).value).toBe('other');
        fireEvent.change(selector, { target: { value: 'automatic' } });
        expect(onSetImageKind).toHaveBeenCalledWith('photo', null);
        await waitFor(() => expect(selector.hasAttribute('disabled')).toBe(false));
        expect(screen.getByRole('textbox', { name: 'Notes' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Collections' })).toBeTruthy();
    });
});
