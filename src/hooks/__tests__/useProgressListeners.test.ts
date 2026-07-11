import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncProgress } from '../../stores/libraryStore';
import { useProgressListeners } from '../useProgressListeners';

const runtime = vi.hoisted(() => ({ browser: false }));
const listeners = vi.hoisted(() => new Map<string, (event: { payload: SyncProgress }) => void>());
const cleanups = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());
const actions = vi.hoisted(() => ({
    setModelResolutionProgress: vi.fn(),
    setDiscoveryScanProgress: vi.fn(),
    setDuplicateScanProgress: vi.fn(),
    setIsScanningDuplicates: vi.fn(),
}));

vi.mock('../../services/runtime', () => ({ isBrowserMockMode: () => runtime.browser }));
vi.mock('../../stores/libraryStore', () => ({ useLibraryStore: () => actions }));
vi.mock('../../utils/tauriListener', () => ({
    listenWithCleanup: (event: string, handler: (payload: { payload: SyncProgress }) => void) => {
        const cleanup = vi.fn();
        listeners.set(event, handler);
        cleanups.set(event, cleanup);
        return { cleanup };
    },
}));

describe('useProgressListeners', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        listeners.clear();
        cleanups.clear();
        runtime.browser = false;
    });

    it('does not register native listeners in browser mode', () => {
        runtime.browser = true;
        renderHook(() => useProgressListeners());
        expect(listeners.size).toBe(0);
    });

    it('forwards all progress events and cleans up registrations', () => {
        const { unmount } = renderHook(() => useProgressListeners());
        const progress: SyncProgress = { current: 2, total: 5, message: 'Working' };
        act(() => listeners.get('model_resolution_progress')?.({ payload: progress }));
        act(() => listeners.get('discovery_scan_progress')?.({ payload: progress }));
        act(() => listeners.get('file_hash_backfill_progress')?.({ payload: progress }));
        expect(actions.setModelResolutionProgress).toHaveBeenCalledWith(progress);
        expect(actions.setDiscoveryScanProgress).toHaveBeenCalledWith(progress);
        expect(actions.setIsScanningDuplicates).toHaveBeenCalledWith(true);
        expect(actions.setDuplicateScanProgress).toHaveBeenCalledWith(progress);
        unmount();
        expect([...cleanups.values()].every(cleanup => cleanup.mock.calls.length === 1)).toBe(true);
    });
});
