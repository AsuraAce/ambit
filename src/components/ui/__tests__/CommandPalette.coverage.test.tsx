import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultAppSettings } from '../../../constants/defaultSettings';
import { CommandPalette } from '../CommandPalette';

const setup = (settings = createDefaultAppSettings({ theme: 'light', enableAI: false }), isOpen = true) => {
    const callbacks = {
        onClose: vi.fn(),
        onNavigate: vi.fn(),
        onToggleTheme: vi.fn(),
        onOpenSettings: vi.fn(),
        onImport: vi.fn(),
        onCreateCollection: vi.fn(),
        onToggleAI: vi.fn(),
    };
    return { ...render(<CommandPalette isOpen={isOpen} settings={settings} {...callbacks} />), ...callbacks };
};

describe('CommandPalette', () => {
    it('renders only while open and ignores keyboard commands while closed', () => {
        const view = setup(undefined, false);
        fireEvent.keyDown(window, { key: 'Enter' });
        expect(screen.queryByPlaceholderText('Type a command...')).toBeNull();
        expect(view.onClose).not.toHaveBeenCalled();
    });

    it('runs every command and closes after each action', () => {
        const view = setup();
        for (const [label, callback, argument] of [
            ['Go to Grid View', view.onNavigate, 'grid'],
            ['Go to Timeline', view.onNavigate, 'timeline'],
            ['Go to Dashboard', view.onNavigate, 'dashboard'],
            ['Go to Maintenance', view.onNavigate, 'maintenance'],
            ['Import Images', view.onImport, undefined],
            ['Create Collection', view.onCreateCollection, undefined],
            ['Enable AI Features', view.onToggleAI, undefined],
            ['Switch to Dark Mode', view.onToggleTheme, undefined],
            ['Open Settings', view.onOpenSettings, undefined],
        ] as const) {
            fireEvent.mouseEnter(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
            fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
            argument === undefined ? expect(callback).toHaveBeenCalled() : expect(callback).toHaveBeenCalledWith(argument);
        }
        expect(view.onClose).toHaveBeenCalledTimes(9);
    });

    it('filters commands, handles empty results, and executes keyboard selection', () => {
        const view = setup();
        const input = screen.getByPlaceholderText('Type a command...');
        fireEvent.change(input, { target: { value: 'Go to' } });
        expect(screen.getAllByRole('button')).toHaveLength(4);
        fireEvent.keyDown(window, { key: 'ArrowDown' });
        fireEvent.keyDown(window, { key: 'Enter' });
        expect(view.onNavigate).toHaveBeenCalledWith('timeline');

        fireEvent.change(input, { target: { value: 'Settings' } });
        fireEvent.keyDown(window, { key: 'ArrowUp' });
        fireEvent.keyDown(window, { key: 'Enter' });
        expect(view.onOpenSettings).toHaveBeenCalledOnce();

        fireEvent.change(input, { target: { value: 'does-not-exist' } });
        expect(screen.getByText('No commands found.')).toBeTruthy();
        fireEvent.keyDown(window, { key: 'Escape' });
        fireEvent.keyDown(window, { key: 'ArrowDown' });
        fireEvent.keyDown(window, { key: 'ArrowUp' });
        fireEvent.keyDown(window, { key: 'Enter' });
    });

    it('updates dynamic labels and distinguishes panel from backdrop clicks', () => {
        const view = setup(createDefaultAppSettings({ theme: 'dark', enableAI: true }));
        expect(screen.getByText('Disable AI Features')).toBeTruthy();
        expect(screen.getByText('Switch to Light Mode')).toBeTruthy();
        fireEvent.click(screen.getByPlaceholderText('Type a command...'));
        expect(view.onClose).not.toHaveBeenCalled();
        fireEvent.click(view.container.firstElementChild as Element);
        expect(view.onClose).toHaveBeenCalledOnce();
    });
});
