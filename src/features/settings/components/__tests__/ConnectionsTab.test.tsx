import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { AppSettings } from '../../../../types';
import { ConnectionsTab } from '../ConnectionsTab';

vi.mock('..', () => ({
    FoldersTab: () => <div>Folders panel</div>,
    ResourcesTab: () => <div>Resources panel</div>,
    InvokeAITab: () => <div>InvokeAI panel</div>,
    A1111Tab: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>SD WebUI panel</button>,
    ComfyUITab: () => <div>ComfyUI panel</div>,
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
};

describe('ConnectionsTab', () => {
    it('shows Resources as a dedicated sub-tab separate from Folders', () => {
        render(<ConnectionsTab settings={settings} setSettings={vi.fn()} />);

        expect(screen.getByRole('button', { name: /resources/i })).not.toBeNull();
        expect(screen.getByText('Folders panel')).not.toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /resources/i }));

        expect(screen.getByText('Resources panel')).not.toBeNull();
    });

    it('switches through every connection panel and responds to deep-link changes', () => {
        const { rerender } = render(
            <ConnectionsTab settings={settings} setSettings={vi.fn()} initialSubTab="invokeai" />
        );
        expect(screen.getByText('InvokeAI panel')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /sd webui/i }));
        expect(screen.getByText('SD WebUI panel')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /comfyui/i }));
        expect(screen.getByText('ComfyUI panel')).toBeTruthy();

        rerender(<ConnectionsTab settings={settings} setSettings={vi.fn()} initialSubTab="folders" />);
        expect(screen.getByText('Folders panel')).toBeTruthy();
    });

    it('supplies a harmless default close callback to the SD WebUI panel', () => {
        render(<ConnectionsTab settings={settings} setSettings={vi.fn()} initialSubTab="a1111" />);

        fireEvent.click(screen.getByRole('button', { name: 'SD WebUI panel' }));
    });
});
