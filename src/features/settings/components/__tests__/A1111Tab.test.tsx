import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { GeneratorTool, type AppSettings } from '../../../../types';
import type { ImportResult } from '../../../../services/importService';
import { A1111FolderType, WebUIVariant, type DiscoveryCandidate } from '../../../../services/a1111/types';
import { A1111Tab } from '../A1111Tab';

const mocks = vi.hoisted(() => ({
    addToast: vi.fn(),
    discoverA1111Candidates: vi.fn(),
    getUnlinkedPriorityCandidatePaths: vi.fn(),
    refreshCollections: vi.fn(),
    refreshMetadata: vi.fn(),
    open: vi.fn(),
    normalizePath: vi.fn((path: string) => path.replace(/\\/g, '/')),
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

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('../../../../utils/pathUtils', () => ({ normalizePath: mocks.normalizePath }));

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

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => {
        resolve = res;
    });
    return { promise, resolve };
}

const candidate = (overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate => ({
    path: 'D:/SD/outputs/txt2img-images',
    name: 'txt2img-images',
    imageCount: 1,
    inferredType: A1111FolderType.TXT2IMG,
    isPriority: true,
    isAlreadyLinked: false,
    variant: WebUIVariant.A1111,
    ...overrides
});

const importResult = (overrides: Partial<ImportResult> = {}): ImportResult => ({
    images: [],
    stats: { processed: 1, imported: 1, skipped: 0, errors: 0 },
    handledPaths: [],
    failedPaths: [],
    touchedFacetTypes: [],
    touchedFacetResources: {
        checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
        controlNets: [], ipAdapters: [], tools: []
    },
    wasCancelled: false,
    completedSourcePaths: [],
    cancelledSourcePaths: [],
    ...overrides
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
            wasCancelled: false,
            completedSourcePaths: ['D:/SD/outputs/txt2img-images'],
            cancelledSourcePaths: []
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

    it('waits for Link & Import scan finalization before advancing newly linked folder cursors', async () => {
        const setSettings = vi.fn();
        const scan = deferred<ImportResult>();
        const onScanFolder = vi.fn(() => scan.promise);
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

        render(<A1111Tab settings={createSettings()} setSettings={setSettings} onScanFolder={onScanFolder} />);

        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));
        fireEvent.click(await screen.findByRole('button', { name: /link & import 1 folders/i }));

        await waitFor(() => {
            expect(onScanFolder).toHaveBeenCalled();
        });
        expect(setSettings).toHaveBeenCalledTimes(1);

        scan.resolve({
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
            wasCancelled: false,
            completedSourcePaths: ['D:/SD/outputs/txt2img-images'],
            cancelledSourcePaths: []
        });

        await waitFor(() => {
            expect(setSettings).toHaveBeenCalledTimes(2);
        });

        const addUpdate = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
        const settingsAfterAdd = addUpdate(createSettings());
        expect(settingsAfterAdd.monitoredFolders[0].lastScanned).toBeUndefined();

        const completeUpdate = setSettings.mock.calls[1][0] as (previous: AppSettings) => AppSettings;
        const settingsAfterComplete = completeUpdate(settingsAfterAdd);
        expect(settingsAfterComplete.monitoredFolders[0]).toMatchObject({
            path: 'D:/SD/outputs/txt2img-images',
            initialScanPending: false,
            initialScanCancelled: false,
            lastScanned: expect.any(Number)
        });
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
            wasCancelled: false,
            completedSourcePaths: [],
            cancelledSourcePaths: []
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

        expect(await screen.findByText('Processed 1 folders with 1 failed file(s). Completed folders were marked scanned; folders with failures were left retryable.')).toBeTruthy();
        expect(mocks.addToast).not.toHaveBeenCalled();
    });

    it('marks only unfinished newly linked folders as cancelled when Link & Import is cancelled', async () => {
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
            wasCancelled: true,
            completedSourcePaths: ['D:/SD/outputs/txt2img-images'],
            cancelledSourcePaths: ['D:/SD/outputs/img2img-images']
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
                },
                {
                    path: 'D:/SD/outputs/img2img-images',
                    name: 'img2img-images',
                    imageCount: 1,
                    inferredType: 'img2img',
                    isPriority: true,
                    isAlreadyLinked: false,
                    variant: WebUIVariant.A1111
                }
            ],
            logs: [],
            warnings: []
        });
        mocks.getUnlinkedPriorityCandidatePaths.mockReturnValue([
            'D:/SD/outputs/txt2img-images',
            'D:/SD/outputs/img2img-images'
        ]);

        render(<A1111Tab settings={settings} setSettings={setSettings} onScanFolder={onScanFolder} />);

        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));
        fireEvent.click(await screen.findByRole('button', { name: /link & import 2 folders/i }));

        expect(await screen.findByText('Import cancelled. 1 folder(s) completed; 1 unfinished folder(s) were paused. Imported images were kept; rescan unfinished folders to continue.')).toBeTruthy();
        expect(onScanFolder).toHaveBeenCalledWith([
            {
                path: 'D:/SD/outputs/txt2img-images',
                variant: GeneratorTool.AUTOMATIC1111
            },
            {
                path: 'D:/SD/outputs/img2img-images',
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
            initialScanCancelled: false,
            lastScanned: expect.any(Number)
        });
        expect(settingsAfterCancel.monitoredFolders.find(folder => folder.path === 'D:/SD/outputs/img2img-images')).toMatchObject({
            path: 'D:/SD/outputs/img2img-images',
            initialScanPending: false,
            initialScanCancelled: true
        });
        expect(settingsAfterCancel.monitoredFolders.find(folder => folder.path === 'D:/SD/outputs/img2img-images')?.lastScanned).toBeUndefined();
        expect(mocks.addToast).not.toHaveBeenCalled();
    });

    it('updates the configured path from text input and the folder browser', async () => {
        const setSettings = vi.fn();
        mocks.open.mockResolvedValue('D:\\Browsed\\SD');
        render(<A1111Tab settings={createSettings()} setSettings={setSettings} />);

        fireEvent.change(screen.getByPlaceholderText(/stableDiffusion/i), { target: { value: 'E:/Archive' } });
        fireEvent.click(screen.getByTitle('Browse'));
        await waitFor(() => expect(setSettings).toHaveBeenCalledTimes(2));

        const paths = setSettings.mock.calls.map(([updater]) =>
            (updater as (previous: AppSettings) => AppSettings)(createSettings()).a1111Path
        );
        expect(paths).toEqual(expect.arrayContaining(['E:/Archive', 'D:/Browsed/SD']));
    });

    it('keeps discovery disabled without a root path', () => {
        const settings = createSettings();
        settings.a1111Path = undefined;
        render(<A1111Tab settings={settings} setSettings={vi.fn()} />);
        const scan = screen.getByRole('button', { name: /scan for folders/i }) as HTMLButtonElement;
        expect(scan.disabled).toBe(true);
        expect(mocks.discoverA1111Candidates).not.toHaveBeenCalled();
        expect((screen.getByPlaceholderText(/stableDiffusion/i) as HTMLInputElement).value).toBe('');
    });

    it('ignores cancelled folder browsing and reports browser failures to the console', async () => {
        const setSettings = vi.fn();
        mocks.open.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('dialog failed'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<A1111Tab settings={createSettings()} setSettings={setSettings} />);

        fireEvent.click(screen.getByTitle('Browse'));
        await waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByTitle('Browse'));
        await waitFor(() => expect(console.error).toHaveBeenCalled());
        expect(setSettings).not.toHaveBeenCalled();
    });

    it('supports forced discovery, warnings with results, non-priority visibility, selection, and type correction', async () => {
        const priority = candidate({ variant: WebUIVariant.FORGE });
        const secondary = candidate({
            path: 'D:/SD/archive',
            name: 'archive',
            inferredType: A1111FolderType.UNKNOWN,
            isPriority: false,
            variant: WebUIVariant.FORGE
        });
        mocks.discoverA1111Candidates.mockResolvedValue({
            detectedVariant: WebUIVariant.FORGE,
            candidates: [priority, secondary],
            logs: ['scan'],
            warnings: ['warning one', 'warning two']
        });
        mocks.getUnlinkedPriorityCandidatePaths.mockReturnValue([priority.path]);
        render(<A1111Tab settings={createSettings()} setSettings={vi.fn()} onScanFolder={vi.fn()} />);

        fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: WebUIVariant.FORGE } });
        fireEvent.click(screen.getByRole('button', { name: /scan as forge/i }));
        expect(await screen.findByText('Discovery completed with 2 warnings. Review scan debug log.')).toBeTruthy();
        expect(screen.getByText('Showing standard output folders (1 of 2)')).toBeTruthy();
        expect(screen.getByText('Detected: Forge')).toBeTruthy();

        fireEvent.click(screen.getByText('Show non-standard folders'));
        expect(screen.getByText('archive')).toBeTruthy();
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[1]);
        fireEvent.click(checkboxes[1]);
        fireEvent.click(checkboxes[2]);
        fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: 'saved' } });
        expect(screen.getByRole('button', { name: /link & import 2 folders/i })).toBeTruthy();
        expect(mocks.discoverA1111Candidates).toHaveBeenCalledWith('D:/SD/outputs', expect.any(Set), WebUIVariant.FORGE);
    });

    it('shows empty and failed discovery outcomes', async () => {
        mocks.discoverA1111Candidates.mockResolvedValueOnce({ candidates: [], logs: [], warnings: [] });
        const view = render(<A1111Tab settings={createSettings()} setSettings={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));
        expect(await screen.findByText('No potential folders containing images found.')).toBeTruthy();

        mocks.discoverA1111Candidates.mockRejectedValueOnce(new Error('discovery failed'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));
        expect(await screen.findByText('Discovery failed. Check path permissions.')).toBeTruthy();
        view.unmount();
    });

    it('reports unavailable import service and undefined import completion', async () => {
        mocks.discoverA1111Candidates.mockResolvedValue({ candidates: [candidate()], logs: [], warnings: [] });
        mocks.getUnlinkedPriorityCandidatePaths.mockReturnValue([candidate().path]);
        const view = render(<A1111Tab settings={createSettings()} setSettings={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));
        fireEvent.click(await screen.findByRole('button', { name: /link & import 1 folders/i }));
        expect(await screen.findByText('Import service is unavailable.')).toBeTruthy();
        expect(mocks.addToast).toHaveBeenCalledWith('Import service is unavailable', 'error');

        view.unmount();
        vi.clearAllMocks();
        mocks.getUnlinkedPriorityCandidatePaths.mockReturnValue([candidate().path]);
        mocks.discoverA1111Candidates.mockResolvedValue({ candidates: [candidate()], logs: [], warnings: [] });
        render(<A1111Tab settings={createSettings()} setSettings={vi.fn()} onScanFolder={vi.fn().mockResolvedValue(undefined)} />);
        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));
        fireEvent.click(await screen.findByRole('button', { name: /link & import 1 folders/i }));
        expect(await screen.findByText('Import did not complete. Folder cursor was not advanced.')).toBeTruthy();
    });

    it('reports refresh failures after a completed import', async () => {
        mocks.discoverA1111Candidates.mockResolvedValue({ candidates: [candidate()], logs: [], warnings: [] });
        mocks.getUnlinkedPriorityCandidatePaths.mockReturnValue([candidate().path]);
        mocks.refreshCollections.mockRejectedValueOnce(new Error('refresh failed'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<A1111Tab settings={createSettings()} setSettings={vi.fn()} onScanFolder={vi.fn().mockResolvedValue(importResult({ completedSourcePaths: [candidate().path] }))} />);
        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));
        fireEvent.click(await screen.findByRole('button', { name: /link & import 1 folders/i }));
        expect(await screen.findByText('Processed 1 folders (1 new, 0 rescanned), but refresh failed.')).toBeTruthy();
    });

    it('auto-expands generic non-priority results and identifies linked folders', async () => {
        const linked = candidate({
            path: 'D:/SD/archive',
            name: 'archive',
            isPriority: false,
            isAlreadyLinked: true,
            variant: WebUIVariant.UNKNOWN
        });
        mocks.discoverA1111Candidates.mockResolvedValue({ candidates: [linked], logs: [], warnings: [] });
        mocks.getUnlinkedPriorityCandidatePaths.mockReturnValue([linked.path]);
        const view = render(<A1111Tab settings={createSettings()} setSettings={vi.fn()} onScanFolder={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));

        expect(await screen.findByText('Generic WebUI detected. Select specific Installation Type above for correct image tagging.')).toBeTruthy();
        expect(screen.getByText('Linked')).toBeTruthy();
        expect(screen.getByRole('button', { name: /link\/sync 1 folders/i })).toBeTruthy();

        const settingsWithoutPath = createSettings();
        settingsWithoutPath.a1111Path = undefined;
        view.rerender(<A1111Tab settings={settingsWithoutPath} setSettings={vi.fn()} onScanFolder={vi.fn()} />);
        expect(screen.getByText('...D:/SD/archive')).toBeTruthy();
    });

    it('renders a disabled link action when discovery selects no candidates', async () => {
        mocks.discoverA1111Candidates.mockResolvedValue({ candidates: [candidate()], logs: [], warnings: [] });
        mocks.getUnlinkedPriorityCandidatePaths.mockReturnValue([]);
        render(<A1111Tab settings={createSettings()} setSettings={vi.fn()} onScanFolder={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));
        expect((await screen.findByRole('button', { name: /link & import 0 folders/i }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('maps every supported variant and unknown linked folders into import tasks', async () => {
        const candidates = [
            candidate({ path: 'D:/forge', variant: WebUIVariant.FORGE }),
            candidate({ path: 'D:/sdnext', variant: WebUIVariant.SDNEXT }),
            candidate({ path: 'D:/anapnoe', variant: WebUIVariant.ANAPNOE }),
            candidate({ path: 'D:/unknown', variant: WebUIVariant.UNKNOWN, isAlreadyLinked: true })
        ];
        mocks.discoverA1111Candidates.mockResolvedValue({ candidates, logs: [], warnings: [] });
        mocks.getUnlinkedPriorityCandidatePaths.mockReturnValue(candidates.map(item => item.path));
        const onScanFolder = vi.fn().mockResolvedValue(importResult({
            completedSourcePaths: candidates.map(item => item.path)
        }));
        render(<A1111Tab settings={createSettings()} setSettings={vi.fn()} onScanFolder={onScanFolder} />);
        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));
        fireEvent.click(await screen.findByRole('button', { name: /link\/sync 4 folders/i }));

        await waitFor(() => expect(onScanFolder).toHaveBeenCalledWith([
            { path: 'D:/unknown', variant: GeneratorTool.UNKNOWN },
            { path: 'D:/forge', variant: GeneratorTool.FORGE },
            { path: 'D:/sdnext', variant: GeneratorTool.SDNEXT },
            { path: 'D:/anapnoe', variant: GeneratorTool.ANAPNOE }
        ]));
    });

    it('rescans linked folders without adding monitored-folder records', async () => {
        const linked = candidate({ isAlreadyLinked: true, variant: undefined });
        mocks.discoverA1111Candidates.mockResolvedValue({ candidates: [linked], logs: [], warnings: [] });
        mocks.getUnlinkedPriorityCandidatePaths.mockReturnValue([linked.path]);
        const setSettings = vi.fn();
        const onScanFolder = vi.fn().mockResolvedValue(importResult());
        render(<A1111Tab settings={createSettings()} setSettings={setSettings} onScanFolder={onScanFolder} />);
        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));
        fireEvent.click(await screen.findByRole('button', { name: /link\/sync 1 folders/i }));

        await waitFor(() => expect(onScanFolder).toHaveBeenCalledWith([{ path: linked.path, variant: GeneratorTool.UNKNOWN }]));
        expect(setSettings).not.toHaveBeenCalled();
        expect(await screen.findByText('Processed 1 folders (0 new, 1 rescanned)')).toBeTruthy();
    });

    it('reports cancellation when no new folder completed', async () => {
        mocks.discoverA1111Candidates.mockResolvedValue({ candidates: [candidate()], logs: [], warnings: [] });
        mocks.getUnlinkedPriorityCandidatePaths.mockReturnValue([candidate().path]);
        render(<A1111Tab settings={createSettings()} setSettings={vi.fn()} onScanFolder={vi.fn().mockResolvedValue(importResult({
            wasCancelled: true,
            cancelledSourcePaths: [candidate().path]
        }))} />);
        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));
        fireEvent.click(await screen.findByRole('button', { name: /link & import 1 folders/i }));
        expect(await screen.findByText('Import cancelled. Imported images were kept; unfinished folders were paused. Rescan to continue.')).toBeTruthy();
    });

    it('rolls newly linked folders back to retryable state when import throws', async () => {
        const setSettings = vi.fn();
        const settings = createSettings();
        settings.monitoredFolders = [{ id: 'existing', path: 'D:/existing', isActive: true, imageCount: 1 }];
        mocks.discoverA1111Candidates.mockResolvedValue({ candidates: [candidate()], logs: [], warnings: [] });
        mocks.getUnlinkedPriorityCandidatePaths.mockReturnValue([candidate().path]);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<A1111Tab settings={settings} setSettings={setSettings} onScanFolder={vi.fn().mockRejectedValue(new Error('import failed'))} />);
        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));
        fireEvent.click(await screen.findByRole('button', { name: /link & import 1 folders/i }));

        expect(await screen.findByText('Use Check Console for details')).toBeTruthy();
        expect(mocks.addToast).toHaveBeenCalledWith('Import failed', 'error');
        const add = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
        const rollback = setSettings.mock.calls[1][0] as (previous: AppSettings) => AppSettings;
        const rolledBack = rollback(add(settings));
        expect(rolledBack.monitoredFolders.find(folder => folder.id === 'existing')).toMatchObject({ path: 'D:/existing' });
        expect(rolledBack.monitoredFolders.find(folder => folder.path === candidate().path)).toMatchObject({
            initialScanPending: false,
            initialScanCancelled: false,
            lastScanned: undefined
        });
    });

    it('reports linked-only import failures without monitored-folder rollback', async () => {
        const linked = candidate({ isAlreadyLinked: true });
        const setSettings = vi.fn();
        mocks.discoverA1111Candidates.mockResolvedValue({ candidates: [linked], logs: [], warnings: [] });
        mocks.getUnlinkedPriorityCandidatePaths.mockReturnValue([linked.path]);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<A1111Tab settings={createSettings()} setSettings={setSettings} onScanFolder={vi.fn().mockRejectedValue(new Error('failed'))} />);
        fireEvent.click(screen.getByRole('button', { name: /scan for folders/i }));
        fireEvent.click(await screen.findByRole('button', { name: /link\/sync 1 folders/i }));
        expect(await screen.findByText('Use Check Console for details')).toBeTruthy();
        expect(setSettings).not.toHaveBeenCalled();
    });
});
