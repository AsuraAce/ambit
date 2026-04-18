import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialLiveWatchSessionState, useLibraryStore } from '../libraryStore';
import { rebuildFacetCache } from '../../services/db/imageRepo';

vi.mock('../../bindings', () => ({
    commands: {
        cancelModelDiscovery: vi.fn().mockResolvedValue(undefined)
    }
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../services/db/imageRepo', () => ({
    rebuildFacetCache: vi.fn().mockResolvedValue(undefined)
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
        expect(rebuildFacetCache).not.toHaveBeenCalled();

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
        expect(rebuildFacetCache).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });

        expect(useLibraryStore.getState().liveWatchSession.active).toBe(false);
        expect(rebuildFacetCache).toHaveBeenCalledTimes(1);
    });

    it('skips the idle facet rebuild when no images were received', async () => {
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
        expect(rebuildFacetCache).not.toHaveBeenCalled();
    });
});
