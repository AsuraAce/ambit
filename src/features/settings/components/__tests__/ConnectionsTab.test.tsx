import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { AppSettings } from '../../../../types';
import { ConnectionsTab } from '../ConnectionsTab';

vi.mock('..', () => ({
    FoldersTab: () => <div>Folders panel</div>,
    ResourcesTab: () => <div>Resources panel</div>,
    InvokeAITab: () => <div>InvokeAI panel</div>,
    A1111Tab: () => <div>SD WebUI panel</div>,
    ComfyUITab: () => <div>ComfyUI panel</div>,
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
};

describe('ConnectionsTab', () => {
    it('shows Resources as a dedicated sub-tab separate from Folders', () => {
        render(<ConnectionsTab settings={settings} setSettings={vi.fn()} />);

        expect(screen.getByRole('button', { name: /resources/i })).not.toBeNull();
        expect(screen.getByText('Folders panel')).not.toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /resources/i }));

        expect(screen.getByText('Resources panel')).not.toBeNull();
    });
});
