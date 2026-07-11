import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultAppSettings } from '../../../constants/defaultSettings';
import type { AppSettings } from '../../../types';
import { ImportModal } from '../ImportModal';

describe('ImportModal', () => {
    const setup = (settings = createDefaultAppSettings()) => {
        const onClose = vi.fn();
        const onOpenSettings = vi.fn();
        const onImportFiles = vi.fn();
        const setSettings = vi.fn();
        const view = render(
            <ImportModal
                isOpen
                onClose={onClose}
                onOpenSettings={onOpenSettings}
                onImportFiles={onImportFiles}
                settings={settings}
                setSettings={setSettings}
            />
        );
        return { ...view, onClose, onOpenSettings, onImportFiles, setSettings };
    };

    it('renders only while open and opens every integration route', () => {
        const settings = createDefaultAppSettings();
        const closed = render(<ImportModal isOpen={false} onClose={vi.fn()} onOpenSettings={vi.fn()} onImportFiles={vi.fn()} settings={settings} setSettings={vi.fn()} />);
        expect(screen.queryByText('Add Images to Your Library')).toBeNull();
        closed.unmount();

        const { onOpenSettings } = setup(settings);
        for (const [label, tab] of [['InvokeAI', 'invokeai'], ['ComfyUI', 'comfyui'], ['A1111 / Forge', 'a1111']] as const) {
            fireEvent.click(screen.getByRole('button', { name: label }));
            expect(onOpenSettings).toHaveBeenCalledWith(tab);
        }
    });

    it('imports files, adds folders, and closes after each manual route', () => {
        const { onClose, onOpenSettings, onImportFiles } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'Select Files' }));
        expect(onImportFiles).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();

        fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }));
        expect(onOpenSettings).toHaveBeenCalledWith('folders');
        expect(onClose).toHaveBeenCalledTimes(2);
        fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
        expect(onClose).toHaveBeenCalledTimes(3);
    });

    it('toggles the persistent visibility preference in both directions', () => {
        const initial = createDefaultAppSettings({ hideImportModal: false });
        const { container, rerender, setSettings } = setup(initial);
        const toggle = container.querySelector('label > div') as HTMLElement;
        fireEvent.click(toggle);
        const firstUpdate = setSettings.mock.calls[0][0] as (previous: AppSettings) => Partial<AppSettings>;
        expect(firstUpdate(initial).hideImportModal).toBe(true);

        const hidden = createDefaultAppSettings({ hideImportModal: true });
        rerender(<ImportModal isOpen onClose={vi.fn()} onOpenSettings={vi.fn()} onImportFiles={vi.fn()} settings={hidden} setSettings={setSettings} />);
        fireEvent.click(container.querySelector('label > div') as HTMLElement);
        const secondUpdate = setSettings.mock.calls[1][0] as (previous: AppSettings) => Partial<AppSettings>;
        expect(secondUpdate(hidden).hideImportModal).toBe(false);
    });
});
