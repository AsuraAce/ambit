import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { AppSettings } from '../../../../types';
import { AdvancedTab } from '../AdvancedTab';

const addToastMock = vi.hoisted(() => vi.fn());
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

    it('labels destructive database actions as a danger zone', () => {
        renderAdvanced();

        expect(screen.getByText('Danger Zone')).not.toBeNull();
        expect(screen.getByRole('button', { name: /purge database/i })).not.toBeNull();
    });
});
