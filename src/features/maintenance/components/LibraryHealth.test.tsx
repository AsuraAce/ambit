import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '../../../test/testUtils';
import type { MissingFileAuditResult } from '../../../types';
import { useLibraryStore } from '../../../stores/libraryStore';
import { LibraryHealth } from './LibraryHealth';

interface AuditCall {
    resolve: (value: MissingFileAuditResult) => void;
    signal?: AbortSignal;
    onProgress?: (processed: number, total: number) => void;
}

const healthMocks = vi.hoisted(() => {
    const calls: AuditCall[] = [];
    return {
        calls,
        refreshMaintenanceCounts: vi.fn().mockResolvedValue(undefined),
        pruneMissingLinks: vi.fn().mockResolvedValue(0),
        verifyLibraryIntegrity: vi.fn((onProgress?: (processed: number, total: number) => void, signal?: AbortSignal) => {
            let resolve!: (value: MissingFileAuditResult) => void;
            const promise = new Promise<MissingFileAuditResult>((res) => {
                resolve = res;
            });
            calls.push({ resolve, signal, onProgress });
            onProgress?.(0, 10);
            return promise;
        })
    };
});

vi.mock('../../../contexts/LibraryContext', () => ({
    useLibraryContext: () => ({
        refreshMaintenanceCounts: healthMocks.refreshMaintenanceCounts
    })
}));

vi.mock('../../../services/db/maintenanceRepo', () => ({
    verifyLibraryIntegrity: healthMocks.verifyLibraryIntegrity,
    pruneMissingLinks: healthMocks.pruneMissingLinks
}));

const auditResult = (missingIds: string[], wasCancelled = false): MissingFileAuditResult => ({
    scanned: wasCancelled ? 5 : 10,
    total: 10,
    missingIds,
    sampleMissingPaths: missingIds.map(id => `${id}.png`),
    wasCancelled
});

const startAudit = async () => {
    fireEvent.click(screen.getByText('Start File Audit'));
    await waitFor(() => {
        expect(healthMocks.verifyLibraryIntegrity).toHaveBeenCalled();
    });
};

describe('LibraryHealth missing audit ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        healthMocks.calls.length = 0;
        healthMocks.pruneMissingLinks.mockResolvedValue(0);
        useLibraryStore.setState(useLibraryStore.getInitialState(), true);
    });

    it('ignores a stale cancelled audit when a newer audit owns the store', async () => {
        render(<LibraryHealth />);

        await startAudit();
        const first = healthMocks.calls[0];

        act(() => {
            useLibraryStore.getState().cancelMissingScan();
        });

        await startAudit();
        await waitFor(() => {
            expect(healthMocks.calls).toHaveLength(2);
        });
        const second = healthMocks.calls[1];
        const secondController = useLibraryStore.getState().missingScanAbortController;

        await act(async () => {
            first.resolve(auditResult(['stale'], true));
        });

        expect(first.signal?.aborted).toBe(true);
        expect(useLibraryStore.getState().lastMissingScanResult).toBeNull();
        expect(useLibraryStore.getState().isScanningMissingFiles).toBe(true);
        expect(useLibraryStore.getState().missingScanAbortController).toBe(secondController);

        await act(async () => {
            second.resolve(auditResult(['fresh']));
        });

        await waitFor(() => {
            expect(useLibraryStore.getState().lastMissingScanResult?.missingIds).toEqual(['fresh']);
        });
        expect(useLibraryStore.getState().isScanningMissingFiles).toBe(false);
        expect(useLibraryStore.getState().missingScanAbortController).toBeNull();
    });

    it('stores a cancelled partial audit when no newer audit supersedes it', async () => {
        render(<LibraryHealth />);

        await startAudit();
        const first = healthMocks.calls[0];

        act(() => {
            useLibraryStore.getState().cancelMissingScan();
        });

        await act(async () => {
            first.resolve(auditResult(['partial'], true));
        });

        await waitFor(() => {
            expect(useLibraryStore.getState().lastMissingScanResult?.missingIds).toEqual(['partial']);
        });
        expect(useLibraryStore.getState().lastMissingScanResult?.wasCancelled).toBe(true);
        expect(useLibraryStore.getState().isScanningMissingFiles).toBe(false);
        expect(useLibraryStore.getState().missingScanAbortController).toBeNull();
    });

    it('clears the consumer result and ignores stale or aborted progress callbacks', async () => {
        const onScanComplete = vi.fn();
        render(<LibraryHealth onScanComplete={onScanComplete} />);

        await startAudit();
        const call = healthMocks.calls[0];
        expect(onScanComplete).toHaveBeenCalledWith([]);

        act(() => useLibraryStore.getState().missingScanAbortController?.abort());
        act(() => call.onProgress?.(5, 10));
        expect(useLibraryStore.getState().missingScanProgress?.current).toBe(0);

        act(() => useLibraryStore.setState({ missingScanAbortController: new AbortController() }));
        act(() => call.onProgress?.(7, 10));
        expect(useLibraryStore.getState().missingScanProgress?.current).toBe(0);

        await act(async () => call.resolve(auditResult([], true)));
    });

    it('contains verification failures and releases the active audit state', async () => {
        healthMocks.verifyLibraryIntegrity.mockRejectedValueOnce(new Error('audit failed'));
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<LibraryHealth />);

        fireEvent.click(screen.getByText('Start File Audit'));

        await waitFor(() => expect(useLibraryStore.getState().isScanningMissingFiles).toBe(false));
        expect(useLibraryStore.getState().missingScanProgress).toBeNull();
        expect(useLibraryStore.getState().missingScanAbortController).toBeNull();
        expect(error).toHaveBeenCalledWith(expect.any(Error));
        error.mockRestore();
    });

    it('renders compact idle, running, healthy, and missing-result states', () => {
        const onNavigate = vi.fn();
        const view = render(<LibraryHealth mode="compact" onNavigateToMaintenance={onNavigate} />);
        expect(screen.getByRole('button', { name: 'Run Audit' })).toBeTruthy();

        act(() => useLibraryStore.setState({ isScanningMissingFiles: true }));
        expect((screen.getByRole('button', { name: 'Run Audit' }) as HTMLButtonElement).disabled).toBe(true);

        act(() => useLibraryStore.setState({
            isScanningMissingFiles: false,
            lastMissingScanResult: auditResult([])
        }));
        expect(screen.getByText('File Links Healthy')).toBeTruthy();
        fireEvent.click(screen.getByTitle('Open Maintenance'));
        expect(onNavigate).toHaveBeenCalled();

        act(() => useLibraryStore.setState({ lastMissingScanResult: auditResult(['missing']) }));
        expect(screen.getByText('1 Missing')).toBeTruthy();
        view.unmount();
    });

    it('renders a healthy detailed result and supports rescanning', async () => {
        useLibraryStore.setState({ lastMissingScanResult: auditResult([]) });
        render(<LibraryHealth />);

        expect(screen.getByText('File Links Healthy')).toBeTruthy();
        fireEvent.click(screen.getByText('Re-Scan Files'));
        await waitFor(() => expect(healthMocks.verifyLibraryIntegrity).toHaveBeenCalled());
        await act(async () => healthMocks.calls[0].resolve(auditResult([])));
    });

    it('shows cancelled scan totals and overflow missing-path copy', () => {
        const ids = Array.from({ length: 12 }, (_, index) => `missing-${index}`);
        useLibraryStore.setState({ lastMissingScanResult: auditResult(ids, true) });
        render(<LibraryHealth />);

        expect(screen.getByText('5 / 10')).toBeTruthy();
        expect(screen.getByText(/audit cancelled/i)).toBeTruthy();
        expect(screen.getByText('... and 2 more entries.')).toBeTruthy();
    });

    it('shows running audit progress from the shared store', () => {
        useLibraryStore.setState({
            isScanningMissingFiles: true,
            missingScanProgress: { current: 3, total: 4, message: 'Checking' }
        });
        render(<LibraryHealth />);

        expect(screen.getByText('75%')).toBeTruthy();
    });

    it('prunes missing records, shows progress and success, then reloads', async () => {
        vi.useFakeTimers();
        try {
            let resolvePrune!: () => void;
            healthMocks.pruneMissingLinks.mockReturnValueOnce(new Promise<void>(resolve => {
                resolvePrune = () => resolve();
            }));
            useLibraryStore.setState({ lastMissingScanResult: auditResult(['missing']) });
            render(<LibraryHealth />);

            fireEvent.click(screen.getByText('Prune All Records'));
            expect(screen.getByText('Pruning...')).toBeTruthy();
            await act(async () => resolvePrune());
            expect(screen.getByText('Success')).toBeTruthy();
            expect(healthMocks.pruneMissingLinks).toHaveBeenCalledWith(['missing']);
            act(() => vi.advanceTimersByTime(1500));
        } finally {
            vi.useRealTimers();
        }
    });

    it('restores prune controls after a failure', async () => {
        healthMocks.pruneMissingLinks.mockRejectedValueOnce(new Error('prune failed'));
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        useLibraryStore.setState({ lastMissingScanResult: auditResult(['missing']) });
        render(<LibraryHealth />);

        fireEvent.click(screen.getByText('Prune All Records'));

        await waitFor(() => expect(screen.getByText('Prune All Records')).toBeTruthy());
        expect(error).toHaveBeenCalledWith(expect.any(Error));
        error.mockRestore();
    });
});
