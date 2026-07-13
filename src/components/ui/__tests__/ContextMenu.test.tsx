import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu } from '../ContextMenu';

const callbacks = () => ({
    onClose: vi.fn(), onCopyPrompt: vi.fn(), onCopySeed: vi.fn(), onCopyGenerationInfo: vi.fn(),
    onCopyImage: vi.fn(), onCopyFilePath: vi.fn(), onOpenInDefaultApp: vi.fn(), onAddToCollection: vi.fn(),
    onMoveToCollection: vi.fn(), onRemoveFromCollection: vi.fn(), onTogglePin: vi.fn(), onDelete: vi.fn(),
    onShowInFolder: vi.fn(), onRecoverMetadata: vi.fn(), onSetThumbnail: vi.fn(), onUnsetThumbnail: vi.fn(),
    onToggleMask: vi.fn(), onToggleFavorite: vi.fn(), onToggleIntermediate: vi.fn(), onSetModelThumbnail: vi.fn(),
});

const openSubmenu = (label: string) => {
    const trigger = screen.getByRole('button', { name: new RegExp(label) });
    fireEvent.mouseEnter(trigger.closest('.relative') as Element);
};

describe('ContextMenu', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    });
    afterEach(() => vi.useRealTimers());

    it('positions within the viewport and runs every available action', () => {
        const cb = callbacks();
        const model = { name: 'Flux', hash: 'abc', type: 'checkpoint' };
        const { container } = render(
            <ContextMenu
                x={950} y={750} isPinned enableAI activeCollectionName="Favorites"
                isFavorite isMasked={false} userMasked isIntermediate
                modelsForThumbnail={[model]} {...cb}
            />
        );
        const root = container.firstElementChild as HTMLElement;
        expect(root.style.left).toBe('760px');
        expect(root.style.top).toBe('500px');

        for (const label of ['Unfavorite', 'Unpin', 'Show in Folder', 'Remove from Library']) fireEvent.click(screen.getByRole('button', { name: label }));
        expect(cb.onToggleFavorite).toHaveBeenCalledOnce();
        expect(cb.onTogglePin).toHaveBeenCalledOnce();
        expect(cb.onShowInFolder).toHaveBeenCalledOnce();
        expect(cb.onDelete).toHaveBeenCalledOnce();

        openSubmenu('Copy Data');
        for (const label of ['Copy Prompt', 'Copy Seed', 'Copy All Info', 'Copy Image', 'Copy File Path']) fireEvent.click(screen.getByRole('button', { name: label }));
        expect(cb.onCopyPrompt).toHaveBeenCalledOnce();
        expect(cb.onCopySeed).toHaveBeenCalledOnce();
        expect(cb.onCopyGenerationInfo).toHaveBeenCalledOnce();
        expect(cb.onCopyImage).toHaveBeenCalledOnce();
        expect(cb.onCopyFilePath).toHaveBeenCalledOnce();

        openSubmenu('Organize');
        for (const label of ['Add to Collection...', 'Move to Collection...', 'Remove from Collection', 'Set as Collection Thumb', 'Reset Collection Thumb']) {
            fireEvent.click(screen.getByRole('button', { name: label }));
        }
        fireEvent.click(screen.getByRole('button', { name: 'Flux' }));
        expect(cb.onAddToCollection).toHaveBeenCalledOnce();
        expect(cb.onMoveToCollection).toHaveBeenCalledOnce();
        expect(cb.onRemoveFromCollection).toHaveBeenCalledOnce();
        expect(cb.onSetThumbnail).toHaveBeenCalledOnce();
        expect(cb.onUnsetThumbnail).toHaveBeenCalledOnce();
        expect(cb.onSetModelThumbnail).toHaveBeenCalledWith(model);

        openSubmenu('Privacy & AI');
        for (const label of ['Reset Mask to Auto', 'Mask Content', 'Unmark as Intermediate', 'Recover Metadata (AI)']) {
            fireEvent.click(screen.getByRole('button', { name: label }));
        }
        expect(cb.onToggleMask.mock.calls).toEqual([[null], [true]]);
        expect(cb.onToggleIntermediate).toHaveBeenCalledOnce();
        expect(cb.onRecoverMetadata).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'Open in Default App' }));
        expect(cb.onOpenInDefaultApp).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: 'Flux' }).parentElement?.className).toContain('right-');
    });

    it('renders alternate labels and omits unavailable optional actions', () => {
        const cb = callbacks();
        render(
            <ContextMenu
                x={10} y={20} isPinned={false} enableAI={false} isFavorite={false} isMasked
                isIntermediate={false} onClose={cb.onClose} onCopyPrompt={cb.onCopyPrompt}
                onAddToCollection={cb.onAddToCollection} onTogglePin={cb.onTogglePin}
                onDelete={cb.onDelete} onShowInFolder={cb.onShowInFolder}
                onToggleMask={cb.onToggleMask} onToggleIntermediate={cb.onToggleIntermediate}
            />
        );
        expect(screen.getByRole('button', { name: 'Favorite' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Pin to Top' })).toBeTruthy();
        openSubmenu('Privacy & AI');
        fireEvent.click(screen.getByRole('button', { name: 'Unmask Content' }));
        fireEvent.click(screen.getByRole('button', { name: 'Mark as Intermediate' }));
        expect(cb.onToggleMask).toHaveBeenCalledWith(false);
        expect(screen.queryByRole('button', { name: 'Recover Metadata (AI)' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Open in Default App' })).toBeNull();

        openSubmenu('Copy Data');
        expect(screen.queryByRole('button', { name: 'Copy Seed' })).toBeNull();
        openSubmenu('Organize');
        expect(screen.queryByRole('button', { name: 'Move to Collection...' })).toBeNull();
    });

    it('delays submenu closing, cancels pending close on reentry, and dismisses outside', () => {
        const cb = callbacks();
        const { container, unmount } = render(
            <ContextMenu x={100} y={100} onClose={cb.onClose} onCopyPrompt={cb.onCopyPrompt} onAddToCollection={cb.onAddToCollection} onTogglePin={cb.onTogglePin} onDelete={cb.onDelete} onShowInFolder={cb.onShowInFolder} />
        );
        const group = screen.getByRole('button', { name: /Copy Data/ }).closest('.relative') as Element;
        fireEvent.mouseEnter(group);
        expect(screen.getByRole('button', { name: 'Copy Prompt' })).toBeTruthy();
        fireEvent.mouseLeave(group);
        act(() => vi.advanceTimersByTime(100));
        fireEvent.mouseEnter(group);
        act(() => vi.advanceTimersByTime(100));
        expect(screen.getByRole('button', { name: 'Copy Prompt' })).toBeTruthy();
        fireEvent.mouseLeave(group);
        act(() => vi.advanceTimersByTime(150));
        expect(screen.queryByRole('button', { name: 'Copy Prompt' })).toBeNull();

        fireEvent.mouseDown(container.firstElementChild as Element);
        expect(cb.onClose).not.toHaveBeenCalled();
        fireEvent.mouseDown(document.body);
        expect(cb.onClose).toHaveBeenCalledOnce();
        unmount();
        fireEvent.mouseDown(document.body);
        expect(cb.onClose).toHaveBeenCalledOnce();
    });

    it('uses no-op favorite behavior when no callback is supplied', () => {
        const cb = callbacks();
        render(<ContextMenu x={0} y={0} onClose={cb.onClose} onCopyPrompt={cb.onCopyPrompt} onAddToCollection={cb.onAddToCollection} onTogglePin={cb.onTogglePin} onDelete={cb.onDelete} onShowInFolder={cb.onShowInFolder} />);
        expect(() => fireEvent.click(screen.getByRole('button', { name: 'Favorite' }))).not.toThrow();
    });
});
