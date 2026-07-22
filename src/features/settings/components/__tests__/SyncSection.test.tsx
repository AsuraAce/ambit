import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { AppSettings } from '../../../../types';
import { SyncSection } from '../SyncSection';

const mocks = vi.hoisted(() => ({
    startInvokeSync: vi.fn(),
    cancelSync: vi.fn(),
    addToast: vi.fn(),
    syncStatus: 'idle' as 'idle' | 'syncing' | 'complete' | 'error',
    isLiveSyncing: false
}));

vi.mock('../../../../contexts/LibraryContext', () => ({
    useLibrary: () => ({
        syncState: {
            status: mocks.syncStatus,
            progress: { current: 0, total: 0 }
        },
        startInvokeSync: mocks.startInvokeSync,
        cancelSync: mocks.cancelSync,
        isLiveSyncing: mocks.isLiveSyncing
    })
}));

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: mocks.addToast
    })
}));

const createSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 220,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    promptMaskingEnabled: true,
    maskedKeywords: [],
    maskingMode: 'blur',
    enableAI: false,
    invokeAiPath: 'D:/Invoke',
    lastSyncedAt: 123456,
    importIntermediates: false,
    importOrphans: true,
    starredAs: 'favorite',
    syncBoardsToCollections: true
    , ...overrides
});

const SyncSectionHarness: React.FC<{ initialSettings: AppSettings }> = ({ initialSettings }) => {
    const [settings, setSettings] = React.useState(initialSettings);
    return <SyncSection settings={settings} setSettings={setSettings} />;
};

describe('SyncSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.syncStatus = 'idle';
        mocks.isLiveSyncing = false;
    });

    it('starts manual sync from the saved cursor so stale repair does not force a full resync', () => {
        render(<SyncSection settings={createSettings()} setSettings={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /initiate sync/i }));

        expect(mocks.startInvokeSync).toHaveBeenCalledWith(expect.objectContaining({
            afterTimestamp: 123456
        }));
    });

    it('treats orphan recovery as opt-in when the setting is missing', () => {
        const settings = createSettings();
        delete settings.importOrphans;

        render(<SyncSection settings={settings} setSettings={vi.fn()} />);

        expect((screen.getByLabelText(/orphan recovery/i) as HTMLInputElement).checked).toBe(false);
        expect(screen.queryByText(/manual full output-folder recovery sweep/i)).not.toBeNull();
    });

    it('checks orphan recovery only when explicitly enabled', () => {
        render(<SyncSection settings={{ ...createSettings(), importOrphans: true }} setSettings={vi.fn()} />);

        expect((screen.getByLabelText(/orphan recovery/i) as HTMLInputElement).checked).toBe(true);
    });

    it('persists Invoke sync choices and passes them to manual sync', () => {
        render(<SyncSectionHarness initialSettings={createSettings()} />);

        fireEvent.click(screen.getByLabelText(/sync favorites/i));
        fireEvent.click(screen.getByLabelText(/sync boards/i));
        fireEvent.click(screen.getByRole('button', { name: /initiate sync/i }));

        expect((screen.getByLabelText(/sync favorites/i) as HTMLInputElement).checked).toBe(false);
        expect((screen.getByLabelText(/sync boards/i) as HTMLInputElement).checked).toBe(false);
        expect(mocks.startInvokeSync).toHaveBeenCalledWith(expect.objectContaining({
            syncFavorites: false,
            syncBoards: false,
            afterTimestamp: 123456
        }));
    });

    it('keeps every switch focusable and exposes a visible keyboard focus ring on its track', () => {
        render(<SyncSectionHarness initialSettings={createSettings()} />);

        const switches = screen.getAllByRole('switch');
        expect(switches).toHaveLength(5);

        switches.forEach((switchInput) => {
            const track = switchInput.nextElementSibling;
            expect(switchInput.className.split(/\s+/)).toContain('peer');
            expect(switchInput.className.split(/\s+/)).toContain('sr-only');
            expect(track?.className.split(/\s+/)).toContain('peer-focus-visible:ring-2');
            expect(track?.className.split(/\s+/)).toContain('peer-focus-visible:ring-sage-500/50');
        });

        const importIntermediates = screen.getByRole('switch', { name: 'Import Intermediates' });
        importIntermediates.focus();
        expect(document.activeElement).toBe(importIntermediates);
        fireEvent.click(importIntermediates);
        expect((importIntermediates as HTMLInputElement).checked).toBe(true);
    });

    it('confirms a full resync before clearing only the saved cursor', () => {
        render(<SyncSectionHarness initialSettings={createSettings()} />);

        expect(screen.getByText('Sync Recovery')).not.toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /force full resync/i }));

        expect(mocks.startInvokeSync).not.toHaveBeenCalled();
        const resyncButtons = screen.getAllByRole('button', { name: /force full resync/i });
        fireEvent.click(resyncButtons[resyncButtons.length - 1]);
        fireEvent.click(screen.getByRole('button', { name: /initiate sync/i }));

        expect(mocks.startInvokeSync).toHaveBeenCalledWith(expect.objectContaining({
            afterTimestamp: null
        }));
    });

    it.each([
        { label: 'manual', syncStatus: 'syncing' as const, isLiveSyncing: false },
        { label: 'live', syncStatus: 'idle' as const, isLiveSyncing: true }
    ])('disables full resync during an active $label sync', ({ syncStatus, isLiveSyncing }) => {
        mocks.syncStatus = syncStatus;
        mocks.isLiveSyncing = isLiveSyncing;

        render(<SyncSection settings={createSettings()} setSettings={vi.fn()} />);

        const button = screen.getByRole('button', { name: /force full resync/i });
        expect((button as HTMLButtonElement).disabled).toBe(true);
        expect(button.getAttribute('title')).toBe('Wait for the current InvokeAI sync to finish');
    });

    it('preserves the cursor when a sync starts after the confirmation opens', async () => {
        const setSettings = vi.fn();
        const settings = createSettings();
        const { rerender } = render(<SyncSection settings={settings} setSettings={setSettings} />);

        fireEvent.click(screen.getByRole('button', { name: /force full resync/i }));
        mocks.isLiveSyncing = true;
        rerender(<SyncSection settings={{ ...settings }} setSettings={setSettings} />);

        const resyncButtons = screen.getAllByRole('button', { name: /force full resync/i });
        fireEvent.click(resyncButtons[resyncButtons.length - 1]);

        expect(setSettings).not.toHaveBeenCalled();
        expect(mocks.addToast).toHaveBeenCalledWith(
            'Wait for the current InvokeAI sync to finish before forcing a full resync.',
            'warning'
        );
        await waitFor(() => {
            expect(screen.queryByText('Force Full InvokeAI Resync?')).toBeNull();
        });
    });

    it('renders nothing without an InvokeAI path', () => {
        const { container } = render(<SyncSection settings={createSettings({ invokeAiPath: undefined })} setSettings={vi.fn()} />);
        expect(container.firstChild).toBeNull();
    });

    it('updates starred mapping and ignores invalid select values', () => {
        const { unmount } = render(<SyncSectionHarness initialSettings={createSettings({ starredAs: undefined })} />);
        const select = screen.getByRole('combobox');
        expect((select as HTMLSelectElement).value).toBe('favorite');
        for (const value of ['pin', 'both', 'none', 'favorite']) {
            fireEvent.change(select, { target: { value } });
            expect(mocks.addToast).toHaveBeenCalledWith(`Starred images mapped to ${value}`, 'success');
        }
        unmount();

        const setSettings = vi.fn();
        render(<SyncSection settings={createSettings()} setSettings={setSettings} />);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'invalid' } });
        expect(setSettings).not.toHaveBeenCalled();
    });

    it('updates every board and import toggle in both directions', () => {
        const initial = createSettings({
            invokeSyncFavorites: false,
            invokeSyncBoards: false,
            syncBoardsToCollections: false,
            importIntermediates: false,
            importOrphans: false
        });
        const { rerender } = render(<SyncSectionHarness initialSettings={initial} />);
        fireEvent.click(screen.getByLabelText('Sync Favorites'));
        fireEvent.click(screen.getByLabelText('Sync Boards'));
        fireEvent.click(screen.getByLabelText('Persistent Collections'));
        fireEvent.click(screen.getByLabelText(/import intermediates/i));
        fireEvent.click(screen.getByLabelText(/orphan recovery/i));
        expect(mocks.addToast).toHaveBeenCalledWith('Invoke favorites will sync', 'success');
        expect(mocks.addToast).toHaveBeenCalledWith('Invoke boards will sync', 'success');
        expect(mocks.addToast).toHaveBeenCalledWith('Boards will sync to collections', 'success');
        expect(mocks.addToast).toHaveBeenCalledWith('Intermediates import enabled', 'success');
        expect(mocks.addToast).toHaveBeenCalledWith('Orphan recovery enabled', 'success');

        rerender(<SyncSectionHarness initialSettings={createSettings()} />);
        fireEvent.click(screen.getByLabelText('Sync Favorites'));
        fireEvent.click(screen.getByLabelText('Persistent Collections'));
        fireEvent.click(screen.getByLabelText('Sync Boards'));
        fireEvent.click(screen.getByLabelText(/import intermediates/i));
        fireEvent.click(screen.getByLabelText(/orphan recovery/i));
        expect(mocks.addToast).toHaveBeenCalledWith('Invoke favorites sync disabled', 'success');
        expect(mocks.addToast).toHaveBeenCalledWith('Invoke boards sync disabled', 'success');
        expect(mocks.addToast).toHaveBeenCalledWith('Board sync disabled', 'success');
        expect(mocks.addToast).toHaveBeenCalledWith('Intermediates import disabled', 'success');
        expect(mocks.addToast).toHaveBeenCalledWith('Orphan recovery disabled', 'success');
    });

    it.each(['idle', 'complete', 'error'] as const)('starts sync from %s status with full configured payload', (syncStatus) => {
        mocks.syncStatus = syncStatus;
        render(<SyncSection settings={createSettings({ starredAs: 'both', invokeSyncFavorites: undefined, invokeSyncBoards: undefined })} setSettings={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: syncStatus === 'error' ? /retry sync/i : /initiate sync/i }));
        expect(mocks.startInvokeSync).toHaveBeenCalledWith({
            syncFavorites: true,
            syncBoards: true,
            importIntermediates: false,
            afterTimestamp: 123456,
            starredAs: 'both',
            importOrphans: true
        });
        expect(mocks.addToast).toHaveBeenCalledWith('Synchronization started...', 'success');
    });

    it('terminates active synchronization and cancels full-resync confirmation', async () => {
        const { rerender } = render(<SyncSection settings={createSettings()} setSettings={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /force full resync/i }));
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        await waitFor(() => expect(screen.queryByText('Force Full InvokeAI Resync?')).toBeNull());

        mocks.syncStatus = 'syncing';
        rerender(<SyncSection settings={createSettings()} setSettings={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /terminate sync/i }));
        expect(mocks.cancelSync).toHaveBeenCalledTimes(1);
    });
});
