import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '../../../test/testUtils';
import type { MissingFileAuditResult } from '../../../types';
import { useLibraryStore } from '../../../stores/libraryStore';
import { LibraryHealth } from './LibraryHealth';

interface AuditCall {
    resolve: (value: MissingFileAuditResult) => void;
    signal?: AbortSignal;
}

const healthMocks = vi.hoisted(() => {
    const calls: AuditCall[] = [];
    return {
        calls,
        refreshMaintenanceCounts: vi.fn().mockResolvedValue(undefined),
        verifyLibraryIntegrity: vi.fn((onProgress?: (processed: number, total: number) => void, signal?: AbortSignal) => {
            let resolve!: (value: MissingFileAuditResult) => void;
            const promise = new Promise<MissingFileAuditResult>((res) => {
                resolve = res;
            });
            calls.push({ resolve, signal });
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
    pruneMissingLinks: vi.fn().mockResolvedValue(0)
}));

const auditResult = (missingIds: string[], wasCancelled = false): MissingFileAuditResult => ({
    scanned: wasCancelled ? 5 : 10,
    total: 10,
    missingIds,
    sampleMissingPaths: missingIds.map(id => `${id}.png`),
    wasCancelled
});

const startAudit = async () => {
    fireEvent.click(screen.getByText('Start Full Audit'));
    await waitFor(() => {
        expect(healthMocks.verifyLibraryIntegrity).toHaveBeenCalled();
    });
};

describe('LibraryHealth missing audit ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        healthMocks.calls.length = 0;
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
});
