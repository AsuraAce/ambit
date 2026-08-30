import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { MetadataTextAreaField } from './MetadataTextAreaField';

describe('MetadataTextAreaField', () => {
    it.each([
        ['positivePrompt', 'Positive prompt', 'Enter positive prompt...'],
        ['negativePrompt', 'Negative prompt', 'Enter negative prompt...'],
        ['notes', 'Notes', 'Add your notes here...'],
    ] as const)('provides the shared %s label and placeholder', (kind, label, placeholder) => {
        render(<MetadataTextAreaField kind={kind} value="" onChange={vi.fn()} />);

        const textarea = screen.getByLabelText(label);
        expect(textarea.getAttribute('placeholder')).toBe(placeholder);
    });

    it('keeps editing callbacks in the owning viewer', () => {
        const onChange = vi.fn();
        const onBlur = vi.fn();
        render(
            <MetadataTextAreaField
                kind="notes"
                value="Existing note"
                onChange={onChange}
                onBlur={onBlur}
            />,
        );

        const textarea = screen.getByLabelText('Notes');
        fireEvent.change(textarea, { target: { value: 'Updated note' } });
        fireEvent.blur(textarea);

        expect(onChange).toHaveBeenCalledOnce();
        expect(onBlur).toHaveBeenCalledOnce();
    });

    it('places optional actions before the far-right provenance control', () => {
        render(
            <MetadataTextAreaField
                kind="positivePrompt"
                value="Prompt"
                onChange={vi.fn()}
                source="trusted_sidecar"
                headerAction={<button type="button">Field action</button>}
                status={<span>Unsaved</span>}
                overlay={<span>Suggestion</span>}
            />,
        );

        const action = screen.getByRole('button', { name: 'Field action' });
        const source = screen.getByRole('button', { name: 'Source: trusted sidecar' });
        expect(action.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByText('Unsaved')).toBeTruthy();
        expect(screen.getByText('Suggestion')).toBeTruthy();
    });

    it.each([
        ['positivePrompt', 'Positive prompt', 'text-sage-500'],
        ['negativePrompt', 'Negative prompt', 'text-red-400'],
        ['notes', 'Notes', 'text-gray-400'],
    ] as const)('keeps %s icon color aligned with its semantic role', (kind, label, iconClassName) => {
        render(<MetadataTextAreaField kind={kind} value="" onChange={vi.fn()} />);

        const labelElement = screen.getByText(label);
        expect(labelElement.parentElement?.querySelector('svg')?.getAttribute('class')).toContain(iconClassName);
    });

    it.each([
        ['positivePrompt', 'Positive prompt'],
        ['negativePrompt', 'Negative prompt'],
    ] as const)('keeps the %s heading on the shared category style while subduing only its content', (kind, label) => {
        render(<MetadataTextAreaField kind={kind} value="Prompt content" onChange={vi.fn()} />);

        const heading = screen.getByText(label);
        const textarea = screen.getByLabelText(label);
        expect(heading.className).toContain('text-zinc-400');
        expect(textarea.className).toContain('text-gray-800');
        expect(textarea.className).toContain('dark:text-zinc-200');
    });

    it('uses one formatted read surface and swaps to the textarea only while editing', () => {
        const onBlur = vi.fn();
        const onCancelEdit = vi.fn();
        render(
            <MetadataTextAreaField
                kind="positivePrompt"
                value={'Line one\nLine two'}
                onChange={vi.fn()}
                onBlur={onBlur}
                onCancelEdit={onCancelEdit}
                readContent={<span>{'Line one\nLine two'}</span>}
            />,
        );

        const readSurface = screen.getByRole('textbox', { name: 'Positive prompt' });
        expect(readSurface.tagName).toBe('DIV');
        expect(readSurface.getAttribute('aria-readonly')).toBe('true');
        expect(readSurface.className).toContain('whitespace-pre-wrap');
        expect(readSurface.textContent).toBe('Line one\nLine two');

        fireEvent.click(screen.getByRole('button', { name: 'Edit Positive prompt' }));
        const textarea = screen.getByRole('textbox', { name: 'Positive prompt' });
        expect(textarea.tagName).toBe('TEXTAREA');

        fireEvent.keyDown(textarea, { key: 'Escape' });
        expect(onCancelEdit).toHaveBeenCalledOnce();
        expect(screen.getByRole('textbox', { name: 'Positive prompt' }).tagName).toBe('DIV');

        fireEvent.click(screen.getByRole('button', { name: 'Edit Positive prompt' }));
        fireEvent.blur(screen.getByRole('textbox', { name: 'Positive prompt' }));
        expect(onBlur).toHaveBeenCalledOnce();
        expect(screen.getByRole('textbox', { name: 'Positive prompt' }).tagName).toBe('DIV');
    });
    it('makes the formatted read surface keyboard-focusable and multiline', () => {
        render(
            <MetadataTextAreaField
                kind="positivePrompt"
                value={'Line one\nLine two'}
                onChange={vi.fn()}
                readOnly
                readContent={<span>{'Line one\nLine two'}</span>}
            />,
        );

        const readSurface = screen.getByRole('textbox', { name: 'Positive prompt' });
        expect(readSurface.getAttribute('tabindex')).toBe('0');
        expect(readSurface.getAttribute('aria-multiline')).toBe('true');
        readSurface.focus();
        expect(document.activeElement).toBe(readSurface);
    });
});
