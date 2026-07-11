import { fireEvent, render, screen } from '../../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type FilterState } from '../../../../types';
import { GeneratorSection } from '../GeneratorSection';

vi.mock('../FilterPrimitives', () => ({
    SectionHeader: ({ title, onToggle }: { title: string; onToggle: () => void }) => <button onClick={onToggle}>{title}</button>,
    SelectableRow: ({ label, isSelected, disabled, className, onClick }: { label: string; isSelected: boolean; disabled?: boolean; className?: string; onClick: () => void }) => (
        <button onClick={onClick} disabled={disabled} data-selected={isSelected} className={className}>{label}</button>
    )
}));

const filters = (tools: GeneratorTool[] = []): FilterState => ({
    searchQuery: '', models: [], tools, loras: [], embeddings: [], hypernetworks: [], samplers: [], generationTypes: [],
    controlNets: [], ipAdapters: [], dateRange: 'all', favoritesOnly: false, collectionId: null
});

describe('GeneratorSection', () => {
    it('renders only the header while collapsed and forwards toggles', () => {
        const onToggle = vi.fn();
        render(<GeneratorSection filters={filters()} setFilters={vi.fn()} tools={['ComfyUI']} isOpen={false} onToggle={onToggle} />);
        fireEvent.click(screen.getByText('Generator'));
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('ComfyUI')).toBeNull();
    });

    it('adds and removes tools while preserving selected drill-down values', () => {
        let current = filters([GeneratorTool.COMFYUI]);
        const setFilters = vi.fn((update: (previous: FilterState) => FilterState) => { current = update(current); });
        render(
            <GeneratorSection
                filters={current}
                setFilters={setFilters}
                tools={[GeneratorTool.COMFYUI, GeneratorTool.INVOKEAI, GeneratorTool.FORGE]}
                validNames={[GeneratorTool.INVOKEAI]}
                isOpen
                onToggle={vi.fn()}
            />
        );
        expect((screen.getByText(GeneratorTool.COMFYUI) as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByText(GeneratorTool.INVOKEAI) as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByText(GeneratorTool.FORGE) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText(GeneratorTool.FORGE).className).toContain('line-through');
        fireEvent.click(screen.getByText(GeneratorTool.COMFYUI));
        expect(current.tools).toEqual([]);
        fireEvent.click(screen.getByText(GeneratorTool.INVOKEAI));
        expect(current.tools).toEqual([GeneratorTool.INVOKEAI]);
    });

    it.each([null, undefined])('makes every tool available when valid names are %s', (validNames) => {
        render(<GeneratorSection filters={filters()} setFilters={vi.fn()} tools={[GeneratorTool.AUTOMATIC1111]} validNames={validNames} isOpen onToggle={vi.fn()} />);
        expect((screen.getByText(GeneratorTool.AUTOMATIC1111) as HTMLButtonElement).disabled).toBe(false);
    });

    it('distinguishes loading, globally empty, and drill-down empty states', () => {
        const props = { filters: filters(), setFilters: vi.fn(), tools: [] as string[], isOpen: true, onToggle: vi.fn() };
        const { rerender } = render(<GeneratorSection {...props} isLoading />);
        expect(screen.getByText('Loading Tools...')).toBeTruthy();
        rerender(<GeneratorSection {...props} validNames={null} />);
        expect(screen.getByText('No specific tools found')).toBeTruthy();
        rerender(<GeneratorSection {...props} validNames={[]} />);
        expect(screen.getByText('No matching tools in current filter')).toBeTruthy();
    });
});
