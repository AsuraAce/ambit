import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../../../types';
import { InvokeAITab } from '../InvokeAITab';

const mocks = vi.hoisted(() => ({
    developerFeatures: true,
    invoke: vi.fn(),
    open: vi.fn(),
    testConnection: vi.fn(),
    diagnoseInvokeAI: vi.fn()
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('../../../../services/invoke/connection', () => ({ testConnection: mocks.testConnection, diagnoseInvokeAI: mocks.diagnoseInvokeAI }));
vi.mock('../../../../utils/settingsUtils', () => ({ areDeveloperFeaturesEnabled: () => mocks.developerFeatures }));
vi.mock('../SyncSection', () => ({ SyncSection: () => <div>sync-section</div> }));

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
