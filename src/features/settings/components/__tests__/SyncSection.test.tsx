import * as React from 'react';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, InvokeOwnerDiscovery } from '../../../../types';
import { useInvokeConnectionDraft } from '../../hooks/useInvokeConnectionDraft';
import { InvokeRecoverySection, SyncSection } from '../SyncSection';

const mocks = vi.hoisted(() => ({ isInvokeSyncActive: false, isLiveSyncing: false }));
vi.mock('../../../../contexts/LibraryContext', () => ({
    useLibrary: () => ({ isInvokeSyncActive: mocks.isInvokeSyncActive, isLiveSyncing: mocks.isLiveSyncing }),
}));
vi.mock('../../../../hooks/useToast', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

const applied = (overrides: Partial<AppSettings> = {}) => ({
    invokeAiPath: 'D:/Invoke', invokeSyncFavorites: true, invokeSyncBoards: true, importOrphans: true,
    ...overrides,
} as AppSettings);

const multiUserDiscovery: InvokeOwnerDiscovery = {
    schemaMode: 'multi_user', dbPath: 'D:/Invoke/databases/invokeai.db', imagesRoot: 'D:/Invoke',
    owners: [{ ownerId: 'owner-a', imageCount: 1 }], unassignedImageCount: 0,
};

const Harness: React.FC<{ settings?: AppSettings; ownerDiscovery?: InvokeOwnerDiscovery }> = ({ settings = applied(), ownerDiscovery }) => {
    const session = useInvokeConnectionDraft(settings, true);
    return <>
        <SyncSection draftSession={session} ownerDiscovery={ownerDiscovery} />
        <InvokeRecoverySection settings={settings} setSettings={vi.fn()} hasPendingDraft={session.isDirty} />
    </>;
};

describe('SyncSection draft controls', () => {
    beforeEach(() => {
        mocks.isInvokeSyncActive = false;
        mocks.isLiveSyncing = false;
    });
    it.each([true, false, undefined])('offers one draft-only board control governed by the parent setting (%s)', (parent) => {
        const settings = applied({ invokeSyncBoards: parent, syncBoardsToCollections: parent === false });
        render(<Harness settings={settings} />);
        const boards = screen.getByRole('switch', { name: 'Sync boards as collections' }) as HTMLInputElement;
        expect(boards.checked).toBe(parent !== false);
        expect(screen.queryByRole('switch', { name: 'Persist Synced Boards as Collections' })).toBeNull();
        fireEvent.click(boards);
        expect(boards.checked).toBe(parent === false);
        expect(settings.invokeSyncBoards).toBe(parent);
        expect((screen.getByRole('button', { name: 'Force Full Resync' }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText(/turning this off keeps existing collections/i)).toBeTruthy();
    });
    it('keeps option changes in the local draft and blocks applied recovery actions', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('switch', { name: 'Import Intermediates' }));

        expect((screen.getByRole('switch', { name: 'Import Intermediates' }) as HTMLInputElement).checked).toBe(true);
        expect((screen.getByRole('button', { name: 'Force Full Resync' }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByRole('button', { name: 'Force Full Resync' }).getAttribute('title')).toMatch(/apply or discard/i);
    });

    it('uses the draft owner scope to disable orphan recovery without clearing its preference', () => {
        render(<Harness settings={applied({
            invokeOwnerSelection: { dbPath: 'D:/Invoke/databases/invokeai.db', mode: 'owner', ownerId: 'owner-a' },
            importOrphans: true,
        })} ownerDiscovery={multiUserDiscovery} />);

        const orphanRecovery = screen.getByRole('switch', { name: 'Orphan Recovery' }) as HTMLInputElement;
        expect(orphanRecovery.disabled).toBe(true);
        expect(orphanRecovery.checked).toBe(false);
        expect(screen.getByText(/saved preference is preserved/i)).toBeTruthy();
    });

    it('confirms a full resync before clearing the applied cursor and its snapshot', () => {
        const setSettings = vi.fn();
        const settings = applied({
            lastSyncedAt: 42,
            invokeDbSnapshot: {
                dbPath: 'D:/Invoke/databases/invokeai.db', lastSyncedAt: 42,
                importIntermediates: false, importOrphans: false, syncBoardsToCollections: false,
                scopeMode: 'legacy', scopeOwnerId: null, pathRepairVersion: 1, importSchemaVersion: 1, files: [],
            },
        });
        render(<InvokeRecoverySection settings={settings} setSettings={setSettings} hasPendingDraft={false} />);

        fireEvent.click(screen.getAllByRole('button', { name: 'Force Full Resync' }).at(-1)!);
        expect(screen.getByText('Force Full InvokeAI Resync?')).toBeTruthy();
        expect(setSettings).not.toHaveBeenCalled();
        fireEvent.click(screen.getAllByRole('button', { name: 'Force Full Resync' }).at(-1)!);

        const update = setSettings.mock.calls[0][0] as (current: AppSettings) => AppSettings;
        expect(update(settings)).toMatchObject({
            lastSyncedAt: null,
            invokeDbSnapshot: { lastSyncedAt: null },
            invokeDbSnapshots: [expect.objectContaining({ lastSyncedAt: null })],
        });
    });

    it('disables full resync while a sync is active', () => {
        mocks.isInvokeSyncActive = true;
        render(<InvokeRecoverySection settings={applied()} setSettings={vi.fn()} hasPendingDraft={false} />);
        expect((screen.getByRole('button', { name: 'Force Full Resync' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('does not clear the cursor if a sync starts after confirmation opens', () => {
        const setSettings = vi.fn();
        const settings = applied({ lastSyncedAt: 42 });
        const view = render(<InvokeRecoverySection settings={settings} setSettings={setSettings} hasPendingDraft={false} />);
        fireEvent.click(screen.getAllByRole('button', { name: 'Force Full Resync' }).at(-1)!);
        mocks.isInvokeSyncActive = true;
        view.rerender(<InvokeRecoverySection settings={{ ...settings }} setSettings={setSettings} hasPendingDraft={false} />);
        fireEvent.click(screen.getAllByRole('button', { name: 'Force Full Resync' }).at(-1)!);
        expect(setSettings).not.toHaveBeenCalled();
    });
});
