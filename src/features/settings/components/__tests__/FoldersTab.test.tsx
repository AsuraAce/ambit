import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { AppSettings, GeneratorTool } from '../../../../types';
import { FoldersTab } from '../FoldersTab';

const mocks = vi.hoisted(() => ({
    combinedFolders: [] as Array<Record<string, unknown>>,
    handleRescan: vi.fn(),
    forceRefresh: vi.fn(),
}));

vi.mock('../../hooks/useFoldersTabLogic', () => ({
    useFoldersTabLogic: () => ({
        newFolderPath: '',
        setNewFolderPath: vi.fn(),
        scanningIds: new Set<string>(),
        combinedFolders: mocks.combinedFolders,
        fileInputRef: { current: null },
        handleRescan: mocks.handleRescan,
        handleAddFolder: vi.fn(),
        removeFolder: vi.fn(),
        handleBrowse: vi.fn(),
    }),
}));

vi.mock('../../../../hooks/useMetadataRefresh', () => ({
    useMetadataRefresh: () => ({
        forceRefresh: mocks.forceRefresh,
    }),
}));

vi.mock('../FolderItem', () => ({
    FolderItem: ({ folder, onRefresh }: {
        folder: { path: string; pathRaw?: string; variant?: GeneratorTool; isManaged?: boolean };
        onRefresh: (path: string, force: boolean, variant?: GeneratorTool, isManaged?: boolean) => void;
    }) => (
        <button onClick={() => onRefresh(
            folder.isManaged ? (folder.pathRaw ?? folder.path) : folder.path,
            true,
            folder.variant,
            folder.isManaged
        )}>
            Refresh {folder.path}
        </button>
    ),
}));

const settings: AppSettings = {
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 200,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    promptMaskingEnabled: true,
    maskedKeywords: [],
    maskingMode: 'blur',
    enableAI: false,
    resourceFolders: ['D:/AmbitFixtures/Models'],
};

describe('FoldersTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.combinedFolders = [];
        mocks.handleRescan.mockResolvedValue(undefined);
    });

    it('stays focused on watched image folders rather than resource discovery', () => {
        render(<FoldersTab settings={settings} setSettings={vi.fn()} />);

        expect(screen.getByText('Monitored Folders')).not.toBeNull();
        expect(screen.queryByText(/online model hash resolution/i)).toBeNull();
        expect(screen.queryByText(/resolve online/i)).toBeNull();
        expect(screen.queryByText(/no resource folders added/i)).toBeNull();
    });

    it('routes normal folder refreshes to metadata reparsing', () => {
        mocks.combinedFolders = [{
            id: 'folder-1',
            path: 'D:/Images',
            variant: GeneratorTool.COMFYUI,
            isManaged: false,
        }];
        render(<FoldersTab settings={settings} setSettings={vi.fn()} />);

        fireEvent.click(screen.getByText('Refresh D:/Images'));

        expect(mocks.forceRefresh).toHaveBeenCalledWith('D:/Images', true);
        expect(mocks.handleRescan).not.toHaveBeenCalled();
    });

    it('routes managed InvokeAI refreshes through database sync using the raw path', () => {
        mocks.combinedFolders = [{
            id: 'regular',
            path: 'D:/Images',
            variant: GeneratorTool.COMFYUI,
            isManaged: false,
        }, {
            id: 'invoke',
            path: 'D:/Invoke/outputs/images',
            pathRaw: 'D:/Invoke',
            variant: GeneratorTool.INVOKEAI,
            isManaged: true,
        }];
        render(<FoldersTab settings={settings} setSettings={vi.fn()} />);

        fireEvent.click(screen.getByText('Refresh D:/Invoke/outputs/images'));

        expect(mocks.handleRescan).toHaveBeenCalledWith(
            'invoke',
            'D:/Invoke',
            GeneratorTool.INVOKEAI,
            true
        );
        expect(mocks.forceRefresh).not.toHaveBeenCalled();
    });

    it('ignores a managed refresh when its path no longer exists in the current folders', () => {
        mocks.combinedFolders = [{
            id: 'invoke',
            path: 'D:/Invoke/outputs/images',
            variant: GeneratorTool.INVOKEAI,
            isManaged: true,
        }];
        render(<FoldersTab settings={settings} setSettings={vi.fn()} />);

        const button = screen.getByText('Refresh D:/Invoke/outputs/images');
        mocks.combinedFolders.splice(0);
        fireEvent.click(button);

        expect(mocks.handleRescan).not.toHaveBeenCalled();
        expect(mocks.forceRefresh).not.toHaveBeenCalled();
    });

    it('syncs managed InvokeAI before triggering a global metadata refresh', async () => {
        const events: string[] = [];
        mocks.combinedFolders = [{
            id: 'invoke',
            path: 'D:/Invoke/outputs/images',
            variant: GeneratorTool.INVOKEAI,
            isManaged: true,
        }];
        mocks.handleRescan.mockImplementation(async () => {
            events.push('sync');
        });
        mocks.forceRefresh.mockImplementation(() => {
            events.push('refresh');
        });
        render(<FoldersTab settings={settings} setSettings={vi.fn()} />);

        fireEvent.click(screen.getByText('Refresh All Metadata'));

        await waitFor(() => expect(events).toEqual(['sync', 'refresh']));
        expect(mocks.handleRescan).toHaveBeenCalledWith(
            'invoke',
            'D:/Invoke/outputs/images',
            GeneratorTool.INVOKEAI,
            true
        );
        expect(mocks.forceRefresh).toHaveBeenCalledWith(undefined, false);
    });

    it('refreshes all metadata directly when no managed InvokeAI folder exists', async () => {
        render(<FoldersTab settings={settings} setSettings={vi.fn()} />);

        fireEvent.click(screen.getByText('Refresh All Metadata'));

        await waitFor(() => expect(mocks.forceRefresh).toHaveBeenCalledWith(undefined, false));
        expect(mocks.handleRescan).not.toHaveBeenCalled();
    });
});
