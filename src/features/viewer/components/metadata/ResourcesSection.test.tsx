import * as React from 'react';
import { Code, Puzzle, Target } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { ResourcesSection, type MetadataResourceGroup } from './ResourcesSection';

const renderSection = (groups: readonly MetadataResourceGroup[]) => {
    const onSearch = vi.fn();
    const onClose = vi.fn();
    const view = render(<ResourcesSection groups={groups} onSearch={onSearch} onClose={onClose} />);
    return { ...view, onSearch, onClose };
};

describe('ResourcesSection', () => {
    it('renders nothing when every resource group is empty', () => {
        const { container } = renderSection([
            { title: 'LoRAs', icon: Puzzle, items: [] },
            { title: 'ControlNets', icon: Target, items: undefined },
        ]);

        expect(container.firstChild).toBeNull();
    });

    it('groups only populated resources under one disclosure with aggregate and subgroup counts', () => {
        renderSection([
            { title: 'LoRAs', icon: Puzzle, items: ['one', 'two'] },
            { title: 'Embeddings', icon: Code, items: [] },
            { title: 'ControlNets', icon: Target, items: ['pose'], source: 'trusted_sidecar' },
        ]);

        const disclosure = screen.getByRole('button', { name: 'Resources' });
        expect(disclosure.closest('section')?.textContent).toContain('3');
        expect(screen.getByRole('heading', { name: 'LoRAs' }).textContent).toContain('2');
        expect(screen.queryByRole('heading', { name: 'Embeddings' })).toBeNull();
        expect(screen.getByRole('heading', { name: 'ControlNets' }).textContent).toContain('1');
        expect(screen.getByRole('button', { name: 'Source: trusted sidecar' })).toBeTruthy();

        fireEvent.click(disclosure);
        expect(disclosure.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('button', { name: 'one' })).toBeNull();
    });

    it('indents resource subgroups beneath the parent disclosure', () => {
        renderSection([{ title: 'LoRAs', icon: Puzzle, items: ['portrait'] }]);

        const subgroup = screen.getByRole('heading', { name: 'LoRAs' }).closest('section');
        expect(subgroup?.parentElement?.className).toContain('pl-6');
    });

    it.each([
        ['LoRAs', Puzzle, 'lora', 'Portrait.safetensors (0.75)', 'Portrait', 'lora:Portrait'],
        ['Embeddings', Code, 'embedding', 'detail.pt (-1)', 'detail', 'embedding:detail'],
        ['Hypernetworks', Code, 'hypernet', 'lighting.ckpt (2.0)', 'lighting', 'hypernet:lighting'],
        ['ControlNets', Target, 'controlnet', 'pose.safetensors', 'pose', 'cn:pose'],
        ['IP adapters', Code, 'ipadapter', 'face.pt', 'face', 'ip:face'],
    ] as const)('preserves %s resource filtering', (title, icon, filterKind, item, name, expected) => {
        const { onSearch, onClose } = renderSection([{ title, icon, filterKind, items: [item] }]);

        fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));

        expect(onSearch).toHaveBeenCalledWith(expected);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps unweighted dotted names and renders non-string evidence inertly', () => {
        const { onSearch } = renderSection([{
            title: 'Other',
            icon: Code,
            items: ['adapter.SAFETENSORS', 'name.with.dots', 42],
        }]);

        fireEvent.click(screen.getByRole('button', { name: 'adapter' }));
        fireEvent.click(screen.getByRole('button', { name: 'name.with.dots' }));

        expect(onSearch).toHaveBeenNthCalledWith(1, 'adapter');
        expect(onSearch).toHaveBeenNthCalledWith(2, 'name.with.dots');
        expect(screen.getByText('42').closest('button')).toBeNull();
    });
});
