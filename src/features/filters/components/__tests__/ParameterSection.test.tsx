import { fireEvent, render, screen } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterState } from '../../../../types';
import { ParameterSection } from '../ParameterSection';

const mocks = vi.hoisted(() => ({
    data: undefined as {
        steps: { min: number; max: number } | null;
        cfg: { min: number; max: number } | null;
        samplers: string[];
        generationTypes: string[];
    } | undefined,
    isLoading: false
}));

vi.mock('../../../../hooks/useParameterRangesQuery', () => ({
    useParameterRangesQuery: vi.fn(() => ({ data: mocks.data, isLoading: mocks.isLoading }))
}));

vi.mock('../FilterPrimitives', () => ({
    SectionHeader: ({ title, onToggle }: { title: string; onToggle: () => void }) => (
        <button onClick={onToggle}>{title}</button>
    ),
    FilterSlider: ({ label, min, max, step, onChange }: {
        label: string;
        min: number;
        max: number;
        step?: number;
        onChange: (min: number, max: number) => void;
    }) => <button onClick={() => onChange(min + 1, max - 1)}>{label}:{min}:{max}:{step ?? 1}</button>,
    MultiSelectDropdown: ({ groups, onChange }: {
        groups: Array<{ label: string; items: string[] }>;
        onChange: (values: string[]) => void;
    }) => (
        <button onClick={() => onChange(['Euler'])}>
            {groups.map(group => `${group.label}=${group.items.join(',')}`).join('|')}
        </button>
    ),
    ChipSelect: ({ options, formatLabel, onChange }: {
        options: string[];
        formatLabel: (value: string) => string;
        onChange: (values: string[]) => void;
    }) => (
        <button onClick={() => onChange(['txt2img'])}>
            {options.map(formatLabel).join('|')}
        </button>
    )
}));

const createFilters = (overrides: Partial<FilterState> = {}): FilterState => ({
    searchQuery: '', models: [], tools: [], loras: [], embeddings: [], hypernetworks: [],
    samplers: [], generationTypes: [], controlNets: [], ipAdapters: [], dateRange: 'all',
    favoritesOnly: false, collectionId: null, ...overrides
});

describe('ParameterSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.data = undefined;
        mocks.isLoading = false;
    });

    it('renders only the header while collapsed', () => {
        const onToggle = vi.fn();
        render(<ParameterSection filters={createFilters()} setFilters={vi.fn()} isOpen={false} onToggle={onToggle} />);

        fireEvent.click(screen.getByText('Parameters'));
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('No parameter data available')).toBeNull();
    });

    it('shows an empty state after loading when no ranges exist', () => {
        mocks.data = { steps: null, cfg: null, samplers: [], generationTypes: [] };
        const setFilters = vi.fn();
        const onToggle = vi.fn();
        const { rerender } = render(<ParameterSection filters={createFilters()} setFilters={setFilters} isOpen onToggle={onToggle} />);
        expect(screen.getByText('No parameter data available')).toBeTruthy();

        mocks.isLoading = true;
        rerender(<ParameterSection filters={createFilters()} setFilters={setFilters} isOpen onToggle={onToggle} />);
        expect(screen.queryByText('No parameter data available')).toBeNull();
    });

    it('groups canonical samplers and applies every parameter update', () => {
        mocks.data = {
            steps: { min: 1.2, max: 9.1 },
            cfg: { min: 2.2, max: 8.1 },
            samplers: ['Euler a', 'euler_a', 'DPM++ 2M', 'LMS', 'Heun', 'DDIM', 'UniPC', 'uni pc custom', 'Deis', 'Zeta'],
            generationTypes: ['txt2img', 'img2img', 'extras', 'grid', 'saved', 'unknown', 'custom']
        };
        let filters = createFilters();
        const setFilters = vi.fn((update: (previous: FilterState) => FilterState) => {
            filters = update(filters);
        });
        render(<ParameterSection filters={filters} setFilters={setFilters} isOpen onToggle={vi.fn()} />);

        fireEvent.click(screen.getByText('Steps:1:10:1'));
        expect(filters).toMatchObject({ minSteps: 2, maxSteps: 9 });
        fireEvent.click(screen.getByText('CFG Scale:2:9:0.5'));
        expect(filters).toMatchObject({ minCfg: 3, maxCfg: 8 });

        const samplerButton = screen.getByText(/DDIM=DDIM/);
        expect(samplerButton.textContent).toContain('Euler=Euler a');
        expect(samplerButton.textContent).toContain('Other=Zeta');
        expect(samplerButton.textContent?.endsWith('Other=Zeta')).toBe(true);
        fireEvent.click(samplerButton);
        expect(filters.samplers).toEqual(['Euler']);

        const generationButton = screen.getByText(/Text to Image/);
        expect(generationButton.textContent).toBe('Text to Image|Image to Image|Extras/Upscale|Grid|Saved|Unknown|custom');
        fireEvent.click(generationButton);
        expect(filters.generationTypes).toEqual(['txt2img']);

        filters = { ...filters, samplers: undefined as unknown as string[], generationTypes: undefined as unknown as string[] };
        const { rerender } = render(<ParameterSection filters={filters} setFilters={setFilters} isOpen onToggle={vi.fn()} />);
        rerender(<ParameterSection filters={filters} setFilters={setFilters} isOpen onToggle={vi.fn()} />);
        expect(screen.getAllByText(/DDIM=DDIM/)).toHaveLength(2);
    });
});
