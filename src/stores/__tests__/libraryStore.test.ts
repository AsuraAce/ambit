import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialLiveWatchSessionState, useLibraryStore } from '../libraryStore';

vi.mock('../../bindings', () => ({
    commands: {
        cancelModelDiscovery: vi.fn().mockResolvedValue(undefined),
        cancelImageFileHashBackfill: vi.fn().mockResolvedValue(undefined)
    }
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn().mockResolvedValue(undefined)
}));

const resetLibraryStore = () => {
    useLibraryStore.setState(useLibraryStore.getInitialState(), true);
    useLibraryStore.setState({
        liveWatchSession: createInitialLiveWatchSessionState(),
        isActivityDockDismissed: false,
        facetCacheVersion: 0
    });
};

describe('libraryStore live watch session', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        resetLibraryStore();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('tracks the active thumbnail maintenance operation', () => {
        expect(useLibraryStore.getState().thumbnailMaintenanceOperation).toBeNull();

        act(() => {
            useLibraryStore.getState().setThumbnailMaintenanceOperation('repair');
        });
        expect(useLibraryStore.getState().thumbnailMaintenanceOperation).toBe('repair');

        act(() => {
            useLibraryStore.getState().setThumbnailMaintenanceOperation(null);
        });
        expect(useLibraryStore.getState().thumbnailMaintenanceOperation).toBeNull();
    });

    it('resets the idle timer when new live activity arrives', async () => {
        act(() => {
            useLibraryStore.getState().setIsLiveWatching(true);
            useLibraryStore.getState().startLiveWatchSession('invoke', {
                phase: 'watching',
                message: 'Checking InvokeAI for completed images.'
            });
            useLibraryStore.getState().reportLiveImagesReceived(1, { source: 'invoke' });
        });

        expect(useLibraryStore.getState().liveWatchSession.receivedCount).toBe(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(59000);
        });

        expect(useLibraryStore.getState().liveWatchSession.active).toBe(true);

        act(() => {
            useLibraryStore.getState().startLiveWatchSession('generic', {
                phase: 'watching',
                message: 'Checking monitored folders.'
            });
        });

        expect(useLibraryStore.getState().liveWatchSession.source).toBe('mixed');

        await act(async () => {
            await vi.advanceTimersByTimeAsync(59000);
        });

        expect(useLibraryStore.getState().liveWatchSession.active).toBe(true);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });

        expect(useLibraryStore.getState().liveWatchSession.active).toBe(false);
        expect(useLibraryStore.getState().liveWatchSession.receivedCount).toBe(0);
    });

    it('closes passive live watch sessions immediately when live watch is turned off', () => {
        act(() => {
            useLibraryStore.getState().setIsLiveWatching(true);
            useLibraryStore.getState().startLiveWatchSession('invoke', {
                phase: 'summary',
                message: '1 image added this session.'
            });
            useLibraryStore.getState().setIsLiveWatching(false);
        });

        expect(useLibraryStore.getState().isLiveWatching).toBe(false);
        expect(useLibraryStore.getState().liveWatchSession.active).toBe(false);
        expect(useLibraryStore.getState().liveWatchSessionCloseRequested).toBe(false);
    });

    it('keeps active live watch sessions visible after stop until the cycle settles', () => {
        act(() => {
            useLibraryStore.getState().setIsLiveWatching(true);
            useLibraryStore.getState().startLiveWatchSession('invoke', {
                phase: 'syncing',
                message: 'Syncing completed InvokeAI images...'
            });
            useLibraryStore.getState().setIsLiveWatching(false);
        });

        expect(useLibraryStore.getState().liveWatchSession.active).toBe(true);
        expect(useLibraryStore.getState().liveWatchSession.phase).toBe('syncing');
        expect(useLibraryStore.getState().liveWatchSessionCloseRequested).toBe(true);

        act(() => {
            useLibraryStore.getState().updateLiveWatchSession({
                source: 'invoke',
                phase: 'summary',
                message: '1 image added this session.',
                progress: null
            });
        });

        expect(useLibraryStore.getState().liveWatchSession.active).toBe(false);
        expect(useLibraryStore.getState().liveWatchSessionCloseRequested).toBe(false);
    });

    it('keeps detected live watch activity visible after stop until the scheduled cycle settles', () => {
        act(() => {
            useLibraryStore.getState().setIsLiveWatching(true);
            useLibraryStore.getState().startLiveWatchSession('invoke', {
                phase: 'watching',
                message: 'Checking InvokeAI for completed images...'
            });
            useLibraryStore.getState().setIsLiveWatching(false);
        });

        expect(useLibraryStore.getState().liveWatchSession.active).toBe(true);
        expect(useLibraryStore.getState().liveWatchSession.phase).toBe('watching');
        expect(useLibraryStore.getState().liveWatchSessionCloseRequested).toBe(true);

        act(() => {
            useLibraryStore.getState().updateLiveWatchSession({
                source: 'invoke',
                phase: 'summary',
                message: 'Watching for new images...',
                progress: null
            });
        });

        expect(useLibraryStore.getState().liveWatchSession.active).toBe(false);
        expect(useLibraryStore.getState().liveWatchSessionCloseRequested).toBe(false);
    });

    it('closes active live watch sessions after stop when images are reported', () => {
        act(() => {
            useLibraryStore.getState().setIsLiveWatching(true);
            useLibraryStore.getState().startLiveWatchSession('generic', {
                phase: 'importing',
                message: 'Importing new images...'
            });
            useLibraryStore.getState().setIsLiveWatching(false);
        });

        expect(useLibraryStore.getState().liveWatchSession.active).toBe(true);
        expect(useLibraryStore.getState().liveWatchSessionCloseRequested).toBe(true);

        act(() => {
            useLibraryStore.getState().reportLiveImagesReceived(1, { source: 'generic' });
        });

        expect(useLibraryStore.getState().liveWatchSession.active).toBe(false);
        expect(useLibraryStore.getState().liveWatchSession.receivedCount).toBe(0);
    });

    it('ends the live session immediately when the session is closed manually', async () => {
        act(() => {
            useLibraryStore.getState().startLiveWatchSession('invoke', {
                phase: 'watching',
                message: 'Waiting for completed images...'
            });
        });

        await act(async () => {
            await useLibraryStore.getState().endLiveImageSession();
        });

        expect(useLibraryStore.getState().liveWatchSession.active).toBe(false);
        expect(useLibraryStore.getState().liveWatchSession.receivedCount).toBe(0);
    });

    it('keeps a dismissed Live Watch dock dismissed for routine live session updates', () => {
        act(() => {
            useLibraryStore.getState().startLiveWatchSession('invoke', {
                phase: 'syncing',
                message: 'Syncing completed InvokeAI images...'
            });
            useLibraryStore.getState().setIsActivityDockDismissed(true);
            useLibraryStore.getState().updateLiveWatchSession({
                source: 'invoke',
                phase: 'syncing',
                message: 'Still syncing...',
                progress: { current: 1, total: 2, message: undefined }
            });
        });

        expect(useLibraryStore.getState().isActivityDockDismissed).toBe(true);

        act(() => {
            useLibraryStore.getState().startLiveWatchSession('invoke', {
                phase: 'syncing',
                message: 'New live activity...'
            });
            useLibraryStore.getState().reportLiveImagesReceived(1, { source: 'invoke' });
        });

        expect(useLibraryStore.getState().isActivityDockDismissed).toBe(true);
    });

    it('cancels duplicate hashing when an import starts', () => {
        act(() => {
            useLibraryStore.getState().setIsScanningDuplicates(true);
            useLibraryStore.getState().setDuplicateScanProgress({
                current: 1,
                total: 10,
                message: 'Hashing images...'
            });
            useLibraryStore.getState().setIsImporting(true);
        });

        expect(useLibraryStore.getState().isImporting).toBe(true);
        expect(useLibraryStore.getState().isScanningDuplicates).toBe(false);
        expect(useLibraryStore.getState().duplicateScanProgress).toBeNull();
    });

    it('cancels missing file audit when an import starts', () => {
        const abortController = new AbortController();
        const abortSpy = vi.spyOn(abortController, 'abort');

        act(() => {
            useLibraryStore.getState().setMissingScanAbortController(abortController);
            useLibraryStore.getState().setIsScanningMissingFiles(true);
            useLibraryStore.getState().setMissingScanProgress({
                current: 1,
                total: 10,
                message: 'Checking file paths...'
            });
            useLibraryStore.getState().setIsImporting(true);
        });

        expect(abortSpy).toHaveBeenCalled();
        expect(useLibraryStore.getState().isImporting).toBe(true);
        expect(useLibraryStore.getState().isScanningMissingFiles).toBe(false);
        expect(useLibraryStore.getState().missingScanProgress).toBeNull();
    });

    it('preserves discovery scan start time when later progress omits it', () => {
        act(() => {
            useLibraryStore.getState().setDiscoveryScanProgress({
                current: 0,
                total: 0,
                message: 'Scanning resource folders...',
                mode: 'indeterminate',
                startedAt: 12345
            });
            useLibraryStore.getState().setDiscoveryScanProgress({
                current: 12,
                total: 100,
                message: 'Updating local asset index...',
                mode: 'determinate',
                detail: '8 indexed'
            });
        });

        expect(useLibraryStore.getState().discoveryScanProgress).toMatchObject({
            current: 12,
            total: 100,
            startedAt: 12345
        });
    });

    it('updates import progress only for the active import run', () => {
        let runId: string | null = null;

        act(() => {
            runId = useLibraryStore.getState().beginImportRun({
                owner: 'test-import'
            });
            useLibraryStore.getState().setImportProgressForRun('stale-run', {
                current: 9,
                total: 10,
                message: 'Stale progress'
            });
        });

        expect(runId).toBeTruthy();
        expect(useLibraryStore.getState().importProgress).toBeNull();

        act(() => {
            useLibraryStore.getState().setImportProgressForRun(runId!, {
                current: 1,
                total: 10,
                message: 'Active progress'
            });
        });

        expect(useLibraryStore.getState().importProgress).toMatchObject({
            current: 1,
            total: 10,
            message: 'Active progress'
        });
    });

    it('does not let stale import cleanup clear a newer run', () => {
        let runId: string | null = null;

        act(() => {
            runId = useLibraryStore.getState().beginImportRun({
                owner: 'test-import',
                progress: { current: 1, total: 3, message: 'Running' }
            });
            useLibraryStore.getState().finishImportRun('stale-run');
        });

        expect(useLibraryStore.getState().isImporting).toBe(true);
        expect(useLibraryStore.getState().importRunId).toBe(runId);
        expect(useLibraryStore.getState().importProgress?.message).toBe('Running');

        act(() => {
            useLibraryStore.getState().finishImportRun(runId!);
        });

        expect(useLibraryStore.getState().isImporting).toBe(false);
        expect(useLibraryStore.getState().importRunId).toBeNull();
        expect(useLibraryStore.getState().importProgress).toBeNull();
    });

    it('rejects a second independent import run while one is active', () => {
        let firstRunId: string | null = null;
        let secondRunId: string | null = null;

        act(() => {
            firstRunId = useLibraryStore.getState().beginImportRun({ owner: 'first-import' });
            secondRunId = useLibraryStore.getState().beginImportRun({ owner: 'second-import' });
        });

        expect(firstRunId).toBeTruthy();
        expect(secondRunId).toBeNull();
        expect(useLibraryStore.getState().importRunId).toBe(firstRunId);
        expect(useLibraryStore.getState().importRunOwner).toBe('first-import');
    });

    it('cancels the active import controller and clears the active run', () => {
        const abortController = new AbortController();
        const abortSpy = vi.spyOn(abortController, 'abort');

        act(() => {
            useLibraryStore.getState().beginImportRun({
                owner: 'test-import',
                abortController,
                progress: { current: 1, total: 2, message: 'Running' }
            });
            useLibraryStore.getState().cancelImport();
        });

        expect(abortSpy).toHaveBeenCalledTimes(1);
        expect(useLibraryStore.getState().isImporting).toBe(false);
        expect(useLibraryStore.getState().importRunId).toBeNull();
        expect(useLibraryStore.getState().importProgress).toBeNull();
        expect(useLibraryStore.getState().importAbortController).toBeNull();
    });
});
