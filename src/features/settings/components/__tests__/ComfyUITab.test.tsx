import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import type { AppSettings } from '../../../../types';
import { ComfyUITab } from '../ComfyUITab';

const mocks = vi.hoisted(() => ({
    addToast: vi.fn(),
    open: vi.fn(),
    normalizePath: vi.fn((path: string) => path.replace(/\\/g, '/'))
}));

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: mocks.addToast,
    }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('../../../../utils/pathUtils', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../../../utils/pathUtils')>(),
    normalizePath: mocks.normalizePath
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
    comfyUiPath: 'D:/ComfyUI/output',
};

describe('ComfyUITab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.open.mockResolvedValue(null);
    });

    it('uses the shared sage integration treatment for ComfyUI controls', () => {
        render(<ComfyUITab settings={settings} setSettings={vi.fn()} />);

        const header = screen.getByText(/output configuration/i);
        const input = screen.getByDisplayValue('D:/ComfyUI/output');
        const primaryAction = screen.getByRole('button', { name: /link output folder/i });

        expect(header.className).toContain('bg-sage-600');
        expect(input.className).toContain('focus:border-sage-500');
        expect(primaryAction.className).toContain('bg-sage-600');
        expect(header.className + input.className + primaryAction.className).not.toContain('indigo');
    });

    it('disables linking without a path and updates the controlled path through setSettings', () => {
        let updatedSettings: AppSettings | undefined;
        const setSettings = vi.fn((update: React.SetStateAction<AppSettings>) => {
            updatedSettings = typeof update === 'function' ? update(settings) : update;
        });
        render(<ComfyUITab settings={{ ...settings, comfyUiPath: undefined }} setSettings={setSettings} />);

        expect((screen.getByPlaceholderText(/comfyui/i) as HTMLInputElement).value).toBe('');
        expect((screen.getByRole('button', { name: /link output folder/i }) as HTMLButtonElement).disabled).toBe(true);

        fireEvent.change(screen.getByPlaceholderText(/comfyui/i), { target: { value: 'E:/Comfy/output' } });
        expect(updatedSettings?.comfyUiPath).toBe('E:/Comfy/output');
    });

    it('recognizes an already monitored folder after slash normalization', () => {
        const setSettings = vi.fn();
        render(<ComfyUITab
            settings={{
                ...settings,
                comfyUiPath: 'D:\\ComfyUI\\output',
                monitoredFolders: [{ id: 'existing', path: 'D:/ComfyUI/output', isActive: true, imageCount: 0 }]
            }}
            setSettings={setSettings}
        />);

        fireEvent.click(screen.getByRole('button', { name: /link output folder/i }));

        expect(screen.getByText(/already being monitored!/i)).not.toBeNull();
        expect(mocks.addToast).toHaveBeenCalledWith('Folder is already being monitored', 'info');
        expect(setSettings).not.toHaveBeenCalled();
    });

    it('links a new ComfyUI folder and preserves existing settings', () => {
        vi.spyOn(Date, 'now').mockReturnValue(123);
        const setSettings = vi.fn((update: React.SetStateAction<AppSettings>) => {
            if (typeof update === 'function') update(settings);
        });
        render(<ComfyUITab settings={settings} setSettings={setSettings} />);

        fireEvent.click(screen.getByRole('button', { name: /link output folder/i }));

        const update = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
        expect(update(settings).monitoredFolders).toEqual([{
            id: 'comfyui_123',
            path: 'D:/ComfyUI/output',
            isActive: true,
            imageCount: 0,
            variant: 'ComfyUI'
        }]);
        expect(screen.getByText(/successfully linked/i)).not.toBeNull();
        expect(mocks.addToast).toHaveBeenCalledWith('Successfully linked ComfyUI output folder', 'success');
        vi.restoreAllMocks();
    });

    it('reports a failed link when settings persistence throws', () => {
        const setSettings = vi.fn(() => { throw new Error('persistence failed'); });
        render(<ComfyUITab settings={settings} setSettings={setSettings} />);

        fireEvent.click(screen.getByRole('button', { name: /link output folder/i }));

        expect(screen.getByText('Failed to link folder.')).not.toBeNull();
        expect(mocks.addToast).toHaveBeenCalledWith('Failed to link folder', 'error');
    });

    it('normalizes a selected browse path before updating settings', async () => {
        mocks.open.mockResolvedValue('E:\\ComfyUI\\output');
        const setSettings = vi.fn();
        render(<ComfyUITab settings={settings} setSettings={setSettings} />);

        fireEvent.click(screen.getByRole('button', { name: 'Browse for ComfyUI Output Folder' }));

        await waitFor(() => expect(setSettings).toHaveBeenCalled());
        expect(mocks.open).toHaveBeenCalledWith({
            directory: true,
            multiple: false,
            title: 'Select ComfyUI Output Folder'
        });
        const update = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
        expect(update(settings).comfyUiPath).toBe('E:/ComfyUI/output');
    });

    it('ignores cancelled and non-string browse results and contains dialog errors', async () => {
        const setSettings = vi.fn();
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { rerender } = render(<ComfyUITab settings={settings} setSettings={setSettings} />);

        fireEvent.click(screen.getByRole('button', { name: 'Browse for ComfyUI Output Folder' }));
        await waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(1));
        expect(setSettings).not.toHaveBeenCalled();

        mocks.open.mockResolvedValueOnce(['E:/one', 'E:/two']);
        fireEvent.click(screen.getByRole('button', { name: 'Browse for ComfyUI Output Folder' }));
        await waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(2));
        expect(setSettings).not.toHaveBeenCalled();

        mocks.open.mockRejectedValueOnce(new Error('dialog failed'));
        rerender(<ComfyUITab settings={settings} setSettings={setSettings} />);
        fireEvent.click(screen.getByRole('button', { name: 'Browse for ComfyUI Output Folder' }));
        await waitFor(() => expect(error).toHaveBeenCalledWith(expect.any(Error)));
        expect(setSettings).not.toHaveBeenCalled();
        error.mockRestore();
    });
});
