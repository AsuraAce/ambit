import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { DEFAULT_APP_SETTINGS } from '../../../constants/defaultSettings';
import { CommandPalette } from '../CommandPalette';

describe('CommandPalette', () => {
    const renderPalette = (onClose = vi.fn(), onImport = vi.fn()) => render(
        <CommandPalette
            isOpen={true}
            onClose={onClose}
            onNavigate={vi.fn()}
            onToggleTheme={vi.fn()}
            onOpenSettings={vi.fn()}
            onImport={onImport}
            onCreateCollection={vi.fn()}
            onToggleAI={vi.fn()}
            settings={{ ...DEFAULT_APP_SETTINGS }}
        />
    );

    it('delegates Import Images to the app import chooser before closing', () => {
        const onImport = vi.fn();
        const onClose = vi.fn();

        renderPalette(onClose, onImport);

        fireEvent.click(screen.getByRole('button', { name: /Import Images/i }));

        expect(onImport).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('closes with one Escape press while its input is focused', () => {
        const onClose = vi.fn();
        renderPalette(onClose);

        const input = screen.getByPlaceholderText('Type a command...');
        input.focus();
        fireEvent.keyDown(input, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledOnce();
    });
});
