
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMaintenanceData } from '../useMaintenanceData';
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
    useLibraryContext: () => ({
        activeSqlWhere: 'WHERE x=1',
        activeSqlParams: [1]
    }),
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

        expect(mockGetDuplicateCandidates).toHaveBeenCalledWith('', []);
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

        expect(mockGetDuplicateCandidates).toHaveBeenCalledWith('', []);
        expect(mockBackfillImageFileHashes).not.toHaveBeenCalled();
    });

    it('refreshes candidates and clears scan state after hash backfill succeeds', async () => {
        mockGetDuplicateCandidates
            .mockResolvedValueOnce([{ id: 'before' }])
            .mockResolvedValueOnce([{ id: 'after' }]);
        const { result } = renderHook(() => useMaintenanceData('untagged', 'filtered'));

        await act(async () => {
            await result.current.refreshData('duplicates', false, { scope: 'filtered' });
            await waitFor(() => expect(mockGetDuplicateCandidates).toHaveBeenCalledTimes(2));
        });

        expect(mockGetDuplicateCandidates).toHaveBeenCalledWith('WHERE x=1', [1]);
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

        expect(error).toHaveBeenCalledWith('Failed to run duplicate hash scan', expect.any(Error));
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
        expect(error).toHaveBeenCalledWith('Failed to refresh maintenance data', expect.any(Error));
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
            },
            duplicateScanScope: 'filtered'
        });

        renderHook(() => useMaintenanceData('duplicates', 'global'));

        await waitFor(() => expect(mockGetDuplicateCandidates).toHaveBeenCalledWith('WHERE x=1', [1]));
        expect(mockBackfillImageFileHashes).not.toHaveBeenCalled();
    });
});
