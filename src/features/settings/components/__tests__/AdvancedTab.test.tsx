import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { AppSettings } from '../../../../types';
import { AdvancedTab } from '../AdvancedTab';

const addToastMock = vi.hoisted(() => vi.fn());
const getDbDiagnosticsMock = vi.hoisted(() => vi.fn());
const setBackgroundHealingPausedMock = vi.hoisted(() => vi.fn());
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

vi.mock('../../../../stores/libraryStore', () => ({
    useLibraryStore: {
        getState: () => ({ setBackgroundHealingPaused: setBackgroundHealingPausedMock }),
    },
}));

vi.mock('../BackupSettings', () => ({
    BackupSettings: () => <div>Backup settings</div>,
}));

vi.mock('../../../../bindings', () => ({
    commands: {
        getDbDiagnostics: getDbDiagnosticsMock,
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

type AdvancedOverrides = Partial<React.ComponentProps<typeof AdvancedTab>>;

const renderAdvanced = (settings = createSettings(), overrides: AdvancedOverrides = {}) => {
    const setSettings = vi.fn();
    const props: React.ComponentProps<typeof AdvancedTab> = {
        settings,
        setSettings,
        canCheckForUpdates: true,
        hasPendingUpdate: false,
        pendingUpdateVersion: null,
        updateErrorMessage: null,
        updateStatus: 'idle',
        onCheckForUpdates: vi.fn().mockResolvedValue(undefined),
        onOpenUpdatePrompt: vi.fn(),
        onNavigateToMaintenance: vi.fn(),
        onClose: vi.fn(),
        ...overrides,
    };
    const renderResult = render(
        <AdvancedTab {...props} />
    );
    return { setSettings, props, ...renderResult };
};

describe('AdvancedTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getDbDiagnosticsMock.mockResolvedValue({
            status: 'ok',
            data: {
                dbPath: 'C:\\Users\\AmbitTester\\AppData\\Local\\io.github.asuraace.ambit\\images.db',
                activeDbPath: 'C:\\Users\\AmbitTester\\AppData\\Local\\io.github.asuraace.ambit\\images.db',
                localDbPath: 'C:\\Users\\AmbitTester\\AppData\\Local\\io.github.asuraace.ambit\\images.db',
                roamingDbPath: 'C:\\Users\\AmbitTester\\AppData\\Roaming\\io.github.asuraace.ambit\\images.db',
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

    it('warns when debug logging is selected', () => {
        renderAdvanced(createSettings({ logLevel: 'debug' }));

        fireEvent.click(screen.getByRole('button', { name: /support/i }));

        expect(screen.getByText(/debug logging can be noisy/i)).not.toBeNull();
    });

    it('opens Maintenance from support diagnostics and closes settings', () => {
        const onClose = vi.fn();
        const onNavigateToMaintenance = vi.fn();
        renderAdvanced(createSettings(), { onClose, onNavigateToMaintenance });

        fireEvent.click(screen.getByRole('button', { name: /support/i }));
        fireEvent.click(screen.getByRole('button', { name: /open maintenance/i }));

        expect(onNavigateToMaintenance).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalled();
    });

    it('labels destructive database actions as a danger zone', () => {
        renderAdvanced();

        expect(screen.getByText('Danger Zone')).not.toBeNull();
        expect(screen.getByRole('button', { name: /purge database/i })).not.toBeNull();
    });

    it('purges the library while background healing is paused', async () => {
        renderAdvanced();

        fireEvent.click(screen.getByRole('button', { name: /purge database/i }));
        fireEvent.click(screen.getByRole('button', { name: /purge & reset/i }));

        await waitFor(() => expect(libraryContextMock.cleanLibrary).toHaveBeenCalledOnce());
        expect(setBackgroundHealingPausedMock.mock.calls).toEqual([[true], [false]]);
        expect(addToastMock).toHaveBeenCalledWith(
            'Purge scheduled. Please restart application manually.',
            'success',
        );
    });

    it('restores background healing and reports a failed purge', async () => {
        const error = new Error('locked');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        libraryContextMock.cleanLibrary.mockRejectedValueOnce(error);
        renderAdvanced();

        fireEvent.click(screen.getByRole('button', { name: /purge database/i }));
        fireEvent.click(screen.getByRole('button', { name: /purge & reset/i }));

        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('Failed to purge database', 'error'));
        expect(setBackgroundHealingPausedMock.mock.calls).toEqual([[true], [false]]);
        expect(consoleError).toHaveBeenCalledWith('[Purge] Failed:', error);
        consoleError.mockRestore();
    });

    it('cancels a pending purge without cleaning the library', () => {
        renderAdvanced();

        fireEvent.click(screen.getByRole('button', { name: /purge database/i }));
        fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

        expect(libraryContextMock.cleanLibrary).not.toHaveBeenCalled();
    });

    it('toggles automatic updates and starts a manual update check', () => {
        const onCheckForUpdates = vi.fn().mockResolvedValue(undefined);
        const { setSettings } = renderAdvanced(createSettings(), { onCheckForUpdates });

        fireEvent.click(screen.getByRole('button', { name: /interface/i }));
        const buttons = screen.getAllByRole('button');
        const toggle = buttons.find((button) => button.className.includes('w-12'));
        expect(toggle).toBeDefined();
        fireEvent.click(toggle!);
        const updater = setSettings.mock.calls[0][0] as (settings: AppSettings) => AppSettings;
        expect(updater(createSettings()).autoCheckForUpdates).toBe(false);
        expect(addToastMock).toHaveBeenCalledWith('Automatic update checks disabled', 'success');

        fireEvent.click(screen.getByRole('button', { name: /check for updates/i }));
        expect(onCheckForUpdates).toHaveBeenCalledOnce();
    });

    it('enables automatic updates when they were explicitly disabled', () => {
        const { setSettings } = renderAdvanced(createSettings({ autoCheckForUpdates: false }));

        fireEvent.click(screen.getByRole('button', { name: /interface/i }));
        const toggle = screen.getAllByRole('button').find((button) => button.className.includes('w-12'));
        fireEvent.click(toggle!);

        const updater = setSettings.mock.calls[0][0] as (settings: AppSettings) => AppSettings;
        expect(updater(createSettings({ autoCheckForUpdates: false })).autoCheckForUpdates).toBe(true);
        expect(addToastMock).toHaveBeenCalledWith('Automatic update checks enabled', 'success');
    });

    it('opens the pending update prompt instead of checking again', () => {
        const onOpenUpdatePrompt = vi.fn();
        const onCheckForUpdates = vi.fn().mockResolvedValue(undefined);
        renderAdvanced(createSettings(), {
            hasPendingUpdate: true,
            pendingUpdateVersion: '2.4.0',
            updateStatus: 'available',
            onOpenUpdatePrompt,
            onCheckForUpdates,
        });

        fireEvent.click(screen.getByRole('button', { name: /interface/i }));
        expect(screen.getByText('Version 2.4.0 is ready to install.')).not.toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /view update/i }));

        expect(onOpenUpdatePrompt).toHaveBeenCalledOnce();
        expect(onCheckForUpdates).not.toHaveBeenCalled();
    });

    it.each([
        ['available', null, null, 'A new version is ready to install.'],
        ['downloading', null, null, 'Downloading the selected update package.'],
        ['installing', null, null, 'Installing update. Ambit may restart or close to finish.'],
        ['checking', null, null, 'Checking GitHub Releases for a newer build.'],
        ['error', null, 'release server unavailable', 'release server unavailable'],
        ['error', null, null, 'Automatically checks GitHub Releases once each time Ambit starts.'],
    ] as const)('renders the %s updater status', (updateStatus, pendingUpdateVersion, updateErrorMessage, label) => {
        renderAdvanced(createSettings(), { updateStatus, pendingUpdateVersion, updateErrorMessage });
        fireEvent.click(screen.getByRole('button', { name: /interface/i }));
        expect(screen.getByText(label)).not.toBeNull();
    });

    it('disables update checks in development and explains why', () => {
        renderAdvanced(createSettings(), { canCheckForUpdates: false });
        fireEvent.click(screen.getByRole('button', { name: /interface/i }));

        expect(screen.getByText('Update checks are disabled while running in development.')).not.toBeNull();
        expect((screen.getByRole('button', { name: /check for updates/i }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('resets onboarding through the library context', () => {
        renderAdvanced();
        fireEvent.click(screen.getByRole('button', { name: /interface/i }));
        fireEvent.click(screen.getByRole('button', { name: /reset wizard/i }));

        const updater = libraryContextMock.setSettings.mock.calls[0][0] as (settings: AppSettings) => AppSettings;
        expect(updater(createSettings())).toMatchObject({
            hasCompletedOnboarding: false,
            hideImportModal: false,
        });
        expect(addToastMock).toHaveBeenCalledWith('Onboarding reset. Reload to see wizard.', 'info');
    });

    it('changes valid log levels and ignores invalid values', () => {
        const { setSettings } = renderAdvanced();
        fireEvent.click(screen.getByRole('button', { name: /support/i }));
        const select = screen.getByRole('combobox');

        fireEvent.change(select, { target: { value: 'warn' } });
        const updater = setSettings.mock.calls[0][0] as (settings: AppSettings) => AppSettings;
        expect(updater(createSettings()).logLevel).toBe('warn');
        expect(addToastMock).toHaveBeenCalledWith('Console log level set to WARN', 'success');

        fireEvent.change(select, { target: { value: 'invalid' } });
        expect(setSettings).toHaveBeenCalledTimes(1);
    });

    it('defaults a missing log level to info', () => {
        renderAdvanced(createSettings({ logLevel: undefined }));
        fireEvent.click(screen.getByRole('button', { name: /support/i }));
        expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('info');
    });

    it('renders diagnostics errors from Error and non-Error rejections', async () => {
        getDbDiagnosticsMock.mockRejectedValueOnce(new Error('database unavailable'));
        const first = renderAdvanced();
        fireEvent.click(screen.getByRole('button', { name: /support/i }));
        await screen.findByText(/could not load database location: database unavailable/i);

        first.unmount();
    });

    it('renders a string diagnostics error', async () => {
        getDbDiagnosticsMock.mockRejectedValueOnce('offline');
        renderAdvanced();
        fireEvent.click(screen.getByRole('button', { name: /support/i }));
        await screen.findByText(/could not load database location: offline/i);
    });

    it('shows roaming fallback diagnostics and falls back to the legacy db path', async () => {
        getDbDiagnosticsMock.mockResolvedValueOnce({
            status: 'ok',
            data: {
                dbPath: 'C:\\legacy\\images.db',
                activeDbPath: '',
                localDbPath: 'C:\\local\\images.db',
                roamingDbPath: 'C:\\legacy\\images.db',
                isUsingRoamingFallback: true,
                imageCount: 0,
                deletedCount: 0,
                modelCount: 0,
                cacheCount: 0,
                toolNullCount: 0,
            },
        });
        renderAdvanced();
        fireEvent.click(screen.getByRole('button', { name: /support/i }));

        await screen.findByText(/using the legacy roaming appdata database/i);
        expect(screen.getAllByText('C:\\legacy\\images.db')).toHaveLength(2);
    });

    it('ignores diagnostics that resolve after the tab unmounts', async () => {
        let resolveDiagnostics!: (value: Awaited<ReturnType<typeof getDbDiagnosticsMock>>) => void;
        getDbDiagnosticsMock.mockReturnValueOnce(new Promise((resolve) => {
            resolveDiagnostics = resolve;
        }));
        const view = renderAdvanced();
        fireEvent.click(screen.getByRole('button', { name: /support/i }));
        view.unmount();

        await act(async () => {
            resolveDiagnostics({ status: 'ok', data: { dbPath: 'late' } });
            await Promise.resolve();
        });
    });

    it('ignores diagnostics errors raised after the tab unmounts', async () => {
        let rejectDiagnostics!: (reason: unknown) => void;
        getDbDiagnosticsMock.mockReturnValueOnce(new Promise((_resolve, reject) => {
            rejectDiagnostics = reject;
        }));
        const view = renderAdvanced();
        fireEvent.click(screen.getByRole('button', { name: /support/i }));
        view.unmount();

        await act(async () => {
            rejectDiagnostics(new Error('late failure'));
            await Promise.resolve();
        });
    });
});
