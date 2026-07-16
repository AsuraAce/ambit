import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShortcutsModal } from '../ShortcutsModal';

describe('ShortcutsModal', () => {
    beforeEach(() => localStorage.clear());

    it('renders only while open and defaults to an expanded General category', async () => {
        const { rerender } = render(<ShortcutsModal isOpen={false} onClose={vi.fn()} />);
        expect(screen.queryByText('Ambit Help & Guide')).toBeNull();

        rerender(<ShortcutsModal isOpen onClose={vi.fn()} />);
        expect(await screen.findByText('Show this help dialog')).toBeTruthy();
        await waitFor(() => expect(JSON.parse(localStorage.getItem('ambit_shortcuts_expanded') ?? '{}')).toEqual({ General: true }));
    });

    it('loads saved categories, toggles and persists them', async () => {
        localStorage.setItem('ambit_shortcuts_expanded', JSON.stringify({ 'Library Navigation': true }));
        render(<ShortcutsModal isOpen onClose={vi.fn()} />);
        expect(await screen.findByText('Navigate grid')).toBeTruthy();
        expect(screen.queryByText('Show this help dialog')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /Library Actions/ }));
        expect(screen.getByText('Toggle selected Favorites')).toBeTruthy();
        expect(screen.queryByText('Batch Rename')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Library Navigation/ }));
        expect(screen.queryByText('Navigate grid')).toBeNull();
        await waitFor(() => expect(JSON.parse(localStorage.getItem('ambit_shortcuts_expanded') ?? '{}')).toMatchObject({
            'Library Navigation': false,
            'Library Actions': true,
        }));
    });

    it('documents system, viewer, and slideshow shortcuts', () => {
        render(<ShortcutsModal isOpen onClose={vi.fn()} />);

        expect(screen.getByText('Open Settings')).toBeTruthy();
        expect(screen.getByText('Import images')).toBeTruthy();
        expect(screen.getByText('Toggle fullscreen (desktop app)')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /Viewer/ }));
        expect(screen.getByText('Toggle metadata sidebar')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Slideshow/ }));
        expect(screen.getByText('Play / Pause')).toBeTruthy();
    });

    it('falls back from corrupt saved state and switches search tabs from props and clicks', async () => {
        localStorage.setItem('ambit_shortcuts_expanded', '{broken');
        const { rerender } = render(<ShortcutsModal isOpen onClose={vi.fn()} initialTab="shortcuts" />);
        expect(await screen.findByText('Show this help dialog')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Search Syntax' }));
        expect(screen.getByText('Search positive prompt (default)')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Keyboard Shortcuts' }));
        expect(screen.getByText('Show this help dialog')).toBeTruthy();

        rerender(<ShortcutsModal isOpen onClose={vi.fn()} initialTab="search" />);
        expect(screen.getByText('Example Query')).toBeTruthy();
    });

    it('closes from the backdrop and close button but not the panel', () => {
        const onClose = vi.fn();
        const { container } = render(<ShortcutsModal isOpen onClose={onClose} initialTab="search" />);
        fireEvent.click(screen.getByText('Example Query'));
        expect(onClose).not.toHaveBeenCalled();
        const closeButtons = screen.getAllByRole('button').filter(button => button.textContent === '');
        fireEvent.click(closeButtons[0]);
        expect(onClose).toHaveBeenCalledOnce();
        fireEvent.click(container.firstElementChild as Element);
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});
