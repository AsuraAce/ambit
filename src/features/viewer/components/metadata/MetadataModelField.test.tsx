import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { MetadataModelField } from './MetadataModelField';
import type { ModelPresentation } from './modelPresentation';

const named = (value: string): ModelPresentation => ({ value, isHashFallback: false, isOverride: false });
const hashed = (value: string): ModelPresentation => ({ value, isHashFallback: true, isOverride: false });
const options = ['Alpha', 'Beta'];

const openCustomEditor = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit Model' }));
    fireEvent.click(screen.getByRole('option', { name: /Custom model/i }));
    fireEvent.change(screen.getByLabelText('Custom model name'), { target: { value: 'Typed model' } });
};

describe('MetadataModelField', () => {
    it('saves a chosen library model and ignores an unchanged one', () => {
        const onSave = vi.fn();
        render(<MetadataModelField presentation={named('Alpha')} options={options} onSave={onSave} />);

        fireEvent.click(screen.getByRole('button', { name: 'Edit Model' }));
        fireEvent.click(screen.getByRole('option', { name: 'Alpha' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSave).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Edit Model' }));
        fireEvent.click(screen.getByRole('option', { name: 'Beta' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSave).toHaveBeenCalledExactlyOnceWith('Beta');
    });

    it('closes an open editor when the model value changes, without committing the stale editor', () => {
        const onSave = vi.fn();
        const editorPresentPerCommit: boolean[] = [];
        const ui = (presentation: ModelPresentation) => (
            <React.Profiler id="model" onRender={() => editorPresentPerCommit.push(!!screen.queryByLabelText('Custom model name'))}>
                <MetadataModelField presentation={presentation} options={options} onSave={onSave} />
            </React.Profiler>
        );
        const { rerender } = render(ui(named('Alpha')));
        openCustomEditor();
        expect(screen.getByLabelText('Custom model name')).toBeTruthy();

        editorPresentPerCommit.length = 0;
        rerender(ui(named('Beta')));

        expect(screen.queryByLabelText('Custom model name')).toBeNull();
        expect(screen.getByRole('button', { name: 'Edit Model' })).toBeTruthy();
        expect(screen.getByText('Beta')).toBeTruthy();
        expect(editorPresentPerCommit.length).toBeGreaterThan(0);
        expect(editorPresentPerCommit.every((present) => !present)).toBe(true);
        expect(onSave).not.toHaveBeenCalled();
    });

    it('closes an open editor when the model changes from unresolved hash to a resolved name', () => {
        const { rerender } = render(<MetadataModelField presentation={hashed('abc123')} options={options} onSave={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit Model' }));
        expect(screen.getByRole('combobox', { name: 'Search models' })).toBeTruthy();

        rerender(<MetadataModelField presentation={named('abc123')} options={options} onSave={vi.fn()} />);

        expect(screen.queryByRole('combobox', { name: 'Search models' })).toBeNull();
        expect(screen.queryByText('Unresolved hash')).toBeNull();
        expect(screen.getByRole('button', { name: 'Edit Model' })).toBeTruthy();
    });

    it('starts the next edit from the new value with an empty search and no leftover draft', () => {
        const onSave = vi.fn();
        const { rerender } = render(<MetadataModelField presentation={named('Alpha')} options={options} onSave={onSave} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit Model' }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Search models' }), { target: { value: 'Alp' } });

        rerender(<MetadataModelField presentation={named('Beta')} options={options} onSave={onSave} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit Model' }));

        expect((screen.getByRole('combobox', { name: 'Search models' }) as HTMLInputElement).value).toBe('');
        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Beta', 'Alpha', 'Custom model…']);
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSave).not.toHaveBeenCalled();
    });

    it('keeps an open editor when the same model is re-rendered with a fresh presentation object', () => {
        const { rerender } = render(<MetadataModelField presentation={named('Alpha')} options={options} onSave={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit Model' }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Search models' }), { target: { value: 'Be' } });

        rerender(<MetadataModelField presentation={named('Alpha')} options={options} onSave={vi.fn()} modified />);

        expect((screen.getByRole('combobox', { name: 'Search models' }) as HTMLInputElement).value).toBe('Be');
    });

    it('leaves the Save button disabled until a model is chosen for an unresolved hash', () => {
        render(<MetadataModelField presentation={hashed('abc123')} options={options} onSave={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Edit Model' }));

        expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole('option', { name: 'Alpha' }));
        expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    });
});
