import { fireEvent, render, screen } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GuidanceSection } from '../GuidanceSection';
import type { FilterState } from '../../../../types';

const queryMocks = vi.hoisted(() => ({
    data: undefined as GuidanceRanges | undefined,
    isLoading: false
}));

type GuidanceRanges = {
    controlNets: string[];
    ipAdapters: string[];
    guidanceSubtypes?: Record<string, string>;
};

vi.mock('../../../../hooks/useParameterRangesQuery', () => ({
    useParameterRangesQuery: vi.fn(() => ({
        data: queryMocks.data,
        isLoading: queryMocks.isLoading
    }))
}));

const createFilters = (overrides: Partial<FilterState> = {}): FilterState => ({
    searchQuery: '',
    models: [],
    tools: [],
    loras: [],
    embeddings: [],
    hypernetworks: [],
    samplers: [],
    generationTypes: [],
    controlNets: [],
    ipAdapters: [],
    dateRange: 'all',
    favoritesOnly: false,
    collectionId: null,
    ...overrides
});

const createHarness = (initialFilters = createFilters()) => {
    let currentFilters = initialFilters;
    const setFilters = vi.fn((update: (prev: FilterState) => FilterState) => {
        currentFilters = update(currentFilters);
    });

    return {
        getCurrentFilters: () => currentFilters,
        setFilters
    };
};

describe('GuidanceSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queryMocks.data = undefined;
        queryMocks.isLoading = false;
    });

    it('renders only the section header while collapsed', () => {
        const onToggle = vi.fn();
        render(
            <GuidanceSection
                filters={createFilters()}
                setFilters={vi.fn()}
                isOpen={false}
                onToggle={onToggle}
            />
        );

        fireEvent.click(screen.getByText('Guidance'));

        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(/No guidance data available/i)).toBeNull();
    });

    it('shows the empty state only after loading finishes', () => {
        queryMocks.data = {
            controlNets: [],
            ipAdapters: []
        };

        render(
            <GuidanceSection
                filters={createFilters()}
                setFilters={vi.fn()}
                isOpen
                onToggle={vi.fn()}
            />
        );

        expect(screen.getByText('No guidance data available')).toBeTruthy();
    });

    it('maps ControlNet type buttons back to the concrete model names used by filters', () => {
        queryMocks.data = {
            controlNets: [
                'C:/models/controlnet/model.safetensors',
                'custom-controlnet-depth.safetensors',
                'unclassified-control.safetensors'
            ],
            ipAdapters: [],
            guidanceSubtypes: {
                'C:/models/controlnet/model.safetensors': 'canny'
            }
        };
        const harness = createHarness();

        render(
            <GuidanceSection
                filters={harness.getCurrentFilters()}
                setFilters={harness.setFilters}
                isOpen
                onToggle={vi.fn()}
            />
        );

        fireEvent.click(screen.getByText('Canny'));
        expect(harness.getCurrentFilters().controlNets).toEqual([
            'C:/models/controlnet/model.safetensors'
        ]);

        fireEvent.click(screen.getByText('Depth'));
        expect(harness.getCurrentFilters().controlNets).toEqual([
            'custom-controlnet-depth.safetensors'
        ]);

        fireEvent.click(screen.getByText('Other'));
        expect(harness.getCurrentFilters().controlNets).toEqual([
            'unclassified-control.safetensors'
        ]);
    });

    it('collapses guidance groups without changing selected filters', () => {
        queryMocks.data = {
            controlNets: ['controlnet-canny.safetensors'],
            ipAdapters: ['ip-adapter-faceid-plus.bin']
        };
        const harness = createHarness(createFilters({
            controlNets: ['controlnet-canny.safetensors']
        }));

        render(
            <GuidanceSection
                filters={harness.getCurrentFilters()}
                setFilters={harness.setFilters}
                isOpen
                onToggle={vi.fn()}
            />
        );

        fireEvent.click(screen.getByText(/ControlNets \(1\)/));

        expect(screen.queryByText('Canny')).toBeNull();
        expect(harness.setFilters).not.toHaveBeenCalled();
    });

    it('classifies IP-Adapter names from paths while backend signatures catch exact subtypes', () => {
        queryMocks.data = {
            controlNets: [],
            ipAdapters: [
                'models/ip-adapter-faceid-plus/model.bin',
                'portrait-reference.safetensors',
                'generic-reference.bin'
            ],
            guidanceSubtypes: {
                'generic-reference.bin': 'style'
            }
        };
        const harness = createHarness();

        render(
            <GuidanceSection
                filters={harness.getCurrentFilters()}
                setFilters={harness.setFilters}
                isOpen
                onToggle={vi.fn()}
            />
        );

        fireEvent.click(screen.getByText('FaceID Plus'));
        expect(harness.getCurrentFilters().ipAdapters).toEqual([
            'models/ip-adapter-faceid-plus/model.bin'
        ]);

        fireEvent.click(screen.getByText('Portrait'));
        expect(harness.getCurrentFilters().ipAdapters).toEqual([
            'portrait-reference.safetensors'
        ]);

        fireEvent.click(screen.getByText('Style'));
        expect(harness.getCurrentFilters().ipAdapters).toEqual([
            'generic-reference.bin'
        ]);
    });
});
