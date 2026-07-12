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

const createSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 200,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    maskedKeywords: [],
    maskingMode: 'blur',
    enableAI: false,
    ...overrides,
});

const settingsHarness = (initial: AppSettings) => {
    let current = initial;
    const setSettings = vi.fn((update: React.SetStateAction<AppSettings>) => {
        current = typeof update === 'function' ? update(current) : update;
    });
    return { setSettings, current: () => current };
};

describe('PrivacyTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useSettingsStore.setState({ privacyEnabled: true });
    });

    it('explains startup-default privacy masking and session-only changes', () => {
        render(<PrivacyTab settings={createSettings()} setSettings={vi.fn()} />);

        expect(screen.getByText('Privacy masking is enabled by default every time Ambit starts. Turning it off here only affects the current session.')).not.toBeNull();
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

    it('enables session privacy and changes both persisted masking modes', () => {
        useSettingsStore.setState({ privacyEnabled: false });
        const harness = settingsHarness(createSettings());
        const { rerender } = render(<PrivacyTab settings={harness.current()} setSettings={harness.setSettings} />);

        fireEvent.click(screen.getByRole('switch', { name: 'Privacy Mode' }));
        expect(useSettingsStore.getState().privacyEnabled).toBe(true);
        expect(addToastMock).toHaveBeenCalledWith('Privacy mode enabled for this session', 'success');

        fireEvent.click(screen.getByLabelText('Hide Completely'));
        expect(harness.current().maskingMode).toBe('hide');
        expect(addToastMock).toHaveBeenCalledWith('Masking mode set to hide', 'success');
        rerender(<PrivacyTab settings={harness.current()} setSettings={harness.setSettings} />);
        fireEvent.click(screen.getByLabelText('Blur Content'));
        expect(harness.current().maskingMode).toBe('blur');
    });

    it('normalizes new keywords, rejects duplicates, and removes existing entries', () => {
        const harness = settingsHarness(createSettings({ maskedKeywords: ['existing'] }));
        const { rerender } = render(<PrivacyTab settings={harness.current()} setSettings={harness.setSettings} />);
        const input = screen.getByPlaceholderText('Type keyword and press Enter...');

        fireEvent.keyDown(input, { key: 'Escape' });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(harness.setSettings).not.toHaveBeenCalled();

        fireEvent.change(input, { target: { value: ' EXISTING ' } });
        fireEvent.click(screen.getByText('Add'));
        expect(addToastMock).toHaveBeenCalledWith('Keyword already exists', 'warning');
        expect(harness.setSettings).not.toHaveBeenCalled();

        fireEvent.change(input, { target: { value: '  Sensitive  ' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(harness.current().maskedKeywords).toEqual(['existing', 'sensitive']);
        expect(addToastMock).toHaveBeenCalledWith('Added "sensitive" to masked keywords', 'success');

        rerender(<PrivacyTab settings={harness.current()} setSettings={harness.setSettings} />);
        const existingChip = screen.getByText('existing').closest('span') as HTMLElement;
        fireEvent.click(existingChip.querySelector('button') as HTMLButtonElement);
        expect(harness.current().maskedKeywords).toEqual(['sensitive']);
        expect(addToastMock).toHaveBeenCalledWith('Removed "existing" from masked keywords', 'success');
    });
});
