
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMaintenanceData } from '../useMaintenanceData';
import { useLibraryStore } from '../../stores/libraryStore';

// --- Mocks ---
const mockGetDeletedImages = vi.fn().mockResolvedValue([]);
const mockGetMissingImages = vi.fn().mockResolvedValue([]);
const mockGetUntaggedImages = vi.fn().mockResolvedValue([]);
const mockGetDuplicateCandidates = vi.fn().mockResolvedValue([]);
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
    getUntaggedImages: (...args: any[]) => mockGetUntaggedImages(...args),
    backfillImageFileHashes: () => mockBackfillImageFileHashes(),
    getDuplicateCandidates: (...args: any[]) => mockGetDuplicateCandidates(...args),
    getUnoptimizedImages: vi.fn().mockResolvedValue([]),
    getIntermediateImages: vi.fn().mockResolvedValue([]),
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
        });

        await waitFor(() => {
            expect(mockGetUntaggedImages).toHaveBeenCalledWith('WHERE x=1', [1]);
        });
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
});
