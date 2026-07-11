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

    it('classifies every supported ControlNet subtype and generic path fallback', () => {
        const models = [
            'controlnet-canny.safetensors',
            'controlnet-canny-second.safetensors',
            'control_depth.ckpt',
            'cnet-pose.pth',
            'soft_edge-control.bin',
            'control-lineart.pt',
            'normal-control.safetensors',
            'inpaint-control.safetensors',
            'tile-control.safetensors',
            'segmentation-control.safetensors',
            'shuffle-control.safetensors',
            'recolor-control.safetensors',
            'mlsd-control.safetensors',
            'controlnet-unknown.safetensors',
            'C:/models/custom/controlnet/model.safetensors',
            'mystery.safetensors'
        ];
        queryMocks.data = { controlNets: models, ipAdapters: [] };
        const harness = createHarness(createFilters({ controlNets: models }));
        render(<GuidanceSection filters={harness.getCurrentFilters()} setFilters={harness.setFilters} isOpen onToggle={vi.fn()} />);

        for (const label of ['Canny', 'Depth', 'Pose', 'Scribble', 'Lineart', 'Normal', 'Inpaint', 'Tile', 'Seg', 'Shuffle', 'Recolor', 'MLSD', 'Other']) {
            expect(screen.getByText(label)).toBeTruthy();
        }
        fireEvent.click(screen.getByText('MLSD'));
        expect(harness.getCurrentFilters().controlNets).not.toContain('mlsd-control.safetensors');
    });

    it('classifies every supported IP-Adapter subtype', () => {
        const models = [
            'ip-adapter-faceid-plus.bin',
            'ip-adapter-faceid-plus-second.bin',
            'face-id-model.bin',
            'face-plus-model.bin',
            'portrait-model.bin',
            'ip-adapter-vit-h.bin',
            'ip-adapter-style.bin',
            'ip-adapter-composition.bin',
            'ip-adapter-light.bin',
            'full-face-model.bin',
            'ip-adapter-basic.bin',
            'unclassified.bin'
        ];
        queryMocks.data = { controlNets: [], ipAdapters: models };
        const harness = createHarness(createFilters({ ipAdapters: models }));
        render(<GuidanceSection filters={harness.getCurrentFilters()} setFilters={harness.setFilters} isOpen onToggle={vi.fn()} />);

        for (const label of ['FaceID Plus', 'FaceID', 'Plus Face', 'Portrait', 'Plus', 'Style', 'Comp', 'Light', 'Full Face', 'Standard', 'Other']) {
            expect(screen.getByText(label)).toBeTruthy();
        }
        fireEvent.click(screen.getByText('Comp'));
        expect(harness.getCurrentFilters().ipAdapters).not.toContain('ip-adapter-composition.bin');
    });

    it('collapses the IP-Adapter group and suppresses empty state while loading', () => {
        queryMocks.data = { controlNets: [], ipAdapters: ['ip-adapter-basic.bin'] };
        queryMocks.isLoading = true;
        const view = render(<GuidanceSection filters={createFilters()} setFilters={vi.fn()} isOpen onToggle={vi.fn()} />);
        fireEvent.click(screen.getByText(/IP-Adapters \(1\)/));
        expect(screen.queryByText('Standard')).toBeNull();

        queryMocks.data = { controlNets: [], ipAdapters: [] };
        view.rerender(<GuidanceSection filters={createFilters()} setFilters={vi.fn()} isOpen onToggle={vi.fn()} />);
        expect(screen.queryByText('No guidance data available')).toBeNull();
    });

    it('handles empty names and selected models absent from available ranges', () => {
        queryMocks.data = { controlNets: [''], ipAdapters: [''] };
        render(<GuidanceSection
            filters={createFilters({ controlNets: ['missing-control'], ipAdapters: ['missing-adapter'] })}
            setFilters={vi.fn()}
            isOpen
            onToggle={vi.fn()}
        />);
        expect(screen.getAllByText('Other')).toHaveLength(2);
    });
});
