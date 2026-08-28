import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../../../types';
import type { InvokeOwnerScopeState } from '../../../../contexts/SyncContext';
import { InvokeAITab } from '../InvokeAITab';

const mocks = vi.hoisted(() => ({
    developerFeatures: true,
    invoke: vi.fn(),
    open: vi.fn(),
    testConnection: vi.fn(),
    diagnoseInvokeAI: vi.fn(),
    selectInvokeOwnerScope: vi.fn(),
    retryInvokeOwnerScope: vi.fn(),
    startInvokeSync: vi.fn(),
    isInvokeSyncActive: false,
    isLiveSyncing: false,
    ownerScopeState: { status: 'ready', discovery: { schemaMode: 'legacy', dbPath: 'D:/Invoke/databases/invokeai.db', imagesRoot: 'D:/Invoke', owners: [], unassignedImageCount: 0 } } as InvokeOwnerScopeState
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('../../../../services/invoke/connection', () => ({ testConnection: mocks.testConnection, diagnoseInvokeAI: mocks.diagnoseInvokeAI }));
vi.mock('../../../../utils/settingsUtils', () => ({ areDeveloperFeaturesEnabled: () => mocks.developerFeatures }));
vi.mock('../SyncSection', () => ({ SyncSection: () => <div>sync-section</div> }));
vi.mock('../../../../contexts/LibraryContext', () => ({
    useLibrary: () => ({
        invokeOwnerScopeState: mocks.ownerScopeState,
        selectInvokeOwnerScope: mocks.selectInvokeOwnerScope,
        retryInvokeOwnerScope: mocks.retryInvokeOwnerScope,
        startInvokeSync: mocks.startInvokeSync,
        isInvokeSyncActive: mocks.isInvokeSyncActive,
        isLiveSyncing: mocks.isLiveSyncing,
    }),
}));

const settings = (invokeAiPath?: string) => ({ invokeAiPath } as AppSettings);
const applySettings = (initial: AppSettings) => {
    let current = initial;
    const setSettings = vi.fn((update: React.SetStateAction<AppSettings>) => {
        current = typeof update === 'function' ? update(current) : update;
    });
    return { setSettings, current: () => current };
};

describe('InvokeAITab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.developerFeatures = true;
        mocks.isInvokeSyncActive = false;
        mocks.isLiveSyncing = false;
        mocks.ownerScopeState = { status: 'ready', discovery: { schemaMode: 'legacy', dbPath: 'D:/Invoke/databases/invokeai.db', imagesRoot: 'D:/Invoke', owners: [], unassignedImageCount: 0 } };
        mocks.open.mockResolvedValue(null);
        mocks.testConnection.mockResolvedValue({ success: true, message: 'Connected' });
        mocks.diagnoseInvokeAI.mockResolvedValue({ totalInDb: 2, categories: [], origins: [] });
        mocks.invoke.mockResolvedValue({ imageFiles: 2, thumbnailFiles: 1, subfolders: {} });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('disables path actions without a path and hides developer diagnostics when disabled', () => {
        mocks.developerFeatures = false;
        render(<InvokeAITab settings={settings()} setSettings={vi.fn()} />);
        expect((screen.getByText('Test Connection').closest('button') as HTMLButtonElement).disabled).toBe(true);
        expect(screen.queryByText('System Audit')).toBeNull();
        expect(screen.getByText('sync-section')).toBeTruthy();
    });

    it('locks the configured root while owner visibility is changing', () => {
        mocks.ownerScopeState = {
            status: 'applying',
            discovery: {
                schemaMode: 'multi_user',
                dbPath: 'D:/Invoke/databases/invokeai.db',
                imagesRoot: 'D:/Invoke',
                owners: [
                    { ownerId: 'owner-a', imageCount: 1 },
                    { ownerId: 'owner-b', imageCount: 1 },
                ],
                unassignedImageCount: 0,
            },
            progress: { current: 500, total: 2000, message: 'Updating InvokeAI image details...' },
        };
        render(<InvokeAITab settings={settings('D:/Invoke')} setSettings={vi.fn()} />);

        const rootInput = screen.getByRole('textbox') as HTMLInputElement;
        const browseButton = screen.getByText('Browse').closest('button') as HTMLButtonElement;
        expect(rootInput.disabled).toBe(true);
        expect(rootInput.readOnly).toBe(false);
        expect(rootInput.getAttribute('aria-disabled')).toBe('true');
        expect(browseButton.disabled).toBe(true);
        expect(browseButton.getAttribute('aria-disabled')).toBe('true');
        expect((screen.getByText('Test Connection').closest('button') as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByRole('status').textContent).toContain('Updating InvokeAI image details...');
        expect(screen.getByRole('status').textContent).toContain('500 / 2,000');
    });

    it('locks root and owner controls during quiet startup synchronization', () => {
        mocks.isInvokeSyncActive = true;
        mocks.ownerScopeState = {
            status: 'ready',
            discovery: {
                schemaMode: 'multi_user',
                dbPath: 'D:/Invoke/databases/invokeai.db',
                imagesRoot: 'D:/Invoke',
                owners: [
                    { ownerId: 'owner-a', imageCount: 1 },
                    { ownerId: 'owner-b', imageCount: 1 },
                ],
                unassignedImageCount: 0,
            },
        };
        render(<InvokeAITab settings={{
            ...settings('D:/Invoke'),
            invokeOwnerSelection: {
                dbPath: 'D:/Invoke/databases/invokeai.db',
                mode: 'owner',
                ownerId: 'owner-a',
            },
        }} setSettings={vi.fn()} />);

        expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(true);
        expect(screen.getAllByRole('button', { name: /unnamed owner/i })
            .every(button => (button as HTMLButtonElement).disabled)).toBe(true);
        expect(screen.getByText(/locked until synchronization finishes/i)).toBeTruthy();
    });

    it('keeps owner-scope presentation stable during background Live Watch', () => {
        mocks.isInvokeSyncActive = true;
        mocks.isLiveSyncing = true;
        const setSettings = vi.fn();
        mocks.ownerScopeState = {
            status: 'ready',
            discovery: {
                schemaMode: 'multi_user',
                dbPath: 'D:/Invoke/databases/invokeai.db',
                imagesRoot: 'D:/Invoke',
                owners: [
                    { ownerId: 'owner-a', imageCount: 1 },
                    { ownerId: 'owner-b', imageCount: 1 },
                ],
                unassignedImageCount: 0,
            },
        };
        render(<InvokeAITab settings={{
            ...settings('D:/Invoke'),
            invokeOwnerSelection: {
                dbPath: 'D:/Invoke/databases/invokeai.db',
                mode: 'owner',
                ownerId: 'owner-a',
            },
        }} setSettings={setSettings} />);

        const rootInput = screen.getByRole('textbox') as HTMLInputElement;
        const browseButton = screen.getByText('Browse').closest('button') as HTMLButtonElement;
        expect(rootInput.disabled).toBe(false);
        expect(rootInput.readOnly).toBe(true);
        expect(rootInput.getAttribute('aria-disabled')).toBe('true');
        expect(browseButton.disabled).toBe(false);
        expect(browseButton.getAttribute('aria-disabled')).toBe('true');
        fireEvent.change(rootInput, { target: { value: 'D:/Other' } });
        fireEvent.click(browseButton);
        expect(setSettings).not.toHaveBeenCalled();
        expect(mocks.open).not.toHaveBeenCalled();
        expect(screen.getAllByRole('button', { name: /unnamed owner/i })
            .every(button => !(button as HTMLButtonElement).disabled)).toBe(true);
        expect(screen.queryByText(/locked until synchronization finishes/i)).toBeNull();
    });

    it('shows display names with stable IDs and requires confirmation for All users', async () => {
        mocks.ownerScopeState = {
            status: 'selection_required',
            discovery: {
                schemaMode: 'multi_user',
                dbPath: 'D:/Invoke/databases/invokeai.db',
                imagesRoot: 'D:/Invoke',
                owners: [{
                    ownerId: 'owner-a',
                    displayName: 'Artemis',
                    imageCount: 12,
                    intermediateImageCount: 4,
                }],
                unassignedImageCount: 2,
            },
        };
        mocks.selectInvokeOwnerScope.mockResolvedValue(true);
        mocks.startInvokeSync.mockResolvedValue(undefined);
        render(<InvokeAITab settings={settings('D:/Invoke')} setSettings={vi.fn()} />);

        expect(screen.getByText('Artemis')).toBeTruthy();
        expect(screen.getByText('owner-a')).toBeTruthy();
        expect(screen.getByText('8 standard images')).toBeTruthy();
        expect(screen.getByText('4 intermediates')).toBeTruthy();
        expect(screen.queryByText(/email/i)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /artemis/i }));
        expect(mocks.selectInvokeOwnerScope).toHaveBeenCalledWith({
            dbPath: 'D:/Invoke/databases/invokeai.db',
            mode: 'owner',
            ownerId: 'owner-a',
        });
        expect(mocks.startInvokeSync).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /all users/i }));
        expect(screen.getByText('Show images from all InvokeAI users?')).toBeTruthy();
        expect(screen.getByText(/2 unassigned image rows/i)).toBeTruthy();
        expect(mocks.selectInvokeOwnerScope).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Show All Users' }));
        await waitFor(() => expect(mocks.selectInvokeOwnerScope).toHaveBeenLastCalledWith({
            dbPath: 'D:/Invoke/databases/invokeai.db',
            mode: 'all',
        }));
        expect(mocks.startInvokeSync).not.toHaveBeenCalled();
    });

    it('explains offline and blocking failures without exposing raw errors by default', async () => {
        mocks.ownerScopeState = {
            status: 'offline_ready',
            rootPath: 'D:/Invoke',
            isRetrying: true,
            error: 'file is locked',
            failure: { kind: 'source_unavailable', details: 'file is locked' },
        };
        const view = render(<InvokeAITab settings={settings('D:/Invoke')} setSettings={vi.fn()} />);

        expect(screen.getByText('Using the last verified local view')).toBeTruthy();
        expect(screen.getByText(/Sync and Live Watch are paused/i)).toBeTruthy();
        expect(screen.queryByText('Preparing your InvokeAI library...')).toBeNull();
        expect((screen.getByRole('button', { name: /retrying/i }) as HTMLButtonElement).disabled).toBe(true);

        mocks.ownerScopeState = {
            status: 'error',
            rootPath: 'D:/Invoke',
            error: 'visibility transaction failed',
            failure: { kind: 'preparation_failed', details: 'visibility transaction failed' },
        };
        mocks.retryInvokeOwnerScope.mockResolvedValueOnce(true);
        mocks.startInvokeSync.mockResolvedValueOnce(undefined);
        view.rerender(<InvokeAITab settings={settings('D:/Invoke')} setSettings={vi.fn()} />);

        expect(screen.getByText('InvokeAI library preparation failed')).toBeTruthy();
        expect((screen.getByText('Technical details').parentElement as HTMLDetailsElement).open).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(mocks.retryInvokeOwnerScope).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(mocks.startInvokeSync).toHaveBeenCalledWith({ mode: 'startup' }));
    });

    it('summarizes and auto-selects a single represented owner without showing All users', () => {
        mocks.ownerScopeState = {
            status: 'ready',
            rootPath: 'D:/Invoke',
            discovery: {
                schemaMode: 'multi_user',
                dbPath: 'D:/Invoke/databases/invokeai.db',
                imagesRoot: 'D:/Invoke',
                owners: [{ ownerId: 'owner-a', displayName: 'Artemis', imageCount: 12 }],
                unassignedImageCount: 0,
            },
        };
        const view = render(<InvokeAITab settings={{
            ...settings('D:/Invoke'),
            invokeOwnerSelection: {
                dbPath: 'D:/Invoke/databases/invokeai.db',
                mode: 'owner',
                ownerId: 'owner-a',
            },
        }} setSettings={vi.fn()} />);

        expect(screen.getByText(/found one InvokeAI owner and selected it automatically/i)).toBeTruthy();
        expect(screen.getByText(/12 images/i)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /artemis/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /all users/i })).toBeNull();
        expect(mocks.selectInvokeOwnerScope).not.toHaveBeenCalled();
        expect(mocks.startInvokeSync).not.toHaveBeenCalled();
        view.unmount();
    });

    it('keeps owner controls available when a single image owner has unassigned boards', () => {
        mocks.ownerScopeState = {
            status: 'ready',
            rootPath: 'D:/Invoke',
            discovery: {
                schemaMode: 'multi_user',
                dbPath: 'D:/Invoke/databases/invokeai.db',
                imagesRoot: 'D:/Invoke',
                owners: [{ ownerId: 'system', displayName: 'System', imageCount: 154_719, boardCount: 6 }],
                unassignedImageCount: 0,
                unassignedBoardCount: 231,
            },
        };

        render(<InvokeAITab settings={settings('D:/Invoke')} setSettings={vi.fn()} />);

        expect(screen.getByRole('button', { name: /system/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /all users/i })).toBeTruthy();
        expect(screen.getByText(/231 boards have no owner/i)).toBeTruthy();
        expect(screen.queryByText(/selected it automatically/i)).toBeNull();
    });

    it('shows a non-color marker for the selected All users scope', () => {
        mocks.ownerScopeState = {
            status: 'ready',
            discovery: {
                schemaMode: 'multi_user',
                dbPath: 'D:/Invoke/databases/invokeai.db',
                imagesRoot: 'D:/Invoke',
                owners: [
                    { ownerId: 'owner-a', imageCount: 1 },
                    { ownerId: 'owner-b', imageCount: 1 },
                ],
                unassignedImageCount: 0,
            },
        };

        render(<InvokeAITab settings={{
            ...settings('D:/Invoke'),
            invokeOwnerSelection: {
                dbPath: 'D:/Invoke/databases/invokeai.db',
                mode: 'all',
            },
        }} setSettings={vi.fn()} />);

        const allUsers = screen.getByRole('button', { name: /All users/i });
        expect(allUsers.querySelector('.lucide-check')).toBeTruthy();
        fireEvent.click(allUsers);
        expect(screen.queryByText('Show images from all InvokeAI users?')).toBeNull();
        expect(mocks.selectInvokeOwnerScope).not.toHaveBeenCalled();
    });

    it('updates typed and browsed paths while ignoring cancelled selections', async () => {
        const harness = applySettings(settings('old'));
        mocks.open.mockResolvedValueOnce('C:/InvokeAI').mockResolvedValueOnce(null).mockResolvedValueOnce(['invalid']);
        render(<InvokeAITab settings={harness.current()} setSettings={harness.setSettings} />);

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'typed' } });
        expect(harness.current().invokeAiPath).toBe('typed');
        fireEvent.click(screen.getByText('Browse'));
        await waitFor(() => expect(harness.current().invokeAiPath).toBe('C:/InvokeAI'));
        fireEvent.click(screen.getByText('Browse'));
        await waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(2));
        fireEvent.click(screen.getByText('Browse'));
        await waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(3));
        expect(harness.current().invokeAiPath).toBe('C:/InvokeAI');

        mocks.open.mockRejectedValueOnce(new Error('dialog failed'));
        fireEvent.click(screen.getByText('Browse'));
        await waitFor(() => expect(console.error).toHaveBeenCalledWith(expect.any(Error)));
    });

    it('shows connection loading, success, backend failure, and import failure states', async () => {
        let resolveConnection: (value: { success: boolean; message: string }) => void = () => undefined;
        mocks.testConnection.mockImplementationOnce(() => new Promise(resolve => { resolveConnection = resolve; }));
        const { rerender } = render(<InvokeAITab settings={settings('path')} setSettings={vi.fn()} />);
        fireEvent.click(screen.getByText('Test Connection'));
        expect(screen.getByText('Verifying...')).toBeTruthy();
        await waitFor(() => expect(mocks.testConnection).toHaveBeenCalledTimes(1));
        resolveConnection({ success: true, message: 'Connected' });
        await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy());

        mocks.testConnection.mockResolvedValueOnce({ success: false, message: 'Bad database' });
        fireEvent.click(screen.getByText('Test Connection'));
        await waitFor(() => expect(screen.getByText('Bad database')).toBeTruthy());

        mocks.testConnection.mockRejectedValueOnce(new Error('load failed'));
        fireEvent.click(screen.getByText('Test Connection'));
        await waitFor(() => expect(screen.getByText('Failed to load integration service.')).toBeTruthy());

        rerender(<InvokeAITab settings={settings()} setSettings={vi.fn()} />);
        expect((screen.getByText('Test Connection').closest('button') as HTMLButtonElement).disabled).toBe(true);
    });

    it('audits matching and database-heavy nested repositories', async () => {
        mocks.diagnoseInvokeAI.mockResolvedValueOnce({
            totalInDb: 12,
            categories: [{ image_category: 'general', count: 8 }],
            origins: [{ image_origin: 'internal', count: 12 }]
        });
        mocks.invoke.mockResolvedValueOnce({ imageFiles: 10, thumbnailFiles: 9, subfolders: { outputs: 10 } });
        render(<InvokeAITab settings={settings('path')} setSettings={vi.fn()} />);

        fireEvent.click(screen.getByText('Run Audit'));
        expect(screen.getByText('Analyzing...')).toBeTruthy();
        await waitFor(() => expect(screen.getByText('Count Discrepancy Found')).toBeTruthy());
        expect(document.body.textContent).toContain('extra records in the database');
        expect(screen.getByText(/Recommended: use/)).toBeTruthy();
        expect(screen.getByText('general')).toBeTruthy();
        expect(screen.getByText('internal')).toBeTruthy();
        expect(screen.getByText('outputs')).toBeTruthy();
        expect(screen.getByText('9 Thumbnails active')).toBeTruthy();
        expect(mocks.invoke).toHaveBeenCalledWith('audit_invokeai_folder', { path: 'path' });
    });

    it('reports extra files, flat repositories, and diagnostic failures', async () => {
        mocks.diagnoseInvokeAI.mockResolvedValueOnce({ totalInDb: 1, categories: [], origins: [] });
        mocks.invoke.mockResolvedValueOnce({ imageFiles: 3, thumbnailFiles: 0, subfolders: undefined });
        render(<InvokeAITab settings={settings('path')} setSettings={vi.fn()} />);
        fireEvent.click(screen.getByText('Run Audit'));
        await waitFor(() => expect(document.body.textContent).toContain('extra files in the outputs folder'));
        expect(screen.queryByText(/Recommended: use/)).toBeNull();
        expect(screen.getByText('Output repository is flat (no sub-collections found).')).toBeTruthy();

        mocks.diagnoseInvokeAI.mockRejectedValueOnce(new Error('audit failed'));
        fireEvent.click(screen.getByText('Run Audit'));
        await waitFor(() => expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'audit failed' })));
        expect(screen.getByText('Run Audit')).toBeTruthy();
    });
});
