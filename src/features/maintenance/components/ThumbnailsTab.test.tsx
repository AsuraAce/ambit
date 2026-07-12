import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../../../test/testUtils';
import { ThumbnailsTab } from './ThumbnailsTab';
import { useLibraryStore } from '../../../stores/libraryStore';
import { useSettingsStore } from '../../../stores/settingsStore';

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
});
