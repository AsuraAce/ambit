import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { DEFAULT_APP_SETTINGS } from '../../../constants/defaultSettings';
import { CommandPalette } from '../CommandPalette';

describe('CommandPalette', () => {
    it('delegates Import Images to the app import chooser before closing', () => {
        const onImport = vi.fn();
        const onClose = vi.fn();

        render(
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

        fireEvent.click(screen.getByRole('button', { name: /Import Images/i }));

        expect(onImport).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });
});
