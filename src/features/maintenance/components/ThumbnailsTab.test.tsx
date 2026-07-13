import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '../../../test/testUtils';
import { ThumbnailsTab } from './ThumbnailsTab';
import { useLibraryStore } from '../../../stores/libraryStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import type { AIImage } from '../../../types';

const addToastMock = vi.hoisted(() => vi.fn());
const thumbnailMocks = vi.hoisted(() => ({
    cleanupOrphanThumbnails: vi.fn().mockResolvedValue(0),
    pruneBrokenThumbnails: vi.fn().mockResolvedValue(0),
    syncExistingThumbnailsToDB: vi.fn().mockResolvedValue(0),
}));

const createDeferred = <T,>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
};

vi.mock('../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: addToastMock,
    }),
}));

vi.mock('../../../services/thumbnailService', () => ({
    cleanupOrphanThumbnails: (...args: Parameters<typeof thumbnailMocks.cleanupOrphanThumbnails>) => thumbnailMocks.cleanupOrphanThumbnails(...args),
    pruneBrokenThumbnails: (...args: Parameters<typeof thumbnailMocks.pruneBrokenThumbnails>) => thumbnailMocks.pruneBrokenThumbnails(...args),
    syncExistingThumbnailsToDB: (...args: Parameters<typeof thumbnailMocks.syncExistingThumbnailsToDB>) => thumbnailMocks.syncExistingThumbnailsToDB(...args),
}));

vi.mock('../../library/components/VirtualGrid', () => ({
    VirtualGrid: ({ items, renderItem, onRangeSelection, onBackgroundClick }: {
        items: AIImage[];
        renderItem: (image: AIImage, style: React.CSSProperties, index: number) => React.ReactNode;
        onRangeSelection: (indexes: number[], additive: boolean) => void;
        onBackgroundClick: () => void;
    }) => (
        <div data-testid="virtual-grid">
            {items.map((image, index) => renderItem(image, {}, index))}
            <button onClick={() => onRangeSelection([0], true)}>Range</button>
            <button onClick={onBackgroundClick}>Background</button>
        </div>
    )
}));

vi.mock('./MaintenanceItem', () => ({
    MaintenanceItem: ({ img, isSelected, onClick }: {
        img: AIImage;
        isSelected: boolean;
        onClick: (event: React.MouseEvent) => void;
    }) => <button data-selected={isSelected} onClick={onClick}>{img.filename}</button>
}));

const renderThumbnailsTab = (onRepairComplete = vi.fn().mockResolvedValue(undefined)) => {
    const onRegenerate = vi.fn();
    const onScopeChange = vi.fn();
    render(
        <ThumbnailsTab
            images={[]}
            totalCount={0}
            selectedIds={new Set()}
            onItemClick={vi.fn()}
            onSelectAll={vi.fn()}
            onClearSelection={vi.fn()}
            onRegenerate={onRegenerate}
            thumbnailsScope="global"
            onScopeChange={onScopeChange}
            maskedKeywords={[]}
            scrollContainerRef={React.createRef<HTMLElement>()}
            onRangeSelection={vi.fn()}
            onBackgroundClick={vi.fn()}
            includeUpgradeable={false}
            onIncludeUpgradeableChange={vi.fn()}
            onRepairComplete={onRepairComplete}
        />
    );
    return { onRepairComplete, onRegenerate, onScopeChange };
};

const imageFixture = (id: string): AIImage => ({
    id,
    filename: `${id}.png`,
    url: '',
    thumbnailUrl: '',
    timestamp: 1,
    width: 100,
    height: 100,
    isFavorite: false,
    metadata: {
        tool: 'Unknown',
        model: 'Unknown',
        steps: 0,
        cfg: 0,
        sampler: 'Unknown',
        positivePrompt: '',
        negativePrompt: ''
    }
} as AIImage);

const renderCustomTab = (overrides: Partial<React.ComponentProps<typeof ThumbnailsTab>> = {}) => {
    const props: React.ComponentProps<typeof ThumbnailsTab> = {
        images: [],
        totalCount: 0,
        selectedIds: new Set(),
        onItemClick: vi.fn(),
        onSelectAll: vi.fn(),
        onClearSelection: vi.fn(),
        onRegenerate: vi.fn(),
        thumbnailsScope: 'global',
        onScopeChange: vi.fn(),
        maskedKeywords: [],
        scrollContainerRef: React.createRef<HTMLElement>(),
        onRangeSelection: vi.fn(),
        onBackgroundClick: vi.fn(),
        includeUpgradeable: false,
        onIncludeUpgradeableChange: vi.fn(),
        onRepairComplete: vi.fn().mockResolvedValue(undefined),
        ...overrides
    };
    render(<ThumbnailsTab {...props} />);
    return props;
};

const enableDeveloperFeatures = () => {
    vi.stubEnv('DEV', true);
    useSettingsStore.setState(state => ({
        settings: {
            ...state.settings,
            devMode: true
        }
    }));
};

const expectMaintenanceControlsDisabled = () => {
    expect((screen.getByRole('button', { name: /library/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /filtered view/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: /include upgradeable/i }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /regenerate all unoptimized/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /repair broken thumbnails|repairing/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /sync db|syncing/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /clean up unused thumbnails|cleaning up/i }) as HTMLButtonElement).disabled).toBe(true);
};

describe('ThumbnailsTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        addToastMock.mockReset();
        thumbnailMocks.cleanupOrphanThumbnails.mockResolvedValue(0);
        thumbnailMocks.pruneBrokenThumbnails.mockResolvedValue(2);
        thumbnailMocks.syncExistingThumbnailsToDB.mockResolvedValue(0);
        useLibraryStore.setState(useLibraryStore.getInitialState(), true);
        useSettingsStore.setState(useSettingsStore.getInitialState(), true);
        vi.stubEnv('DEV', false);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('explains which existing thumbnails are included as upgradeable', () => {
        renderThumbnailsTab();

        fireEvent.focus(screen.getByRole('button', { name: 'About upgradeable thumbnails' }));

        expect(screen.getByRole('tooltip').textContent).toContain('imported or legacy thumbnails');
        expect(screen.getByRole('tooltip').textContent).toContain('missing micro-thumbnails');
    });

    it('repairs broken thumbnail references while holding the global maintenance blocker', async () => {
        const operationSpy = vi.spyOn(useLibraryStore.getState(), 'setThumbnailMaintenanceOperation');
        const { onRepairComplete } = renderThumbnailsTab();

        fireEvent.click(screen.getByRole('button', { name: /repair broken thumbnails/i }));

        await waitFor(() => {
            expect(thumbnailMocks.pruneBrokenThumbnails).toHaveBeenCalled();
        });
        expect(operationSpy).toHaveBeenNthCalledWith(1, 'repair');
        expect(onRepairComplete).toHaveBeenCalled();
        expect(operationSpy).toHaveBeenLastCalledWith(null);
        expect(addToastMock).toHaveBeenCalledWith('Repaired 2 broken thumbnail references.', 'success');

        operationSpy.mockRestore();
    });

    it('shows Sync DB when developer features are enabled', () => {
        enableDeveloperFeatures();

        renderThumbnailsTab();

        expect(screen.getByRole('button', { name: /sync db/i })).toBeTruthy();
    });

    it('hides Sync DB in production despite a stale persisted developer flag', () => {
        vi.stubEnv('DEV', false);
        useSettingsStore.setState(state => ({
            settings: {
                ...state.settings,
                devMode: true
            }
        }));

        renderThumbnailsTab();

        expect(screen.queryByRole('button', { name: /sync db/i })).toBeNull();
    });

    it('locks every thumbnail maintenance control while repairing and restores them afterward', async () => {
        enableDeveloperFeatures();
        const repair = createDeferred<number>();
        thumbnailMocks.pruneBrokenThumbnails.mockReturnValueOnce(repair.promise);
        renderThumbnailsTab();

        fireEvent.click(screen.getByRole('button', { name: /repair broken thumbnails/i }));

        expectMaintenanceControlsDisabled();
        expect(useLibraryStore.getState().thumbnailMaintenanceOperation).toBe('repair');

        repair.resolve(2);
        await waitFor(() => {
            expect((screen.getByRole('button', { name: /repair broken thumbnails/i }) as HTMLButtonElement).disabled).toBe(false);
        });
        expect((screen.getByRole('button', { name: /sync db/i }) as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByRole('button', { name: /clean up unused thumbnails/i }) as HTMLButtonElement).disabled).toBe(false);
        expect(useLibraryStore.getState().thumbnailMaintenanceOperation).toBeNull();
    });

    it('locks repair and cleanup while syncing and restores them after failure', async () => {
        enableDeveloperFeatures();
        const sync = createDeferred<number>();
        thumbnailMocks.syncExistingThumbnailsToDB.mockReturnValueOnce(sync.promise);
        renderThumbnailsTab();

        fireEvent.click(screen.getByRole('button', { name: /sync db/i }));

        expectMaintenanceControlsDisabled();
        expect(useLibraryStore.getState().thumbnailMaintenanceOperation).toBe('sync');
        fireEvent.click(screen.getByRole('button', { name: /repair broken thumbnails/i }));
        fireEvent.click(screen.getByRole('button', { name: /clean up unused thumbnails/i }));
        expect(thumbnailMocks.pruneBrokenThumbnails).not.toHaveBeenCalled();
        expect(thumbnailMocks.cleanupOrphanThumbnails).not.toHaveBeenCalled();

        sync.reject(new Error('sync failed'));
        await waitFor(() => {
            expect((screen.getByRole('button', { name: /sync db/i }) as HTMLButtonElement).disabled).toBe(false);
        });
        expect((screen.getByRole('button', { name: /repair broken thumbnails/i }) as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByRole('button', { name: /clean up unused thumbnails/i }) as HTMLButtonElement).disabled).toBe(false);
        expect(useLibraryStore.getState().thumbnailMaintenanceOperation).toBeNull();
    });

    it('locks repair and Sync DB while cleaning up and restores them afterward', async () => {
        enableDeveloperFeatures();
        const cleanup = createDeferred<number>();
        thumbnailMocks.cleanupOrphanThumbnails.mockReturnValueOnce(cleanup.promise);
        renderThumbnailsTab();

        fireEvent.click(screen.getByRole('button', { name: /clean up unused thumbnails/i }));

        expectMaintenanceControlsDisabled();
        expect(useLibraryStore.getState().thumbnailMaintenanceOperation).toBe('cleanup');
        fireEvent.click(screen.getByRole('button', { name: /repair broken thumbnails/i }));
        fireEvent.click(screen.getByRole('button', { name: /sync db/i }));
        expect(thumbnailMocks.pruneBrokenThumbnails).not.toHaveBeenCalled();
        expect(thumbnailMocks.syncExistingThumbnailsToDB).not.toHaveBeenCalled();

        cleanup.resolve(0);
        await waitFor(() => {
            expect((screen.getByRole('button', { name: /clean up unused thumbnails/i }) as HTMLButtonElement).disabled).toBe(false);
        });
        expect((screen.getByRole('button', { name: /repair broken thumbnails/i }) as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByRole('button', { name: /sync db/i }) as HTMLButtonElement).disabled).toBe(false);
        expect(useLibraryStore.getState().thumbnailMaintenanceOperation).toBeNull();
    });

    it('disables maintenance while background healing is active', () => {
        enableDeveloperFeatures();
        useLibraryStore.setState({ isBackgroundHealingActive: true });
        renderThumbnailsTab();

        expectMaintenanceControlsDisabled();
        expect(screen.getByRole('button', { name: /repair broken thumbnails/i }).getAttribute('title'))
            .toBe('Wait for Smart Thumbnail Optimization to finish');
    });

    it('rechecks background healing at click time before claiming maintenance', () => {
        enableDeveloperFeatures();
        renderThumbnailsTab();
        const repairButton = screen.getByRole('button', { name: /repair broken thumbnails/i });
        repairButton.addEventListener('click', () => {
            useLibraryStore.setState({ isBackgroundHealingActive: true });
        }, { capture: true, once: true });

        fireEvent.click(repairButton);

        expect(thumbnailMocks.pruneBrokenThumbnails).not.toHaveBeenCalled();
        expect(useLibraryStore.getState().thumbnailMaintenanceOperation).toBeNull();
    });

    it.each([
        [1, 'Cleaned up 1 orphan thumbnail'],
        [2, 'Cleaned up 2 orphan thumbnails']
    ])('reports cleanup success for %i removed files', async (count, message) => {
        thumbnailMocks.cleanupOrphanThumbnails.mockResolvedValueOnce(count);
        renderThumbnailsTab();

        fireEvent.click(screen.getByRole('button', { name: /clean up unused thumbnails/i }));

        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith(message, 'success'));
    });

    it('reports cleanup failures and releases its operation claim', async () => {
        thumbnailMocks.cleanupOrphanThumbnails.mockRejectedValueOnce(new Error('cleanup failed'));
        renderThumbnailsTab();

        fireEvent.click(screen.getByRole('button', { name: /clean up unused thumbnails/i }));

        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('Failed to clean up thumbnails', 'error'));
        expect(useLibraryStore.getState().thumbnailMaintenanceOperation).toBeNull();
    });

    it.each([
        [1, 'Synced 1 existing thumbnail to database'],
        [2, 'Synced 2 existing thumbnails to database']
    ])('reports sync success for %i database updates', async (count, message) => {
        enableDeveloperFeatures();
        thumbnailMocks.syncExistingThumbnailsToDB.mockResolvedValueOnce(count);
        renderThumbnailsTab();

        fireEvent.click(screen.getByRole('button', { name: /sync db/i }));

        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith(message, 'success'));
    });

    it('reports already-synced thumbnails', async () => {
        enableDeveloperFeatures();
        renderThumbnailsTab();

        fireEvent.click(screen.getByRole('button', { name: /sync db/i }));

        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('All thumbnails already synced to database', 'info'));
    });

    it('reports empty and failed repair passes', async () => {
        thumbnailMocks.pruneBrokenThumbnails.mockResolvedValueOnce(0);
        const first = renderThumbnailsTab();
        fireEvent.click(screen.getByRole('button', { name: /repair broken thumbnails/i }));
        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('No broken thumbnail references found', 'info'));
        first.onRepairComplete.mockClear();

        thumbnailMocks.pruneBrokenThumbnails.mockRejectedValueOnce(new Error('repair failed'));
        fireEvent.click(screen.getByRole('button', { name: /repair broken thumbnails/i }));
        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('Failed to repair broken thumbnails', 'error'));
    });

    it('uses singular repair copy for one broken reference', async () => {
        thumbnailMocks.pruneBrokenThumbnails.mockResolvedValueOnce(1);
        renderThumbnailsTab();

        fireEvent.click(screen.getByRole('button', { name: /repair broken thumbnails/i }));

        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('Repaired 1 broken thumbnail reference.', 'success'));
    });

    it('dispatches scope, upgrade, and all-regeneration controls', () => {
        const props = renderCustomTab({ totalCount: 5 });

        fireEvent.click(screen.getByRole('button', { name: /library/i }));
        fireEvent.click(screen.getByRole('button', { name: /filtered view/i }));
        fireEvent.click(screen.getByRole('checkbox', { name: /include upgradeable/i }));
        fireEvent.click(screen.getByRole('button', { name: /regenerate all unoptimized/i }));

        expect(props.onScopeChange).toHaveBeenNthCalledWith(1, 'global');
        expect(props.onScopeChange).toHaveBeenNthCalledWith(2, 'filtered');
        expect(props.onIncludeUpgradeableChange).toHaveBeenCalledWith(true);
        expect(props.onRegenerate).toHaveBeenCalledWith();
        expect(screen.getAllByText('5')).toHaveLength(2);
    });

    it('regenerates selected images and renders item/range/background callbacks', () => {
        const first = imageFixture('first');
        const second = imageFixture('second');
        const props = renderCustomTab({
            images: [first, second],
            totalCount: 4,
            selectedIds: new Set(['first']),
            thumbnailsScope: 'filtered'
        });

        fireEvent.click(screen.getByRole('button', { name: /regenerate selected/i }));
        fireEvent.click(screen.getByRole('button', { name: 'first.png' }));
        fireEvent.click(screen.getByRole('button', { name: 'Range' }));
        fireEvent.click(screen.getByRole('button', { name: 'Background' }));

        expect(props.onRegenerate).toHaveBeenCalledWith(['first']);
        expect(props.onItemClick).toHaveBeenCalledWith('first', 0, expect.any(Object));
        expect(props.onRangeSelection).toHaveBeenCalledWith([0], true);
        expect(props.onBackgroundClick).toHaveBeenCalled();
        expect(screen.getByText(/in current filter.*showing first 2/i)).not.toBeNull();
        expect(screen.getByRole('button', { name: 'first.png' }).getAttribute('data-selected')).toBe('true');
    });

    it('shows busy regeneration labels and the non-truncated filtered description', () => {
        useLibraryStore.setState({ isRegeneratingThumbnails: true });
        renderCustomTab({
            images: [imageFixture('only')],
            totalCount: 1,
            selectedIds: new Set(['only']),
            thumbnailsScope: 'filtered',
            includeUpgradeable: true
        });

        expect(screen.getByText('Processing...')).not.toBeNull();
        expect(screen.getByText(/could benefit from thumbnail regeneration/i)).not.toBeNull();
        expect((screen.getByRole('checkbox', { name: /include upgradeable/i }) as HTMLInputElement).checked).toBe(true);
    });

    it('shows the all-library busy label when no items are selected', () => {
        useLibraryStore.setState({ isRegeneratingThumbnails: true });
        renderCustomTab({ totalCount: 0 });

        expect(screen.getByText('Optimizing Library...')).not.toBeNull();
    });

    it('rejects cleanup and sync claims when another operation appears at click time', () => {
        enableDeveloperFeatures();
        renderThumbnailsTab();
        const cleanup = screen.getByRole('button', { name: /clean up unused thumbnails/i });
        cleanup.addEventListener('click', () => {
            useLibraryStore.setState({ thumbnailMaintenanceOperation: 'repair' });
        }, { capture: true, once: true });
        fireEvent.click(cleanup);
        expect(thumbnailMocks.cleanupOrphanThumbnails).not.toHaveBeenCalled();

        act(() => useLibraryStore.setState({ thumbnailMaintenanceOperation: null }));
        const sync = screen.getByRole('button', { name: /sync db/i });
        const currentState = useLibraryStore.getState();
        const getState = vi.spyOn(useLibraryStore, 'getState').mockReturnValue({
            ...currentState,
            isRegeneratingThumbnails: true
        });
        fireEvent.click(sync);
        expect(thumbnailMocks.syncExistingThumbnailsToDB).not.toHaveBeenCalled();
        getState.mockRestore();
    });
});
