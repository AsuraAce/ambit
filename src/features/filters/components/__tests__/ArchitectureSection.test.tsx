import { fireEvent, render, screen } from '../../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import type { FilterState } from '../../../../types';
import { ArchitectureSection } from '../ArchitectureSection';

vi.mock('../FilterPrimitives', () => ({
    SectionHeader: ({ title, action, onToggle }: { title: string; action?: React.ReactNode; onToggle: () => void }) => <div><button onClick={onToggle}>{title}</button>{action}</div>,
    SearchInput: ({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) => <input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />,
    SelectableRow: ({ label, isSelected, onClick }: { label: string; isSelected: boolean; onClick: () => void }) => <button data-selected={isSelected} onClick={onClick}>{label}</button>
}));

const filters = (models: string[] = []): FilterState => ({
    searchQuery: '', models, tools: [], loras: [], embeddings: [], hypernetworks: [], samplers: [],
    generationTypes: [], controlNets: [], ipAdapters: [], dateRange: 'all', favoritesOnly: false, collectionId: null
});

describe('ArchitectureSection', () => {
    it('stays collapsed and forwards header toggles', () => {
        const onToggle = vi.fn();
        render(<ArchitectureSection filters={filters()} setFilters={vi.fn()} models={['flux']} isOpen={false} onToggle={onToggle} />);
        fireEvent.click(screen.getByText('Model Architecture'));
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Search Models' })).toBeNull();
    });

    it('searches models and toggles selections in both directions', () => {
        let current = filters(['flux-dev']);
        const setFilters = vi.fn((update: React.SetStateAction<FilterState>) => {
            current = typeof update === 'function' ? update(current) : update;
        });
        const models = ['flux-dev', 'sdxl_base', ...Array.from({ length: 8 }, (_, index) => `model-${index}`)];
        const { container } = render(<ArchitectureSection filters={current} setFilters={setFilters} models={models} isOpen onToggle={vi.fn()} />);

        expect(container.querySelector('.max-h-48')).toBeTruthy();
        fireEvent.click(screen.getByText('flux-dev'));
        expect(current.models).toEqual([]);
        fireEvent.click(screen.getByText('sdxl_base'));
        expect(current.models).toEqual(['sdxl_base']);

        fireEvent.click(screen.getByRole('button', { name: 'Search Models' }));
        fireEvent.change(screen.getByPlaceholderText('Search models...'), { target: { value: 'missing' } });
        expect(screen.getByText('No models found')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Hide Model Search' }));
        expect(screen.queryByPlaceholderText('Search models...')).toBeNull();
    });
});
