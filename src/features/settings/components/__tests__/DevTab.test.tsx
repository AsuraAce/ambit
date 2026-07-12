import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { AppSettings } from '../../../../types';
import { DevTab } from '../DevTab';

const addToastMock = vi.hoisted(() => vi.fn());
const fetchDataMock = vi.hoisted(() => vi.fn());
const optimizeDatabaseMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());
const rebuildFacetCacheMock = vi.hoisted(() => vi.fn());
const generateStressTestDataMock = vi.hoisted(() => vi.fn());
const listenerCleanupMock = vi.hoisted(() => vi.fn());
const listenWithCleanupMock = vi.hoisted(() => vi.fn());
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
    devMode: true,
    ...overrides,
});
const settingsStoreMock = vi.hoisted(() => ({
    settings: {
        hasCompletedOnboarding: true,
        theme: 'dark',
        thumbnailSize: 200,
        confirmDelete: true,
        defaultTheaterMode: false,
        monitoredFolders: [],
        maskedKeywords: [],
        maskingMode: 'blur',
        enableAI: false,
        devMode: true,
    } as AppSettings,
    setSettings: vi.fn(),
}));

vi.mock('../../../../hooks/useLibraryContext', () => ({
    useLibraryContext: () => ({
        fetchData: fetchDataMock,
    }),
}));

vi.mock('../../../../stores/settingsStore', () => ({
    useSettingsStore: () => settingsStoreMock,
}));

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: addToastMock,
    }),
}));

vi.mock('../../../../bindings', () => ({
    commands: {
        optimizeDatabase: optimizeDatabaseMock,
    },
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: invokeMock,
}));

vi.mock('../../../../services/db/imageRepo', () => ({
    rebuildFacetCache: rebuildFacetCacheMock,
}));

vi.mock('../../../../utils/dev/dataGenerator', () => ({
    generateStressTestData: generateStressTestDataMock,
}));

vi.mock('../../../../utils/tauriListener', () => ({
    listenWithCleanup: listenWithCleanupMock,
}));

describe('DevTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchDataMock.mockResolvedValue(undefined);
        optimizeDatabaseMock.mockResolvedValue({ status: 'ok', data: 'Optimized' });
        invokeMock.mockResolvedValue({ total: 4, with_raw: 3, with_pv: 2, v0: 1, v1: 2 });
        rebuildFacetCacheMock.mockResolvedValue(0);
        generateStressTestDataMock.mockResolvedValue(undefined);
        listenWithCleanupMock.mockReturnValue({ cleanup: listenerCleanupMock });
        settingsStoreMock.settings = createSettings();
        settingsStoreMock.setSettings.mockImplementation((updater: React.SetStateAction<AppSettings>) => {
            settingsStoreMock.settings = typeof updater === 'function'
                ? updater(settingsStoreMock.settings)
                : updater;
        });
    });

    it('shows only the Developer Mode control when dev mode is off', () => {
        settingsStoreMock.settings = createSettings({ devMode: false });

        render(<DevTab />);

        expect(screen.getByText('Developer Mode')).not.toBeNull();
        expect(screen.getByText(/developer tools are off/i)).not.toBeNull();
        expect(screen.queryByRole('button', { name: /tools/i })).toBeNull();
        expect(screen.queryByText('System Prompt Overrides')).toBeNull();
        expect(screen.queryByText('Optimize Database')).toBeNull();
    });

    it('renders database internals after Developer Mode is enabled', () => {
        render(<DevTab />);

        fireEvent.click(screen.getByRole('button', { name: /tools/i }));

        expect(screen.getByText('Optimize Database')).not.toBeNull();
        expect(screen.getByText('Rebuild Facet Cache')).not.toBeNull();
    });

    it('toggles developer mode through the settings store', () => {
        settingsStoreMock.settings = createSettings({ devMode: false });
        render(<DevTab />);

        fireEvent.click(screen.getByText('Developer Mode').parentElement!.parentElement!);

        expect(settingsStoreMock.settings.devMode).toBe(true);
        expect(settingsStoreMock.setSettings).toHaveBeenCalledOnce();
    });

    it('edits, cancels, and saves a default prompt override', () => {
        render(<DevTab />);
        fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);

        const textarea = screen.getByRole('textbox');
        expect((textarea as HTMLTextAreaElement).value).toContain('expert AI Image Generation Prompt Engineer');
        fireEvent.change(textarea, { target: { value: 'custom analysis prompt' } });
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(screen.queryByRole('textbox')).toBeNull();

        fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'saved prompt' } });
        fireEvent.click(screen.getByRole('button', { name: /save override/i }));

        expect(settingsStoreMock.settings.systemPrompts?.ANALYSIS).toBe('saved prompt');
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('edits an existing override and resets it to the default', () => {
        settingsStoreMock.settings = createSettings({ systemPrompts: { ANALYSIS: 'override' } });
        render(<DevTab />);

        fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
        expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('override');
        fireEvent.click(screen.getByTitle('Reset to Default'));

        expect(settingsStoreMock.settings.systemPrompts?.ANALYSIS).toBeUndefined();
        expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('expert AI Image Generation Prompt Engineer');
    });

    it('resets an override without opening its editor', () => {
        settingsStoreMock.settings = createSettings({ systemPrompts: { ANALYSIS: 'override' } });
        render(<DevTab />);

        fireEvent.click(screen.getByTitle('Reset to Default'));

        expect(settingsStoreMock.settings.systemPrompts?.ANALYSIS).toBeUndefined();
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('resets safely when prompt overrides disappear before the click is handled', () => {
        settingsStoreMock.settings = createSettings({ systemPrompts: { ANALYSIS: 'override' } });
        render(<DevTab />);
        settingsStoreMock.settings.systemPrompts = undefined;

        fireEvent.click(screen.getByTitle('Reset to Default'));

        expect(settingsStoreMock.settings.systemPrompts).toEqual({});
    });

    it('optimizes the database and reports backend result failures', async () => {
        const view = render(<DevTab />);
        fireEvent.click(screen.getByRole('button', { name: /tools/i }));
        fireEvent.click(screen.getByRole('button', { name: /optimize now/i }));
        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('Optimized', 'success'));

        view.unmount();
        optimizeDatabaseMock.mockResolvedValueOnce({ status: 'error', error: 'vacuum failed' });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<DevTab />);
        fireEvent.click(screen.getByRole('button', { name: /tools/i }));
        fireEvent.click(screen.getByRole('button', { name: /optimize now/i }));
        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('Failed to optimize database', 'error'));
        expect(consoleError).toHaveBeenCalledWith('vacuum failed');
        consoleError.mockRestore();
    });

    it('reports transport errors while optimizing', async () => {
        optimizeDatabaseMock.mockRejectedValueOnce(new Error('offline'));
        render(<DevTab />);
        fireEvent.click(screen.getByRole('button', { name: /tools/i }));
        fireEvent.click(screen.getByRole('button', { name: /optimize now/i }));
        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('Error communicating with backend', 'error'));
    });

    it('rebuilds the facet cache and reports failures', async () => {
        const view = render(<DevTab />);
        fireEvent.click(screen.getByRole('button', { name: /tools/i }));
        fireEvent.click(screen.getByRole('button', { name: /rebuild cache/i }));
        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('Facet cache rebuilt successfully', 'success'));

        view.unmount();
        const error = new Error('cache failed');
        rebuildFacetCacheMock.mockRejectedValueOnce(error);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<DevTab />);
        fireEvent.click(screen.getByRole('button', { name: /tools/i }));
        fireEvent.click(screen.getByRole('button', { name: /rebuild cache/i }));
        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('Failed to rebuild facet cache', 'error'));
        expect(consoleError).toHaveBeenCalledWith(error);
        consoleError.mockRestore();
    });

    it('copies metadata diagnostics to the clipboard', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        render(<DevTab />);
        fireEvent.click(screen.getByRole('button', { name: /tools/i }));
        fireEvent.click(screen.getByRole('button', { name: /run check/i }));

        const message = 'Total: 4, With Raw: 3, V0: 1, V1: 2';
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(message));
        expect(addToastMock).toHaveBeenCalledWith(message, 'info');
        expect(addToastMock).toHaveBeenCalledWith('Stats copied to clipboard', 'success');
    });

    it.each([
        [new Error('diagnostics failed'), 'Error: diagnostics failed'],
        ['backend unavailable', 'Error: backend unavailable'],
    ])('reports metadata diagnostics failures', async (error, expected) => {
        invokeMock.mockRejectedValueOnce(error);
        render(<DevTab />);
        fireEvent.click(screen.getByRole('button', { name: /tools/i }));
        fireEvent.click(screen.getByRole('button', { name: /run check/i }));
        await waitFor(() => expect(addToastMock).toHaveBeenCalledWith(expected, 'error'));
    });

    it('generates the selected stress-test size and refreshes the library', async () => {
        generateStressTestDataMock.mockImplementationOnce(async (_count: number, onProgress: (current: number, total: number) => void) => {
            onProgress(5000, 5000);
        });
        render(<DevTab />);
        fireEvent.click(screen.getByRole('button', { name: /tools/i }));
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '5000' } });
        fireEvent.click(screen.getByRole('button', { name: /start stress test/i }));

        await waitFor(() => expect(generateStressTestDataMock).toHaveBeenCalledWith(5000, expect.any(Function)));
        await waitFor(() => expect(fetchDataMock).toHaveBeenCalledWith(false));
        expect(screen.getByRole('button', { name: /start stress test/i })).not.toBeNull();
    });

    it('forwards reset progress and cleans up the listener', () => {
        const view = render(<DevTab />);
        const listener = listenWithCleanupMock.mock.calls[0][1] as (event: { payload: string }) => void;
        listener({ payload: 'Resetting database' });
        expect(addToastMock).toHaveBeenCalledWith('Resetting database', 'info');

        view.unmount();
        expect(listenerCleanupMock).toHaveBeenCalledOnce();
    });
});
