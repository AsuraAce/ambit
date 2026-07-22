import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '../../test/testUtils';
import type { AppSettings } from '../../types';
import { useLibraryStore } from '../../stores/libraryStore';
import { useWatchers, WatcherProvider } from '../WatcherContext';

type WatchCallback = (paths?: string[]) => void | Promise<void>;

const mocks = vi.hoisted(() => ({
    settings: undefined as unknown as AppSettings,
    isLoaded: true,
    syncStatus: 'idle',
    startInvokeSync: vi.fn(),
    startTargetedLiveSync: vi.fn(),
    startWatching: vi.fn(),
    stopWatching: vi.fn(),
    watcherCallback: undefined as WatchCallback | undefined,
    getMaintenanceCounts: vi.fn()
}));

vi.mock('../SettingsContext', () => ({
    useSettings: () => ({ settings: mocks.settings, isLoaded: mocks.isLoaded })
}));

vi.mock('../SyncContext', () => ({
    useSync: () => ({
        startInvokeSync: mocks.startInvokeSync,
        startTargetedLiveSync: mocks.startTargetedLiveSync,
        syncStatus: mocks.syncStatus
    })
}));

vi.mock('../../services/WatcherService', () => ({
    watcherService: {
        startWatching: (...args: [string[], WatchCallback]) => mocks.startWatching(...args),
        stopWatching: () => mocks.stopWatching()
    }
}));

vi.mock('../../services/db/maintenanceRepo', () => ({
    getMaintenanceCounts: mocks.getMaintenanceCounts
}));

const baseSettings = (): AppSettings => ({
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 200,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    promptMaskingEnabled: true,
    maskedKeywords: [],
    maskingMode: 'blur',
    enableAI: false
});

const targetedResult = (handledPaths: string[] = []) => ({
    handledPaths,
    failedPaths: [],
    importedCount: handledPaths.length
});

const Consumer = () => {
    const value = useWatchers();
    return (
        <div>
            <span data-testid="watching">{String(value.isLiveWatching)}</span>
            <span data-testid="event">{value.lastWatcherEvent}</span>
            <span data-testid="missing">{value.maintenanceCounts.missing}</span>
            <button onClick={() => value.setIsLiveWatching(true)}>Enable</button>
            <button onClick={() => value.setIsLiveWatching(current => !current)}>Toggle</button>
            <button onClick={() => void value.refreshMaintenanceCounts()}>Refresh</button>
        </div>
    );
};

const renderProvider = () => render(
    <WatcherProvider>
        <Consumer />
    </WatcherProvider>
);

const advanceInit = async () => {
    await act(async () => vi.advanceTimersByTime(500));
};

describe('WatcherContext', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mocks.settings = baseSettings();
        mocks.isLoaded = true;
        mocks.syncStatus = 'idle';
        mocks.watcherCallback = undefined;
        mocks.startWatching.mockImplementation(async (_paths: string[], callback: WatchCallback) => {
            mocks.watcherCallback = callback;
        });
        mocks.stopWatching.mockResolvedValue(undefined);
        mocks.startInvokeSync.mockResolvedValue(undefined);
        mocks.startTargetedLiveSync.mockResolvedValue(targetedResult());
        mocks.getMaintenanceCounts.mockResolvedValue({
            untagged: 1,
            orphans: 2,
            intermediates: 3,
            missing: 4,
            trash: 5,
            duplicates: 6
        });
        useLibraryStore.setState(useLibraryStore.getInitialState(), true);
    });

    it('requires consumers to render inside the provider', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(() => render(<Consumer />)).toThrow('useWatchers must be used within a WatcherProvider');
        error.mockRestore();
    });

    it('dispatches direct and functional live-watch updates', () => {
        renderProvider();
        fireEvent.click(screen.getByText('Enable'));
        expect(useLibraryStore.getState().isLiveWatching).toBe(true);
        fireEvent.click(screen.getByText('Toggle'));
        expect(useLibraryStore.getState().isLiveWatching).toBe(false);
    });

    it('refreshes maintenance counts only after settings load and contains failures', async () => {
        mocks.isLoaded = false;
        const view = renderProvider();
        fireEvent.click(screen.getByText('Refresh'));
        await act(async () => Promise.resolve());
        expect(mocks.getMaintenanceCounts).not.toHaveBeenCalled();

        mocks.isLoaded = true;
        view.rerender(<WatcherProvider><Consumer /></WatcherProvider>);
        fireEvent.click(screen.getByText('Refresh'));
        await act(async () => Promise.resolve());
        expect(screen.getByTestId('missing').textContent).toBe('4');

        mocks.getMaintenanceCounts.mockRejectedValueOnce(new Error('counts failed'));
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        fireEvent.click(screen.getByText('Refresh'));
        await act(async () => Promise.resolve());
        expect(error).toHaveBeenCalledWith('Failed to refresh maintenance counts', expect.any(Error));
        error.mockRestore();
    });

    it('does not initialize before settings load and stops when live watching is disabled', async () => {
        mocks.isLoaded = false;
        const view = renderProvider();
        await advanceInit();
        expect(mocks.stopWatching).not.toHaveBeenCalled();

        mocks.isLoaded = true;
        view.rerender(<WatcherProvider><Consumer /></WatcherProvider>);
        await advanceInit();
        expect(mocks.stopWatching).toHaveBeenCalled();
    });

    it('stops rather than starting when no active paths exist', async () => {
        useLibraryStore.setState({ isLiveWatching: true });
        renderProvider();
        await advanceInit();

        expect(mocks.stopWatching).toHaveBeenCalled();
        expect(mocks.startWatching).not.toHaveBeenCalled();
    });

    it('starts active generic folders and drains normalized targeted changes', async () => {
        mocks.settings = {
            ...baseSettings(),
            monitoredFolders: [
                { id: 'active', path: 'C:/active', isActive: true, imageCount: 0 },
                { id: 'inactive', path: 'C:/inactive', isActive: false, imageCount: 0 }
            ]
        };
        useLibraryStore.setState({ isLiveWatching: true });
        mocks.startTargetedLiveSync.mockResolvedValue(targetedResult(['C:/active/new.png']));
        renderProvider();
        await advanceInit();

        expect(mocks.startWatching).toHaveBeenCalledWith(['C:/active'], expect.any(Function));
        await act(async () => mocks.watcherCallback?.());
        await act(async () => mocks.watcherCallback?.([]));
        expect(mocks.startTargetedLiveSync).not.toHaveBeenCalled();

        await act(async () => mocks.watcherCallback?.(['C:\\active\\new.png']));
        await act(async () => Promise.resolve());
        expect(mocks.startTargetedLiveSync).toHaveBeenCalledWith(
            ['C:/active/new.png'],
            expect.objectContaining({ source: 'generic-folder-watch', pathCount: 1 })
        );
        expect(mocks.getMaintenanceCounts).toHaveBeenCalled();
        expect(Number(screen.getByTestId('event').textContent)).toBeGreaterThan(0);
    });

    it('merges generic events arriving during an active targeted drain', async () => {
        mocks.settings = {
            ...baseSettings(),
            monitoredFolders: [{ id: 'active', path: 'C:/active', isActive: true, imageCount: 0 }]
        };
        useLibraryStore.setState({ isLiveWatching: true });
        let resolveFirst!: (value: ReturnType<typeof targetedResult>) => void;
        mocks.startTargetedLiveSync
            .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
            .mockResolvedValueOnce(targetedResult());
        renderProvider();
        await advanceInit();

        await act(async () => {
            void mocks.watcherCallback?.(['C:/active/one.png']);
            void mocks.watcherCallback?.(['C:/active/two.png', 'C:/active/two.png']);
            void mocks.watcherCallback?.(['C:/active/three.png']);
        });
        expect(mocks.startTargetedLiveSync).toHaveBeenCalledTimes(1);

        await act(async () => resolveFirst(targetedResult()));
        await act(async () => Promise.resolve());
        expect(mocks.startTargetedLiveSync).toHaveBeenCalledTimes(2);
        expect(mocks.startTargetedLiveSync.mock.calls[1][0]).toEqual(['C:/active/two.png', 'C:/active/three.png']);
        expect(mocks.startTargetedLiveSync.mock.calls[1][1]).toEqual(expect.objectContaining({
            eventCount: 2,
            pathCount: 3
        }));
    });

    it('filters Invoke database paths, debounces repeated events, and starts live sync', async () => {
        mocks.settings = { ...baseSettings(), invokeAiPath: 'C:/InvokeAI' };
        useLibraryStore.setState({ isLiveWatching: true });
        renderProvider();
        await advanceInit();

        expect(mocks.startWatching).toHaveBeenCalledWith(['C:/InvokeAI/databases'], expect.any(Function));
        expect(mocks.startInvokeSync).toHaveBeenCalledWith({ mode: 'live' });
        mocks.startInvokeSync.mockClear();

        await act(async () => mocks.watcherCallback?.([
            'C:/InvokeAI/databases/invokeai.db',
            'C:/InvokeAI/databases/invokeai.db-wal',
            'C:/InvokeAI/databases/ignore.txt'
        ]));
        await act(async () => mocks.watcherCallback?.(['C:/InvokeAI/databases/invokeai.db']));
        expect(mocks.startInvokeSync).not.toHaveBeenCalled();

        await act(async () => vi.advanceTimersByTime(500));
        expect(mocks.startInvokeSync).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'live',
            perfContext: expect.objectContaining({ eventCount: 2, pathCount: 3 })
        }));
    });

    it('skips activation catch-up while syncing and deduplicates the same Invoke root', async () => {
        mocks.settings = { ...baseSettings(), invokeAiPath: 'C:/InvokeAI' };
        mocks.syncStatus = 'syncing';
        useLibraryStore.setState({ isLiveWatching: true });
        const view = renderProvider();
        await advanceInit();
        expect(mocks.startInvokeSync).not.toHaveBeenCalled();

        mocks.syncStatus = 'idle';
        mocks.settings = { ...mocks.settings, monitoredFolders: [{ id: 'new', path: 'C:/new', isActive: true, imageCount: 0 }] };
        view.rerender(<WatcherProvider><Consumer /></WatcherProvider>);
        await advanceInit();
        expect(mocks.startInvokeSync).not.toHaveBeenCalled();
    });

    it('supports missing monitored-folder configuration', async () => {
        mocks.settings = { ...baseSettings(), monitoredFolders: undefined as never };
        useLibraryStore.setState({ isLiveWatching: true });
        renderProvider();
        await advanceInit();

        expect(mocks.stopWatching).toHaveBeenCalled();
    });

    it('cancels a pending Invoke debounce during ordinary cleanup', async () => {
        mocks.settings = { ...baseSettings(), invokeAiPath: 'C:/InvokeAI' };
        useLibraryStore.setState({ isLiveWatching: true });
        const view = renderProvider();
        await advanceInit();
        mocks.startInvokeSync.mockClear();
        await act(async () => mocks.watcherCallback?.(['C:/InvokeAI/databases/invokeai.db']));

        view.unmount();
        await act(async () => vi.advanceTimersByTime(500));

        expect(mocks.startInvokeSync).not.toHaveBeenCalled();
    });

    it('drains a pending Invoke debounce when live-watch closure was requested', async () => {
        mocks.settings = { ...baseSettings(), invokeAiPath: 'C:/InvokeAI' };
        useLibraryStore.setState({ isLiveWatching: true, liveWatchSessionCloseRequested: true });
        const view = renderProvider();
        await advanceInit();
        mocks.startInvokeSync.mockClear();
        await act(async () => mocks.watcherCallback?.(['C:/InvokeAI/databases/invokeai.db-wal']));

        view.unmount();
        await act(async () => vi.advanceTimersByTime(500));

        expect(mocks.startInvokeSync).toHaveBeenCalledWith(expect.objectContaining({ mode: 'live' }));
    });
});
