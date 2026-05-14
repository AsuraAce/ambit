import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import type { AppSettings, AppSettingsUpdate } from '../../../../types';
import { SettingsModal } from '../SettingsModal';

vi.mock('../../../../hooks/useAppVersion', () => ({
    useAppVersion: () => 'test'
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
                                path: 'D:/AI/Linked',
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
        </div>
    ),
    PrivacyTab: () => null,
    IntelligenceTab: () => null,
    DevTab: () => null,
    AdvancedTab: () => null,
    ConnectionsTab: () => null
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
            path: 'D:/AI/Linked',
            initialScanPending: false,
            lastScanned: 123
        });
    });
});
