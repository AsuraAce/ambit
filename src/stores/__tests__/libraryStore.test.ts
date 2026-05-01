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

    it('resets the idle timer when new live activity arrives', async () => {
        act(() => {
            useLibraryStore.getState().setIsLiveWatching(true);
            useLibraryStore.getState().startLiveWatchSession('invoke', {
                phase: 'watching',
                message: 'Detected InvokeAI activity.'
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
                message: 'Detected new files.'
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
                message: '1 image received this session. Watching for more...'
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
                message: 'Synchronizing InvokeAI images...'
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
                message: '1 image received this session. Watching for more...',
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
                message: 'Detected InvokeAI activity. Waiting for completed images...'
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
                message: 'Watching for completed images...',
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
                message: 'Importing live images...'
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
});
