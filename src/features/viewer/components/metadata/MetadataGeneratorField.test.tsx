import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { GeneratorTool } from '../../../../types';
import { MetadataGeneratorField } from './MetadataGeneratorField';

const selectOption = (tool: GeneratorTool) => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit Generation Tool' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Generator software' }), { target: { value: tool } });
};

describe('MetadataGeneratorField', () => {
    it('saves a changed generator and ignores an unchanged one', () => {
        const onSave = vi.fn();
        render(<MetadataGeneratorField value={GeneratorTool.COMFYUI} onSave={onSave} />);

        fireEvent.click(screen.getByRole('button', { name: 'Edit Generation Tool' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSave).not.toHaveBeenCalled();

        selectOption(GeneratorTool.INVOKEAI);
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSave).toHaveBeenCalledExactlyOnceWith(GeneratorTool.INVOKEAI);
    });

    it('cancels an open edit when a new value arrives, without committing the stale editor', () => {
        const onSave = vi.fn();
        const selectPresentPerCommit: boolean[] = [];
        const ui = (value: GeneratorTool) => (
            <React.Profiler id="generator" onRender={() => selectPresentPerCommit.push(!!screen.queryByRole('combobox'))}>
                <MetadataGeneratorField value={value} onSave={onSave} />
            </React.Profiler>
        );
        const { rerender } = render(ui(GeneratorTool.COMFYUI));
        selectOption(GeneratorTool.INVOKEAI);

        selectPresentPerCommit.length = 0;
        rerender(ui(GeneratorTool.FORGE));

        expect(screen.queryByRole('combobox')).toBeNull();
        expect(screen.getByText(GeneratorTool.FORGE)).toBeTruthy();
        expect(selectPresentPerCommit.length).toBeGreaterThan(0);
        expect(selectPresentPerCommit.every((present) => !present)).toBe(true);
        expect(onSave).not.toHaveBeenCalled();
    });

    it('resets the draft to the new value so saving an untouched editor never writes the old draft', () => {
        const onSave = vi.fn();
        const { rerender } = render(<MetadataGeneratorField value={GeneratorTool.COMFYUI} onSave={onSave} />);
        selectOption(GeneratorTool.INVOKEAI);

        rerender(<MetadataGeneratorField value={GeneratorTool.FORGE} onSave={onSave} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit Generation Tool' }));

        expect((screen.getByRole('combobox', { name: 'Generator software' }) as HTMLSelectElement).value).toBe(GeneratorTool.FORGE);
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSave).not.toHaveBeenCalled();
    });

    it('keeps an open edit when the same value is re-rendered', () => {
        const { rerender } = render(<MetadataGeneratorField value={GeneratorTool.COMFYUI} onSave={vi.fn()} />);
        selectOption(GeneratorTool.INVOKEAI);

        rerender(<MetadataGeneratorField value={GeneratorTool.COMFYUI} onSave={vi.fn()} modified />);

        expect((screen.getByRole('combobox', { name: 'Generator software' }) as HTMLSelectElement).value).toBe(GeneratorTool.INVOKEAI);
    });
});
