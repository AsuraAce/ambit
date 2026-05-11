import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import type { AppSettings } from '../../../../types';
import { WebUIVariant } from '../../../../services/a1111/types';
import { A1111Tab } from '../A1111Tab';

const mocks = vi.hoisted(() => ({
    addToast: vi.fn(),
    discoverA1111Candidates: vi.fn(),
    getUnlinkedPriorityCandidatePaths: vi.fn(),
    refreshCollections: vi.fn(),
    refreshMetadata: vi.fn(),
    setImportProgress: vi.fn(),
    setIsImporting: vi.fn()
}));

vi.mock('../../../../hooks/useLibraryContext', () => ({
    useLibraryContext: () => ({
        setIsImporting: mocks.setIsImporting,
        setImportProgress: mocks.setImportProgress,
        refreshCollections: mocks.refreshCollections
    })
}));

vi.mock('../../../../contexts/SearchContext', () => ({
    useSearch: () => ({
        refreshMetadata: mocks.refreshMetadata
    })
}));

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: mocks.addToast
    })
}));

vi.mock('../../../../services/a1111/config', () => ({
    discoverA1111Candidates: mocks.discoverA1111Candidates,
    getUnlinkedPriorityCandidatePaths: mocks.getUnlinkedPriorityCandidatePaths
}));

const createSettings = (): AppSettings => ({
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 200,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    maskedKeywords: [],
    maskingMode: 'blur',
    enableAI: false,
    a1111Path: 'D:/SD/outputs',
    devMode: true
});

describe('A1111Tab discovery warnings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getUnlinkedPriorityCandidatePaths.mockReturnValue([]);
    });

    it('surfaces warning-only discovery results and keeps the debug log visible', async () => {
        mocks.discoverA1111Candidates.mockResolvedValue({
            detectedVariant: WebUIVariant.A1111,
            candidates: [],
            logs: ['[9:31:52 AM]   ! Warning: Could not read D:/SD/outputs/txt2img-images'],
            warnings: ['Could not read D:/SD/outputs/txt2img-images']
        });

        render(<A1111Tab settings={createSettings()} setSettings={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));

        expect(await screen.findByText('Discovery completed with 1 warning and no importable folders. Review scan debug log.')).toBeTruthy();
        expect(screen.getByText('View Scan Debug Log (1 entries)')).toBeTruthy();
        expect(screen.queryByText('No potential folders containing images found.')).toBeNull();

        await waitFor(() => {
            expect(mocks.discoverA1111Candidates).toHaveBeenCalledWith(
                'D:/SD/outputs',
                expect.any(Set),
                'Auto'
            );
        });
    });
});
