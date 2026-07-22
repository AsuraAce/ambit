import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ResourceSection, type AssetScope } from '../ResourceSection';
import type { FilterState, SidebarSortOption } from '../../../../types';

const commandMocks = vi.hoisted(() => ({
    setResourceThumbnailSensitivity: vi.fn(),
    unsetModelThumbnail: vi.fn(),
    clearAllThumbnails: vi.fn()
}));

const settingsContextMocks = vi.hoisted(() => ({
    resourceSortOptions: {} as Record<string, SidebarSortOption>,
    resourceViewModes: { loras: 'list' } as Record<string, 'list' | 'grid'>,
    setSettings: vi.fn()
}));

vi.mock('../../../../bindings', () => ({
    commands: commandMocks
}));

vi.mock('../../../../contexts/SettingsContext', () => ({
    useSettings: () => ({
        settings: {
            resourceViewModes: settingsContextMocks.resourceViewModes,
            resourceSortOptions: settingsContextMocks.resourceSortOptions,
            maskingMode: 'blur'
        },
        setSettings: settingsContextMocks.setSettings,
        privacyEnabled: true
    })
}));

vi.mock('../../../../components/ui/PrivacyAwareThumbnail', () => ({
    PrivacyAwareThumbnail: () => <div data-testid="privacy-aware-thumbnail" />
}));

const filters: FilterState = {
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
    collectionId: null
};

beforeEach(() => {
    settingsContextMocks.resourceSortOptions = {};
    settingsContextMocks.resourceViewModes = { loras: 'list' };
    settingsContextMocks.setSettings.mockClear();
});

const setResourceSort = (sort: SidebarSortOption) => {
    settingsContextMocks.resourceSortOptions = { loras: sort };
};

const expectResourceOrder = (names: string[]) => {
    for (let index = 0; index < names.length - 1; index += 1) {
        const current = screen.getByText(names[index]);
        const next = screen.getByText(names[index + 1]);
        expect(current.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
};

describe('ResourceSection thumbnail privacy menu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        commandMocks.setResourceThumbnailSensitivity.mockResolvedValue({ status: 'ok', data: null });
        commandMocks.unsetModelThumbnail.mockResolvedValue({ status: 'ok', data: null });
        commandMocks.clearAllThumbnails.mockResolvedValue({ status: 'ok', data: null });
    });

    const renderSection = (thumbnailSensitivityOverride: number | null = null) => render(
        <ResourceSection
            title="Resources"
            type="loras"
            filters={filters}
            setFilters={vi.fn()}
            data={[{
                name: 'Alpha',
                hash: 'lora_Alpha',
                count: 1,
                thumbnailPath: 'alpha.webp',
                thumbnailSensitivityOverride,
                isManual: 1,
                hasSidecar: 1,
                isUserOverride: 1
            }]}
            isOpen
            onToggle={vi.fn()}
        />
    );

    it('calls the sensitivity command for mask, show, and reset actions', async () => {
        const firstRender = renderSection();

        fireEvent.contextMenu(screen.getByText('Alpha'));
        fireEvent.click(screen.getByText('Mask Thumbnail'));

        await waitFor(() => {
            expect(commandMocks.setResourceThumbnailSensitivity).toHaveBeenCalledWith('lora_Alpha', 'Alpha', true, 'loras');
        });

        fireEvent.contextMenu(screen.getByText('Alpha'));
        fireEvent.click(screen.getByText('Always Show Thumbnail'));

        await waitFor(() => {
            expect(commandMocks.setResourceThumbnailSensitivity).toHaveBeenCalledWith('lora_Alpha', 'Alpha', false, 'loras');
        });

        firstRender.unmount();
        renderSection(1);

        fireEvent.contextMenu(screen.getByText('Alpha'));
        fireEvent.click(screen.getByText('Reset Thumbnail Privacy'));

        await waitFor(() => {
            expect(commandMocks.setResourceThumbnailSensitivity).toHaveBeenCalledWith('lora_Alpha', 'Alpha', null, 'loras');
        });
    });

    it('passes resource type to preview and dynamic thumbnail actions', async () => {
        renderSection();

        fireEvent.contextMenu(screen.getByText('Alpha'));
        fireEvent.click(screen.getByText('Use Preview'));

        await waitFor(() => {
            expect(commandMocks.unsetModelThumbnail).toHaveBeenCalledWith('lora_Alpha', 'Alpha', 'loras');
        });

        fireEvent.contextMenu(screen.getByText('Alpha'));
        fireEvent.click(screen.getByText('Use Dynamic'));

        await waitFor(() => {
            expect(commandMocks.clearAllThumbnails).toHaveBeenCalledWith('lora_Alpha', 'Alpha', 'loras');
        });
    });
});

describe('ResourceSection asset scope filtering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderScopedSection = ({
        assetScope = 'used',
        validNames,
        setFilters = vi.fn()
    }: {
        assetScope?: AssetScope;
        validNames?: string[] | null;
        setFilters?: (update: (prev: FilterState) => FilterState) => void;
    } = {}) => render(
        <ResourceSection
            title="Resources"
            type="loras"
            filters={filters}
            setFilters={setFilters}
            data={[
                {
                    name: 'UnusedLocal',
                    hash: 'file:C:/models/UnusedLocal.safetensors',
                    count: 0,
                    isLocalDisk: true
                },
                {
                    name: 'UsedLocal',
                    hash: 'lora_UsedLocal',
                    count: 3,
                    isLocalDisk: true
                },
                {
                    name: 'HarvestedOnly',
                    hash: 'lora_HarvestedOnly',
                    count: 2
                }
            ]}
            isOpen
            onToggle={vi.fn()}
            assetScope={assetScope}
            validNames={validNames}
        />
    );

    it('hides zero-count local assets in the used scope', () => {
        renderScopedSection();

        expect(screen.queryByText('UnusedLocal')).toBeNull();
        expect(screen.getByText('UsedLocal')).toBeTruthy();
        expect(screen.getByText('HarvestedOnly')).toBeTruthy();
    });

    it('shows zero-count local assets in the local scope', () => {
        renderScopedSection({ assetScope: 'local' });

        expect(screen.getByText('UnusedLocal')).toBeTruthy();
        expect(screen.queryByText('Unused', { exact: true })).toBeNull();
        expect(screen.getByLabelText('Local only: no indexed library images.')).toBeTruthy();
        expect(screen.getByText('UsedLocal')).toBeTruthy();
        expect(screen.getByLabelText('Local asset on disk')).toBeTruthy();
        expect(screen.queryByText('HarvestedOnly')).toBeNull();
    });

    it('does not toggle filters when a local-only asset is clicked', () => {
        const setFilters = vi.fn();
        renderScopedSection({ assetScope: 'local', setFilters });

        fireEvent.click(screen.getByText('UnusedLocal'));

        expect(setFilters).not.toHaveBeenCalled();
    });

    it('still toggles filters for used local assets', () => {
        const setFilters = vi.fn();
        renderScopedSection({ assetScope: 'local', setFilters });

        fireEvent.click(screen.getByText('UsedLocal'));

        expect(setFilters).toHaveBeenCalledTimes(1);
    });

    it('ignores validNames in the local scope', () => {
        renderScopedSection({ assetScope: 'local', validNames: ['DifferentLora'] });

        expect(screen.getByText('UnusedLocal')).toBeTruthy();
        expect(screen.getByText('UsedLocal')).toBeTruthy();
    });

    it('stores aliases for merged used local assets when clicked', () => {
        let nextFilters: FilterState = filters;
        const setFilters = vi.fn((update: (prev: FilterState) => FilterState) => {
            nextFilters = update(filters);
        });

        render(
            <ResourceSection
                title="Resources"
                type="loras"
                filters={filters}
                setFilters={setFilters}
                data={[{
                    name: 'Detailer-Style',
                    hash: 'lora_Detailer-Style',
                    count: 7,
                    isLocalDisk: true,
                    filterAliases: ['Detailer-Style', 'detailer style']
                }]}
                isOpen
                onToggle={vi.fn()}
                assetScope="used"
            />
        );

        fireEvent.click(screen.getByText('Detailer-Style'));

        expect(nextFilters.loras).toEqual(['Detailer-Style']);
        expect(nextFilters.assetFilterAliases?.loras?.['Detailer-Style']).toEqual(['Detailer-Style', 'detailer style']);
    });

    it('matches merged resource aliases in the local search box', () => {
        render(
            <ResourceSection
                title="Resources"
                type="loras"
                filters={filters}
                setFilters={vi.fn()}
                data={[{
                    name: 'Flux Style - watercolor_flux_v1.1_rank_16_bf16',
                    hash: 'lora_Flux Style - watercolor_flux_v1.1_rank_16_bf16',
                    count: 2,
                    isLocalDisk: true,
                    filterAliases: [
                        'Flux Style - watercolor_flux_v1.1_rank_16_bf16',
                        'watercolor_flux_v1.1_rank_16_bf16'
                    ]
                }]}
                isOpen
                onToggle={vi.fn()}
                assetScope="used"
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Search LoRAs' }));
        fireEvent.change(screen.getByPlaceholderText('Search LoRAs...'), {
            target: { value: 'watercolor_flu' }
        });

        expect(screen.getByText('Flux Style - watercolor_flux_v1.1_rank_16_bf16')).toBeTruthy();
    });

    it('keeps merged aliases visible when a valid alias exists in the current result set', () => {
        render(
            <ResourceSection
                title="Resources"
                type="loras"
                filters={filters}
                setFilters={vi.fn()}
                data={[{
                    name: 'Detailer-Style',
                    hash: 'lora_Detailer-Style',
                    count: 7,
                    isLocalDisk: true,
                    filterAliases: ['Detailer-Style', 'detailer style']
                }]}
                isOpen
                onToggle={vi.fn()}
                assetScope="used"
                validNames={['detailer style']}
            />
        );

        expect(screen.getByText('Detailer-Style')).toBeTruthy();
    });

    it('explains sidecar previews on local-only asset badges', () => {
        render(
            <ResourceSection
                title="Resources"
                type="loras"
                filters={filters}
                setFilters={vi.fn()}
                data={[{
                    name: 'SidecarOnly',
                    hash: 'file:C:/models/SidecarOnly.safetensors',
                    count: 0,
                    isLocalDisk: true,
                    thumbnailPath: 'sidecar.webp',
                    hasSidecar: 1,
                    thumbnailSource: 'sidecar'
                }]}
                isOpen
                onToggle={vi.fn()}
                assetScope="local"
            />
        );

        expect(screen.getByLabelText('Local only: no indexed library images. Preview from sidecar image.')).toBeTruthy();
    });

    it('does not describe an available sidecar when a manual preview is displayed', () => {
        render(
            <ResourceSection
                title="Resources"
                type="loras"
                filters={filters}
                setFilters={vi.fn()}
                data={[{
                    name: 'ManualPreview',
                    hash: 'file:C:/models/ManualPreview.safetensors',
                    count: 0,
                    isLocalDisk: true,
                    thumbnailPath: 'manual.webp',
                    hasSidecar: 1,
                    isUserOverride: 1,
                    thumbnailSource: 'manual'
                }]}
                isOpen
                onToggle={vi.fn()}
                assetScope="local"
            />
        );

        expect(screen.getByLabelText('Local only: no indexed library images.')).toBeTruthy();
        expect(screen.queryByLabelText(/Preview from sidecar image/)).toBeNull();
    });
});

describe('ResourceSection match mode controls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not render the Match Any/All toggle for checkpoints', () => {
        render(
            <ResourceSection
                title="Checkpoints"
                type="checkpoints"
                filters={filters}
                setFilters={vi.fn()}
                data={[{
                    name: 'Flux',
                    hash: 'model_Flux',
                    count: 3
                }]}
                isOpen
                onToggle={vi.fn()}
            />
        );

        expect(screen.queryByRole('button', { name: /match mode/i })).toBeNull();
    });

    it('explains and updates Match Any/All for multi-valued resources', () => {
        let nextFilters = filters;
        const setFilters = vi.fn((update: (prev: FilterState) => FilterState) => {
            nextFilters = update(filters);
        });
        const view = render(
            <ResourceSection
                title="Resources"
                type="loras"
                filters={filters}
                setFilters={setFilters}
                data={[{
                    name: 'Detailer',
                    hash: 'lora_Detailer',
                    count: 3
                }]}
                isOpen
                onToggle={vi.fn()}
            />
        );

        expect(screen.queryByRole('button', { name: 'About Resources match modes' })).toBeNull();

        const matchAnyButton = screen.getByRole('button', { name: /Resources match mode: Match Any/i });
        fireEvent.focus(matchAnyButton);
        expect(screen.getByRole('tooltip').textContent).toBe('Match Any: Show images containing at least one selected item.');

        fireEvent.click(matchAnyButton);
        expect(nextFilters.matchModes?.loras).toBe('all');
        expect(screen.queryByRole('tooltip')).toBeNull();

        view.rerender(
            <ResourceSection
                title="Resources"
                type="loras"
                filters={nextFilters}
                setFilters={setFilters}
                data={[{
                    name: 'Detailer',
                    hash: 'lora_Detailer',
                    count: 3
                }]}
                isOpen
                onToggle={vi.fn()}
            />
        );

        const matchAllButton = screen.getByRole('button', { name: /Resources match mode: Match All/i });
        expect(matchAllButton.getAttribute('aria-pressed')).toBe('true');
        fireEvent.blur(matchAllButton);
        fireEvent.focus(matchAllButton);
        expect(screen.getByRole('tooltip').textContent).toBe('Match All: Show images containing every selected item.');
    });
});

describe('ResourceSection toolbar tooltips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('explains icon actions without native titles and preserves toolbar behavior', () => {
        render(
            <ResourceSection
                title="Resources"
                type="loras"
                filters={filters}
                setFilters={vi.fn()}
                data={[{
                    name: 'Detailer',
                    hash: 'lora_Detailer',
                    count: 3
                }]}
                isOpen
                onToggle={vi.fn()}
            />
        );

        const sortButton = screen.getByRole('button', { name: 'Sort LoRAs' });
        expect(sortButton.getAttribute('title')).toBeNull();
        expect(sortButton.getAttribute('aria-haspopup')).toBeNull();
        expect(sortButton.getAttribute('aria-expanded')).toBe('false');
        fireEvent.mouseEnter(sortButton);
        expect(screen.getByRole('tooltip').textContent).toBe('Sort LoRAs');
        fireEvent.mouseLeave(sortButton);

        fireEvent.click(sortButton);
        const nameSortOption = screen.getByRole('button', { name: 'Name (A-Z)' });
        fireEvent.pointerDown(nameSortOption);
        fireEvent.click(nameSortOption);
        expect(settingsContextMocks.setSettings).toHaveBeenCalled();

        const viewButton = screen.getByRole('button', { name: 'Switch to Grid View' });
        expect(viewButton.getAttribute('title')).toBeNull();
        expect(viewButton.getAttribute('aria-pressed')).toBe('false');
        fireEvent.keyDown(document, { key: 'Tab' });
        fireEvent.focus(viewButton);
        expect(screen.getByRole('tooltip').textContent).toBe('Switch to Grid View');
        fireEvent.blur(viewButton);
        fireEvent.click(viewButton);
        expect(settingsContextMocks.setSettings).toHaveBeenCalledTimes(2);
        fireEvent.pointerDown(document.body);

        const searchButton = screen.getByRole('button', { name: 'Search LoRAs' });
        expect(searchButton.getAttribute('title')).toBeNull();
        expect(searchButton.getAttribute('aria-expanded')).toBe('false');
        fireEvent.mouseEnter(searchButton);
        expect(screen.getByRole('tooltip').textContent).toBe('Search LoRAs');
        fireEvent.mouseLeave(searchButton);
        fireEvent.click(searchButton);
        expect(searchButton.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByPlaceholderText('Search LoRAs...')).toBeTruthy();
    });
});

describe('ResourceSection asset sorting', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderSortingSection = ({
        assetScope,
        data
    }: {
        assetScope: AssetScope;
        data: ComponentProps<typeof ResourceSection>['data'];
    }) => render(
        <ResourceSection
            title="Resources"
            type="loras"
            filters={filters}
            setFilters={vi.fn()}
            data={data}
            isOpen
            onToggle={vi.fn()}
            assetScope={assetScope}
        />
    );

    it('sorts all-scope local-only assets by local modified date for Newest Added', () => {
        setResourceSort('added_desc');

        renderSortingSection({
            assetScope: 'all',
            data: [
                {
                    name: 'OlderUsedOnly',
                    hash: 'lora_OlderUsedOnly',
                    count: 12,
                    createdAt: 800
                },
                {
                    name: 'NewestLocalUnused',
                    hash: 'file:C:/models/NewestLocalUnused.safetensors',
                    count: 0,
                    isLocalDisk: true,
                    createdAt: 100,
                    localModifiedAt: 900
                }
            ]
        });

        expectResourceOrder(['NewestLocalUnused', 'OlderUsedOnly']);
    });

    it('sorts all-scope used local assets by local modified date for Newest Added', () => {
        setResourceSort('added_desc');

        renderSortingSection({
            assetScope: 'all',
            data: [
                {
                    name: 'OlderUsedOnly',
                    hash: 'lora_OlderUsedOnly',
                    count: 2,
                    createdAt: 900
                },
                {
                    name: 'NewestUsedLocal',
                    hash: 'lora_NewestUsedLocal',
                    count: 10,
                    isLocalDisk: true,
                    createdAt: 100,
                    localModifiedAt: 1000
                }
            ]
        });

        expectResourceOrder(['NewestUsedLocal', 'OlderUsedOnly']);
    });

    it('sorts all-scope local assets ahead of used-only assets with realistic timestamps', () => {
        setResourceSort('added_desc');

        renderSortingSection({
            assetScope: 'all',
            data: [
                {
                    name: 'OlderUsedOnly',
                    hash: 'lora_OlderUsedOnly',
                    count: 12,
                    createdAt: 1_700_000_000_000
                },
                {
                    name: 'RecentlyDownloadedLocal',
                    hash: 'file:C:/models/RecentlyDownloadedLocal.safetensors',
                    count: 0,
                    isLocalDisk: true,
                    createdAt: 1_600_000_000_000,
                    localModifiedAt: 1_700_100_000_000
                }
            ]
        });

        expectResourceOrder(['RecentlyDownloadedLocal', 'OlderUsedOnly']);
    });

    it('keeps used-scope Newest Added sorting based on library created date', () => {
        setResourceSort('added_desc');

        renderSortingSection({
            assetScope: 'used',
            data: [
                {
                    name: 'LocalFileNewer',
                    hash: 'lora_LocalFileNewer',
                    count: 10,
                    isLocalDisk: true,
                    createdAt: 100,
                    localModifiedAt: 1000
                },
                {
                    name: 'LibraryNewer',
                    hash: 'lora_LibraryNewer',
                    count: 2,
                    createdAt: 900
                }
            ]
        });

        expectResourceOrder(['LibraryNewer', 'LocalFileNewer']);
    });

    it('uses alphabetical ordering as the tie-breaker for equal primary sort values', () => {
        setResourceSort('count_desc');

        renderSortingSection({
            assetScope: 'used',
            data: [
                {
                    name: 'Beta',
                    hash: 'lora_Beta',
                    count: 5
                },
                {
                    name: 'Alpha',
                    hash: 'lora_Alpha',
                    count: 5
                }
            ]
        });

        expectResourceOrder(['Alpha', 'Beta']);
    });

    it('falls back to count sorting when a resource section has a collection-only date sort persisted', () => {
        setResourceSort('date_desc');

        renderSortingSection({
            assetScope: 'used',
            data: [
                {
                    name: 'NewerLowUse',
                    hash: 'lora_NewerLowUse',
                    count: 1,
                    createdAt: 900
                },
                {
                    name: 'OlderHighUse',
                    hash: 'lora_OlderHighUse',
                    count: 5,
                    createdAt: 100
                }
            ]
        });

        expectResourceOrder(['OlderHighUse', 'NewerLowUse']);
    });
});

describe('ResourceSection interactions and remaining states', () => {
    const renderBasic = (overrides: Partial<ComponentProps<typeof ResourceSection>> = {}) => {
        const props: ComponentProps<typeof ResourceSection> = {
            title: 'Resources',
            type: 'loras',
            filters,
            setFilters: vi.fn(),
            data: [{ name: 'Alpha', count: 3, hash: 'hash-alpha' }],
            isOpen: true,
            onToggle: vi.fn(),
            ...overrides
        };
        return { ...render(<ResourceSection {...props} />), props };
    };

    beforeEach(() => {
        vi.clearAllMocks();
        commandMocks.setResourceThumbnailSensitivity.mockResolvedValue({ status: 'ok', data: null });
        commandMocks.unsetModelThumbnail.mockResolvedValue({ status: 'ok', data: null });
        commandMocks.clearAllThumbnails.mockResolvedValue({ status: 'ok', data: null });
    });

    it('keeps content closed and delegates header toggling', () => {
        const { props } = renderBasic({ isOpen: false });
        expect(screen.queryByText('Alpha')).toBeNull();
        fireEvent.click(screen.getByText('Resources'));
        expect(props.onToggle).toHaveBeenCalledTimes(1);
    });

    it('persists view mode changes and renders the configured grid view', () => {
        const first = renderBasic();
        fireEvent.click(screen.getByRole('button', { name: 'Switch to Grid View' }));
        const update = settingsContextMocks.setSettings.mock.calls[0][0];
        expect(update({ resourceViewModes: { loras: 'list' } }).resourceViewModes.loras).toBe('grid');
        first.unmount();

        settingsContextMocks.resourceViewModes = { loras: 'grid' };
        renderBasic({ data: [{ name: 'Grid Item', count: 2, thumbnailPath: 'thumb.webp', isLocalDisk: true }] });
        expect(screen.getByRole('button', { name: 'Switch to List View' })).toBeTruthy();
        expect(screen.getByTitle('Grid Item')).toBeTruthy();
        expect(screen.getByTestId('privacy-aware-thumbnail')).toBeTruthy();
        expect(screen.getByLabelText('Local asset on disk')).toBeTruthy();
    });

    it('adds and removes aliased selections while preserving alias groups', () => {
        let current: FilterState = { ...filters, loras: [] };
        const setFilters = vi.fn((update: (prev: FilterState) => FilterState) => { current = update(current); });
        const item = { name: 'Alpha', count: 3, filterAliases: ['alpha alias'] };
        const first = renderBasic({ filters: current, setFilters, data: [item] });
        fireEvent.click(screen.getByText('Alpha'));
        expect(current.loras).toEqual(['Alpha']);
        expect(current.assetFilterAliases?.loras?.Alpha).toEqual(['Alpha', 'alpha alias']);
        first.unmount();

        const second = renderBasic({ filters: current, setFilters, data: [item] });
        fireEvent.click(screen.getByText('Alpha'));
        expect(current.loras).toEqual([]);
        expect(current.assetFilterAliases?.loras?.Alpha).toBeUndefined();
        second.unmount();
    });

    it('toggles match mode between all and any', () => {
        let current = { ...filters };
        const setFilters = vi.fn((update: (prev: FilterState) => FilterState) => { current = update(current); });
        const first = renderBasic({ filters: current, setFilters });
        fireEvent.click(screen.getByRole('button', { name: /Match Any/ }));
        expect(current.matchModes?.loras).toBe('all');
        first.unmount();

        const second = renderBasic({ filters: current, setFilters });
        fireEvent.click(screen.getByRole('button', { name: /Match All/ }));
        expect(current.matchModes?.loras).toBe('any');
        second.unmount();
    });

    it('opens, filters, and closes search while clearing the query', async () => {
        renderBasic({ data: [{ name: 'Alpha', count: 2 }, { name: 'Beta', count: 1 }] });
        fireEvent.click(screen.getByRole('button', { name: 'Search LoRAs' }));
        fireEvent.change(screen.getByPlaceholderText('Search LoRAs...'), { target: { value: 'alp' } });
        expect(screen.getByText('Alpha')).toBeTruthy();
        await waitFor(() => expect(screen.queryByText('Beta')).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Search LoRAs' }));
        expect(screen.queryByPlaceholderText('Search LoRAs...')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Search LoRAs' }));
        expect((screen.getByPlaceholderText('Search LoRAs...') as HTMLInputElement).value).toBe('');
        expect(screen.getByText('Beta')).toBeTruthy();
    });

    it('renders empty, no-match, and loading messages for every singular label', () => {
        const types: Array<[ComponentProps<typeof ResourceSection>['type'], string]> = [
            ['loras', 'LoRAs'], ['embeddings', 'Embeddings'], ['checkpoints', 'Checkpoints'],
            ['controlNets', 'ControlNets'], ['ipAdapters', 'IP-Adapters'], ['hypernetworks', 'Hypernetworks']
        ];
        for (const [type, label] of types) {
            const view = renderBasic({ type, data: [] });
            expect(screen.getByText(`No ${label} found`)).toBeTruthy();
            view.unmount();
        }

        const noMatch = renderBasic({ data: [{ name: 'Alpha', count: 1 }] });
        fireEvent.click(screen.getByRole('button', { name: 'Search LoRAs' }));
        fireEvent.change(screen.getByPlaceholderText('Search LoRAs...'), { target: { value: 'zzz' } });
        expect(screen.getByText('No matching LoRAs')).toBeTruthy();
        noMatch.unmount();

        renderBasic({ data: [], isLoading: true });
        expect(screen.getByText('Loading LoRAs...')).toBeTruthy();
    });

    it('paginates resource items in batches of thirty', () => {
        const data = Array.from({ length: 31 }, (_, index) => ({ name: `Item ${String(index).padStart(2, '0')}`, count: 31 - index }));
        renderBasic({ data });
        expect(screen.queryByText('Item 30')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /show more/i }));
        expect(screen.getByText('Item 30')).toBeTruthy();
    });

    it.each([
        ['count_asc', ['Low', 'High']],
        ['name_asc', ['Alpha', 'Zulu']],
        ['name_desc', ['Zulu', 'Alpha']],
        ['recent_desc', ['Recent', 'Old']],
        ['recent_asc', ['Old', 'Recent']],
        ['added_asc', ['Old', 'Recent']]
    ] as const)('sorts using %s', (sort, order) => {
        const expectedOrder: readonly string[] = order;
        setResourceSort(sort);
        renderBasic({ data: [
            { name: expectedOrder.includes('Alpha') ? 'Zulu' : 'High', count: 10, lastUsedAt: 20, createdAt: 20 },
            { name: expectedOrder.includes('Alpha') ? 'Alpha' : 'Low', count: 1, lastUsedAt: 10, createdAt: 10 },
            ...(expectedOrder.includes('Recent') ? [
                { name: 'Recent', count: 2, lastUsedAt: 20, createdAt: 20 },
                { name: 'Old', count: 2, lastUsedAt: 10, createdAt: 10 }
            ] : [])
        ] });
        expectResourceOrder([...order]);
    });

    it('persists a sort selection from the dropdown', () => {
        renderBasic();
        fireEvent.click(screen.getByRole('button', { name: 'Sort LoRAs' }));
        fireEvent.click(screen.getByText('Name (A-Z)'));
        const update = settingsContextMocks.setSettings.mock.calls.at(-1)?.[0];
        expect(update({ resourceSortOptions: {} }).resourceSortOptions.loras).toBe('name_asc');
    });

    it('dismisses the context menu only for outside clicks', () => {
        renderBasic();
        fireEvent.contextMenu(screen.getByText('Alpha'));
        fireEvent.mouseDown(screen.getByText('Use Preview'));
        expect(screen.getByText('Use Preview')).toBeTruthy();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByText('Use Preview')).toBeNull();
    });

    it.each([
        ['checkpoints', 'name:Alpha', 'checkpoint'],
        ['loras', 'lora_Alpha', 'loras'],
        ['embeddings', 'emb_Alpha', 'embeddings'],
        ['hypernetworks', 'hyper_Alpha', 'hypernetworks'],
        ['controlNets', 'cnet_Alpha', 'control_nets'],
        ['ipAdapters', 'ipad_Alpha', 'ip_adapters']
    ] as const)('maps %s fallback hashes and backend types', async (type, hash, backendType) => {
        renderBasic({
            type,
            data: [{ name: 'Alpha', count: 1, isManual: 1, isUserOverride: 1 }]
        });
        fireEvent.contextMenu(screen.getByText('Alpha'));
        fireEvent.click(screen.getByText('Use Dynamic'));
        await waitFor(() => expect(commandMocks.clearAllThumbnails).toHaveBeenCalledWith(hash, 'Alpha', backendType));
    });

    it('logs command failures without closing the context menu', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        commandMocks.unsetModelThumbnail.mockResolvedValueOnce({ status: 'error', error: 'preview failed' });
        commandMocks.clearAllThumbnails.mockRejectedValueOnce(new Error('dynamic failed'));
        commandMocks.setResourceThumbnailSensitivity.mockResolvedValueOnce({ status: 'error', error: 'privacy failed' });
        renderBasic({ data: [{ name: 'Alpha', count: 1, isManual: 1, isUserOverride: 1 }] });

        fireEvent.contextMenu(screen.getByText('Alpha'));
        fireEvent.click(screen.getByText('Use Preview'));
        await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Failed to reset thumbnail', expect.any(Error)));
        fireEvent.click(screen.getByText('Use Dynamic'));
        await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Failed to clear all thumbnails', expect.any(Error)));
        fireEvent.click(screen.getByText('Mask Thumbnail'));
        await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Failed to update thumbnail privacy', expect.any(Error)));
        errorSpy.mockRestore();
    });

    it('covers selected, inventory-only, sidecar, and preview-url grid items', () => {
        settingsContextMocks.resourceViewModes = { loras: 'grid' };
        let current = { ...filters, loras: ['selected alias'] };
        const setFilters = vi.fn((update: (prev: FilterState) => FilterState) => { current = update(current); });
        renderBasic({
            filters: current,
            setFilters,
            assetScope: 'all',
            data: [
                { name: 'Selected', count: 2, filterAliases: ['selected alias'], thumbnailPath: 'selected.webp' },
                { name: 'Inventory', count: 0, isLocalDisk: true, thumbnailPath: 'sidecar.webp', thumbnailSource: 'sidecar' },
                { name: 'Preview', count: 1, isLocalDisk: true, previewUrl: 'preview.webp', thumbnailSource: 'sidecar' },
                { name: 'No Thumb', count: 1 }
            ]
        });

        expect(screen.getByTitle('Inventory has no indexed library images')).toBeTruthy();
        expect(screen.getByLabelText('Local only: no indexed library images. Preview from sidecar image.')).toBeTruthy();
        expect(screen.getByLabelText('Local asset on disk. Preview from sidecar image.')).toBeTruthy();
        fireEvent.click(screen.getByTitle('Selected'));
        expect(current.loras).toEqual([]);
        fireEvent.contextMenu(screen.getByTitle('Preview'));
        expect(screen.getByText('Use Preview')).toBeTruthy();
    });

    it('keeps selected zero-count resources visible while excluding invalid and unavailable assets', () => {
        renderBasic({
            filters: { ...filters, loras: ['SelectedZero'] },
            assetScope: 'used',
            validNames: ['Allowed'],
            data: [
                { name: 'SelectedZero', count: 0 },
                { name: 'Allowed', count: 1 },
                { name: 'Rejected', count: 1 },
                { name: 'UnusedLocal', count: 0, isLocalDisk: true }
            ]
        });
        expect(screen.getByText('SelectedZero')).toBeTruthy();
        expect(screen.getByText('Allowed')).toBeTruthy();
        expect(screen.queryByText('Rejected')).toBeNull();
        expect(screen.queryByText('UnusedLocal')).toBeNull();
    });

    it('excludes nonlocal unused resources from all scope', () => {
        const first = renderBasic({
            assetScope: 'all',
            data: [{ name: 'Unavailable', count: 0 }, { name: 'Local', count: 0, isLocalDisk: true }]
        });
        expect(screen.queryByText('Unavailable')).toBeNull();
        expect(screen.getByText('Local')).toBeTruthy();
        first.unmount();
    });

    it('uses zero and alternate date fallbacks for recent and added sorting', () => {
        setResourceSort('recent_desc');
        const first = renderBasic({ data: [
            { name: 'No Recent', count: 1 },
            { name: 'Has Recent', count: 1, lastUsedAt: 10 }
        ] });
        expectResourceOrder(['Has Recent', 'No Recent']);
        first.unmount();

        setResourceSort('recent_asc');
        const second = renderBasic({ data: [
            { name: 'No Recent', count: 1 },
            { name: 'Has Recent', count: 1, lastUsedAt: 10 }
        ] });
        expectResourceOrder(['No Recent', 'Has Recent']);
        second.unmount();

        setResourceSort('added_desc');
        const third = renderBasic({ assetScope: 'all', data: [
            { name: 'Created Fallback', count: 0, isLocalDisk: true, createdAt: 20 },
            { name: 'Modified Fallback', count: 1, localModifiedAt: 10 },
            { name: 'No Date', count: 1 }
        ] });
        expectResourceOrder(['Created Fallback', 'Modified Fallback', 'No Date']);
        third.unmount();
    });

    it('renders context action enabled and disabled states from thumbnail metadata', () => {
        renderBasic({ data: [{
            name: 'Alpha', count: 1, isManual: 0, hasSidecar: 1, isUserOverride: 0,
            thumbnailSensitivityOverride: 0
        }] });
        fireEvent.contextMenu(screen.getByText('Alpha'));
        expect((screen.getByText('Use Preview').closest('button') as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByText('Use Dynamic').closest('button') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByText('Always Show Thumbnail').closest('button') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByText('Reset Thumbnail Privacy').closest('button') as HTMLButtonElement).disabled).toBe(false);
    });

    it('persists grid-to-list switching', () => {
        settingsContextMocks.resourceViewModes = { loras: 'grid' };
        renderBasic();
        fireEvent.click(screen.getByRole('button', { name: 'Switch to List View' }));
        const update = settingsContextMocks.setSettings.mock.calls[0][0];
        expect(update({ resourceViewModes: { loras: 'grid' } }).resourceViewModes.loras).toBe('list');
    });

    it('defaults absent filter arrays while adding a selection', () => {
        const sparse = { ...filters } as Partial<FilterState>;
        delete sparse.loras;
        let current = sparse as FilterState;
        const setFilters = vi.fn((update: (prev: FilterState) => FilterState) => { current = update(current); });
        renderBasic({ filters: current, setFilters });
        fireEvent.click(screen.getByText('Alpha'));
        expect(current.loras).toEqual(['Alpha']);
    });

    it('sorts missing recent and local added dates with name tie-breakers', () => {
        setResourceSort('recent_desc');
        const first = renderBasic({ data: [{ name: 'Beta', count: 1 }, { name: 'Alpha', count: 1 }] });
        expectResourceOrder(['Alpha', 'Beta']);
        first.unmount();

        setResourceSort('recent_asc');
        const second = renderBasic({ data: [{ name: 'Beta', count: 1 }, { name: 'Alpha', count: 1 }] });
        expectResourceOrder(['Alpha', 'Beta']);
        second.unmount();

        setResourceSort('added_desc');
        const third = renderBasic({ assetScope: 'local', data: [
            { name: 'Beta', count: 0, isLocalDisk: true },
            { name: 'Alpha', count: 0, isLocalDisk: true }
        ] });
        expectResourceOrder(['Alpha', 'Beta']);
        third.unmount();
    });

    it('renders checkpoint names and pagination states in grid mode', () => {
        settingsContextMocks.resourceViewModes = { checkpoints: 'grid', loras: 'grid' };
        const checkpoint = renderBasic({ type: 'checkpoints', data: [{ name: 'model.safetensors', count: 1 }] });
        expect(screen.getByTitle('model.safetensors')).toBeTruthy();
        checkpoint.unmount();

        const many = renderBasic({ data: Array.from({ length: 31 }, (_, index) => ({ name: `Grid ${index}`, count: 31 - index })) });
        expect(screen.getByRole('button', { name: /show more/i }).className).toContain('col-span-3');
        many.unmount();

        const empty = renderBasic({ data: [] });
        expect(screen.getByText('No LoRAs found').className).toContain('col-span-3');
        empty.unmount();

        renderBasic({ data: [], isLoading: true });
        expect(screen.getByText('Loading LoRAs...').parentElement?.className).toContain('col-span-3');
    });

    it('handles a dynamic-thumbnail status error', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        commandMocks.clearAllThumbnails.mockResolvedValueOnce({ status: 'error', error: 'dynamic status failed' });
        renderBasic({ data: [{ name: 'Alpha', count: 1, isManual: 1 }] });
        fireEvent.contextMenu(screen.getByText('Alpha'));
        fireEvent.click(screen.getByText('Use Dynamic'));
        await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Failed to clear all thumbnails', expect.any(Error)));
        errorSpy.mockRestore();
    });
});
