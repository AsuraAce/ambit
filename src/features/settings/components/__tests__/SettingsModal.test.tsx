import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import type { AppSettings, AppSettingsUpdate } from '../../../../types';
import { SettingsModal } from '../SettingsModal';

vi.mock('../../../../hooks/useAppVersion', () => ({
    useAppVersion: () => 'test'
}));

vi.mock('../DevTab', () => ({
    DevTab: () => <div>Dev panel</div>
}));

vi.mock('..', () => ({
    GeneralTab: ({ setSettings }: { setSettings: React.Dispatch<React.SetStateAction<AppSettings>> }) => (
        <div>
            <button
                type="button"
                onClick={() =>
                    setSettings(prev => ({
                        ...prev,
                        monitoredFolders: [
                            ...prev.monitoredFolders,
                            {
                                id: 'folder-1',
                                path: 'D:/AmbitFixtures/Linked',
                                isActive: true,
                                imageCount: 0,
                                initialScanPending: true
                            }
                        ]
                    }))
                }
            >
                Add folder update
            </button>
            <button
                type="button"
                onClick={() =>
                    setSettings(prev => ({
                        ...prev,
                        monitoredFolders: prev.monitoredFolders.map(folder =>
                            folder.id === 'folder-1'
                                ? { ...folder, initialScanPending: false, lastScanned: 123 }
                                : folder
                        )
                    }))
                }
            >
                Complete folder update
            </button>
            <button type="button" onClick={() => setSettings({ ...createSettings(), theme: 'light' })}>
                Direct settings update
            </button>
        </div>
    ),
    PrivacyTab: () => null,
    IntelligenceTab: () => <div>Intelligence panel</div>,
    AdvancedTab: () => <div>Advanced panel</div>,
    ConnectionsTab: ({ initialSubTab }: { initialSubTab?: string }) => (
        <div>Connections panel {initialSubTab ?? 'none'}</div>
    )
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
    enableAI: false
});

describe('SettingsModal', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('forwards functional settings updates so async follow-up updates use latest settings', () => {
        const onSave = vi.fn<(update: AppSettingsUpdate) => void>();
        const initialSettings = createSettings();

        render(
            <SettingsModal
                isOpen={true}
                onClose={vi.fn()}
                settings={initialSettings}
                onSave={onSave}
                canCheckForUpdates={false}
                hasPendingUpdate={false}
                pendingUpdateVersion={null}
                updateErrorMessage={null}
                updateStatus="idle"
                onCheckForUpdates={vi.fn()}
                onOpenUpdatePrompt={vi.fn()}
                onNavigateToMaintenance={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Add folder update' }));
        fireEvent.click(screen.getByRole('button', { name: 'Complete folder update' }));

        expect(onSave).toHaveBeenCalledTimes(2);
        expect(typeof onSave.mock.calls[0][0]).toBe('function');
        expect(typeof onSave.mock.calls[1][0]).toBe('function');

        const addUpdate = onSave.mock.calls[0][0] as (previous: AppSettings) => Partial<AppSettings>;
        const completeUpdate = onSave.mock.calls[1][0] as (previous: AppSettings) => Partial<AppSettings>;
        const afterAdd = { ...initialSettings, ...addUpdate(initialSettings) };
        const afterComplete = { ...afterAdd, ...completeUpdate(afterAdd) };

        expect(afterComplete.monitoredFolders).toHaveLength(1);
        expect(afterComplete.monitoredFolders[0]).toMatchObject({
            id: 'folder-1',
            path: 'D:/AmbitFixtures/Linked',
            initialScanPending: false,
            lastScanned: 123
        });
    });

    it('loads the Dev Tools panel only after selecting it in dev builds', async () => {
        vi.stubEnv('DEV', true);

        render(
            <SettingsModal
                isOpen={true}
                onClose={vi.fn()}
                settings={createSettings()}
                onSave={vi.fn()}
                canCheckForUpdates={false}
                hasPendingUpdate={false}
                pendingUpdateVersion={null}
                updateErrorMessage={null}
                updateStatus="idle"
                onCheckForUpdates={vi.fn()}
                onOpenUpdatePrompt={vi.fn()}
                onNavigateToMaintenance={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /dev tools/i }));

        expect(await screen.findByText('Dev panel')).not.toBeNull();
    });

    it('hides the Dev Tools tab in production builds', () => {
        vi.stubEnv('DEV', false);

        render(
            <SettingsModal
                isOpen={true}
                onClose={vi.fn()}
                settings={createSettings()}
                onSave={vi.fn()}
                canCheckForUpdates={true}
                hasPendingUpdate={false}
                pendingUpdateVersion={null}
                updateErrorMessage={null}
                updateStatus="idle"
                onCheckForUpdates={vi.fn()}
                onOpenUpdatePrompt={vi.fn()}
                onNavigateToMaintenance={vi.fn()}
            />
        );

        expect(screen.queryByRole('button', { name: /dev tools/i })).toBeNull();
    });

    it('falls back to Advanced when initialTab is dev in production builds', () => {
        vi.stubEnv('DEV', false);

        render(
            <SettingsModal
                isOpen={true}
                onClose={vi.fn()}
                settings={createSettings()}
                onSave={vi.fn()}
                canCheckForUpdates={true}
                initialTab="dev"
                hasPendingUpdate={false}
                pendingUpdateVersion={null}
                updateErrorMessage={null}
                updateStatus="idle"
                onCheckForUpdates={vi.fn()}
                onOpenUpdatePrompt={vi.fn()}
                onNavigateToMaintenance={vi.fn()}
            />
        );

        expect(screen.getByText('Advanced panel')).not.toBeNull();
        expect(screen.queryByText('Dev panel')).toBeNull();
    });

    it('routes connection subtabs and legacy experiments to their owning panels', () => {
        const commonProps = {
            isOpen: true,
            onClose: vi.fn(),
            settings: createSettings(),
            onSave: vi.fn(),
            canCheckForUpdates: false,
            hasPendingUpdate: false,
            pendingUpdateVersion: null,
            updateErrorMessage: null,
            updateStatus: 'idle' as const,
            onCheckForUpdates: vi.fn(),
            onOpenUpdatePrompt: vi.fn(),
            onNavigateToMaintenance: vi.fn(),
        };
        const { rerender } = render(<SettingsModal {...commonProps} initialTab="folders" />);
        expect(screen.getByText('Connections panel folders')).toBeTruthy();

        rerender(<SettingsModal {...commonProps} initialTab="experiments" />);
        expect(screen.getByText('Intelligence panel')).toBeTruthy();

        rerender(<SettingsModal {...commonProps} initialTab="privacy" />);
        expect(screen.queryByText('Intelligence panel')).toBeNull();
    });

    it('forwards direct settings values without wrapping them', () => {
        const onSave = vi.fn<(update: AppSettingsUpdate) => void>();
        render(
            <SettingsModal
                isOpen
                onClose={vi.fn()}
                settings={createSettings()}
                onSave={onSave}
                canCheckForUpdates={false}
                hasPendingUpdate={false}
                pendingUpdateVersion={null}
                updateErrorMessage={null}
                updateStatus="idle"
                onCheckForUpdates={vi.fn()}
                onOpenUpdatePrompt={vi.fn()}
                onNavigateToMaintenance={vi.fn()}
            />
        );

        fireEvent.click(screen.getByText('Direct settings update'));

        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ theme: 'light' }));
    });
});
