import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageKindScopeDropdown } from '../ImageKindScopeDropdown';

const counts = { all: 1200, generated: 900, photograph: 250, other: 50 };

describe('ImageKindScopeDropdown', () => {
    it('defaults to All and exposes counts only after opening the compact control', async () => {
        render(<ImageKindScopeDropdown value="all" counts={counts} onChange={vi.fn()} />);

        const trigger = screen.getByRole('button', { name: 'Image kind: All, 1,200. Change image kind' });
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('radiogroup', { name: 'Filter library by image kind' })).toBeNull();

        fireEvent.click(trigger);

        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('radiogroup', { name: 'Filter library by image kind' })).toBeTruthy();
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'All, 1,200' })));
    });

    it('selects an image kind and returns focus to the trigger', () => {
        const onChange = vi.fn();
        render(<ImageKindScopeDropdown value="all" counts={counts} onChange={onChange} />);

        const trigger = screen.getByRole('button', { name: 'Image kind: All, 1,200. Change image kind' });
        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('radio', { name: 'Photos, 250' }));

        expect(onChange).toHaveBeenCalledWith('photograph');
        expect(screen.queryByRole('radiogroup', { name: 'Filter library by image kind' })).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('supports arrow navigation and Escape without changing the scope', async () => {
        const onChange = vi.fn();
        render(<ImageKindScopeDropdown value="photograph" counts={counts} onChange={onChange} />);

        const trigger = screen.getByRole('button', { name: 'Image kind: Photos, 250. Change image kind' });
        fireEvent.click(trigger);
        const selected = screen.getByRole('radio', { name: 'Photos, 250' });
        await waitFor(() => expect(document.activeElement).toBe(selected));

        fireEvent.keyDown(selected, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Other, 50' }));
        fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });

        expect(onChange).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(trigger);
    });
});
