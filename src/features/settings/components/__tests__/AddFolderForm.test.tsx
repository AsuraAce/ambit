import { describe, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { AddFolderForm } from '../AddFolderForm';

describe('AddFolderForm', () => {
    it('forwards edits, browse, and submission for a non-empty path', () => {
        const onChange = vi.fn();
        const onBrowse = vi.fn();
        const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
        render(<AddFolderForm
            value="D:/Images"
            onChange={onChange}
            onBrowse={onBrowse}
            onSubmit={onSubmit}
        />);

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'E:/Images' } });
        fireEvent.click(screen.getByTitle('Browse'));
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(onChange).toHaveBeenCalledWith('E:/Images');
        expect(onBrowse).toHaveBeenCalledOnce();
        expect(onSubmit).toHaveBeenCalledOnce();
        expect(screen.getByPlaceholderText('e.g. D:/StableDiffusion/outputs')).toBeTruthy();
    });

    it('disables submission for whitespace-only paths and honors a custom placeholder', () => {
        render(<AddFolderForm
            value="  "
            onChange={vi.fn()}
            onBrowse={vi.fn()}
            onSubmit={vi.fn()}
            placeholder="Choose output"
        />);

        expect(screen.getByRole('button', { name: 'Add' }).hasAttribute('disabled')).toBe(true);
        expect(screen.getByPlaceholderText('Choose output')).toBeTruthy();
    });
});
