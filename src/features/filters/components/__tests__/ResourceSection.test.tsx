import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResourceSection, type AssetScope } from '../ResourceSection';
import { FilterState } from '../../../../types';

const commandMocks = vi.hoisted(() => ({
    setResourceThumbnailSensitivity: vi.fn(),
    unsetModelThumbnail: vi.fn(),
    clearAllThumbnails: vi.fn()
}));

vi.mock('../../../../bindings', () => ({
    commands: commandMocks
}));

vi.mock('../../../../contexts/SettingsContext', () => ({
    useSettings: () => ({
        settings: {
            resourceViewModes: { loras: 'list' },
            resourceSortOptions: {},
            maskingMode: 'blur'
        },
        setSettings: vi.fn(),
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
        expect(screen.getByText('Unused')).toBeTruthy();
        expect(screen.getByText('UsedLocal')).toBeTruthy();
        expect(screen.queryByText('HarvestedOnly')).toBeNull();
    });

    it('does not toggle filters when an unused local asset is clicked', () => {
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
        let nextFilters: FilterState | null = null;
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

        expect(nextFilters?.loras).toEqual(['Detailer-Style']);
        expect(nextFilters?.assetFilterAliases?.loras?.['Detailer-Style']).toEqual(['Detailer-Style', 'detailer style']);
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
});
