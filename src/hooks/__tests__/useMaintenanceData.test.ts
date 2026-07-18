
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMaintenanceData, type MaintenanceTab } from '../useMaintenanceData';
import { useLibraryStore } from '../../stores/libraryStore';

// --- Mocks ---
const mockGetDeletedImages = vi.fn().mockResolvedValue([]);
const mockGetMissingImages = vi.fn().mockResolvedValue([]);
const mockGetUntaggedImages = vi.fn().mockResolvedValue([]);
const mockGetDuplicateCandidates = vi.fn().mockResolvedValue([]);
const mockGetUnoptimizedImages = vi.fn().mockResolvedValue([]);
const mockGetUnoptimizedImagesCount = vi.fn().mockResolvedValue(0);
const mockGetIntermediateImages = vi.fn().mockResolvedValue([]);
const mockBackfillImageFileHashes = vi.fn().mockResolvedValue({
    scanned: 0,
    updated: 0,
    missing: 0,
    errors: 0,
    remaining: 0,
    wasCancelled: false
});
const libraryContextMock = vi.hoisted(() => ({
    activeSqlWhere: 'WHERE x=1',
    activeSqlParams: [1]
}));

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

vi.mock('../../services/db/maintenanceRepo', () => ({
    getDeletedImages: () => mockGetDeletedImages(),
    getMissingImages: () => mockGetMissingImages(),
    getUntaggedImages: (...args: unknown[]) => mockGetUntaggedImages(...args),
    backfillImageFileHashes: () => mockBackfillImageFileHashes(),
    getDuplicateCandidates: (...args: unknown[]) => mockGetDuplicateCandidates(...args),
    getUnoptimizedImages: (...args: unknown[]) => mockGetUnoptimizedImages(...args),
    getUnoptimizedImagesCount: (...args: unknown[]) => mockGetUnoptimizedImagesCount(...args),
    getIntermediateImages: (...args: unknown[]) => mockGetIntermediateImages(...args),
}));

vi.mock('../useLibraryContext', () => ({
    useLibraryContext: () => libraryContextMock,
}));

describe('useMaintenanceData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useLibraryStore.setState(useLibraryStore.getInitialState(), true);
    });

    it('should auto-refresh trash on initialization', async () => {
        renderHook(() => useMaintenanceData('trash', 'global'));

        await waitFor(() => {
            expect(mockGetDeletedImages).toHaveBeenCalled();
        });
    });

    it('should NOT auto-refresh other tabs', async () => {
        renderHook(() => useMaintenanceData('duplicates', 'global'));

        // Wait a bit to ensure it doesn't trigger
        await new Promise(r => setTimeout(r, 100));
        expect(mockGetDuplicateCandidates).not.toHaveBeenCalled();
    });

    it('should auto-refresh persisted missing records without running an audit scan', async () => {
        renderHook(() => useMaintenanceData('missing', 'global'));

        await waitFor(() => {
            expect(mockGetMissingImages).toHaveBeenCalled();
        });
        expect(mockGetDuplicateCandidates).not.toHaveBeenCalled();
    });

    it('should fetch untagged images with filtered scope', async () => {
        const { result } = renderHook(() => useMaintenanceData('untagged', 'filtered'));

        await act(async () => {
            await result.current.refreshData('untagged', true, { scope: 'filtered' });
            await result.current.refreshData('untagged', false, { scope: 'global' });
        });

        await waitFor(() => {
            expect(mockGetUntaggedImages).toHaveBeenCalledWith('WHERE x=1', [1]);
        });
        expect(mockGetUntaggedImages).toHaveBeenCalledWith('', []);
    });

    it('should fetch duplicate candidates with global scope', async () => {
        const { result } = renderHook(() => useMaintenanceData('duplicates', 'global'));

        await act(async () => {
            await result.current.refreshData('duplicates', true, { scope: 'global' });
        });

        expect(mockGetDuplicateCandidates).toHaveBeenCalledWith();
        expect(mockBackfillImageFileHashes).toHaveBeenCalled();
    });

    it('should expose duplicate scan progress before candidate loading completes', async () => {
        mockGetDuplicateCandidates.mockImplementationOnce(async () => {
            expect(useLibraryStore.getState().isScanningDuplicates).toBe(true);
            expect(useLibraryStore.getState().duplicateScanProgress?.message).toBe('Preparing duplicate scan...');
            return [];
        });

        const { result } = renderHook(() => useMaintenanceData('duplicates', 'global'));

        await act(async () => {
            await result.current.refreshData('duplicates', true, { scope: 'global' });
        });

        expect(mockBackfillImageFileHashes).toHaveBeenCalled();
    });

    it('loads thumbnail counts and previews for the selected scope', async () => {
        mockGetUnoptimizedImagesCount.mockResolvedValueOnce(7);
        mockGetUnoptimizedImages.mockResolvedValueOnce([{ id: 'thumb-1' }]);
        const { result } = renderHook(() => useMaintenanceData('thumbnails', 'filtered'));

        await act(async () => {
            await result.current.refreshData('thumbnails', true, {
                scope: 'filtered',
                includeUpgradeable: true
            });
        });

        expect(mockGetUnoptimizedImagesCount).toHaveBeenCalledWith('WHERE x=1', [1], true);
        expect(mockGetUnoptimizedImages).toHaveBeenCalledWith('WHERE x=1', [1], true);
        expect(result.current.unoptimizedTotalCount).toBe(7);
        expect(result.current.localUnoptimizedImages).toEqual([{ id: 'thumb-1' }]);
        expect(result.current.initializedTabs.has('thumbnails')).toBe(true);

        await act(async () => {
            await result.current.refreshData('thumbnails', false, { scope: 'global' });
        });
        expect(mockGetUnoptimizedImages).toHaveBeenLastCalledWith('', [], undefined);
    });

    it('loads intermediate images with global and filtered scopes', async () => {
        mockGetIntermediateImages.mockResolvedValue([{ id: 'intermediate-1' }]);
        const { result } = renderHook(() => useMaintenanceData('intermediates', 'global'));

        await act(async () => {
            await result.current.refreshData('intermediates', false);
            await result.current.refreshData('intermediates', false, { scope: 'filtered' });
        });

        expect(mockGetIntermediateImages).toHaveBeenNthCalledWith(1, '', []);
        expect(mockGetIntermediateImages).toHaveBeenNthCalledWith(2, 'WHERE x=1', [1]);
        expect(result.current.localIntermediateImages).toEqual([{ id: 'intermediate-1' }]);
    });

    it('does not start a second duplicate backfill while one is running', async () => {
        useLibraryStore.setState({ isScanningDuplicates: true });
        const { result } = renderHook(() => useMaintenanceData('duplicates', 'global'));

        await act(async () => {
            await result.current.refreshData('duplicates', false, { runHashBackfill: true });
        });

        expect(mockGetDuplicateCandidates).toHaveBeenCalled();
        expect(mockBackfillImageFileHashes).not.toHaveBeenCalled();
    });

    it('loads duplicate candidates without starting backfill when explicitly disabled', async () => {
        const { result } = renderHook(() => useMaintenanceData('untagged', 'global'));

        await act(async () => {
            await result.current.refreshData('duplicates', false, { runHashBackfill: false });
        });

        expect(mockGetDuplicateCandidates).toHaveBeenCalledWith();
        expect(mockBackfillImageFileHashes).not.toHaveBeenCalled();
    });

    it('refreshes global candidates and clears scan state after hash backfill succeeds', async () => {
        mockGetDuplicateCandidates
            .mockResolvedValueOnce([{ id: 'before' }])
            .mockResolvedValueOnce([{ id: 'after' }]);
        const { result } = renderHook(() => useMaintenanceData('untagged', 'filtered'));

        await act(async () => {
            await result.current.refreshData('duplicates', false, { scope: 'filtered' });
            await waitFor(() => expect(mockGetDuplicateCandidates).toHaveBeenCalledTimes(2));
        });

        expect(mockGetDuplicateCandidates).toHaveBeenCalledWith();
        expect(result.current.localDuplicateCandidates).toEqual([{ id: 'after' }]);
        expect(useLibraryStore.getState().isScanningDuplicates).toBe(false);
        expect(useLibraryStore.getState().duplicateScanProgress).toBeNull();
    });

    it('logs backfill failures and still clears duplicate scan state', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockBackfillImageFileHashes.mockRejectedValueOnce(new Error('hash failed'));
        const { result } = renderHook(() => useMaintenanceData('untagged', 'global'));

        await act(async () => {
            await result.current.refreshData('duplicates');
            await waitFor(() => expect(useLibraryStore.getState().isScanningDuplicates).toBe(false));
        });

        expect(error).toHaveBeenCalledWith('Failed to complete duplicate scan', expect.any(Error));
        expect(useLibraryStore.getState().lastDuplicateScanResult).toMatchObject({ errors: 1, remaining: 1 });
        error.mockRestore();
    });

    it('marks a duplicate candidate query failure incomplete and releases scan state', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockGetDuplicateCandidates.mockRejectedValueOnce(new Error('sqlite busy'));
        const { result } = renderHook(() => useMaintenanceData('untagged', 'global'));

        await act(async () => {
            await result.current.refreshData('duplicates');
        });

        expect(mockBackfillImageFileHashes).not.toHaveBeenCalled();
        expect(useLibraryStore.getState().isScanningDuplicates).toBe(false);
        expect(useLibraryStore.getState().duplicateScanProgress).toBeNull();
        expect(useLibraryStore.getState().lastDuplicateScanResult).toMatchObject({ errors: 1, remaining: 1 });
        expect(error).toHaveBeenCalledWith('Failed to refresh maintenance data', expect.any(Error));
        error.mockRestore();
    });

    it('logs data-fetch failures and releases the loader', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockGetUntaggedImages.mockRejectedValueOnce(new Error('query failed'));
        const { result } = renderHook(() => useMaintenanceData('untagged', 'global'));

        await act(async () => {
            await result.current.refreshData('untagged');
        });

        expect(result.current.isLoading).toBe(false);
        expect(result.current.hasActiveLoadError).toBe(true);
        expect(error).toHaveBeenCalledWith('Failed to refresh maintenance data', expect.any(Error));
        error.mockRestore();
    });

    it('reuses an identical pending request when a tab is revisited', async () => {
        const pendingTrash = deferred<never[]>();
        mockGetDeletedImages.mockReturnValueOnce(pendingTrash.promise);
        const { result } = renderHook(() => useMaintenanceData('trash', 'global'));

        await waitFor(() => expect(mockGetDeletedImages).toHaveBeenCalledTimes(1));

        let revisit!: Promise<void>;
        act(() => {
            revisit = result.current.refreshData('trash', true);
        });
        expect(mockGetDeletedImages).toHaveBeenCalledTimes(1);

        await act(async () => {
            pendingTrash.resolve([]);
            await revisit;
        });
        expect(result.current.isLoading).toBe(false);
    });

    it('keeps loading ownership with the active tab when an earlier tab finishes', async () => {
        const pendingMissing = deferred<never[]>();
        const pendingTrash = deferred<never[]>();
        mockGetMissingImages.mockReturnValueOnce(pendingMissing.promise);
        mockGetDeletedImages.mockReturnValueOnce(pendingTrash.promise);
        const { result, rerender } = renderHook(
            ({ tab }: { tab: MaintenanceTab }) => useMaintenanceData(tab, 'global'),
            { initialProps: { tab: 'missing' as MaintenanceTab } }
        );

        await waitFor(() => expect(mockGetMissingImages).toHaveBeenCalledTimes(1));
        rerender({ tab: 'trash' });
        await waitFor(() => expect(mockGetDeletedImages).toHaveBeenCalledTimes(1));

        await act(async () => {
            pendingMissing.resolve([]);
            await pendingMissing.promise;
        });
        expect(result.current.isLoading).toBe(true);

        await act(async () => {
            pendingTrash.resolve([]);
            await pendingTrash.promise;
        });
        expect(result.current.isLoading).toBe(false);
    });

    it('ignores an older scoped response after a newer request succeeds', async () => {
        const filtered = deferred<Array<{ id: string }>>();
        const global = deferred<Array<{ id: string }>>();
        mockGetUntaggedImages
            .mockReturnValueOnce(filtered.promise)
            .mockReturnValueOnce(global.promise);
        const { result } = renderHook(() => useMaintenanceData('untagged', 'global'));

        let filteredRequest!: Promise<void>;
        let globalRequest!: Promise<void>;
        act(() => {
            filteredRequest = result.current.refreshData('untagged', true, { scope: 'filtered' });
            globalRequest = result.current.refreshData('untagged', true, { scope: 'global' });
        });

        await act(async () => {
            global.resolve([{ id: 'global' }]);
            await globalRequest;
        });
        await act(async () => {
            filtered.resolve([{ id: 'filtered' }]);
            await filteredRequest;
        });

        expect(result.current.localUntaggedImages).toEqual([{ id: 'global' }]);
        expect(result.current.hasActiveLoadError).toBe(false);
    });

    it('does not surface an older request failure after a newer request succeeds', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const filtered = deferred<Array<{ id: string }>>();
        const global = deferred<Array<{ id: string }>>();
        mockGetUntaggedImages
            .mockReturnValueOnce(filtered.promise)
            .mockReturnValueOnce(global.promise);
        const { result } = renderHook(() => useMaintenanceData('untagged', 'global'));

        let filteredRequest!: Promise<void>;
        let globalRequest!: Promise<void>;
        act(() => {
            filteredRequest = result.current.refreshData('untagged', true, { scope: 'filtered' });
            globalRequest = result.current.refreshData('untagged', true, { scope: 'global' });
        });

        await act(async () => {
            global.resolve([{ id: 'newer' }]);
            await globalRequest;
        });
        await act(async () => {
            filtered.reject(new Error('older request failed'));
            await filteredRequest;
        });

        expect(result.current.localUntaggedImages).toEqual([{ id: 'newer' }]);
        expect(result.current.hasActiveLoadError).toBe(false);
        error.mockRestore();
    });

    it('retries the failed request with its last scope', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockGetUntaggedImages
            .mockRejectedValueOnce(new Error('sqlite busy'))
            .mockResolvedValueOnce([{ id: 'recovered' }]);
        const { result } = renderHook(() => useMaintenanceData('untagged', 'global'));

        await act(async () => {
            await result.current.refreshData('untagged', true, { scope: 'filtered' });
        });
        expect(result.current.hasActiveLoadError).toBe(true);
        expect(result.current.hasLoadedActiveTab).toBe(false);

        await act(async () => {
            await result.current.retryActiveTab();
        });
        expect(mockGetUntaggedImages).toHaveBeenLastCalledWith('WHERE x=1', [1]);
        expect(result.current.localUntaggedImages).toEqual([{ id: 'recovered' }]);
        expect(result.current.hasActiveLoadError).toBe(false);
        expect(result.current.hasLoadedActiveTab).toBe(true);
        error.mockRestore();
    });

    it('keeps the last successful data visible when a refresh fails', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockGetUntaggedImages
            .mockResolvedValueOnce([{ id: 'last-good' }])
            .mockRejectedValueOnce(new Error('refresh failed'));
        const { result } = renderHook(() => useMaintenanceData('untagged', 'global'));

        await act(async () => {
            await result.current.refreshData('untagged');
            await result.current.refreshData('untagged');
        });

        expect(result.current.localUntaggedImages).toEqual([{ id: 'last-good' }]);
        expect(result.current.hasLoadedActiveTab).toBe(true);
        expect(result.current.hasActiveLoadError).toBe(true);
        error.mockRestore();
    });

    it('hydrates duplicates from an existing persisted scan result', async () => {
        useLibraryStore.setState({
            lastDuplicateScanResult: {
                scanned: 1,
                updated: 1,
                missing: 0,
                errors: 0,
                remaining: 0,
                wasCancelled: false
            }
        });

        renderHook(() => useMaintenanceData('duplicates', 'global'));

        await waitFor(() => expect(mockGetDuplicateCandidates).toHaveBeenCalledWith());
        expect(mockBackfillImageFileHashes).not.toHaveBeenCalled();
    });
});
