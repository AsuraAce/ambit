import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { AppSettings } from '../../../../types';
import { DevTab } from '../DevTab';

const addToastMock = vi.hoisted(() => vi.fn());
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
        fetchData: vi.fn().mockResolvedValue(undefined),
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
        optimizeDatabase: vi.fn().mockResolvedValue({ status: 'ok', data: 'Optimized' }),
    },
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

vi.mock('../../../../services/db/imageRepo', () => ({
    rebuildFacetCache: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../../../utils/dev/dataGenerator', () => ({
    generateStressTestData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../utils/tauriListener', () => ({
    listenWithCleanup: () => ({
        cleanup: vi.fn(),
    }),
}));

describe('DevTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
