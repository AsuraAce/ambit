import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { GeneratorTool, type AppSettings } from '../../../../types';
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

    it('routes Link & Import through the provided cancellable scan callback', async () => {
        const onScanFolder = vi.fn().mockResolvedValue({
            images: [],
            stats: { processed: 1, imported: 1, skipped: 0, errors: 0 },
            handledPaths: ['D:/SD/outputs/txt2img-images/image.png'],
            failedPaths: [],
            touchedFacetTypes: [],
            touchedFacetResources: {
                checkpoints: [],
                loras: [],
                embeddings: [],
                hypernetworks: [],
                controlNets: [],
                ipAdapters: [],
                tools: []
            },
            wasCancelled: false
        });
        mocks.discoverA1111Candidates.mockResolvedValue({
            detectedVariant: WebUIVariant.A1111,
            candidates: [
                {
                    path: 'D:/SD/outputs/txt2img-images',
                    name: 'txt2img-images',
                    imageCount: 1,
                    inferredType: 'txt2img',
                    isPriority: true,
                    isAlreadyLinked: false,
                    variant: WebUIVariant.A1111
                }
            ],
            logs: [],
            warnings: []
        });
        mocks.getUnlinkedPriorityCandidatePaths.mockReturnValue(['D:/SD/outputs/txt2img-images']);

        render(<A1111Tab settings={createSettings()} setSettings={vi.fn()} onScanFolder={onScanFolder} />);

        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));
        fireEvent.click(await screen.findByRole('button', { name: /link & import 1 folders/i }));

        await waitFor(() => {
            expect(onScanFolder).toHaveBeenCalledWith([
                {
                    path: 'D:/SD/outputs/txt2img-images',
                    variant: GeneratorTool.AUTOMATIC1111
                }
            ]);
        });
        expect(await screen.findByText('Processed 1 folders (1 new, 0 rescanned)')).toBeTruthy();
        expect(mocks.addToast).not.toHaveBeenCalled();
        expect(mocks.setIsImporting).not.toHaveBeenCalled();
        expect(mocks.setImportProgress).not.toHaveBeenCalled();
    });

    it('shows partial failure inline without emitting a duplicate completion toast', async () => {
        const onScanFolder = vi.fn().mockResolvedValue({
            images: [],
            stats: { processed: 1, imported: 0, skipped: 0, errors: 1 },
            handledPaths: [],
            failedPaths: ['D:/SD/outputs/txt2img-images/bad.png'],
            touchedFacetTypes: [],
            touchedFacetResources: {
                checkpoints: [],
                loras: [],
                embeddings: [],
                hypernetworks: [],
                controlNets: [],
                ipAdapters: [],
                tools: []
            },
            wasCancelled: false
        });
        mocks.discoverA1111Candidates.mockResolvedValue({
            detectedVariant: WebUIVariant.A1111,
            candidates: [
                {
                    path: 'D:/SD/outputs/txt2img-images',
                    name: 'txt2img-images',
                    imageCount: 1,
                    inferredType: 'txt2img',
                    isPriority: true,
                    isAlreadyLinked: false,
                    variant: WebUIVariant.A1111
                }
            ],
            logs: [],
            warnings: []
        });
        mocks.getUnlinkedPriorityCandidatePaths.mockReturnValue(['D:/SD/outputs/txt2img-images']);

        render(<A1111Tab settings={createSettings()} setSettings={vi.fn()} onScanFolder={onScanFolder} />);

        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));
        fireEvent.click(await screen.findByRole('button', { name: /link & import 1 folders/i }));

        expect(await screen.findByText('Processed 1 folders with 1 failed file(s). Folder cursor was not advanced.')).toBeTruthy();
        expect(mocks.addToast).not.toHaveBeenCalled();
    });

    it('marks only newly linked folders as cancelled when Link & Import is cancelled', async () => {
        const settings = createSettings();
        settings.monitoredFolders = [
            {
                id: 'existing-folder',
                path: 'D:/SD/outputs/existing',
                isActive: true,
                imageCount: 4,
                lastScanned: 123,
                initialScanCancelled: false
            }
        ];
        const setSettings = vi.fn();
        const onScanFolder = vi.fn().mockResolvedValue({
            images: [],
            stats: { processed: 1, imported: 1, skipped: 0, errors: 0 },
            handledPaths: ['D:/SD/outputs/txt2img-images/image.png'],
            failedPaths: [],
            touchedFacetTypes: [],
            touchedFacetResources: {
                checkpoints: [],
                loras: [],
                embeddings: [],
                hypernetworks: [],
                controlNets: [],
                ipAdapters: [],
                tools: []
            },
            wasCancelled: true
        });
        mocks.discoverA1111Candidates.mockResolvedValue({
            detectedVariant: WebUIVariant.A1111,
            candidates: [
                {
                    path: 'D:/SD/outputs/txt2img-images',
                    name: 'txt2img-images',
                    imageCount: 1,
                    inferredType: 'txt2img',
                    isPriority: true,
                    isAlreadyLinked: false,
                    variant: WebUIVariant.A1111
                }
            ],
            logs: [],
            warnings: []
        });
        mocks.getUnlinkedPriorityCandidatePaths.mockReturnValue(['D:/SD/outputs/txt2img-images']);

        render(<A1111Tab settings={settings} setSettings={setSettings} onScanFolder={onScanFolder} />);

        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));
        fireEvent.click(await screen.findByRole('button', { name: /link & import 1 folders/i }));

        expect(await screen.findByText('Import cancelled. Imported images were kept, and folder cursor was not advanced. Rescan to continue.')).toBeTruthy();
        expect(onScanFolder).toHaveBeenCalledWith([
            {
                path: 'D:/SD/outputs/txt2img-images',
                variant: GeneratorTool.AUTOMATIC1111
            }
        ]);

        const addUpdate = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
        const settingsAfterAdd = addUpdate(settings);
        const cancelUpdate = setSettings.mock.calls[1][0] as (previous: AppSettings) => AppSettings;
        const settingsAfterCancel = cancelUpdate(settingsAfterAdd);

        expect(settingsAfterCancel.monitoredFolders.find(folder => folder.id === 'existing-folder')).toMatchObject({
            id: 'existing-folder',
            lastScanned: 123,
            initialScanCancelled: false
        });
        expect(settingsAfterCancel.monitoredFolders.find(folder => folder.path === 'D:/SD/outputs/txt2img-images')).toMatchObject({
            path: 'D:/SD/outputs/txt2img-images',
            initialScanPending: false,
            initialScanCancelled: true
        });
        expect(settingsAfterCancel.monitoredFolders.find(folder => folder.path === 'D:/SD/outputs/txt2img-images')?.lastScanned).toBeUndefined();
        expect(mocks.addToast).not.toHaveBeenCalled();
    });
});
