import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, InvokeOwnerDiscovery } from '../../../../types';
import { useInvokeConnectionDraft } from '../../hooks/useInvokeConnectionDraft';
import { useInvokeOwnerDiscovery } from '../../hooks/useInvokeOwnerDiscovery';
import { InvokeAITab } from '../InvokeAITab';

const mocks = vi.hoisted(() => ({
    inspect: vi.fn(), apply: vi.fn(), open: vi.fn(), getSuppressedInvokeCollections: vi.fn(), refreshCollections: vi.fn(),
    diagnose: vi.fn(), invoke: vi.fn(), developerFeatures: false,
    cancelSync: vi.fn(), isInvokeSyncActive: false, isLiveSyncing: false, syncStatus: 'idle' as 'idle' | 'syncing',
    ownerScopeState: { status: 'ready' } as Record<string, unknown>,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('../../../../services/invoke/connection', () => ({
    inspectInvokeConnection: mocks.inspect,
    resolveInvokePaths: (root: string) => ({ dbPath: `${root.replace(/\\/g, '/').replace(/\/$/, '')}/databases/invokeai.db`, imagesRoot: root }),
    diagnoseInvokeAI: mocks.diagnose,
}));
vi.mock('../../../../services/db/collectionRepo', () => ({ getSuppressedInvokeCollections: mocks.getSuppressedInvokeCollections, restoreInvokeCollection: vi.fn() }));
vi.mock('../../../../stores/collectionStore', () => ({ useCollectionStore: (select: (state: { refreshCollections: typeof mocks.refreshCollections }) => unknown) => select({ refreshCollections: mocks.refreshCollections }) }));
vi.mock('../../../../utils/settingsUtils', () => ({ areDeveloperFeaturesEnabled: () => mocks.developerFeatures }));
vi.mock('../SyncSection', () => ({
    SyncSection: ({ draftSession }: { draftSession: { draft: { importIntermediates: boolean }; update: (update: { importIntermediates: boolean }) => void } }) => (
        <button type="button" onClick={() => draftSession.update({ importIntermediates: !draftSession.draft.importIntermediates })}>
            Import intermediates: {String(draftSession.draft.importIntermediates)}
        </button>
    ),
    InvokeRecoverySection: () => <div>sync recovery</div>,
}));
vi.mock('../../../../contexts/LibraryContext', () => ({
    useLibrary: () => ({ invokeOwnerScopeState: mocks.ownerScopeState, retryInvokeOwnerScope: vi.fn(), startInvokeSync: vi.fn(), applyInvokeConnection: mocks.apply, cancelSync: mocks.cancelSync, syncState: { status: mocks.syncStatus }, isInvokeSyncActive: mocks.isInvokeSyncActive, isLiveSyncing: mocks.isLiveSyncing }),
}));

const legacyDiscovery = (root: string): InvokeOwnerDiscovery => ({ schemaMode: 'legacy', dbPath: `${root}/databases/invokeai.db`, imagesRoot: root, owners: [], unassignedImageCount: 0 });
const settings = (invokeAiPath?: string) => ({ invokeAiPath } as AppSettings);
const DraftHarness: React.FC<{ settings: AppSettings; setSettings: React.Dispatch<React.SetStateAction<AppSettings>>; onClose?: () => void }> = ({ settings, setSettings, onClose }) => {
    const draftSession = useInvokeConnectionDraft(settings, true);
    const ownerDiscoverySession = useInvokeOwnerDiscovery(draftSession.draft.invokeAiPath);
    return <InvokeAITab settings={settings} setSettings={setSettings} draftSession={draftSession} ownerDiscoverySession={ownerDiscoverySession} onClose={onClose} />;
};
const DraftNavigationHarness: React.FC<{ settings: AppSettings }> = ({ settings }) => {
    const [showInvoke, setShowInvoke] = React.useState(true);
    const draftSession = useInvokeConnectionDraft(settings, true);
    const ownerDiscoverySession = useInvokeOwnerDiscovery(draftSession.draft.invokeAiPath);
    return <>
        <button type="button" onClick={() => setShowInvoke(value => !value)}>Toggle Invoke tab</button>
        {showInvoke && <InvokeAITab settings={settings} setSettings={vi.fn()} draftSession={draftSession} ownerDiscoverySession={ownerDiscoverySession} />}
    </>;
};

describe('InvokeAITab draft connection flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.inspect.mockImplementation(async (root: string) => legacyDiscovery(root));
        mocks.apply.mockResolvedValue({ status: 'completed' });
        mocks.getSuppressedInvokeCollections.mockResolvedValue([]);
        mocks.ownerScopeState = { status: 'ready' };
        mocks.developerFeatures = false;
        mocks.diagnose.mockResolvedValue({ totalInDb: 0, categories: [], origins: [] });
        mocks.invoke.mockResolvedValue({ imageFiles: 0, thumbnailFiles: 0, subfolders: {} });
        mocks.isInvokeSyncActive = false;
        mocks.isLiveSyncing = false;
        mocks.syncStatus = 'idle';
    });

    it('does not apply typed edits until the explicit connection action', async () => {
        const setSettings = vi.fn();
        render(<DraftHarness settings={settings('D:/Applied')} setSettings={setSettings} />);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'D:/Candidate' } });
        expect(setSettings).not.toHaveBeenCalled();
        expect(mocks.apply).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        await screen.findByText('Connected to a legacy InvokeAI database.');
        expect(mocks.apply).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Connect & Import' }));
        await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ invokeAiPath: 'D:/Candidate' })));
    });

    it('closes a replacement only after acceptance and does not restore Settings focus after unmount', async () => {
        const onClose = vi.fn();
        let onAccepted: (() => void) | undefined;
        let finish!: (outcome: { status: 'completed'; viewCommitted: boolean }) => void;
        mocks.apply.mockImplementation((_draft, options?: { onAccepted?: () => void }) => {
            onAccepted = options?.onAccepted;
            return new Promise(resolve => { finish = resolve; });
        });
        const { unmount } = render(<DraftHarness settings={settings()} setSettings={vi.fn()} onClose={onClose} />);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'D:/Candidate' } });
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        await screen.findByText('Connected to a legacy InvokeAI database.');
        fireEvent.click(screen.getByRole('button', { name: 'Connect & Import' }));
        expect(onClose).not.toHaveBeenCalled();
        act(() => onAccepted?.());
        expect(onClose).toHaveBeenCalledTimes(1);
        unmount();
        const galleryControl = document.createElement('button');
        document.body.append(galleryControl);
        galleryControl.focus();
        await act(async () => finish({ status: 'completed', viewCommitted: true }));
        expect(document.activeElement).toBe(galleryControl);
        galleryControl.remove();
    });

    it('keeps validation failure and current-owner Sync now inside Settings', async () => {
        const onClose = vi.fn();
        mocks.apply.mockResolvedValueOnce({ status: 'failed', message: 'Source unavailable.', viewCommitted: false });
        render(<DraftHarness settings={settings('D:/Applied')} setSettings={vi.fn()} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        await screen.findByText('Connected to a legacy InvokeAI database.');
        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
        await screen.findByText('Source unavailable.');
        expect(onClose).not.toHaveBeenCalled();
        expect(mocks.apply.mock.calls[0]).toHaveLength(1);
    });

    it.each([false, true])('requires a fresh check after an equivalent typed path edit (previous failure: %s)', async (failedCheck) => {
        const setSettings = vi.fn();
        mocks.ownerScopeState = { status: 'ready', discovery: legacyDiscovery('D:/Applied') };
        render(<DraftHarness settings={settings('D:/Applied')} setSettings={setSettings} />);
        expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(false);
        if (failedCheck) {
            mocks.inspect.mockRejectedValueOnce(new Error('database unavailable'));
            fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
            await screen.findByText('database unavailable');
        }
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'D:/Applied/' } });
        expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
        expect(mocks.apply).not.toHaveBeenCalled();
        expect(setSettings).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        await screen.findByText('Connected to a legacy InvokeAI database.');
        expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
        await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
    });

    it('retains required validation across tab navigation and restores the applied connection on discard', () => {
        mocks.ownerScopeState = { status: 'ready', discovery: legacyDiscovery('D:/Applied') };
        render(<DraftNavigationHarness settings={settings('D:/Applied')} />);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'D:/Applied/' } });
        fireEvent.click(screen.getByRole('button', { name: 'Toggle Invoke tab' }));
        fireEvent.click(screen.getByRole('button', { name: 'Toggle Invoke tab' }));
        expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(true);
        // Make a substantive draft change so Discard changes is available.
        fireEvent.click(screen.getByRole('button', { name: /import intermediates: false/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
        expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(false);
        expect(mocks.inspect).not.toHaveBeenCalled();
        expect(mocks.apply).not.toHaveBeenCalled();
    });

    it.each(['', '   '])('can discard a cleared configured path (%j) without applying or inspecting', (emptyPath) => {
        const setSettings = vi.fn();
        mocks.ownerScopeState = { status: 'ready', discovery: legacyDiscovery('D:/Applied') };
        render(<DraftHarness settings={settings('D:/Applied')} setSettings={setSettings} />);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: emptyPath } });
        expect((screen.getByRole('button', { name: 'Connect & Import' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
        expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('D:/Applied');
        expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(false);
        expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull();
        expect(mocks.inspect).not.toHaveBeenCalled();
        expect(mocks.apply).not.toHaveBeenCalled();
        expect(setSettings).not.toHaveBeenCalled();
    });

    it('keeps multi-user selection local until the final action', async () => {
        mocks.inspect.mockResolvedValue({ schemaMode: 'multi_user', dbPath: 'D:/Candidate/databases/invokeai.db', imagesRoot: 'D:/Candidate', owners: [{ ownerId: 'owner-a', displayName: 'Artemis', imageCount: 2 }], unassignedImageCount: 1 });
        render(<DraftHarness settings={settings()} setSettings={vi.fn()} />);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'D:/Candidate' } });
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        await screen.findByRole('button', { name: /artemis/i });
        fireEvent.click(screen.getByRole('button', { name: /artemis/i }));
        expect(mocks.apply).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Connect & Import' }));
        await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ invokeOwnerSelection: { dbPath: 'D:/Candidate/databases/invokeai.db', mode: 'owner', ownerId: 'owner-a' } })));
    });

    it('retains checked discovery, owner selection, and import options across tab navigation', async () => {
        mocks.inspect.mockResolvedValue({ schemaMode: 'multi_user', dbPath: 'D:/Candidate/databases/invokeai.db', imagesRoot: 'D:/Candidate', owners: [{ ownerId: 'owner-a', displayName: 'Artemis', imageCount: 2 }], unassignedImageCount: 1 });
        render(<DraftNavigationHarness settings={settings()} />);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'D:/Candidate' } });
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        await screen.findByRole('button', { name: /artemis/i });
        fireEvent.click(screen.getByRole('button', { name: /artemis/i }));
        fireEvent.click(screen.getByRole('button', { name: /import intermediates: false/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Toggle Invoke tab' }));
        fireEvent.click(screen.getByRole('button', { name: 'Toggle Invoke tab' }));

        expect(screen.getByRole('button', { name: /import intermediates: true/i })).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Connect & Import' }) as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Connect & Import' }));
        await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({
            invokeOwnerSelection: { dbPath: 'D:/Candidate/databases/invokeai.db', mode: 'owner', ownerId: 'owner-a' },
            importIntermediates: true,
        })));
        expect(mocks.inspect).toHaveBeenCalledTimes(1);
    });

    it('auto-selects only a sole represented owner and hides the selector', async () => {
        mocks.inspect.mockResolvedValue({ schemaMode: 'multi_user', dbPath: 'D:/Candidate/databases/invokeai.db', imagesRoot: 'D:/Candidate', owners: [{ ownerId: 'owner-a', displayName: 'Artemis', imageCount: 2 }], unassignedImageCount: 0 });
        render(<DraftHarness settings={settings()} setSettings={vi.fn()} />);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'D:/Candidate' } });
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        await screen.findByText(/selected it automatically/i);
        expect(screen.queryByRole('button', { name: /all users/i })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Connect & Import' }));
        await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ invokeOwnerSelection: { dbPath: 'D:/Candidate/databases/invokeai.db', mode: 'owner', ownerId: 'owner-a' } })));
    });

    it('replaces a stale saved owner with the sole discovered owner', async () => {
        mocks.inspect.mockResolvedValue({ schemaMode: 'multi_user', dbPath: 'D:/Applied/databases/invokeai.db', imagesRoot: 'D:/Applied', owners: [{ ownerId: 'owner-b', displayName: 'B', imageCount: 2 }], unassignedImageCount: 0 });
        render(<DraftHarness settings={{ ...settings('D:/Applied'), invokeOwnerSelection: { dbPath: 'D:/Applied/databases/invokeai.db', mode: 'owner', ownerId: 'owner-a' } }} setSettings={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        await screen.findByText(/selected it automatically/i);
        expect(screen.getByRole('button', { name: 'Switch view' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Switch view' }));
        await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({
            invokeOwnerSelection: { dbPath: 'D:/Applied/databases/invokeai.db', mode: 'owner', ownerId: 'owner-b' },
        })));
    });

    it('confirms All users only at the final action and restores focus when cancelled', async () => {
        mocks.inspect.mockResolvedValue({ schemaMode: 'multi_user', dbPath: 'D:/Candidate/databases/invokeai.db', imagesRoot: 'D:/Candidate', owners: [{ ownerId: 'owner-a', imageCount: 2 }, { ownerId: 'owner-b', imageCount: 1 }], unassignedImageCount: 0 });
        render(<DraftHarness settings={settings()} setSettings={vi.fn()} />);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'D:/Candidate' } });
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        await screen.findByRole('button', { name: /all users/i });
        fireEvent.click(screen.getByRole('button', { name: /all users/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Connect & Import' }));

        expect(screen.getByText('Show images from all InvokeAI users?')).toBeTruthy();
        expect(mocks.apply).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Connect & Import' })));
        expect(mocks.apply).not.toHaveBeenCalled();
    });

    it('requires explicit selection when the only owner has unassigned content', async () => {
        mocks.inspect.mockResolvedValue({ schemaMode: 'multi_user', dbPath: 'D:/Candidate/databases/invokeai.db', imagesRoot: 'D:/Candidate', owners: [{ ownerId: 'owner-a', imageCount: 2 }], unassignedImageCount: 1, unassignedBoardCount: 1 });
        render(<DraftHarness settings={settings()} setSettings={vi.fn()} />);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'D:/Candidate' } });
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        await screen.findByRole('button', { name: /unnamed owner/i });
        expect((screen.getByRole('button', { name: 'Connect & Import' }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByRole('button', { name: /all users/i })).toBeTruthy();
    });

    it('does not reconfirm a cached applied All users view for Sync now', async () => {
        mocks.ownerScopeState = {
            status: 'ready',
            discovery: { schemaMode: 'multi_user', dbPath: 'D:/Applied/databases/invokeai.db', imagesRoot: 'D:/Applied', owners: [{ ownerId: 'owner-a', imageCount: 2 }], unassignedImageCount: 0 },
        };
        render(<DraftHarness settings={{ ...settings('D:/Applied'), invokeOwnerSelection: { dbPath: 'D:/Applied/databases/invokeai.db', mode: 'all' } }} setSettings={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
        await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
        expect(screen.queryByText('Show images from all InvokeAI users?')).toBeNull();
    });

    it('describes cancelled preparation as a retryable choice when Settings reopens', () => {
        mocks.ownerScopeState = {
            status: 'error', rootPath: 'D:/Applied', discovery: legacyDiscovery('D:/Applied'),
            failure: { kind: 'preparation_cancelled', details: 'Preparation cancelled.' },
        };
        render(<DraftHarness settings={settings('D:/Applied')} setSettings={vi.fn()} />);
        expect(screen.getByText('InvokeAI preparation cancelled')).toBeTruthy();
        expect(screen.getByText(/saved for retry/i)).toBeTruthy();
        expect(screen.queryByText('InvokeAI library preparation failed')).toBeNull();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
        expect(mocks.apply).not.toHaveBeenCalled();
    });

    it('blocks apply after a failed inspection even when a saved discovery exists', async () => {
        mocks.ownerScopeState = { status: 'ready', discovery: legacyDiscovery('D:/Applied') };
        mocks.inspect.mockRejectedValueOnce(new Error('database unavailable'));
        render(<DraftHarness settings={settings('D:/Applied')} setSettings={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        await screen.findByText('database unavailable');
        expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('revokes an earlier successful discovery when a recheck of the same source fails', async () => {
        render(<DraftHarness settings={settings('D:/Applied')} setSettings={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        await screen.findByText('Connected to a legacy InvokeAI database.');
        expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(false);

        mocks.inspect.mockRejectedValueOnce(new Error('database unavailable'));
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        await screen.findByText('database unavailable');
        expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('keeps hidden-collection restoration secondary and disables it while a draft is pending', async () => {
        mocks.getSuppressedInvokeCollections.mockResolvedValue([{ id: 'board-a', name: 'Board A', invokeSourcePresent: true }]);
        render(<DraftHarness settings={settings('D:/Applied')} setSettings={vi.fn()} />);
        await screen.findByText('Hidden InvokeAI collections');
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'D:/Candidate' } });
        expect((screen.getByRole('button', { name: 'Restore Board A' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('runs diagnostics against the applied path and keeps diagnostic failures non-blocking', async () => {
        mocks.developerFeatures = true;
        mocks.diagnose.mockResolvedValueOnce({ totalInDb: 2, categories: [], origins: [] });
        mocks.invoke.mockResolvedValueOnce({ imageFiles: 1, thumbnailFiles: 0, subfolders: {} });
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<DraftHarness settings={settings('D:/Applied')} setSettings={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Run Audit' }));
        await screen.findByText('Count Discrepancy Found');
        expect(mocks.diagnose).toHaveBeenCalledWith('D:/Applied');
        expect(mocks.invoke).toHaveBeenCalledWith('audit_invokeai_folder', { path: 'D:/Applied' });

        mocks.diagnose.mockRejectedValueOnce(new Error('audit unavailable'));
        fireEvent.click(screen.getByRole('button', { name: 'Run Audit' }));
        await waitFor(() => expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'audit unavailable' })));
        error.mockRestore();
    });

    it('keeps a foreground import cancellable from Settings', () => {
        mocks.isInvokeSyncActive = true;
        mocks.syncStatus = 'syncing';
        render(<DraftHarness settings={settings('D:/Applied')} setSettings={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel sync' }));
        expect(mocks.cancelSync).toHaveBeenCalledTimes(1);
    });

    it('does not show a cancel control while InvokeAI is only preparing a connection', () => {
        mocks.isInvokeSyncActive = true;
        mocks.syncStatus = 'idle';
        render(<DraftHarness settings={settings('D:/Applied')} setSettings={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Cancel sync' })).toBeNull();
    });

    it('shows no owner selector for legacy databases', async () => {
        render(<DraftHarness settings={settings()} setSettings={vi.fn()} />);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'D:/Candidate' } });
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        await screen.findByText(/predates per-user ownership/i);
        expect(screen.queryByRole('button', { name: /all users/i })).toBeNull();
    });

    it('does not surface a completed discovery for a root replaced while testing', async () => {
        let resolveDiscovery: (value: InvokeOwnerDiscovery) => void = () => undefined;
        mocks.inspect.mockImplementationOnce(() => new Promise(resolve => { resolveDiscovery = resolve; }));
        render(<DraftHarness settings={settings()} setSettings={vi.fn()} />);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'D:/Old' } });
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'D:/New' } });
        resolveDiscovery(legacyDiscovery('D:/Old'));
        await waitFor(() => expect(screen.queryByText('Connected to a legacy InvokeAI database.')).toBeNull());
        expect((screen.getByRole('button', { name: 'Connect & Import' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('formats owner preparation progress with the active locale', () => {
        mocks.ownerScopeState = {
            status: 'applying',
            progress: { current: 500, total: 2000, message: 'Updating InvokeAI image details...' },
        };
        render(<DraftHarness settings={settings('D:/Applied')} setSettings={vi.fn()} />);

        const formatter = new Intl.NumberFormat();
        expect(screen.getByRole('status').textContent).toContain(
            `${formatter.format(500)} / ${formatter.format(2000)}`,
        );
    });
});
