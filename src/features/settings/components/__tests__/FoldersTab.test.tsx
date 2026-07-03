import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../../../test/testUtils';
import { AppSettings } from '../../../../types';
import { FoldersTab } from '../FoldersTab';

vi.mock('../../hooks/useFoldersTabLogic', () => ({
    useFoldersTabLogic: () => ({
        newFolderPath: '',
        setNewFolderPath: vi.fn(),
        scanningIds: new Set<string>(),
        combinedFolders: [],
        fileInputRef: { current: null },
        handleRescan: vi.fn(),
        handleAddFolder: vi.fn(),
        removeFolder: vi.fn(),
        handleBrowse: vi.fn(),
    }),
}));

vi.mock('../../../../hooks/useMetadataRefresh', () => ({
    useMetadataRefresh: () => ({
        forceRefresh: vi.fn(),
    }),
}));

const settings: AppSettings = {
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 200,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    maskedKeywords: [],
    maskingMode: 'blur',
    enableAI: false,
    resourceFolders: ['D:/AmbitFixtures/Models'],
};

describe('FoldersTab', () => {
    it('stays focused on watched image folders rather than resource discovery', () => {
        render(<FoldersTab settings={settings} setSettings={vi.fn()} />);

        expect(screen.getByText('Monitored Folders')).not.toBeNull();
        expect(screen.queryByText(/online model hash resolution/i)).toBeNull();
        expect(screen.queryByText(/resolve online/i)).toBeNull();
        expect(screen.queryByText(/no resource folders added/i)).toBeNull();
    });
});
