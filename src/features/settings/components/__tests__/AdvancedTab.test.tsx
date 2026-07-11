import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { AppSettings } from '../../../../types';
import { AdvancedTab } from '../AdvancedTab';

const addToastMock = vi.hoisted(() => vi.fn());
const getDbDiagnosticsMock = vi.hoisted(() => vi.fn());
const showAppLogFolderMock = vi.hoisted(() => vi.fn());
const clipboardWriteTextMock = vi.hoisted(() => vi.fn());
const libraryContextMock = vi.hoisted(() => ({
    setSettings: vi.fn(),
    cleanLibrary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: addToastMock,
    }),
}));

vi.mock('../../../../hooks/useLibraryContext', () => ({
    useLibraryContext: () => libraryContextMock,
}));

vi.mock('../BackupSettings', () => ({
    BackupSettings: () => <div>Backup settings</div>,
}));

vi.mock('../../../../bindings', () => ({
    commands: {
        getDbDiagnostics: getDbDiagnosticsMock,
        showAppLogFolder: showAppLogFolderMock,
    },
}));

const createSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 200,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    maskedKeywords: [],
    maskingMode: 'blur',
    enableAI: false,
    logLevel: 'info',
    ...overrides,
});

const renderAdvanced = (settings = createSettings(), onClose = vi.fn(), onNavigateToMaintenance = vi.fn()) => {
    const setSettings = vi.fn();
    render(
        <AdvancedTab
            settings={settings}
            setSettings={setSettings}
            canCheckForUpdates={true}
            hasPendingUpdate={false}
            pendingUpdateVersion={null}
            updateErrorMessage={null}
            updateStatus="idle"
            onCheckForUpdates={vi.fn()}
            onOpenUpdatePrompt={vi.fn()}
            onNavigateToMaintenance={onNavigateToMaintenance}
            onClose={onClose}
        />
    );
    return { setSettings, onClose, onNavigateToMaintenance };
};

describe('AdvancedTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: clipboardWriteTextMock,
            },
            configurable: true,
        });
        clipboardWriteTextMock.mockResolvedValue(undefined);
        showAppLogFolderMock.mockResolvedValue({ status: 'ok', data: null });
        getDbDiagnosticsMock.mockResolvedValue({
            status: 'ok',
            data: {
                dbPath: 'C:\\Users\\AmbitTester\\AppData\\Local\\io.github.asuraace.ambit\\images.db',
                activeDbPath: 'C:\\Users\\AmbitTester\\AppData\\Local\\io.github.asuraace.ambit\\images.db',
                localDbPath: 'C:\\Users\\AmbitTester\\AppData\\Local\\io.github.asuraace.ambit\\images.db',
                roamingDbPath: 'C:\\Users\\AmbitTester\\AppData\\Roaming\\io.github.asuraace.ambit\\images.db',
                appLogDir: 'C:\\Users\\AmbitTester\\AppData\\Roaming\\io.github.asuraace.ambit\\logs',
                appLogPath: 'C:\\Users\\AmbitTester\\AppData\\Roaming\\io.github.asuraace.ambit\\logs\\Ambit.log',
                isUsingRoamingFallback: false,
                imageCount: 12,
                deletedCount: 1,
                modelCount: 2,
                cacheCount: 3,
                toolNullCount: 0,
            },
        });
    });

    it('does not expose the removed troubleshooting repair actions', () => {
        renderAdvanced();

        expect(screen.queryByRole('button', { name: /troubleshooting/i })).toBeNull();
        expect(screen.queryByText(/reset sync cursor/i)).toBeNull();
        expect(screen.queryByText(/clear broken thumbnails/i)).toBeNull();
        expect(screen.queryByText(/verify library integrity/i)).toBeNull();
        expect(screen.queryByText(/optimize database/i)).toBeNull();
        expect(screen.queryByText(/rebuild facet cache/i)).toBeNull();
    });

    it('renders support diagnostics with the production-visible log level selector', () => {
        renderAdvanced();

        fireEvent.click(screen.getByRole('button', { name: /support/i }));

        expect(screen.getByText('Support Diagnostics')).not.toBeNull();
        expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('info');
    });

    it('renders the active library database location separately from the install location', async () => {
        renderAdvanced();

        fireEvent.click(screen.getByRole('button', { name: /support/i }));

        expect(screen.getByText('Library Database Location')).not.toBeNull();
        expect(screen.getByText(/separate from the folder where the app itself is installed/i)).not.toBeNull();

        await waitFor(() => {
            expect(screen.getByText('Active catalog')).not.toBeNull();
            expect(screen.getByText('Local AppData target')).not.toBeNull();
            expect(screen.getByText('Legacy Roaming fallback')).not.toBeNull();
            expect(screen.getAllByText(/AppData\\Local\\io\.github\.asuraace\.ambit\\images\.db/)).toHaveLength(2);
        });
    });

    it('renders app log location and reveals only the backend-resolved logs folder', async () => {
        renderAdvanced();

        fireEvent.click(screen.getByRole('button', { name: /support/i }));

        await waitFor(() => {
            expect(screen.getByText('App Logs')).not.toBeNull();
            expect(screen.getByText(/Ambit\.log/)).not.toBeNull();
        });

        fireEvent.click(screen.getByRole('button', { name: /show logs folder/i }));

        await waitFor(() => {
            expect(showAppLogFolderMock).toHaveBeenCalledWith();
            expect(addToastMock).toHaveBeenCalledWith('Opened app logs folder', 'success');
        });
    });

    it('shows a failure toast when the logs folder cannot be revealed', async () => {
        showAppLogFolderMock.mockResolvedValue({ status: 'error', error: 'folder unavailable' });
        renderAdvanced();

        fireEvent.click(screen.getByRole('button', { name: /support/i }));
        fireEvent.click(screen.getByRole('button', { name: /show logs folder/i }));

        await waitFor(() => {
            expect(addToastMock).toHaveBeenCalledWith('Failed to open app logs folder', 'error');
        });
    });

    it('copies support diagnostics without image metadata or secret fields', async () => {
        renderAdvanced(createSettings({ logLevel: 'warn' }));

        fireEvent.click(screen.getByRole('button', { name: /support/i }));

        await waitFor(() => {
            expect(screen.getByText(/Ambit\.log/)).not.toBeNull();
        });

        fireEvent.click(screen.getByRole('button', { name: /copy diagnostics/i }));

        await waitFor(() => {
            expect(clipboardWriteTextMock).toHaveBeenCalledOnce();
            expect(addToastMock).toHaveBeenCalledWith('Diagnostics copied to clipboard', 'success');
        });

        const payload = clipboardWriteTextMock.mock.calls[0][0] as string;
        expect(payload).toContain('Ambit Support Diagnostics');
        expect(payload).toContain('Console log level: warn');
        expect(payload).toContain('App log file: C:\\Users\\AmbitTester\\AppData\\Roaming\\io.github.asuraace.ambit\\logs\\Ambit.log');
        expect(payload).toContain('Images: 12');
        expect(payload).not.toMatch(/prompt|metadata_json|api[_-]?key|secret/i);
    });

    it('warns when debug logging is selected', () => {
        renderAdvanced(createSettings({ logLevel: 'debug' }));

        fireEvent.click(screen.getByRole('button', { name: /support/i }));

        expect(screen.getByText(/debug logging can be noisy/i)).not.toBeNull();
    });

    it('opens Maintenance from support diagnostics and closes settings', () => {
        const onClose = vi.fn();
        const onNavigateToMaintenance = vi.fn();
        renderAdvanced(createSettings(), onClose, onNavigateToMaintenance);

        fireEvent.click(screen.getByRole('button', { name: /support/i }));
        fireEvent.click(screen.getByRole('button', { name: /open maintenance/i }));

        expect(onNavigateToMaintenance).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalled();
    });

    it('restarts onboarding immediately without changing unrelated settings', () => {
        const settings = createSettings({ hideImportModal: true });
        const onClose = vi.fn();
        renderAdvanced(settings, onClose);

        fireEvent.click(screen.getByRole('button', { name: 'interface' }));
        fireEvent.click(screen.getByRole('button', { name: 'Restart onboarding' }));

        expect(libraryContextMock.setSettings).toHaveBeenCalledOnce();
        const update = libraryContextMock.setSettings.mock.calls[0][0] as (current: AppSettings) => AppSettings;
        expect(update(settings)).toEqual({
            ...settings,
            hasCompletedOnboarding: false,
            hideImportModal: false,
        });
        expect(onClose).toHaveBeenCalledOnce();
        expect(addToastMock).toHaveBeenCalledWith('Onboarding restarted.', 'info');
    });

    it('labels destructive database actions as a danger zone', () => {
        renderAdvanced();

        expect(screen.getByText('Danger Zone')).not.toBeNull();
        expect(screen.getByRole('button', { name: /purge database/i })).not.toBeNull();
    });
});
