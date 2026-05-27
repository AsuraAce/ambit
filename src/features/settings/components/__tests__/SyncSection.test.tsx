import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { AppSettings } from '../../../../types';
import { SyncSection } from '../SyncSection';

const mocks = vi.hoisted(() => ({
    startInvokeSync: vi.fn(),
    cancelSync: vi.fn(),
    addToast: vi.fn()
}));

vi.mock('../../../../contexts/LibraryContext', () => ({
    useLibrary: () => ({
        syncState: {
            status: 'idle',
            progress: { current: 0, total: 0 }
        },
        startInvokeSync: mocks.startInvokeSync,
        cancelSync: mocks.cancelSync
    })
}));

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: mocks.addToast
    })
}));

const createSettings = (): AppSettings => ({
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 220,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    maskedKeywords: [],
    maskingMode: 'blur',
    enableAI: false,
    invokeAiPath: 'D:/Invoke',
    lastSyncedAt: 123456,
    importIntermediates: false,
    importOrphans: true,
    starredAs: 'favorite',
    syncBoardsToCollections: true
});

describe('SyncSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('starts manual sync from the saved cursor so stale repair does not force a full resync', () => {
        render(<SyncSection settings={createSettings()} setSettings={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /initiate sync/i }));

        expect(mocks.startInvokeSync).toHaveBeenCalledWith(expect.objectContaining({
            afterTimestamp: 123456
        }));
    });
});
