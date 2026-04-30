import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResourceSection } from '../ResourceSection';
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
