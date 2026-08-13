import * as React from 'react';
import { Tag } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { ResourceSection } from './ResourceSection';
import type { ResourceFilterKind } from './ResourceChips';

const renderSection = (title: string, items: unknown[], filterKind?: ResourceFilterKind) => {
    const onSearch = vi.fn();
    const onClose = vi.fn();
    const view = render(
        <ResourceSection title={title} items={items} icon={Tag} filterKind={filterKind} onSearch={onSearch} onClose={onClose} />
    );
    return { ...view, onSearch, onClose };
};

describe('ResourceSection', () => {
    it('renders nothing for absent, invalid, or empty resource lists', () => {
        const props = { title: 'Models', icon: Tag, onSearch: vi.fn(), onClose: vi.fn() };
        const { container, rerender } = render(<ResourceSection {...props} items={null as unknown as unknown[]} />);
        expect(container.firstChild).toBeNull();

        rerender(<ResourceSection {...props} items={{ name: 'invalid' } as unknown as unknown[]} />);
        expect(container.firstChild).toBeNull();

        rerender(<ResourceSection {...props} items={[]} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders non-string values as inert text', () => {
        renderSection('Metadata', [42, null, { name: 'model' }]);

        expect(screen.getByText('42')).toBeTruthy();
        expect(screen.getByText('null')).toBeTruthy();
        expect(screen.getByText('[object Object]')).toBeTruthy();
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Metadata' })).toBeTruthy();
    });

    it.each([
        ['LoRAs', 'lora', 'Portrait.safetensors (0.75)', 'Portrait', '0.75', 'lora:Portrait'],
        ['Embeddings', 'embedding', 'detail.pt (-1)', 'detail', '-1', 'embedding:detail'],
        ['Hypernetworks', 'hypernet', 'lighting.ckpt (2.0)', 'lighting', '2.0', 'hypernet:lighting'],
        ['ControlNet', 'controlnet', 'pose.safetensors', 'pose', null, 'cn:pose'],
        ['IP-Adapters', 'ipadapter', 'face.pt', 'face', null, 'ip:face'],
        ['Models', undefined, 'base.safetensors', 'base', null, 'base']
    ] as const)('searches %s resources with normalized names and prefixes', (title, filterKind, item, name, weight, expected) => {
        const { onSearch, onClose } = renderSection(title, [item], filterKind);

        expect(screen.getByText(name)).toBeTruthy();
        if (weight) expect(screen.getByText(weight)).toBeTruthy();
        fireEvent.click(screen.getByText(name).closest('button') as HTMLButtonElement);

        expect(onSearch).toHaveBeenCalledWith(expected);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps unweighted dotted names and strips extensions case-insensitively', () => {
        const { onSearch } = renderSection('Other', ['adapter.SAFETENSORS', 'name.with.dots']);

        fireEvent.click(screen.getByRole('button', { name: 'adapter' }));
        fireEvent.click(screen.getByRole('button', { name: 'name.with.dots' }));

        expect(onSearch).toHaveBeenNthCalledWith(1, 'adapter');
        expect(onSearch).toHaveBeenNthCalledWith(2, 'name.with.dots');
    });

    it('is expanded by default and exposes its item count while collapsed', () => {
        renderSection('LoRAs', ['one', 'two'], 'lora');

        const disclosure = screen.getByRole('button', { name: 'LoRAs' });
        expect(disclosure.getAttribute('aria-expanded')).toBe('true');
        expect(disclosure.closest('section')?.textContent).toContain('2');

        fireEvent.click(disclosure);

        expect(disclosure.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('button', { name: 'one' })).toBeNull();
    });
});
