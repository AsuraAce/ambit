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
});
