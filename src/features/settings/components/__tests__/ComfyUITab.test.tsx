import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../../../test/testUtils';
import type { AppSettings } from '../../../../types';
import { ComfyUITab } from '../ComfyUITab';

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: vi.fn(),
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
    comfyUiPath: 'D:/ComfyUI/output',
};

describe('ComfyUITab', () => {
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
});
