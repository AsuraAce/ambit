import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { useSettingsStore } from '../../../../stores/settingsStore';
import type { AppSettings } from '../../../../types';
import { PrivacyTab } from '../PrivacyTab';

const addToastMock = vi.fn();

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: addToastMock,
    }),
}));

const createSettings = (): AppSettings => ({
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 200,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    maskedKeywords: [],
    maskingMode: 'blur',
    enableAI: false,
});

describe('PrivacyTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useSettingsStore.setState({ privacyEnabled: true });
    });

    it('explains startup-default privacy masking and session-only changes', () => {
        render(<PrivacyTab settings={createSettings()} setSettings={vi.fn()} />);

        expect(screen.getByText('Privacy masking is enabled by default every time Ambit starts. Turning it off here only affects the current session.')).not.toBeNull();
    });

    it('explains how blur and hide affect matching images', () => {
        render(<PrivacyTab settings={createSettings()} setSettings={vi.fn()} />);

        fireEvent.focus(screen.getByRole('button', { name: 'About privacy masking behavior' }));

        expect(screen.getByRole('tooltip').textContent).toContain('Blur keeps matching images visible');
        expect(screen.getByRole('tooltip').textContent).toContain('Hide removes matching images from results');
    });

    it('exposes and updates the current session state as an accessible switch', () => {
        render(<PrivacyTab settings={createSettings()} setSettings={vi.fn()} />);

        const privacySwitch = screen.getByRole('switch', { name: 'Privacy Mode' });
        expect(privacySwitch.getAttribute('aria-checked')).toBe('true');

        fireEvent.click(privacySwitch);

        expect(privacySwitch.getAttribute('aria-checked')).toBe('false');
        expect(useSettingsStore.getState().privacyEnabled).toBe(false);
        expect(addToastMock).toHaveBeenCalledWith('Privacy mode disabled for this session', 'success');
    });
});
