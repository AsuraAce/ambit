import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { CollectionContextMenu } from '../CollectionContextMenu';

const createProps = () => ({
    x: 20,
    y: 20,
    collectionId: 'collection-1',
    onClose: vi.fn(),
    onRename: vi.fn(),
    onToggleArchive: vi.fn(),
    onTogglePin: vi.fn(),
    onDelete: vi.fn(),
    onPlaySlideshow: vi.fn(),
    onExport: vi.fn(),
    onResetThumbnail: vi.fn(),
    onColorChange: vi.fn(),
});

describe('CollectionContextMenu quick actions', () => {
    it('uses shared tooltips and exposes current pin and archive state', () => {
        const props = createProps();
        const { rerender } = render(
            <CollectionContextMenu {...props} isPinned={true} isArchived={true} />
        );

        const slideshowButton = screen.getByRole('button', { name: 'Play Slideshow' });
        const pinButton = screen.getByRole('button', { name: 'Unpin collection' });
        const archiveButton = screen.getByRole('button', { name: 'Unarchive' });
        expect(pinButton.getAttribute('aria-pressed')).toBe('true');
        expect(archiveButton.getAttribute('aria-pressed')).toBe('true');
        expect(slideshowButton.getAttribute('title')).toBeNull();
        expect(pinButton.getAttribute('title')).toBeNull();

        fireEvent.focus(slideshowButton);
        expect(screen.getByRole('tooltip').textContent).toBe('Play Slideshow');
        fireEvent.blur(slideshowButton);

        fireEvent.click(pinButton);
        expect(props.onTogglePin).toHaveBeenCalledOnce();

        rerender(<CollectionContextMenu {...props} isPinned={false} isArchived={false} />);
        expect(screen.getByRole('button', { name: 'Pin collection' }).getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByRole('button', { name: 'Archive' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('names color actions, reports the selected color, and preserves selection behavior', () => {
        const props = createProps();
        render(<CollectionContextMenu {...props} currentColor="red" />);

        const redButton = screen.getByRole('button', { name: 'Set collection color to red' });
        const blueButton = screen.getByRole('button', { name: 'Set collection color to blue' });
        const clearButton = screen.getByRole('button', { name: 'Clear collection color' });

        expect(redButton.getAttribute('aria-pressed')).toBe('true');
        expect(blueButton.getAttribute('aria-pressed')).toBe('false');
        expect(clearButton.getAttribute('aria-pressed')).toBe('false');
        expect(redButton.getAttribute('title')).toBeNull();

        fireEvent.click(blueButton);
        expect(props.onColorChange).toHaveBeenCalledWith('blue');
        expect(props.onClose).toHaveBeenCalledOnce();
    });
});
