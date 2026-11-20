import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { DEFAULT_APP_SETTINGS } from '../../../constants/defaultSettings';
import { CommandPalette } from '../CommandPalette';

describe('CommandPalette', () => {
    const renderPalette = (onClose = vi.fn(), onImport = vi.fn()) =>
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

    it('reopens with an empty query and the first command selected, from the first commit', () => {
        const palette = (isOpen: boolean) => (
            <CommandPalette
                isOpen={isOpen}
                onClose={vi.fn()}
                onNavigate={vi.fn()}
                onToggleTheme={vi.fn()}
                onOpenSettings={vi.fn()}
                onImport={vi.fn()}
                onCreateCollection={vi.fn()}
                onToggleAI={vi.fn()}
                settings={{ ...DEFAULT_APP_SETTINGS }}
            />
        );
        // Reads the palette at each commit, before any passive effect could correct it.
        const commits: Array<{ query: string; selected: number }> = [];
        const Probe = () => {
            React.useLayoutEffect(() => {
                const input = document.querySelector<HTMLInputElement>('input');
                const buttons = Array.from(document.querySelectorAll('.space-y-1 > button'));
                if (input)
                    commits.push({ query: input.value, selected: buttons.findIndex((button) => button.className.includes('bg-sage-600')) });
            });
            return null;
        };
        const { rerender } = render(
            <>
                {palette(true)}
                <Probe />
            </>
        );
        const input = screen.getByPlaceholderText('Type a command...') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 's' } });
        fireEvent.keyDown(window, { key: 'ArrowDown' });
        expect(input.value).toBe('s');
        expect(screen.getAllByRole('button')[1].className).toContain('bg-sage-600');

        rerender(
            <>
                {palette(false)}
                <Probe />
            </>
        );
        commits.length = 0;
        rerender(
            <>
                {palette(true)}
                <Probe />
            </>
        );

        expect(commits).toEqual([{ query: '', selected: 0 }]);
    });
});
