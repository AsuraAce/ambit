import * as React from 'react';
import { Tag } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { ResourceSection } from './ResourceSection';

const renderSection = (title: string, items: unknown[]) => {
    const onSearch = vi.fn();
    const onClose = vi.fn();
    const view = render(
        <ResourceSection title={title} items={items} icon={Tag} onSearch={onSearch} onClose={onClose} />
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
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it.each([
        ['LoRAs', 'Portrait.safetensors (0.75)', 'Portrait', '0.75', 'lora:Portrait'],
        ['Embeddings', 'detail.pt (-1)', 'detail', '-1', 'embedding:detail'],
        ['Hypernetworks', 'lighting.ckpt (2.0)', 'lighting', '2.0', 'hypernet:lighting'],
        ['Models', 'base.safetensors', 'base', null, 'base']
    ])('searches %s resources with normalized names and prefixes', (title, item, name, weight, expected) => {
        const { onSearch, onClose } = renderSection(title, [item]);

        expect(screen.getByText(name)).toBeTruthy();
        if (weight) expect(screen.getByText(weight)).toBeTruthy();
        fireEvent.click(screen.getByRole('button'));

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
});
