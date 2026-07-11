import { fireEvent, render, screen } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectionContextMenu } from '../CollectionContextMenu';

const callbacks = () => ({
    onClose: vi.fn(),
    onRename: vi.fn(),
    onToggleArchive: vi.fn(),
    onTogglePin: vi.fn(),
    onDelete: vi.fn(),
    onPlaySlideshow: vi.fn(),
    onExport: vi.fn(),
    onResetThumbnail: vi.fn(),
    onColorChange: vi.fn(),
    onEditCollection: vi.fn()
});

describe('CollectionContextMenu', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 });
    });

    it('keeps the menu on screen and closes only for outside interactions', () => {
        const handlers = callbacks();
        const { container, unmount } = render(
            <CollectionContextMenu
                x={480}
                y={390}
                collectionId="collection-1"
                {...handlers}
            />
        );

        const menu = container.firstElementChild as HTMLElement;
        expect(menu.style.left).toBe('260px');
        expect(menu.style.top).toBe('100px');

        fireEvent.contextMenu(menu);
        fireEvent.mouseDown(screen.getByText('Rename'));
        expect(handlers.onClose).not.toHaveBeenCalled();

        fireEvent.mouseDown(document.body);
        expect(handlers.onClose).toHaveBeenCalledTimes(1);

        unmount();
        fireEvent.mouseDown(document.body);
        expect(handlers.onClose).toHaveBeenCalledTimes(1);
    });

    it('exposes every collection action and optional management item', () => {
        const handlers = callbacks();
        render(
            <CollectionContextMenu
                x={10}
                y={20}
                collectionId="collection-1"
                isArchived
                isPinned
                hasCustomThumbnail
                {...handlers}
            />
        );

        const titledActions: Array<[string, ReturnType<typeof vi.fn>]> = [
            ['Play Slideshow', handlers.onPlaySlideshow],
            ['Unpin collection', handlers.onTogglePin],
            ['Unarchive', handlers.onToggleArchive],
            ['Delete Collection', handlers.onDelete]
        ];
        const textActions: Array<[string, ReturnType<typeof vi.fn>]> = [
            ['Rename', handlers.onRename],
            ['Edit Filters', handlers.onEditCollection],
            ['Export to ZIP...', handlers.onExport],
            ['Reset Thumbnail', handlers.onResetThumbnail]
        ];

        for (const [name, callback] of titledActions) {
            fireEvent.click(screen.getByTitle(name, { exact: true }));
            expect(callback).toHaveBeenCalledTimes(1);
        }
        for (const [name, callback] of textActions) {
            fireEvent.click(screen.getByText(name));
            expect(callback).toHaveBeenCalledTimes(1);
        }
    });

    it('reports color choices, closes afterward, and hides optional actions', () => {
        const handlers = callbacks();
        render(
            <CollectionContextMenu
                x={10}
                y={20}
                collectionId="collection-1"
                currentColor="red"
                {...handlers}
                onEditCollection={undefined}
            />
        );

        expect(screen.queryByText('Edit Filters')).toBeNull();
        expect(screen.queryByText('Reset Thumbnail')).toBeNull();
        expect(screen.getByTitle('Pin collection')).toBeTruthy();
        expect(screen.getByTitle('Archive')).toBeTruthy();
        expect(screen.getByTitle('red').className).toContain('ring-2');

        fireEvent.click(screen.getByTitle('blue'));
        fireEvent.click(screen.getByTitle('None'));

        expect(handlers.onColorChange).toHaveBeenNthCalledWith(1, 'blue');
        expect(handlers.onColorChange).toHaveBeenNthCalledWith(2, undefined);
        expect(handlers.onClose).toHaveBeenCalledTimes(2);
    });
});
